import json
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from market_data_freshness import (
    ET,
    data_ready_buffer_minutes,
    expected_latest_daily_date,
    is_after_us_market_close,
    is_yf_daily_data_ready,
    post_close_send_time_kst,
    reference_ticker,
)
from scheduler_grace import past_startup_grace
from scheduler_slots import DEFAULT_CATCHUP_MINUTES, due_slot_id
from us_calendar import is_us_equity_trading_day

KST = ZoneInfo("Asia/Seoul")
PROJECT_DIR = Path(__file__).resolve().parent
SCHEDULER_STATE_PATH = PROJECT_DIR / "data" / "scheduler_state.json"
DEFAULT_FIXED_TIMES = ((7, 0),)
DEFAULT_POLL_SECONDS = 30
DEFAULT_SUMMARY_PRE_HOUR = 21
DEFAULT_SUMMARY_PRE_MINUTE = 50


def _parse_hhmm(part: str) -> tuple[int, int] | None:
    text = part.strip()
    if not text:
        return None
    try:
        if ":" in text:
            hour_s, minute_s = text.split(":", 1)
            hour, minute = int(hour_s), int(minute_s)
        else:
            hour, minute = int(text), 0
    except ValueError:
        return None
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return hour, minute
    return None


def _fixed_schedule_times() -> tuple[tuple[int, int], ...]:
    """Parse SUMMARY_SCHEDULE_HOURS_KST as '7:00' or legacy '7' (=07:00)."""
    raw = os.environ.get("SUMMARY_SCHEDULE_HOURS_KST", "7:00").strip()
    if not raw:
        return ()
    times: list[tuple[int, int]] = []
    for part in raw.split(","):
        parsed = _parse_hhmm(part)
        if parsed and parsed not in times:
            times.append(parsed)
    return tuple(times) or DEFAULT_FIXED_TIMES


def _poll_seconds() -> int:
    raw = os.environ.get("SUMMARY_POST_CLOSE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _post_close_enabled() -> bool:
    # Default off: fixed 07:00 KST summary is the primary close brief.
    return os.environ.get("SUMMARY_POST_CLOSE_ENABLED", "false").lower() not in {
        "0",
        "false",
        "no",
    }


def _summary_pre_enabled() -> bool:
    return os.environ.get("SUMMARY_PRE_SCHEDULE_ENABLED", "true").lower() not in {
        "0",
        "false",
        "no",
    }


def _summary_pre_time_kst() -> tuple[int, int]:
    raw = os.environ.get("SUMMARY_PRE_SCHEDULE_KST", "21:50").strip()
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour = int(hour_s)
        minute = int(minute_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return DEFAULT_SUMMARY_PRE_HOUR, DEFAULT_SUMMARY_PRE_MINUTE


_STATE_LOCK = threading.Lock()


def _load_state() -> dict:
    if not SCHEDULER_STATE_PATH.exists():
        return {}
    try:
        return json.loads(SCHEDULER_STATE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_state(state: dict) -> None:
    SCHEDULER_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEDULER_STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def update_scheduler_state(**updates) -> dict:
    """Merge-update scheduler_state.json under a lock (multi-thread safe)."""
    with _STATE_LOCK:
        state = _load_state()
        state.update(updates)
        _save_state(state)
        return dict(state)


def _current_fixed_slot(now: datetime) -> str:
    return now.strftime("%Y-%m-%d-%H-%M")


def _current_minute_slot(now: datetime) -> str:
    return now.strftime("%Y-%m-%d-%H-%M")


def _should_skip_non_trading(now_kst: datetime) -> bool:
    """Skip Sat/Sun (KST) and US holidays for the *session* the brief covers.

    Monday 07:00 KST is still Sunday evening ET — use expected_latest_daily_date
    (Friday) so we do not skip the Friday close brief.
    """
    if now_kst.weekday() >= 5:
        return True
    now_et = datetime.now(ET)
    session = expected_latest_daily_date(now_et)
    if session is None:
        return True
    return not is_us_equity_trading_day(session)


def _summary_heavy_wait_seconds() -> int:
    raw = os.environ.get("SUMMARY_HEAVY_WORK_WAIT_SECONDS", "600").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 600


def _summary_cache_wait_seconds() -> int:
    raw = os.environ.get("SUMMARY_CACHE_WAIT_SECONDS", "900").strip()
    try:
        return max(60, int(raw))
    except ValueError:
        return 900


def _wait_for_yf_session_data(trigger: str) -> bool:
    """Block until Yahoo has the expected US session bar (or timeout)."""
    deadline = time.monotonic() + _summary_cache_wait_seconds()
    while time.monotonic() < deadline:
        ready, detail = is_yf_daily_data_ready()
        if ready:
            print(f"Scheduled summary Yahoo ready ({trigger}): {detail}")
            return True
        print(f"Scheduled summary waiting for Yahoo ({trigger}): {detail}")
        time.sleep(_poll_seconds())
    print(
        f"Scheduled summary skipped ({trigger}): Yahoo session bar not ready after "
        f"{_summary_cache_wait_seconds()}s."
    )
    return False


def _wait_for_summary_caches(trigger: str) -> bool:
    """Warm SUMMARY universes before taking the heavy-work lock."""
    from summary_builder import SUMMARY_UNIVERSES, caches_ready
    from stock_crawler import ensure_universe_caches, is_cache_ready

    if caches_ready():
        return True

    deadline = time.monotonic() + _summary_cache_wait_seconds()
    while time.monotonic() < deadline:
        missing = [
            universe
            for universe in SUMMARY_UNIVERSES
            if not is_cache_ready(universe)
        ]
        if not missing:
            return True
        ensure_universe_caches(missing)
        print(f"Scheduled summary waiting ({trigger}): warming {missing}")
        time.sleep(10)
    print(
        f"Scheduled summary skipped ({trigger}): caches not ready after "
        f"{_summary_cache_wait_seconds()}s."
    )
    return False


def _refresh_summary_caches() -> bool:
    from summary_builder import SUMMARY_UNIVERSES
    from stock_crawler import ensure_fresh_rankings_cache

    ok = True
    for universe in SUMMARY_UNIVERSES:
        if not ensure_fresh_rankings_cache(universe, blocking=True):
            print(f"Scheduled summary: {universe} still session-stale after force rebuild.")
            ok = False
    return ok


def run_scheduled_summary(
    token: str,
    broadcast_fn,
    refresh_cache_fn,
    public_url: str = "",
    trigger: str = "scheduled",
) -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    # Yahoo must have the latest complete US session bar before we rebuild rankings.
    if not _wait_for_yf_session_data(trigger):
        update_scheduler_state(
            last_summary_error=f"{trigger}: Yahoo session bar not ready",
            last_summary_attempt_at=datetime.now(KST).isoformat(),
        )
        return False

    # Wait for caches without holding the heavy-work lock (warmup threads need to finish).
    if not _wait_for_summary_caches(trigger):
        update_scheduler_state(
            last_summary_error=f"{trigger}: caches not ready",
            last_summary_attempt_at=datetime.now(KST).isoformat(),
        )
        return False

    wait_seconds = _summary_heavy_wait_seconds()
    if wait_seconds == 0:
        from heavy_work import try_begin_heavy_work

        acquired = try_begin_heavy_work("scheduled-summary")
    else:
        acquired = begin_heavy_work_blocking(
            "scheduled-summary",
            timeout=wait_seconds,
        )

    if not acquired:
        print(
            f"Scheduled summary skipped ({trigger}): heavy work still busy "
            f"({heavy_work_status()})"
        )
        update_scheduler_state(
            last_summary_error=f"{trigger}: heavy work busy ({heavy_work_status()})",
            last_summary_attempt_at=datetime.now(KST).isoformat(),
        )
        return False

    from summary_builder import generate_and_save_summary

    try:
        # Force-refresh universes needed for /summary (etf+sp) from the verified session.
        if callable(refresh_cache_fn):
            refreshed = refresh_cache_fn()
            if refreshed is False:
                update_scheduler_state(
                    last_summary_error=f"{trigger}: rankings still session-stale",
                    last_summary_attempt_at=datetime.now(KST).isoformat(),
                )
                return False
        elif not _refresh_summary_caches():
            update_scheduler_state(
                last_summary_error=f"{trigger}: rankings still session-stale",
                last_summary_attempt_at=datetime.now(KST).isoformat(),
            )
            return False

        summary = generate_and_save_summary(public_url=public_url, force_macro=True)
        messages = summary["telegram_messages"]
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print(f"Scheduled summary not delivered ({trigger}): 0 chats.")
            update_scheduler_state(
                last_summary_error=f"{trigger}: delivered 0 chats",
                last_summary_attempt_at=datetime.now(KST).isoformat(),
            )
            return False
        try:
            from kakao_notify import send_scheduled_summary_to_kakao

            send_scheduled_summary_to_kakao(summary, public_url=public_url)
        except Exception as kakao_exc:
            print(f"Kakao notify after summary failed: {kakao_exc}")
        print(
            f"Scheduled summary sent ({trigger}, {len(messages)} message(s) "
            f"→ {delivered} chat(s))."
        )
        update_scheduler_state(
            last_summary_error="",
            last_summary_attempt_at=datetime.now(KST).isoformat(),
            last_summary_delivered=delivered,
        )
        return True
    except Exception as exc:
        print(f"Scheduled summary failed ({trigger}): {exc}")
        update_scheduler_state(
            last_summary_error=f"{trigger}: {exc}",
            last_summary_attempt_at=datetime.now(KST).isoformat(),
        )
        return False
    finally:
        end_heavy_work("scheduled-summary")

def run_scheduled_summary_pre(
    token: str,
    broadcast_fn,
    public_url: str = "",
    trigger: str = "scheduled-pre",
) -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    wait_seconds = min(180, _summary_heavy_wait_seconds())
    acquired = begin_heavy_work_blocking(
        "scheduled-summary-pre",
        timeout=wait_seconds,
    )
    if not acquired:
        print(
            f"Scheduled summary_pre skipped ({trigger}): heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        from summary_pre_builder import generate_summary_pre

        summary = generate_summary_pre(public_url=public_url)
        messages = summary["telegram_messages"]
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print(f"Scheduled summary_pre not delivered ({trigger}): 0 chats.")
            return False
        print(
            f"Scheduled summary_pre sent ({trigger}, {len(messages)} message(s) "
            f"→ {delivered} chat(s))."
        )
        return True
    except Exception as exc:
        print(f"Scheduled summary_pre failed ({trigger}): {exc}")
        try:
            delivered = broadcast_fn(
                token,
                [{"text": f"🌅 Premarket brief failed: {exc}"}],
            )
            if not delivered:
                print("Premarket failure notice also undelivered (0 chats).")
        except Exception:
            pass
        return False
    finally:
        end_heavy_work("scheduled-summary-pre")


def _maybe_run_post_close_summary(
    token: str,
    broadcast_fn,
    refresh_cache_fn,
    public_url: str,
    state: dict,
    data_ready_at: datetime | None,
) -> tuple[dict, datetime | None]:
    now_et = datetime.now(ET)
    if not is_after_us_market_close(now_et):
        return state, None

    session_date = expected_latest_daily_date(now_et)
    if session_date is None:
        return state, None

    session_key = session_date.isoformat()
    if state.get("last_post_close_session") == session_key:
        return state, None

    ready, detail = is_yf_daily_data_ready(now_et)
    if not ready:
        if data_ready_at is not None:
            print(f"Post-close brief reset: {detail}")
        return state, None

    if data_ready_at is None:
        data_ready_at = now_et
        send_at_kst = (data_ready_at + timedelta(minutes=data_ready_buffer_minutes())).astimezone(
            KST
        )
        print(
            f"Yahoo Finance daily data ready ({detail}). "
            f"Post-close brief scheduled at {send_at_kst.strftime('%Y-%m-%d %H:%M KST')}."
        )
        return state, data_ready_at

    buffer = timedelta(minutes=data_ready_buffer_minutes())
    if now_et < data_ready_at + buffer:
        return state, data_ready_at

    if run_scheduled_summary(
        token,
        broadcast_fn,
        refresh_cache_fn,
        public_url,
        trigger=f"post-close {session_key}",
    ):
        state = update_scheduler_state(last_post_close_session=session_key)
        return state, None

    return state, data_ready_at


def start_summary_scheduler(
    token: str,
    broadcast_fn,
    refresh_cache_fn,
    public_url: str = "",
) -> None:
    if os.environ.get("SUMMARY_SCHEDULE_ENABLED", "true").lower() in {"0", "false", "no"}:
        print("Summary scheduler disabled.")
        return

    fixed_times = _fixed_schedule_times()
    poll_seconds = _poll_seconds()
    post_close = _post_close_enabled()
    pre_enabled = _summary_pre_enabled()
    pre_hour, pre_minute = _summary_pre_time_kst()
    buffer_minutes = data_ready_buffer_minutes()
    session_date = expected_latest_daily_date()
    approx_kst = (
        post_close_send_time_kst(session_date, buffer_minutes).strftime("%H:%M KST")
        if session_date
        else "n/a"
    )

    def loop() -> None:
        state = _load_state()
        last_fixed_slot = state.get("last_fixed_slot")
        last_pre_slot = state.get("last_summary_pre_slot")
        data_ready_at: datetime | None = None

        catchup_minutes = DEFAULT_CATCHUP_MINUTES
        try:
            catchup_minutes = max(
                15,
                int(os.environ.get("SUMMARY_CATCHUP_MINUTES", "240")),
            )
        except ValueError:
            catchup_minutes = 45

        parts = []
        if fixed_times:
            labels = ", ".join(f"{h:02d}:{m:02d}" for h, m in fixed_times)
            parts.append(
                f"/summary fixed KST {labels} "
                f"(skip weekend/US holiday, {catchup_minutes}m catch-up)"
            )
        if pre_enabled:
            parts.append(
                f"/summary_pre daily {pre_hour:02d}:{pre_minute:02d} KST "
                "(skip weekend/US holiday, SP pre only, 60m catch-up)"
            )
        if post_close:
            parts.append(
                f"post-close after {reference_ticker()} daily bar + {buffer_minutes}m "
                f"(~{approx_kst} on regular days)"
            )
        print(
            "Summary scheduler active — "
            + "; ".join(parts)
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(
                    summary_scheduler_heartbeat=now.isoformat()
                )

                for hour, minute in fixed_times:
                    slot = due_slot_id(
                        now,
                        hour,
                        minute,
                        last_slot=last_fixed_slot,
                        window_minutes=catchup_minutes,
                    )
                    if not slot:
                        continue
                    if _should_skip_non_trading(now):
                        print(f"Scheduled summary skipped ({slot}): weekend or US holiday")
                        last_fixed_slot = slot
                        update_scheduler_state(last_fixed_slot=slot)
                    elif run_scheduled_summary(
                        token,
                        broadcast_fn,
                        refresh_cache_fn,
                        public_url,
                        trigger=f"fixed {slot}",
                    ):
                        last_fixed_slot = slot
                        update_scheduler_state(last_fixed_slot=slot)

                if pre_enabled:
                    # Long window so 21:50 premarket can still catch US open (~22:30 KST EDT).
                    pre_window = 60
                    try:
                        pre_window = max(
                            15,
                            int(os.environ.get("SUMMARY_PRE_CATCHUP_MINUTES", "60")),
                        )
                    except ValueError:
                        pre_window = 60
                    pre_slot = due_slot_id(
                        now,
                        pre_hour,
                        pre_minute,
                        last_slot=last_pre_slot,
                        window_minutes=pre_window,
                    )
                    if pre_slot:
                        if _should_skip_non_trading(now):
                            print(
                                f"Scheduled summary_pre skipped ({pre_slot}): "
                                "weekend or US holiday"
                            )
                            last_pre_slot = pre_slot
                            update_scheduler_state(last_summary_pre_slot=pre_slot)
                        elif run_scheduled_summary_pre(
                            token,
                            broadcast_fn,
                            public_url,
                            trigger=f"pre {pre_slot}",
                        ):
                            last_pre_slot = pre_slot
                            update_scheduler_state(last_summary_pre_slot=pre_slot)

                if post_close:
                    state, data_ready_at = _maybe_run_post_close_summary(
                        token,
                        broadcast_fn,
                        refresh_cache_fn,
                        public_url,
                        _load_state(),
                        data_ready_at,
                    )
            except Exception as exc:
                print(f"Summary scheduler loop error: {exc}")
                try:
                    update_scheduler_state(
                        last_summary_error=f"loop: {exc}",
                        last_summary_attempt_at=datetime.now(KST).isoformat(),
                    )
                except Exception:
                    pass

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="summary-scheduler", daemon=True)
    thread.start()

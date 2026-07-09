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
from summary_builder import KST, caches_ready, generate_and_save_summary

PROJECT_DIR = Path(__file__).resolve().parent
SCHEDULER_STATE_PATH = PROJECT_DIR / "data" / "scheduler_state.json"
DEFAULT_FIXED_HOURS = (22,)
DEFAULT_POLL_SECONDS = 60


def _fixed_schedule_hours() -> tuple[int, ...]:
    raw = os.environ.get("SUMMARY_SCHEDULE_HOURS_KST", "22").strip()
    if not raw:
        return ()
    return tuple(int(part.strip()) for part in raw.split(",") if part.strip())


def _poll_seconds() -> int:
    raw = os.environ.get("SUMMARY_POST_CLOSE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _post_close_enabled() -> bool:
    return os.environ.get("SUMMARY_POST_CLOSE_ENABLED", "true").lower() not in {
        "0",
        "false",
        "no",
    }


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


def _current_fixed_slot(now: datetime) -> str:
    return now.strftime("%Y-%m-%d-%H")


def run_scheduled_summary(
    token: str,
    broadcast_fn,
    refresh_cache_fn,
    public_url: str = "",
    trigger: str = "scheduled",
) -> bool:
    if not caches_ready():
        print(f"Scheduled summary skipped ({trigger}): caches not ready.")
        return False

    try:
        refresh_cache_fn()
        summary = generate_and_save_summary(public_url=public_url)
        messages = summary["telegram_messages"]
        broadcast_fn(token, messages)
        print(f"Scheduled summary sent ({trigger}, {len(messages)} message(s)).")
        return True
    except Exception as exc:
        print(f"Scheduled summary failed ({trigger}): {exc}")
        return False


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
        state["last_post_close_session"] = session_key
        _save_state(state)
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

    fixed_hours = _fixed_schedule_hours()
    poll_seconds = _poll_seconds()
    post_close = _post_close_enabled()
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
        data_ready_at: datetime | None = None

        parts = []
        if post_close:
            parts.append(
                f"post-close after {reference_ticker()} daily bar + {buffer_minutes}m "
                f"(~{approx_kst} on regular days)"
            )
        if fixed_hours:
            parts.append(f"fixed KST hours: {fixed_hours}")
        print("Summary scheduler active — " + "; ".join(parts))

        while True:
            now = datetime.now(KST)

            if fixed_hours and now.hour in fixed_hours and now.minute == 0:
                slot = _current_fixed_slot(now)
                if slot != last_fixed_slot:
                    if run_scheduled_summary(
                        token,
                        broadcast_fn,
                        refresh_cache_fn,
                        public_url,
                        trigger=f"fixed {slot}",
                    ):
                        last_fixed_slot = slot
                        state["last_fixed_slot"] = slot
                        _save_state(state)

            if post_close:
                state, data_ready_at = _maybe_run_post_close_summary(
                    token,
                    broadcast_fn,
                    refresh_cache_fn,
                    public_url,
                    state,
                    data_ready_at,
                )

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="summary-scheduler", daemon=True)
    thread.start()

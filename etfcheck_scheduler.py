"""Scheduled /etfcheck broadcast — once per KRX trading day (default 15:40 KST).

Delivers to the legacy ETF channel (TELEGRAM_CHAT_ID).

Idempotency (당일 거래대금 TOP scrape ≤ 1/day):
  - Slot id is the calendar day (YYYY-MM-DD).
  - After any scrape attempt the day is claimed, so Telegram delivery failures
    and short redeploys cannot re-hit etfcheck.co.kr.
  - If heavy-work is busy, the day is *not* claimed yet — limited retries only
    inside the catch-up window (default 30m, poll ~30s).
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOUR_KST = 15
DEFAULT_MINUTE_KST = 40
DEFAULT_POLL_SECONDS = 30
DEFAULT_CATCHUP_MINUTES = 30
_STARTED = False
_STARTED_LOCK = threading.Lock()


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ETFCHECK_SCHEDULE_KST", "15:40").strip()
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour = int(hour_s)
        minute = int(minute_s)
    except ValueError:
        return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return hour, minute
    return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST


def _poll_seconds() -> int:
    raw = os.environ.get("ETFCHECK_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _catchup_minutes() -> int:
    raw = os.environ.get(
        "ETFCHECK_CATCHUP_MINUTES", str(DEFAULT_CATCHUP_MINUTES)
    ).strip()
    try:
        # Floor at 5 so a brief redeploy after 15:40 can still catch once.
        return max(5, int(raw))
    except ValueError:
        return DEFAULT_CATCHUP_MINUTES


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    """Skip Sat/Sun and KRX full-day holidays."""
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


def _day_already_claimed(last_slot: str | None, day: str) -> bool:
    """True if state already records today's etfcheck (new or legacy HH:MM slot)."""
    if not last_slot:
        return False
    return last_slot == day or str(last_slot).startswith(f"{day}-")


def run_scheduled_etfcheck(token: str, broadcast_fn) -> str:
    """Run once. Returns ``busy`` (retry later), ``done`` (claim day), or ``empty``."""
    from etfcheck import build_etfcheck_brief, format_etfcheck_telegram
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-etfcheck", timeout=180):
        print(
            "Scheduled etfcheck deferred: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return "busy"

    try:
        brief = build_etfcheck_brief(mode="all")
        text = format_etfcheck_telegram(brief)
        if not text.strip():
            print("Scheduled etfcheck empty message — day will still be claimed.")
            return "empty"
        try:
            from etf_memb_publish import publish_etf_memb_from_brief
            from web_publish import publish_brief, section_from_html

            publish_brief(
                "etf",
                "etfcheck",
                title="ETF 시황 /etfcheck",
                generated_at=brief.get("generated_at_display")
                or brief.get("generated_at"),
                sections=section_from_html(text, heading="ETF CHECK"),
                meta={"mode": brief.get("mode")},
            )
            publish_etf_memb_from_brief(brief)
        except Exception as pub_exc:
            print(f"web_publish etfcheck skipped: {pub_exc}")
        delivered = broadcast_fn(
            token,
            [{"text": text, "parse_mode": "HTML"}],
        )
        if not delivered:
            print("Scheduled etfcheck not delivered: 0 chats (day claimed, no re-scrape).")
        else:
            print(f"Scheduled etfcheck sent → {delivered} chat(s).")
        return "done"
    except Exception as exc:
        print(f"Scheduled etfcheck failed: {exc}")
        update_scheduler_state(last_etfcheck_error=str(exc))
        # Claim anyway — avoid scraping 당일 거래대금 TOP repeatedly on hard errors.
        return "done"
    finally:
        end_heavy_work("scheduled-etfcheck")


def start_etfcheck_scheduler(token: str, broadcast_fn) -> None:
    global _STARTED
    if os.environ.get("ETFCHECK_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("etfcheck scheduler disabled.")
        return

    with _STARTED_LOCK:
        if _STARTED:
            print("etfcheck scheduler already started — skip duplicate.")
            return
        _STARTED = True

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = _catchup_minutes()

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_etfcheck_slot")
        print(
            f"etfcheck scheduler active — once/day KRX at {hour:02d}:{minute:02d} KST "
            f"({catchup_minutes}m catch-up; claim day after scrape attempt)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(etfcheck_scheduler_heartbeat=now.isoformat())
                day = now.strftime("%Y-%m-%d")
                if _day_already_claimed(last_slot, day):
                    time.sleep(poll_seconds)
                    continue

                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                    slot_fmt="%Y-%m-%d",
                )
                if slot:
                    if _should_skip_kr_non_trading(now):
                        print(
                            f"Scheduled etfcheck skipped ({slot}): "
                            "weekend or KRX holiday"
                        )
                        last_slot = slot
                        update_scheduler_state(last_etfcheck_slot=slot)
                    else:
                        result = run_scheduled_etfcheck(token, broadcast_fn)
                        if result == "busy":
                            # Stay due inside catch-up; do not claim yet.
                            pass
                        else:
                            last_slot = slot
                            update_scheduler_state(last_etfcheck_slot=slot)
            except Exception as exc:
                print(f"etfcheck scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="etfcheck-scheduler", daemon=True)
    thread.start()

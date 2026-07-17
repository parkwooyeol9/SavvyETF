"""Scheduled /etfcheck broadcast — default 15:40 KST on KRX trading days.

Delivers to the legacy ETF channel (TELEGRAM_CHAT_ID).
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


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ETFCHECK_SCHEDULE_KST", "15:40").strip()
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour = int(hour_s)
        minute = int(minute_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST


def _poll_seconds() -> int:
    raw = os.environ.get("ETFCHECK_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    """Skip Sat/Sun and KRX full-day holidays."""
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


def run_scheduled_etfcheck(token: str, broadcast_fn) -> bool:
    from etfcheck import build_etfcheck_brief, format_etfcheck_telegram
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-etfcheck", timeout=180):
        print(
            "Scheduled etfcheck skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        brief = build_etfcheck_brief(mode="all")
        text = format_etfcheck_telegram(brief)
        if not text.strip():
            print("Scheduled etfcheck skipped: empty message.")
            return False
        delivered = broadcast_fn(
            token,
            [{"text": text, "parse_mode": "HTML"}],
        )
        if not delivered:
            print("Scheduled etfcheck not delivered: 0 chats.")
            return False
        print(f"Scheduled etfcheck sent → {delivered} chat(s).")
        return True
    except Exception as exc:
        print(f"Scheduled etfcheck failed: {exc}")
        update_scheduler_state(last_etfcheck_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-etfcheck")


def start_etfcheck_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("ETFCHECK_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("etfcheck scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 180
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("ETFCHECK_CATCHUP_MINUTES", "180")),
        )
    except ValueError:
        catchup_minutes = 180

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_etfcheck_slot")
        print(
            f"etfcheck scheduler active — KRX days at {hour:02d}:{minute:02d} KST "
            f"({catchup_minutes}m catch-up window)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(etfcheck_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot:
                    if _should_skip_kr_non_trading(now):
                        print(
                            f"Scheduled etfcheck skipped ({slot}): "
                            "weekend or KRX holiday"
                        )
                        last_slot = slot
                        update_scheduler_state(last_etfcheck_slot=slot)
                    elif run_scheduled_etfcheck(token, broadcast_fn):
                        last_slot = slot
                        update_scheduler_state(last_etfcheck_slot=slot)
            except Exception as exc:
                print(f"etfcheck scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="etfcheck-scheduler", daemon=True)
    thread.start()

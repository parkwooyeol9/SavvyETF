"""Scheduled US new-ETF brief — default 07:20 KST on US session days.

Delivers to the legacy ETF channel (TELEGRAM_CHAT_ID) and publishes
``etf`` / ``etf_us_new`` for the web dashboard.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from market_data_freshness import ET, expected_latest_daily_date
from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state
from us_calendar import is_us_equity_trading_day

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOUR_KST = 7
DEFAULT_MINUTE_KST = 20
DEFAULT_POLL_SECONDS = 30


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ETF_US_NEW_SCHEDULE_KST", "7:20").strip()
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
    raw = os.environ.get(
        "ETF_US_NEW_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _max_probes() -> int:
    raw = os.environ.get("ETF_US_NEW_MAX_PROBES", "400").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 400


def _should_skip_us_non_trading(now_kst: datetime) -> bool:
    if now_kst.weekday() >= 5:
        return True
    now_et = datetime.now(ET)
    session = expected_latest_daily_date(now_et)
    if session is None:
        return True
    return not is_us_equity_trading_day(session)


def run_scheduled_etf_us_new(token: str, broadcast_fn) -> bool:
    from etf_us_new import run_etf_us_new
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-etf-us-new", timeout=300):
        print(
            "Scheduled etf_us_new skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        result = run_etf_us_new(max_probes=_max_probes())
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled etf_us_new skipped: empty messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled etf_us_new not delivered: 0 chats.")
            return False
        n = len((result.get("brief") or {}).get("listings") or [])
        print(f"Scheduled etf_us_new sent → {delivered} chat(s), listings={n}.")
        return True
    except Exception as exc:
        print(f"Scheduled etf_us_new failed: {exc}")
        update_scheduler_state(last_etf_us_new_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-etf-us-new")


def start_etf_us_new_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("ETF_US_NEW_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("etf_us_new scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 180
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("ETF_US_NEW_CATCHUP_MINUTES", "180")),
        )
    except ValueError:
        catchup_minutes = 180

    def _loop() -> None:
        print(
            f"etf_us_new scheduler started "
            f"({hour:02d}:{minute:02d} KST, poll {poll_seconds}s, "
            f"US session days)."
        )
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue
                now = datetime.now(KST)
                if _should_skip_us_non_trading(now):
                    time.sleep(poll_seconds)
                    continue
                state = _load_state()
                slot = due_slot_id(
                    now_kst=now,
                    hour=hour,
                    minute=minute,
                    last_slot_id=state.get("last_etf_us_new_slot"),
                    catchup_minutes=catchup_minutes,
                )
                if slot:
                    ok = run_scheduled_etf_us_new(token, broadcast_fn)
                    if ok:
                        update_scheduler_state(last_etf_us_new_slot=slot)
            except Exception as exc:
                print(f"etf_us_new scheduler loop error: {exc}")
            time.sleep(poll_seconds)

    threading.Thread(target=_loop, name="etf-us-new-scheduler", daemon=True).start()

"""Daily FreeSIS / credit monitor — default 09:30 KST on KRX trading days.

Scrapes on Render (KR-friendly egress), writes local + R2 so Vercel can read
credit_monitor/latest.json without hitting FreeSIS from US IPs.
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
DEFAULT_HOUR_KST = 9
DEFAULT_MINUTE_KST = 30
DEFAULT_POLL_SECONDS = 60


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("CREDIT_MONITOR_SCHEDULE_KST", "09:30").strip()
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
        "CREDIT_MONITOR_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


def run_scheduled_credit_monitor() -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status
    from kofia_freesis import collect_and_publish

    if not begin_heavy_work_blocking("scheduled-credit-monitor", timeout=90):
        print(
            "Scheduled credit_monitor skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        result = collect_and_publish(lookback_days=60)
        board = result.get("board") or {}
        print(
            "Scheduled credit_monitor: "
            f"as_of={result.get('as_of')}, "
            f"freesis_fund={result.get('freesis_fund')}, "
            f"r2={result.get('r2')}, "
            f"stress={board.get('stress_label')}"
        )
        if result.get("error"):
            update_scheduler_state(last_credit_monitor_error=str(result["error"]))
        return bool(board.get("fund_series") or board.get("credit_series") or result.get("r2"))
    except Exception as exc:
        print(f"Scheduled credit_monitor failed: {exc}")
        update_scheduler_state(last_credit_monitor_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-credit-monitor")


def start_credit_monitor_scheduler() -> None:
    if os.environ.get("CREDIT_MONITOR_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("credit_monitor scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 180
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("CREDIT_MONITOR_CATCHUP_MINUTES", "180")),
        )
    except ValueError:
        catchup_minutes = 180

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_credit_monitor_slot")
        bootstrapped = False
        print(
            f"credit_monitor scheduler active — KRX days at "
            f"{hour:02d}:{minute:02d} KST (FreeSIS→R2, {catchup_minutes}m catch-up)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                # One bootstrap scrape after grace so Vercel gets data before 09:30.
                if not bootstrapped:
                    bootstrapped = True
                    if not last_slot:
                        print("credit_monitor bootstrap scrape…")
                        if run_scheduled_credit_monitor():
                            now = datetime.now(KST)
                            last_slot = f"bootstrap-{now.strftime('%Y%m%d')}"
                            update_scheduler_state(last_credit_monitor_slot=last_slot)

                now = datetime.now(KST)
                update_scheduler_state(
                    credit_monitor_scheduler_heartbeat=now.isoformat()
                )
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
                            f"Scheduled credit_monitor skipped ({slot}): "
                            "weekend or KRX holiday"
                        )
                        last_slot = slot
                        update_scheduler_state(last_credit_monitor_slot=slot)
                    elif run_scheduled_credit_monitor():
                        last_slot = slot
                        update_scheduler_state(last_credit_monitor_slot=slot)
            except Exception as exc:
                print(f"credit_monitor scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(
        target=loop, name="credit-monitor-scheduler", daemon=True
    )
    thread.start()

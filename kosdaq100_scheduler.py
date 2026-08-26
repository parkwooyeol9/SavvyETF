"""Daily KOSDAQ 100 snapshot + briefing — default 15:50 KST (post close)."""

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
DEFAULT_MINUTE_KST = 50
DEFAULT_POLL_SECONDS = 60


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("KOSDAQ100_SCHEDULE_KST", "15:50").strip()
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
        "KOSDAQ100_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_non_trading(now_kst: datetime) -> bool:
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


def run_scheduled_kosdaq100() -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status
    from kosdaq100_monitor import collect_all

    if not begin_heavy_work_blocking("scheduled-kosdaq100", timeout=600):
        print(
            "Scheduled kosdaq100 skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        result = collect_all(persist=True, with_briefing=True)
        print(
            "Scheduled kosdaq100: "
            f"ok={result.get('ok')} as_of={result.get('as_of')} "
            f"rows={len(result.get('rows') or [])} "
            f"briefing_lines={len(result.get('briefing') or [])}"
        )
        return bool(result.get("ok"))
    except Exception as exc:
        print(f"Scheduled kosdaq100 failed: {exc}")
        update_scheduler_state(last_kosdaq100_error=str(exc))
        return False
    finally:
        end_heavy_work()


def start_kosdaq100_scheduler() -> None:
    if os.environ.get("KOSDAQ100_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("kosdaq100 scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 180
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("KOSDAQ100_CATCHUP_MINUTES", "180")),
        )
    except ValueError:
        catchup_minutes = 180

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_kosdaq100_slot")
        bootstrapped = False
        print(
            f"kosdaq100 scheduler active — daily {hour:02d}:{minute:02d} KST "
            f"({catchup_minutes}m catch-up)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                if _should_skip_non_trading(now):
                    time.sleep(poll_seconds)
                    continue

                if not bootstrapped:
                    bootstrapped = True
                    print("kosdaq100 bootstrap collect (no briefing on boot)…")
                    try:
                        from kosdaq100_monitor import collect_all

                        collect_all(persist=True, with_briefing=False)
                        last_slot = f"bootstrap-{now.strftime('%Y%m%d')}"
                        update_scheduler_state(last_kosdaq100_slot=last_slot)
                    except Exception as exc:
                        print(f"kosdaq100 bootstrap failed: {exc}")

                update_scheduler_state(
                    kosdaq100_scheduler_heartbeat=now.isoformat()
                )
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot and run_scheduled_kosdaq100():
                    last_slot = slot
                    update_scheduler_state(last_kosdaq100_slot=slot)
            except Exception as exc:
                print(f"kosdaq100 scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="kosdaq100-scheduler", daemon=True)
    thread.start()

"""Daily KOSPI 200 panel ingest — default 17:25 KST (after kosdaq100)."""

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
DEFAULT_HOUR_KST = 17
DEFAULT_MINUTE_KST = 25
DEFAULT_POLL_SECONDS = 60


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("KOSPI200_PANEL_SCHEDULE_KST", "17:25").strip()
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
        "KOSPI200_PANEL_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_non_trading(now_kst: datetime) -> bool:
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


def run_scheduled_kospi200_panel(*, backfill: bool = False) -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status
    from kospi200_panel import LOOKBACK_BACKFILL, LOOKBACK_TODAY, collect

    if not begin_heavy_work_blocking("scheduled-kospi200-panel", timeout=900):
        print(
            "Scheduled kospi200 panel skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        result = collect(
            lookback_days=LOOKBACK_BACKFILL if backfill else LOOKBACK_TODAY,
            with_fundamentals=True,
            backfill=backfill,
            force=False,
        )
        print(
            "Scheduled kospi200 panel: "
            f"ok={result.get('ok')} as_of={result.get('as_of')} "
            f"n={result.get('n')} written={result.get('written')} r2={result.get('r2')}"
        )
        return bool(result.get("ok"))
    except Exception as exc:
        print(f"Scheduled kospi200 panel failed: {exc}")
        update_scheduler_state(last_kospi200_panel_error=str(exc))
        return False
    finally:
        end_heavy_work()


def start_kospi200_panel_scheduler() -> None:
    if os.environ.get("KOSPI200_PANEL_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("kospi200 panel scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 45
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("KOSPI200_PANEL_CATCHUP_MINUTES", "45")),
        )
    except ValueError:
        catchup_minutes = 45

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_kospi200_panel_slot")
        bootstrapped = False
        backfilled = bool(state.get("kospi200_panel_backfill_done"))
        backfill_tried = False
        print(
            f"kospi200 panel scheduler active — daily {hour:02d}:{minute:02d} KST "
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
                    print("kospi200 panel bootstrap collect…")
                    try:
                        from kospi200_panel import LOOKBACK_TODAY, collect

                        collect(
                            lookback_days=LOOKBACK_TODAY,
                            with_fundamentals=True,
                            backfill=False,
                            force=False,
                        )
                        last_slot = f"bootstrap-{now.strftime('%Y%m%d')}"
                        update_scheduler_state(last_kospi200_panel_slot=last_slot)
                    except Exception as exc:
                        print(f"kospi200 panel bootstrap failed: {exc}")

                if not backfilled and not backfill_tried:
                    backfill_tried = True
                    print("kospi200 panel history backfill…")
                    if run_scheduled_kospi200_panel(backfill=True):
                        backfilled = True
                        update_scheduler_state(kospi200_panel_backfill_done=True)

                update_scheduler_state(
                    kospi200_panel_scheduler_heartbeat=now.isoformat()
                )
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot and run_scheduled_kospi200_panel(backfill=False):
                    last_slot = slot
                    update_scheduler_state(last_kospi200_panel_slot=slot)
            except Exception as exc:
                print(f"kospi200 panel scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(
        target=loop, name="kospi200-panel-scheduler", daemon=True
    )
    thread.start()

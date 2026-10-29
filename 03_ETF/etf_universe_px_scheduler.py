"""Daily ETF universe return refresh — 20:10 KST, weekdays.

18:20 Korea ETF DB (Naver) has finished, including its 45-minute catch-up.
21:50 US pre-summary has not started. Asia and the US cash close are in;
Europe's session is still open and that day's bar is ignored.

The job itself is mostly Yahoo I/O. It takes the shared heavy-work lock
so it does not run beside the Korea crawl or the evening summary.
"""

from __future__ import annotations

import path_setup  # noqa: F401

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOUR_KST = 20
DEFAULT_MINUTE_KST = 10
DEFAULT_POLL_SECONDS = 60
DEFAULT_CATCHUP_MINUTES = 40
DEFAULT_DEADLINE_SECONDS = 25 * 60
# A failed run used to retry every poll for the whole catch-up window.
# The try key ends in "_slot", so it is mirrored to R2 and survives a restart.
MAX_ATTEMPTS_PER_SLOT = 2


def _attempts_used(slot: str) -> int:
    raw = str(_load_state().get("last_etf_universe_px_try_slot") or "")
    tried_slot, _, count = raw.rpartition("#")
    if tried_slot != slot:
        return 0
    try:
        return int(count)
    except ValueError:
        return 0


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ETF_UNIVERSE_PX_SCHEDULE_KST", "20:10").strip()
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour = int(hour_s)
        minute = int(minute_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST


def _catchup_minutes() -> int:
    try:
        return max(15, min(50, int(os.environ.get("ETF_UNIVERSE_PX_CATCHUP_MINUTES", str(DEFAULT_CATCHUP_MINUTES)))))
    except ValueError:
        return DEFAULT_CATCHUP_MINUTES


def _enabled() -> bool:
    return os.environ.get("ETF_UNIVERSE_PX_SCHEDULE_ENABLED", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def run_scheduled_etf_universe_px() -> bool:
    from etf_universe_px import build_payload, publish
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-etf-universe-px", timeout=120):
        print(f"Scheduled etf_universe_px skipped: heavy work still busy ({heavy_work_status()})")
        update_scheduler_state(last_etf_universe_px_error=f"heavy work busy ({heavy_work_status()})")
        return False
    try:
        update_scheduler_state(last_etf_universe_px_attempt_at=datetime.now(KST).isoformat())
        payload = build_payload(deadline=time.time() + DEFAULT_DEADLINE_SECONDS)
        uploaded = publish(payload)
        print(
            "Scheduled etf_universe_px: "
            f"as_of={payload.get('as_of')} returns={payload.get('n_with_returns')} "
            f"backfill={payload.get('n_backfill')} bump={payload.get('n_bump')} "
            f"uploaded={uploaded}"
        )
        update_scheduler_state(
            last_etf_universe_px_ok_at=datetime.now(KST).isoformat(),
            last_etf_universe_px_as_of=payload.get("as_of"),
            last_etf_universe_px_error="" if uploaded or payload.get("n_with_returns") else "upload failed",
        )
        return bool(payload.get("n_with_returns"))
    except Exception as exc:
        print(f"Scheduled etf_universe_px failed: {exc}")
        update_scheduler_state(last_etf_universe_px_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-etf-universe-px")


def start_etf_universe_px_scheduler() -> None:
    if not _enabled():
        print("etf_universe_px scheduler disabled.")
        return
    hour, minute = _schedule_time_kst()
    catchup = _catchup_minutes()

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_etf_universe_px_slot")
        print(
            f"etf_universe_px scheduler active — weekdays {hour:02d}:{minute:02d} KST "
            f"({catchup}m catch-up)"
        )
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(DEFAULT_POLL_SECONDS)
                    continue
                now = datetime.now(KST)
                update_scheduler_state(etf_universe_px_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(now, hour, minute, last_slot=last_slot, window_minutes=catchup)
                if slot and now.weekday() >= 5:
                    print(f"Scheduled etf_universe_px skipped ({slot}): weekend")
                    last_slot = slot
                    update_scheduler_state(last_etf_universe_px_slot=slot)
                elif slot and _attempts_used(slot) >= MAX_ATTEMPTS_PER_SLOT:
                    print(f"Scheduled etf_universe_px gave up ({slot}): {MAX_ATTEMPTS_PER_SLOT} attempts used")
                    last_slot = slot
                    update_scheduler_state(last_etf_universe_px_slot=slot)
                elif slot:
                    # Count the attempt before running: an out-of-memory restart never reaches the end.
                    update_scheduler_state(last_etf_universe_px_try_slot=f"{slot}#{_attempts_used(slot) + 1}")
                    if run_scheduled_etf_universe_px():
                        last_slot = slot
                        update_scheduler_state(last_etf_universe_px_slot=slot)
            except Exception as exc:
                print(f"etf_universe_px scheduler loop error: {exc}")
            time.sleep(DEFAULT_POLL_SECONDS)

    thread = threading.Thread(target=loop, name="etf-universe-px-scheduler", daemon=True)
    thread.start()

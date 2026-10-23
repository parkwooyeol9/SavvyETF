"""Daily ACWI 종가 갱신 — 06:30 KST.

05:10 AI 시황(캐치업 06:00 종료)과 07:00 미국 시황 사이.
캐치업은 12분으로 짧게 잡아, 06:42 이후에 늦게 깨어난 작업이
07:00 시황과 무거운 작업 잠금을 겹치지 않게 한다.
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
DEFAULT_HOUR_KST = 6
DEFAULT_MINUTE_KST = 30
DEFAULT_POLL_SECONDS = 60
DEFAULT_CATCHUP_MINUTES = 12
DEFAULT_DEADLINE_SECONDS = 15 * 60


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ACWI_PX_SCHEDULE_KST", "6:30").strip()
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
        return max(5, min(20, int(os.environ.get("ACWI_PX_CATCHUP_MINUTES", str(DEFAULT_CATCHUP_MINUTES)))))
    except ValueError:
        return DEFAULT_CATCHUP_MINUTES


def _enabled() -> bool:
    return os.environ.get("ACWI_PX_SCHEDULE_ENABLED", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def run_scheduled_acwi_px() -> bool:
    from acwi_px import build_payload, publish
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-acwi-px", timeout=90):
        print(f"Scheduled acwi_px skipped: heavy work still busy ({heavy_work_status()})")
        update_scheduler_state(last_acwi_px_error=f"heavy work busy ({heavy_work_status()})")
        return False
    try:
        update_scheduler_state(last_acwi_px_attempt_at=datetime.now(KST).isoformat())
        payload = build_payload(deadline=time.time() + DEFAULT_DEADLINE_SECONDS)
        uploaded = publish(payload)
        print(
            "Scheduled acwi_px: "
            f"as_of={payload.get('as_of')} ok={payload.get('n_ok')} "
            f"err={payload.get('n_error')} series={payload.get('n_series')} "
            f"uploaded={uploaded}"
        )
        update_scheduler_state(
            last_acwi_px_ok_at=datetime.now(KST).isoformat(),
            last_acwi_px_as_of=payload.get("as_of"),
            last_acwi_px_error="" if uploaded or payload.get("n_ok") else "upload failed",
        )
        return bool(payload.get("n_ok"))
    except Exception as exc:
        print(f"Scheduled acwi_px failed: {exc}")
        update_scheduler_state(last_acwi_px_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-acwi-px")


def start_acwi_px_scheduler() -> None:
    if not _enabled():
        print("acwi_px scheduler disabled.")
        return
    hour, minute = _schedule_time_kst()
    catchup = _catchup_minutes()

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_acwi_px_slot")
        bootstrapped = False
        print(f"acwi_px scheduler active — daily {hour:02d}:{minute:02d} KST ({catchup}m catch-up)")
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(DEFAULT_POLL_SECONDS)
                    continue
                now = datetime.now(KST)
                update_scheduler_state(acwi_px_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(now, hour, minute, last_slot=last_slot, window_minutes=catchup)
                if not bootstrapped:
                    bootstrapped = True
                    if not slot:
                        print(
                            "acwi_px bootstrap skipped: outside "
                            f"{hour:02d}:{minute:02d} +{catchup}m window"
                        )
                if slot and run_scheduled_acwi_px():
                    last_slot = slot
                    update_scheduler_state(last_acwi_px_slot=slot)
            except Exception as exc:
                print(f"acwi_px scheduler loop error: {exc}")
            time.sleep(DEFAULT_POLL_SECONDS)

    threading.Thread(target=loop, name="acwi-px-scheduler", daemon=True).start()

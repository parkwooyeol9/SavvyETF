"""Scheduled /etf_kor15 — default 09:10 KST daily → legacy ETF channel + web slot."""

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
DEFAULT_MINUTE_KST = 10
DEFAULT_POLL_SECONDS = 30


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ETF_KOR15_SCHEDULE_KST", "9:10").strip()
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
    raw = os.environ.get("ETF_KOR15_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def run_scheduled_etf_kor15(token: str, broadcast_fn) -> bool:
    from etf_kor15 import run_etf_kor15
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-etf-kor15", timeout=240):
        print(
            "Scheduled etf_kor15 skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        result = run_etf_kor15()
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled etf_kor15 skipped: empty messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled etf_kor15 not delivered: 0 chats.")
            return False
        ok_n = (result.get("brief") or {}).get("ok_count")
        print(f"Scheduled etf_kor15 sent → {delivered} chat(s), ok={ok_n}.")
        return True
    except Exception as exc:
        print(f"Scheduled etf_kor15 failed: {exc}")
        update_scheduler_state(last_etf_kor15_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-etf-kor15")


def start_etf_kor15_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("ETF_KOR15_SCHEDULE_ENABLED", "false").lower() in {
        "0",
        "false",
        "no",
    }:
        print("etf_kor15 scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 180
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("ETF_KOR15_CATCHUP_MINUTES", "180")),
        )
    except ValueError:
        catchup_minutes = 180

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_etf_kor15_slot")
        print(
            f"etf_kor15 scheduler active — daily at {hour:02d}:{minute:02d} KST "
            f"({catchup_minutes}m catch-up window)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(etf_kor15_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot:
                    if run_scheduled_etf_kor15(token, broadcast_fn):
                        last_slot = slot
                        update_scheduler_state(last_etf_kor15_slot=slot)
            except Exception as exc:
                print(f"etf_kor15 scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="etf-kor15-scheduler", daemon=True)
    thread.start()

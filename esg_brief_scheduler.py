"""Scheduled ESG·지정학 data briefing → SavvyESG (TELEGRAM_CHAT_ID_ESG).

Default: every day 11:00 KST.
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
DEFAULT_HOUR_KST = 11
DEFAULT_MINUTE_KST = 0
DEFAULT_POLL_SECONDS = 30


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ESG_BRIEF_SCHEDULE_KST", "11:00").strip()
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour, minute = int(hour_s), int(minute_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST


def _poll_seconds() -> int:
    raw = os.environ.get(
        "ESG_BRIEF_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def run_scheduled_esg_brief(token: str, broadcast_fn) -> bool:
    from esg_brief_builder import generate_esg_geo_briefing
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-esg-brief", timeout=240):
        print(
            "Scheduled esg brief skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        result = generate_esg_geo_briefing(publish=True)
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled esg brief skipped: empty messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled esg brief not delivered: 0 chats.")
            return False
        print(f"Scheduled esg brief sent → {delivered} chat(s).")
        return True
    except Exception as exc:
        print(f"Scheduled esg brief failed: {exc}")
        update_scheduler_state(last_esg_brief_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-esg-brief")


def start_esg_brief_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("ESG_BRIEF_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("esg brief scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 120
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("ESG_BRIEF_CATCHUP_MINUTES", "120")),
        )
    except ValueError:
        catchup_minutes = 120

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_esg_brief_slot")
        print(
            f"esg brief scheduler active — daily {hour:02d}:{minute:02d} KST "
            f"→ TELEGRAM_CHAT_ID_ESG ({catchup_minutes}m catch-up)"
        )
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue
                now = datetime.now(KST)
                update_scheduler_state(esg_brief_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot:
                    if run_scheduled_esg_brief(token, broadcast_fn):
                        last_slot = slot
                        update_scheduler_state(last_esg_brief_slot=slot)
            except Exception as exc:
                print(f"esg brief scheduler loop error: {exc}")
            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="esg-brief-scheduler", daemon=True)
    thread.start()

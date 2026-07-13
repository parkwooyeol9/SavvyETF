"""Scheduled /summary_kor (EOD) broadcast — default 15:40 KST weekdays."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, _save_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOUR_KST = 15
DEFAULT_MINUTE_KST = 40
DEFAULT_POLL_SECONDS = 30


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("SUMMARY_KOR_SCHEDULE_KST", "15:40").strip()
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
    raw = os.environ.get("SUMMARY_KOR_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    return now_kst.weekday() >= 5


def run_scheduled_summary_kor(token: str, broadcast_fn, public_url: str = "") -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status
    from summary_kor_builder import generate_summary_kor

    if not begin_heavy_work_blocking("scheduled-summary-kor", timeout=180):
        print(
            "Scheduled summary_kor skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        # Force refresh so post-close 15:40 brief uses the finished session bar.
        summary = generate_summary_kor(public_url=public_url, force_refresh=True)
        messages = summary.get("telegram_messages") or []
        if not messages:
            print("Scheduled summary_kor skipped: no telegram messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled summary_kor not delivered: 0 chats.")
            return False
        print(
            f"Scheduled summary_kor sent ({len(messages)} message(s) "
            f"→ {delivered} chat(s))."
        )
        return True
    except Exception as exc:
        print(f"Scheduled summary_kor failed: {exc}")
        return False
    finally:
        end_heavy_work("scheduled-summary-kor")


def start_summary_kor_scheduler(token: str, broadcast_fn, public_url: str = "") -> None:
    if os.environ.get("SUMMARY_KOR_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("summary_kor scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_summary_kor_slot")
        print(
            f"summary_kor scheduler active — weekdays at {hour:02d}:{minute:02d} KST "
            "(15m catch-up window)"
        )

        while True:
            if not past_startup_grace():
                time.sleep(poll_seconds)
                continue

            now = datetime.now(KST)
            slot = due_slot_id(now, hour, minute, last_slot=last_slot)
            if slot:
                if _should_skip_kr_non_trading(now):
                    print(f"Scheduled summary_kor skipped ({slot}): weekend")
                    last_slot = slot
                    state["last_summary_kor_slot"] = slot
                    _save_state(state)
                elif run_scheduled_summary_kor(
                    token, broadcast_fn, public_url=public_url
                ):
                    last_slot = slot
                    state["last_summary_kor_slot"] = slot
                    _save_state(state)

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="summary-kor-scheduler", daemon=True)
    thread.start()

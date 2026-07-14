"""Scheduled /summary_nxt broadcast — default 20:10 KST weekdays.

Nextrade sessions (KST):
  Premarket  08:00–08:50
  Main       09:00:30–15:20
  After      15:40–20:00

20:10 captures full-day totals after aftermarket close, without colliding
with /summary_kor at 15:40.
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
DEFAULT_HOUR_KST = 20
DEFAULT_MINUTE_KST = 10
DEFAULT_POLL_SECONDS = 30


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("SUMMARY_NXT_SCHEDULE_KST", "20:10").strip()
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
        "SUMMARY_NXT_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    return now_kst.weekday() >= 5


def run_scheduled_summary_nxt(token: str, broadcast_fn, public_url: str = "") -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status
    from summary_nxt_builder import generate_summary_nxt

    if not begin_heavy_work_blocking("scheduled-summary-nxt", timeout=240):
        print(
            "Scheduled summary_nxt skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        summary = generate_summary_nxt(public_url=public_url)
        messages = summary.get("telegram_messages") or []
        if not messages:
            print("Scheduled summary_nxt skipped: no telegram messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled summary_nxt not delivered: 0 chats.")
            return False
        print(
            f"Scheduled summary_nxt sent ({len(messages)} message(s) "
            f"→ {delivered} chat(s))."
        )
        return True
    except Exception as exc:
        print(f"Scheduled summary_nxt failed: {exc}")
        return False
    finally:
        end_heavy_work("scheduled-summary-nxt")


def start_summary_nxt_scheduler(token: str, broadcast_fn, public_url: str = "") -> None:
    if os.environ.get("SUMMARY_NXT_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("summary_nxt scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_summary_nxt_slot")
        print(
            f"summary_nxt scheduler active — weekdays at {hour:02d}:{minute:02d} KST "
            "(15m catch-up · after NXT aftermarket 20:00)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(summary_nxt_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(now, hour, minute, last_slot=last_slot)
                if slot:
                    if _should_skip_kr_non_trading(now):
                        print(f"Scheduled summary_nxt skipped ({slot}): weekend")
                        last_slot = slot
                        update_scheduler_state(last_summary_nxt_slot=slot)
                    elif run_scheduled_summary_nxt(
                        token, broadcast_fn, public_url=public_url
                    ):
                        last_slot = slot
                        update_scheduler_state(last_summary_nxt_slot=slot)
            except Exception as exc:
                print(f"summary_nxt scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="summary-nxt-scheduler", daemon=True)
    thread.start()

"""Daily /macro broadcast scheduler."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from summary_scheduler import _load_state, _save_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOUR_KST = 17
DEFAULT_POLL_SECONDS = 60


def _macro_schedule_hour() -> int:
    raw = os.environ.get("MACRO_SCHEDULE_HOUR_KST", str(DEFAULT_HOUR_KST)).strip()
    try:
        hour = int(raw)
    except ValueError:
        return DEFAULT_HOUR_KST
    return max(0, min(23, hour))


def _poll_seconds() -> int:
    raw = os.environ.get("MACRO_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def run_scheduled_macro(token: str, broadcast_fn, force: bool = True) -> bool:
    from heavy_work import end_heavy_work, try_begin_heavy_work
    from macro_pipeline import run_macro_dashboard

    if not try_begin_heavy_work("scheduled-macro"):
        print("Scheduled macro skipped: another heavy task is running.")
        return False

    try:
        result = run_macro_dashboard(force=force)
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled macro skipped: no telegram messages.")
            return False
        broadcast_fn(token, messages)
        print(f"Scheduled macro dashboard sent ({len(messages)} message(s)).")
        return True
    except Exception as exc:
        print(f"Scheduled macro dashboard failed: {exc}")
        return False
    finally:
        end_heavy_work("scheduled-macro")


def start_macro_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("MACRO_SCHEDULE_ENABLED", "true").lower() in {"0", "false", "no"}:
        print("Macro scheduler disabled.")
        return

    hour = _macro_schedule_hour()
    poll_seconds = _poll_seconds()

    def loop() -> None:
        state = _load_state()
        last_macro_slot = state.get("last_macro_slot")
        print(f"Macro scheduler active — daily at {hour:02d}:00 KST")

        while True:
            if not past_startup_grace():
                time.sleep(poll_seconds)
                continue

            now = datetime.now(KST)
            if now.hour == hour and now.minute == 0:
                slot = now.strftime("%Y-%m-%d-%H")
                if slot != last_macro_slot:
                    if run_scheduled_macro(token, broadcast_fn, force=True):
                        last_macro_slot = slot
                        state["last_macro_slot"] = slot
                        _save_state(state)

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="macro-scheduler", daemon=True)
    thread.start()

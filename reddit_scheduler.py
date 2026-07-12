"""Scheduled /reddit (WSB) broadcasts at configured KST hours."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from summary_scheduler import _load_state, _save_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOURS_KST = (17, 19, 21)
DEFAULT_POLL_SECONDS = 60


def _reddit_schedule_hours() -> list[int]:
    raw = os.environ.get("REDDIT_SCHEDULE_HOURS_KST", "17,19,21").strip()
    hours: list[int] = []
    for part in raw.replace(" ", "").split(","):
        if not part:
            continue
        try:
            hour = int(part)
        except ValueError:
            continue
        if 0 <= hour <= 23 and hour not in hours:
            hours.append(hour)
    return hours or list(DEFAULT_HOURS_KST)


def _poll_seconds() -> int:
    raw = os.environ.get("REDDIT_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def run_scheduled_reddit(token: str, broadcast_fn) -> bool:
    from heavy_work import end_heavy_work, try_begin_heavy_work
    from reddit_wsb import format_reddit_telegram, generate_reddit_brief

    if not try_begin_heavy_work("scheduled-reddit"):
        print("Scheduled reddit skipped: another heavy task is running.")
        return False

    try:
        brief = generate_reddit_brief()
        messages = format_reddit_telegram(brief)
        if not messages:
            print("Scheduled reddit skipped: no telegram messages.")
            return False
        broadcast_fn(token, messages)
        print(f"Scheduled reddit brief sent ({len(messages)} message(s)).")
        return True
    except Exception as exc:
        print(f"Scheduled reddit brief failed: {exc}")
        return False
    finally:
        end_heavy_work("scheduled-reddit")


def start_reddit_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("REDDIT_SCHEDULE_ENABLED", "true").lower() in {"0", "false", "no"}:
        print("Reddit scheduler disabled.")
        return

    hours = _reddit_schedule_hours()
    poll_seconds = _poll_seconds()
    hours_label = ", ".join(f"{h:02d}:00" for h in hours)

    def loop() -> None:
        state = _load_state()
        last_reddit_slot = state.get("last_reddit_slot")
        print(f"Reddit scheduler active — daily at {hours_label} KST")

        while True:
            if not past_startup_grace():
                time.sleep(poll_seconds)
                continue

            now = datetime.now(KST)
            if now.hour in hours and now.minute == 0:
                slot = now.strftime("%Y-%m-%d-%H")
                if slot != last_reddit_slot:
                    if run_scheduled_reddit(token, broadcast_fn):
                        last_reddit_slot = slot
                        state["last_reddit_slot"] = slot
                        _save_state(state)

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="reddit-scheduler", daemon=True)
    thread.start()

"""Scheduled /reddit (WSB) broadcasts at configured KST hours."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_hourly_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOURS_KST = (21,)
DEFAULT_POLL_SECONDS = 30


def _reddit_schedule_hours() -> list[int]:
    raw = os.environ.get("REDDIT_SCHEDULE_HOURS_KST", "21").strip()
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
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status
    from reddit_builder import generate_and_save_reddit_brief
    from summary_builder import resolve_summary_public_url

    if not begin_heavy_work_blocking("scheduled-reddit", timeout=120):
        print(
            "Scheduled reddit skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        brief = generate_and_save_reddit_brief(public_url=resolve_summary_public_url())
        messages = brief.get("telegram_messages") or []
        if not messages:
            print("Scheduled reddit skipped: no telegram messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled reddit not delivered: 0 chats.")
            return False
        print(
            f"Scheduled reddit brief sent ({len(messages)} message(s) "
            f"→ {delivered} chat(s))."
        )
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
    catchup_minutes = 120
    try:
        catchup_minutes = max(
            15,
            int(os.environ.get("REDDIT_CATCHUP_MINUTES", "120")),
        )
    except ValueError:
        catchup_minutes = 120

    def loop() -> None:
        state = _load_state()
        last_reddit_slot = state.get("last_reddit_slot")
        print(
            f"Reddit scheduler active — daily at {hours_label} KST "
            f"({catchup_minutes}m catch-up window)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(reddit_scheduler_heartbeat=now.isoformat())
                slot = due_hourly_slot_id(
                    now,
                    hours,
                    last_slot=last_reddit_slot,
                    window_minutes=catchup_minutes,
                )
                if slot and run_scheduled_reddit(token, broadcast_fn):
                    last_reddit_slot = slot
                    update_scheduler_state(last_reddit_slot=slot)
            except Exception as exc:
                print(f"Reddit scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="reddit-scheduler", daemon=True)
    thread.start()

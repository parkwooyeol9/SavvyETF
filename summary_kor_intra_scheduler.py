"""Scheduled /summary_kor_intra broadcasts at 11:00 and 15:00 KST."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from summary_scheduler import _load_state, _save_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOURS_KST = (11, 15)
DEFAULT_POLL_SECONDS = 60


def _schedule_hours() -> list[int]:
    raw = os.environ.get("SUMMARY_KOR_INTRA_SCHEDULE_HOURS_KST", "11,15").strip()
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
    raw = os.environ.get(
        "SUMMARY_KOR_INTRA_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    """Skip Sat/Sun KST (KRX closed)."""
    return now_kst.weekday() >= 5


def run_scheduled_summary_kor_intra(token: str, broadcast_fn, public_url: str = "") -> bool:
    from heavy_work import end_heavy_work, try_begin_heavy_work
    from summary_kor_builder import generate_summary_kor_intra

    if not try_begin_heavy_work("scheduled-summary-kor-intra"):
        print("Scheduled summary_kor_intra skipped: another heavy task is running.")
        return False

    try:
        summary = generate_summary_kor_intra(public_url=public_url)
        messages = summary.get("telegram_messages") or []
        if not messages:
            print("Scheduled summary_kor_intra skipped: no telegram messages.")
            return False
        broadcast_fn(token, messages)
        print(f"Scheduled summary_kor_intra sent ({len(messages)} message(s)).")
        return True
    except Exception as exc:
        print(f"Scheduled summary_kor_intra failed: {exc}")
        return False
    finally:
        end_heavy_work("scheduled-summary-kor-intra")


def start_summary_kor_intra_scheduler(token: str, broadcast_fn, public_url: str = "") -> None:
    if os.environ.get("SUMMARY_KOR_INTRA_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("summary_kor_intra scheduler disabled.")
        return

    hours = _schedule_hours()
    poll_seconds = _poll_seconds()
    hours_label = ", ".join(f"{h:02d}:00" for h in hours)

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_summary_kor_intra_slot")
        print(f"summary_kor_intra scheduler active — weekdays at {hours_label} KST")

        while True:
            if not past_startup_grace():
                time.sleep(poll_seconds)
                continue

            now = datetime.now(KST)
            if now.hour in hours and now.minute == 0:
                slot = now.strftime("%Y-%m-%d-%H")
                if slot != last_slot:
                    if _should_skip_kr_non_trading(now):
                        print(f"Scheduled summary_kor_intra skipped ({slot}): weekend")
                        last_slot = slot
                        state["last_summary_kor_intra_slot"] = slot
                        _save_state(state)
                    elif run_scheduled_summary_kor_intra(
                        token, broadcast_fn, public_url=public_url
                    ):
                        last_slot = slot
                        state["last_summary_kor_intra_slot"] = slot
                        _save_state(state)

            time.sleep(poll_seconds)

    thread = threading.Thread(
        target=loop, name="summary-kor-intra-scheduler", daemon=True
    )
    thread.start()

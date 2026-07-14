"""Scheduled /summary_nxt broadcasts — default 08:30, 16:30, 17:30 KST weekdays.

Nextrade sessions (KST):
  Premarket  08:00–08:50   → 08:30 mid-premarket pulse
  Main       09:00:30–15:20
  After      15:40–20:00   → 16:30 / 17:30 after-main pulses
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
DEFAULT_TIMES = ((8, 30), (16, 30), (17, 30))
DEFAULT_POLL_SECONDS = 30


def _parse_hhmm(part: str) -> tuple[int, int] | None:
    text = part.strip()
    if not text:
        return None
    try:
        if ":" in text:
            hour_s, minute_s = text.split(":", 1)
            hour, minute = int(hour_s), int(minute_s)
        else:
            hour, minute = int(text), 0
    except ValueError:
        return None
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return hour, minute
    return None


def _schedule_times_kst() -> tuple[tuple[int, int], ...]:
    """Parse SUMMARY_NXT_SCHEDULE_KST as '8:30,16:30,17:30' (or legacy single time)."""
    raw = os.environ.get("SUMMARY_NXT_SCHEDULE_KST", "8:30,16:30,17:30").strip()
    if not raw:
        return DEFAULT_TIMES
    times: list[tuple[int, int]] = []
    for part in raw.split(","):
        parsed = _parse_hhmm(part)
        if parsed and parsed not in times:
            times.append(parsed)
    return tuple(times) or DEFAULT_TIMES


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


def run_scheduled_summary_nxt(
    token: str,
    broadcast_fn,
    public_url: str = "",
    *,
    trigger: str = "scheduled",
) -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status
    from summary_nxt_builder import generate_summary_nxt

    if not begin_heavy_work_blocking("scheduled-summary-nxt", timeout=240):
        print(
            f"Scheduled summary_nxt skipped ({trigger}): heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        summary = generate_summary_nxt(public_url=public_url)
        messages = summary.get("telegram_messages") or []
        if not messages:
            print(f"Scheduled summary_nxt skipped ({trigger}): no telegram messages.")
            return False
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print(f"Scheduled summary_nxt not delivered ({trigger}): 0 chats.")
            return False
        print(
            f"Scheduled summary_nxt sent ({trigger}, {len(messages)} message(s) "
            f"→ {delivered} chat(s))."
        )
        return True
    except Exception as exc:
        print(f"Scheduled summary_nxt failed ({trigger}): {exc}")
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

    times = _schedule_times_kst()
    poll_seconds = _poll_seconds()
    labels = ", ".join(f"{h:02d}:{m:02d}" for h, m in times)

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_summary_nxt_slot")
        print(
            f"summary_nxt scheduler active — weekdays at {labels} KST "
            "(15m catch-up · NXT pre/after pulses)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(summary_nxt_scheduler_heartbeat=now.isoformat())
                for hour, minute in times:
                    slot = due_slot_id(now, hour, minute, last_slot=last_slot)
                    if not slot:
                        continue
                    if _should_skip_kr_non_trading(now):
                        print(f"Scheduled summary_nxt skipped ({slot}): weekend")
                        last_slot = slot
                        update_scheduler_state(last_summary_nxt_slot=slot)
                    elif run_scheduled_summary_nxt(
                        token,
                        broadcast_fn,
                        public_url=public_url,
                        trigger=slot,
                    ):
                        last_slot = slot
                        update_scheduler_state(last_summary_nxt_slot=slot)
            except Exception as exc:
                print(f"summary_nxt scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="summary-nxt-scheduler", daemon=True)
    thread.start()

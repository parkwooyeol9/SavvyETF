"""Scheduled /summary_kor (EOD) broadcast — default 15:40 KST weekdays."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import (
    claim_scheduler_slot,
    complete_scheduler_slot,
    hydrate_durable_slot,
    release_scheduler_slot,
    update_scheduler_state,
)

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
    """Skip Sat/Sun and KRX full-day holidays (e.g. 제헌절)."""
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


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
    catchup_minutes = 45
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("SUMMARY_KOR_CATCHUP_MINUTES", "45")),
        )
    except ValueError:
        catchup_minutes = 45

    def loop() -> None:
        last_slot = hydrate_durable_slot("last_summary_kor_slot")
        print(
            f"summary_kor scheduler active — weekdays at {hour:02d}:{minute:02d} KST "
            f"({catchup_minutes}m catch-up; durable R2 slot so redeploy does not resend)"
        )

        while True:
            slot = None
            acquired = False
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(summary_kor_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot:
                    status = claim_scheduler_slot("last_summary_kor_slot", slot)
                    if status == "done":
                        last_slot = slot
                    elif status == "busy":
                        print(
                            f"Scheduled summary_kor waiting ({slot}): "
                            "another instance already claimed"
                        )
                    else:
                        acquired = True
                        if _should_skip_kr_non_trading(now):
                            print(
                                f"Scheduled summary_kor skipped ({slot}): "
                                "weekend or KRX holiday"
                            )
                            complete_scheduler_slot("last_summary_kor_slot", slot)
                            last_slot = slot
                            acquired = False
                        elif run_scheduled_summary_kor(
                            token, broadcast_fn, public_url=public_url
                        ):
                            complete_scheduler_slot("last_summary_kor_slot", slot)
                            last_slot = slot
                            acquired = False
                        else:
                            release_scheduler_slot("last_summary_kor_slot", slot)
                            acquired = False
            except Exception as exc:
                print(f"summary_kor scheduler loop error: {exc}")
                if acquired and slot:
                    try:
                        release_scheduler_slot("last_summary_kor_slot", slot)
                    except Exception:
                        pass

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="summary-kor-scheduler", daemon=True)
    thread.start()

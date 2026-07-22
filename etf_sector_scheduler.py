"""Scheduled /etf_sector broadcast — default 07:00 KST on US session days.

Delivers to the legacy ETF channel (TELEGRAM_CHAT_ID).
Skips weekends and when the covered US equity session is a holiday.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from market_data_freshness import ET, expected_latest_daily_date
from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state
from us_calendar import is_us_equity_trading_day

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOUR_KST = 7
DEFAULT_MINUTE_KST = 0
DEFAULT_POLL_SECONDS = 30


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ETF_SECTOR_SCHEDULE_KST", "7:00").strip()
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
        "ETF_SECTOR_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_us_non_trading(now_kst: datetime) -> bool:
    """Skip Sat/Sun (KST) and non-trading US sessions (same logic as /summary)."""
    if now_kst.weekday() >= 5:
        return True
    now_et = datetime.now(ET)
    session = expected_latest_daily_date(now_et)
    if session is None:
        return True
    return not is_us_equity_trading_day(session)


def run_scheduled_etf_sector(token: str, broadcast_fn) -> bool:
    from etf_sector import (
        build_etf_sector_board,
        format_etf_sector_telegram,
        plot_etf_sector_board,
    )
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-etf-sector", timeout=180):
        print(
            "Scheduled etf_sector skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        board = build_etf_sector_board()
        chart = plot_etf_sector_board(board)
        text = format_etf_sector_telegram(board)
        messages = [
            {
                "text": text,
                "parse_mode": "HTML",
                "photo": chart,
            }
        ]
        try:
            from web_publish import chart_to_image_payload, publish_brief, section_from_html

            publish_brief(
                "etf",
                "etf_sector",
                title="ETF 시황 /etf_sector",
                generated_at=board.get("generated_at_kst")
                or board.get("generated_at_et"),
                sections=section_from_html(text, heading="Sector rotation"),
                images=[
                    chart_to_image_payload(
                        chart,
                        id="sector_rotation",
                        caption=f"ETF Sector Rotation · {board.get('session_as_of', '')}",
                    )
                ],
                meta={"session_as_of": board.get("session_as_of")},
            )
        except Exception as pub_exc:
            print(f"web_publish etf_sector skipped: {pub_exc}")
        delivered = broadcast_fn(token, messages)
        if not delivered:
            print("Scheduled etf_sector not delivered: 0 chats.")
            return False
        print(f"Scheduled etf_sector sent → {delivered} chat(s).")
        return True
    except Exception as exc:
        print(f"Scheduled etf_sector failed: {exc}")
        update_scheduler_state(last_etf_sector_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-etf-sector")


def start_etf_sector_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("ETF_SECTOR_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("etf_sector scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 120
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("ETF_SECTOR_CATCHUP_MINUTES", "120")),
        )
    except ValueError:
        catchup_minutes = 120

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_etf_sector_slot")
        print(
            f"etf_sector scheduler active — US session days at "
            f"{hour:02d}:{minute:02d} KST ({catchup_minutes}m catch-up window)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(etf_sector_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot:
                    if _should_skip_us_non_trading(now):
                        print(
                            f"Scheduled etf_sector skipped ({slot}): "
                            "weekend or US holiday session"
                        )
                        last_slot = slot
                        update_scheduler_state(last_etf_sector_slot=slot)
                    elif run_scheduled_etf_sector(token, broadcast_fn):
                        last_slot = slot
                        update_scheduler_state(last_etf_sector_slot=slot)
            except Exception as exc:
                print(f"etf_sector scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="etf-sector-scheduler", daemon=True)
    thread.start()

"""Daily Korean ETF DB snapshot — default 16:05 KST on KRX trading days.

Persists Naver universe + classification so NAV×Δ설정좌수 flows accumulate.
Does not broadcast to Telegram (web /etfdb + manual /etfdb only).
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
DEFAULT_HOUR_KST = 16
DEFAULT_MINUTE_KST = 5
DEFAULT_POLL_SECONDS = 60


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ETFDB_SCHEDULE_KST", "16:05").strip()
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
    raw = os.environ.get("ETFDB_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


def run_scheduled_etf_db() -> bool:
    from etf_db import build_etf_db
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-etfdb", timeout=120):
        print(
            "Scheduled etfdb skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        payload = build_etf_db(force_fetch=True)
        print(
            f"Scheduled etfdb snapshot: {payload.get('count')} ETFs, "
            f"AUM {payload.get('total_aum_eok'):,.0f}억, "
            f"flow_pairs={payload.get('flow_pair_count')}"
        )
        return True
    except Exception as exc:
        print(f"Scheduled etfdb failed: {exc}")
        update_scheduler_state(last_etfdb_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-etfdb")


def start_etf_db_scheduler() -> None:
    if os.environ.get("ETFDB_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("etfdb scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 180
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("ETFDB_CATCHUP_MINUTES", "180")),
        )
    except ValueError:
        catchup_minutes = 180

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_etfdb_slot")
        print(
            f"etfdb scheduler active — KRX days at {hour:02d}:{minute:02d} KST "
            f"(snapshot only, {catchup_minutes}m catch-up)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(etfdb_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot:
                    if _should_skip_kr_non_trading(now):
                        print(
                            f"Scheduled etfdb skipped ({slot}): "
                            "weekend or KRX holiday"
                        )
                        last_slot = slot
                        update_scheduler_state(last_etfdb_slot=slot)
                    elif run_scheduled_etf_db():
                        last_slot = slot
                        update_scheduler_state(last_etfdb_slot=slot)
            except Exception as exc:
                print(f"etfdb scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="etfdb-scheduler", daemon=True)
    thread.start()

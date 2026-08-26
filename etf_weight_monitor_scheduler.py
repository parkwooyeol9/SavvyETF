"""Daily ETF weight monitor — Roundhill all + iShares top-15 AUM.

Default 07:30 KST, 60-minute catch-up. Collects only inside that window so a
late redeploy cannot hold the heavy-work lock through 09:00 ESG Telegram.
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
DEFAULT_HOUR_KST = 7
DEFAULT_MINUTE_KST = 30
DEFAULT_POLL_SECONDS = 60


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("ETF_WEIGHT_SCHEDULE_KST", "07:30").strip()
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
        "ETF_WEIGHT_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)
    ).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _ishares_top_n() -> int:
    raw = os.environ.get("ETF_WEIGHT_ISHARES_TOP_N", "15").strip()
    try:
        return max(1, min(30, int(raw)))
    except ValueError:
        return 15


def run_scheduled_etf_weight_monitor(*, backfill_roundhill_days: int = 0) -> bool:
    from etf_weight_monitor import collect_all
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    if not begin_heavy_work_blocking("scheduled-etf-weight", timeout=300):
        print(
            "Scheduled etf_weight skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False
    try:
        result = collect_all(
            backfill_roundhill_days=backfill_roundhill_days,
            ishares_top_n=_ishares_top_n(),
        )
        rh = result.get("roundhill") or {}
        ish = result.get("ishares") or {}
        print(
            "Scheduled etf_weight: "
            f"ok={result.get('ok')} universe={result.get('universe_count')} "
            f"roundhill_saved={len(rh.get('saved') or rh.get('saved_tickers') or [])} "
            f"ishares_saved={len(ish.get('saved') or [])} "
            f"ishares_errors={len(ish.get('errors') or [])}"
        )
        if ish.get("errors"):
            update_scheduler_state(
                last_etf_weight_error="; ".join(ish["errors"][:3])
            )
        return bool(result.get("ok"))
    except Exception as exc:
        print(f"Scheduled etf_weight failed: {exc}")
        update_scheduler_state(last_etf_weight_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-etf-weight")


def start_etf_weight_monitor_scheduler() -> None:
    if os.environ.get("ETF_WEIGHT_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("etf_weight scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 60
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("ETF_WEIGHT_CATCHUP_MINUTES", "60")),
        )
    except ValueError:
        catchup_minutes = 60

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_etf_weight_slot")
        bootstrapped = False
        print(
            f"etf_weight scheduler active — daily {hour:02d}:{minute:02d} KST "
            f"Roundhill=ALL iShares=top{_ishares_top_n()} "
            f"({catchup_minutes}m catch-up)"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(
                    etf_weight_scheduler_heartbeat=now.isoformat()
                )
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )

                # One collect per morning slot. Do not bootstrap outside the
                # catch-up window — a late Render redeploy would hold the
                # heavy-work lock through 09:00 ESG Telegram.
                if not bootstrapped:
                    bootstrapped = True
                    if slot:
                        print(
                            "etf_weight in-window collect_all "
                            "(+14d Roundhill backfill, counts as today's slot)…"
                        )
                        if run_scheduled_etf_weight_monitor(
                            backfill_roundhill_days=14
                        ):
                            last_slot = slot
                            update_scheduler_state(last_etf_weight_slot=slot)
                        continue
                    print(
                        "etf_weight bootstrap skipped: outside "
                        f"{hour:02d}:{minute:02d} +{catchup_minutes}m window "
                        "(avoids blocking later Telegram jobs)."
                    )

                if slot and run_scheduled_etf_weight_monitor(backfill_roundhill_days=0):
                    last_slot = slot
                    update_scheduler_state(last_etf_weight_slot=slot)
            except Exception as exc:
                print(f"etf_weight scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(
        target=loop, name="etf-weight-scheduler", daemon=True
    )
    thread.start()

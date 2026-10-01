"""Daily ETF 리밸런싱 (정기변경 예상 수급) refresh — default 18:10 KST on KRX trading days.

Collects holdings · AUM · 20-day traded value (``Claude_Work.rebalance.fetch``),
rebuilds the schedule/flow JSON and publishes R2 ``rebalance/latest.json``
(+ ``rebalance/snapshots/{date}.json``) for the webapp '리밸런싱' tab.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
R2_KEY = "rebalance/latest.json"
DEFAULT_HOUR_KST = 18
DEFAULT_MINUTE_KST = 10
DEFAULT_POLL_SECONDS = 60
BOOTSTRAP_RETRY_SECONDS = 600
BOOTSTRAP_MAX_ATTEMPTS = 6


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("REBALANCE_SCHEDULE_KST", "18:10").strip()
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour = int(hour_s)
        minute = int(minute_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST


def _is_trading_day(d: date) -> bool:
    from kr_calendar import is_kr_equity_trading_day

    return is_kr_equity_trading_day(d)


def _expected_as_of(now: datetime, hour: int, minute: int) -> str:
    """Latest date a fresh publish should carry: today after the slot, else the prior trading day."""
    d = now.date()
    if not (_is_trading_day(d) and (now.hour, now.minute) >= (hour, minute)):
        d -= timedelta(days=1)
        while not _is_trading_day(d):
            d -= timedelta(days=1)
    return d.isoformat()


def _published_as_of() -> str | None:
    try:
        from r2_data import get_json

        doc = get_json(R2_KEY)
    except Exception as exc:
        print(f"rebalance: R2 latest read failed: {exc}")
        return None
    return str(doc.get("as_of") or "") if isinstance(doc, dict) else None


def run_scheduled_rebalance() -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    update_scheduler_state(last_rebalance_attempt_at=datetime.now(KST).isoformat())
    if not begin_heavy_work_blocking("scheduled-rebalance", timeout=300):
        print(f"Scheduled rebalance skipped: heavy work still busy ({heavy_work_status()})")
        update_scheduler_state(last_rebalance_error=f"heavy work busy ({heavy_work_status()})")
        return False
    try:
        from Claude_Work.rebalance import build, fetch
        from r2_data import put_json_daily

        fetch.main([])
        result = build.build(datetime.now(KST).date())
        build.write(result)
        ok = put_json_daily(R2_KEY, result, day=result["as_of"])
        computed = len({f["etf_code"] for f in result["flows"]})
        print(
            f"Scheduled rebalance: as_of={result['as_of']} computed_etfs={computed} "
            f"events={len(result['events'])} r2={'ok' if ok else 'skipped'}"
        )
        if ok:
            update_scheduler_state(
                last_rebalance_ok_at=datetime.now(KST).isoformat(),
                last_rebalance_as_of=result["as_of"],
                last_rebalance_error=None,
            )
        else:
            update_scheduler_state(last_rebalance_error="R2 not configured or upload failed")
        return ok
    except Exception as exc:
        print(f"Scheduled rebalance failed: {exc}")
        update_scheduler_state(last_rebalance_error=str(exc))
        return False
    finally:
        end_heavy_work()


def start_rebalance_scheduler() -> None:
    if os.environ.get("REBALANCE_SCHEDULE_ENABLED", "true").lower() in {"0", "false", "no", "off"}:
        print("rebalance scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    try:
        catchup_minutes = max(30, int(os.environ.get("REBALANCE_CATCHUP_MINUTES", "90")))
    except ValueError:
        catchup_minutes = 90

    def loop() -> None:
        last_slot = _load_state().get("last_rebalance_slot")
        bootstrap_attempts = 0
        bootstrap_done = False
        next_bootstrap_at = 0.0
        print(f"rebalance scheduler active — trading days {hour:02d}:{minute:02d} KST ({catchup_minutes}m catch-up)")

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(DEFAULT_POLL_SECONDS)
                    continue

                now = datetime.now(KST)
                if not bootstrap_done and time.monotonic() >= next_bootstrap_at:
                    published = _published_as_of()
                    expected = _expected_as_of(now, hour, minute)
                    if published and published >= expected:
                        bootstrap_done = True
                    else:
                        bootstrap_attempts += 1
                        print(f"rebalance bootstrap #{bootstrap_attempts}: R2 as_of={published} < {expected}")
                        ok = run_scheduled_rebalance()
                        bootstrap_done = ok or bootstrap_attempts >= BOOTSTRAP_MAX_ATTEMPTS
                        next_bootstrap_at = time.monotonic() + BOOTSTRAP_RETRY_SECONDS

                update_scheduler_state(rebalance_scheduler_heartbeat=now.isoformat())
                slot = None
                if _is_trading_day(now.date()):
                    slot = due_slot_id(now, hour, minute, last_slot=last_slot, window_minutes=catchup_minutes)
                if slot and run_scheduled_rebalance():
                    last_slot = slot
                    update_scheduler_state(last_rebalance_slot=slot)
            except Exception as exc:
                print(f"rebalance scheduler loop error: {exc}")

            time.sleep(DEFAULT_POLL_SECONDS)

    threading.Thread(target=loop, name="rebalance-scheduler", daemon=True).start()

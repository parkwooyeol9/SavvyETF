"""Scheduled lev-ETF snapshot — default 16:00 KST on KRX trading days.

Calls Vercel POST /api/lev-etf/snapshot (Bearer WEB_INGEST_SECRET) so the
webapp scrapes Naver once and writes latest + daily trader archives to R2.
No Telegram broadcast — silent DB ingest for the dashboard.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_HOUR_KST = 16
DEFAULT_MINUTE_KST = 0
DEFAULT_POLL_SECONDS = 30


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("LEV_ETF_SCHEDULE_KST", "16:00").strip()
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
    raw = os.environ.get("LEV_ETF_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _should_skip_kr_non_trading(now_kst: datetime) -> bool:
    from kr_calendar import is_kr_equity_trading_day

    return not is_kr_equity_trading_day(now_kst.date())


def _snapshot_url() -> str:
    base = (
        os.environ.get("LEV_ETF_SNAPSHOT_URL")
        or os.environ.get("WEBAPP_PUBLIC_URL")
        or ""
    ).strip().rstrip("/")
    if not base:
        publish = (os.environ.get("WEB_PUBLISH_URL") or "").strip()
        if publish.endswith("/api/ingest"):
            base = publish[: -len("/api/ingest")]
        elif publish:
            base = publish.rstrip("/")
    if not base:
        return ""
    return f"{base}/api/lev-etf/snapshot"


def run_scheduled_lev_etf_snapshot() -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    url = _snapshot_url()
    secret = (os.environ.get("WEB_INGEST_SECRET") or "").strip()
    if not url or not secret:
        print(
            "Scheduled lev-etf snapshot skipped: "
            "WEBAPP_PUBLIC_URL (or LEV_ETF_SNAPSHOT_URL) / WEB_INGEST_SECRET unset"
        )
        return False

    if not begin_heavy_work_blocking("scheduled-lev-etf-snapshot", timeout=240):
        print(
            "Scheduled lev-etf snapshot skipped: heavy work still busy "
            f"({heavy_work_status()})"
        )
        return False

    try:
        as_of = datetime.now(KST).date().isoformat()
        body = json.dumps({"as_of": as_of}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
                "User-Agent": "SavvyETF-lev-etf-scheduler/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode("utf-8", "replace")
            status = getattr(resp, "status", 200)
        payload = json.loads(raw) if raw else {}
        if status >= 400 or not payload.get("ok"):
            err = payload.get("error") or f"HTTP {status}"
            print(f"Scheduled lev-etf snapshot failed: {err}")
            update_scheduler_state(last_lev_etf_error=str(err))
            return False
        print(
            "Scheduled lev-etf snapshot ok — "
            f"as_of={payload.get('as_of')} items={payload.get('items')} "
            f"keys={payload.get('keys')}"
        )
        update_scheduler_state(
            last_lev_etf_as_of=payload.get("as_of"),
            last_lev_etf_error="",
        )
        return True
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        print(f"Scheduled lev-etf snapshot HTTP {exc.code}: {detail or exc}")
        update_scheduler_state(last_lev_etf_error=f"HTTP {exc.code}")
        return False
    except Exception as exc:
        print(f"Scheduled lev-etf snapshot failed: {exc}")
        update_scheduler_state(last_lev_etf_error=str(exc))
        return False
    finally:
        end_heavy_work("scheduled-lev-etf-snapshot")


def start_lev_etf_scheduler() -> None:
    if os.environ.get("LEV_ETF_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
    }:
        print("lev-etf scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    poll_seconds = _poll_seconds()
    catchup_minutes = 180
    try:
        catchup_minutes = max(
            30,
            int(os.environ.get("LEV_ETF_CATCHUP_MINUTES", "180")),
        )
    except ValueError:
        catchup_minutes = 180

    def loop() -> None:
        state = _load_state()
        last_slot = state.get("last_lev_etf_slot")
        print(
            f"lev-etf scheduler active — KRX days at {hour:02d}:{minute:02d} KST "
            f"({catchup_minutes}m catch-up window) → {_snapshot_url() or '(url unset)'}"
        )

        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue

                now = datetime.now(KST)
                update_scheduler_state(lev_etf_scheduler_heartbeat=now.isoformat())
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
                            f"Scheduled lev-etf snapshot skipped ({slot}): "
                            "weekend or KRX holiday"
                        )
                        last_slot = slot
                        update_scheduler_state(last_lev_etf_slot=slot)
                    elif run_scheduled_lev_etf_snapshot():
                        last_slot = slot
                        update_scheduler_state(last_lev_etf_slot=slot)
            except Exception as exc:
                print(f"lev-etf scheduler loop error: {exc}")

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="lev-etf-scheduler", daemon=True)
    thread.start()

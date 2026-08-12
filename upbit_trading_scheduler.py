"""업비트엔진 — poll R2 signals and run Upbit executor."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from summary_scheduler import update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_POLL_SECONDS = 300


def _poll_seconds() -> int:
    raw = os.environ.get(
        "UPBIT_TRADING_POLL_SECONDS",
        os.environ.get("CRYPTO_TRADING_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)),
    ).strip()
    try:
        return max(60, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def run_scheduled_upbit_executor() -> bool:
    from upbit_executor import run_upbit_executor

    try:
        result = run_upbit_executor()
        mode = result.get("mode")
        actions = result.get("actions") or []
        skipped = result.get("skipped") or []
        placed = [a for a in actions if a.get("status") == "placed"]
        dry = [a for a in actions if a.get("status") == "dry_run"]
        print(
            "upbit engine: "
            f"mode={mode}, actions={len(actions)}, placed={len(placed)}, "
            f"dry={len(dry)}, skipped={skipped}"
        )
        if result.get("error"):
            update_scheduler_state(last_upbit_executor_error=str(result["error"]))
        return bool(result.get("ok"))
    except Exception as exc:
        print(f"upbit engine failed: {exc}")
        update_scheduler_state(last_upbit_executor_error=str(exc))
        return False


def start_upbit_trading_scheduler() -> None:
    if os.environ.get("UPBIT_TRADING_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("upbit trading scheduler disabled.")
        return

    poll_seconds = _poll_seconds()

    def loop() -> None:
        print(
            f"upbit engine scheduler — poll every {poll_seconds}s "
            f"(UPBIT_LIVE={os.environ.get('UPBIT_LIVE', 'false')}, "
            f"KILL={os.environ.get('UPBIT_KILL_SWITCH', 'false')})"
        )
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue
                now = datetime.now(KST)
                update_scheduler_state(upbit_trading_heartbeat=now.isoformat())
                run_scheduled_upbit_executor()
            except Exception as exc:
                print(f"upbit scheduler loop error: {exc}")
            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="upbit-trading-scheduler", daemon=True)
    thread.start()


def start_crypto_trading_scheduler() -> None:
    """Legacy alias."""
    start_upbit_trading_scheduler()

"""Poll R2 crypto signals and run Upbit executor (dry-run unless UPBIT_LIVE=true)."""

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
    raw = os.environ.get("CRYPTO_TRADING_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(60, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def run_scheduled_crypto_executor() -> bool:
    from upbit_executor import run_crypto_executor

    try:
        result = run_crypto_executor()
        mode = result.get("mode")
        actions = result.get("actions") or []
        skipped = result.get("skipped") or []
        placed = [a for a in actions if a.get("status") == "placed"]
        dry = [a for a in actions if a.get("status") == "dry_run"]
        print(
            "crypto executor: "
            f"mode={mode}, actions={len(actions)}, placed={len(placed)}, "
            f"dry={len(dry)}, skipped={skipped}"
        )
        if result.get("error"):
            update_scheduler_state(last_crypto_executor_error=str(result["error"]))
        return bool(result.get("ok"))
    except Exception as exc:
        print(f"crypto executor failed: {exc}")
        update_scheduler_state(last_crypto_executor_error=str(exc))
        return False


def start_crypto_trading_scheduler() -> None:
    if os.environ.get("CRYPTO_TRADING_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("crypto trading scheduler disabled.")
        return

    poll_seconds = _poll_seconds()

    def loop() -> None:
        print(
            f"crypto trading scheduler active — poll every {poll_seconds}s "
            f"(UPBIT_LIVE={os.environ.get('UPBIT_LIVE', 'false')}, "
            f"KILL={os.environ.get('UPBIT_KILL_SWITCH', 'false')})"
        )
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue
                now = datetime.now(KST)
                update_scheduler_state(crypto_trading_heartbeat=now.isoformat())
                run_scheduled_crypto_executor()
            except Exception as exc:
                print(f"crypto trading scheduler loop error: {exc}")
            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="crypto-trading-scheduler", daemon=True)
    thread.start()

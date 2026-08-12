"""천만원 챌린지 — unified scheduler for 업비트엔진 + 바이낸스엔진 + 김프차익."""

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
    raw = os.environ.get("CHALLENGE_TRADING_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(60, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def run_challenge_cycle() -> dict[str, object]:
    from binance_executor import run_binance_executor
    from kimchi_arb_executor import run_kimchi_arb_coordinator
    from upbit_executor import run_upbit_executor

    results: dict[str, object] = {}
    try:
        results["upbit"] = run_upbit_executor()
    except Exception as exc:
        results["upbit"] = {"ok": False, "error": str(exc)}
    try:
        results["binance"] = run_binance_executor()
    except Exception as exc:
        results["binance"] = {"ok": False, "error": str(exc)}
    try:
        results["kimchi_arb"] = run_kimchi_arb_coordinator()
    except Exception as exc:
        results["kimchi_arb"] = {"ok": False, "error": str(exc)}
    return results


def start_challenge_trading_scheduler() -> None:
    if os.environ.get("CHALLENGE_TRADING_SCHEDULE_ENABLED", "true").lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        print("challenge trading scheduler disabled.")
        return

    poll_seconds = _poll_seconds()

    def loop() -> None:
        print(
            f"천만원 챌린지 scheduler — poll every {poll_seconds}s "
            f"(UPBIT_LIVE={os.environ.get('UPBIT_LIVE', 'false')}, "
            f"BINANCE_LIVE={os.environ.get('BINANCE_LIVE', 'false')}, "
            f"KIMCHI_ARB_LIVE={os.environ.get('KIMCHI_ARB_LIVE', 'false')})"
        )
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(poll_seconds)
                    continue
                now = datetime.now(KST)
                update_scheduler_state(challenge_trading_heartbeat=now.isoformat())
                results = run_challenge_cycle()
                print(f"challenge cycle: {results}")
            except Exception as exc:
                print(f"challenge scheduler loop error: {exc}")
            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="challenge-trading-scheduler", daemon=True)
    thread.start()


def start_crypto_trading_scheduler() -> None:
    """Legacy alias — runs full challenge cycle."""
    start_challenge_trading_scheduler()

"""Daily ETF CHECK turnover capture scheduler."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from etfcheck_freshness import (
    earliest_capture_time_kst,
    expected_krx_session_date,
    is_after_krx_close,
    post_close_buffer_minutes,
    post_close_max_wait_minutes,
)
from etfcheck_pipeline import run_etfcheck_turnover_capture
from summary_scheduler import _load_state, _save_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_POLL_SECONDS = 60


def _poll_seconds() -> int:
    raw = os.environ.get("ETFCHECK_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(20, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def run_scheduled_etfcheck_turnover(token: str, broadcast_fn) -> bool:
    try:
        result = run_etfcheck_turnover_capture()
        messages = result.get("telegram_messages") or []
        if not messages:
            print("Scheduled ETF CHECK turnover skipped: no messages.")
            return False
        broadcast_fn(token, messages)
        print(f"Scheduled ETF CHECK turnover sent ({len(messages)} message(s)).")
        return True
    except Exception as exc:
        print(f"Scheduled ETF CHECK turnover failed: {exc}")
        return False


def start_etfcheck_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("ETFCHECK_SCHEDULE_ENABLED", "true").lower() in {"0", "false", "no"}:
        print("ETF CHECK scheduler disabled.")
        return

    poll_seconds = _poll_seconds()
    buffer_minutes = post_close_buffer_minutes()
    max_wait_minutes = post_close_max_wait_minutes()
    session_date = expected_krx_session_date()
    approx_earliest = (
        earliest_capture_time_kst(session_date, buffer_minutes).strftime("%H:%M KST")
        if session_date
        else "n/a"
    )

    def loop() -> None:
        state = _load_state()
        last_session = state.get("last_etfcheck_turnover_session")
        stable_hits = 0
        last_fingerprint: str | None = None

        print(
            "ETF CHECK scheduler active — post-close turnover capture after KRX close "
            f"(15:30 KST + {buffer_minutes}m buffer ≈ {approx_earliest}, "
            f"stable polls, max wait {max_wait_minutes}m)"
        )

        while True:
            now = datetime.now(KST)
            if not is_after_krx_close(now):
                stable_hits = 0
                last_fingerprint = None
                time.sleep(poll_seconds)
                continue

            session_date = expected_krx_session_date(now)
            if session_date is None:
                time.sleep(poll_seconds)
                continue

            session_key = session_date.isoformat()
            if last_session == session_key:
                time.sleep(poll_seconds)
                continue

            from etfcheck_freshness import is_etfcheck_turnover_ready

            ready, detail, fingerprint, stable_hits = is_etfcheck_turnover_ready(
                now,
                stable_hits=stable_hits,
                last_fingerprint=last_fingerprint,
            )
            last_fingerprint = fingerprint

            if not ready:
                if "waiting" in detail or "stable" in detail or "snapshot" in detail:
                    print(f"ETF CHECK turnover: {detail}")
                time.sleep(poll_seconds)
                continue

            print(f"ETF CHECK turnover ready: {detail}")
            if run_scheduled_etfcheck_turnover(token, broadcast_fn):
                last_session = session_key
                state["last_etfcheck_turnover_session"] = session_key
                _save_state(state)
                stable_hits = 0
                last_fingerprint = None

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="etfcheck-scheduler", daemon=True)
    thread.start()

"""Daily ETF CHECK turnover capture scheduler."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from etfcheck_freshness import (
    capture_window_minutes,
    expected_krx_session_date,
    is_after_krx_close,
    is_capture_window_passed,
    is_etfcheck_turnover_ready,
    scheduled_capture_time,
)
from scheduler_grace import past_startup_grace
from summary_scheduler import _load_state, _save_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_POLL_SECONDS = 60


def _poll_seconds() -> int:
    raw = os.environ.get("ETFCHECK_SCHEDULE_POLL_SECONDS", str(DEFAULT_POLL_SECONDS)).strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return DEFAULT_POLL_SECONDS


def _mark_session_done(state: dict, session_key: str) -> None:
    state["last_etfcheck_turnover_session"] = session_key
    _save_state(state)


def run_scheduled_etfcheck_turnover(
    token: str,
    broadcast_fn,
    *,
    lock_held: bool = False,
) -> bool:
    from etfcheck_pipeline import run_etfcheck_turnover_capture
    from etfcheck_subprocess import begin_etfcheck_capture_blocking, end_etfcheck_capture

    if not lock_held and not begin_etfcheck_capture_blocking():
        print("Scheduled ETF CHECK turnover skipped: another heavy task is running.")
        return False

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
    finally:
        if not lock_held:
            end_etfcheck_capture()


def start_etfcheck_scheduler(token: str, broadcast_fn) -> None:
    if os.environ.get("ETFCHECK_SCHEDULE_ENABLED", "true").lower() in {"0", "false", "no"}:
        print("ETF CHECK scheduler disabled (manual /etfcheck only).")
        return

    poll_seconds = _poll_seconds()
    capture_at = scheduled_capture_time().strftime("%H:%M KST")
    window_min = capture_window_minutes()

    def loop() -> None:
        state = _load_state()
        last_session = state.get("last_etfcheck_turnover_session")

        print(
            f"ETF CHECK scheduler active — once daily at {capture_at} "
            f"(+{window_min}m window, weekdays only; no retries)"
        )

        while True:
            if not past_startup_grace():
                time.sleep(poll_seconds)
                continue

            now = datetime.now(KST)
            if now.weekday() >= 5:
                time.sleep(poll_seconds)
                continue

            if not is_after_krx_close(now):
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

            ready, detail = is_etfcheck_turnover_ready(now)
            if not ready:
                if is_capture_window_passed(now, session_date):
                    print(f"ETF CHECK turnover skipped for {session_key}: {detail}")
                    last_session = session_key
                    _mark_session_done(state, session_key)
                time.sleep(poll_seconds)
                continue

            # Claim the session only once we have the heavy-work lock (at most one run per day).
            from etfcheck_subprocess import begin_etfcheck_capture_blocking, end_etfcheck_capture

            if not begin_etfcheck_capture_blocking():
                print("ETF CHECK turnover waiting: another heavy task is running.")
                time.sleep(poll_seconds)
                continue

            print(f"ETF CHECK turnover (once daily): {detail}")
            last_session = session_key
            _mark_session_done(state, session_key)
            try:
                run_scheduled_etfcheck_turnover(token, broadcast_fn, lock_held=True)
            finally:
                end_etfcheck_capture()

            time.sleep(poll_seconds)

    thread = threading.Thread(target=loop, name="etfcheck-scheduler", daemon=True)
    thread.start()

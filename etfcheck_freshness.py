"""Detect when ETF CHECK daily turnover capture should run (time-based, no browser)."""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
KRX_CLOSE_TIME = time(15, 30)
DEFAULT_CAPTURE_TIME = time(15, 45)


def scheduled_capture_time() -> time:
    raw = os.environ.get("ETFCHECK_SCHEDULE_TIME_KST", "15:45").strip()
    for fmt in ("%H:%M", "%H"):
        try:
            parsed = datetime.strptime(raw, fmt).time()
            return parsed
        except ValueError:
            continue
    return DEFAULT_CAPTURE_TIME


def _previous_weekday(d: date) -> date:
    prev = d - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


def expected_krx_session_date(now_kst: datetime | None = None) -> date | None:
    now_kst = now_kst or datetime.now(KST)
    today = now_kst.date()
    if today.weekday() >= 5:
        return _previous_weekday(today)
    close_dt = datetime.combine(today, KRX_CLOSE_TIME, tzinfo=KST)
    if now_kst < close_dt:
        return _previous_weekday(today)
    return today


def is_after_krx_close(now_kst: datetime | None = None) -> bool:
    now_kst = now_kst or datetime.now(KST)
    today = now_kst.date()
    if today.weekday() >= 5:
        return True
    close_dt = datetime.combine(today, KRX_CLOSE_TIME, tzinfo=KST)
    return now_kst >= close_dt


def scheduled_capture_datetime(session_date: date) -> datetime:
    return datetime.combine(session_date, scheduled_capture_time(), tzinfo=KST)


def capture_window_minutes() -> int:
    raw = os.environ.get("ETFCHECK_CAPTURE_WINDOW_MINUTES", "5").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 10


def capture_window_end(session_date: date) -> datetime:
    return scheduled_capture_datetime(session_date) + timedelta(
        minutes=capture_window_minutes()
    )


def is_in_capture_window(now_kst: datetime, session_date: date) -> bool:
    start = scheduled_capture_datetime(session_date)
    return start <= now_kst < capture_window_end(session_date)


def is_capture_window_passed(now_kst: datetime, session_date: date) -> bool:
    return now_kst >= capture_window_end(session_date)


def is_etfcheck_turnover_ready(now_kst: datetime | None = None) -> tuple[bool, str]:
    """
    Time-based readiness only (no Playwright polling).

    KRX closes 15:30 KST. ETF CHECK 당일 거래대금 is typically reliable after ~15:40;
    default capture fires at 15:45 KST (ETFCHECK_SCHEDULE_TIME_KST).
    """
    now_kst = now_kst or datetime.now(KST)
    if not is_after_krx_close(now_kst):
        return False, "before KRX close (15:30 KST)"

    session_date = expected_krx_session_date(now_kst)
    if session_date is None:
        return False, "no expected KRX session date"

    target = scheduled_capture_datetime(session_date)
    window_end = capture_window_end(session_date)
    if now_kst < target:
        return False, f"waiting until {target.strftime('%H:%M KST')} (ETF CHECK turnover capture)"

    if not is_in_capture_window(now_kst, session_date):
        return (
            False,
            f"capture window closed ({target.strftime('%H:%M')}-"
            f"{window_end.strftime('%H:%M')} KST; no catch-up on restart)",
        )

    return True, (
        f"in capture window ({target.strftime('%H:%M')}-{window_end.strftime('%H:%M')} KST)"
    )

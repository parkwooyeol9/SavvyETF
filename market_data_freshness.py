"""Detect when Yahoo Finance has posted the latest US regular-session daily bar."""

from __future__ import annotations

import os
import sys
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import yfinance as yf

ET = ZoneInfo("America/New_York")
MARKET_CLOSE_TIME = time(16, 0)
DEFAULT_REFERENCE_TICKER = "SPY"


@contextmanager
def _quiet_yfinance():
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        old_stderr = sys.stderr
        sys.stderr = devnull
        try:
            yield
        finally:
            sys.stderr = old_stderr


def reference_ticker() -> str:
    return os.environ.get("SUMMARY_REFERENCE_TICKER", DEFAULT_REFERENCE_TICKER).strip().upper()


def data_ready_buffer_minutes() -> int:
    raw = os.environ.get("SUMMARY_DATA_READY_BUFFER_MINUTES", "5").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 5


def _previous_trading_day(d: date) -> date:
    prev = d - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


def expected_latest_daily_date(now_et: datetime | None = None) -> date | None:
    """
    Return the latest US regular-session date that should appear in YF daily data.

    - Before 16:00 ET on a weekday: previous trading day
    - After 16:00 ET on a weekday: that day
    - Weekends: Friday
    """
    now_et = now_et or datetime.now(ET)
    today = now_et.date()

    if today.weekday() == 5:
        return today - timedelta(days=1)
    if today.weekday() == 6:
        return today - timedelta(days=2)

    close_dt = datetime.combine(today, MARKET_CLOSE_TIME, tzinfo=ET)
    if now_et < close_dt:
        return _previous_trading_day(today)
    return today


def is_after_us_market_close(now_et: datetime | None = None) -> bool:
    now_et = now_et or datetime.now(ET)
    today = now_et.date()

    if today.weekday() >= 5:
        return True

    close_dt = datetime.combine(today, MARKET_CLOSE_TIME, tzinfo=ET)
    return now_et >= close_dt


def latest_yf_daily_bar(ticker: str | None = None) -> tuple[date | None, float | None]:
    symbol = ticker or reference_ticker()
    with _quiet_yfinance():
        try:
            df = yf.Ticker(symbol).history(period="10d", interval="1d", auto_adjust=True)
        except Exception:
            return None, None

    if df is None or df.empty:
        return None, None

    row = df.iloc[-1]
    bar_date = df.index[-1].date()
    volume = float(row.get("Volume", 0) or 0)
    return bar_date, volume


def is_yf_daily_data_ready(now_et: datetime | None = None) -> tuple[bool, str]:
    """
    True when YF's latest daily bar matches the session we expect after US close.
    """
    if not is_after_us_market_close(now_et):
        return False, "before US market close"

    expected = expected_latest_daily_date(now_et)
    if expected is None:
        return False, "no expected session date"

    latest_date, latest_volume = latest_yf_daily_bar()
    if latest_date is None:
        return False, f"no {reference_ticker()} daily data from Yahoo Finance"

    if latest_date < expected:
        return (
            False,
            f"waiting for {expected.isoformat()} bar (latest: {latest_date.isoformat()})",
        )

    if latest_volume is not None and latest_volume <= 0:
        return False, f"latest bar volume is zero ({latest_date.isoformat()})"

    return True, f"latest bar {latest_date.isoformat()} ready (expected {expected.isoformat()})"


def post_close_send_time_kst(session_date: date, buffer_minutes: int | None = None) -> datetime:
    """Approximate earliest KST send time if YF updates immediately at close."""
    buffer = data_ready_buffer_minutes() if buffer_minutes is None else buffer_minutes
    close_et = datetime.combine(session_date, MARKET_CLOSE_TIME, tzinfo=ET)
    return (close_et + timedelta(minutes=buffer)).astimezone(ZoneInfo("Asia/Seoul"))

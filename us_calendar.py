"""US equity trading calendar helpers (weekends + common NYSE holidays)."""

from __future__ import annotations

from datetime import date, timedelta

# Jul–Dec 2026 full closes (for reference; computed via nyse_holidays()):
#   2026-07-03 Independence Day (observed)
#   2026-09-07 Labor Day
#   2026-11-26 Thanksgiving
#   2026-12-25 Christmas
# Early closes (market still trades — schedules still run):
#   2026-11-27 day after Thanksgiving 1pm ET
#   2026-12-24 Christmas Eve 1pm ET


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """Return the n-th weekday in month (weekday: Mon=0 … Sun=6)."""
    d = date(year, month, 1)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d + timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    if month == 12:
        d = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        d = date(year, month + 1, 1) - timedelta(days=1)
    while d.weekday() != weekday:
        d -= timedelta(days=1)
    return d


def _observed(d: date) -> date:
    """NYSE weekend observance: Sat→Fri, Sun→Mon."""
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def nyse_holidays(year: int) -> set[date]:
    """Approximate NYSE full-day holidays for scheduling (not settlement quirks)."""
    holidays = {
        _observed(date(year, 1, 1)),  # New Year's Day
        _nth_weekday(year, 1, 0, 3),  # MLK Day
        _nth_weekday(year, 2, 0, 3),  # Presidents' Day
        _last_weekday(year, 5, 0),  # Memorial Day
        _observed(date(year, 6, 19)),  # Juneteenth
        _observed(date(year, 7, 4)),  # Independence Day
        _nth_weekday(year, 9, 0, 1),  # Labor Day
        _nth_weekday(year, 11, 3, 4),  # Thanksgiving
        _observed(date(year, 12, 25)),  # Christmas
    }
    # Good Friday (Friday before Easter) — Anonymous Gregorian algorithm
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    el = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * el) // 451
    month = (h + el - 7 * m + 114) // 31
    day = ((h + el - 7 * m + 114) % 31) + 1
    easter = date(year, month, day)
    holidays.add(easter - timedelta(days=2))
    return holidays


def is_us_equity_trading_day(d: date | None = None) -> bool:
    """True on weekdays that are not NYSE full-day holidays."""
    d = d or date.today()
    if d.weekday() >= 5:
        return False
    return d not in nyse_holidays(d.year)

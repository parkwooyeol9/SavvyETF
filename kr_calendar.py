"""Korea equity trading calendar helpers (weekends + KRX/NXT full-day holidays).

Holiday dates for lunar festivals and substitute days are listed explicitly by year.
Update ``_KRX_FULL_CLOSE_BY_YEAR`` when the exchange publishes the next annual calendar.
"""

from __future__ import annotations

from datetime import date

# Full-day KRX (and Nextrade) closures — weekdays only need listing; weekends are
# already non-trading. Sources: KRX annual calendar / government 월력요항.
_KRX_FULL_CLOSE_BY_YEAR: dict[int, set[date]] = {
    2026: {
        date(2026, 1, 1),  # 신정
        date(2026, 2, 16),  # 설날
        date(2026, 2, 17),  # 설날
        date(2026, 2, 18),  # 설날
        date(2026, 3, 2),  # 삼일절 대체공휴일
        date(2026, 5, 1),  # 근로자의 날
        date(2026, 5, 5),  # 어린이날
        date(2026, 5, 25),  # 부처님오신날 대체공휴일
        date(2026, 6, 3),  # 전국동시지방선거
        date(2026, 7, 17),  # 제헌절
        date(2026, 8, 17),  # 광복절 대체공휴일
        date(2026, 9, 24),  # 추석
        date(2026, 9, 25),  # 추석
        date(2026, 10, 5),  # 개천절 대체공휴일
        date(2026, 10, 9),  # 한글날
        date(2026, 12, 25),  # 성탄절
        date(2026, 12, 31),  # 연말 휴장
    },
}

# Human-readable labels for Jul–Dec 2026 (docs / health).
KRX_HOLIDAY_LABELS_2026_H2: dict[date, str] = {
    date(2026, 7, 17): "제헌절",
    date(2026, 8, 17): "광복절 대체공휴일",
    date(2026, 9, 24): "추석",
    date(2026, 9, 25): "추석",
    date(2026, 10, 5): "개천절 대체공휴일",
    date(2026, 10, 9): "한글날",
    date(2026, 12, 25): "성탄절",
    date(2026, 12, 31): "연말 휴장",
}


def krx_holidays(year: int) -> set[date]:
    """Return known KRX full-day holiday dates for ``year`` (may be empty if unset)."""
    return set(_KRX_FULL_CLOSE_BY_YEAR.get(year, ()))


def is_kr_equity_trading_day(d: date | None = None) -> bool:
    """True on weekdays that are not KRX/Nextrade full-day holidays."""
    d = d or date.today()
    if d.weekday() >= 5:
        return False
    return d not in krx_holidays(d.year)


def kr_holiday_name(d: date | None = None) -> str | None:
    """Short Korean label when ``d`` is a known KRX holiday, else None."""
    d = d or date.today()
    if d.year == 2026 and d in KRX_HOLIDAY_LABELS_2026_H2:
        return KRX_HOLIDAY_LABELS_2026_H2[d]
    if d in krx_holidays(d.year):
        return "KRX holiday"
    return None

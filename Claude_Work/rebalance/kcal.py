"""KRX 거래일·파생 만기일·ETF 정기변경일 계산.

휴장일은 저장소 루트의 ``kr_calendar.py`` (봇과 같은 목록)를 우선 쓰고,
``Claude_Work/data/holidays.json`` 에 적힌 날짜를 더한다. 두 곳 모두에 없는
해(예: 2027년)는 주말만 빠지므로, 새해 KRX 휴장일이 공표되면 갱신한다.

정기변경 규칙 코드
-----------------------------------------------------------------
D    선물·옵션 만기일 당일 변경
D+1  만기일 익영업일 변경
D+2  만기일 다음 주 첫 영업일 변경
S    해당 월 첫 영업일 변경
E    해당 월 마지막 영업일 변경

실제 매매(리밸런싱)는 변경일 직전 영업일 종가에 일어난다고 본다.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

RULE_LABELS = {
    "D": "만기일 당일",
    "D+1": "만기 익영업일",
    "D+2": "만기 다음 주 첫 영업일",
    "S": "해당 월 첫 영업일",
    "E": "해당 월 마지막 영업일",
}


@lru_cache(maxsize=1)
def _extra_holidays() -> frozenset[date]:
    path = DATA_DIR / "holidays.json"
    if not path.exists():
        return frozenset()
    raw = json.loads(path.read_text(encoding="utf-8"))
    out = set()
    for item in raw.get("holidays", []):
        out.add(date.fromisoformat(item["date"]))
    return frozenset(out)


def _repo_holidays(year: int) -> set[date]:
    try:
        from kr_calendar import krx_holidays  # 저장소 루트 모듈 (봇과 공유)
    except Exception:  # Claude_Work 단독 실행 시
        return set()
    return set(krx_holidays(year))


@lru_cache(maxsize=16)
def holidays(year: int) -> frozenset[date]:
    extra = {d for d in _extra_holidays() if d.year == year}
    return frozenset(_repo_holidays(year) | extra)


def has_holiday_list(year: int) -> bool:
    """해당 연도 휴장일 목록이 하나라도 등록돼 있는지."""
    return bool(holidays(year))


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in holidays(d.year)


def next_trading_day(d: date) -> date:
    d += timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def prev_trading_day(d: date) -> date:
    d -= timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def expiry_date(year: int, month: int) -> date:
    """KOSPI200 선물·옵션 최종거래일: 둘째 목요일, 휴장이면 앞당김."""
    first = date(year, month, 1)
    offset = (3 - first.weekday()) % 7  # 목요일 = 3
    d = first + timedelta(days=offset + 7)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def first_trading_day(year: int, month: int) -> date:
    d = date(year, month, 1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def last_trading_day(year: int, month: int) -> date:
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    d = nxt - timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def effective_date(rule: str, year: int, month: int) -> date:
    """정기변경 효력일 (새 구성이 적용되는 첫날)."""
    if rule == "S":
        return first_trading_day(year, month)
    if rule == "E":
        return last_trading_day(year, month)
    exp = expiry_date(year, month)
    if rule == "D":
        return exp
    if rule == "D+1":
        return next_trading_day(exp)
    if rule == "D+2":
        monday = exp + timedelta(days=7 - exp.weekday())
        d = monday
        while not is_trading_day(d):
            d += timedelta(days=1)
        return d
    raise ValueError(f"알 수 없는 정기변경 규칙: {rule}")


def trade_date(rule: str, year: int, month: int) -> date:
    """리밸런싱 매매일: 효력일 직전 영업일 (종가 기준)."""
    return prev_trading_day(effective_date(rule, year, month))


def months_ahead(start: date, count: int) -> list[tuple[int, int]]:
    """start 가 속한 달부터 count 개월 (year, month) 목록."""
    out = []
    y, m = start.year, start.month
    for _ in range(count):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out

"""네이버 fchart 일봉 (종가·거래량). 지수는 ``KOSPI`` / ``KOSDAQ`` 심볼.

가격은 수정주가가 아니다. 분할·병합이 낀 구간은 수익률이 튈 수 있다.
"""

from __future__ import annotations

import re
import time
from datetime import date

import pandas as pd

URL = "https://fchart.stock.naver.com/siseJson.naver"
ROW = re.compile(r'\[\s*"(\d{8})"\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)')


def parse(text: str) -> pd.DataFrame:
    rows = [(pd.Timestamp(m.group(1)), float(m.group(5)), float(m.group(6))) for m in ROW.finditer(text)]
    df = pd.DataFrame(rows, columns=["date", "close", "volume"])
    return df.set_index("date").sort_index()


def daily_bars(symbol: str, start: date | str, end: date | str) -> pd.DataFrame:
    import requests

    s, e = (pd.Timestamp(x).strftime("%Y%m%d") for x in (start, end))
    r = requests.get(URL, params={"symbol": symbol, "requestType": 1, "startTime": s,
                                  "endTime": e, "timeframe": "day"},
                     headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    r.raise_for_status()
    return parse(r.content.decode("utf-8", errors="replace"))


def many(symbols: list[str], start: date | str, end: date | str, pause: float = 0.1) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    for sym in symbols:
        try:
            df = daily_bars(sym, start, end)
        except Exception as exc:  # noqa: BLE001 - 종목 하나 실패는 건너뛴다
            print(f"  [{sym}] 네이버 일봉 실패: {exc}")
            continue
        if not df.empty:
            out[sym] = df
        time.sleep(pause)
    return out

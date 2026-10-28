"""Daily ETF close returns for the listing-market universe tab.

The classification snapshot (03_ETF/etf_universe.py) stays on Refinitiv.
This job only refreshes price returns and writes a small overlay to R2.

Already collected, and not fetched again:
  - Korea ETF DB (18:20, Naver list) stores a 1-day change and threeMonthEarnRate.
    That 3M figure is a different statistic from a 63-session price return
    (KODEX 200 on 2026-10-28: Naver -17.3, Yahoo 63 sessions -10.1), and the
    list has no 1W, 1M, or 1Y. It is left on the live Korea screen.
  - The US live DB tab quotes a 1-day change for a subset, on demand, and does
    not keep a history.

1W / 1M / 3M / 1Y on this tab all come from Yahoo daily closes, one definition.
History is kept so each night only asks for the last few sessions,
except the first time a symbol is seen (2y backfill, so the 252-session window exists).

Runs at 20:10 KST, after the 18:20 Korea crawl and before the 21:50
US pre-summary. Asia and the US cash session are closed by then.
Europe is still open, so a bar dated today in Europe is left out of
the return and the previous close is used.
"""

from __future__ import annotations

import sys
from pathlib import Path

_COMMON = Path(__file__).resolve().parents[1] / "10_공통"
if str(_COMMON) not in sys.path:
    sys.path.insert(0, str(_COMMON))

import path_setup  # noqa: F401

import argparse
import gzip
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import requests

ROOT = path_setup.PROJECT_DIR
JSON_DIR = ROOT / "webapp" / "src" / "data" / "etfUniverse"
LOCAL_DIR = ROOT / "data" / "etf_universe_px"
CLOSES_NAME = "closes.json.gz"
R2_LATEST = "etf_universe_px/latest.json"
R2_CLOSES = "etf_universe_px/closes.json.gz"
UA = "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)"

MARKETS = ("kr", "us", "eu", "jp", "hk", "cn")
# Trading-day windows. 252 sessions ≈ 1 year, matching the ACWI close job.
WINDOWS = (("r1w", 5), ("r1m", 21), ("r3m", 63), ("r1y", 252))
KEEP_BARS = 280
WORKERS = 6
FULL_RANGE = "2y"
BUMP_RANGE = "5d"

EU_SUFFIX = {
    "Xetra": ".DE",
    "LSE": ".L",
    "Euronext Paris": ".PA",
    "Euronext Amsterdam": ".AS",
    "SIX": ".SW",
    "Borsa Italiana": ".MI",
    "Vienna": ".VI",
    "HKEX": ".HK",
}
TZ_BERLIN = ZoneInfo("Europe/Berlin")
TZ_LONDON = ZoneInfo("Europe/London")
TZ_ZURICH = ZoneInfo("Europe/Zurich")
TZ_NEW_YORK = ZoneInfo("America/New_York")
TZ_SEOUL = ZoneInfo("Asia/Seoul")
TZ_TOKYO = ZoneInfo("Asia/Tokyo")
TZ_HONG_KONG = ZoneInfo("Asia/Hong_Kong")
TZ_SHANGHAI = ZoneInfo("Asia/Shanghai")


def yahoo_symbol(market: str, ticker: str, exchange: str | None) -> str | None:
    """Listing ticker → Yahoo symbol. None when we have no suffix to try."""
    code = str(ticker or "").strip()
    if not code:
        return None
    if market == "kr":
        # Newer KRX codes mix a letter in, e.g. 0167A0.
        return f"{code}.KS" if len(code) == 6 and code.isalnum() else None
    if market == "us":
        if exchange == "TSX":
            return f"{code}.TO"
        if exchange == "NLB":
            return None
        if "." in code:
            code = code.split(".", 1)[0]
        return code or None
    if market == "jp":
        # Numeric 1306 and alphanumeric 294A both trade in Tokyo.
        return f"{code}.T" if code.isalnum() and 3 <= len(code) <= 5 else None
    if market == "hk":
        return f"{code.zfill(4)}.HK" if code.isdigit() else None
    if market == "cn":
        if not code.isdigit() or len(code) != 6:
            return None
        if exchange == "선전":
            return f"{code}.SZ"
        return f"{code}.SS"
    if market == "eu":
        if exchange == "HKEX" and code.isdigit():
            return f"{code.zfill(4)}.HK"
        suffix = EU_SUFFIX.get(exchange or "")
        return f"{code}{suffix}" if suffix else None
    return None


def listing_zone(market: str, exchange: str | None) -> ZoneInfo:
    if market == "eu":
        if exchange == "LSE":
            return TZ_LONDON
        if exchange == "SIX":
            return TZ_ZURICH
        return TZ_BERLIN
    return {
        "kr": TZ_SEOUL,
        "us": TZ_NEW_YORK,
        "jp": TZ_TOKYO,
        "hk": TZ_HONG_KONG,
        "cn": TZ_SHANGHAI,
    }.get(market, TZ_SEOUL)


def close_pending(market: str, exchange: str | None, now: datetime) -> bool:
    """True until that listing's cash close. A bar dated today is not a close yet."""
    local = now.astimezone(listing_zone(market, exchange))
    if local.weekday() >= 5:
        return False
    minutes = local.hour * 60 + local.minute
    if market == "us":
        end = 16 * 60
    elif market == "kr":
        end = 15 * 60 + 30
    elif market == "jp":
        end = 15 * 60
    elif market in ("hk", "cn"):
        end = 16 * 60
    elif market == "eu" and exchange == "LSE":
        end = 16 * 60 + 30
    elif market == "eu":
        end = 17 * 60 + 35
    else:
        return False
    return minutes < end


def load_listings() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for market in MARKETS:
        path = JSON_DIR / f"{market}.json"
        if not path.is_file():
            raise RuntimeError(f"ETF universe snapshot missing: {path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        cols = payload.get("cols") or []
        try:
            ticker_i = cols.index("t")
        except ValueError as exc:
            raise RuntimeError(f"{market} snapshot has no ticker column") from exc
        exchange_i = cols.index("ex") if "ex" in cols else None
        for row in payload.get("rows") or []:
            ticker = str(row[ticker_i] or "").strip()
            exchange = row[exchange_i] if exchange_i is not None and exchange_i < len(row) else None
            yahoo = yahoo_symbol(market, ticker, exchange if isinstance(exchange, str) else None)
            if not ticker or not yahoo:
                continue
            out.append({
                "market": market,
                "ticker": ticker,
                "exchange": exchange if isinstance(exchange, str) else None,
                "yahoo": yahoo,
            })
    return out


def fetch_bars(symbol: str, rng: str, session: requests.Session) -> list[list[Any]]:
    """Daily closes as [YYYY-MM-DD, close]. Empty on a miss. One pause on HTTP 429."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(symbol, safe='')}"
    response = None
    for attempt in range(2):
        try:
            response = session.get(
                url,
                params={"range": rng, "interval": "1d", "includePrePost": "false"},
                timeout=20,
            )
        except requests.RequestException:
            return []
        if response.status_code == 429 and attempt == 0:
            time.sleep(1.5)
            continue
        break
    if response is None or response.status_code != 200:
        return []
    result = ((response.json().get("chart") or {}).get("result") or [None])[0]
    if not result:
        return []
    stamps = result.get("timestamp") or []
    closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    offset = int(((result.get("meta") or {}).get("gmtoffset")) or 0)
    out: list[list[Any]] = []
    for i, stamp in enumerate(stamps):
        close = closes[i] if i < len(closes) else None
        if close is None or not isinstance(close, (int, float)) or close <= 0:
            continue
        day = datetime.fromtimestamp(int(stamp) + offset, timezone.utc).strftime("%Y-%m-%d")
        out.append([day, round(float(close), 4)])
    return out


def merge_bars(old: list[list[Any]], new: list[list[Any]]) -> list[list[Any]]:
    by = {row[0]: row[1] for row in old if row and row[0]}
    for row in new:
        if row and row[0]:
            by[row[0]] = row[1]
    merged = sorted(by.items())[-KEEP_BARS:]
    return [[day, close] for day, close in merged]


def completed_bars(bars: list[list[Any]], market: str, exchange: str | None, now: datetime) -> list[list[Any]]:
    """Drop today's bar until that listing's cash session has closed."""
    if not bars or not close_pending(market, exchange, now):
        return bars
    today = now.astimezone(listing_zone(market, exchange)).strftime("%Y-%m-%d")
    if bars[-1][0] == today:
        return bars[:-1]
    return bars


def window_returns(bars: list[list[Any]]) -> dict[str, float | None]:
    last = bars[-1][1] if bars else None
    out: dict[str, float | None] = {}
    for key, n in WINDOWS:
        if not last or len(bars) <= n:
            out[key] = None
            continue
        prev = bars[-1 - n][1]
        out[key] = round((last / prev - 1) * 100, 2) if prev else None
    return out


def _local_closes_path() -> Path:
    return LOCAL_DIR / CLOSES_NAME


def _parse_closes(raw: bytes) -> dict[str, list[list[Any]]]:
    data = json.loads(raw)
    bars = data.get("bars") if isinstance(data, dict) else None
    if not isinstance(bars, dict):
        raise RuntimeError("ETF close store has no bars object")
    return {key: value for key, value in bars.items() if isinstance(value, list)}


def load_closes() -> dict[str, list[list[Any]]]:
    """Local file, else R2. Missing store is a first run. A broken store raises so we do not overwrite it."""
    path = _local_closes_path()
    if path.is_file():
        return _parse_closes(gzip.decompress(path.read_bytes()))
    from r2_data import get_bytes

    blob = get_bytes(R2_CLOSES)
    if not blob:
        return {}
    return _parse_closes(gzip.decompress(blob))


def save_closes(bars: dict[str, list[list[Any]]]) -> None:
    body = gzip.compress(
        json.dumps({"v": 1, "bars": bars}, separators=(",", ":")).encode("utf-8")
    )
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    _local_closes_path().write_bytes(body)
    try:
        from r2_data import put_bytes

        put_bytes(R2_CLOSES, body, "application/gzip", cache_control="private, max-age=3600")
    except Exception as exc:
        print(f"etf_universe_px closes upload skipped: {exc}")


def _thread_session() -> requests.Session:
    import threading

    local = getattr(_thread_session, "local", None)
    if local is None:
        local = threading.local()
        setattr(_thread_session, "local", local)
    session = getattr(local, "session", None)
    if session is None:
        session = requests.Session()
        session.headers["User-Agent"] = UA
        local.session = session
    return session


def _fetch_many(symbols: list[str], rng: str, deadline: float | None) -> dict[str, list[list[Any]]]:
    found: dict[str, list[list[Any]]] = {}
    if not symbols:
        return found

    def one(symbol: str) -> tuple[str, list[list[Any]]]:
        return symbol, fetch_bars(symbol, rng, _thread_session())

    for start in range(0, len(symbols), 48):
        if deadline is not None and time.time() > deadline:
            break
        batch = symbols[start : start + 48]
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = [pool.submit(one, symbol) for symbol in batch]
            for fut in as_completed(futures):
                symbol, bars = fut.result()
                if bars:
                    found[symbol] = bars
    return found


def build_payload(
    listings: list[dict[str, Any]] | None = None,
    *,
    deadline: float | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Refresh closes, then build the per-market return overlay."""
    rows = listings if listings is not None else load_listings()
    if not rows:
        raise RuntimeError(f"ETF universe listings are empty: {JSON_DIR}")
    moment = now or datetime.now(timezone.utc)
    closes = load_closes()
    by_yahoo: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_yahoo.setdefault(row["yahoo"], []).append(row)

    need_full = [yahoo for yahoo in by_yahoo if len(closes.get(yahoo) or []) < 252]
    need_bump = [yahoo for yahoo in by_yahoo if yahoo not in set(need_full)]
    # Fresh 5d bars for names we already know, then backfill the rest until the deadline.
    bumped = _fetch_many(need_bump, BUMP_RANGE, deadline)
    filled = _fetch_many(need_full, FULL_RANGE, deadline)
    for yahoo, bars in {**bumped, **filled}.items():
        closes[yahoo] = merge_bars(closes.get(yahoo) or [], bars)
    save_closes(closes)

    markets: dict[str, dict[str, Any]] = {}
    used_dates: list[str] = []
    n_with = 0
    for market in MARKETS:
        table: list[list[Any]] = []
        dates: list[str] = []
        for row in rows:
            if row["market"] != market:
                continue
            bars = completed_bars(closes.get(row["yahoo"]) or [], market, row["exchange"], moment)
            rets = window_returns(bars)
            if any(rets[key] is not None for key, _ in WINDOWS):
                table.append([row["ticker"], *[rets[key] for key, _ in WINDOWS]])
                if bars:
                    dates.append(bars[-1][0])
        as_of = max(dates) if dates else None
        if as_of:
            used_dates.append(as_of)
        n_with += len(table)
        markets[market] = {"as_of": as_of, "source": "Yahoo 종가", "n": len(table), "rows": table}
    return {
        "ok": True,
        "as_of": max(used_dates) if used_dates else None,
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n_listings": len(rows),
        "n_with_returns": n_with,
        "n_backfill": len(need_full),
        "n_bump": len(need_bump),
        "markets": markets,
    }


def publish(payload: dict[str, Any]) -> bool:
    from r2_data import put_json_daily

    slim = {
        "ok": True,
        "as_of": payload.get("as_of"),
        "built_at": payload.get("built_at"),
        "markets": payload.get("markets") or {},
    }
    return bool(put_json_daily(R2_LATEST, slim, day=payload.get("as_of")))


def _self_test() -> None:
    assert yahoo_symbol("kr", "069500", "KRX") == "069500.KS"
    assert yahoo_symbol("kr", "0167A0", "KRX") == "0167A0.KS"
    assert yahoo_symbol("jp", "294A", "도쿄") == "294A.T"
    assert yahoo_symbol("us", "VOO", "NYSE Arca") == "VOO"
    assert yahoo_symbol("us", "NETL.IV", "NYSE Arca") == "NETL"
    assert yahoo_symbol("jp", "1306", "도쿄") == "1306.T"
    assert yahoo_symbol("hk", "2800", "HKEX") == "2800.HK"
    assert yahoo_symbol("cn", "510300", "상하이") == "510300.SS"
    assert yahoo_symbol("cn", "159919", "선전") == "159919.SZ"
    assert yahoo_symbol("eu", "SWDA", "LSE") == "SWDA.L"
    assert yahoo_symbol("eu", "CSSPX", "Xetra") == "CSSPX.DE"
    assert yahoo_symbol("eu", "ABC", "Luxembourg") is None
    bars = [[f"2026-01-{i:02d}", 100 + i] for i in range(1, 10)]
    # 5 sessions back: last 109 vs 104
    short = window_returns(bars)
    assert short["r1w"] == round((109 / 104 - 1) * 100, 2)
    assert short["r1y"] is None
    open_at = datetime(2026, 10, 28, 11, 10, tzinfo=timezone.utc)  # 20:10 KST, Europe afternoon
    kept = completed_bars([["2026-10-28", 10], ["2026-10-27", 9]], "eu", "Xetra", open_at)
    assert kept[-1][0] == "2026-10-27"
    closed = completed_bars([["2026-10-28", 10]], "kr", "KRX", open_at)
    assert closed[-1][0] == "2026-10-28"
    print("etf_universe_px self-test ok")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--markets", nargs="*", default=list(MARKETS))
    args = parser.parse_args()
    if args.self_test:
        _self_test()
        return
    listings = [row for row in load_listings() if row["market"] in set(args.markets)]
    if args.limit:
        listings = listings[: args.limit]
    payload = build_payload(listings)
    summary = {k: payload[k] for k in ("as_of", "n_listings", "n_with_returns", "n_backfill", "n_bump")}
    summary["by_market"] = {k: v["n"] for k, v in payload["markets"].items()}
    print(json.dumps(summary, ensure_ascii=False))
    if args.publish:
        print("published" if publish(payload) else "publish skipped (R2 미설정)")


if __name__ == "__main__":
    main()

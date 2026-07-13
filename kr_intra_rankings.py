"""KOSPI/KOSDAQ live intraday rankings (/kospi_intra, /kosdaq_intra).

Data source review (2026-07-13):
  - Yahoo .KS/.KQ: **no usable 1m/5m bars** during KR session; daily bars lag
    and often still show the prior session → wrong "intraday" returns.
  - Finnhub: **403** for KR equities on this key → cannot use.
  - Naver: minute chart + previous close available → correct source.

Formula (as requested):
  intraday_return = (latest_1m_bar.close − previous_close) / previous_close
  where latest_1m_bar is the Naver minute candle at poll time.
"""

from __future__ import annotations

import math
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, time
from typing import Any

import pandas as pd
import requests

from stock_crawler import (
    DEFAULT_BOTTOM_N,
    DEFAULT_TOP_N,
    KST,
    RANK_MODES,
    UNIVERSES,
    VOL_LOOKBACK_DAYS,
    _format_ticker_display,
    _load_universe_tickers,
)
from yahoo_market import fetch_daily_candles, map_tickers

KR_INTRA_UNIVERSES = frozenset({"kospi", "kosdaq"})

KR_INTRA_COMMANDS = {
    "/kospi_intra": "kospi",
    "/kosdaq_intra": "kosdaq",
}

KRX_OPEN = time(9, 0)
KRX_CLOSE = time(15, 30)

NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json,text/plain,*/*",
}

# Batch realtime for previous close + session status.
NAVER_REALTIME_URL = "https://polling.finance.naver.com/api/realtime/domestic/stock/{codes}"
# Per-ticker 1-minute bars for the current session.
NAVER_MINUTE_URL = (
    "https://api.stock.naver.com/chart/domestic/item/{code}/minute?periodType=day"
)
# Daily history fallback for previous close.
NAVER_DAILY_URL = "https://m.stock.naver.com/api/stock/{code}/price?page=1&pageSize=5"

NAVER_BATCH_SIZE = 40
NAVER_REALTIME_WORKERS = 6
NAVER_MINUTE_WORKERS = 16
YAHOO_VOL_WORKERS = 10

_session_local = threading.local()


def _session() -> requests.Session:
    session = getattr(_session_local, "session", None)
    if session is None:
        session = requests.Session()
        session.headers.update(NAVER_HEADERS)
        _session_local.session = session
    return session


def krx_session_status(now: datetime | None = None) -> str:
    now = now or datetime.now(KST)
    if now.weekday() >= 5:
        return "주말 — 직전 거래일 기준일 수 있음"
    t = now.time()
    if t < KRX_OPEN:
        return "장 시작 전"
    if t <= KRX_CLOSE:
        return "정규장 — Naver 1분봉 vs 전일 종가"
    return "장 마감 후 — 당일 종가 vs 전일 종가"


def parse_kr_intraday_command(message: str) -> tuple[str, str]:
    parts = message.strip().split()
    if not parts:
        raise ValueError("Empty command.")
    command = parts[0].lower()
    universe = None
    for prefix, key in KR_INTRA_COMMANDS.items():
        if command.startswith(prefix):
            universe = key
            break
    if universe is None:
        raise ValueError("Use /kospi_intra or /kosdaq_intra.")

    mode = "all"
    if len(parts) > 1:
        candidate = parts[1].lower()
        if candidate in RANK_MODES:
            mode = candidate
        elif candidate != "all":
            raise ValueError(f"Unknown mode '{parts[1]}'. Use surge or dropvol.")
    return universe, mode


def _to_kr_code(ticker: str) -> str:
    symbol = str(ticker).strip().upper()
    if symbol.endswith((".KS", ".KQ")):
        symbol = symbol[:-3]
    return symbol


def _parse_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return num if math.isfinite(num) else None
    text = str(value).strip().replace(",", "").replace("%", "")
    if not text:
        return None
    try:
        num = float(text)
    except ValueError:
        return None
    return num if math.isfinite(num) else None


def fetch_naver_realtime_batch(codes: list[str]) -> dict[str, dict[str, Any]]:
    if not codes:
        return {}
    url = NAVER_REALTIME_URL.format(codes=",".join(codes))
    try:
        response = _session().get(url, timeout=20)
    except requests.RequestException:
        return {}
    if not response.ok:
        return {}
    try:
        payload = response.json()
    except ValueError:
        return {}

    out: dict[str, dict[str, Any]] = {}
    for item in payload.get("datas") or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("itemCode") or "").strip()
        if not code:
            continue
        price = _parse_number(item.get("closePriceRaw") or item.get("closePrice"))
        ratio = _parse_number(item.get("fluctuationsRatioRaw") or item.get("fluctuationsRatio"))
        diff = _parse_number(
            item.get("compareToPreviousClosePriceRaw") or item.get("compareToPreviousClosePrice")
        )
        volume = _parse_number(
            item.get("accumulatedTradingVolumeRaw") or item.get("accumulatedTradingVolume")
        )
        prev_close = None
        if price is not None and ratio is not None and abs(ratio / 100.0 + 1.0) > 1e-9:
            prev_close = price / (1.0 + ratio / 100.0)
        elif price is not None and diff is not None:
            prev_close = price - diff
        out[code] = {
            "code": code,
            "name": item.get("stockName") or "",
            "price": price,
            "prev_close": prev_close,
            "change_pct_quote": (ratio / 100.0) if ratio is not None else None,
            "volume": volume,
            "market_status": item.get("marketStatus") or "",
            "traded_at": item.get("localTradedAt") or "",
        }
    return out


def fetch_naver_realtime_quotes(tickers: list[str]) -> dict[str, dict[str, Any]]:
    codes = [_to_kr_code(t) for t in tickers if _to_kr_code(t)]
    code_to_ticker = {_to_kr_code(t): t for t in tickers}
    batches = [codes[i : i + NAVER_BATCH_SIZE] for i in range(0, len(codes), NAVER_BATCH_SIZE)]
    merged: dict[str, dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=NAVER_REALTIME_WORKERS) as pool:
        futures = [pool.submit(fetch_naver_realtime_batch, batch) for batch in batches]
        for future in as_completed(futures):
            try:
                merged.update(future.result())
            except Exception as exc:
                print(f"Naver realtime batch failed: {exc}")

    by_ticker: dict[str, dict[str, Any]] = {}
    for code, row in merged.items():
        ticker = code_to_ticker.get(code)
        if not ticker:
            continue
        packed = dict(row)
        packed["ticker"] = ticker
        by_ticker[ticker] = packed
    return by_ticker


def fetch_naver_latest_minute_bar(code: str) -> dict[str, Any] | None:
    """Return the latest 1-minute bar for today, or None."""
    code = _to_kr_code(code)
    try:
        response = _session().get(NAVER_MINUTE_URL.format(code=code), timeout=20)
    except requests.RequestException:
        return None
    if not response.ok:
        return None
    try:
        bars = response.json()
    except ValueError:
        return None
    if not isinstance(bars, list) or not bars:
        return None
    last = bars[-1]
    if not isinstance(last, dict):
        return None
    price = _parse_number(last.get("currentPrice"))
    if price is None or price <= 0:
        return None
    return {
        "local_datetime": str(last.get("localDateTime") or ""),
        "price": price,
        "open": _parse_number(last.get("openPrice")),
        "high": _parse_number(last.get("highPrice")),
        "low": _parse_number(last.get("lowPrice")),
        "volume": _parse_number(last.get("accumulatedTradingVolume")),
        "bar_count": len(bars),
    }


def fetch_naver_previous_close(code: str) -> float | None:
    """Previous trading-day close from Naver daily price history."""
    code = _to_kr_code(code)
    try:
        response = _session().get(NAVER_DAILY_URL.format(code=code), timeout=20)
    except requests.RequestException:
        return None
    if not response.ok:
        return None
    try:
        rows = response.json()
    except ValueError:
        return None
    if not isinstance(rows, list) or len(rows) < 2:
        return None
    today = datetime.now(KST).strftime("%Y-%m-%d")
    for row in rows:
        if not isinstance(row, dict):
            continue
        traded = str(row.get("localTradedAt") or "")[:10]
        if traded and traded != today:
            px = _parse_number(row.get("closePrice"))
            if px and px > 0:
                return px
    # Fallback: second row is usually previous session.
    px = _parse_number(rows[1].get("closePrice"))
    return px if px and px > 0 else None


def fetch_minute_bars_for_tickers(tickers: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}

    def worker(ticker: str) -> tuple[str, dict[str, Any] | None]:
        return ticker, fetch_naver_latest_minute_bar(ticker)

    with ThreadPoolExecutor(max_workers=NAVER_MINUTE_WORKERS) as pool:
        futures = [pool.submit(worker, ticker) for ticker in tickers]
        for future in as_completed(futures):
            try:
                ticker, bar = future.result()
            except Exception as exc:
                print(f"Naver minute fetch failed: {exc}")
                continue
            if bar:
                out[ticker] = bar
    return out


def _yahoo_avg_volume(ticker: str) -> float | None:
    frame = fetch_daily_candles(ticker, range_="2mo", interval="1d")
    if frame.empty or "volume" not in frame.columns:
        return None
    vol = frame["volume"].dropna()
    if len(vol) < VOL_LOOKBACK_DAYS:
        return None
    avg = float(vol.iloc[-VOL_LOOKBACK_DAYS:].mean())
    return avg if avg > 0 else None


def fetch_yahoo_avg_volumes(tickers: list[str]) -> dict[str, float]:
    mapped = map_tickers(tickers, _yahoo_avg_volume, max_workers=YAHOO_VOL_WORKERS)
    return {ticker: float(val) for ticker, val in mapped.items() if val}


def build_kr_intraday_metrics_table(universe: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    if universe not in KR_INTRA_UNIVERSES:
        raise ValueError(f"Intraday rankings only for kospi/kosdaq, not {universe!r}")

    tickers = _load_universe_tickers(universe)
    quotes = fetch_naver_realtime_quotes(tickers)
    minute_bars = fetch_minute_bars_for_tickers(list(quotes.keys()) or tickers)

    missing_prev = [
        ticker
        for ticker in tickers
        if (quotes.get(ticker) or {}).get("prev_close") in (None, 0)
    ]

    def _prev_worker(ticker: str) -> tuple[str, float | None]:
        return ticker, fetch_naver_previous_close(ticker)

    prev_overrides: dict[str, float] = {}
    if missing_prev:
        with ThreadPoolExecutor(max_workers=NAVER_MINUTE_WORKERS) as pool:
            futures = [pool.submit(_prev_worker, t) for t in missing_prev]
            for future in as_completed(futures):
                try:
                    ticker, px = future.result()
                except Exception:
                    continue
                if px:
                    prev_overrides[ticker] = px

    avg_vols = fetch_yahoo_avg_volumes(list(minute_bars.keys()) or list(quotes.keys()))

    rows: list[dict[str, Any]] = []
    used_minute = 0
    used_quote_fallback = 0
    prev_close_fallback = len(prev_overrides)

    for ticker in tickers:
        quote = quotes.get(ticker) or {}
        bar = minute_bars.get(ticker)
        prev_close = quote.get("prev_close") or prev_overrides.get(ticker)
        if prev_close is None or prev_close <= 0:
            continue

        if bar and bar.get("price"):
            price = float(bar["price"])
            bar_time = bar.get("local_datetime") or ""
            # Minute payload's volume is per-bar, not day cumulative — use realtime aq.
            today_vol = quote.get("volume")
            used_minute += 1
            source = "naver_1m"
        elif quote.get("price"):
            price = float(quote["price"])
            bar_time = quote.get("traded_at") or ""
            today_vol = quote.get("volume")
            used_quote_fallback += 1
            source = "naver_quote_fallback"
        else:
            continue

        ret = (price / float(prev_close)) - 1.0
        row: dict[str, Any] = {
            "Ticker": ticker,
            "Daily Return": float(ret),
            "Price": price,
            "Prev Close": float(prev_close),
            "Name": quote.get("name") or "",
            "Market Status": quote.get("market_status") or "",
            "Bar Time": bar_time,
            "Source": source,
        }
        if today_vol and avg_vols.get(ticker):
            vol_ratio = float(today_vol) / float(avg_vols[ticker])
            row["Vol Ratio"] = vol_ratio
            if ret > 0:
                row["Surge Score"] = float(ret) * vol_ratio
            elif ret < 0:
                row["Drop Vol Score"] = abs(float(ret)) * vol_ratio
        else:
            if ret > 0:
                row["Surge Score"] = float(ret)
            elif ret < 0:
                row["Drop Vol Score"] = abs(float(ret))
        rows.append(row)

    df = pd.DataFrame(rows)
    sample_bar_time = ""
    if not df.empty and "Bar Time" in df.columns:
        sample_bar_time = str(df["Bar Time"].iloc[0] or "")
    meta = {
        "scanned": len(tickers),
        "skipped": len(tickers) - len(df),
        "quoted": len(quotes),
        "minute_bars": len(minute_bars),
        "used_minute": used_minute,
        "used_quote_fallback": used_quote_fallback,
        "prev_close_fallback": prev_close_fallback,
        "loaded_at": datetime.now(KST),
        "source": "Naver 1m bar vs previous close",
        "session": krx_session_status(),
        "sample_status": next(
            (q.get("market_status") for q in quotes.values() if q.get("market_status")),
            "",
        ),
        "sample_bar_time": sample_bar_time,
    }
    return df, meta


def _row_label(row: pd.Series) -> str:
    parts: list[str] = []
    daily = row.get("Daily Return")
    if pd.notna(daily):
        parts.append(f"{float(daily) * 100:+.2f}%")
    vol = row.get("Vol Ratio")
    if pd.notna(vol):
        parts.append(f"vol {float(vol):.2f}x")
    price = row.get("Price")
    if pd.notna(price):
        parts.append(f"₩{float(price):,.0f}")
    bar_time = str(row.get("Bar Time") or "")
    if len(bar_time) >= 12 and bar_time.isdigit():
        parts.append(f"{bar_time[8:10]}:{bar_time[10:12]}")
    return " | ".join(parts) if parts else "n/a"


def _board(
    df: pd.DataFrame,
    mode: str,
    *,
    top_n: int,
    bottom_n: int,
) -> dict[str, Any]:
    column = RANK_MODES[mode]["column"]
    label = RANK_MODES[mode]["label"]
    title = "▲ 상승+거래대금 급증" if mode == "surge" else "▼ 하락+거래대금 급증"
    if df.empty or column not in df.columns:
        return {"mode": mode, "title": title, "label": label, "top": [], "bottom": []}

    ranked = df.dropna(subset=[column]).sort_values(by=column, ascending=False)
    top_rows = [(row["Ticker"], _row_label(row)) for _, row in ranked.head(top_n).iterrows()]
    bottom_df = ranked.sort_values(by=column, ascending=True).head(bottom_n)
    bottom_rows = [(row["Ticker"], _row_label(row)) for _, row in bottom_df.iterrows()]
    return {
        "mode": mode,
        "title": title,
        "label": label,
        "top": top_rows,
        "bottom": bottom_rows,
    }


def format_kr_intraday_rankings_message(
    df: pd.DataFrame,
    meta: dict[str, Any],
    universe: str,
    mode: str = "all",
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> str:
    label_name = UNIVERSES[universe]["label"]
    loaded_at = meta["loaded_at"].strftime("%Y-%m-%d %H:%M:%S KST")
    modes = ["surge", "dropvol"] if mode == "all" else [mode]

    lines = [
        f"🇰🇷 {label_name} 장중 랭킹",
        "장중 수익률 = (Naver 1분봉 종가 − 전일 종가) / 전일 종가",
        "거래량 = 당일 누적 / 21일 평균(Yahoo)",
        f"상태: {meta.get('session')} · market={meta.get('sample_status') or 'n/a'}",
        (
            f"분봉사용 {meta.get('used_minute')}/{meta.get('scanned')} "
            f"(quote fallback {meta.get('used_quote_fallback')})"
        ),
        f"Active: {len(df)} | Skipped: {meta.get('skipped')} | as of {loaded_at}",
        "",
    ]

    for rank_mode in modes:
        use_bottom = 0 if mode == "all" else bottom_n
        board = _board(df, rank_mode, top_n=top_n, bottom_n=use_bottom)
        if not board["top"] and not board["bottom"]:
            lines.append(f"{board['title']}: no data")
            lines.append("")
            continue
        lines.append(board["title"])
        lines.append(f"({board['label']})")
        lines.append("")
        if top_n > 0 and board["top"]:
            lines.append(f"Top {top_n}:")
            for idx, (ticker, value) in enumerate(board["top"], start=1):
                lines.append(f"{idx}. {_format_ticker_display(ticker, universe)}  {value}")
            lines.append("")
        if use_bottom > 0 and board["bottom"]:
            lines.append(f"Bottom {use_bottom}:")
            for idx, (ticker, value) in enumerate(board["bottom"], start=1):
                lines.append(f"{idx}. {_format_ticker_display(ticker, universe)}  {value}")
            lines.append("")

    if lines and lines[-1] == "":
        lines.pop()
    message = "\n".join(lines)
    if len(message) > 4000:
        message = message[:3990] + "\n...(truncated)"
    return message


def ranking_boards_from_df(
    df: pd.DataFrame,
    meta: dict[str, Any],
    *,
    top_n: int = DEFAULT_TOP_N,
) -> dict[str, Any]:
    """Board dicts shaped like stock_crawler._ranking_slice for /summary_kor_intra."""
    boards: dict[str, Any] = {}
    for mode in ("surge", "dropvol"):
        board = _board(df, mode, top_n=top_n, bottom_n=0)
        board["scanned"] = meta.get("scanned", len(df))
        board["skipped"] = meta.get("skipped", 0)
        boards[mode] = board
    return boards


def build_kr_intraday_summary_boards(
    universe: str,
    *,
    top_n: int = DEFAULT_TOP_N,
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    """Return (boards, meta, surge_leader) using Naver 1m vs previous close."""
    df, meta = build_kr_intraday_metrics_table(universe)
    if df.empty or meta.get("used_minute", 0) == 0:
        raise RuntimeError(
            f"{UNIVERSES[universe]['label']}: Naver 1분봉 장중 데이터가 없습니다."
        )
    boards = ranking_boards_from_df(df, meta, top_n=top_n)
    leader = boards["surge"]["top"][0][0] if boards["surge"]["top"] else None
    return boards, meta, leader


def run_kr_intraday_rankings(
    universe: str,
    mode: str = "all",
    *,
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> dict:
    df, meta = build_kr_intraday_metrics_table(universe)
    if df.empty:
        raise RuntimeError(
            f"{UNIVERSES[universe]['label']} 장중 분봉을 가져오지 못했습니다. "
            "Naver minute API를 잠시 후 다시 시도하세요."
        )
    if meta.get("used_minute", 0) == 0:
        raise RuntimeError(
            f"{UNIVERSES[universe]['label']}: Naver 1분봉이 비어 있습니다. "
            "Yahoo로는 한국 분봉을 받을 수 없어 장중 수익률을 계산하지 않습니다."
        )

    text = format_kr_intraday_rankings_message(
        df, meta, universe, mode=mode, top_n=top_n, bottom_n=bottom_n
    )

    tickers: list[str] = []
    modes = ["surge", "dropvol"] if mode == "all" else [mode]
    for rank_mode in modes:
        board = _board(df, rank_mode, top_n=top_n, bottom_n=0 if mode == "all" else bottom_n)
        for group in (board["top"], board["bottom"]):
            for ticker, _ in group:
                if ticker not in tickers:
                    tickers.append(ticker)

    leader = None
    lead_mode = "dropvol" if mode == "dropvol" else "surge"
    lead_board = _board(df, lead_mode, top_n=1, bottom_n=0)
    if lead_board["top"]:
        leader = lead_board["top"][0][0]

    return {
        "universe": universe,
        "mode": mode,
        "text": text,
        "tickers": tickers,
        "context_label": f"{UNIVERSES[universe]['label']} — intraday 1m (Naver)",
        "leader_ticker": leader,
        "meta": meta,
        "dataframe": df,
    }

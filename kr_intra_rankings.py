"""KOSPI/KOSDAQ live intraday rankings (/kospi_intra, /kosdaq_intra).

Yahoo daily bars for .KS/.KQ often omit today's incomplete session early
(and can lag), so (last_daily − prev_daily) / prev_daily is frequently the
*previous trading day's* return. These commands use Naver Finance realtime
quotes instead:

  intraday_return = fluctuationsRatio / 100
                  = (current − previous_close) / previous_close

  vol_ratio = today_accumulated_volume / 21d_avg_daily_volume (Yahoo history)
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

NAVER_REALTIME_URL = "https://polling.finance.naver.com/api/realtime/domestic/stock/{codes}"
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
    "Accept": "application/json,text/plain,*/*",
}
NAVER_BATCH_SIZE = 40
NAVER_MAX_WORKERS = 6
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
        return "정규장 (Naver 실시간)"
    return "장 마감 후 (당일 종가 대비)"


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


def _to_yahoo_ticker(code: str, universe: str) -> str:
    code = _to_kr_code(code)
    suffix = ".KQ" if universe == "kosdaq" else ".KS"
    # Prefer original suffix from universe lists when present.
    return f"{code}{suffix}"


def _parse_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    text = str(value).strip().replace(",", "").replace("%", "")
    if not text:
        return None
    try:
        num = float(text)
    except ValueError:
        return None
    return num if math.isfinite(num) else None


def fetch_naver_realtime_batch(codes: list[str]) -> dict[str, dict[str, Any]]:
    """Return map code -> quote fields from Naver polling API."""
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
        ratio = _parse_number(item.get("fluctuationsRatioRaw") or item.get("fluctuationsRatio"))
        price = _parse_number(item.get("closePriceRaw") or item.get("closePrice"))
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
            "change": diff,
            "change_pct": (ratio / 100.0) if ratio is not None else None,
            "volume": volume,
            "market_status": item.get("marketStatus") or "",
            "traded_at": item.get("localTradedAt") or "",
        }
    return out


def fetch_naver_realtime_quotes(tickers: list[str]) -> dict[str, dict[str, Any]]:
    codes = [_to_kr_code(t) for t in tickers]
    codes = [c for c in codes if c]
    # preserve yahoo ticker mapping
    code_to_ticker = {_to_kr_code(t): t for t in tickers}

    batches = [codes[i : i + NAVER_BATCH_SIZE] for i in range(0, len(codes), NAVER_BATCH_SIZE)]
    merged: dict[str, dict[str, Any]] = {}

    def worker(batch: list[str]) -> dict[str, dict[str, Any]]:
        return fetch_naver_realtime_batch(batch)

    with ThreadPoolExecutor(max_workers=NAVER_MAX_WORKERS) as pool:
        futures = [pool.submit(worker, batch) for batch in batches]
        for future in as_completed(futures):
            try:
                merged.update(future.result())
            except Exception as exc:
                print(f"Naver realtime batch failed: {exc}")

    # Remap to yahoo-style tickers
    by_ticker: dict[str, dict[str, Any]] = {}
    for code, row in merged.items():
        ticker = code_to_ticker.get(code)
        if not ticker:
            continue
        row = dict(row)
        row["ticker"] = ticker
        by_ticker[ticker] = row
    return by_ticker


def _yahoo_avg_volume(ticker: str) -> float | None:
    frame = fetch_daily_candles(ticker, range_="2mo", interval="1d")
    if frame.empty or "volume" not in frame.columns:
        return None
    vol = frame["volume"].dropna()
    if len(vol) < VOL_LOOKBACK_DAYS:
        return None
    # Exclude today if Yahoo already appended a sparse today bar with tiny volume.
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
    avg_vols = fetch_yahoo_avg_volumes(list(quotes.keys()))

    rows: list[dict[str, Any]] = []
    for ticker, quote in quotes.items():
        ret = quote.get("change_pct")
        if ret is None:
            continue
        row: dict[str, Any] = {
            "Ticker": ticker,
            "Daily Return": float(ret),
            "Price": quote.get("price"),
            "Prev Close": quote.get("prev_close"),
            "Name": quote.get("name") or "",
            "Market Status": quote.get("market_status") or "",
            "Traded At": quote.get("traded_at") or "",
        }
        today_vol = quote.get("volume")
        avg_vol = avg_vols.get(ticker)
        if today_vol and avg_vol and avg_vol > 0:
            vol_ratio = float(today_vol) / float(avg_vol)
            row["Vol Ratio"] = vol_ratio
            if ret > 0:
                row["Surge Score"] = float(ret) * vol_ratio
            elif ret < 0:
                row["Drop Vol Score"] = abs(float(ret)) * vol_ratio
        else:
            # Fallback: rank by |return| alone when volume avg missing.
            if ret > 0:
                row["Surge Score"] = float(ret)
            elif ret < 0:
                row["Drop Vol Score"] = abs(float(ret))
        rows.append(row)

    df = pd.DataFrame(rows)
    meta = {
        "scanned": len(tickers),
        "skipped": len(tickers) - len(df),
        "quoted": len(quotes),
        "loaded_at": datetime.now(KST),
        "source": "Naver realtime + Yahoo 21d volume avg",
        "session": krx_session_status(),
        "sample_status": next(
            (q.get("market_status") for q in quotes.values() if q.get("market_status")),
            "",
        ),
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
        "장중 수익률 = Naver 실시간 현재가 vs 전일 종가",
        "거래량 = 당일 누적(Naver) / 21일 평균(Yahoo)",
        f"상태: {meta.get('session')} · market={meta.get('sample_status') or 'n/a'}",
        f"Active: {len(df)} | Scanned: {meta.get('scanned')} | Skipped: {meta.get('skipped')}",
        f"Data as of: {loaded_at}",
        f"Source: {meta.get('source')}",
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
            f"{UNIVERSES[universe]['label']} 장중 시세를 가져오지 못했습니다. "
            "Naver realtime을 잠시 후 다시 시도하세요."
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
        "context_label": f"{UNIVERSES[universe]['label']} — intraday (Naver)",
        "leader_ticker": leader,
        "meta": meta,
        "dataframe": df,
    }

"""Fast Yahoo Finance chart API helpers (daily OHLCV without yfinance)."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

import pandas as pd
import requests

YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
DEFAULT_RANGE = "2mo"
DEFAULT_INTERVAL = "1d"
DEFAULT_MAX_WORKERS = 10
USER_AGENT = "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)"

_session_local = threading.local()


def to_yahoo_symbol(ticker: str) -> str:
    return ticker.strip().upper().replace(".", "-")


def _session() -> requests.Session:
    session = getattr(_session_local, "session", None)
    if session is None:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})
        _session_local.session = session
    return session


def fetch_daily_candles(
    ticker: str,
    *,
    range_: str = DEFAULT_RANGE,
    interval: str = DEFAULT_INTERVAL,
    timeout: float = 20,
) -> pd.DataFrame:
    """Return daily close/volume indexed by date (naive)."""
    symbol = to_yahoo_symbol(ticker)
    try:
        response = _session().get(
            YAHOO_CHART_URL.format(symbol=symbol),
            params={"range": range_, "interval": interval, "includePrePost": "false"},
            timeout=timeout,
        )
    except requests.RequestException:
        return pd.DataFrame()

    if response.status_code != 200:
        return pd.DataFrame()

    try:
        payload = response.json()
    except ValueError:
        return pd.DataFrame()

    results = (payload.get("chart") or {}).get("result") or []
    if not results:
        return pd.DataFrame()

    result = results[0]
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    if not timestamps or not closes:
        return pd.DataFrame()

    frame = pd.DataFrame(
        {
            "close": pd.to_numeric(closes, errors="coerce"),
            "volume": pd.to_numeric(volumes, errors="coerce"),
        },
        index=pd.to_datetime(timestamps, unit="s", utc=True).tz_localize(None),
    )
    frame = frame.dropna(subset=["close"]).sort_index()
    frame = frame[~frame.index.duplicated(keep="last")]
    return frame


def map_tickers(
    tickers: list[str],
    worker: Callable[[str], Any],
    *,
    max_workers: int = DEFAULT_MAX_WORKERS,
    on_progress: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    results: dict[str, Any] = {}
    total = len(tickers)
    done = 0
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(worker, ticker): ticker for ticker in tickers}
        for future in as_completed(futures):
            ticker = futures[future]
            done += 1
            try:
                value = future.result()
            except Exception as exc:
                print(f"Yahoo chart worker failed for {ticker}: {exc}")
                value = None
            if value is not None:
                results[ticker] = value
            if on_progress and (done % 50 == 0 or done == total):
                on_progress(done, total)
    return results


def fetch_many_daily_candles(
    tickers: list[str],
    *,
    max_workers: int = DEFAULT_MAX_WORKERS,
    on_progress: Callable[[int, int], None] | None = None,
) -> dict[str, pd.DataFrame]:
    def worker(ticker: str) -> pd.DataFrame | None:
        frame = fetch_daily_candles(ticker)
        return frame if not frame.empty else None

    return map_tickers(tickers, worker, max_workers=max_workers, on_progress=on_progress)

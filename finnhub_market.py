"""Shared Finnhub market-data helpers (rate-limited candles + quotes)."""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import pandas as pd
import requests

FINNHUB_BASE = "https://finnhub.io/api/v1"
DEFAULT_MAX_PER_MINUTE = 55
DEFAULT_CANDLE_LOOKBACK_DAYS = 45


class FinnhubRateLimiter:
    def __init__(self, max_per_minute: int = DEFAULT_MAX_PER_MINUTE) -> None:
        self.min_interval = 60.0 / max(1, max_per_minute)
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.time()
            delay = self.min_interval - (now - self._last)
            if delay > 0:
                time.sleep(delay)
            self._last = time.time()


_limiter = FinnhubRateLimiter()


def finnhub_api_key() -> str:
    return os.environ.get("FINNHUB_API_KEY", "").strip()


def to_finnhub_symbol(ticker: str) -> str:
    """Yahoo uses BRK-B; Finnhub uses BRK.B."""
    return ticker.strip().upper().replace("-", ".")


def to_yahoo_symbol(ticker: str) -> str:
    return ticker.strip().upper().replace(".", "-")


def _get(path: str, params: dict[str, Any], *, timeout: float = 30) -> Any:
    key = finnhub_api_key()
    if not key:
        raise RuntimeError("FINNHUB_API_KEY is not set")
    _limiter.wait()
    response = requests.get(
        f"{FINNHUB_BASE}/{path}",
        params={**params, "token": key},
        timeout=timeout,
    )
    if response.status_code == 429:
        time.sleep(2.0)
        _limiter.wait()
        response = requests.get(
            f"{FINNHUB_BASE}/{path}",
            params={**params, "token": key},
            timeout=timeout,
        )
    response.raise_for_status()
    return response.json()


def fetch_daily_candles(
    ticker: str,
    *,
    lookback_days: int = DEFAULT_CANDLE_LOOKBACK_DAYS,
) -> pd.DataFrame:
    """Return daily close/volume indexed by date (naive UTC dates)."""
    symbol = to_finnhub_symbol(ticker)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=lookback_days)
    payload = _get(
        "stock/candle",
        {
            "symbol": symbol,
            "resolution": "D",
            "from": int(start.timestamp()),
            "to": int(end.timestamp()),
        },
    )
    if not isinstance(payload, dict) or payload.get("s") != "ok":
        return pd.DataFrame()

    timestamps = payload.get("t") or []
    closes = payload.get("c") or []
    volumes = payload.get("v") or [0.0] * len(timestamps)
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


def fetch_quote(ticker: str, *, include_premarket_trade: bool = True) -> dict[str, float | None]:
    """
    Finnhub /quote.
    With trade=true, current price can reflect pre/post-market last trade when available.
    """
    symbol = to_finnhub_symbol(ticker)
    params: dict[str, Any] = {"symbol": symbol}
    if include_premarket_trade:
        params["trade"] = "true"
    payload = _get("quote", params)
    if not isinstance(payload, dict):
        return {}

    def _num(key: str) -> float | None:
        value = payload.get(key)
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if number != number:  # NaN
            return None
        return number

    current = _num("c")
    prev_close = _num("pc")
    pct = _num("dp")
    if pct is None and current is not None and prev_close not in (None, 0):
        pct = (current / prev_close - 1.0) * 100.0

    return {
        "current": current,
        "prev_close": prev_close,
        "change_pct": pct,
        "open": _num("o"),
        "high": _num("h"),
        "low": _num("l"),
        "timestamp": _num("t"),
    }


def map_tickers(
    tickers: list[str],
    worker: Callable[[str], Any],
    *,
    max_workers: int = 4,
    on_progress: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    """Run worker(ticker) with shared Finnhub rate limiting."""
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
                print(f"Finnhub worker failed for {ticker}: {exc}")
                value = None
            if value is not None:
                results[ticker] = value
            if on_progress and (done % 25 == 0 or done == total):
                on_progress(done, total)
    return results

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
# Free tier is ~60/min; stay under and serialize callers to avoid 429 stampedes.
DEFAULT_MAX_PER_MINUTE = 30
DEFAULT_CANDLE_LOOKBACK_DAYS = 45
DEFAULT_MAX_WORKERS = 1
MAX_RETRIES = 6


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

    def penalty(self, seconds: float) -> None:
        """Pause the shared limiter after a 429 so other workers don't stampede."""
        with self._lock:
            time.sleep(max(0.0, seconds))
            self._last = time.time()


_limiter = FinnhubRateLimiter()


def finnhub_api_key() -> str:
    return os.environ.get("FINNHUB_API_KEY", "").strip()


def to_finnhub_symbol(ticker: str) -> str:
    """Yahoo uses BRK-B; Finnhub uses BRK.B."""
    return ticker.strip().upper().replace("-", ".")


def to_yahoo_symbol(ticker: str) -> str:
    return ticker.strip().upper().replace(".", "-")


def _redact(text: str) -> str:
    key = finnhub_api_key()
    if key and key in text:
        return text.replace(key, "***")
    return text


def _get(path: str, params: dict[str, Any], *, timeout: float = 30) -> Any:
    key = finnhub_api_key()
    if not key:
        raise RuntimeError("FINNHUB_API_KEY is not set")

    last_status = 0
    last_body = ""
    for attempt in range(MAX_RETRIES):
        _limiter.wait()
        try:
            response = requests.get(
                f"{FINNHUB_BASE}/{path}",
                params={**params, "token": key},
                timeout=timeout,
            )
        except requests.RequestException as exc:
            raise RuntimeError(f"Finnhub {path} network error: {_redact(str(exc))}") from exc

        if response.status_code == 429:
            backoff = min(60.0, 5.0 * (2**attempt))
            print(f"Finnhub 429 on /{path} (attempt {attempt + 1}/{MAX_RETRIES}); sleep {backoff:.0f}s")
            _limiter.penalty(backoff)
            last_status = 429
            last_body = response.text[:200]
            continue

        if response.status_code >= 400:
            # Never raise_for_status(): the URL embeds the API token.
            raise RuntimeError(
                f"Finnhub /{path} HTTP {response.status_code}: {_redact(response.text[:200])}"
            )

        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError(f"Finnhub /{path} returned non-JSON") from exc

    raise RuntimeError(
        f"Finnhub /{path} rate limited after {MAX_RETRIES} retries "
        f"(last HTTP {last_status}: {_redact(last_body)})"
    )


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
    max_workers: int = DEFAULT_MAX_WORKERS,
    on_progress: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    """Run worker(ticker) with shared Finnhub rate limiting (default: serial)."""
    results: dict[str, Any] = {}
    total = len(tickers)
    done = 0
    workers = max(1, min(max_workers, 2))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(worker, ticker): ticker for ticker in tickers}
        for future in as_completed(futures):
            ticker = futures[future]
            done += 1
            try:
                value = future.result()
            except Exception as exc:
                print(f"Finnhub worker failed for {ticker}: {_redact(str(exc))}")
                value = None
            if value is not None:
                results[ticker] = value
            if on_progress and (done % 25 == 0 or done == total):
                on_progress(done, total)
    return results

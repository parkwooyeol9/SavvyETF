"""ETF display names (yfinance) and keyword queries for news search."""

from __future__ import annotations

import contextlib
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import yfinance as yf

_name_cache: dict[str, str | None] = {}
_cache_lock = threading.Lock()

_STOP_WORDS = frozenset(
    {
        "etf",
        "trust",
        "fund",
        "inc",
        "llc",
        "lp",
        "the",
        "and",
        "of",
        "class",
        "shares",
        "share",
        "index",
        "portfolio",
        "series",
        "ultra",
        "pro",
        "ucits",
        "plc",
        "corp",
        "co",
        "ltd",
        "sa",
        "ag",
        "nv",
        "se",
        "usd",
        "acc",
        "dist",
    }
)

_INDEX_QUERIES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"S&P\s*500", re.I), "S&P 500 ETF"),
    (re.compile(r"NASDAQ[- ]?100", re.I), "NASDAQ 100 ETF"),
    (re.compile(r"Russell\s*2000", re.I), "Russell 2000 ETF"),
    (re.compile(r"Russell\s*1000", re.I), "Russell 1000 ETF"),
    (re.compile(r"MSCI\s+Emerging", re.I), "emerging markets ETF"),
    (re.compile(r"MSCI\s+EAFE", re.I), "EAFE international ETF"),
    (re.compile(r"\bBitcoin\b", re.I), "Bitcoin ETF"),
    (re.compile(r"\bEthereum\b", re.I), "Ethereum ETF"),
    (re.compile(r"Semiconductor", re.I), "semiconductor ETF"),
    (re.compile(r"Treasury", re.I), "Treasury bond ETF"),
    (re.compile(r"Gold Miners?", re.I), "gold miners ETF"),
    (re.compile(r"Clean\s*Energy", re.I), "clean energy ETF"),
    (re.compile(r"Real\s*Estate", re.I), "real estate ETF"),
]


@contextlib.contextmanager
def _quiet_yfinance():
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        old_stderr = sys.stderr
        sys.stderr = devnull
        try:
            yield
        finally:
            sys.stderr = old_stderr


def _fetch_etf_name(ticker: str) -> str | None:
    symbol = ticker.strip().upper()
    with _quiet_yfinance():
        try:
            info = yf.Ticker(symbol).info or {}
        except Exception:
            return None
    name = (info.get("longName") or info.get("shortName") or "").strip()
    return name or None


def lookup_etf_name(ticker: str) -> str | None:
    symbol = ticker.strip().upper()
    if not symbol:
        return None

    with _cache_lock:
        if symbol in _name_cache:
            return _name_cache[symbol]

    name = _fetch_etf_name(symbol)
    with _cache_lock:
        _name_cache[symbol] = name
    return name


def prefetch_etf_names(tickers: list[str]) -> None:
    missing = []
    with _cache_lock:
        for ticker in tickers:
            symbol = ticker.strip().upper()
            if symbol and symbol not in _name_cache:
                missing.append(symbol)

    if not missing:
        return

    with ThreadPoolExecutor(max_workers=min(6, len(missing))) as executor:
        futures = {executor.submit(_fetch_etf_name, symbol): symbol for symbol in missing}
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                name = future.result()
            except Exception:
                name = None
            with _cache_lock:
                _name_cache[symbol] = name


def _shorten_name(name: str, max_len: int = 50) -> str:
    cleaned = re.sub(r"\s+", " ", name).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def format_etf_ticker_label(ticker: str, name: str | None = None) -> str:
    symbol = ticker.strip().upper()
    resolved = name if name is not None else lookup_etf_name(symbol)
    if resolved:
        return f"{symbol}({_shorten_name(resolved)})"
    return symbol


def etf_news_search_query(ticker: str, name: str | None = None) -> str:
    symbol = ticker.strip().upper()
    resolved = (name or lookup_etf_name(symbol) or symbol).strip()

    for pattern, query in _INDEX_QUERIES:
        if pattern.search(resolved):
            return query

    tokens = re.findall(r"[A-Za-z0-9&]+", resolved)
    kept: list[str] = []
    for token in tokens:
        if token.lower() in _STOP_WORDS:
            continue
        if len(token) == 1 and not token.isdigit():
            continue
        kept.append(token)

    if not kept:
        return f"{symbol} ETF"

    if len(kept) > 5:
        kept = kept[-4:]

    query = " ".join(kept[:5])
    if "etf" not in query.lower():
        query += " ETF"
    return query

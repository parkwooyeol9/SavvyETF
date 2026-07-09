"""Multi-source underlying price history for ADR event studies."""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Callable

import pandas as pd
import requests
import yfinance as yf

from adr_mapping import AdrProfile
from stock_crawler import _quiet_yfinance

FINNHUB_CANDLE_URL = "https://finnhub.io/api/v1/stock/candle"
FINNHUB_CHUNK_DAYS = 365

EXCHANGE_PROVIDERS: dict[str, list[str]] = {
    "TWSE": ["finnhub", "finmind", "eodhd", "yfinance"],
    "TSE": ["finnhub", "eodhd", "yfinance"],
    "HKEX": ["finnhub", "eodhd", "yfinance"],
    "LSE": ["finnhub", "eodhd", "yfinance"],
    "XETRA": ["finnhub", "eodhd", "yfinance"],
    "Euronext Amsterdam": ["finnhub", "eodhd", "yfinance"],
    "Euronext Paris": ["finnhub", "eodhd", "yfinance"],
    "OMX Copenhagen": ["finnhub", "eodhd", "yfinance"],
    "SIX Swiss": ["finnhub", "eodhd", "yfinance"],
    "NASDAQ (IPO)": ["finnhub", "yfinance", "eodhd"],
}

DEFAULT_PROVIDERS = ["finnhub", "eodhd", "yfinance"]

PROVIDER_LABELS = {
    "finnhub": "Finnhub",
    "finmind": "FinMind",
    "eodhd": "EODHD",
    "yfinance": "Yahoo Finance",
}


def _finnhub_api_key() -> str:
    return os.environ.get("FINNHUB_API_KEY", "").strip()


def _finmind_token() -> str:
    return os.environ.get("FINMIND_TOKEN", "").strip()


def _eodhd_api_key() -> str:
    return os.environ.get("EODHD_API_KEY", "").strip()


def _provider_has_credentials(provider: str) -> bool:
    checks = {
        "finnhub": _finnhub_api_key,
        "finmind": _finmind_token,
        "eodhd": _eodhd_api_key,
    }
    checker = checks.get(provider)
    return checker() != "" if checker else True


def _tw_stock_id(symbol: str) -> str:
    return symbol.split(".")[0]


def _date_to_unix(value: date) -> int:
    return int(datetime.combine(value, time.min, tzinfo=timezone.utc).timestamp())


def _end_of_day_unix(value: date) -> int:
    return int(datetime.combine(value, time.max, tzinfo=timezone.utc).timestamp())


def _finnhub_symbol_candidates(profile: AdrProfile, symbol: str) -> list[str]:
    candidates: list[str] = []
    if profile.finnhub_symbol:
        candidates.append(profile.finnhub_symbol)
    candidates.append(symbol)

    upper = symbol.upper()
    alternates = {
        ".AS": ".NL",
    }
    for source, target in alternates.items():
        if upper.endswith(source):
            candidates.append(upper[:- len(source)] + target)

    if profile.adr_symbol and profile.adr_symbol not in candidates:
        candidates.append(profile.adr_symbol)

    return list(dict.fromkeys(candidates))


def _normalize_history(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    out = df.copy()
    out.index = pd.to_datetime(out.index).tz_localize(None)
    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]

    rename = {
        "Close": "close",
        "close": "close",
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Volume": "volume",
        "volume": "volume",
    }
    out = out.rename(columns={k: v for k, v in rename.items() if k in out.columns})

    if "close" not in out.columns:
        return pd.DataFrame()

    if "volume" not in out.columns:
        out["volume"] = 0.0

    out = out[["close", "volume"]].astype(float)
    out["daily_return"] = out["close"].pct_change()
    return out.dropna(subset=["close"])


def _fetch_finnhub_candles(symbol: str, start: date, end: date, api_key: str) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    cursor = start

    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=FINNHUB_CHUNK_DAYS), end)
        response = requests.get(
            FINNHUB_CANDLE_URL,
            params={
                "symbol": symbol,
                "resolution": "D",
                "from": _date_to_unix(cursor),
                "to": _end_of_day_unix(chunk_end),
                "token": api_key,
            },
            timeout=60,
        )
        if not response.ok:
            raise ValueError(f"Finnhub HTTP {response.status_code}: {response.text[:200]}")

        payload = response.json()
        status = payload.get("s")
        if status == "no_data":
            if not frames:
                return pd.DataFrame()
            cursor = chunk_end + timedelta(days=1)
            continue
        if status != "ok":
            raise ValueError(payload.get("error", f"Finnhub status={status}"))

        timestamps = payload.get("t") or []
        closes = payload.get("c") or []
        if not timestamps or not closes:
            cursor = chunk_end + timedelta(days=1)
            continue

        volumes = payload.get("v") or [0.0] * len(timestamps)
        frame = pd.DataFrame(
            {
                "close": closes,
                "volume": volumes,
            },
            index=pd.to_datetime(timestamps, unit="s", utc=True).tz_localize(None),
        )
        frames.append(frame)
        cursor = chunk_end + timedelta(days=1)

    if not frames:
        return pd.DataFrame()
    return _normalize_history(pd.concat(frames))


def _fetch_finnhub(profile: AdrProfile, symbol: str, start: date, end: date) -> pd.DataFrame:
    api_key = _finnhub_api_key()
    if not api_key:
        return pd.DataFrame()

    errors: list[str] = []
    for candidate in _finnhub_symbol_candidates(profile, symbol):
        try:
            frame = _fetch_finnhub_candles(candidate, start, end, api_key)
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
            continue
        if not frame.empty:
            return frame
        errors.append(f"{candidate}: no rows returned")

    if errors:
        raise ValueError("; ".join(errors[:3]))
    return pd.DataFrame()


def _fetch_finmind(stock_id: str, start: date, end: date) -> pd.DataFrame:
    token = _finmind_token()
    if not token:
        return pd.DataFrame()

    response = requests.get(
        "https://api.finmindtrade.com/api/v4/data",
        headers={"Authorization": f"Bearer {token}"},
        params={
            "dataset": "TaiwanStockPriceAdj",
            "data_id": stock_id,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        },
        timeout=60,
    )
    if not response.ok:
        raise ValueError(f"FinMind HTTP {response.status_code}: {response.text[:200]}")

    payload = response.json()
    if payload.get("status") != 200:
        raise ValueError(payload.get("msg", "FinMind request failed"))

    rows = payload.get("data") or []
    if not rows:
        return pd.DataFrame()

    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.set_index("date")
    if "close" not in frame.columns:
        frame["close"] = frame.get("Close", frame.get("close"))
    if "volume" not in frame.columns:
        frame["volume"] = frame.get("Trading_Volume", frame.get("volume", 0))
    return _normalize_history(frame)


def _fetch_eodhd(symbol: str, start: date, end: date) -> pd.DataFrame:
    api_key = _eodhd_api_key()
    if not api_key:
        return pd.DataFrame()

    response = requests.get(
        f"https://eodhd.com/api/eod/{symbol}",
        params={
            "api_token": api_key,
            "fmt": "json",
            "from": start.isoformat(),
            "to": end.isoformat(),
            "period": "d",
            "order": "a",
        },
        timeout=60,
    )
    if not response.ok:
        raise ValueError(f"EODHD HTTP {response.status_code}: {response.text[:200]}")

    rows = response.json()
    if not isinstance(rows, list) or not rows:
        return pd.DataFrame()

    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.set_index("date")
    if "adjusted_close" in frame.columns:
        frame["close"] = frame["adjusted_close"]
    elif "close" in frame.columns:
        frame["close"] = frame["close"]
    frame["volume"] = frame.get("volume", 0)
    return _normalize_history(frame)


def _fetch_yfinance(symbol: str, start: date, end: date, fallback_symbol: str = "") -> pd.DataFrame:
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end) + pd.Timedelta(days=1)

    with _quiet_yfinance():
        raw = yf.Ticker(symbol).history(
            start=start_ts,
            end=end_ts,
            auto_adjust=True,
            actions=False,
        )
        if raw.empty and fallback_symbol and fallback_symbol != symbol:
            raw = yf.Ticker(fallback_symbol).history(
                start=start_ts,
                end=end_ts,
                auto_adjust=True,
                actions=False,
            )

    return _normalize_history(raw)


def _covers_listing(df: pd.DataFrame, listing: date) -> bool:
    if df.empty:
        return False
    return df.index.min().date() <= listing <= df.index.max().date()


def fetch_underlying_history(
    profile: AdrProfile,
    start: date,
    end: date,
    listing: date,
) -> tuple[pd.DataFrame, str]:
    """Return OHLCV history that includes the ADR listing date."""
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)

    symbol = profile.underlying_fetch_symbol or profile.underlying_symbol
    providers = EXCHANGE_PROVIDERS.get(profile.home_exchange, DEFAULT_PROVIDERS)
    attempts: list[str] = []

    fetchers: dict[str, Callable[[], pd.DataFrame]] = {
        "finnhub": lambda: _fetch_finnhub(profile, symbol, start, end),
        "finmind": lambda: _fetch_finmind(_tw_stock_id(symbol), start, end),
        "eodhd": lambda: _fetch_eodhd(symbol, start, end),
        "yfinance": lambda: _fetch_yfinance(symbol, start, end, profile.adr_symbol),
    }

    for provider in providers:
        if not _provider_has_credentials(provider):
            continue
        fetcher = fetchers.get(provider)
        if fetcher is None:
            continue
        try:
            df = fetcher()
        except Exception as exc:
            attempts.append(f"{PROVIDER_LABELS.get(provider, provider)}: {exc}")
            continue

        if df.empty:
            attempts.append(f"{PROVIDER_LABELS.get(provider, provider)}: no rows returned")
            continue

        if not _covers_listing(df, listing):
            attempts.append(
                f"{PROVIDER_LABELS.get(provider, provider)}: "
                f"history {df.index.min().date()}–{df.index.max().date()} "
                f"does not include listing {listing}"
            )
            continue

        label = PROVIDER_LABELS.get(provider, provider)
        return df, label

    lines = [
        f"No data source could supply {symbol} through the ADR listing date ({listing}).",
        f"Exchange: {profile.home_exchange}",
    ]
    if profile.listing_caveat:
        lines.append(profile.listing_caveat)
    if attempts:
        lines.append("Provider attempts:")
        lines.extend(f"  • {item}" for item in attempts)
    if not _finnhub_api_key():
        lines.append("Tip: set FINNHUB_API_KEY in .env (free at https://finnhub.io/).")
    if "TWSE" in profile.home_exchange and not _finmind_token():
        lines.append("Tip: set FINMIND_TOKEN in .env for deeper Taiwan history.")
    if not _eodhd_api_key():
        lines.append("Tip: set EODHD_API_KEY in .env for additional international coverage.")
    raise ValueError("\n".join(lines))

"""Multi-source underlying price history for ADR event studies.

Providers are fetched in parallel-ish sequence and **merged** (longest
listing-covering series as primary, others extend outer / fill holes)
instead of first-success failover — Yahoo alone is often too short pre-listing.
"""

from __future__ import annotations

import io
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
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
STOOQ_CSV_URL = "https://stooq.com/q/d/l/?s={symbol}&d1={start}&d2={end}&i=d"

# Prefer deep EOD sources first for merge primary selection.
EXCHANGE_PROVIDERS: dict[str, list[str]] = {
    "TWSE": ["finmind", "eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "TSE": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "HKEX": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "LSE": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "XETRA": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "Euronext Amsterdam": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "Euronext Paris": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "OMX Copenhagen": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "SIX Swiss": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
    "NASDAQ (IPO)": ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"],
}

DEFAULT_PROVIDERS = ["eodhd", "finnhub", "yahoo_chart", "yfinance", "stooq"]

PROVIDER_LABELS = {
    "finnhub": "Finnhub",
    "finmind": "FinMind",
    "eodhd": "EODHD",
    "stooq": "Stooq",
    "yahoo_chart": "Yahoo Chart",
    "yfinance": "Yahoo Finance",
}

# Yahoo-style suffix → Stooq country suffix (best-effort).
STOOQ_SUFFIX_BY_EXCHANGE: dict[str, str] = {
    "TWSE": "tw",
    "TSE": "jp",
    "HKEX": "hk",
    "LSE": "uk",
    "XETRA": "de",
    "Euronext Amsterdam": "nl",
    "Euronext Paris": "fr",
    "OMX Copenhagen": "dk",
    "SIX Swiss": "ch",
    "NASDAQ (IPO)": "us",
}

YAHOO_TO_STOOQ_SUFFIX = {
    "TW": "tw",
    "T": "jp",
    "HK": "hk",
    "L": "uk",
    "DE": "de",
    "AS": "nl",
    "PA": "fr",
    "CO": "dk",
    "SW": "ch",
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


def _stooq_symbol(yahoo_symbol: str, exchange: str) -> str | None:
    raw = (yahoo_symbol or "").strip().upper()
    if not raw:
        return None
    if "." in raw:
        base, suffix = raw.rsplit(".", 1)
        country = YAHOO_TO_STOOQ_SUFFIX.get(suffix)
    else:
        base, country = raw, STOOQ_SUFFIX_BY_EXCHANGE.get(exchange)
    if not country:
        country = STOOQ_SUFFIX_BY_EXCHANGE.get(exchange)
    if not country:
        return None
    # Stooq HK tickers are often zero-padded to 4 digits.
    if country == "hk" and base.isdigit():
        base = base.zfill(4)
    return f"{base.lower()}.{country}"


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
            candidates.append(upper[: -len(source)] + target)

    if profile.adr_symbol and profile.adr_symbol not in candidates:
        candidates.append(profile.adr_symbol)

    return list(dict.fromkeys(candidates))


def _normalize_history(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    out = df.copy()
    # Date-normalize so Yahoo Chart / yfinance same-day rows merge cleanly.
    out.index = pd.to_datetime(out.index).tz_localize(None).normalize()
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


def _fetch_stooq(symbol: str, exchange: str, start: date, end: date) -> pd.DataFrame:
    stooq = _stooq_symbol(symbol, exchange)
    if not stooq:
        return pd.DataFrame()

    url = STOOQ_CSV_URL.format(
        symbol=stooq,
        start=start.strftime("%Y%m%d"),
        end=end.strftime("%Y%m%d"),
    )
    response = requests.get(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; SavvyETF/1.0; "
                "+https://github.com/parkwooyeol9/SavvyETF)"
            ),
            "Referer": "https://stooq.com/",
        },
        timeout=45,
    )
    if not response.ok:
        raise ValueError(f"Stooq HTTP {response.status_code}")
    text = response.text.strip()
    if not text or text.lower().startswith("<!") or "no data" in text.lower():
        return pd.DataFrame()

    frame = pd.read_csv(io.StringIO(text))
    if frame.empty or "Close" not in frame.columns:
        # Stooq may return a single "No data" line
        return pd.DataFrame()
    frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
    frame = frame.dropna(subset=["Date"]).set_index("Date")
    frame["close"] = frame["Close"]
    frame["volume"] = frame.get("Volume", 0)
    return _normalize_history(frame)


def _fetch_yahoo_chart(symbol: str, start: date, end: date, fallback_symbol: str = "") -> pd.DataFrame:
    """Yahoo chart HTTP with explicit period1/period2 (often deeper than short yfinance windows)."""

    def _one(sym: str) -> pd.DataFrame:
        response = requests.get(
            YAHOO_CHART_URL.format(symbol=sym),
            params={
                "period1": _date_to_unix(start),
                "period2": _end_of_day_unix(end),
                "interval": "1d",
                "includePrePost": "false",
                "events": "history",
            },
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; SavvyETF/1.0; "
                    "+https://github.com/parkwooyeol9/SavvyETF)"
                )
            },
            timeout=45,
        )
        if not response.ok:
            return pd.DataFrame()
        results = ((response.json().get("chart") or {}).get("result")) or []
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
        return _normalize_history(frame)

    # Yahoo chart prefers BRK-B style; keep exchange dots for non-US.
    chart_symbol = symbol
    if symbol.count(".") == 1 and not symbol.upper().endswith((".TW", ".T", ".HK", ".L", ".DE", ".AS", ".PA", ".CO", ".SW", ".KS", ".KQ")):
        chart_symbol = symbol.replace(".", "-")

    frame = _one(chart_symbol)
    if frame.empty and fallback_symbol and fallback_symbol != symbol:
        frame = _one(fallback_symbol.replace(".", "-") if "." in fallback_symbol else fallback_symbol)
    return frame


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


def _covers_listing(df: pd.DataFrame, listing: date, *, grace_days: int = 370) -> bool:
    """True if history spans the listing date (with grace for sparse early Yahoo)."""
    if df.empty:
        return False
    dmin = df.index.min().date()
    dmax = df.index.max().date()
    if dmin <= listing <= dmax:
        return True
    # Very old ADRs (e.g. TSM 1996) often only appear on Yahoo ~1y later.
    if listing < dmin <= listing + timedelta(days=grace_days) and dmax > dmin:
        return True
    return False


def _span_days(df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    return int((df.index.max() - df.index.min()).days)


def _merge_histories(
    frames: list[tuple[str, pd.DataFrame]],
    listing: date,
    provider_order: list[str],
) -> tuple[pd.DataFrame, str]:
    """Longest listing-covering series as primary; others extend / fill missing dates."""
    usable = [(name, df) for name, df in frames if df is not None and not df.empty]
    if not usable:
        return pd.DataFrame(), ""

    covering = [(name, df) for name, df in usable if _covers_listing(df, listing)]
    if not covering:
        return pd.DataFrame(), ""

    order_rank = {name: idx for idx, name in enumerate(provider_order)}
    covering.sort(
        key=lambda item: (
            -_span_days(item[1]),
            order_rank.get(item[0], 99),
            -len(item[1]),
        )
    )
    primary_name, primary = covering[0]
    merged = primary[["close", "volume"]].copy()
    used: list[str] = [primary_name]

    others = [(name, df) for name, df in usable if name != primary_name]
    others.sort(
        key=lambda item: (
            -_span_days(item[1]),
            order_rank.get(item[0], 99),
            -len(item[1]),
        )
    )

    for name, df in others:
        add = df[["close", "volume"]]
        missing = add.index.difference(merged.index)
        if len(missing) == 0:
            continue
        piece = add.loc[missing]
        if piece.empty:
            continue
        merged = pd.concat([merged, piece]).sort_index()
        merged = merged[~merged.index.duplicated(keep="first")]
        used.append(name)

    merged = merged.sort_index()
    merged["daily_return"] = merged["close"].pct_change()

    labels = [PROVIDER_LABELS.get(name, name) for name in dict.fromkeys(used)]
    if len(labels) == 1:
        label = labels[0]
    else:
        label = f"{labels[0]} (primary) + " + " + ".join(f"{x}(extend)" for x in labels[1:])
    return merged.dropna(subset=["close"]), label


def fetch_underlying_history(
    profile: AdrProfile,
    start: date,
    end: date,
    listing: date,
) -> tuple[pd.DataFrame, str]:
    """Return OHLCV history that includes the ADR listing date (merged sources)."""
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)

    symbol = profile.underlying_fetch_symbol or profile.underlying_symbol
    providers = EXCHANGE_PROVIDERS.get(profile.home_exchange, DEFAULT_PROVIDERS)
    attempts: list[str] = []
    collected: list[tuple[str, pd.DataFrame]] = []

    fetchers: dict[str, Callable[[], pd.DataFrame]] = {
        "finnhub": lambda: _fetch_finnhub(profile, symbol, start, end),
        "finmind": lambda: _fetch_finmind(_tw_stock_id(symbol), start, end),
        "eodhd": lambda: _fetch_eodhd(symbol, start, end),
        "stooq": lambda: _fetch_stooq(symbol, profile.home_exchange, start, end),
        "yahoo_chart": lambda: _fetch_yahoo_chart(symbol, start, end, profile.adr_symbol),
        "yfinance": lambda: _fetch_yfinance(symbol, start, end, profile.adr_symbol),
    }

    for provider in providers:
        if not _provider_has_credentials(provider):
            attempts.append(
                f"{PROVIDER_LABELS.get(provider, provider)}: skipped (no API credentials)"
            )
            continue
        # Yahoo Chart already covers the same adjusted daily series — skip duplicate pull.
        if provider == "yfinance" and any(name == "yahoo_chart" for name, _ in collected):
            attempts.append("Yahoo Finance: skipped (Yahoo Chart already collected)")
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

        span = f"{df.index.min().date()}–{df.index.max().date()} ({len(df)} rows)"
        if not _covers_listing(df, listing):
            attempts.append(
                f"{PROVIDER_LABELS.get(provider, provider)}: {span} "
                f"(does not include listing {listing}; kept for extend/fill)"
            )
        else:
            attempts.append(
                f"{PROVIDER_LABELS.get(provider, provider)}: {span} (covers listing)"
            )
        collected.append((provider, df))
        print(f"ADR history {profile.adr_symbol}/{symbol}: {PROVIDER_LABELS.get(provider, provider)} {span}")

    merged, label = _merge_histories(collected, listing, providers)
    if not merged.empty and _covers_listing(merged, listing):
        print(
            f"ADR history merged for {profile.adr_symbol}: {label} "
            f"→ {merged.index.min().date()}–{merged.index.max().date()} ({len(merged)} rows)"
        )
        return merged, label

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

"""Supplementary macro data: Stooq market history and SEC EDGAR filing pulse."""

from __future__ import annotations

import io
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

from stock_crawler import _quiet_yfinance

KST = ZoneInfo("Asia/Seoul")
STOOQ_LOOKBACK_DAYS = 180
EDGAR_LOOKBACK_DAYS = 7
EDGAR_MACRO_LOOKBACK_DAYS = 14

STOOQ_MACRO_SYMBOLS: dict[str, str] = {
    "spy.us": "S&P 500 (SPY)",
    "qqq.us": "Nasdaq 100 (QQQ)",
    "tlt.us": "20Y Treasury (TLT)",
    "hyg.us": "High Yield (HYG)",
    "gld.us": "Gold (GLD)",
    "uso.us": "Oil (USO)",
    "uup.us": "US Dollar (UUP)",
    "ief.us": "7-10Y Treasury (IEF)",
}

EDGAR_8K_ITEM_LABELS: dict[str, str] = {
    "1.01": "Material agreement",
    "1.02": "Termination of agreement",
    "1.03": "Bankruptcy/receivership",
    "1.04": "Mine safety",
    "1.05": "Cybersecurity incident",
    "2.01": "Acquisition/disposal",
    "2.02": "Earnings release",
    "2.03": "Debt creation",
    "2.04": "Triggering event (debt)",
    "2.05": "Director/officer change",
    "2.06": "Material impairments",
    "3.01": "Delisting notice",
    "3.02": "Unregistered equity sales",
    "3.03": "Shareholder rights change",
    "5.02": "Director/officer appointment",
    "7.01": "Regulation FD disclosure",
    "8.01": "Other events",
    "9.01": "Financial statements/exhibits",
}

MACRO_EDGAR_QUERY = (
    '"guidance" OR "outlook" OR inflation OR recession OR '
    '"interest rate" OR macroeconomic OR layoff'
)


def _sec_user_agent() -> str:
    custom = os.environ.get("SEC_EDGAR_USER_AGENT", "").strip()
    if custom:
        return custom
    email = os.environ.get("SEC_CONTACT_EMAIL", "").strip()
    if email:
        return f"SavvyETF/1.0 ({email})"
    return "SavvyETF/1.0 (macro-data@localhost)"


def _sec_headers() -> dict[str, str]:
    return {
        "User-Agent": _sec_user_agent(),
        "Accept": "application/json",
    }


def _stooq_headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/csv,text/plain,*/*",
        "Referer": "https://stooq.com/",
    }


def _date_range(days: int) -> tuple[str, str]:
    end = datetime.now(KST).date()
    start = end - timedelta(days=days)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


def fetch_stooq_close(symbol: str, lookback_days: int = STOOQ_LOOKBACK_DAYS) -> pd.Series:
    """Download daily close prices from Stooq CSV endpoint."""
    start, end = _date_range(lookback_days)
    symbol = symbol.lower().strip()
    url = f"https://stooq.com/q/d/l/?s={symbol}&d1={start}&d2={end}&i=d"
    response = requests.get(url, headers=_stooq_headers(), timeout=25)
    response.raise_for_status()
    text = response.text.strip()
    if not text.startswith("Date"):
        raise ValueError(f"Stooq returned non-CSV payload for {symbol}")

    frame = pd.read_csv(io.StringIO(text))
    frame.columns = [str(col).strip().title() for col in frame.columns]
    if "Date" not in frame.columns or "Close" not in frame.columns:
        raise ValueError(f"Unexpected Stooq columns for {symbol}: {list(frame.columns)}")

    frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
    frame["Close"] = pd.to_numeric(frame["Close"], errors="coerce")
    series = frame.dropna(subset=["Date", "Close"]).set_index("Date")["Close"].sort_index()
    series.name = symbol
    return series


def fetch_stooq_macro_history(
    symbols: dict[str, str] | None = None,
    lookback_days: int = STOOQ_LOOKBACK_DAYS,
) -> tuple[pd.DataFrame, list[str]]:
    """Fetch multiple Stooq macro proxies; return combined frame and per-symbol errors."""
    symbols = symbols or STOOQ_MACRO_SYMBOLS
    frames: dict[str, pd.Series] = {}
    errors: list[str] = []

    for symbol in symbols:
        try:
            frames[symbol] = fetch_stooq_close(symbol, lookback_days=lookback_days)
        except Exception as exc:
            errors.append(f"{symbol}: {exc}")

    if not frames:
        return pd.DataFrame(), errors

    market = pd.DataFrame(frames).dropna(how="all")
    if {"hyg.us", "tlt.us"}.issubset(market.columns):
        market["HYG_TLT_stooq"] = market["hyg.us"] / market["tlt.us"]
    return market, errors


def _pct_change(series: pd.Series, days: int) -> float | None:
    clean = series.dropna()
    if len(clean) <= days:
        return None
    start = float(clean.iloc[-days - 1])
    end = float(clean.iloc[-1])
    if start == 0:
        return None
    return (end / start - 1) * 100


def build_stooq_snapshot(stooq_market: pd.DataFrame, labels: dict[str, str] | None = None) -> dict[str, Any]:
    labels = labels or STOOQ_MACRO_SYMBOLS
    moves: dict[str, float | None] = {}
    latest: dict[str, float | None] = {}

    for symbol, label in labels.items():
        if symbol not in stooq_market.columns:
            continue
        series = stooq_market[symbol].dropna()
        if series.empty:
            continue
        latest[label] = float(series.iloc[-1])
        moves[label] = _pct_change(series, 5)
        moves[f"{label} (20d)"] = _pct_change(series, 20)

    hyg_tlt = stooq_market.get("HYG_TLT_stooq")
    hyg_tlt_20d = _pct_change(hyg_tlt, 20) if hyg_tlt is not None else None

    return {
        "latest": latest,
        "moves_5d": {k: v for k, v in moves.items() if not k.endswith("(20d)")},
        "moves_20d": {k: v for k, v in moves.items() if k.endswith("(20d)")},
        "hyg_tlt_20d": hyg_tlt_20d,
        "symbol_count": len(latest),
    }


def _parse_company_name(display_name: str) -> str:
    text = display_name.strip()
    text = re.sub(r"\s*\(CIK.*$", "", text)
    text = re.sub(r"\s*\([A-Z]{1,5}\)\s*$", "", text)
    return text.strip() or display_name


def _edgar_filing_url(hit: dict[str, Any]) -> str:
    source = hit.get("_source", {})
    adsh = str(source.get("adsh", "")).replace("-", "")
    ciks = source.get("ciks") or []
    if not adsh or not ciks:
        return ""
    cik = str(int(ciks[0]))
    filing_id = hit.get("_id", "")
    filename = filing_id.split(":", 1)[-1] if ":" in filing_id else ""
    if not filename:
        return f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}"
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{adsh}/{filename}"


def _fetch_edgar_search(params: dict[str, Any]) -> dict[str, Any]:
    response = requests.get(
        "https://efts.sec.gov/LATEST/search-index",
        params=params,
        headers=_sec_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def _normalize_edgar_hit(hit: dict[str, Any]) -> dict[str, str]:
    source = hit.get("_source", {})
    display_names = source.get("display_names") or []
    company = _parse_company_name(display_names[0]) if display_names else "Unknown filer"
    items = source.get("items") or []
    item_labels = [EDGAR_8K_ITEM_LABELS.get(item, item) for item in items[:2]]
    return {
        "company": company,
        "form": str(source.get("form") or source.get("root_forms", ["?"])[0]),
        "file_date": str(source.get("file_date") or ""),
        "items": ", ".join(items) if items else "",
        "item_summary": ", ".join(item_labels) if item_labels else "",
        "url": _edgar_filing_url(hit),
    }


def fetch_edgar_8k_pulse(days: int = EDGAR_LOOKBACK_DAYS, sample_size: int = 8) -> dict[str, Any]:
    end = datetime.now(KST).date()
    start = end - timedelta(days=days)
    params = {
        "forms": "8-K",
        "dateRange": "custom",
        "startdt": start.isoformat(),
        "enddt": end.isoformat(),
        "from": 0,
        "size": min(sample_size, 100),
    }
    payload = _fetch_edgar_search(params)
    hits = payload.get("hits", {})
    total = hits.get("total", {})
    count = int(total.get("value", 0)) if isinstance(total, dict) else 0
    filings = [_normalize_edgar_hit(hit) for hit in hits.get("hits", [])]

    item_counts: dict[str, int] = {}
    for hit in hits.get("hits", []):
        for item in hit.get("_source", {}).get("items") or []:
            item_counts[item] = item_counts.get(item, 0) + 1
    top_items = sorted(item_counts.items(), key=lambda pair: pair[1], reverse=True)[:5]

    return {
        "window_days": days,
        "filing_count": count,
        "recent_filings": filings,
        "top_items": [
            {"item": item, "label": EDGAR_8K_ITEM_LABELS.get(item, item), "count": count_}
            for item, count_ in top_items
        ],
    }


def fetch_edgar_macro_mentions(days: int = EDGAR_MACRO_LOOKBACK_DAYS, sample_size: int = 6) -> dict[str, Any]:
    end = datetime.now(KST).date()
    start = end - timedelta(days=days)
    params = {
        "q": MACRO_EDGAR_QUERY,
        "forms": "8-K,10-Q,10-K",
        "dateRange": "custom",
        "startdt": start.isoformat(),
        "enddt": end.isoformat(),
        "from": 0,
        "size": min(sample_size, 100),
    }
    payload = _fetch_edgar_search(params)
    hits = payload.get("hits", {})
    total = hits.get("total", {})
    count = int(total.get("value", 0)) if isinstance(total, dict) else 0
    filings = [_normalize_edgar_hit(hit) for hit in hits.get("hits", [])]
    return {
        "window_days": days,
        "mention_count": count,
        "filings": filings,
        "query": MACRO_EDGAR_QUERY,
    }


def build_edgar_snapshot() -> dict[str, Any]:
    errors: list[str] = []
    pulse: dict[str, Any] = {}
    mentions: dict[str, Any] = {}

    try:
        pulse = fetch_edgar_8k_pulse()
    except Exception as exc:
        errors.append(f"8-K pulse: {exc}")

    try:
        mentions = fetch_edgar_macro_mentions()
    except Exception as exc:
        errors.append(f"macro mentions: {exc}")

    return {
        "pulse": pulse,
        "macro_mentions": mentions,
        "errors": errors,
    }


STOOQ_YAHOO_FALLBACK = {
    "spy.us": "SPY",
    "qqq.us": "QQQ",
    "tlt.us": "TLT",
    "hyg.us": "HYG",
    "gld.us": "GLD",
    "uso.us": "USO",
    "uup.us": "UUP",
    "ief.us": "IEF",
}


def _fetch_yahoo_fallback_history(lookback_days: int = STOOQ_LOOKBACK_DAYS) -> pd.DataFrame:
    tickers = list(STOOQ_YAHOO_FALLBACK.values())
    period = "6mo" if lookback_days >= 120 else "3mo"
    with _quiet_yfinance():
        raw = yf.download(
            tickers,
            period=period,
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    if raw.empty:
        return pd.DataFrame()

    frames: dict[str, pd.Series] = {}
    for stooq_symbol, yahoo_ticker in STOOQ_YAHOO_FALLBACK.items():
        try:
            if len(tickers) == 1:
                close = raw["Close"]
            else:
                close = raw[yahoo_ticker]["Close"]
            frames[stooq_symbol] = close.dropna()
        except (KeyError, TypeError):
            continue

    if not frames:
        return pd.DataFrame()

    market = pd.DataFrame(frames).dropna(how="all")
    if {"hyg.us", "tlt.us"}.issubset(market.columns):
        market["HYG_TLT_stooq"] = market["hyg.us"] / market["tlt.us"]
    return market


def build_stooq_bundle() -> dict[str, Any]:
    market, errors = fetch_stooq_macro_history()
    used_fallback = False
    if market.empty:
        market = _fetch_yahoo_fallback_history()
        used_fallback = bool(not market.empty)
        if used_fallback:
            errors.append("Stooq blocked/unavailable — using Yahoo Finance fallback for cross-asset data.")

    snapshot = build_stooq_snapshot(market) if not market.empty else {}
    return {
        "market": market,
        "snapshot": snapshot,
        "errors": errors,
        "available": not market.empty,
        "used_yahoo_fallback": used_fallback,
    }


FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
FINNHUB_CALENDAR_BACK_DAYS = 2
FINNHUB_CALENDAR_FORWARD_DAYS = 7
FINNHUB_NEWS_PER_CATEGORY = 6

FINNHUB_MACRO_QUOTES: dict[str, str] = {
    "SPY": "S&P 500",
    "QQQ": "Nasdaq 100",
    "TLT": "20Y Treasury",
    "GLD": "Gold",
    "USO": "Oil",
    "HYG": "High Yield",
}

FINNHUB_FOREX_QUOTES: dict[str, str] = {
    "OANDA:EUR_USD": "EUR/USD",
    "OANDA:USD_JPY": "USD/JPY",
}


def _finnhub_api_key() -> str:
    return os.environ.get("FINNHUB_API_KEY", "").strip()


def _finnhub_get(path: str, params: dict[str, Any] | None = None) -> Any:
    api_key = _finnhub_api_key()
    if not api_key:
        raise RuntimeError("FINNHUB_API_KEY not set")
    query = dict(params or {})
    query["token"] = api_key
    response = requests.get(f"{FINNHUB_BASE_URL}/{path}", params=query, timeout=25)
    response.raise_for_status()
    return response.json()


def _impact_rank(impact: str) -> int:
    mapping = {"high": 3, "medium": 2, "low": 1}
    return mapping.get(str(impact).lower(), 0)


def fetch_finnhub_economic_calendar(
    days_back: int = FINNHUB_CALENDAR_BACK_DAYS,
    days_forward: int = FINNHUB_CALENDAR_FORWARD_DAYS,
) -> list[dict[str, Any]]:
    end = datetime.now(KST).date() + timedelta(days=days_forward)
    start = datetime.now(KST).date() - timedelta(days=days_back)
    payload = _finnhub_get(
        "calendar/economic",
        {"from": start.isoformat(), "to": end.isoformat()},
    )
    events = payload.get("economicCalendar") or []
    normalized: list[dict[str, Any]] = []
    for event in events:
        country = str(event.get("country") or "").upper()
        impact = str(event.get("impact") or "").lower()
        if country not in {"US", "EU", "CN", "GB", "JP"} and impact != "high":
            continue
        normalized.append(
            {
                "date": str(event.get("date") or ""),
                "time": str(event.get("time") or ""),
                "country": country,
                "event": str(event.get("event") or "").strip(),
                "impact": impact,
                "actual": event.get("actual"),
                "estimate": event.get("estimate"),
                "prev": event.get("prev"),
                "unit": str(event.get("unit") or "").strip(),
            }
        )

    normalized.sort(
        key=lambda row: (
            row.get("date", ""),
            -_impact_rank(row.get("impact", "")),
            row.get("time", ""),
        )
    )
    return normalized


def fetch_finnhub_market_news(limit_per_category: int = FINNHUB_NEWS_PER_CATEGORY) -> list[dict[str, str]]:
    headlines: list[dict[str, str]] = []
    seen: set[str] = set()
    for category in ("general", "forex"):
        items = _finnhub_get("news", {"category": category})
        if not isinstance(items, list):
            continue
        for item in items[:limit_per_category]:
            title = str(item.get("headline") or "").strip()
            if not title:
                continue
            key = re.sub(r"[^a-z0-9]+", "", title.lower())
            if key in seen:
                continue
            seen.add(key)
            ts = item.get("datetime")
            if isinstance(ts, (int, float)):
                published = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            else:
                published = ""
            headlines.append(
                {
                    "category": category,
                    "headline": title,
                    "source": str(item.get("source") or "Finnhub"),
                    "published": published,
                    "summary": str(item.get("summary") or "").strip()[:220],
                }
            )
    return headlines


def fetch_finnhub_quotes(symbols: dict[str, str]) -> dict[str, dict[str, float | None]]:
    quotes: dict[str, dict[str, float | None]] = {}
    for symbol, label in symbols.items():
        try:
            payload = _finnhub_get("quote", {"symbol": symbol})
        except Exception:
            continue
        quotes[label] = {
            "price": _safe_float(payload.get("c")),
            "change_pct": _safe_float(payload.get("dp")),
            "prev_close": _safe_float(payload.get("pc")),
        }
    return quotes


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def build_finnhub_bundle() -> dict[str, Any]:
    if not _finnhub_api_key():
        return {"available": False, "errors": ["FINNHUB_API_KEY not set"]}

    errors: list[str] = []
    calendar: list[dict[str, Any]] = []
    news: list[dict[str, str]] = []
    quotes: dict[str, dict[str, float | None]] = {}
    forex: dict[str, dict[str, float | None]] = {}

    try:
        calendar = fetch_finnhub_economic_calendar()
    except Exception as exc:
        errors.append(f"economic calendar: {exc}")

    try:
        news = fetch_finnhub_market_news()
    except Exception as exc:
        errors.append(f"market news: {exc}")

    try:
        quotes = fetch_finnhub_quotes(FINNHUB_MACRO_QUOTES)
    except Exception as exc:
        errors.append(f"quotes: {exc}")

    try:
        forex = fetch_finnhub_quotes(FINNHUB_FOREX_QUOTES)
    except Exception as exc:
        errors.append(f"forex: {exc}")

    high_impact_upcoming = [
        row
        for row in calendar
        if row.get("impact") == "high" and row.get("country") == "US" and not row.get("actual")
    ]
    recent_releases = [
        row
        for row in calendar
        if row.get("actual") not in (None, "") and row.get("country") == "US"
    ][:5]

    return {
        "available": bool(calendar or news or quotes or forex),
        "calendar": calendar,
        "high_impact_upcoming": high_impact_upcoming[:6],
        "recent_releases": recent_releases,
        "news": news[:8],
        "quotes": quotes,
        "forex": forex,
        "errors": errors,
    }

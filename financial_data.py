"""Fundamental financial data for /financial — Finnhub primary, Yahoo Finance fallback."""

from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

from stock_crawler import _quiet_yfinance, load_sp500_tickers

KST = ZoneInfo("Asia/Seoul")
FINNHUB_BASE = "https://finnhub.io/api/v1"

_SP500_CACHE: set[str] | None = None

METRIC_LABELS: dict[str, str] = {
    "peTTM": "PER (TTM)",
    "peBasicExclExtraTTM": "PER (TTM)",
    "pbAnnual": "PBR",
    "pbQuarterly": "PBR",
    "roeTTM": "ROE (TTM)",
    "roe5Y": "ROE (5Y avg)",
    "epsGrowth3Y": "EPS growth (3Y)",
    "epsGrowth5Y": "EPS growth (5Y)",
    "epsGrowthQuarterlyYoy": "EPS growth (YoY)",
    "revenueGrowth3Y": "Revenue growth (3Y)",
    "revenueGrowth5Y": "Revenue growth (5Y)",
    "revenueGrowthQuarterlyYoy": "Revenue growth (YoY)",
    "netMargin": "Net margin",
    "grossMargin": "Gross margin",
    "operatingMargin": "Operating margin",
    "epsTTM": "EPS (TTM)",
    "revenuePerShareTTM": "Revenue / share (TTM)",
    "marketCapitalization": "Market cap",
    "dividendYieldIndicatedAnnual": "Dividend yield",
    "beta": "Beta",
    "52WeekHigh": "52W high",
    "52WeekLow": "52W low",
}

SERIES_ALIASES: dict[str, list[str]] = {
    "revenue": ["revenuePerShare", "salesPerShare", "totalRevenue"],
    "eps": ["eps", "epsBasic", "epsDiluted", "dilutedEPS"],
    "net_margin": ["netMargin"],
    "gross_margin": ["grossMargin"],
    "operating_margin": ["operatingMargin"],
    "roe": ["roe", "roeTTM"],
    "pe": ["pe", "peTTM", "peBasicExclExtraTTM"],
    "pb": ["pb", "pbAnnual", "pbQuarterly"],
}


def parse_financial_ticker(command: str) -> str:
    parts = command.strip().split()
    if len(parts) < 2:
        raise ValueError("missing ticker")
    symbol = parts[1].upper().strip()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", symbol):
        raise ValueError(f"invalid ticker: {symbol}")
    return symbol


def sp500_membership(symbol: str) -> tuple[bool, str | None]:
    global _SP500_CACHE
    if _SP500_CACHE is None:
        try:
            _SP500_CACHE = {ticker.upper() for ticker in load_sp500_tickers()}
        except Exception as exc:
            print(f"S&P 500 list unavailable: {exc}")
            _SP500_CACHE = set()
    if not _SP500_CACHE:
        return True, None
    if symbol.upper() in _SP500_CACHE:
        return True, None
    return False, f"{symbol} is not in the current S&P 500 list (analysis will still run)."


def _finnhub_company_card(symbol: str) -> dict[str, Any]:
    """Lightweight name/sector from Finnhub — avoids Yahoo .info for single-ticker runs."""
    payload = _finnhub_get("/stock/profile2", {"symbol": symbol})
    if not isinstance(payload, dict) or not payload:
        return {}
    return {
        "company_name": payload.get("name") or symbol,
        "sector": payload.get("finnhubIndustry") or payload.get("gicsSector") or "n/a",
        "currency": payload.get("currency") or "USD",
        "market_cap": _safe_float(payload.get("marketCapitalization")),
    }


def _finnhub_has_chart_series(finnhub: dict[str, Any]) -> bool:
    series = finnhub.get("series") or {}
    for freq in ("annual", "quarterly"):
        bucket = series.get(freq) or {}
        if not isinstance(bucket, dict):
            continue
        for aliases in SERIES_ALIASES.values():
            for alias in aliases:
                if bucket.get(alias):
                    return True
    return False


def _fetch_yfinance_profile(symbol: str, *, light: bool = False) -> dict[str, Any]:
    profile: dict[str, Any] = {"symbol": symbol, "sources": [], "errors": []}
    try:
        with _quiet_yfinance():
            ticker = yf.Ticker(symbol)
            if light:
                # Income statement only — enough to fill chart gaps without .info.
                annual_income = getattr(ticker, "income_stmt", None)
                if annual_income is not None and not annual_income.empty:
                    profile["sources"].append("Yahoo Finance")
                    profile["annual_income"] = annual_income
                    profile["info"] = {"shortName": symbol}
                else:
                    profile["errors"].append("Yahoo Finance income statement unavailable")
                return profile

            info = ticker.info or {}
            if not info or (
                info.get("regularMarketPrice") is None and info.get("currentPrice") is None
            ):
                profile["errors"].append("Yahoo Finance info unavailable")
                return profile

            profile["sources"].append("Yahoo Finance")
            profile["info"] = info

            annual_income = getattr(ticker, "income_stmt", None)
            quarterly_income = getattr(ticker, "quarterly_income_stmt", None)
            if annual_income is not None and not annual_income.empty:
                profile["annual_income"] = annual_income
            if quarterly_income is not None and not quarterly_income.empty:
                profile["quarterly_income"] = quarterly_income

            try:
                earnings = ticker.get_earnings_history()
                if earnings is not None and not earnings.empty:
                    profile["earnings_history_df"] = earnings
            except Exception:
                pass
    except Exception as exc:
        profile["errors"].append(f"Yahoo Finance error: {exc}")

    return profile


def _finnhub_api_key() -> str:
    return os.environ.get("FINNHUB_API_KEY", "").strip()


def _finnhub_get(path: str, params: dict[str, Any]) -> dict | list | None:
    key = _finnhub_api_key()
    if not key:
        return None
    try:
        response = requests.get(
            f"{FINNHUB_BASE}{path}",
            params={**params, "token": key},
            timeout=25,
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        print(f"Finnhub {path} failed: {exc}")
        return None


def _series_from_finnhub(payload: dict | None, key: str, freq: str = "annual") -> pd.Series:
    if not payload:
        return pd.Series(dtype=float)
    series_root = payload.get("series") or {}
    bucket = series_root.get(freq) or {}
    for alias in SERIES_ALIASES.get(key, [key]):
        points = bucket.get(alias)
        if not points:
            continue
        frame = pd.DataFrame(points)
        if frame.empty or "period" not in frame.columns or "v" not in frame.columns:
            continue
        frame["period"] = pd.to_datetime(frame["period"], errors="coerce")
        frame = frame.dropna(subset=["period"]).sort_values("period")
        values = pd.to_numeric(frame["v"], errors="coerce")
        return pd.Series(values.values, index=frame["period"], name=alias)
    return pd.Series(dtype=float)


def _fetch_finnhub_profile(symbol: str, *, light: bool = False) -> dict[str, Any]:
    profile: dict[str, Any] = {"symbol": symbol, "sources": [], "errors": []}
    metrics = _finnhub_get("/stock/metric", {"symbol": symbol, "metric": "all"})
    if not metrics:
        profile["errors"].append("Finnhub metrics unavailable")
        return profile

    profile["sources"].append("Finnhub")
    profile["metric_snapshot"] = metrics.get("metric") or {}
    profile["series"] = {
        "annual": metrics.get("series", {}).get("annual") or {},
        "quarterly": metrics.get("series", {}).get("quarterly") or {},
    }

    if light:
        # Metric endpoint already carries annual/quarterly series for charts.
        return profile

    earnings = _finnhub_get("/stock/earnings", {"symbol": symbol, "limit": 12})
    if isinstance(earnings, list):
        profile["earnings_history"] = earnings

    income = _finnhub_get(
        "/stock/financials",
        {"symbol": symbol, "statement": "ic", "freq": "annual"},
    )
    if isinstance(income, dict) and income.get("financials"):
        profile["income_statement_annual"] = income["financials"]

    return profile


def _pick_metric(snapshot: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = snapshot.get(key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def _income_row(frame: pd.DataFrame, labels: list[str]) -> pd.Series | None:
    for label in labels:
        if label in frame.index:
            series = pd.to_numeric(frame.loc[label], errors="coerce").dropna()
            if not series.empty:
                return series.sort_index()
    return None


def _build_timeseries(finnhub: dict[str, Any], yfinance: dict[str, Any]) -> dict[str, pd.Series]:
    series: dict[str, pd.Series] = {}

    finnhub_payload = {"series": finnhub.get("series")} if finnhub.get("series") else None
    for key in SERIES_ALIASES:
        finnhub_series = _series_from_finnhub(finnhub_payload, key, freq="annual")
        if not finnhub_series.empty:
            series[key] = finnhub_series.tail(12)
            continue
        finnhub_series = _series_from_finnhub(finnhub_payload, key, freq="quarterly")
        if not finnhub_series.empty:
            series[key] = finnhub_series.tail(16)

    annual_income = yfinance.get("annual_income")
    if annual_income is not None and not annual_income.empty:
        if "revenue" not in series:
            revenue = _income_row(
                annual_income,
                ["Total Revenue", "TotalRevenue", "Revenue"],
            )
            if revenue is not None:
                series["revenue"] = revenue.tail(12)
        if "eps" not in series:
            eps = _income_row(
                annual_income,
                [
                    "Diluted EPS",
                    "Basic EPS",
                    "Diluted EPS From Continuing Operations",
                ],
            )
            if eps is not None:
                series["eps"] = eps.tail(12)

    return series


def _format_pct(value: float | None, *, signed: bool = False) -> str:
    if value is None:
        return "n/a"
    if abs(value) <= 1.5:
        pct = value * 100
    else:
        pct = value
    if signed:
        return f"{pct:+.1f}%"
    return f"{pct:.1f}%"


def _format_multiple(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.2f}x"


def _format_large_number(value: float | None) -> str:
    if value is None:
        return "n/a"
    abs_value = abs(value)
    if abs_value >= 1_000_000_000_000:
        return f"${value / 1_000_000_000_000:.2f}T"
    if abs_value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.2f}B"
    if abs_value >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    return f"${value:,.0f}"


def build_financial_profile(
    symbol: str,
    *,
    check_sp500: bool = True,
    light: bool = False,
) -> dict[str, Any]:
    """Build fundamentals for one ticker.

    ``light=True`` (used by /reddit): skip S&P 500 universe load, prefer Finnhub,
    and only hit Yahoo for the same ticker when chart series are missing.
    """
    symbol = symbol.upper()
    if check_sp500 and not light:
        in_sp500, sp_note = sp500_membership(symbol)
    else:
        in_sp500, sp_note = True, None

    finnhub = _fetch_finnhub_profile(symbol, light=light)
    company = _finnhub_company_card(symbol) if light else {}

    need_yahoo = True
    if light and finnhub.get("metric_snapshot") and _finnhub_has_chart_series(finnhub):
        need_yahoo = False
    elif light and finnhub.get("metric_snapshot") and company:
        # Metrics ok; Yahoo only if we still want chart series.
        need_yahoo = not _finnhub_has_chart_series(finnhub)

    if need_yahoo:
        yfinance_profile = _fetch_yfinance_profile(symbol, light=light)
    else:
        yfinance_profile = {"symbol": symbol, "sources": [], "errors": [], "info": {}}
        print(f"Financial {symbol}: Finnhub-only light path (skip Yahoo)")

    if not finnhub.get("metric_snapshot") and not yfinance_profile.get("info"):
        raise RuntimeError(
            f"Could not load fundamentals for {symbol}. "
            "Set FINNHUB_API_KEY or check the ticker symbol."
        )

    finnhub_snap = finnhub.get("metric_snapshot") or {}
    yf_info = yfinance_profile.get("info") or {}

    company_name = (
        company.get("company_name")
        or yf_info.get("longName")
        or yf_info.get("shortName")
        or symbol
    )
    sector = company.get("sector") or yf_info.get("sector") or yf_info.get("industry") or "n/a"
    currency = company.get("currency") or yf_info.get("currency") or "USD"

    metrics = {
        "per": _pick_metric(finnhub_snap, ["peTTM", "peBasicExclExtraTTM"])
        or _safe_float(yf_info.get("trailingPE")),
        "forward_per": _safe_float(yf_info.get("forwardPE")),
        "pbr": _pick_metric(finnhub_snap, ["pbAnnual", "pbQuarterly"])
        or _safe_float(yf_info.get("priceToBook")),
        "roe": _pick_metric(finnhub_snap, ["roeTTM", "roe5Y"])
        or _safe_float(yf_info.get("returnOnEquity")),
        "net_margin": _pick_metric(finnhub_snap, ["netMargin"])
        or _safe_float(yf_info.get("profitMargins")),
        "gross_margin": _pick_metric(finnhub_snap, ["grossMargin"])
        or _safe_float(yf_info.get("grossMargins")),
        "operating_margin": _pick_metric(finnhub_snap, ["operatingMargin"])
        or _safe_float(yf_info.get("operatingMargins")),
        "eps_growth_yoy": _pick_metric(finnhub_snap, ["epsGrowthQuarterlyYoy"])
        or _safe_float(yf_info.get("earningsGrowth")),
        "revenue_growth_yoy": _pick_metric(
            finnhub_snap,
            ["revenueGrowthQuarterlyYoy", "revenueGrowth3Y"],
        )
        or _safe_float(yf_info.get("revenueGrowth")),
        "eps_ttm": _pick_metric(finnhub_snap, ["epsTTM"])
        or _safe_float(yf_info.get("trailingEps")),
        "market_cap": _pick_metric(finnhub_snap, ["marketCapitalization"])
        or company.get("market_cap")
        or _safe_float(yf_info.get("marketCap")),
        "dividend_yield": _pick_metric(finnhub_snap, ["dividendYieldIndicatedAnnual"])
        or _safe_float(yf_info.get("dividendYield")),
        "beta": _pick_metric(finnhub_snap, ["beta"]) or _safe_float(yf_info.get("beta")),
    }

    timeseries = _build_timeseries(finnhub, yfinance_profile)
    sources = sorted(set(finnhub.get("sources", []) + yfinance_profile.get("sources", [])))
    if company and "Finnhub" not in sources and (finnhub.get("sources") or company.get("company_name")):
        sources = sorted(set(sources + ["Finnhub"]))

    latest_revenue = None
    if "revenue" in timeseries and not timeseries["revenue"].empty:
        latest_revenue = float(timeseries["revenue"].iloc[-1])

    return {
        "symbol": symbol,
        "company_name": company_name,
        "sector": sector,
        "currency": currency,
        "in_sp500": in_sp500,
        "sp500_note": sp_note,
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "metrics": metrics,
        "timeseries": timeseries,
        "finnhub_snapshot": finnhub_snap if not light else {},
        "sources": sources,
        "latest_revenue": latest_revenue,
        "errors": finnhub.get("errors", []) + yfinance_profile.get("errors", []),
        "light": light,
    }


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(number):
        return None
    return number


def format_financial_telegram(profile: dict[str, Any]) -> str:
    metrics = profile["metrics"]
    lines = [
        f"<b>📊 Financial analysis — {profile['symbol']}</b>",
        f"{profile['company_name']} · {profile['sector']}",
        f"<i>{profile['generated_at']}</i>",
    ]
    if profile.get("sp500_note"):
        lines.append(f"<i>{profile['sp500_note']}</i>")

    lines.extend(
        [
            "",
            "<b>Valuation</b>",
            f"PER (TTM): <code>{_format_multiple(metrics['per'])}</code>"
            + (
                f" · Forward: <code>{_format_multiple(metrics['forward_per'])}</code>"
                if metrics.get("forward_per") is not None
                else ""
            ),
            f"PBR: <code>{_format_multiple(metrics['pbr'])}</code>",
            f"Market cap: <code>{_format_large_number(metrics['market_cap'])}</code>",
            "",
            "<b>Profitability</b>",
            f"ROE: <code>{_format_pct(metrics['roe'])}</code>",
            f"Gross margin: <code>{_format_pct(metrics['gross_margin'])}</code>",
            f"Operating margin: <code>{_format_pct(metrics['operating_margin'])}</code>",
            f"Net margin: <code>{_format_pct(metrics['net_margin'])}</code>",
            "",
            "<b>Growth</b>",
            f"EPS growth (YoY): <code>{_format_pct(metrics['eps_growth_yoy'], signed=True)}</code>",
            f"Revenue growth (YoY): <code>{_format_pct(metrics['revenue_growth_yoy'], signed=True)}</code>",
            f"EPS (TTM): <code>{metrics['eps_ttm']:.2f}</code>"
            if metrics.get("eps_ttm") is not None
            else "EPS (TTM): <code>n/a</code>",
        ]
    )

    if metrics.get("dividend_yield") is not None:
        lines.append(f"Dividend yield: <code>{_format_pct(metrics['dividend_yield'])}</code>")
    if metrics.get("beta") is not None:
        lines.append(f"Beta: <code>{metrics['beta']:.2f}</code>")

    if profile.get("latest_revenue") is not None:
        rev = profile["latest_revenue"]
        if rev > 1_000_000:
            lines.append(f"Latest annual revenue: <code>{_format_large_number(rev)}</code>")
        else:
            lines.append(f"Latest revenue / share: <code>{rev:.2f}</code>")

    lines.append("")
    sources = ", ".join(profile.get("sources") or ["n/a"])
    lines.append(f"<i>Sources: {sources}</i>")
    if profile.get("errors"):
        lines.append(f"<i>Partial data: {profile['errors'][0]}</i>")
    lines.append("<i>Not financial advice.</i>")
    return "\n".join(lines)

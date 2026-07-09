"""Fetch and compare ETF fundamentals for /comp."""

from __future__ import annotations

import contextlib
import os
import re
import sys
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

KST = ZoneInfo("Asia/Seoul")
MAX_ETFS = 8
MIN_ETFS = 2
TOP_HOLDINGS = 10
MIN_ETF_HISTORY_DAYS = 126
CHART_TRADING_DAYS = 252

KNOWN_INDEX_PROXIES: dict[str, str] = {
    "QNDX": "^NDX",
    "QQQ": "^NDX",
    "QQQM": "^NDX",
    "ONEQ": "^NDX",
    "IVV": "^GSPC",
    "SPY": "^GSPC",
    "VOO": "^GSPC",
    "SPLG": "^GSPC",
    "VTI": "^GSPC",
    "IWM": "^RUT",
    "DIA": "^DJI",
}

INDEX_DISPLAY_NAMES: dict[str, str] = {
    "^NDX": "Nasdaq-100",
    "^GSPC": "S&P 500",
    "^RUT": "Russell 2000",
    "^DJI": "Dow Jones",
}

BENCHMARK_NAME_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"nasdaq[- ]?100", re.I), "^NDX"),
    (re.compile(r"s&p\s*500|sp\s*500", re.I), "^GSPC"),
    (re.compile(r"russell\s*2000", re.I), "^RUT"),
    (re.compile(r"dow\s*jones|djia", re.I), "^DJI"),
    (re.compile(r"total\s*stock\s*market", re.I), "^GSPC"),
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


def _guess_index_proxy(symbol: str, info: dict) -> str | None:
    if symbol in KNOWN_INDEX_PROXIES:
        return KNOWN_INDEX_PROXIES[symbol]
    for field in ("benchmark", "longName", "shortName", "category"):
        text = str(info.get(field) or "")
        for pattern, proxy in BENCHMARK_NAME_PATTERNS:
            if pattern.search(text):
                return proxy
    return None


def _index_label(proxy: str | None) -> str:
    if not proxy:
        return ""
    return INDEX_DISPLAY_NAMES.get(proxy, proxy)


def _fetch_close_history(symbol: str, period: str = "2y") -> pd.Series:
    with _quiet_yfinance():
        history = yf.Ticker(symbol).history(period=period, auto_adjust=True)
    if history.empty or "Close" not in history.columns:
        return pd.Series(dtype=float)
    return history["Close"].dropna()


def _attach_price_history(profile: dict[str, Any], info: dict, close: pd.Series) -> None:
    symbol = profile["symbol"]
    trading_days = len(close.dropna())

    proxy = None
    price_source = "etf"
    chart_label = symbol
    series = close.dropna()

    if trading_days < MIN_ETF_HISTORY_DAYS:
        proxy = _guess_index_proxy(symbol, info)
        if proxy:
            idx_close = _fetch_close_history(proxy)
            if len(idx_close) >= MIN_ETF_HISTORY_DAYS:
                series = idx_close
                price_source = "index_proxy"
                chart_label = f"{symbol} ({_index_label(proxy)})"
                profile.setdefault("errors", []).append(
                    f"Short ETF history ({trading_days}d); chart uses index proxy {proxy}"
                )

    profile["close_series"] = series
    profile["price_source"] = price_source
    profile["price_proxy"] = proxy
    profile["chart_label"] = chart_label
    profile["history_trading_days"] = trading_days


def build_normalized_performance(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    series: dict[str, pd.Series] = {}
    labels: dict[str, str] = {}
    sources: dict[str, str] = {}
    for profile in profiles:
        close = profile.get("close_series")
        if close is None or close.empty:
            continue
        normalized = close / float(close.iloc[0]) * 100
        key = profile["symbol"]
        series[key] = normalized
        labels[key] = profile.get("chart_label") or key
        sources[key] = profile.get("price_source") or "etf"

    if not series:
        return {"series": {}, "labels": {}, "sources": {}, "common_start": None}

    aligned = pd.DataFrame(series).dropna(how="any")
    if aligned.empty:
        aligned = pd.DataFrame(series).dropna(how="all").ffill().dropna(how="any")
    if aligned.empty:
        return {"series": {}, "labels": labels, "sources": sources, "common_start": None}

    reindexed = {col: aligned[col] for col in aligned.columns}
    return {
        "series": reindexed,
        "labels": labels,
        "sources": sources,
        "common_start": aligned.index[0],
        "latest_values": {col: float(aligned[col].iloc[-1]) for col in aligned.columns},
    }


VIZ_IDEAS = [
    "섹터/종목 비중 스택 바 — 동일 지수 ETF라도 구성 차이 확인",
    "최대 낙폭(MDD) 비교 — 변동성·리스크 성향 비교",
    "배당 수익률·분배금 추이 — 인컴 목적 비교",
    "추적 오차(ETF vs 지수) — 신규 상장 ETF의 지수 추종 품질",
    "롤링 1년 상관관계 — 포트폴리오 중복·분산 효과",
]


def format_viz_ideas_telegram() -> str:
    lines = ["<b>💡 추가로 비교하면 좋은 시각화</b>"]
    for idea in VIZ_IDEAS:
        lines.append(f"• {idea}")
    return "\n".join(lines)


def parse_comp_tickers(command_text: str) -> list[str]:
    parts = command_text.strip().split(maxsplit=1)
    if len(parts) < 2:
        return []
    body = parts[1].replace(",", " ")
    tickers: list[str] = []
    seen: set[str] = set()
    for raw in body.split():
        ticker = raw.strip().upper().lstrip("$")
        if ticker and ticker not in seen:
            seen.add(ticker)
            tickers.append(ticker)
    return tickers

    parts = command_text.strip().split(maxsplit=1)
    if len(parts) < 2:
        return []
    body = parts[1].replace(",", " ")
    tickers: list[str] = []
    seen: set[str] = set()
    for raw in body.split():
        ticker = raw.strip().upper().lstrip("$")
        if ticker and ticker not in seen:
            seen.add(ticker)
            tickers.append(ticker)
    return tickers


def _fmt_money(value: float | None) -> str:
    if value is None:
        return "n/a"
    abs_val = abs(value)
    if abs_val >= 1_000_000_000_000:
        return f"${value / 1_000_000_000_000:.2f}T"
    if abs_val >= 1_000_000_000:
        return f"${value / 1_000_000_000:.2f}B"
    if abs_val >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    return f"${value:,.0f}"


def _fmt_pct(value: float | None, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.{digits}f}%"


def _expense_ratio_pct(info: dict) -> float | None:
    for key in ("netExpenseRatio", "annualReportExpenseRatio", "expenseRatio"):
        raw = info.get(key)
        if raw in (None, ""):
            continue
        try:
            val = float(raw)
        except (TypeError, ValueError):
            continue
        if val <= 0:
            continue
        # yfinance reports US ETF expense in percent points (0.03 = 0.03%, 0.18 = 0.18%).
        return val
    return None


def _return_pct(history: pd.Series, trading_days: int) -> float | None:
    clean = history.dropna()
    if len(clean) < 2:
        return None
    if len(clean) > trading_days:
        start = float(clean.iloc[-trading_days - 1])
    else:
        start = float(clean.iloc[0])
    end = float(clean.iloc[-1])
    if start == 0:
        return None
    return (end / start - 1) * 100


def _ytd_return_pct(history: pd.Series) -> float | None:
    clean = history.dropna()
    if clean.empty:
        return None
    year = datetime.now(KST).year
    if getattr(clean.index, "tz", None) is not None:
        year_start = pd.Timestamp(year=year, month=1, day=1, tz=clean.index.tz)
        subset = clean[clean.index >= year_start]
    else:
        year_start = pd.Timestamp(year=year, month=1, day=1)
        subset = clean[clean.index >= year_start]
    if len(subset) < 2:
        subset = clean[clean.index.year == year]
    if len(subset) < 2:
        return None
    start = float(subset.iloc[0])
    end = float(subset.iloc[-1])
    if start == 0:
        return None
    return (end / start - 1) * 100


def _fetch_holdings(ticker: yf.Ticker) -> pd.DataFrame:
    try:
        holdings = ticker.funds_data.top_holdings
    except Exception:
        return pd.DataFrame(columns=["symbol", "name", "weight_pct"])
    if holdings is None or holdings.empty:
        return pd.DataFrame(columns=["symbol", "name", "weight_pct"])

    rows: list[dict[str, Any]] = []
    for symbol, row in holdings.head(TOP_HOLDINGS).iterrows():
        weight = row.get("Holding Percent")
        if weight is None:
            continue
        try:
            weight_pct = float(weight) * 100
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "symbol": str(symbol),
                "name": str(row.get("Name", "")),
                "weight_pct": round(weight_pct, 4),
            }
        )
    return pd.DataFrame(rows)


def _volume_stats(history: pd.DataFrame, price: float | None) -> dict[str, float | None]:
    if history.empty or "Volume" not in history.columns:
        return {"latest_volume": None, "avg_volume_21d": None, "avg_dollar_volume_21d": None}
    vol = history["Volume"].dropna()
    if vol.empty:
        return {"latest_volume": None, "avg_volume_21d": None, "avg_dollar_volume_21d": None}
    latest = float(vol.iloc[-1])
    avg_21 = float(vol.tail(21).mean()) if len(vol) >= 1 else latest
    dollar = avg_21 * price if price else None
    return {
        "latest_volume": latest,
        "avg_volume_21d": avg_21,
        "avg_dollar_volume_21d": dollar,
    }


def fetch_etf_profile(symbol: str) -> dict[str, Any]:
    symbol = symbol.upper()
    errors: list[str] = []
    with _quiet_yfinance():
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        history = ticker.history(period="2y", auto_adjust=True)

    quote_type = str(info.get("quoteType") or "").upper()
    if quote_type and quote_type not in {"ETF", "MUTUALFUND"}:
        errors.append(f"{symbol} quoteType={quote_type} (expected ETF)")

    nav = info.get("navPrice")
    price = info.get("regularMarketPrice") or info.get("previousClose")
    try:
        nav_f = float(nav) if nav is not None else None
    except (TypeError, ValueError):
        nav_f = None
    try:
        price_f = float(price) if price is not None else None
    except (TypeError, ValueError):
        price_f = None

    premium_pct = None
    if nav_f and price_f and nav_f > 0:
        premium_pct = (price_f / nav_f - 1) * 100

    close = history["Close"] if not history.empty else pd.Series(dtype=float)
    vol_stats = _volume_stats(history, price_f)
    holdings = _fetch_holdings(ticker)

    aum = info.get("totalAssets")
    try:
        aum_f = float(aum) if aum is not None else None
    except (TypeError, ValueError):
        aum_f = None

    expense = _expense_ratio_pct(info)
    dividend_yield = info.get("yield")
    try:
        div_yield_pct = float(dividend_yield) * 100 if dividend_yield is not None else None
    except (TypeError, ValueError):
        div_yield_pct = None

    profile = {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or symbol,
        "issuer": info.get("fundFamily") or "",
        "category": info.get("category") or "",
        "benchmark": info.get("benchmark") or info.get("fundProfile") or "",
        "inception": info.get("fundInceptionDate"),
        "aum_usd": aum_f,
        "expense_ratio_pct": expense,
        "dividend_yield_pct": div_yield_pct,
        "nav": nav_f,
        "market_price": price_f,
        "premium_discount_pct": premium_pct,
        "beta_3y": info.get("beta3Year"),
        "return_1m_pct": _return_pct(close, 21),
        "return_3m_pct": _return_pct(close, 63),
        "return_6m_pct": _return_pct(close, 126),
        "return_1y_pct": _return_pct(close, 252),
        "return_ytd_pct": _ytd_return_pct(close),
        "latest_volume": vol_stats["latest_volume"],
        "avg_volume_21d": vol_stats["avg_volume_21d"],
        "avg_dollar_volume_21d": vol_stats["avg_dollar_volume_21d"],
        "holdings": holdings,
        "errors": errors,
    }
    _attach_price_history(profile, info, close)
    if aum_f is None and not errors:
        errors.append("AUM unavailable from data provider")
    if holdings.empty and not errors:
        errors.append("Top holdings unavailable")
    profile["errors"] = errors
    return profile


def build_holdings_overlap(profiles: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for i, left in enumerate(profiles):
        left_map = {
            row["symbol"]: row["weight_pct"]
            for _, row in left["holdings"].iterrows()
            if row.get("symbol")
        }
        for right in profiles[i + 1 :]:
            right_map = {
                row["symbol"]: row["weight_pct"]
                for _, row in right["holdings"].iterrows()
                if row.get("symbol")
            }
            common = set(left_map) & set(right_map)
            overlap_weight = sum(min(left_map[s], right_map[s]) for s in common)
            rows.append(
                {
                    "etf_a": left["symbol"],
                    "etf_b": right["symbol"],
                    "common_holdings": len(common),
                    "overlap_weight_pct": round(overlap_weight, 2),
                }
            )
    return pd.DataFrame(rows)


def build_comparison_table(profiles: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for p in profiles:
        rows.append(
            {
                "Ticker": p["symbol"],
                "Name": p["name"],
                "Issuer": p["issuer"],
                "Category": p["category"],
                "AUM (USD)": p["aum_usd"],
                "Expense Ratio (%)": p["expense_ratio_pct"],
                "Dividend Yield (%)": p["dividend_yield_pct"],
                "NAV": p["nav"],
                "Market Price": p["market_price"],
                "Premium/Discount (%)": p["premium_discount_pct"],
                "Beta (3Y)": p["beta_3y"],
                "Return 1M (%)": p["return_1m_pct"],
                "Return 3M (%)": p["return_3m_pct"],
                "Return 6M (%)": p["return_6m_pct"],
                "Return YTD (%)": p["return_ytd_pct"],
                "Return 1Y (%)": p["return_1y_pct"],
                "Latest Volume": p["latest_volume"],
                "Avg Volume 21D": p["avg_volume_21d"],
                "Avg $ Volume 21D": p["avg_dollar_volume_21d"],
                "Data Notes": "; ".join(p.get("errors") or []),
            }
        )
    return pd.DataFrame(rows)


def build_holdings_table(profiles: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for p in profiles:
        if p["holdings"].empty:
            rows.append(
                {
                    "ETF": p["symbol"],
                    "Rank": None,
                    "Holding Ticker": "",
                    "Holding Name": "(no holdings data)",
                    "Weight (%)": None,
                }
            )
            continue
        for rank, (_, row) in enumerate(p["holdings"].iterrows(), start=1):
            rows.append(
                {
                    "ETF": p["symbol"],
                    "Rank": rank,
                    "Holding Ticker": row["symbol"],
                    "Holding Name": row["name"],
                    "Weight (%)": row["weight_pct"],
                }
            )
    return pd.DataFrame(rows)


def format_comp_telegram(profiles: list[dict[str, Any]], excel_name: str) -> str:
    tickers = ", ".join(p["symbol"] for p in profiles)
    lines = [
        f"<b>📊 ETF Comparison</b>",
        f"<i>{datetime.now(KST).strftime('%Y-%m-%d %H:%M KST')}</i>",
        f"<b>Tickers:</b> {tickers}",
        "",
    ]
    for p in profiles:
        lines.append(f"<b>{p['symbol']}</b> — {p['name']}")
        er = f"{p['expense_ratio_pct']:.2f}%" if p["expense_ratio_pct"] is not None else "n/a"
        lines.append(f"  AUM {_fmt_money(p['aum_usd'])} | ER {er}")
        vol_text = f"{p['avg_volume_21d']:,.0f}" if p["avg_volume_21d"] else "n/a"
        lines.append(
            f"  Premium/Discount {_fmt_pct(p['premium_discount_pct'])} | "
            f"1Y {_fmt_pct(p['return_1y_pct'])} | Avg vol 21D {vol_text}"
        )
        if p.get("price_source") == "index_proxy":
            lines.append(
                f"  <i>Chart: index proxy {_index_label(p.get('price_proxy'))} "
                f"(ETF history {p.get('history_trading_days', 0)}d)</i>"
            )
        if p.get("errors"):
            lines.append(f"  <i>Note: {'; '.join(p['errors'])}</i>")
        lines.append("")

    lines.append(f"📎 Excel workbook: <code>{excel_name}</code>")
    lines.append("")
    lines.append(format_viz_ideas_telegram())
    return "\n".join(lines).rstrip()


def _profiles_for_export(profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for profile in profiles:
        copy = dict(profile)
        copy.pop("close_series", None)
        cleaned.append(copy)
    return cleaned


def compare_etfs(symbols: list[str]) -> dict[str, Any]:
    if len(symbols) < MIN_ETFS:
        raise ValueError(f"Provide at least {MIN_ETFS} ETF tickers. Example: /comp QQQ IVV QNDX")
    if len(symbols) > MAX_ETFS:
        raise ValueError(f"Maximum {MAX_ETFS} ETFs per comparison.")

    profiles = [fetch_etf_profile(sym) for sym in symbols]
    performance = build_normalized_performance(profiles)
    export_profiles = _profiles_for_export(profiles)
    return {
        "generated_at": datetime.now(KST).isoformat(),
        "symbols": symbols,
        "profiles": profiles,
        "export_profiles": export_profiles,
        "performance": performance,
        "comparison": build_comparison_table(export_profiles),
        "holdings": build_holdings_table(export_profiles),
        "overlap": build_holdings_overlap(export_profiles),
    }

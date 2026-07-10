"""US pre-market return rankings for /etf_pre, /sp_pre, /nas_pre."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from finnhub_market import fetch_quote, finnhub_api_key, map_tickers
from stock_crawler import (
    DEFAULT_BOTTOM_N,
    DEFAULT_TOP_N,
    load_etf_tickers,
    load_nasdaq100_tickers,
    load_sp500_tickers,
)

ET = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")

PREMARKET_UNIVERSES = {
    "etf": "US Equity ETF (liquid subset)",
    "sp": "S&P 500",
    "nas": "NASDAQ 100",
}

# Full ETF master is too large for Finnhub 60/min quotes before open.
# Use a liquid US equity ETF subset for /etf_pre.
LIQUID_ETF_TICKERS: tuple[str, ...] = (
    "SPY", "IVV", "VOO", "QQQ", "QQQM", "DIA", "IWM", "IJH", "IJR", "VTI",
    "VXUS", "EFA", "EEM", "VEA", "VWO", "IEMG", "AGG", "BND", "TLT", "IEF",
    "LQD", "HYG", "JNK", "TIP", "GLD", "IAU", "SLV", "USO", "UNG", "DBC",
    "XLF", "XLK", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE",
    "XLC", "SMH", "SOXX", "XBI", "IBB", "ARKK", "ARKW", "ARKG", "ARKF", "BOTZ",
    "VGT", "VUG", "VTV", "VOE", "VBR", "VB", "VO", "VV", "SCHD", "SCHG",
    "VIG", "DGRO", "DVY", "SDY", "NOBL", "MTUM", "QUAL", "USMV", "VLUE", "SIZE",
    "RSP", "MDY", "IWF", "IWD", "IWB", "IWV", "ITOT", "IXUS", "ACWI", "VT",
    "TQQQ", "SQQQ", "UPRO", "SPXU", "TNA", "TZA", "SOXL", "SOXS", "TECL", "TECS",
    "XOP", "OIH", "KRE", "KBE", "XRT", "ITA", "IYT", "HACK", "CIBR", "SKYY",
    "CLOU", "WCLD", "IGV", "FTEC", "FHLC", "FNCL", "FIDU", "FENY", "FDIS", "FSTA",
)

PREMARKET_COMMANDS = {
    "/etf_pre": "etf",
    "/sp_pre": "sp",
    "/nas_pre": "nas",
}


def parse_premarket_command(command: str) -> str:
    parts = command.strip().split()
    if not parts:
        raise ValueError("empty command")
    key = parts[0].lower()
    if key not in PREMARKET_COMMANDS:
        raise ValueError("Use /etf_pre, /sp_pre, or /nas_pre.")
    return PREMARKET_COMMANDS[key]


def _session_label(now_et: datetime | None = None) -> str:
    now = now_et or datetime.now(ET)
    minutes = now.hour * 60 + now.minute
    # US equity: pre-market ~04:00–09:30, regular 09:30–16:00, after-hours 16:00–20:00 ET
    if 4 * 60 <= minutes < 9 * 60 + 30:
        return "pre-market"
    if 9 * 60 + 30 <= minutes < 16 * 60:
        return "regular session (live quote)"
    if 16 * 60 <= minutes < 20 * 60:
        return "after-hours"
    return "off-hours (last trade vs prev close)"


def load_premarket_tickers(universe: str) -> list[str]:
    if universe == "sp":
        return load_sp500_tickers()
    if universe == "nas":
        return load_nasdaq100_tickers()
    if universe == "etf":
        try:
            master = set(load_etf_tickers())
            liquid = [ticker for ticker in LIQUID_ETF_TICKERS if ticker in master]
            return liquid or list(LIQUID_ETF_TICKERS)
        except Exception:
            return list(LIQUID_ETF_TICKERS)
    raise ValueError(f"Unknown universe: {universe}")


def _quote_row(ticker: str) -> dict[str, Any] | None:
    quote = fetch_quote(ticker, include_premarket_trade=True)
    pct = quote.get("change_pct")
    current = quote.get("current")
    prev_close = quote.get("prev_close")
    if pct is None or current is None or prev_close in (None, 0):
        return None
    return {
        "ticker": ticker,
        "change_pct": float(pct),
        "current": float(current),
        "prev_close": float(prev_close),
    }


def build_premarket_rankings(
    universe: str,
    *,
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> dict[str, Any]:
    if not finnhub_api_key():
        raise RuntimeError(
            "FINNHUB_API_KEY is required for pre-market rankings. "
            "Set it in .env (local) or Render Environment."
        )

    tickers = load_premarket_tickers(universe)
    # Serial quotes (~30/min) to stay under Finnhub free-tier limits.
    rows_map = map_tickers(tickers, _quote_row, max_workers=1)
    rows = [row for row in rows_map.values() if row]
    rows.sort(key=lambda item: item["change_pct"], reverse=True)

    gainers = rows[:top_n]
    losers = list(reversed(rows[-bottom_n:])) if rows else []

    now_et = datetime.now(ET)
    now_kst = datetime.now(KST)
    return {
        "universe": universe,
        "label": PREMARKET_UNIVERSES[universe],
        "session": _session_label(now_et),
        "generated_at_et": now_et.strftime("%Y-%m-%d %H:%M ET"),
        "generated_at_kst": now_kst.strftime("%Y-%m-%d %H:%M KST"),
        "scanned": len(tickers),
        "active": len(rows),
        "gainers": gainers,
        "losers": losers,
        "source": "Finnhub /quote?trade=true (pre/post last trade when available)",
    }


def format_premarket_telegram(result: dict[str, Any]) -> str:
    lines = [
        f"<b>🌅 {result['label']} — pre-market returns</b>",
        f"<i>{result['generated_at_et']} · {result['generated_at_kst']}</i>",
        f"Session: <code>{result['session']}</code>",
        f"Quotes: {result['active']} / {result['scanned']}",
        "",
        "<b>▲ Top gainers</b>",
    ]
    if not result["gainers"]:
        lines.append("<i>No quote data</i>")
    else:
        for row in result["gainers"]:
            lines.append(
                f"  • <code>{row['ticker']}</code>  "
                f"<b>{row['change_pct']:+.2f}%</b>  "
                f"({row['prev_close']:.2f} → {row['current']:.2f})"
            )

    lines.extend(["", "<b>▼ Top losers</b>"])
    if not result["losers"]:
        lines.append("<i>No quote data</i>")
    else:
        for row in result["losers"]:
            lines.append(
                f"  • <code>{row['ticker']}</code>  "
                f"<b>{row['change_pct']:+.2f}%</b>  "
                f"({row['prev_close']:.2f} → {row['current']:.2f})"
            )

    lines.extend(
        [
            "",
            f"<i>Source: {result['source']}</i>",
            "<i>Intended for ~1–2h before US open (04:00–09:30 ET). "
            "Not a volume-surge score — pure price return vs previous close.</i>",
            "<i>Not financial advice.</i>",
        ]
    )
    return "\n".join(lines)

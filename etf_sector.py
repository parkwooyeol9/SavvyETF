"""ETF Sector Rotation Board — SPDR XL* sectors + theme ETFs vs SPY.

Command: /etf_sector (aliases: /etf sector, /etfsector, /sector)
Primary data: Yahoo daily bars (same provider as /etf rankings).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from yahoo_market import fetch_daily_candles, map_tickers

ET = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")
BENCHMARK = "SPY"

# Classic 11 Select Sector SPDRs
SECTOR_ETFS: tuple[tuple[str, str], ...] = (
    ("XLC", "Communication"),
    ("XLY", "Consumer Disc."),
    ("XLP", "Consumer Staples"),
    ("XLE", "Energy"),
    ("XLF", "Financials"),
    ("XLV", "Health Care"),
    ("XLI", "Industrials"),
    ("XLK", "Technology"),
    ("XLB", "Materials"),
    ("XLRE", "Real Estate"),
    ("XLU", "Utilities"),
)

# Liquid theme / industry ETFs for rotation context
THEME_ETFS: tuple[tuple[str, str], ...] = (
    ("SMH", "Semiconductors"),
    ("SOXX", "Semis (iShares)"),
    ("XBI", "Biotech"),
    ("IBB", "Biotech (iShares)"),
    ("XOP", "Oil & Gas E&P"),
    ("KRE", "Regional Banks"),
    ("IYT", "Transportation"),
    ("ITA", "Aerospace & Defense"),
    ("IGV", "Software"),
    ("HACK", "Cybersecurity"),
    ("CIBR", "Cyber (First Trust)"),
    ("SKYY", "Cloud"),
    ("BOTZ", "Robotics / AI"),
    ("ARKK", "ARK Innovation"),
)

LOOKBACKS: tuple[tuple[str, int], ...] = (
    ("1d", 1),
    ("5d", 5),
    ("20d", 20),
)


def is_etf_sector_command(command: str) -> bool:
    """True for /etf_sector, /etf sector, /etfsector, /sector."""
    normalized = " ".join(command.strip().lower().split())
    if not normalized.startswith("/"):
        return False
    token = normalized.split()[0]
    if token in {"/etf_sector", "/etfsector", "/sector"}:
        return True
    # "/etf sector …"
    parts = normalized.split()
    return len(parts) >= 2 and parts[0] == "/etf" and parts[1] == "sector"


def _pct_return(closes: list[float], days: int) -> float | None:
    if len(closes) < days + 1:
        return None
    start = closes[-(days + 1)]
    end = closes[-1]
    if start is None or end is None or start == 0:
        return None
    return (end / start - 1.0) * 100.0


def _closes_from_frame(frame) -> list[float]:
    if frame is None or getattr(frame, "empty", True):
        return []
    series = frame["close"].dropna()
    return [float(x) for x in series.tolist()]


def _fetch_closes(ticker: str) -> list[float]:
    frame = fetch_daily_candles(ticker, range_="3mo")
    return _closes_from_frame(frame)


def _row_from_closes(
    ticker: str,
    name: str,
    group: str,
    closes: list[float],
    bench_rets: dict[str, float | None],
) -> dict[str, Any] | None:
    if len(closes) < 2:
        return None
    rets: dict[str, float | None] = {}
    rs: dict[str, float | None] = {}
    for key, days in LOOKBACKS:
        ret = _pct_return(closes, days)
        rets[key] = ret
        b = bench_rets.get(key)
        rs[key] = (ret - b) if ret is not None and b is not None else None
    return {
        "ticker": ticker,
        "name": name,
        "group": group,
        "last": closes[-1],
        "rets": rets,
        "rs": rs,
    }


def build_etf_sector_board() -> dict[str, Any]:
    """Build sector + theme RS board versus SPY."""
    universe = list(SECTOR_ETFS) + list(THEME_ETFS)
    tickers = [BENCHMARK] + [t for t, _ in universe]

    closes_map = map_tickers(tickers, _fetch_closes, max_workers=8)
    bench_closes = closes_map.get(BENCHMARK) or []
    if len(bench_closes) < 22:
        raise RuntimeError(
            f"Benchmark {BENCHMARK} history too short ({len(bench_closes)} bars). "
            "Yahoo chart unavailable — try again shortly."
        )

    bench_rets = {key: _pct_return(bench_closes, days) for key, days in LOOKBACKS}
    sectors: list[dict[str, Any]] = []
    themes: list[dict[str, Any]] = []

    for ticker, name in SECTOR_ETFS:
        row = _row_from_closes(
            ticker, name, "sector", closes_map.get(ticker) or [], bench_rets
        )
        if row:
            sectors.append(row)
    for ticker, name in THEME_ETFS:
        row = _row_from_closes(
            ticker, name, "theme", closes_map.get(ticker) or [], bench_rets
        )
        if row:
            themes.append(row)

    def sort_key(row: dict[str, Any]) -> float:
        value = row["rs"].get("5d")
        return float(value) if value is not None else -999.0

    sectors.sort(key=sort_key, reverse=True)
    themes.sort(key=sort_key, reverse=True)

    now_et = datetime.now(ET)
    now_kst = datetime.now(KST)
    return {
        "benchmark": BENCHMARK,
        "bench_rets": bench_rets,
        "sectors": sectors,
        "themes": themes,
        "generated_at_et": now_et.strftime("%Y-%m-%d %H:%M ET"),
        "generated_at_kst": now_kst.strftime("%Y-%m-%d %H:%M KST"),
        "source": "Yahoo Finance daily · RS = ETF% − SPY%",
        "scanned_sectors": len(SECTOR_ETFS),
        "active_sectors": len(sectors),
        "scanned_themes": len(THEME_ETFS),
        "active_themes": len(themes),
    }


def _fmt_pct(value: float | None, *, signed: bool = True) -> str:
    if value is None:
        return "n/a"
    if signed:
        return f"{value:+.2f}%"
    return f"{value:.2f}%"


def _fmt_rs_triple(row: dict[str, Any]) -> str:
    rs = row["rs"]
    return (
        f"{_fmt_pct(rs.get('1d'))} / "
        f"{_fmt_pct(rs.get('5d'))} / "
        f"{_fmt_pct(rs.get('20d'))}"
    )


def _fmt_board_lines(rows: list[dict[str, Any]], *, limit: int | None = None) -> list[str]:
    lines: list[str] = []
    shown = rows if limit is None else rows[:limit]
    for idx, row in enumerate(shown, start=1):
        ret5 = row["rets"].get("5d")
        lines.append(
            f"{idx}. <code>{row['ticker']}</code> {_esc(row['name'])}\n"
            f"    5D {_fmt_pct(ret5)} · RS 1/5/20 {_fmt_rs_triple(row)}"
        )
    return lines


def _esc(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def format_etf_sector_telegram(board: dict[str, Any]) -> str:
    """HTML Telegram message for /etf_sector."""
    b = board["bench_rets"]
    lines = [
        "<b>🔄 ETF Sector Rotation</b>",
        f"<i>{board['generated_at_et']} · {board['generated_at_kst']}</i>",
        (
            f"Benchmark <code>{board['benchmark']}</code>: "
            f"1D {_fmt_pct(b.get('1d'))} · "
            f"5D {_fmt_pct(b.get('5d'))} · "
            f"20D {_fmt_pct(b.get('20d'))}"
        ),
        "RS = ETF return − SPY (positive = outperforming)",
        "",
        (
            f"<b>▲ Select Sector SPDRs</b> "
            f"({board['active_sectors']}/{board['scanned_sectors']}) · ranked by 5D RS"
        ),
    ]
    if board["sectors"]:
        lines.extend(_fmt_board_lines(board["sectors"]))
    else:
        lines.append("<i>No sector quotes</i>")

    lines.extend(
        [
            "",
            (
                f"<b>🏷 Theme ETFs</b> "
                f"({board['active_themes']}/{board['scanned_themes']}) · ranked by 5D RS"
            ),
        ]
    )
    if board["themes"]:
        lines.extend(_fmt_board_lines(board["themes"]))
    else:
        lines.append("<i>No theme quotes</i>")

    # Leaders / laggards summary
    if board["sectors"]:
        leader = board["sectors"][0]
        laggard = board["sectors"][-1]
        lines.extend(
            [
                "",
                (
                    f"<b>Board</b>: leader <code>{leader['ticker']}</code> "
                    f"(5D RS {_fmt_pct(leader['rs'].get('5d'))}) · "
                    f"laggard <code>{laggard['ticker']}</code> "
                    f"(5D RS {_fmt_pct(laggard['rs'].get('5d'))})"
                ),
            ]
        )

    lines.extend(
        [
            "",
            f"<i>Source: {board['source']}</i>",
            "<i>Not financial advice.</i>",
        ]
    )
    return "\n".join(lines)

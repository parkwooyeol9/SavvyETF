"""ETF Sector Rotation Board — SPDR XL* sectors + theme ETFs vs SPY.

Command: /etf_sector (aliases: /etf sector, /etfsector, /sector)

Primary metric: last completed US daily return (and RS vs SPY).
Includes a dark-theme horizontal bar chart for Telegram.
"""

from __future__ import annotations

import io
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from yahoo_market import fetch_daily_candles, map_tickers

ET = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")
BENCHMARK = "SPY"

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

CHART_PALETTE = {
    "bg": "#0b1220",
    "panel": "#121b2d",
    "grid": "#243049",
    "text": "#e8edf7",
    "muted": "#93a4c3",
    "green": "#34d399",
    "red": "#f87171",
    "blue": "#60a5fa",
    "spy": "#fbbf24",
}


def is_etf_sector_command(command: str) -> bool:
    """True for /etf_sector, /etf sector, /etfsector, /sector."""
    normalized = " ".join(command.strip().lower().split())
    if not normalized.startswith("/"):
        return False
    token = normalized.split()[0]
    if token in {"/etf_sector", "/etfsector", "/sector"}:
        return True
    parts = normalized.split()
    return len(parts) >= 2 and parts[0] == "/etf" and parts[1] == "sector"


def _series_from_frame(frame) -> tuple[list[date], list[float]]:
    if frame is None or getattr(frame, "empty", True):
        return [], []
    series = frame["close"].dropna().sort_index()
    dates: list[date] = []
    closes: list[float] = []
    for idx, value in series.items():
        if hasattr(idx, "date"):
            dates.append(idx.date())
        else:
            dates.append(date.fromisoformat(str(idx)[:10]))
        closes.append(float(value))
    return dates, closes


def _fetch_series(ticker: str) -> tuple[list[date], list[float]]:
    frame = fetch_daily_candles(ticker, range_="3mo")
    return _series_from_frame(frame)


def _completed_bar_index(dates: list[date], now_et: datetime | None = None) -> int | None:
    """
    Index of the last *completed* US regular-session bar.

    Before 16:00 ET on a weekday, if Yahoo already exposes today's partial bar,
    use the previous bar so "daily return" means the prior session.
    """
    if len(dates) < 2:
        return None
    now_et = now_et or datetime.now(ET)
    last_i = len(dates) - 1
    today = now_et.date()
    from market_data_freshness import is_after_us_market_close

    if dates[last_i] == today and today.weekday() < 5 and not is_after_us_market_close(now_et):
        return last_i - 1 if last_i >= 1 else None
    return last_i


def _pct_return_at(closes: list[float], end_i: int, days: int) -> float | None:
    start_i = end_i - days
    if start_i < 0 or end_i >= len(closes):
        return None
    start = closes[start_i]
    end = closes[end_i]
    if start is None or end is None or start == 0:
        return None
    return (end / start - 1.0) * 100.0


def _row_from_series(
    ticker: str,
    name: str,
    group: str,
    dates: list[date],
    closes: list[float],
    bench_rets: dict[str, float | None],
    *,
    end_i: int,
) -> dict[str, Any] | None:
    if end_i < 1 or end_i >= len(closes):
        return None
    rets: dict[str, float | None] = {}
    rs: dict[str, float | None] = {}
    for key, days in LOOKBACKS:
        ret = _pct_return_at(closes, end_i, days)
        rets[key] = ret
        b = bench_rets.get(key)
        rs[key] = (ret - b) if ret is not None and b is not None else None
    return {
        "ticker": ticker,
        "name": name,
        "group": group,
        "last": closes[end_i],
        "as_of": dates[end_i].isoformat(),
        "rets": rets,
        "rs": rs,
    }


def build_etf_sector_board() -> dict[str, Any]:
    """Build sector + theme board ranked by last completed daily return."""
    now_et = datetime.now(ET)
    universe = list(SECTOR_ETFS) + list(THEME_ETFS)
    tickers = [BENCHMARK] + [t for t, _ in universe]

    series_map = map_tickers(tickers, _fetch_series, max_workers=8)
    bench_dates, bench_closes = series_map.get(BENCHMARK) or ([], [])
    bench_end = _completed_bar_index(bench_dates, now_et)
    if bench_end is None or bench_end < 20:
        raise RuntimeError(
            f"Benchmark {BENCHMARK} history too short. "
            "Yahoo chart unavailable — try again shortly."
        )

    bench_rets = {
        key: _pct_return_at(bench_closes, bench_end, days) for key, days in LOOKBACKS
    }
    session_as_of = bench_dates[bench_end].isoformat()

    sectors: list[dict[str, Any]] = []
    themes: list[dict[str, Any]] = []

    for ticker, name in SECTOR_ETFS:
        dates, closes = series_map.get(ticker) or ([], [])
        end_i = _completed_bar_index(dates, now_et)
        if end_i is None:
            continue
        row = _row_from_series(
            ticker, name, "sector", dates, closes, bench_rets, end_i=end_i
        )
        if row:
            sectors.append(row)

    for ticker, name in THEME_ETFS:
        dates, closes = series_map.get(ticker) or ([], [])
        end_i = _completed_bar_index(dates, now_et)
        if end_i is None:
            continue
        row = _row_from_series(
            ticker, name, "theme", dates, closes, bench_rets, end_i=end_i
        )
        if row:
            themes.append(row)

    def sort_key(row: dict[str, Any]) -> float:
        value = row["rets"].get("1d")
        return float(value) if value is not None else -999.0

    sectors.sort(key=sort_key, reverse=True)
    themes.sort(key=sort_key, reverse=True)

    now_kst = datetime.now(KST)
    return {
        "benchmark": BENCHMARK,
        "bench_rets": bench_rets,
        "session_as_of": session_as_of,
        "sectors": sectors,
        "themes": themes,
        "generated_at_et": now_et.strftime("%Y-%m-%d %H:%M ET"),
        "generated_at_kst": now_kst.strftime("%Y-%m-%d %H:%M KST"),
        "source": "Yahoo Finance · last completed daily return · RS = ETF% − SPY%",
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


def _esc(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _fmt_board_lines(rows: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for idx, row in enumerate(rows, start=1):
        ret1 = row["rets"].get("1d")
        rs1 = row["rs"].get("1d")
        lines.append(
            f"{idx}. <code>{row['ticker']}</code> {_esc(row['name'])}\n"
            f"    1D {_fmt_pct(ret1)} · vs SPY {_fmt_pct(rs1)} · "
            f"5D {_fmt_pct(row['rets'].get('5d'))} · 20D {_fmt_pct(row['rets'].get('20d'))}"
        )
    return lines


def format_etf_sector_telegram(board: dict[str, Any]) -> str:
    """HTML Telegram caption/body for /etf_sector."""
    b = board["bench_rets"]
    lines = [
        "<b>🔄 ETF Sector Rotation</b>",
        f"<i>{board['generated_at_et']} · {board['generated_at_kst']}</i>",
        f"Session <code>{board.get('session_as_of', '?')}</code> (last completed US daily bar)",
        (
            f"Benchmark <code>{board['benchmark']}</code> 1D {_fmt_pct(b.get('1d'))} · "
            f"5D {_fmt_pct(b.get('5d'))} · 20D {_fmt_pct(b.get('20d'))}"
        ),
        "Ranked by previous daily return · RS = ETF% − SPY%",
        "",
        (
            f"<b>▲ Select Sector SPDRs</b> "
            f"({board['active_sectors']}/{board['scanned_sectors']}) · by 1D %"
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
                f"({board['active_themes']}/{board['scanned_themes']}) · by 1D %"
            ),
        ]
    )
    if board["themes"]:
        lines.extend(_fmt_board_lines(board["themes"]))
    else:
        lines.append("<i>No theme quotes</i>")

    if board["sectors"]:
        leader = board["sectors"][0]
        laggard = board["sectors"][-1]
        lines.extend(
            [
                "",
                (
                    f"<b>Board</b>: leader <code>{leader['ticker']}</code> "
                    f"({_fmt_pct(leader['rets'].get('1d'))}) · "
                    f"laggard <code>{laggard['ticker']}</code> "
                    f"({_fmt_pct(laggard['rets'].get('1d'))})"
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


def _plot_panel(ax, rows: list[dict[str, Any]], *, title: str, spy_1d: float | None) -> None:
    ax.set_facecolor(CHART_PALETTE["panel"])
    if not rows:
        ax.text(
            0.5,
            0.5,
            "No data",
            ha="center",
            va="center",
            color=CHART_PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_xticks([])
        ax.set_yticks([])
        return

    # Top of chart = highest 1D return
    labels = [f"{row['ticker']}" for row in reversed(rows)]
    values = [
        float(row["rets"]["1d"]) if row["rets"].get("1d") is not None else 0.0
        for row in reversed(rows)
    ]
    colors = [
        CHART_PALETTE["green"] if value >= 0 else CHART_PALETTE["red"] for value in values
    ]
    y = range(len(labels))
    ax.barh(list(y), values, color=colors, height=0.72, edgecolor="none")
    if spy_1d is not None:
        ax.axvline(
            spy_1d,
            color=CHART_PALETTE["spy"],
            linestyle="--",
            linewidth=1.4,
            label=f"SPY {_fmt_pct(spy_1d)}",
        )
    ax.axvline(0, color=CHART_PALETTE["grid"], linewidth=0.8)
    ax.set_yticks(list(y))
    ax.set_yticklabels(labels, fontsize=9, color=CHART_PALETTE["text"])
    ax.tick_params(colors=CHART_PALETTE["muted"], labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(CHART_PALETTE["grid"])
    ax.grid(True, axis="x", color=CHART_PALETTE["grid"], alpha=0.35, linewidth=0.6)
    ax.set_title(title, color=CHART_PALETTE["text"], fontsize=11, pad=8)
    ax.set_xlabel("Last completed daily return (%)", color=CHART_PALETTE["muted"], fontsize=9)
    if spy_1d is not None:
        ax.legend(
            facecolor=CHART_PALETTE["panel"],
            edgecolor=CHART_PALETTE["grid"],
            labelcolor=CHART_PALETTE["text"],
            fontsize=8,
            loc="lower right",
        )


def plot_etf_sector_board(board: dict[str, Any]) -> io.BytesIO:
    """Two-panel horizontal bar chart: sectors + themes by 1D return."""
    spy_1d = board.get("bench_rets", {}).get("1d")
    fig, axes = plt.subplots(
        1,
        2,
        figsize=(12.5, 7.2),
        facecolor=CHART_PALETTE["bg"],
        gridspec_kw={"width_ratios": [1.0, 1.15]},
    )
    fig.suptitle(
        f"ETF Sector Rotation · {board.get('session_as_of', '')} · vs SPY",
        color=CHART_PALETTE["text"],
        fontsize=13,
        y=0.98,
    )
    _plot_panel(
        axes[0],
        board.get("sectors") or [],
        title="Select Sector SPDRs (1D %)",
        spy_1d=spy_1d,
    )
    _plot_panel(
        axes[1],
        board.get("themes") or [],
        title="Theme ETFs (1D %)",
        spy_1d=spy_1d,
    )
    fig.tight_layout(rect=(0, 0.02, 1, 0.94))
    buf = io.BytesIO()
    fig.savefig(
        buf,
        format="png",
        dpi=140,
        facecolor=CHART_PALETTE["bg"],
        bbox_inches="tight",
        pad_inches=0.2,
    )
    plt.close(fig)
    buf.seek(0)
    return buf

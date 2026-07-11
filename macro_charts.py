"""Macro risk dashboard charts."""

from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.patches as mpatches  # noqa: E402
import numpy as np
import pandas as pd
from matplotlib.gridspec import GridSpec

from macro_scores import StressResult

PALETTE = {
    "bg": "#0b1220",
    "panel": "#121b2d",
    "grid": "#243049",
    "text": "#e8edf7",
    "muted": "#93a4c3",
    "green": "#34d399",
    "yellow": "#fbbf24",
    "orange": "#fb923c",
    "red": "#f87171",
    "blue": "#60a5fa",
    "purple": "#a78bfa",
    "teal": "#2dd4bf",
}


def _style_axis(ax) -> None:
    ax.set_facecolor(PALETTE["panel"])
    ax.tick_params(colors=PALETTE["muted"], labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(PALETTE["grid"])
    ax.grid(True, color=PALETTE["grid"], alpha=0.35, linewidth=0.6)
    ax.title.set_color(PALETTE["text"])


def _stress_color(score: int) -> str:
    if score >= 75:
        return PALETTE["red"]
    if score >= 55:
        return PALETTE["orange"]
    if score >= 35:
        return PALETTE["yellow"]
    return PALETTE["green"]


def _plot_gauge(ax, stress: StressResult) -> None:
    ax.set_facecolor(PALETTE["bg"])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    color = _stress_color(stress.score)
    theta = np.linspace(np.pi, 0, 200)
    ax.plot(0.5 + 0.38 * np.cos(theta), 0.08 + 0.38 * np.sin(theta), color=PALETTE["grid"], lw=16)

    fill_theta = np.linspace(np.pi, np.pi - (stress.score / 100) * np.pi, 200)
    ax.plot(
        0.5 + 0.38 * np.cos(fill_theta),
        0.08 + 0.38 * np.sin(fill_theta),
        color=color,
        lw=16,
        solid_capstyle="round",
    )

    ax.text(0.5, 0.34, f"{stress.score}", ha="center", va="center", fontsize=34, color=color, weight="bold")
    ax.text(0.5, 0.16, stress.regime, ha="center", va="center", fontsize=14, color=color, weight="bold")
    ax.text(0.5, 0.92, "Macro Stress Score", ha="center", va="center", fontsize=15, color=PALETTE["text"], weight="bold")


def _plot_yield_curve(ax, snapshot: dict) -> None:
    _style_axis(ax)
    labels = ["3M", "2Y", "10Y", "30Y"]
    keys = ["DGS3MO", "DGS2", "DGS10", "DGS30"]
    values = [snapshot.get(k) for k in keys]
    valid = [(label, val) for label, val in zip(labels, values) if val is not None]
    if not valid:
        ax.text(0.5, 0.5, "No yield data", ha="center", va="center", color=PALETTE["muted"], transform=ax.transAxes)
        ax.set_title("Yield Curve", color=PALETTE["text"], fontsize=11, pad=8)
        return

    x = np.arange(len(valid))
    vals = [v for _, v in valid]
    ax.plot(x, vals, color=PALETTE["blue"], marker="o", linewidth=2.2, markersize=7)
    ax.fill_between(x, vals, alpha=0.12, color=PALETTE["blue"])
    ax.set_xticks(x)
    ax.set_xticklabels([label for label, _ in valid], color=PALETTE["text"])
    for label in ax.get_xticklabels():
        label.set_color(PALETTE["text"])
    ax.set_ylabel("%", color=PALETTE["muted"], fontsize=8)
    spread = snapshot.get("T10Y2Y")
    subtitle = f"10Y-2Y: {spread:+.2f}%" if spread is not None else ""
    ax.set_title(f"Yield Curve\n{subtitle}", color=PALETTE["text"], fontsize=11, pad=8)


def _plot_spread_history(ax, hy: pd.Series, ig: pd.Series) -> None:
    _style_axis(ax)
    plotted = False
    if not hy.empty:
        ax.plot(hy.index, hy.values, color=PALETTE["orange"], linewidth=1.8, label="HY OAS")
        plotted = True
    if not ig.empty:
        ax.plot(ig.index, ig.values, color=PALETTE["teal"], linewidth=1.5, label="IG OAS", alpha=0.9)
        plotted = True
    if not plotted:
        market = None
        ax.text(0.5, 0.5, "No credit spread data", ha="center", va="center", color=PALETTE["muted"], transform=ax.transAxes)
    else:
        ax.legend(facecolor=PALETTE["panel"], edgecolor=PALETTE["grid"], labelcolor=PALETTE["text"], fontsize=8)
    ax.set_title("Credit Spreads", color=PALETTE["text"], fontsize=11, pad=8)
    ax.set_ylabel("%", color=PALETTE["muted"], fontsize=8)


def _plot_vix(ax, vix: pd.Series, spy: pd.Series | None) -> None:
    _style_axis(ax)
    handles = []
    labels = []
    if not vix.empty:
        (line_vix,) = ax.plot(vix.index, vix.values, color=PALETTE["purple"], linewidth=1.8, label="VIX")
        handles.append(line_vix)
        labels.append("VIX")
        ax.axhline(20, color=PALETTE["yellow"], linestyle="--", linewidth=0.9, alpha=0.8)
        ax.axhline(30, color=PALETTE["red"], linestyle="--", linewidth=0.9, alpha=0.8)
    if spy is not None and not spy.empty:
        ax2 = ax.twinx()
        (line_spy,) = ax2.plot(spy.index, spy.values, color=PALETTE["blue"], linewidth=1.2, alpha=0.75, label="SPY")
        handles.append(line_spy)
        labels.append("SPY")
        ax2.tick_params(colors=PALETTE["muted"], labelsize=8)
        ax2.set_ylabel("SPY", color=PALETTE["muted"], fontsize=8)
        for spine in ax2.spines.values():
            spine.set_color(PALETTE["grid"])
    if handles:
        ax.legend(
            handles,
            labels,
            facecolor=PALETTE["panel"],
            edgecolor=PALETTE["grid"],
            labelcolor=PALETTE["text"],
            fontsize=8,
            loc="upper left",
        )
    ax.set_title("Volatility & Equities", color=PALETTE["text"], fontsize=11, pad=8)
    ax.set_ylabel("VIX", color=PALETTE["muted"], fontsize=8)


def _plot_risk_appetite(ax, ratio: pd.Series) -> None:
    _style_axis(ax)
    if ratio.empty:
        ax.text(0.5, 0.5, "No HYG/TLT data", ha="center", va="center", color=PALETTE["muted"], transform=ax.transAxes)
        ax.set_title("Risk Appetite (HYG/TLT)", color=PALETTE["text"], fontsize=11, pad=8)
        return

    base = float(ratio.dropna().iloc[0])
    indexed = (ratio / base - 1) * 100
    ax.plot(indexed.index, indexed.values, color=PALETTE["green"], linewidth=1.8)
    ax.axhline(0, color=PALETTE["muted"], linewidth=0.8, alpha=0.7)
    ax.fill_between(indexed.index, indexed.values, 0, where=indexed.values >= 0, color=PALETTE["green"], alpha=0.12)
    ax.fill_between(indexed.index, indexed.values, 0, where=indexed.values < 0, color=PALETTE["red"], alpha=0.12)
    ax.set_title("Risk Appetite (HYG/TLT rebase)", color=PALETTE["text"], fontsize=11, pad=8)
    ax.set_ylabel("% vs start", color=PALETTE["muted"], fontsize=8)


def _plot_component_bars(ax, stress: StressResult) -> None:
    _style_axis(ax)
    labels = ["Curve", "Credit", "Vol", "Risk-on"]
    keys = ["curve", "credit", "volatility", "risk_appetite"]
    values = [stress.components[k] for k in keys]
    colors = [_stress_color(int(v)) for v in values]
    y = np.arange(len(labels))
    ax.barh(y, values, color=colors, alpha=0.9, height=0.55)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, color=PALETTE["text"])
    for label in ax.get_yticklabels():
        label.set_color(PALETTE["text"])
    ax.set_xlim(0, 100)
    ax.set_title("Stress Components", color=PALETTE["text"], fontsize=11, pad=8)
    ax.set_xlabel("score", color=PALETTE["muted"], fontsize=8)
    for idx, val in enumerate(values):
        ax.text(val + 1.5, idx, f"{val:.0f}", va="center", color=PALETTE["text"], fontsize=8)


def _plot_stooq_cross_asset(ax, stooq_market: pd.DataFrame) -> None:
    _style_axis(ax)
    if stooq_market.empty:
        ax.text(
            0.5,
            0.5,
            "No Stooq cross-asset data",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title("Cross-Asset (Stooq, 60d rebase)", color=PALETTE["text"], fontsize=11, pad=8)
        return

    plot_map = {
        "spy.us": ("SPY", PALETTE["blue"]),
        "tlt.us": ("TLT", PALETTE["teal"]),
        "gld.us": ("GLD", PALETTE["yellow"]),
        "uso.us": ("USO", PALETTE["orange"]),
        "uup.us": ("UUP", PALETTE["purple"]),
        "qqq.us": ("QQQ", PALETTE["green"]),
    }
    plotted = False
    for symbol, (label, color) in plot_map.items():
        if symbol not in stooq_market.columns:
            continue
        series = stooq_market[symbol].dropna().tail(60)
        if len(series) < 5:
            continue
        base = float(series.iloc[0])
        indexed = (series / base - 1) * 100
        ax.plot(indexed.index, indexed.values, color=color, linewidth=1.6, label=label, alpha=0.95)
        plotted = True

    if not plotted:
        ax.text(
            0.5,
            0.5,
            "No Stooq series available",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
    else:
        ax.axhline(0, color=PALETTE["muted"], linewidth=0.8, alpha=0.7)
        ax.legend(facecolor=PALETTE["panel"], edgecolor=PALETTE["grid"], labelcolor=PALETTE["text"], fontsize=8, ncol=3)
    ax.set_title("Cross-Asset (Stooq, 60d rebase)", color=PALETTE["text"], fontsize=11, pad=8)
    ax.set_ylabel("% vs start", color=PALETTE["muted"], fontsize=8)


def plot_macro_dashboard(bundle: dict, stress: StressResult) -> io.BytesIO:
    snapshot = bundle["snapshot"]
    fred = bundle["fred"]
    market = bundle["market"]

    fig = plt.figure(figsize=(13, 10.5), facecolor=PALETTE["bg"])
    gs = GridSpec(4, 3, figure=fig, height_ratios=[1.0, 1.2, 1.2, 1.0], hspace=0.34, wspace=0.28)

    ax_gauge = fig.add_subplot(gs[0, 0])
    ax_components = fig.add_subplot(gs[0, 1:])
    _plot_gauge(ax_gauge, stress)
    _plot_component_bars(ax_components, stress)

    ax_curve = fig.add_subplot(gs[1, 0])
    ax_credit = fig.add_subplot(gs[1, 1:])
    _plot_yield_curve(ax_curve, snapshot)
    _plot_spread_history(
        ax_credit,
        fred.get("BAMLH0A0HYM2", pd.Series(dtype=float)),
        fred.get("BAMLC0A0CM", pd.Series(dtype=float)),
    )

    ax_vix = fig.add_subplot(gs[2, 0:2])
    ax_risk = fig.add_subplot(gs[2, 2])
    spy = market["SPY"] if "SPY" in market.columns else None
    _plot_vix(ax_vix, fred.get("VIXCLS", pd.Series(dtype=float)), spy)
    ratio = market["HYG_TLT"] if "HYG_TLT" in market.columns else pd.Series(dtype=float)
    _plot_risk_appetite(ax_risk, ratio)

    ax_stooq = fig.add_subplot(gs[3, :])
    stooq_market = bundle.get("stooq", {}).get("market", pd.DataFrame())
    _plot_stooq_cross_asset(ax_stooq, stooq_market)

    sources = []
    if bundle.get("uses_fred"):
        sources.append("FRED")
    sources.append("Yahoo Finance")
    if bundle.get("stooq", {}).get("available"):
        if bundle.get("stooq", {}).get("used_yahoo_fallback"):
            sources.append("Stooq(Yahoo fallback)")
        else:
            sources.append("Stooq")
    if bundle.get("finnhub", {}).get("available"):
        sources.append("Finnhub")
    if bundle.get("edgar", {}).get("pulse"):
        sources.append("SEC EDGAR")
    source = " + ".join(sources)
    fig.suptitle(
        f"Macro Risk Monitor  |  as of {snapshot.get('as_of', '')}",
        color=PALETTE["text"],
        fontsize=15,
        weight="bold",
        y=0.98,
    )
    fig.text(
        0.01,
        0.01,
        f"Source: {source}  |  /macro",
        color=PALETTE["muted"],
        fontsize=8,
    )

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor=PALETTE["bg"])
    plt.close(fig)
    buf.seek(0)
    return buf


def _format_edgar_lines(bundle: dict) -> list[str]:
    edgar = bundle.get("edgar") or {}
    pulse = edgar.get("pulse") or {}
    mentions = edgar.get("macro_mentions") or {}
    if not pulse and not mentions:
        return []

    lines = ["", "<b>SEC EDGAR pulse</b>"]
    if pulse:
        lines.append(
            f"• 8-K filings ({pulse.get('window_days', 7)}d): "
            f"<code>{pulse.get('filing_count', 0)}</code>"
        )
        top_items = pulse.get("top_items") or []
        if top_items:
            item_bits = [
                f"{row['item']} {row['label']} ({row['count']})"
                for row in top_items[:3]
            ]
            lines.append(f"• Top 8-K items: {', '.join(item_bits)}")

        for filing in (pulse.get("recent_filings") or [])[:4]:
            item_text = filing.get("item_summary") or filing.get("items") or filing.get("form")
            lines.append(
                f"  - {filing.get('company', '?')} | {item_text} | {filing.get('file_date', '')}"
            )

    if mentions:
        lines.append(
            f"• Macro-theme mentions ({mentions.get('window_days', 14)}d): "
            f"<code>{mentions.get('mention_count', 0)}</code>"
        )
        for filing in (mentions.get("filings") or [])[:3]:
            lines.append(
                f"  - {filing.get('company', '?')} | {filing.get('form', '')} | {filing.get('file_date', '')}"
            )

    if edgar.get("errors"):
        lines.append(f"<i>EDGAR partial data: {edgar['errors'][0]}</i>")
    return lines


def _format_stooq_lines(bundle: dict) -> list[str]:
    stooq = bundle.get("stooq") or {}
    snapshot = stooq.get("snapshot") or {}
    if not snapshot.get("symbol_count"):
        return []

    lines = ["", "<b>Cross-asset (Stooq)</b>"]
    moves_20d = snapshot.get("moves_20d") or {}
    for label, value in moves_20d.items():
        if value is None:
            continue
        lines.append(f"• {label}: <code>{value:+.2f}%</code>")

    latest = snapshot.get("latest") or {}
    if latest:
        latest_bits = []
        for label in ("Gold (GLD)", "Oil (USO)", "US Dollar (UUP)"):
            if label in latest:
                latest_bits.append(f"{label} {latest[label]:.2f}")
        if latest_bits:
            lines.append("• Latest: " + " | ".join(latest_bits))

    if stooq.get("errors") and not stooq.get("used_yahoo_fallback"):
        lines.append(f"<i>Stooq partial data ({len(stooq['errors'])} symbols skipped)</i>")
    elif stooq.get("used_yahoo_fallback"):
        lines.append("<i>Cross-asset via Yahoo fallback (Stooq unavailable)</i>")
    return lines


def _format_finnhub_lines(bundle: dict) -> list[str]:
    finnhub = bundle.get("finnhub") or {}
    if not finnhub.get("available"):
        return []

    lines = ["", "<b>Finnhub macro pulse</b>"]

    quotes = finnhub.get("quotes") or {}
    if quotes:
        quote_bits = []
        for label, payload in quotes.items():
            change = payload.get("change_pct")
            if change is None:
                continue
            quote_bits.append(f"{label} {change:+.2f}%")
        if quote_bits:
            lines.append("• Live moves: " + " | ".join(quote_bits[:5]))

    forex = finnhub.get("forex") or {}
    if forex:
        fx_bits = []
        for label, payload in forex.items():
            change = payload.get("change_pct")
            if change is None:
                continue
            fx_bits.append(f"{label} {change:+.2f}%")
        if fx_bits:
            lines.append("• FX: " + " | ".join(fx_bits))

    upcoming = finnhub.get("high_impact_upcoming") or []
    if upcoming:
        lines.append(f"• High-impact US events ahead: <code>{len(upcoming)}</code>")
        for event in upcoming[:4]:
            est = event.get("estimate")
            est_text = f" (est {est}{event.get('unit', '')})" if est not in (None, "") else ""
            lines.append(
                f"  - {event.get('date', '')} {event.get('time', '')} | "
                f"{event.get('event', '')}{est_text}"
            )

    releases = finnhub.get("recent_releases") or []
    for event in releases[:3]:
        actual = event.get("actual")
        estimate = event.get("estimate")
        if actual in (None, ""):
            continue
        surprise = ""
        if estimate not in (None, ""):
            surprise = f" vs est {estimate}"
        lines.append(
            f"  - Released: {event.get('event', '')} = {actual}{event.get('unit', '')}{surprise}"
        )

    for item in (finnhub.get("news") or [])[:4]:
        lines.append(f"  - [{item.get('category', 'news')}] {item.get('headline', '')}")

    if finnhub.get("errors"):
        lines.append(f"<i>Finnhub partial data: {finnhub['errors'][0]}</i>")
    return lines


def format_macro_chart_caption(bundle: dict, stress: StressResult) -> str:
    snap = bundle.get("snapshot") or {}
    return (
        f"{stress.emoji} Macro Risk Monitor\n"
        f"Stress {stress.score}/100 — {stress.regime}\n"
        f"{snap.get('as_of', '')}"
    )


def format_macro_text(bundle: dict, stress: StressResult) -> str:
    snap = bundle["snapshot"]
    lines = [
        f"{stress.emoji} <b>Macro Risk Monitor</b>",
        f"<i>{snap.get('as_of', '')}</i>",
        "",
        f"<b>Stress score:</b> {stress.score}/100 — {stress.regime}",
        "",
        "<b>Snapshot</b>",
    ]

    def _line(label: str, value: float | None, suffix: str = "") -> None:
        if value is not None:
            lines.append(f"• {label}: <code>{value:.2f}{suffix}</code>")

    _line("10Y Treasury", snap.get("DGS10"), "%")
    _line("2Y Treasury", snap.get("DGS2"), "%")
    _line("10Y-2Y spread", snap.get("T10Y2Y"), "%")
    _line("HY OAS", snap.get("HY_OAS"), "%")
    _line("IG OAS", snap.get("IG_OAS"), "%")
    _line("VIX", snap.get("VIX"), "")
    _line("S&P 500 (20d)", snap.get("SPY_20D"), "%")
    _line("HYG/TLT (20d)", snap.get("HYG_TLT_20D"), "%")

    lines.extend(["", "<b>Key signals</b>"])
    for driver in stress.drivers:
        lines.append(f"• {driver}")

    lines.extend(_format_stooq_lines(bundle))
    lines.extend(_format_finnhub_lines(bundle))
    lines.extend(_format_edgar_lines(bundle))

    sources = []
    if bundle.get("uses_fred"):
        sources.append("FRED")
    sources.append("Yahoo Finance")
    if bundle.get("stooq", {}).get("available"):
        if bundle.get("stooq", {}).get("used_yahoo_fallback"):
            sources.append("Stooq(Yahoo fallback)")
        else:
            sources.append("Stooq")
    if bundle.get("finnhub", {}).get("available"):
        sources.append("Finnhub")
    if bundle.get("edgar", {}).get("pulse") or bundle.get("edgar", {}).get("macro_mentions"):
        sources.append("SEC EDGAR")
    lines.extend(["", f"<i>Sources: {' + '.join(sources)}</i>"])

    if bundle.get("fred_errors") and not bundle.get("uses_fred"):
        lines.append("<i>Tip: set FRED_API_KEY in .env for official macro series.</i>")
    if not bundle.get("finnhub", {}).get("available"):
        lines.append("<i>Tip: set FINNHUB_API_KEY in .env for economic calendar, live quotes, and macro news.</i>")
    if bundle.get("edgar", {}).get("errors"):
        lines.append("<i>Tip: set SEC_EDGAR_USER_AGENT or SEC_CONTACT_EMAIL in .env for SEC fair-access.</i>")

    return "\n".join(lines)

"""Fundamental analysis charts for /financial."""

from __future__ import annotations

import io
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd
from matplotlib.gridspec import GridSpec

PALETTE = {
    "bg": "#0b1220",
    "panel": "#121b2d",
    "grid": "#243049",
    "text": "#e8edf7",
    "muted": "#93a4c3",
    "accent": "#60a5fa",
    "accent2": "#34d399",
    "accent3": "#fbbf24",
    "accent4": "#fb923c",
}


def _style_axis(ax) -> None:
    ax.set_facecolor(PALETTE["panel"])
    ax.tick_params(colors=PALETTE["muted"], labelsize=7)
    for spine in ax.spines.values():
        spine.set_color(PALETTE["grid"])
    ax.grid(True, color=PALETTE["grid"], alpha=0.35, linewidth=0.6)
    ax.title.set_color(PALETTE["text"])


def _series_or_empty(timeseries: dict[str, pd.Series], key: str) -> pd.Series:
    series = timeseries.get(key)
    if series is None or series.empty:
        return pd.Series(dtype=float)
    out = pd.to_numeric(series, errors="coerce").dropna()
    out.index = pd.to_datetime(out.index)
    return out.sort_index()


def _plot_revenue_eps(ax, timeseries: dict[str, pd.Series], symbol: str) -> None:
    _style_axis(ax)
    revenue = _series_or_empty(timeseries, "revenue")
    eps = _series_or_empty(timeseries, "eps")

    if revenue.empty and eps.empty:
        ax.text(
            0.5,
            0.5,
            "No revenue/EPS history",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title("Revenue & EPS", color=PALETTE["text"], fontsize=10, pad=6)
        return

    if not revenue.empty:
        rev_label = "Revenue" if revenue.max() > 1_000 else "Revenue / share"
        bars = ax.bar(
            revenue.index,
            revenue.values,
            width=180,
            color=PALETTE["accent"],
            alpha=0.85,
            label=rev_label,
        )
        ax.bar_label(bars, fmt="%.1f", fontsize=6, color=PALETTE["muted"], padding=2)
        ax.set_ylabel(rev_label, color=PALETTE["muted"], fontsize=8)

    if not eps.empty:
        ax2 = ax.twinx()
        ax2.plot(
            eps.index,
            eps.values,
            color=PALETTE["accent2"],
            marker="o",
            linewidth=2,
            label="EPS",
        )
        ax2.set_ylabel("EPS", color=PALETTE["accent2"], fontsize=8)
        ax2.tick_params(axis="y", colors=PALETTE["accent2"], labelsize=7)
        for spine in ax2.spines.values():
            spine.set_color(PALETTE["grid"])

    ax.set_title(f"{symbol} — Revenue & EPS", color=PALETTE["text"], fontsize=10, pad=6)
    ax.tick_params(axis="x", rotation=35)


def _plot_margin_series(ax, timeseries: dict[str, pd.Series], symbol: str) -> None:
    _style_axis(ax)
    plotted = False
    colors = {
        "gross_margin": PALETTE["accent3"],
        "operating_margin": PALETTE["accent4"],
        "net_margin": PALETTE["accent2"],
    }
    labels = {
        "gross_margin": "Gross",
        "operating_margin": "Operating",
        "net_margin": "Net",
    }
    for key, color in colors.items():
        series = _series_or_empty(timeseries, key)
        if series.empty:
            continue
        values = series.copy()
        if values.abs().max() <= 1.5:
            values = values * 100
        ax.plot(values.index, values.values, marker="o", linewidth=1.8, color=color, label=labels[key])
        plotted = True

    if not plotted:
        ax.text(
            0.5,
            0.5,
            "No margin history",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
    else:
        ax.legend(
            facecolor=PALETTE["panel"],
            edgecolor=PALETTE["grid"],
            labelcolor=PALETTE["text"],
            fontsize=7,
            loc="best",
        )
        ax.set_ylabel("Margin (%)", color=PALETTE["muted"], fontsize=8)

    ax.set_title(f"{symbol} — Margins", color=PALETTE["text"], fontsize=10, pad=6)
    ax.tick_params(axis="x", rotation=35)


def _plot_valuation(ax, timeseries: dict[str, pd.Series], symbol: str) -> None:
    _style_axis(ax)
    pe = _series_or_empty(timeseries, "pe")
    pb = _series_or_empty(timeseries, "pb")

    if pe.empty and pb.empty:
        ax.text(
            0.5,
            0.5,
            "No PER/PBR history",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title(f"{symbol} — Valuation multiples", color=PALETTE["text"], fontsize=10, pad=6)
        return

    handles: list = []
    labels: list[str] = []

    if not pe.empty:
        line, = ax.plot(pe.index, pe.values, color=PALETTE["accent"], marker="o", linewidth=2, label="PER")
        handles.append(line)
        labels.append("PER")
        ax.set_ylabel("PER", color=PALETTE["accent"], fontsize=8)

    if not pb.empty:
        target_ax = ax.twinx() if not pe.empty else ax
        line, = target_ax.plot(
            pb.index,
            pb.values,
            color=PALETTE["accent3"],
            marker="s",
            linewidth=2,
            label="PBR",
        )
        handles.append(line)
        labels.append("PBR")
        if target_ax is not ax:
            target_ax.set_ylabel("PBR", color=PALETTE["accent3"], fontsize=8)
            target_ax.tick_params(axis="y", colors=PALETTE["accent3"], labelsize=7)
            for spine in target_ax.spines.values():
                spine.set_color(PALETTE["grid"])
        elif pe.empty:
            ax.set_ylabel("PBR", color=PALETTE["muted"], fontsize=8)

    ax.legend(
        handles,
        labels,
        facecolor=PALETTE["panel"],
        edgecolor=PALETTE["grid"],
        labelcolor=PALETTE["text"],
        fontsize=7,
        loc="best",
    )
    ax.set_title(f"{symbol} — Valuation multiples", color=PALETTE["text"], fontsize=10, pad=6)
    ax.tick_params(axis="x", rotation=35)


def _plot_roe(ax, timeseries: dict[str, pd.Series], symbol: str) -> None:
    _style_axis(ax)
    roe = _series_or_empty(timeseries, "roe")
    if roe.empty:
        ax.text(
            0.5,
            0.5,
            "No ROE history",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
    else:
        values = roe.copy()
        if values.abs().max() <= 1.5:
            values = values * 100
        ax.plot(values.index, values.values, color=PALETTE["accent2"], marker="o", linewidth=2)
        ax.set_ylabel("ROE (%)", color=PALETTE["muted"], fontsize=8)

    ax.set_title(f"{symbol} — Return on equity", color=PALETTE["text"], fontsize=10, pad=6)
    ax.tick_params(axis="x", rotation=35)


def plot_financial_dashboard(profile: dict[str, Any]) -> io.BytesIO:
    symbol = profile["symbol"]
    timeseries = profile.get("timeseries") or {}

    fig = plt.figure(figsize=(14, 10), facecolor=PALETTE["bg"])
    gs = GridSpec(2, 2, figure=fig, hspace=0.35, wspace=0.28)

    _plot_revenue_eps(fig.add_subplot(gs[0, 0]), timeseries, symbol)
    _plot_margin_series(fig.add_subplot(gs[0, 1]), timeseries, symbol)
    _plot_valuation(fig.add_subplot(gs[1, 0]), timeseries, symbol)
    _plot_roe(fig.add_subplot(gs[1, 1]), timeseries, symbol)

    fig.suptitle(
        f"{profile['company_name']} ({symbol}) — Fundamental trends",
        color=PALETTE["text"],
        fontsize=13,
        y=0.98,
    )

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, facecolor=PALETTE["bg"], bbox_inches="tight")
    buf.seek(0)
    plt.close(fig)
    return buf


def format_financial_chart_caption(profile: dict[str, Any]) -> str:
    metrics = profile["metrics"]
    return (
        f"📈 {profile['symbol']} fundamentals — "
        f"PER {_fmt(metrics.get('per'))} · PBR {_fmt(metrics.get('pbr'))} · "
        f"ROE {_fmt_pct(metrics.get('roe'))} · EPS growth {_fmt_pct(metrics.get('eps_growth_yoy'), signed=True)}"
    )


def _fmt(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.1f}x"


def _fmt_pct(value: float | None, *, signed: bool = False) -> str:
    if value is None:
        return "n/a"
    pct = value * 100 if abs(value) <= 1.5 else value
    return f"{pct:+.1f}%" if signed else f"{pct:.1f}%"

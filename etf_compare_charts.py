"""ETF comparison charts for /comp."""

from __future__ import annotations

import io
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np
import pandas as pd
from matplotlib.gridspec import GridSpec

PALETTE = {
    "bg": "#0b1220",
    "panel": "#121b2d",
    "grid": "#243049",
    "text": "#e8edf7",
    "muted": "#93a4c3",
}

CHART_COLORS = [
    "#60a5fa",
    "#34d399",
    "#fbbf24",
    "#fb923c",
    "#a78bfa",
    "#f472b6",
    "#2dd4bf",
    "#f87171",
]

RETURN_FIELDS = [
    ("return_1m_pct", "1M"),
    ("return_3m_pct", "3M"),
    ("return_6m_pct", "6M"),
    ("return_ytd_pct", "YTD"),
    ("return_1y_pct", "1Y"),
]


def _style_axis(ax) -> None:
    ax.set_facecolor(PALETTE["panel"])
    ax.tick_params(colors=PALETTE["muted"], labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(PALETTE["grid"])
    ax.grid(True, color=PALETTE["grid"], alpha=0.35, linewidth=0.6)
    ax.title.set_color(PALETTE["text"])


def _color_map(symbols: list[str]) -> dict[str, str]:
    return {sym: CHART_COLORS[i % len(CHART_COLORS)] for i, sym in enumerate(symbols)}


def _plot_performance(ax, comparison: dict[str, Any], colors: dict[str, str]) -> None:
    _style_axis(ax)
    performance = comparison.get("performance") or {}
    series_map = performance.get("series") or {}
    labels = performance.get("labels") or {}

    if not series_map:
        ax.text(
            0.5,
            0.5,
            "No price history",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title("Normalized Performance (base=100)", color=PALETTE["text"], fontsize=11, pad=8)
        return

    for symbol, series in series_map.items():
        if series.empty:
            continue
        label = labels.get(symbol, symbol)
        profiles = comparison.get("profiles") or []
        profile = next((p for p in profiles if p["symbol"] == symbol), {})
        if profile.get("price_source") == "index_proxy":
            label = f"{symbol}*"
        ax.plot(
            series.index,
            series.values,
            color=colors.get(symbol, PALETTE["text"]),
            linewidth=2.0,
            label=label,
        )

    ax.legend(
        facecolor=PALETTE["panel"],
        edgecolor=PALETTE["grid"],
        labelcolor=PALETTE["text"],
        fontsize=7,
        loc="upper left",
    )
    ax.set_ylabel("Index (100=start)", color=PALETTE["muted"], fontsize=8)
    subtitle = "* short history → index proxy"
    ax.set_title(
        f"Normalized Performance\n{subtitle}",
        color=PALETTE["text"],
        fontsize=11,
        pad=8,
    )


def _plot_returns(ax, profiles: list[dict[str, Any]], colors: dict[str, str]) -> None:
    _style_axis(ax)
    symbols = [p["symbol"] for p in profiles]
    period_labels = [label for _, label in RETURN_FIELDS]
    x = np.arange(len(period_labels))
    width = 0.8 / max(len(symbols), 1)

    for i, profile in enumerate(profiles):
        values = [profile.get(field) for field, _ in RETURN_FIELDS]
        plotted = [0.0 if v is None else float(v) for v in values]
        offset = (i - (len(symbols) - 1) / 2) * width
        bars = ax.bar(
            x + offset,
            plotted,
            width=width,
            color=colors.get(profile["symbol"], PALETTE["text"]),
            label=profile["symbol"],
            alpha=0.9,
        )
        for bar, val in zip(bars, values):
            if val is None:
                bar.set_alpha(0.25)

    ax.axhline(0, color=PALETTE["muted"], linewidth=0.8, alpha=0.6)
    ax.set_xticks(x)
    ax.set_xticklabels(period_labels)
    ax.set_ylabel("Return (%)", color=PALETTE["muted"], fontsize=8)
    ax.legend(
        facecolor=PALETTE["panel"],
        edgecolor=PALETTE["grid"],
        labelcolor=PALETTE["text"],
        fontsize=7,
        ncol=min(len(symbols), 4),
        loc="upper left",
    )
    ax.set_title("Return Comparison", color=PALETTE["text"], fontsize=11, pad=8)


def _plot_cost_liquidity(ax, profiles: list[dict[str, Any]], colors: dict[str, str]) -> None:
    _style_axis(ax)
    symbols = [p["symbol"] for p in profiles]
    y = np.arange(len(symbols))

    expense = [
        float(p["expense_ratio_pct"]) if p.get("expense_ratio_pct") is not None else 0.0
        for p in profiles
    ]
    has_expense = any(p.get("expense_ratio_pct") is not None for p in profiles)

    dollar_vol = []
    for p in profiles:
        dv = p.get("avg_dollar_volume_21d")
        dollar_vol.append(float(dv) / 1_000_000_000 if dv else 0.0)
    has_liquidity = any(p.get("avg_dollar_volume_21d") for p in profiles)

    if has_expense:
        ax.barh(
            y - 0.18,
            expense,
            height=0.32,
            color=[colors.get(sym, PALETTE["text"]) for sym in symbols],
            alpha=0.85,
            label="Expense ratio (%)",
        )
    if has_liquidity:
        ax.barh(
            y + 0.18,
            dollar_vol,
            height=0.32,
            color=[colors.get(sym, PALETTE["text"]) for sym in symbols],
            alpha=0.45,
            label="Avg $ vol 21D (B)",
        )

    ax.set_yticks(y)
    ax.set_yticklabels(symbols)
    if has_expense or has_liquidity:
        ax.legend(
            facecolor=PALETTE["panel"],
            edgecolor=PALETTE["grid"],
            labelcolor=PALETTE["text"],
            fontsize=7,
            loc="lower right",
        )
    else:
        ax.text(
            0.5,
            0.5,
            "No cost/liquidity data",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
    ax.set_title("Cost & Liquidity", color=PALETTE["text"], fontsize=11, pad=8)


def _plot_overlap(ax, comparison: dict[str, Any], colors: dict[str, str]) -> None:
    ax.set_facecolor(PALETTE["panel"])
    symbols = comparison.get("symbols") or []
    overlap_df = comparison.get("overlap")
    if overlap_df is None or overlap_df.empty or len(symbols) < 2:
        ax.axis("off")
        ax.text(
            0.5,
            0.5,
            "Overlap heatmap\n(need 2+ ETFs with holdings)",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title("Holdings Overlap", color=PALETTE["text"], fontsize=11, pad=8)
        return

    n = len(symbols)
    matrix = np.zeros((n, n))
    for _, row in overlap_df.iterrows():
        a = row["etf_a"]
        b = row["etf_b"]
        if a not in symbols or b not in symbols:
            continue
        i, j = symbols.index(a), symbols.index(b)
        val = float(row["overlap_weight_pct"])
        matrix[i, j] = val
        matrix[j, i] = val

    im = ax.imshow(matrix, cmap="YlOrRd", vmin=0, vmax=max(100, matrix.max()))
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))
    ax.set_xticklabels(symbols, color=PALETTE["text"], fontsize=8)
    ax.set_yticklabels(symbols, color=PALETTE["text"], fontsize=8)
    for i in range(n):
        for j in range(n):
            if i == j:
                text = "—"
            else:
                text = f"{matrix[i, j]:.0f}%"
            ax.text(
                j,
                i,
                text,
                ha="center",
                va="center",
                color=PALETTE["text"] if matrix[i, j] < 55 else PALETTE["bg"],
                fontsize=8,
            )
    ax.set_title("Holdings Overlap (%)", color=PALETTE["text"], fontsize=11, pad=8)
    cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.ax.tick_params(colors=PALETTE["muted"], labelsize=7)


def format_comp_chart_caption(comparison: dict[str, Any]) -> str:
    symbols = ", ".join(comparison.get("symbols") or [])
    return f"📊 ETF Comparison Dashboard\n{symbols}"


def plot_etf_compare_dashboard(comparison: dict[str, Any]) -> io.BytesIO:
    profiles = comparison.get("profiles") or []
    symbols = comparison.get("symbols") or []
    colors = _color_map(symbols)

    fig = plt.figure(figsize=(14, 11), facecolor=PALETTE["bg"])
    gs = GridSpec(3, 2, figure=fig, height_ratios=[1.2, 1.0, 0.85], hspace=0.35, wspace=0.22)

    _plot_performance(fig.add_subplot(gs[0, :]), comparison, colors)
    _plot_returns(fig.add_subplot(gs[1, 0]), profiles, colors)
    _plot_cost_liquidity(fig.add_subplot(gs[1, 1]), profiles, colors)
    _plot_overlap(fig.add_subplot(gs[2, :]), comparison, colors)

    fig.suptitle(
        "ETF Comparison Dashboard",
        color=PALETTE["text"],
        fontsize=15,
        weight="bold",
        y=0.98,
    )

    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=140, bbox_inches="tight", facecolor=PALETTE["bg"])
    plt.close(fig)
    buffer.seek(0)
    return buffer

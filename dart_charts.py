"""DART financial charts for /dart."""

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


def _to_100m(value: float) -> float:
    return value / 100_000_000


def _plot_revenue_profit(ax, history: pd.DataFrame, corp_name: str) -> None:
    _style_axis(ax)
    years = history["year"].astype(str)
    revenue = history["revenue"].fillna(0)
    op = history["operating_profit"].fillna(0)
    net = history["net_income"].fillna(0)

    width = 0.25
    x = range(len(years))
    ax.bar([i - width for i in x], [_to_100m(v) for v in revenue], width=width, label="Revenue", color=PALETTE["accent"])
    ax.bar(x, [_to_100m(v) for v in op], width=width, label="Op. profit", color=PALETTE["accent2"])
    ax.bar([i + width for i in x], [_to_100m(v) for v in net], width=width, label="Net income", color=PALETTE["accent3"])
    ax.set_xticks(list(x), list(years), rotation=0)
    ax.set_ylabel("100M KRW", color=PALETTE["muted"], fontsize=8)
    ax.legend(facecolor=PALETTE["panel"], edgecolor=PALETTE["grid"], labelcolor=PALETTE["text"], fontsize=7)
    ax.set_title(f"{corp_name} — Revenue & profit", color=PALETTE["text"], fontsize=10, pad=6)


def _plot_margins(ax, history: pd.DataFrame, corp_name: str) -> None:
    _style_axis(ax)
    years = history["year"].astype(str)
    op_margin = (history["operating_profit"] / history["revenue"] * 100).replace([pd.NA], pd.NA)
    net_margin = (history["net_income"] / history["revenue"] * 100).replace([pd.NA], pd.NA)
    roe = (history["net_income"] / history["total_equity"] * 100).replace([pd.NA], pd.NA)

    ax.plot(years, op_margin, marker="o", color=PALETTE["accent2"], linewidth=2, label="Op. margin")
    ax.plot(years, net_margin, marker="o", color=PALETTE["accent3"], linewidth=2, label="Net margin")
    ax.plot(years, roe, marker="s", color=PALETTE["accent"], linewidth=2, label="ROE")
    ax.set_ylabel("%", color=PALETTE["muted"], fontsize=8)
    ax.legend(facecolor=PALETTE["panel"], edgecolor=PALETTE["grid"], labelcolor=PALETTE["text"], fontsize=7)
    ax.set_title(f"{corp_name} — Profitability", color=PALETTE["text"], fontsize=10, pad=6)


def _plot_balance(ax, history: pd.DataFrame, corp_name: str) -> None:
    _style_axis(ax)
    years = history["year"].astype(str)
    assets = history["total_assets"].fillna(0)
    equity = history["total_equity"].fillna(0)
    ax.plot(years, [_to_100m(v) for v in assets], marker="o", color=PALETTE["accent"], linewidth=2, label="Assets")
    ax.plot(years, [_to_100m(v) for v in equity], marker="o", color=PALETTE["accent2"], linewidth=2, label="Equity")
    ax.set_ylabel("100M KRW", color=PALETTE["muted"], fontsize=8)
    ax.legend(facecolor=PALETTE["panel"], edgecolor=PALETTE["grid"], labelcolor=PALETTE["text"], fontsize=7)
    ax.set_title(f"{corp_name} — Balance sheet", color=PALETTE["text"], fontsize=10, pad=6)


def _plot_growth(ax, history: pd.DataFrame, corp_name: str) -> None:
    _style_axis(ax)
    if len(history) < 2:
        ax.text(0.5, 0.5, "Not enough data", ha="center", va="center", color=PALETTE["muted"], transform=ax.transAxes)
        ax.set_title(f"{corp_name} — YoY growth", color=PALETTE["text"], fontsize=10, pad=6)
        return

    rev_growth = history["revenue"].pct_change() * 100
    net_growth = history["net_income"].pct_change() * 100
    years = history["year"].astype(str)[1:]
    ax.bar(
        [str(y) for y in years],
        rev_growth.iloc[1:],
        width=0.35,
        label="Revenue YoY",
        color=PALETTE["accent"],
        alpha=0.85,
    )
    ax.bar(
        [str(y) for y in years],
        net_growth.iloc[1:],
        width=0.35,
        label="Net income YoY",
        color=PALETTE["accent3"],
        alpha=0.65,
    )
    ax.axhline(0, color=PALETTE["muted"], linewidth=0.8)
    ax.set_ylabel("%", color=PALETTE["muted"], fontsize=8)
    ax.legend(facecolor=PALETTE["panel"], edgecolor=PALETTE["grid"], labelcolor=PALETTE["text"], fontsize=7)
    ax.set_title(f"{corp_name} — YoY growth", color=PALETTE["text"], fontsize=10, pad=6)


def plot_dart_dashboard(profile: dict[str, Any]) -> io.BytesIO:
    history = profile["history"]
    corp_name = profile["corp_name"]

    fig = plt.figure(figsize=(14, 10), facecolor=PALETTE["bg"])
    gs = GridSpec(2, 2, figure=fig, hspace=0.35, wspace=0.28)
    _plot_revenue_profit(fig.add_subplot(gs[0, 0]), history, corp_name)
    _plot_margins(fig.add_subplot(gs[0, 1]), history, corp_name)
    _plot_balance(fig.add_subplot(gs[1, 0]), history, corp_name)
    _plot_growth(fig.add_subplot(gs[1, 1]), history, corp_name)
    fig.suptitle(
        f"{corp_name} — DART consolidated financials",
        color=PALETTE["text"],
        fontsize=13,
        y=0.98,
    )

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, facecolor=PALETTE["bg"], bbox_inches="tight")
    buf.seek(0)
    plt.close(fig)
    return buf


def format_dart_chart_caption(profile: dict[str, Any]) -> str:
    ratios = profile.get("ratios") or {}
    year = profile.get("latest_year", "")
    return (
        f"📊 {profile['corp_name']} ({year}) — "
        f"영업이익률 {_fmt(ratios.get('operating_margin'))} · "
        f"ROE {_fmt(ratios.get('roe'))} · "
        f"매출 YoY {_fmt(ratios.get('revenue_growth'), signed=True)}"
    )


def _fmt(value: float | None, *, signed: bool = False) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    return f"{value:+.1f}%" if signed else f"{value:.1f}%"

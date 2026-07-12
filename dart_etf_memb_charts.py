"""Charts for Korean ETF membership (/dart etf memb)."""

from __future__ import annotations

import io
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

PALETTE = {
    "bg": "#0b1220",
    "panel": "#121b2d",
    "grid": "#243049",
    "text": "#e8edf7",
    "muted": "#93a4c3",
    "accent": "#60a5fa",
    "pos": "#34d399",
    "neg": "#f87171",
}

BAR_COLORS = [
    "#60a5fa",
    "#34d399",
    "#fbbf24",
    "#fb923c",
    "#a78bfa",
    "#f472b6",
    "#2dd4bf",
    "#f87171",
    "#94a3b8",
    "#c084fc",
]


def plot_etf_memb_dashboard(profile: dict[str, Any]) -> io.BytesIO:
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()
    holdings = profile.get("holdings") or []
    changes = profile.get("changes") or {}
    top = holdings[:12]

    fig, axes = plt.subplots(1, 2, figsize=(14, 7), facecolor=PALETTE["bg"])
    fig.suptitle(
        f"{profile['ticker']} ETF holdings",
        color=PALETTE["text"],
        fontsize=13,
        y=0.98,
    )

    ax = axes[0]
    ax.set_facecolor(PALETTE["panel"])
    if top:
        labels = [row["code"] for row in reversed(top)]
        weights = [row.get("weight_pct") or 0 for row in reversed(top)]
        colors = [BAR_COLORS[i % len(BAR_COLORS)] for i in range(len(labels))][::-1]
        ax.barh(labels, weights, color=colors)
        for y, weight in enumerate(weights):
            ax.text(weight + 0.3, y, f"{weight:.1f}%", va="center", color=PALETTE["muted"], fontsize=8)
        ax.set_xlabel("Weight %", color=PALETTE["muted"])
    else:
        ax.text(0.5, 0.5, "No holdings", ha="center", va="center", color=PALETTE["muted"], transform=ax.transAxes)
    ax.set_title("Composition weights", color=PALETTE["text"], fontsize=11)
    ax.tick_params(colors=PALETTE["muted"], labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(PALETTE["grid"])
    ax.grid(True, axis="x", color=PALETTE["grid"], alpha=0.35)

    ax2 = axes[1]
    ax2.set_facecolor(PALETTE["panel"])
    changed = (changes.get("changed") or [])[:10]
    if changed:
        labels = [row["code"] for row in reversed(changed)]
        deltas = [row["delta"] for row in reversed(changed)]
        colors = [PALETTE["pos"] if d >= 0 else PALETTE["neg"] for d in deltas]
        ax2.barh(labels, deltas, color=colors)
        ax2.axvline(0, color=PALETTE["muted"], linewidth=0.8)
        ax2.set_xlabel("Weight change (%p)", color=PALETTE["muted"])
        ax2.set_title("Weight changes vs last snapshot", color=PALETTE["text"], fontsize=11)
    elif not changes.get("has_previous"):
        ax2.text(
            0.5,
            0.5,
            "First snapshot saved.\nRun again later for changes.",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax2.transAxes,
            fontsize=10,
        )
        ax2.set_title("Weight changes", color=PALETTE["text"], fontsize=11)
    else:
        ax2.text(
            0.5,
            0.5,
            "No meaningful weight changes",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax2.transAxes,
        )
        ax2.set_title("Weight changes vs last snapshot", color=PALETTE["text"], fontsize=11)
    ax2.tick_params(colors=PALETTE["muted"], labelsize=8)
    for spine in ax2.spines.values():
        spine.set_color(PALETTE["grid"])
    ax2.grid(True, axis="x", color=PALETTE["grid"], alpha=0.35)

    fig.tight_layout(rect=(0, 0, 1, 0.95))
    from chart_buffers import figure_to_png_buffer

    return figure_to_png_buffer(
        fig,
        dpi=130,
        facecolor=PALETTE["bg"],
        bbox_inches="tight",
    )


def format_etf_memb_chart_caption(profile: dict[str, Any]) -> str:
    top = (profile.get("holdings") or [])[:3]
    top_txt = ", ".join(
        f"{row['name']} {row.get('weight_pct', 0):.1f}%" for row in top if row.get("weight_pct") is not None
    )
    return f"📦 {profile['name']} ({profile['ticker']}) holdings — {top_txt}"

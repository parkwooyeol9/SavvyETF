"""Matplotlib charts for /seasonality monthly return seasonality."""

from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np

_FOCUS_COLOR = "#f59e0b"
_OTHER_COLOR = "#60a5fa"
_MUTED = "#64748b"


def plot_monthly_seasonality_bar(result: dict) -> io.BytesIO:
    """Bar chart of average monthly returns; focus months highlighted."""
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()
    stats = result.get("monthly_stats") or []
    if not stats:
        raise ValueError("no monthly stats")

    labels = [row["label_ko"] for row in stats]
    means = [row.get("mean_pct") or 0.0 for row in stats]
    colors = [
        _FOCUS_COLOR if row.get("in_focus") else _OTHER_COLOR for row in stats
    ]

    display = result.get("display") or result.get("symbol") or ""
    focus_label = result.get("focus_label_ko") or ""
    years = result.get("lookback_years") or 10
    verdict = (result.get("verdict") or {}).get("label") or ""

    fig, ax = plt.subplots(figsize=(10, 5), facecolor="#0f1419")
    ax.set_facecolor("#0f1419")

    x = np.arange(len(labels))
    bars = ax.bar(x, means, color=colors, edgecolor="#1e293b", linewidth=0.6)
    ax.axhline(0, color="#334155", linewidth=0.8, linestyle="--")

    ax.set_xticks(x)
    ax.set_xticklabels(labels, color="#cbd5e1", fontsize=9)
    ax.set_ylabel("평균 월수익률 (%)", color="#94a3b8", fontsize=9)
    ax.tick_params(axis="y", colors="#94a3b8", labelsize=8)
    ax.set_title(
        f"{display} — 월별 평균 수익률 ({years}년)\n"
        f"집중 시즌: {focus_label}  |  판정: {verdict}",
        color="#e2e8f0",
        fontsize=11,
        pad=12,
    )

    for bar, val in zip(bars, means):
        if not np.isfinite(val):
            continue
        y = val + (0.15 if val >= 0 else -0.35)
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            y,
            f"{val:+.1f}%",
            ha="center",
            va="bottom" if val >= 0 else "top",
            color="#e2e8f0",
            fontsize=7,
        )

    for spine in ax.spines.values():
        spine.set_color("#1e293b")
    ax.grid(axis="y", color="#1e293b", linestyle=":", linewidth=0.5, alpha=0.8)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=140, facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    return buf

"""Chart for /etf_holdings weight history."""

from __future__ import annotations

from io import BytesIO

import matplotlib.pyplot as plt

from chart_buffers import figure_to_png_buffer
from cjk_font import configure_matplotlib_cjk


def plot_etf_holdings_chart(profile: dict) -> BytesIO:
    configure_matplotlib_cjk()
    points = profile["points"]
    xs = [p.asof for p in points]
    ys = [p.weight_pct for p in points]

    fig, ax = plt.subplots(figsize=(10.5, 5.2), dpi=140)
    fig.patch.set_facecolor("#0f1419")
    ax.set_facecolor("#151c24")
    ax.plot(xs, ys, color="#5eead4", linewidth=2.2, marker="o", markersize=3.5)
    ax.fill_between(xs, ys, color="#5eead4", alpha=0.12)
    ax.set_title(
        f"{profile['etf']} · {profile['holding_ticker'] or profile['holding_query']} weight %",
        color="#e8eef5",
        fontsize=13,
        pad=10,
    )
    ax.set_ylabel("Weight (%)", color="#c5d0dc")
    ax.tick_params(colors="#8b98a8")
    for spine in ax.spines.values():
        spine.set_color("#2b3648")
    ax.grid(True, color="#2b3648", alpha=0.7, linestyle="--", linewidth=0.6)
    if points:
        last = points[-1]
        ax.annotate(
            f"{last.weight_pct:.3f}%",
            xy=(last.asof, last.weight_pct),
            xytext=(8, 8),
            textcoords="offset points",
            color="#fde68a",
            fontsize=9,
        )
    fig.autofmt_xdate()
    fig.tight_layout()
    return figure_to_png_buffer(fig)


def format_etf_holdings_chart_caption(profile: dict) -> str:
    # kept for import symmetry; primary caption lives in etf_holdings.py
    return (
        f"{profile['etf']} 내 {profile['holding_ticker'] or profile['holding_query']} "
        f"편입비 추이"
    )

"""Matplotlib charts for ADR listing impact analysis."""

from __future__ import annotations

import io
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np

PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = PROJECT_DIR / "data" / "adr_output"


def _ensure_dir(run_id: str) -> Path:
    out = OUTPUT_DIR / run_id
    out.mkdir(parents=True, exist_ok=True)
    return out


def plot_single_adr(result: dict, save_path: Path | None = None) -> io.BytesIO:
    metrics = result["metrics"]
    event = result["event"]
    listing = metrics["analysis_event_date"]

    fig, axes = plt.subplots(2, 1, figsize=(12, 9), sharex=True)

    ax1 = axes[0]
    ax1.plot(event.index, event["price_index"], color="#2563eb", linewidth=1.2)
    ax1.axvline(
        np.datetime64(listing),
        color="#dc2626",
        linestyle="--",
        linewidth=1.5,
        label=f"event date ({listing})",
    )
    ax1.axhline(100, color="#9ca3af", linestyle=":", linewidth=0.8)
    ax1.set_ylabel("Price index (100 = event date)")
    ax1.set_title(
        f"{metrics['company_name']} ({metrics['underlying_symbol']})\n"
        f"Underlying shares ±2y around ADR listing event"
    )
    ax1.legend(loc="upper left")
    ax1.grid(True, alpha=0.3)

    ax2 = axes[1]
    colors = event["phase"].map({"pre": "#64748b", "event": "#f59e0b", "post": "#059669"})
    ax2.bar(event.index, event["volume"] / 1e6, color=colors, width=1.0, alpha=0.85)
    ax2.axvline(np.datetime64(listing), color="#dc2626", linestyle="--")
    ax2.set_ylabel("Volume (millions)")
    ax2.set_xlabel("Date")
    ax2.grid(True, alpha=0.3)

    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    if save_path:
        fig.savefig(save_path, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf


def plot_panel_summary(analysis: dict, save_path: Path | None = None) -> io.BytesIO:
    results = analysis["results"]
    n = len(results)
    if n == 0:
        raise ValueError("No results to chart")

    cols = min(2, n)
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(7 * cols, 4.5 * rows))
    axes = np.atleast_1d(axes).flatten()

    for ax, result in zip(axes, results):
        m = result["metrics"]
        labels = ["Pre\n(2y avg)", "Post\n(2y avg)"]
        rets = [m["pre_avg_daily_return_pct"], m["post_avg_daily_return_pct"]]
        vols = [m["pre_avg_volume"] / 1e6, m["post_avg_volume"] / 1e6]

        x = np.arange(2)
        w = 0.35
        ax.bar(x - w / 2, rets, width=w, label="Avg daily return (%)", color="#3b82f6")
        ax2 = ax.twinx()
        ax2.bar(x + w / 2, vols, width=w, label="Avg volume (M)", color="#10b981", alpha=0.7)
        ax.set_xticks(x)
        ax.set_xticklabels(labels)
        ax.set_title(f"{m['adr_symbol']} → {m['underlying_symbol']}")
        ax.set_ylabel("Return (%)")
        ax2.set_ylabel("Volume (M)")

        sig = "*" if m.get("significant_at_5pct") else ""
        ratio = m.get("volume_post_to_pre_ratio")
        if ratio == ratio:  # not NaN
            ax.text(
                0.5,
                0.95,
                f"Vol ratio post/pre: {ratio:.2f}x{sig}",
                transform=ax.transAxes,
                ha="center",
                va="top",
                fontsize=9,
            )

    for ax in axes[len(results) :]:
        ax.axis("off")

    fig.suptitle("ADR listing impact — underlying shares (pre vs post)", fontsize=14, y=1.02)
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    if save_path:
        fig.savefig(save_path, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf


def plot_aligned_overlay_returns(analysis: dict, save_path: Path | None = None) -> io.BytesIO:
    """
    Overlay multiple underlying series aligned to the ADR listing event (t=0).

    X-axis: trading_day_offset (0 = first trading day on/after listing date)
    Y-axis: rebased cumulative return (%) where t=0 is 0%.
    """
    results = analysis["results"]
    if not results:
        raise ValueError("No results to chart")

    fig, ax = plt.subplots(1, 1, figsize=(12, 6.5))

    for result in results:
        m = result["metrics"]
        event = result["event"]
        x = event.get("trading_day_offset")
        y = event.get("rebased_return_pct")
        if x is None or y is None:
            continue
        label = f"{m['adr_symbol']} → {m['underlying_symbol']}"
        ax.plot(x, y, linewidth=1.4, label=label)

    ax.axvline(0, color="#dc2626", linestyle="--", linewidth=1.4, label="t=0 (listing)")
    ax.axhline(0, color="#9ca3af", linestyle=":", linewidth=0.9)
    ax.set_title("Aligned ADR impact — underlying cumulative return (rebased at t=0)")
    ax.set_xlabel("Trading-day offset from listing (t=0)")
    ax.set_ylabel("Cumulative return (%) (0% at t=0)")
    ax.grid(True, alpha=0.25)
    ax.legend(loc="best", fontsize=9)

    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    if save_path:
        fig.savefig(save_path, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf


def save_all_charts(analysis: dict, run_id: str) -> dict[str, Path]:
    out_dir = _ensure_dir(run_id)
    paths: dict[str, Path] = {}

    plot_panel_summary(analysis, out_dir / "summary_panel.png")
    paths["summary_panel"] = out_dir / "summary_panel.png"

    plot_aligned_overlay_returns(analysis, out_dir / "aligned_overlay.png")
    paths["aligned_overlay"] = out_dir / "aligned_overlay.png"

    for result in analysis["results"]:
        sym = result["metrics"]["adr_symbol"]
        plot_single_adr(result, out_dir / f"{sym}_event.png")
        paths[sym] = out_dir / f"{sym}_event.png"

    return paths


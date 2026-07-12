"""Matplotlib charts for /event country-index event studies."""

from __future__ import annotations

import io
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = PROJECT_DIR / "data" / "event_output"

# Distinct colors for up to ~10 countries
_COLORS = [
    "#2563eb",
    "#dc2626",
    "#059669",
    "#d97706",
    "#7c3aed",
    "#0891b2",
    "#be185d",
    "#4b5563",
    "#65a30d",
    "#ea580c",
]


def _ensure_dir(run_id: str) -> Path:
    out = OUTPUT_DIR / run_id
    out.mkdir(parents=True, exist_ok=True)
    return out


def plot_event_country_overlay(
    panel: dict,
    *,
    query: str = "",
    save_path: Path | None = None,
) -> io.BytesIO:
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()
    series_list = panel.get("series") or []
    if not series_list:
        raise ValueError("No series to chart")

    fig, ax = plt.subplots(1, 1, figsize=(12, 6.5))
    for idx, item in enumerate(series_list):
        frame = item["frame"]
        x = frame["trading_day_offset"]
        y = frame["rebased_return_pct"]
        color = _COLORS[idx % len(_COLORS)]
        label = f"{item['country']} ({item['symbol']})"
        ax.plot(x, y, linewidth=1.5, color=color, label=label)

    event_date = panel.get("event_date_str") or ""
    title = panel.get("title") or ""
    title_bit = f" — {title}" if title else ""
    query_bit = f"[{query}] " if query else ""
    ax.axvline(0, color="#dc2626", linestyle="--", linewidth=1.4, label="t=0 (event)")
    ax.axhline(0, color="#9ca3af", linestyle=":", linewidth=0.9)
    ax.set_title(
        f"{query_bit}Country indices around {event_date}{title_bit}\n"
        f"Cumulative return rebased at t=0 (first session on/after event)"
    )
    ax.set_xlabel("Trading-day offset from event (t=0)")
    ax.set_ylabel("Cumulative return (%)")
    ax.grid(True, alpha=0.25)
    ax.legend(loc="best", fontsize=8, ncol=2)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    if save_path:
        fig.savefig(save_path, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf


def plot_average_across_events(
    averages: list[dict],
    *,
    query: str = "",
    n_events: int = 0,
    save_path: Path | None = None,
) -> io.BytesIO:
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()
    if not averages:
        raise ValueError("No average series to chart")

    fig, ax = plt.subplots(1, 1, figsize=(12, 6.5))
    for idx, item in enumerate(averages):
        frame = item["frame"]
        color = _COLORS[idx % len(_COLORS)]
        n = item.get("n_events", n_events)
        label = f"{item['country']} (n={n})"
        ax.plot(
            frame["trading_day_offset"],
            frame["rebased_return_pct"],
            linewidth=1.6,
            color=color,
            label=label,
        )

    query_bit = f"[{query}] " if query else ""
    ax.axvline(0, color="#dc2626", linestyle="--", linewidth=1.4, label="t=0")
    ax.axhline(0, color="#9ca3af", linestyle=":", linewidth=0.9)
    ax.set_title(
        f"{query_bit}Average path across events (n={n_events})\n"
        "Mean cumulative return by country, rebased at each event t=0"
    )
    ax.set_xlabel("Trading-day offset from event (t=0)")
    ax.set_ylabel("Mean cumulative return (%)")
    ax.grid(True, alpha=0.25)
    ax.legend(loc="best", fontsize=8, ncol=2)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    if save_path:
        fig.savefig(save_path, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf


def save_event_charts(
    study: dict,
    *,
    run_id: str,
    query: str,
) -> dict[str, Path]:
    out_dir = _ensure_dir(run_id)
    paths: dict[str, Path] = {}
    for panel in study.get("panels") or []:
        if not panel.get("series"):
            continue
        date_str = panel.get("event_date_str") or "event"
        path = out_dir / f"event_{date_str}.png"
        plot_event_country_overlay(panel, query=query, save_path=path)
        paths[date_str] = path
    averages = study.get("averages") or []
    if averages:
        path = out_dir / "average_across_events.png"
        usable = sum(1 for p in (study.get("panels") or []) if p.get("series"))
        plot_average_across_events(
            averages, query=query, n_events=usable, save_path=path
        )
        paths["average"] = path
    return paths

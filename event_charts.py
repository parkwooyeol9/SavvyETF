"""Matplotlib charts for /event country-index event studies."""

from __future__ import annotations

import io
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np

from event_study import COUNTRY_LABEL_KO, HORIZON_DAYS

PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = PROJECT_DIR / "data" / "event_output"

_COLORS = {
    "United States": "#2563eb",
    "Japan": "#dc2626",
    "South Korea": "#059669",
    "China": "#d97706",
}


def _ensure_dir(run_id: str) -> Path:
    out = OUTPUT_DIR / run_id
    out.mkdir(parents=True, exist_ok=True)
    return out


def _color(country: str, idx: int = 0) -> str:
    if country in _COLORS:
        return _COLORS[country]
    fallback = ["#2563eb", "#dc2626", "#059669", "#d97706"]
    return fallback[idx % len(fallback)]


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

    fig, ax = plt.subplots(1, 1, figsize=(11, 6))
    for idx, item in enumerate(series_list):
        frame = item["frame"]
        label = f"{item.get('country_ko') or item['country']} ({item['symbol']})"
        ax.plot(
            frame["trading_day_offset"],
            frame["rebased_return_pct"],
            linewidth=1.6,
            color=_color(item["country"], idx),
            label=label,
        )

    event_date = panel.get("event_date_str") or ""
    title = panel.get("title") or ""
    title_bit = f" — {title}" if title else ""
    query_bit = f"[{query}] " if query else ""
    ax.axvline(0, color="#dc2626", linestyle="--", linewidth=1.3, label="t=0")
    ax.axhline(0, color="#9ca3af", linestyle=":", linewidth=0.9)
    ax.set_title(
        f"{query_bit}{event_date}{title_bit}\n"
        "미국·일본·한국·중국 지수 누적수익률 (t=0 리베이스)"
    )
    ax.set_xlabel("Trading-day offset (t=0)")
    ax.set_ylabel("Cumulative return (%)")
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

    fig, ax = plt.subplots(1, 1, figsize=(11, 6))
    for idx, item in enumerate(averages):
        frame = item["frame"]
        n = item.get("n_events", n_events)
        ko = item.get("country_ko") or COUNTRY_LABEL_KO.get(item["country"], item["country"])
        ax.plot(
            frame["trading_day_offset"],
            frame["rebased_return_pct"],
            linewidth=1.7,
            color=_color(item["country"], idx),
            label=f"{ko} (n={n})",
        )

    query_bit = f"[{query}] " if query else ""
    ax.axvline(0, color="#dc2626", linestyle="--", linewidth=1.3, label="t=0")
    ax.axhline(0, color="#9ca3af", linestyle=":", linewidth=0.9)
    ax.set_title(
        f"{query_bit}이벤트 평균 경로 (n={n_events})\n국가별 평균 누적수익률 (각 사건 t=0)"
    )
    ax.set_xlabel("Trading-day offset (t=0)")
    ax.set_ylabel("Mean cumulative return (%)")
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


def plot_horizon_bar_chart(
    averages: list[dict],
    *,
    query: str = "",
    n_events: int = 0,
    save_path: Path | None = None,
) -> io.BytesIO:
    """Grouped bar chart: mean cumulative return at +30/+60/+90 calendar days."""
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()
    if not averages:
        raise ValueError("No average series for bar chart")

    countries = averages
    n_c = len(countries)
    n_h = len(HORIZON_DAYS)
    x = np.arange(n_h)
    width = 0.8 / max(n_c, 1)

    fig, ax = plt.subplots(1, 1, figsize=(11, 6))
    for idx, item in enumerate(countries):
        heights = []
        for d in HORIZON_DAYS:
            val = (item.get("horizons") or {}).get(f"d{d}")
            heights.append(float(val) if val is not None else 0.0)
        offset = (idx - (n_c - 1) / 2) * width
        ko = item.get("country_ko") or COUNTRY_LABEL_KO.get(item["country"], item["country"])
        bars = ax.bar(
            x + offset,
            heights,
            width=width * 0.92,
            color=_color(item["country"], idx),
            label=ko,
            edgecolor="white",
            linewidth=0.4,
        )
        for bar, h, d in zip(bars, heights, HORIZON_DAYS):
            raw = (item.get("horizons") or {}).get(f"d{d}")
            if raw is None:
                continue
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + (0.35 if bar.get_height() >= 0 else -0.55),
                f"{raw:+.1f}",
                ha="center",
                va="bottom" if bar.get_height() >= 0 else "top",
                fontsize=8,
            )

    query_bit = f"[{query}] " if query else ""
    ax.axhline(0, color="#9ca3af", linewidth=0.9)
    ax.set_xticks(x)
    ax.set_xticklabels([f"+{d}일" for d in HORIZON_DAYS])
    ax.set_ylabel("평균 누적수익률 (%)")
    ax.set_title(
        f"{query_bit}이벤트 후 30·60·90일 평균 누적수익률 (n={n_events})\n"
        "미국 · 일본 · 한국 · 중국"
    )
    ax.grid(True, axis="y", alpha=0.25)
    ax.legend(loc="best", fontsize=9)

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
) -> dict[str, Path | io.BytesIO]:
    out_dir = _ensure_dir(run_id)
    paths: dict[str, Path | io.BytesIO] = {}
    buffers: dict[str, io.BytesIO] = {}

    for panel in study.get("panels") or []:
        if not panel.get("series"):
            continue
        date_str = panel.get("event_date_str") or "event"
        path = out_dir / f"event_{date_str}.png"
        buf = plot_event_country_overlay(panel, query=query, save_path=path)
        paths[date_str] = path
        buffers[date_str] = buf

    averages = study.get("averages") or []
    usable = sum(1 for p in (study.get("panels") or []) if p.get("series"))
    if averages:
        path = out_dir / "average_across_events.png"
        buf = plot_average_across_events(
            averages, query=query, n_events=usable, save_path=path
        )
        paths["average"] = path
        buffers["average"] = buf

        path_bar = out_dir / "horizon_bars.png"
        buf_bar = plot_horizon_bar_chart(
            averages, query=query, n_events=usable, save_path=path_bar
        )
        paths["horizon_bars"] = path_bar
        buffers["horizon_bars"] = buf_bar

    paths["_buffers"] = buffers  # type: ignore[assignment]
    return paths

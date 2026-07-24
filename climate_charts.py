"""Charts for Climate Risk Monitor (/esg monitor)."""

from __future__ import annotations

import io
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.gridspec import GridSpec  # noqa: E402

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
    "teal": "#2dd4bf",
    "purple": "#a78bfa",
}


def _style_axis(ax) -> None:
    ax.set_facecolor(PALETTE["panel"])
    ax.tick_params(colors=PALETTE["muted"], labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(PALETTE["grid"])
    ax.grid(True, color=PALETTE["grid"], alpha=0.35, linewidth=0.6)
    ax.title.set_color(PALETTE["text"])


def _risk_color(score: int) -> str:
    if score >= 70:
        return PALETTE["red"]
    if score >= 45:
        return PALETTE["orange"]
    if score >= 25:
        return PALETTE["yellow"]
    return PALETTE["green"]


def _plot_gauge(ax, risk: dict[str, Any]) -> None:
    import numpy as np

    ax.set_facecolor(PALETTE["bg"])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    score = int(risk.get("score") or 0)
    color = _risk_color(score)
    theta = np.linspace(np.pi, 0, 200)
    ax.plot(
        0.5 + 0.38 * np.cos(theta),
        0.10 + 0.38 * np.sin(theta),
        color=PALETTE["grid"],
        lw=14,
    )
    fill = np.linspace(np.pi, np.pi - (score / 100) * np.pi, 200)
    ax.plot(
        0.5 + 0.38 * np.cos(fill),
        0.10 + 0.38 * np.sin(fill),
        color=color,
        lw=14,
        solid_capstyle="round",
    )
    ax.text(
        0.5,
        0.36,
        str(score),
        ha="center",
        va="center",
        fontsize=28,
        color=color,
        weight="bold",
    )
    ax.text(
        0.5,
        0.18,
        str(risk.get("label") or risk.get("level") or ""),
        ha="center",
        va="center",
        fontsize=12,
        color=color,
        weight="bold",
    )
    ax.text(
        0.5,
        0.92,
        "Climate Risk Score",
        ha="center",
        va="center",
        fontsize=12,
        color=PALETTE["text"],
        weight="bold",
    )


def _plot_quake_map(ax, quakes: dict[str, Any]) -> None:
    _style_axis(ax)
    events = quakes.get("events") or []
    if not events:
        ax.text(
            0.5,
            0.5,
            "No M≥ threshold quakes",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title("Earthquakes (global)", color=PALETTE["text"], fontsize=11)
        return

    lons = [e["lon"] for e in events]
    lats = [e["lat"] for e in events]
    mags = [e["mag"] for e in events]
    colors = [
        PALETTE["red"] if e.get("in_europe") else PALETTE["blue"] for e in events
    ]
    sizes = [max(20, (m - 4.0) * 55) for m in mags]
    ax.scatter(lons, lats, s=sizes, c=colors, alpha=0.75, edgecolors="#0b1220", linewidths=0.4)
    # Europe box hint
    ax.plot(
        [-25, 45, 45, -25, -25],
        [34, 34, 72, 72, 34],
        color=PALETTE["orange"],
        linewidth=1.0,
        linestyle="--",
        alpha=0.7,
    )
    ax.set_xlim(-180, 180)
    ax.set_ylim(-70, 80)
    ax.set_xlabel("Longitude", color=PALETTE["muted"], fontsize=8)
    ax.set_ylabel("Latitude", color=PALETTE["muted"], fontsize=8)
    days = quakes.get("days", 7)
    ax.set_title(
        f"Earthquakes {days}d · n={len(events)} · EU={quakes.get('europe_count', 0)} (orange=EU)",
        color=PALETTE["text"],
        fontsize=10,
    )


def _plot_quake_bars(ax, quakes: dict[str, Any]) -> None:
    _style_axis(ax)
    top = (quakes.get("events") or [])[:10]
    if not top:
        ax.text(
            0.5,
            0.5,
            "No events",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title("Top magnitudes", color=PALETTE["text"], fontsize=11)
        return

    labels = []
    for e in reversed(top):
        place = str(e.get("place") or "")
        short = place.split(",")[-1].strip() if "," in place else place
        if len(short) > 18:
            short = short[:16] + "…"
        labels.append(f"M{e['mag']:.1f} {short}")
    vals = [e["mag"] for e in reversed(top)]
    colors = [
        PALETTE["red"] if e.get("in_europe") else PALETTE["teal"] for e in reversed(top)
    ]
    ax.barh(labels, vals, color=colors)
    ax.set_xlim(4.0, max(vals) + 0.8)
    ax.set_xlabel("Magnitude", color=PALETTE["muted"], fontsize=8)
    ax.set_title("Largest quakes (period)", color=PALETTE["text"], fontsize=11)


def _plot_europe_anomaly(ax, europe: dict[str, Any]) -> None:
    _style_axis(ax)
    cities = europe.get("cities") or []
    if not cities:
        ax.text(
            0.5,
            0.5,
            "No Europe weather data",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title("Europe temp anomaly", color=PALETTE["text"], fontsize=11)
        return

    # Sort by anomaly for display
    rows = sorted(cities, key=lambda c: c.get("anomaly_c") or 0)
    names = [c["name"] for c in rows]
    anoms = [c.get("anomaly_c") if c.get("anomaly_c") is not None else 0 for c in rows]
    colors = [
        PALETTE["red"] if a >= 3 else PALETTE["orange"] if a >= 1.5 else PALETTE["blue"] if a <= -3 else PALETTE["teal"] if a <= -1.5 else PALETTE["muted"]
        for a in anoms
    ]
    ax.barh(names, anoms, color=colors)
    ax.axvline(0, color=PALETTE["muted"], linewidth=0.9)
    ax.axvline(3, color=PALETTE["red"], linewidth=0.6, linestyle=":", alpha=0.7)
    ax.axvline(-3, color=PALETTE["blue"], linewidth=0.6, linestyle=":", alpha=0.7)
    ax.set_xlabel("°C vs 5y same-window mean", color=PALETTE["muted"], fontsize=8)
    window = f"{europe.get('window_start', '')} → {europe.get('window_end', '')}"
    ax.set_title(f"Europe anomaly ({window})", color=PALETTE["text"], fontsize=10)


def _plot_europe_max(ax, europe: dict[str, Any]) -> None:
    _style_axis(ax)
    cities = europe.get("cities") or []
    if not cities:
        ax.text(
            0.5,
            0.5,
            "No data",
            ha="center",
            va="center",
            color=PALETTE["muted"],
            transform=ax.transAxes,
        )
        ax.set_title("Europe recent max °C", color=PALETTE["text"], fontsize=11)
        return

    rows = sorted(
        cities,
        key=lambda c: c.get("recent_max_c") if c.get("recent_max_c") is not None else -99,
    )
    names = [c["name"] for c in rows]
    vals = [c.get("recent_max_c") or 0 for c in rows]
    colors = [
        PALETTE["red"] if v >= 35 else PALETTE["orange"] if v >= 32 else PALETTE["teal"]
        for v in vals
    ]
    ax.barh(names, vals, color=colors)
    ax.axvline(32, color=PALETTE["orange"], linewidth=0.7, linestyle="--", alpha=0.8)
    ax.axvline(35, color=PALETTE["red"], linewidth=0.7, linestyle="--", alpha=0.8)
    ax.set_xlabel("Max °C (window)", color=PALETTE["muted"], fontsize=8)
    ax.set_title("Europe city max temperature", color=PALETTE["text"], fontsize=11)


def plot_climate_monitor_dashboard(bundle: dict[str, Any]) -> io.BytesIO:
    from cjk_font import configure_matplotlib_cjk
    from chart_buffers import figure_to_png_buffer

    configure_matplotlib_cjk()
    risk = bundle.get("risk") or {}
    quakes = bundle.get("earthquakes") or {}
    europe = bundle.get("europe_weather") or {}

    fig = plt.figure(figsize=(14.5, 9.2), facecolor=PALETTE["bg"])
    gs = GridSpec(2, 3, figure=fig, height_ratios=[1.05, 1.0], hspace=0.32, wspace=0.28)
    fig.suptitle(
        f"Climate Risk Monitor · {bundle.get('generated_at_display', '')}",
        color=PALETTE["text"],
        fontsize=14,
        y=0.98,
    )

    ax0 = fig.add_subplot(gs[0, 0])
    _plot_gauge(ax0, risk)

    ax1 = fig.add_subplot(gs[0, 1:])
    _plot_quake_map(ax1, quakes)

    ax2 = fig.add_subplot(gs[1, 0])
    _plot_quake_bars(ax2, quakes)

    ax3 = fig.add_subplot(gs[1, 1])
    _plot_europe_anomaly(ax3, europe)

    ax4 = fig.add_subplot(gs[1, 2])
    _plot_europe_max(ax4, europe)

    return figure_to_png_buffer(
        fig,
        dpi=130,
        facecolor=PALETTE["bg"],
        bbox_inches="tight",
    )


def format_climate_chart_caption(bundle: dict[str, Any]) -> str:
    risk = bundle.get("risk") or {}
    quakes = bundle.get("earthquakes") or {}
    europe = bundle.get("europe_weather") or {}
    drivers = ", ".join(risk.get("drivers") or []) or "drivers n/a"
    return (
        f"🌍 Climate Risk {risk.get('score', 'n/a')} ({risk.get('label', '')}) · "
        f"quakes {quakes.get('count', 0)} · EU weather flags {europe.get('flagged_count', 0)} · "
        f"{drivers}"
    )


def format_climate_monitor_telegram(bundle: dict[str, Any]) -> str:
    risk = bundle.get("risk") or {}
    quakes = bundle.get("earthquakes") or {}
    europe = bundle.get("europe_weather") or {}

    def esc(text: Any) -> str:
        return (
            str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    lines = [
        "<b>🌍 Physical climate risk · adaptation</b>",
        f"<i>{esc(bundle.get('generated_at_display', ''))}</i>",
        (
            f"Risk <b>{risk.get('score', 'n/a')}</b> · "
            f"{esc(risk.get('label') or risk.get('level') or '')} "
            f"({esc(risk.get('level') or '')})"
        ),
    ]
    if risk.get("drivers"):
        lines.append("Drivers: " + " · ".join(esc(d) for d in risk["drivers"]))

    lines.extend(
        [
            "",
            f"<b>1️⃣ Earthquakes ({quakes.get('days', 7)}d, M≥{quakes.get('min_magnitude', 4.5)})</b>",
            (
                f"Total <b>{quakes.get('count', 0)}</b> · "
                f"M≥6 <b>{quakes.get('significant_count', 0)}</b> · "
                f"Europe <b>{quakes.get('europe_count', 0)}</b> · "
                f"Max M{quakes.get('max_mag') if quakes.get('max_mag') is not None else 'n/a'}"
            ),
        ]
    )
    for idx, event in enumerate((quakes.get("events") or [])[:8], start=1):
        tag = "🇪🇺 " if event.get("in_europe") else ""
        lines.append(
            f"{idx}. {tag}<b>M{event['mag']:.1f}</b> {esc(event.get('place'))}\n"
            f"    {esc(event.get('time_kst') or event.get('time_utc') or '')}"
        )
    if quakes.get("europe"):
        lines.append("")
        lines.append("<b>Europe quakes</b>")
        for event in quakes["europe"][:5]:
            lines.append(
                f"• M{event['mag']:.1f} {esc(event.get('place'))} "
                f"({esc(event.get('time_kst') or '')})"
            )

    lines.extend(
        [
            "",
            (
                f"<b>2️⃣ Europe weather anomaly "
                f"({esc(europe.get('window_start', ''))} → {esc(europe.get('window_end', ''))})</b>"
            ),
            f"Flagged cities: <b>{europe.get('flagged_count', 0)}</b> / {len(europe.get('cities') or [])}",
        ]
    )
    for city in (europe.get("cities") or [])[:10]:
        anomaly = city.get("anomaly_c")
        anom_txt = f"{anomaly:+.1f}°C" if anomaly is not None else "n/a"
        flags = ",".join(city.get("flags") or []) or "—"
        lines.append(
            f"• <b>{esc(city['name'])}</b> mean {city.get('recent_mean_c', 'n/a')}°C "
            f"(anom {anom_txt}) · max {city.get('recent_max_c', 'n/a')}°C · "
            f"precip {city.get('recent_precip_mm', 'n/a')}mm · {esc(flags)}"
        )

    lines.extend(
        [
            "",
            f"<i>APIs: USGS (quakes) · Open-Meteo (Europe temps) — no keys</i>",
            f"<i>Source: {esc(quakes.get('source', 'USGS'))} · {esc(europe.get('source', 'Open-Meteo'))}</i>",
            "<i>Not financial advice · physical-risk context only.</i>",
        ]
    )
    if bundle.get("errors"):
        lines.append("<i>Partial errors: " + esc("; ".join(bundle["errors"][:3])) + "</i>")
    return "\n".join(lines)

"""Finviz-style market-cap treemap heatmaps (daily return colors)."""

from __future__ import annotations

import io
import pickle
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.colors as mcolors  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.patches as mpatches  # noqa: E402
from matplotlib import patheffects as pe  # noqa: E402
import numpy as np
import pandas as pd
import squarify
import yfinance as yf

from stock_crawler import (
    DAILY_RETURN_COL,
    _quiet_yfinance,
    is_cache_ready,
)

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"

SIZE_CACHE_VERSION = 1
SIZE_CACHE_TTL_SECONDS = 86400
DEFAULT_HEATMAP_TOP_N = 30
MIN_HEATMAP_TOP_N = 5
MAX_HEATMAP_TOP_N = 50
SIZE_FETCH_WORKERS = 8

# Finviz-inspired palette (openalgo-heatmap / finviz.com maps)
BG_COLOR = "#0a0a0c"
TEXT_COLOR = "#f3f4f6"
MUTED_TEXT = "#9ca3af"
NEUTRAL_RGB = np.array([62, 68, 82]) / 255.0
RED_RGB = np.array([228, 60, 60]) / 255.0
GREEN_RGB = np.array([33, 191, 94]) / 255.0
DEFAULT_COLOR_CAP_PCT = 3.0
TILE_GAP = 0.22

HEATMAP_UNIVERSES = {
    "etf": {"label": "US Equity ETF", "size_label": "AUM", "short": "ETF"},
    "sp": {"label": "S&P 500", "size_label": "Market cap", "short": "S&P 500"},
    "nas": {"label": "NASDAQ 100", "size_label": "Market cap", "short": "NASDAQ 100"},
}


def _size_cache_path(universe: str) -> Path:
    return DATA_DIR / f"{universe}_size_cache.pkl"


def _fetch_ticker_size(symbol: str, universe: str) -> float | None:
    with _quiet_yfinance():
        try:
            ticker = yf.Ticker(symbol)
            if universe == "etf":
                assets = ticker.info.get("totalAssets")
                return float(assets) if assets else None

            fast = getattr(ticker, "fast_info", None)
            if fast is not None:
                cap = getattr(fast, "market_cap", None)
                if cap:
                    return float(cap)
            cap = ticker.info.get("marketCap")
            return float(cap) if cap else None
        except Exception:
            return None


def _load_size_cache(universe: str) -> dict[str, float] | None:
    path = _size_cache_path(universe)
    if not path.exists():
        return None
    try:
        with path.open("rb") as handle:
            payload = pickle.load(handle)
    except Exception:
        return None

    if payload.get("version") != SIZE_CACHE_VERSION:
        return None
    if time.time() - float(payload.get("loaded_at", 0)) > SIZE_CACHE_TTL_SECONDS:
        return None

    sizes = payload.get("sizes")
    if not isinstance(sizes, dict):
        return None
    return {str(k): float(v) for k, v in sizes.items() if v}


def _save_size_cache(universe: str, sizes: dict[str, float]) -> None:
    path = _size_cache_path(universe)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": SIZE_CACHE_VERSION,
        "loaded_at": time.time(),
        "sizes": sizes,
    }
    with path.open("wb") as handle:
        pickle.dump(payload, handle)


def warmup_size_cache(universe: str, tickers: list[str] | None = None) -> dict[str, float]:
    if universe not in HEATMAP_UNIVERSES:
        raise ValueError(f"Unknown universe: {universe}")

    cached = _load_size_cache(universe)
    if cached is not None:
        return cached

    if tickers is None:
        from stock_crawler import _load_universe_tickers

        tickers = _load_universe_tickers(universe)

    sizes: dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=SIZE_FETCH_WORKERS) as pool:
        futures = {pool.submit(_fetch_ticker_size, sym, universe): sym for sym in tickers}
        for future in as_completed(futures):
            sym = futures[future]
            try:
                value = future.result()
                if value and value > 0:
                    sizes[sym] = value
            except Exception:
                continue

    if sizes:
        _save_size_cache(universe, sizes)
    return sizes


def is_size_cache_ready(universe: str) -> bool:
    return _load_size_cache(universe) is not None


def build_heatmap_frame(universe: str, top_n: int = DEFAULT_HEATMAP_TOP_N) -> pd.DataFrame:
    if universe not in HEATMAP_UNIVERSES:
        raise ValueError(f"Unknown universe: {universe}")
    if not is_cache_ready(universe):
        raise RuntimeError(f"{HEATMAP_UNIVERSES[universe]['label']} rankings cache is not ready yet.")

    top_n = max(MIN_HEATMAP_TOP_N, min(MAX_HEATMAP_TOP_N, top_n))
    from stock_crawler import _states

    metrics_df = _states[universe]["df"].copy()
    if metrics_df.empty or DAILY_RETURN_COL not in metrics_df.columns:
        raise RuntimeError("No return data available for heatmap.")

    sizes = warmup_size_cache(universe)
    if not sizes:
        raise RuntimeError("Could not load market-cap / AUM data from Yahoo Finance.")

    metrics_df["Size"] = metrics_df["Ticker"].map(sizes)
    frame = metrics_df.dropna(subset=["Size", DAILY_RETURN_COL]).copy()
    if frame.empty:
        raise RuntimeError("No tickers with both size and daily return data.")

    frame = frame.sort_values("Size", ascending=False).head(top_n)
    if len(frame) < MIN_HEATMAP_TOP_N:
        raise RuntimeError(f"Only {len(frame)} tickers available (need at least {MIN_HEATMAP_TOP_N}).")
    return frame


def _mix_rgb(
    start: np.ndarray,
    end: np.ndarray,
    amount: float,
) -> tuple[float, float, float]:
    rgb = start + (end - start) * amount
    return float(rgb[0]), float(rgb[1]), float(rgb[2])


def finviz_change_color(change_pct: float, cap_pct: float = DEFAULT_COLOR_CAP_PCT) -> tuple[float, float, float]:
    """
    Finviz-style diverging scale: deep red ← neutral gray → bright green.
    change_pct is in percent (e.g. +1.2 for +1.2%).
    """
    if not np.isfinite(change_pct):
        change_pct = 0.0
    t = float(np.clip(change_pct / cap_pct, -1.0, 1.0))
    eased = float(np.sign(t) * (abs(t) ** 0.85))
    if eased < 0:
        return _mix_rgb(NEUTRAL_RGB, RED_RGB, -eased)
    return _mix_rgb(NEUTRAL_RGB, GREEN_RGB, eased)


def _color_cap_pct(returns: np.ndarray) -> float:
    if len(returns) == 0:
        return DEFAULT_COLOR_CAP_PCT
    observed = float(np.nanmax(np.abs(returns))) * 100.0
    if observed <= 0:
        return DEFAULT_COLOR_CAP_PCT
    return float(np.clip(max(DEFAULT_COLOR_CAP_PCT, observed * 1.05), 2.0, 6.0))


def _tile_fontsize(area: float) -> float:
    return float(np.clip(np.sqrt(area) * 0.42, 6.5, 13.5))


def _draw_finviz_legend(ax, cap_pct: float) -> None:
    ax.set_facecolor(BG_COLOR)
    ax.axis("off")

    values = np.linspace(-cap_pct, cap_pct, 256)
    colors = [finviz_change_color(v, cap_pct) for v in values]
    cmap = mcolors.LinearSegmentedColormap.from_list("finviz", colors, N=256)
    norm = mcolors.Normalize(vmin=-cap_pct, vmax=cap_pct)

    strip = ax.inset_axes([0.08, 0.42, 0.84, 0.22])
    strip.set_facecolor(BG_COLOR)
    strip.imshow(
        values.reshape(1, -1),
        aspect="auto",
        cmap=cmap,
        norm=norm,
        extent=[-cap_pct, cap_pct, 0, 1],
    )
    strip.set_yticks([])
    strip.set_xticks([-cap_pct, 0, cap_pct])
    strip.set_xticklabels(
        [f"{-cap_pct:.1f}%", "0%", f"+{cap_pct:.1f}%"],
        color=TEXT_COLOR,
        fontsize=8,
    )
    strip.tick_params(colors=TEXT_COLOR, labelsize=8)
    for label in strip.get_xticklabels():
        label.set_color(TEXT_COLOR)
    for spine in strip.spines.values():
        spine.set_color("#2a2a30")

    ax.text(
        0.08,
        0.78,
        "1-Day Performance",
        color=TEXT_COLOR,
        fontsize=9,
        ha="left",
        va="center",
        transform=ax.transAxes,
    )


def _draw_treemap(ax, frame: pd.DataFrame, cap_pct: float) -> None:
    sizes = frame["Size"].astype(float).tolist()
    returns_pct = frame[DAILY_RETURN_COL].astype(float).values * 100.0
    tickers = frame["Ticker"].astype(str).tolist()

    normed = squarify.normalize_sizes(sizes, 100, 100)
    rects = squarify.squarify(normed, 0, 0, 100, 100)
    ax.set_xlim(0, 100)
    ax.set_ylim(100, 0)
    ax.axis("off")

    for rect, ticker, ret_pct in zip(rects, tickers, returns_pct):
        gap = TILE_GAP
        x = rect["x"] + gap / 2
        y = rect["y"] + gap / 2
        w = max(rect["dx"] - gap, 0)
        h = max(rect["dy"] - gap, 0)
        if w <= 0 or h <= 0:
            continue

        face = finviz_change_color(ret_pct, cap_pct)
        patch = mpatches.Rectangle(
            (x, y),
            w,
            h,
            facecolor=face,
            edgecolor=BG_COLOR,
            linewidth=1.6,
            joinstyle="miter",
        )
        ax.add_patch(patch)

        area = w * h
        if area < 55:
            continue

        fontsize = _tile_fontsize(area)
        if area < 120:
            label = ticker
        else:
            label = f"{ticker}\n{ret_pct:+.1f}%"

        text = ax.text(
            x + w / 2,
            y + h / 2,
            label,
            ha="center",
            va="center",
            color=TEXT_COLOR,
            fontsize=fontsize,
            fontweight="bold",
            linespacing=1.05,
        )
        text.set_path_effects(
            [
                pe.withStroke(linewidth=2.2, foreground="#000000", alpha=0.55),
                pe.Normal(),
            ]
        )


def plot_market_heatmap(universe: str, top_n: int = DEFAULT_HEATMAP_TOP_N) -> tuple[io.BytesIO, str, bool]:
    """
    Return (image buffer, caption, size_cache_was_missing_before_build).
    """
    had_cache = is_size_cache_ready(universe)
    frame = build_heatmap_frame(universe, top_n=top_n)
    meta = HEATMAP_UNIVERSES[universe]

    returns = frame[DAILY_RETURN_COL].astype(float).values
    cap_pct = _color_cap_pct(returns)

    # Isolate style so dark facecolor does not leak into later charts.
    with plt.rc_context(
        {
            "font.family": "DejaVu Sans",
            "figure.facecolor": BG_COLOR,
            "axes.facecolor": BG_COLOR,
            "text.color": TEXT_COLOR,
            "axes.labelcolor": TEXT_COLOR,
            "xtick.color": TEXT_COLOR,
            "ytick.color": TEXT_COLOR,
        }
    ):
        fig = plt.figure(figsize=(13.5, 8.8), facecolor=BG_COLOR)
        grid = fig.add_gridspec(2, 1, height_ratios=[12.5, 1.2], hspace=0.06)
        ax_map = fig.add_subplot(grid[0])
        ax_legend = fig.add_subplot(grid[1])

        ax_map.set_facecolor(BG_COLOR)
        _draw_treemap(ax_map, frame, cap_pct)
        _draw_finviz_legend(ax_legend, cap_pct)

        fig.text(
            0.03,
            0.965,
            meta["short"],
            color=TEXT_COLOR,
            fontsize=18,
            fontweight="bold",
            ha="left",
            va="top",
        )
        fig.text(
            0.03,
            0.925,
            f"Top {len(frame)} by {meta['size_label'].lower()}  •  Tile size = {meta['size_label'].lower()}  •  Color = 1-day % change",
            color=MUTED_TEXT,
            fontsize=9.5,
            ha="left",
            va="top",
        )

        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor=BG_COLOR, pad_inches=0.18)
        plt.close(fig)
        buf.seek(0)

    best = frame.loc[frame[DAILY_RETURN_COL].idxmax()]
    worst = frame.loc[frame[DAILY_RETURN_COL].idxmin()]
    caption = (
        f"📊 {meta['label']} heatmap (top {len(frame)} by {meta['size_label'].lower()})\n"
        f"▲ {best['Ticker']} {best[DAILY_RETURN_COL] * 100:+.2f}% | "
        f"▼ {worst['Ticker']} {worst[DAILY_RETURN_COL] * 100:+.2f}%\n"
        f"Finviz-style map | Source: Yahoo Finance"
    )
    try:
        from stock_crawler import get_cache_session_label

        caption = f"{caption}\n{get_cache_session_label(universe)}"
    except Exception:
        pass
    return buf, caption, not had_cache


def parse_heatmap_command(message: str) -> tuple[str, int]:
    parts = message.strip().split()
    universe = "sp"
    top_n = DEFAULT_HEATMAP_TOP_N

    if len(parts) >= 2:
        candidate = parts[1].lower().lstrip("/")
        if candidate in HEATMAP_UNIVERSES:
            universe = candidate
        else:
            raise ValueError("Use etf, sp, or nas.")

    if len(parts) >= 3:
        try:
            top_n = int(parts[2])
        except ValueError as exc:
            raise ValueError(f"Top N must be a number (e.g. 30), not '{parts[2]}'.") from exc

    top_n = max(MIN_HEATMAP_TOP_N, min(MAX_HEATMAP_TOP_N, top_n))
    return universe, top_n

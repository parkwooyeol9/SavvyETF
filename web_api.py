"""JSON/PNG helpers for the Vercel dashboard (heatmap + portfolio simulation)."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd

from heatmap import (
    DEFAULT_HEATMAP_TOP_N,
    HEATMAP_UNIVERSES,
    MAX_HEATMAP_TOP_N,
    MIN_HEATMAP_TOP_N,
    build_heatmap_frame,
    plot_market_heatmap,
)
from stock_crawler import DAILY_RETURN_COL

# Curated ETF picker for the allocation simulator.
ETF_CATALOG: list[dict[str, str]] = [
    {"symbol": "SPY", "name": "S&P 500", "group": "미국 주식"},
    {"symbol": "VOO", "name": "S&P 500 (Vanguard)", "group": "미국 주식"},
    {"symbol": "QQQ", "name": "Nasdaq-100", "group": "미국 주식"},
    {"symbol": "IWM", "name": "Russell 2000", "group": "미국 주식"},
    {"symbol": "VTI", "name": "Total US Stock", "group": "미국 주식"},
    {"symbol": "VXUS", "name": "Total Intl Stock", "group": "해외 주식"},
    {"symbol": "EFA", "name": "EAFE Developed", "group": "해외 주식"},
    {"symbol": "EEM", "name": "Emerging Markets", "group": "해외 주식"},
    {"symbol": "TLT", "name": "20+ Year Treasury", "group": "채권"},
    {"symbol": "IEF", "name": "7-10 Year Treasury", "group": "채권"},
    {"symbol": "BND", "name": "Total Bond Market", "group": "채권"},
    {"symbol": "GLD", "name": "Gold", "group": "대안"},
    {"symbol": "VNQ", "name": "US Real Estate", "group": "대안"},
    {"symbol": "XLK", "name": "Technology", "group": "섹터"},
    {"symbol": "XLF", "name": "Financials", "group": "섹터"},
    {"symbol": "XLE", "name": "Energy", "group": "섹터"},
    {"symbol": "XLV", "name": "Health Care", "group": "섹터"},
    {"symbol": "SMH", "name": "Semiconductors", "group": "섹터"},
]


def etf_catalog_payload() -> dict[str, Any]:
    return {"ok": True, "etfs": ETF_CATALOG}


def _clamp_top_n(top_n: int | None) -> int:
    if top_n is None:
        return DEFAULT_HEATMAP_TOP_N
    return max(MIN_HEATMAP_TOP_N, min(MAX_HEATMAP_TOP_N, int(top_n)))


def heatmap_payload(
    universe: str = "etf",
    top_n: int | None = None,
    *,
    include_image: bool = True,
) -> dict[str, Any]:
    universe = (universe or "etf").lower().strip()
    if universe not in HEATMAP_UNIVERSES:
        return {
            "ok": False,
            "error": f"Unknown universe '{universe}'. Use: {', '.join(HEATMAP_UNIVERSES)}",
        }

    top_n = _clamp_top_n(top_n)
    meta = HEATMAP_UNIVERSES[universe]
    try:
        frame = build_heatmap_frame(universe, top_n=top_n)
    except Exception as exc:
        return {
            "ok": False,
            "universe": universe,
            "label": meta["label"],
            "error": str(exc),
        }

    returns = frame[DAILY_RETURN_COL].astype(float)
    cells = []
    for _, row in frame.iterrows():
        cells.append(
            {
                "ticker": str(row["Ticker"]),
                "size": float(row["Size"]),
                "daily_return_pct": round(float(row[DAILY_RETURN_COL]) * 100.0, 3),
            }
        )

    payload: dict[str, Any] = {
        "ok": True,
        "universe": universe,
        "label": meta["label"],
        "size_label": meta["size_label"],
        "top_n": len(cells),
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "stats": {
            "avg_return_pct": round(float(returns.mean()) * 100.0, 3),
            "best": {
                "ticker": str(frame.loc[returns.idxmax(), "Ticker"]),
                "daily_return_pct": round(float(returns.max()) * 100.0, 3),
            },
            "worst": {
                "ticker": str(frame.loc[returns.idxmin(), "Ticker"]),
                "daily_return_pct": round(float(returns.min()) * 100.0, 3),
            },
            "up_count": int((returns > 0).sum()),
            "down_count": int((returns < 0).sum()),
        },
        "cells": cells,
    }

    try:
        from stock_crawler import get_cache_session_label

        payload["session_label"] = get_cache_session_label(universe)
    except Exception:
        payload["session_label"] = None

    if include_image:
        try:
            buf, caption, _ = plot_market_heatmap(universe, top_n=top_n)
            payload["image_png_base64"] = base64.b64encode(buf.getvalue()).decode("ascii")
            payload["caption"] = caption
        except Exception as exc:
            payload["image_error"] = str(exc)

    return payload


def heatmap_png(universe: str = "etf", top_n: int | None = None) -> tuple[bytes, str] | dict[str, Any]:
    universe = (universe or "etf").lower().strip()
    if universe not in HEATMAP_UNIVERSES:
        return {"ok": False, "error": f"Unknown universe '{universe}'"}
    top_n = _clamp_top_n(top_n)
    try:
        buf, caption, _ = plot_market_heatmap(universe, top_n=top_n)
        return buf.getvalue(), caption
    except Exception as exc:
        return {"ok": False, "universe": universe, "error": str(exc)}


def _normalize_weights(tickers: list[str], weights: list[float] | None) -> list[float]:
    n = len(tickers)
    if not n:
        raise ValueError("At least one ticker is required")
    if weights is None or len(weights) != n:
        return [1.0 / n] * n
    total = float(sum(weights))
    if total <= 0:
        raise ValueError("Weights must sum to a positive number")
    return [float(w) / total for w in weights]


def _fetch_close_series(symbol: str, start: str, end: str) -> pd.Series:
    """Daily close via Yahoo chart API, fallback to yfinance."""
    from yahoo_market import fetch_daily_candles, to_yahoo_symbol

    # Map calendar window to a Yahoo range bucket (fast path).
    try:
        start_ts = pd.Timestamp(start)
        end_ts = pd.Timestamp(end)
        days = max(1, int((end_ts - start_ts).days))
    except Exception:
        days = 365 * 3

    if days <= 30:
        range_ = "1mo"
    elif days <= 100:
        range_ = "3mo"
    elif days <= 200:
        range_ = "6mo"
    elif days <= 400:
        range_ = "1y"
    elif days <= 800:
        range_ = "2y"
    else:
        range_ = "5y"

    frame = fetch_daily_candles(to_yahoo_symbol(symbol), range_=range_, interval="1d")
    if not frame.empty:
        series = frame["close"].copy()
        series = series[(series.index >= pd.Timestamp(start)) & (series.index <= pd.Timestamp(end))]
        if len(series) >= 5:
            series.name = symbol
            return series

    import yfinance as yf

    hist = yf.Ticker(symbol).history(start=start, end=end)
    if hist.empty or "Close" not in hist.columns:
        return pd.Series(dtype=float, name=symbol)
    series = hist["Close"].copy()
    series.index = pd.to_datetime(series.index).tz_localize(None).normalize()
    series.name = symbol
    return series


def simulate_allocation(
    tickers: list[str],
    *,
    weights: list[float] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    initial_capital: float = 10_000.0,
    benchmark: str = "SPY",
) -> dict[str, Any]:
    """Equal/custom-weight buy-and-hold vs benchmark, with allocation-effect stats."""
    clean = [str(t).strip().upper() for t in tickers if str(t).strip()]
    if not clean:
        return {"ok": False, "error": "Provide at least one ETF ticker"}
    if len(clean) > 12:
        return {"ok": False, "error": "Select at most 12 ETFs"}

    try:
        w = _normalize_weights(clean, weights)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    start = start_date or (datetime.now() - timedelta(days=365 * 3)).strftime("%Y-%m-%d")
    end = end_date or datetime.now().strftime("%Y-%m-%d")
    capital = float(initial_capital) if initial_capital and initial_capital > 0 else 10_000.0
    bench = (benchmark or "SPY").strip().upper()

    needed = list(dict.fromkeys([*clean, bench]))
    frames: dict[str, pd.Series] = {}
    missing: list[str] = []
    for sym in needed:
        try:
            series = _fetch_close_series(sym, start, end)
        except Exception:
            series = pd.Series(dtype=float)
        if series.empty or len(series) < 5:
            missing.append(sym)
        else:
            frames[sym] = series

    if missing:
        return {"ok": False, "error": f"No price history for: {', '.join(missing)}"}

    closes = pd.DataFrame(frames).dropna()
    if len(closes) < 5:
        return {"ok": False, "error": "Not enough overlapping history for these ETFs"}

    daily = closes[clean].pct_change()
    port_daily = (daily * w).sum(axis=1).dropna()
    bench_daily = closes[bench].pct_change().reindex(port_daily.index).dropna()
    common = port_daily.index.intersection(bench_daily.index)
    port_daily = port_daily.loc[common]
    bench_daily = bench_daily.loc[common]
    if len(port_daily) < 5:
        return {"ok": False, "error": "Not enough overlapping history after alignment"}

    port_cum = (1 + port_daily).cumprod()
    bench_cum = (1 + bench_daily).cumprod()

    leg_cums: dict[str, pd.Series] = {}
    for t in clean:
        leg = (1 + closes[t].pct_change().reindex(common).fillna(0)).cumprod()
        leg_cums[t] = leg

    eq_w = [1.0 / len(clean)] * len(clean)
    eq_daily = (daily.reindex(common).fillna(0) * eq_w).sum(axis=1)
    eq_cum = (1 + eq_daily).cumprod()

    def _ann_stats(series: pd.Series) -> dict[str, float]:
        ret = float(series.mean() * 252)
        vol = float(series.std() * np.sqrt(252))
        sharpe = ret / vol if vol else 0.0
        wealth = float((1 + series).cumprod().iloc[-1])
        total = wealth - 1.0
        return {
            "annual_return_pct": round(ret * 100, 2),
            "annual_vol_pct": round(vol * 100, 2),
            "sharpe": round(sharpe, 3),
            "total_return_pct": round(total * 100, 2),
        }

    port_stats = _ann_stats(port_daily)
    bench_stats = _ann_stats(bench_daily)
    eq_stats = _ann_stats(eq_daily)

    def _max_dd(cum: pd.Series) -> float:
        peak = cum.cummax()
        dd = cum / peak - 1.0
        return float(dd.min()) * 100.0

    dates = [d.strftime("%Y-%m-%d") for d in common]
    # Downsample long series for JSON size (keep ~400 points max).
    step = max(1, len(dates) // 400)
    idx = list(range(0, len(dates), step))
    if idx[-1] != len(dates) - 1:
        idx.append(len(dates) - 1)

    series_payload: dict[str, list] = {
        "date": [dates[i] for i in idx],
        "portfolio": [round(float(port_cum.iloc[i]) * capital, 2) for i in idx],
        "benchmark": [round(float(bench_cum.iloc[i]) * capital, 2) for i in idx],
        "equal_weight": [round(float(eq_cum.iloc[i]) * capital, 2) for i in idx],
    }
    for t, ser in leg_cums.items():
        aligned = ser.reindex(common).ffill()
        series_payload[t] = [round(float(aligned.iloc[i]) * capital, 2) for i in idx]

    contributions = []
    for t, wt in zip(clean, w):
        standalone = float(leg_cums[t].iloc[-1] - 1.0)
        contributions.append(
            {
                "ticker": t,
                "weight_pct": round(wt * 100, 2),
                "standalone_return_pct": round(standalone * 100, 2),
                "weighted_contribution_pct": round(wt * standalone * 100, 2),
            }
        )

    return {
        "ok": True,
        "start_date": dates[0],
        "end_date": dates[-1],
        "trading_days": len(dates),
        "initial_capital": capital,
        "benchmark": bench,
        "tickers": clean,
        "weights": [round(x, 6) for x in w],
        "metrics": {
            "portfolio": {
                **port_stats,
                "max_drawdown_pct": round(_max_dd(port_cum), 2),
                "final_value": round(float(port_cum.iloc[-1]) * capital, 2),
            },
            "benchmark": {
                **bench_stats,
                "max_drawdown_pct": round(_max_dd(bench_cum), 2),
                "final_value": round(float(bench_cum.iloc[-1]) * capital, 2),
            },
            "equal_weight": {
                **eq_stats,
                "max_drawdown_pct": round(_max_dd(eq_cum), 2),
                "final_value": round(float(eq_cum.iloc[-1]) * capital, 2),
            },
            "allocation_effect_pct": round(
                port_stats["total_return_pct"] - eq_stats["total_return_pct"], 2
            ),
            "excess_vs_benchmark_pct": round(
                port_stats["total_return_pct"] - bench_stats["total_return_pct"], 2
            ),
        },
        "contributions": contributions,
        "series": series_payload,
    }


def why_etf_insights() -> dict[str, Any]:
    """Preset comparisons that illustrate diversification / allocation effects."""
    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=365 * 5)).strftime("%Y-%m-%d")

    presets = [
        {
            "id": "diversify",
            "title": "한 종목 vs 시장 ETF",
            "blurb": "개별 주식 변동성에 비해 S&P 500 ETF(SPY)는 더 안정적인 장기 경로를 보여줍니다.",
            "tickers": ["AAPL"],
            "weights": [1.0],
            "benchmark": "SPY",
        },
        {
            "id": "sixty_forty",
            "title": "주식 100% vs 60/40 배분",
            "blurb": "채권(TLT)을 섞으면 수익률은 낮아질 수 있지만 낙폭(MDD)을 줄이는 배분 효과가 납니다.",
            "tickers": ["SPY", "TLT"],
            "weights": [0.6, 0.4],
            "benchmark": "SPY",
        },
        {
            "id": "global",
            "title": "미국 + 해외 분산",
            "blurb": "미국(VTI)과 해외(VXUS)를 함께 담으면 지역 편중 리스크를 낮출 수 있습니다.",
            "tickers": ["VTI", "VXUS"],
            "weights": [0.7, 0.3],
            "benchmark": "VTI",
        },
    ]

    results = []
    for preset in presets:
        sim = simulate_allocation(
            preset["tickers"],
            weights=preset["weights"],
            start_date=start,
            end_date=end,
            initial_capital=10_000,
            benchmark=preset["benchmark"],
        )
        results.append({**preset, "simulation": sim})

    return {
        "ok": True,
        "start_date": start,
        "end_date": end,
        "narrative": [
            {
                "heading": "왜 ETF인가",
                "body": (
                    "ETF는 한 장의 증권으로 수십~수백 종목을 담아, 개별 종목 리스크를 나누고 "
                    "거래비용·운용보수를 낮게 유지할 수 있는 도구입니다. "
                    "장기 자산 배분의 기본 블록으로 쓰기 좋습니다."
                ),
            },
            {
                "heading": "분산의 힘",
                "body": (
                    "동일 자본을 한 종목에 넣는 것과 시장 ETF에 넣는 것은 평균 수익률뿐 아니라 "
                    "변동성과 최대낙폭에서 차이가 납니다. 아래 차트는 최근 5년 실데이터를 기준으로 "
                    "그 차이를 보여줍니다."
                ),
            },
            {
                "heading": "배분이 성과를 만든다",
                "body": (
                    "같은 ETF라도 비중을 어떻게 나누느냐에 따라 최종 자산과 낙폭이 달라집니다. "
                    "시뮬레이션 탭에서 시작일과 비중을 바꿔 직접 확인해 보세요."
                ),
            },
        ],
        "presets": results,
    }

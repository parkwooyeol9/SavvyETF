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


# —— Macro / Economy tab (Vercel proxies here; FRED + Finnhub live on Render) ——

_MACRO_RANGE_LOOKBACK = {
    "1mo": 45,
    "3mo": 100,
    "6mo": 180,
    "1y": 280,
}

_MACRO_METRIC_META = [
    ("dgs3mo", "DGS3MO", "3M Treasury", "rates", "pct", "일간"),
    ("dgs2", "DGS2", "2Y Treasury", "rates", "pct", "일간"),
    ("dgs10", "DGS10", "10Y Treasury", "rates", "pct", "일간"),
    ("dgs30", "DGS30", "30Y Treasury", "rates", "pct", "일간"),
    ("t10y2y", "T10Y2Y", "10Y−2Y 스프레드", "curve", "pct", "일간"),
    ("t10y3m", "T10Y3M", "10Y−3M 스프레드", "curve", "pct", "일간"),
    ("hy_oas", "BAMLH0A0HYM2", "HY OAS", "credit", "pct", "일간"),
    ("ig_oas", "BAMLC0A0CM", "IG OAS", "credit", "pct", "일간"),
    ("vix", "VIXCLS", "VIX", "vol", "index", "일간"),
    ("move", "MOVE", "MOVE", "vol", "index", "일간"),
    ("dff", "DFF", "Fed Funds", "policy", "pct", "일간"),
    ("sofr", "SOFR", "SOFR", "policy", "pct", "일간"),
    ("t5yie", "T5YIE", "5Y 기대인플레", "inflation", "pct", "일간"),
    ("t10yie", "T10YIE", "10Y 기대인플레", "inflation", "pct", "일간"),
    ("nfci", "NFCI", "NFCI", "conditions", "index", "주간"),
]

_MACRO_ASSET_SPECS = [
    ("spy", "SPY", "S&P 500", "equity", "위험자산 베타 · 매크로 스트레스 대비"),
    ("qqq", "QQQ", "Nasdaq 100", "equity", "성장·테크 센티먼트"),
    ("tlt", "TLT", "20Y Treasury", "rates", "장기 금리·듀레이션 리스크"),
    ("hyg", "HYG", "High Yield", "credit", "HY 신용 리스크 온/오프"),
    ("lqd", "LQD", "IG Credit", "credit", "투자등급 회사채 스프레드 프록시"),
    ("gld", "GLD", "Gold", "commodity", "안전자산·실질금리 민감"),
    ("uso", "USO", "Oil ETF", "commodity", "원유 ETF 프록시"),
    ("wti", "CL=F", "WTI", "commodity", "인플레·공급 충격"),
    ("brent", "BZ=F", "Brent", "commodity", "글로벌 원유 벤치마크"),
    ("copper", "HG=F", "Copper", "commodity", "경기·중국 수요 민감"),
    ("uup", "UUP", "US Dollar", "fx", "달러 강세 = 글로벌 유동성 긴축"),
    ("dxy", "DX-Y.NYB", "DXY", "fx", "달러 인덱스"),
    ("eurusd", "EURUSD=X", "EUR/USD", "fx", "달러 약세/강세 크로스"),
    ("usdkurw", "KRW=X", "USD/KRW", "fx", "원/달러 · 국내 연동"),
]

_HYPERSCALER_SPECS = [
    ("msft", "MSFT", "Microsoft", "#60a5fa"),
    ("amzn", "AMZN", "Amazon", "#fb923c"),
    ("googl", "GOOGL", "Alphabet", "#34d399"),
    ("meta", "META", "Meta", "#a78bfa"),
    ("orcl", "ORCL", "Oracle", "#f87171"),
]

_HS_RANGE_PERIOD = {
    "6mo": "6mo",
    "1y": "1y",
    "2y": "2y",
    "5y": "5y",
    "ytd": "ytd",
    "max": "max",
}


def _series_to_points(series: pd.Series, max_points: int = 90) -> list[dict[str, Any]]:
    clean = series.dropna()
    if clean.empty:
        return []
    if len(clean) > max_points:
        step = max(1, len(clean) // max_points)
        clean = clean.iloc[::step]
        if clean.index[-1] != series.dropna().index[-1]:
            clean = pd.concat([clean, series.dropna().iloc[[-1]]])
            clean = clean[~clean.index.duplicated(keep="last")]
    out: list[dict[str, Any]] = []
    for ts, val in clean.items():
        try:
            date = pd.Timestamp(ts).strftime("%Y-%m-%d")
            out.append({"date": date, "value": float(val)})
        except (TypeError, ValueError):
            continue
    return out


def _delta_over(series: pd.Series, days: int) -> float | None:
    clean = series.dropna()
    if len(clean) <= days:
        return None
    return float(clean.iloc[-1] - clean.iloc[-days - 1])


def _pct_over(series: pd.Series, days: int) -> float | None:
    clean = series.dropna()
    if len(clean) <= days:
        return None
    start = float(clean.iloc[-days - 1])
    end = float(clean.iloc[-1])
    if start == 0:
        return None
    return (end / start - 1.0) * 100.0


def _yahoo_close_series(symbol: str, period: str) -> pd.Series:
    import yfinance as yf

    from stock_crawler import _quiet_yfinance

    with _quiet_yfinance():
        hist = yf.Ticker(symbol).history(period=period, auto_adjust=True)
    if hist.empty:
        return pd.Series(dtype=float)
    return hist["Close"].dropna()


def macro_web_payload(
    range_key: str = "3mo",
    hs_range: str = "2y",
    *,
    force: bool = False,
) -> dict[str, Any]:
    """JSON payload for Vercel Economy tab — uses Render FRED/Finnhub keys."""
    from macro_data import build_macro_bundle
    from macro_scores import compute_macro_stress

    range_key = range_key if range_key in _MACRO_RANGE_LOOKBACK else "3mo"
    hs_range = hs_range if hs_range in _HS_RANGE_PERIOD else "2y"
    lookback = _MACRO_RANGE_LOOKBACK[range_key]
    yahoo_period = {"1mo": "1mo", "3mo": "3mo", "6mo": "6mo", "1y": "1y"}[range_key]

    try:
        bundle = build_macro_bundle(force=force)
    except Exception as exc:
        return {"ok": False, "error": f"macro bundle failed: {exc}"}

    snap = dict(bundle.get("snapshot") or {})
    fred: dict[str, pd.Series] = bundle.get("fred") or {}
    market: pd.DataFrame = bundle.get("market") if isinstance(bundle.get("market"), pd.DataFrame) else pd.DataFrame()
    finnhub = bundle.get("finnhub") or {}
    uses_fred_key = bool(bundle.get("uses_fred"))
    stress = compute_macro_stress(snap, edgar=bundle.get("edgar"), finnhub=finnhub)

    # Tail FRED series to requested chart window
    def _tail(series: pd.Series) -> pd.Series:
        clean = series.dropna()
        if clean.empty:
            return clean
        return clean.iloc[-lookback:]

    metrics: list[dict[str, Any]] = []
    snap_key_for_fred = {
        "BAMLH0A0HYM2": "HY_OAS",
        "BAMLC0A0CM": "IG_OAS",
        "VIXCLS": "VIX",
        "DFF": "FED_FUNDS",
        "DGS3MO": "DGS3MO",
        "DGS2": "DGS2",
        "DGS10": "DGS10",
        "DGS30": "DGS30",
        "T10Y2Y": "T10Y2Y",
        "T10Y3M": "T10Y3M",
        "SOFR": "SOFR",
        "T5YIE": "T5YIE",
        "T10YIE": "T10YIE",
        "NFCI": "NFCI",
        "MOVE": "MOVE",
    }
    for mid, fred_id, label, group, unit, cadence in _MACRO_METRIC_META:
        series = _tail(fred.get(fred_id, pd.Series(dtype=float)))
        points = _series_to_points(series)
        if not series.empty:
            value: float | None = float(series.iloc[-1])
        else:
            value = snap.get(snap_key_for_fred.get(fred_id, fred_id))
        metrics.append(
            {
                "id": mid,
                "label": label,
                "group": group,
                "unit": unit,
                "value": value,
                "change_5d": _delta_over(series, 5),
                "change_20d": _delta_over(series, 20),
                "series": points,
                "source": (
                    "Yahoo"
                    if fred_id == "MOVE"
                    else ("FRED" if uses_fred_key and points else ("Yahoo" if points else None))
                ),
                "cadence": cadence,
                "note": None if points or value is not None else "데이터 없음",
            }
        )

    # HYG/TLT risk appetite
    if not market.empty and {"HYG", "TLT"}.issubset(market.columns):
        ratio = (market["HYG"] / market["TLT"]).dropna()
        ratio = _tail(ratio)
        metrics.append(
            {
                "id": "hyg_tlt",
                "label": "HYG / TLT",
                "group": "market",
                "unit": "index",
                "value": float(ratio.iloc[-1]) if not ratio.empty else None,
                "change_5d": _pct_over(ratio, 5),
                "change_20d": _pct_over(ratio, 20),
                "series": _series_to_points(ratio),
                "source": "Yahoo",
                "cadence": "일간",
                "note": "리스크 온/오프 비율",
            }
        )

    assets: list[dict[str, Any]] = []
    for aid, symbol, label, group, thesis in _MACRO_ASSET_SPECS:
        try:
            series = _yahoo_close_series(symbol, yahoo_period)
            points = _series_to_points(series, max_points=90)
            price = float(series.iloc[-1]) if not series.empty else None
            range_pct = None
            if len(series) >= 2:
                range_pct = (float(series.iloc[-1]) / float(series.iloc[0]) - 1.0) * 100.0
            assets.append(
                {
                    "id": aid,
                    "symbol": symbol,
                    "label": label,
                    "group": group,
                    "thesis": thesis,
                    "price": price,
                    "change_1d_pct": _pct_over(series, 1),
                    "change_5d_pct": _pct_over(series, 5),
                    "change_range_pct": range_pct,
                    "series": points,
                }
            )
        except Exception as exc:
            assets.append(
                {
                    "id": aid,
                    "symbol": symbol,
                    "label": label,
                    "group": group,
                    "thesis": thesis,
                    "price": None,
                    "change_1d_pct": None,
                    "change_5d_pct": None,
                    "change_range_pct": None,
                    "series": [],
                    "error": str(exc),
                }
            )

    hyperscalers: list[dict[str, Any]] = []
    hs_period = _HS_RANGE_PERIOD[hs_range]
    for hid, symbol, label, color in _HYPERSCALER_SPECS:
        try:
            series = _yahoo_close_series(symbol, hs_period)
            points = _series_to_points(series, max_points=260)
            price = float(series.iloc[-1]) if not series.empty else None
            range_pct = None
            if len(series) >= 2:
                range_pct = (float(series.iloc[-1]) / float(series.iloc[0]) - 1.0) * 100.0
            hyperscalers.append(
                {
                    "id": hid,
                    "symbol": symbol,
                    "label": label,
                    "color": color,
                    "price": price,
                    "change_1d_pct": _pct_over(series, 1),
                    "change_range_pct": range_pct,
                    "series": points,
                }
            )
        except Exception as exc:
            hyperscalers.append(
                {
                    "id": hid,
                    "symbol": symbol,
                    "label": label,
                    "color": color,
                    "price": None,
                    "change_1d_pct": None,
                    "change_range_pct": None,
                    "series": [],
                    "error": str(exc),
                }
            )

    calendar_rows = []
    calendar_source = finnhub.get("calendar_source")
    if finnhub.get("available") or finnhub.get("calendar"):
        for row in (finnhub.get("high_impact_upcoming") or [])[:18]:
            calendar_rows.append(
                {
                    "date": str(row.get("date") or "")[:10],
                    "time": row.get("time") or None,
                    "country": row.get("country") or "US",
                    "event": row.get("event") or row.get("eventName") or "Event",
                    "impact": row.get("impact") or "high",
                    "actual": None if row.get("actual") in (None, "") else str(row.get("actual")),
                    "estimate": None
                    if row.get("estimate") in (None, "")
                    else str(row.get("estimate")),
                    "prev": None if row.get("prev") in (None, "") else str(row.get("prev")),
                }
            )
        for row in (finnhub.get("recent_releases") or [])[:8]:
            calendar_rows.append(
                {
                    "date": str(row.get("date") or "")[:10],
                    "time": row.get("time") or None,
                    "country": row.get("country") or "US",
                    "event": row.get("event") or "Event",
                    "impact": row.get("impact") or "high",
                    "actual": None if row.get("actual") in (None, "") else str(row.get("actual")),
                    "estimate": None
                    if row.get("estimate") in (None, "")
                    else str(row.get("estimate")),
                    "prev": None if row.get("prev") in (None, "") else str(row.get("prev")),
                }
            )

    cal_label = {
        "finnhub": "Finnhub 캘린더",
        "investing": "Investing.com 캘린더",
        "forexfactory": "Forex Factory 캘린더",
    }.get(str(calendar_source or ""), None)
    uses_fred = uses_fred_key and snap.get("HY_OAS") is not None
    note_parts = [
        "Render /macro 파이프라인",
        "FRED" if uses_fred else "FRED 키 없음(Render)",
        cal_label or ("캘린더 없음" if not calendar_rows else "캘린더"),
    ]

    regime_ko = {
        "High Stress": "고스트레스",
        "Elevated": "경계",
        "Caution": "주의",
        "Calm": "안정",
    }.get(stress.regime, stress.regime)

    # Ensure snapshot has web fields
    web_snap = {
        "as_of": snap.get("as_of") or datetime.utcnow().isoformat() + "Z",
        "DGS3MO": snap.get("DGS3MO"),
        "DGS2": snap.get("DGS2"),
        "DGS10": snap.get("DGS10"),
        "DGS30": snap.get("DGS30"),
        "T10Y2Y": snap.get("T10Y2Y"),
        "T10Y3M": snap.get("T10Y3M"),
        "HY_OAS": snap.get("HY_OAS"),
        "IG_OAS": snap.get("IG_OAS"),
        "VIX": snap.get("VIX"),
        "FED_FUNDS": snap.get("FED_FUNDS"),
        "SOFR": snap.get("SOFR"),
        "MOVE": snap.get("MOVE"),
        "T5YIE": snap.get("T5YIE"),
        "T10YIE": snap.get("T10YIE"),
        "NFCI": snap.get("NFCI"),
        "SPY_5D": snap.get("SPY_5D"),
        "SPY_20D": snap.get("SPY_20D"),
        "HYG_TLT_20D": snap.get("HYG_TLT_20D"),
    }

    return {
        "ok": True,
        "source": "render",
        "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": " · ".join(note_parts),
        "schedule_note": "권장 갱신: 평일 08:00 KST (FRED 전일 확정) · Render 캐시 1시간 · 시세 5분 폴링",
        "range": range_key,
        "uses_fred": uses_fred,
        "snapshot": web_snap,
        "stress": {
            "score": int(stress.score),
            "regime": stress.regime,
            "regime_ko": regime_ko,
            "drivers": list(stress.drivers),
            "components": {k: float(v) for k, v in stress.components.items()},
        },
        "yield_curve": [
            {"tenor": "3M", "value": web_snap["DGS3MO"]},
            {"tenor": "2Y", "value": web_snap["DGS2"]},
            {"tenor": "10Y", "value": web_snap["DGS10"]},
            {"tenor": "30Y", "value": web_snap["DGS30"]},
        ],
        "metrics": metrics,
        "assets": assets,
        "hyperscalers": hyperscalers,
        "hyperscaler_range": hs_range,
        "calendar": calendar_rows,
        "calendar_source": calendar_source,
        "error": _sanitize_macro_errors(
            (bundle.get("fred_errors") or []) + (finnhub.get("errors") or [])
        ),
    }


def _sanitize_macro_errors(errors: list[str]) -> str | None:
    """Strip secrets/URLs from upstream errors before sending to the browser."""
    if not errors:
        return None
    cleaned: list[str] = []
    for raw in errors[:4]:
        text = str(raw)
        # Drop query strings that may contain API tokens
        if "token=" in text.lower() or "api_key=" in text.lower():
            if "403" in text:
                cleaned.append("Finnhub calendar: 403 (플랜에서 economic calendar 미지원 가능)")
            elif "401" in text:
                cleaned.append("Finnhub: 401 unauthorized")
            else:
                cleaned.append("Finnhub/FRED request failed (auth)")
            continue
        if "http://" in text or "https://" in text:
            # Keep short label only
            head = text.split(":", 1)[0].strip()
            cleaned.append(f"{head}: upstream HTTP error")
            continue
        cleaned.append(text[:120])
    return "; ".join(cleaned) if cleaned else None


def ai_gov_screen_payload(query: str | None = None) -> dict[str, Any]:
    """Dashboard payload for AI 거버넌스 tab (DART + SEC + news + policy)."""
    try:
        from ai_gov_screen import build_ai_gov_screen

        return build_ai_gov_screen(query=query)
    except Exception as exc:
        return {
            "ok": False,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "dart": {"ok": False, "hits": [], "error": str(exc)},
            "sec": {"ok": False, "filings": []},
            "finnhub": {"ok": False, "headlines": []},
            "naver": {"ok": False, "headlines": []},
            "policy": {"ok": True, "events": []},
            "errors": [str(exc)],
            "error": str(exc),
        }


def esg_events_payload(*, refresh: bool = False) -> dict[str, Any]:
    """Dashboard payload for ESG 시황 daily event monitor."""
    try:
        from esg_event_monitor import build_esg_events_bundle, load_latest, persist_bundle

        if not refresh:
            cached = load_latest()
            if isinstance(cached, dict) and cached.get("categories"):
                return {
                    **cached,
                    "ok": True,
                    "source": cached.get("source") or "cache",
                }
        bundle = build_esg_events_bundle()
        persist_bundle(bundle)
        return bundle
    except Exception as exc:
        return {
            "ok": False,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "categories": [],
            "summary": {"total": 0, "fresh": 0, "by_pillar": {"E": 0, "S": 0, "G": 0}},
            "error": str(exc),
        }


def nlp_pulse_payload() -> dict[str, Any]:
    """Dashboard payload for AI → NLP (DART + SEC + Finnhub, bot keys)."""
    try:
        from nlp_pulse import build_nlp_pulse_keyed

        return build_nlp_pulse_keyed()
    except Exception as exc:
        return {
            "ok": False,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "dart": [],
            "sec": [],
            "earnings": [],
            "sources": [],
            "errors": [str(exc)],
            "error": str(exc),
        }

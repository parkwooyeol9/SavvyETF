"""Fetch macro, rates, credit, and risk-proxy market data."""

from __future__ import annotations

import os
import pickle
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf
from dotenv import load_dotenv

from macro_supplements import build_edgar_snapshot, build_finnhub_bundle, build_stooq_bundle
from stock_crawler import _quiet_yfinance

PROJECT_DIR = Path(__file__).resolve().parent
ENV_FILE = PROJECT_DIR / ".env"
DATA_DIR = PROJECT_DIR / "data"
MACRO_CACHE_PATH = DATA_DIR / "macro_cache.pkl"
KST = ZoneInfo("Asia/Seoul")

CACHE_VERSION = 4
CACHE_TTL_SECONDS = 3600
LOOKBACK_DAYS = 120

FRED_SERIES: dict[str, dict[str, str]] = {
    "DGS3MO": {"label": "3M Treasury", "group": "rates"},
    "DGS2": {"label": "2Y Treasury", "group": "rates"},
    "DGS10": {"label": "10Y Treasury", "group": "rates"},
    "DGS30": {"label": "30Y Treasury", "group": "rates"},
    "T10Y2Y": {"label": "10Y-2Y spread", "group": "curve"},
    "T10Y3M": {"label": "10Y-3M spread", "group": "curve"},
    "BAMLH0A0HYM2": {"label": "HY OAS", "group": "credit"},
    "BAMLC0A0CM": {"label": "IG OAS", "group": "credit"},
    "VIXCLS": {"label": "VIX", "group": "vol"},
    "DFF": {"label": "Fed Funds", "group": "policy"},
}

MARKET_TICKERS = {
    "SPY": "S&P 500",
    "TLT": "20Y Treasury",
    "HYG": "High Yield",
    "LQD": "Inv Grade Credit",
}


YAHOO_YIELD_SYMBOLS = {
    "DGS3MO": "^IRX",
    "DGS10": "^TNX",
    "DGS30": "^TYX",
}


def _ensure_env_loaded() -> None:
    load_dotenv(ENV_FILE, override=False)


def _fred_api_key() -> str:
    _ensure_env_loaded()
    return os.environ.get("FRED_API_KEY", "").strip()


def _bundle_is_usable(bundle: dict | None) -> bool:
    if not bundle:
        return False
    snap = bundle.get("snapshot") or {}
    if _fred_api_key():
        required = ("DGS10", "DGS2", "T10Y2Y", "HY_OAS", "IG_OAS")
        if any(snap.get(key) is None for key in required):
            return False
        fred = bundle.get("fred") or {}
        if fred.get("BAMLH0A0HYM2", pd.Series(dtype=float)).empty:
            return False
        if fred.get("BAMLC0A0CM", pd.Series(dtype=float)).empty:
            return False
    return True


def _load_cache() -> dict | None:
    if not MACRO_CACHE_PATH.exists():
        return None
    try:
        with MACRO_CACHE_PATH.open("rb") as handle:
            payload = pickle.load(handle)
    except Exception:
        return None
    if payload.get("version") != CACHE_VERSION:
        return None
    if time.time() - float(payload.get("loaded_at", 0)) > CACHE_TTL_SECONDS:
        return None
    bundle = payload.get("bundle")
    if not _bundle_is_usable(bundle):
        return None
    return bundle


def _save_cache(bundle: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with MACRO_CACHE_PATH.open("wb") as handle:
        pickle.dump(
            {"version": CACHE_VERSION, "loaded_at": time.time(), "bundle": bundle},
            handle,
        )


def _fetch_fred_series(series_id: str, limit: int = LOOKBACK_DAYS) -> pd.Series:
    api_key = _fred_api_key()
    if not api_key:
        return pd.Series(dtype=float)

    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit,
    }
    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    observations = response.json().get("observations", [])
    rows: list[tuple[pd.Timestamp, float]] = []
    for row in observations:
        value = row.get("value")
        if value in (None, ".", ""):
            continue
        try:
            rows.append((pd.Timestamp(row["date"]), float(value)))
        except (TypeError, ValueError):
            continue
    if not rows:
        return pd.Series(dtype=float)
    series = pd.Series({ts: val for ts, val in rows}).sort_index()
    series.name = series_id
    return series


def _fetch_market_history(tickers: list[str], period: str = "6mo") -> pd.DataFrame:
    with _quiet_yfinance():
        raw = yf.download(
            tickers,
            period=period,
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    if raw.empty:
        return pd.DataFrame()

    frames: dict[str, pd.Series] = {}
    for ticker in tickers:
        try:
            if len(tickers) == 1:
                close = raw["Close"]
            else:
                close = raw[ticker]["Close"]
            frames[ticker] = close.dropna()
        except (KeyError, TypeError):
            continue
    if not frames:
        return pd.DataFrame()
    return pd.DataFrame(frames).dropna(how="all")


def _latest(series: pd.Series) -> float | None:
    clean = series.dropna()
    if clean.empty:
        return None
    return float(clean.iloc[-1])


def _pct_change(series: pd.Series, days: int) -> float | None:
    clean = series.dropna()
    if len(clean) <= days:
        return None
    start = float(clean.iloc[-days - 1])
    end = float(clean.iloc[-1])
    if start == 0:
        return None
    return (end / start - 1) * 100


def _fetch_yahoo_yield_series(symbol: str, period: str = "6mo") -> pd.Series:
    with _quiet_yfinance():
        history = yf.Ticker(symbol).history(period=period, auto_adjust=True)
    if history.empty:
        return pd.Series(dtype=float)
    series = history["Close"].dropna().copy()
    series.name = symbol
    return series


def _apply_yahoo_yield_fallbacks(fred: dict[str, pd.Series]) -> None:
    for fred_id, yahoo_symbol in YAHOO_YIELD_SYMBOLS.items():
        if fred_id in fred and not fred[fred_id].empty:
            continue
        series = _fetch_yahoo_yield_series(yahoo_symbol)
        if not series.empty:
            fred[fred_id] = series
            fred[fred_id].name = fred_id

    if (fred.get("T10Y2Y") is None or fred.get("T10Y2Y", pd.Series(dtype=float)).empty):
        dgs10 = fred.get("DGS10", pd.Series(dtype=float))
        dgs2 = fred.get("DGS2", pd.Series(dtype=float))
        if not dgs10.empty and not dgs2.empty:
            spread = (dgs10 - dgs2).dropna()
            if not spread.empty:
                fred["T10Y2Y"] = spread
                fred["T10Y2Y"].name = "T10Y2Y"


def macro_cache_ready() -> bool:
    return _load_cache() is not None


def build_macro_bundle(force: bool = False) -> dict:
    _ensure_env_loaded()
    cached = None if force else _load_cache()
    if cached is not None:
        return cached

    fred: dict[str, pd.Series] = {}
    fred_errors: list[str] = []
    if _fred_api_key():
        for series_id in FRED_SERIES:
            try:
                fred[series_id] = _fetch_fred_series(series_id)
            except Exception as exc:
                fred_errors.append(f"{series_id}: {exc}")
    else:
        fred_errors.append("FRED_API_KEY not set — using Yahoo Finance proxies only.")

    market = _fetch_market_history(list(MARKET_TICKERS.keys()))
    if market.empty:
        stooq_bundle = build_stooq_bundle()
        stooq_market = stooq_bundle.get("market", pd.DataFrame())
        rename_map = {
            "spy.us": "SPY",
            "tlt.us": "TLT",
            "hyg.us": "HYG",
            "qqq.us": "QQQ",
        }
        if not stooq_market.empty:
            market = stooq_market.rename(columns=rename_map)
    else:
        stooq_bundle = build_stooq_bundle()

    if not market.empty:
        market["HYG_TLT"] = market["HYG"] / market["TLT"] if {"HYG", "TLT"}.issubset(market.columns) else None
        market["HYG_LQD"] = market["HYG"] / market["LQD"] if {"HYG", "LQD"}.issubset(market.columns) else None

    # Yahoo fallbacks when FRED is missing or partial
    _apply_yahoo_yield_fallbacks(fred)

    if "VIXCLS" not in fred or fred["VIXCLS"].empty:
        with _quiet_yfinance():
            vix = yf.Ticker("^VIX").history(period="6mo", auto_adjust=True)
        if not vix.empty:
            fred["VIXCLS"] = vix["Close"].copy()
            fred["VIXCLS"].name = "VIXCLS"

    snapshot = {
        "as_of": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "DGS3MO": _latest(fred.get("DGS3MO", pd.Series(dtype=float))),
        "DGS2": _latest(fred.get("DGS2", pd.Series(dtype=float))),
        "DGS10": _latest(fred.get("DGS10", pd.Series(dtype=float))),
        "DGS30": _latest(fred.get("DGS30", pd.Series(dtype=float))),
        "T10Y2Y": _latest(fred.get("T10Y2Y", pd.Series(dtype=float))),
        "T10Y3M": _latest(fred.get("T10Y3M", pd.Series(dtype=float))),
        "HY_OAS": _latest(fred.get("BAMLH0A0HYM2", pd.Series(dtype=float))),
        "IG_OAS": _latest(fred.get("BAMLC0A0CM", pd.Series(dtype=float))),
        "VIX": _latest(fred.get("VIXCLS", pd.Series(dtype=float))),
        "FED_FUNDS": _latest(fred.get("DFF", pd.Series(dtype=float))),
        "SPY_5D": _pct_change(market["SPY"], 5) if "SPY" in market.columns else None,
        "SPY_20D": _pct_change(market["SPY"], 20) if "SPY" in market.columns else None,
        "HYG_TLT_20D": _pct_change(market["HYG_TLT"], 20) if "HYG_TLT" in market.columns else None,
    }

    stooq_snapshot = stooq_bundle.get("snapshot", {})
    if snapshot.get("SPY_20D") is None:
        for label, value in (stooq_snapshot.get("moves_20d") or {}).items():
            if label.startswith("S&P 500"):
                snapshot["SPY_20D"] = value
                break
    if snapshot.get("HYG_TLT_20D") is None and stooq_snapshot.get("hyg_tlt_20d") is not None:
        snapshot["HYG_TLT_20D"] = stooq_snapshot["hyg_tlt_20d"]

    edgar = build_edgar_snapshot()
    finnhub = build_finnhub_bundle()

    bundle = {
        "fred": fred,
        "market": market,
        "snapshot": snapshot,
        "fred_errors": fred_errors,
        "uses_fred": bool(_fred_api_key()),
        "stooq": stooq_bundle,
        "edgar": edgar,
        "finnhub": finnhub,
    }
    _save_cache(bundle)
    return bundle

"""Statistical analysis of ADR listing impact on underlying shares."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from adr_data_loader import MIN_TRADING_DAYS, WINDOW_YEARS, load_underlying_window
from adr_mapping import AdrProfile, resolve_adr


def _safe_mean(series: pd.Series) -> float:
    clean = series.dropna()
    return float(clean.mean()) if not clean.empty else float("nan")


def _safe_std(series: pd.Series) -> float:
    clean = series.dropna()
    return float(clean.std()) if len(clean) > 1 else float("nan")


def analyze_single(profile: AdrProfile) -> dict:
    bundle = load_underlying_window(profile)
    pre = bundle["pre"]
    post = bundle["post"]
    event = bundle["full"]
    coverage_note = bundle.get("coverage_note", "")

    pre_returns = pre["daily_return"].dropna()
    post_returns = post["daily_return"].dropna()
    pre_vol = pre["volume"].replace(0, np.nan).dropna()
    post_vol = post["volume"].replace(0, np.nan).dropna()

    pre_price_change = (
        (pre["close"].iloc[-1] / pre["close"].iloc[0] - 1) * 100 if len(pre) > 1 else float("nan")
    )
    post_price_change = (
        (post["close"].iloc[-1] / post["close"].iloc[0] - 1) * 100
        if len(post) > 1
        else float("nan")
    )

    vol_ratio = (
        _safe_mean(post_vol) / _safe_mean(pre_vol) if _safe_mean(pre_vol) > 0 else float("nan")
    )

    t_stat, p_value = (float("nan"), float("nan"))
    if len(pre_returns) >= MIN_TRADING_DAYS and len(post_returns) >= MIN_TRADING_DAYS:
        t_stat, p_value = stats.ttest_ind(
            post_returns,
            pre_returns,
            equal_var=False,
            nan_policy="omit",
        )
    elif len(pre_returns) < MIN_TRADING_DAYS:
        coverage_note = (coverage_note + " Welch t-test skipped (limited pre data).").strip()

    listing_rows = event[event["days_from_listing"] >= 0]
    listing_close = (
        float(listing_rows["close"].iloc[0])
        if not listing_rows.empty
        else float(event["close"].iloc[len(event) // 2])
    )
    event = event.copy()
    event["price_index"] = event["close"] / listing_close * 100
    event["rebased_return_pct"] = (event["close"] / listing_close - 1) * 100

    metrics = {
        "adr_symbol": profile.adr_symbol,
        "underlying_symbol": profile.underlying_symbol,
        "company_name": profile.company_name,
        "home_exchange": profile.home_exchange,
        "us_adr_listing_date": bundle["us_adr_listing_date"].isoformat(),
        "us_adr_listing_source": bundle["us_adr_listing_source"],
        "analysis_event_date": bundle["listing_date"].isoformat(),
        "analysis_event_source": bundle["listing_source"],
        "data_source": bundle.get("data_source", ""),
        "window_years": WINDOW_YEARS,
        "pre_trading_days": len(pre),
        "post_trading_days": len(post),
        "pre_avg_daily_return_pct": _safe_mean(pre_returns) * 100,
        "post_avg_daily_return_pct": _safe_mean(post_returns) * 100,
        "pre_return_volatility_pct": _safe_std(pre_returns) * 100,
        "post_return_volatility_pct": _safe_std(post_returns) * 100,
        "pre_cumulative_return_pct": pre_price_change,
        "post_cumulative_return_pct": post_price_change,
        "pre_avg_volume": _safe_mean(pre_vol),
        "post_avg_volume": _safe_mean(post_vol),
        "volume_post_to_pre_ratio": vol_ratio,
        "return_diff_post_minus_pre_pct": (_safe_mean(post_returns) - _safe_mean(pre_returns)) * 100,
        "ttest_post_vs_pre_return_t": float(t_stat),
        "ttest_post_vs_pre_return_p": float(p_value),
        "significant_at_5pct": bool(p_value < 0.05) if not np.isnan(p_value) else False,
        "coverage_note": coverage_note,
    }

    return {
        "metrics": metrics,
        "event": event,
        "pre": pre,
        "post": post,
        "bundle": bundle,
    }


def analyze_adr_list(symbols: list[str]) -> dict:
    results: list[dict] = []
    errors: list[str] = []

    for raw in symbols:
        try:
            profile = resolve_adr(raw)
            results.append(analyze_single(profile))
        except Exception as exc:
            errors.append(f"{raw.upper()}: {exc}")

    if not results and errors:
        raise ValueError("\n".join(errors))

    summary_df = pd.DataFrame([r["metrics"] for r in results])
    return {"results": results, "summary": summary_df, "errors": errors}


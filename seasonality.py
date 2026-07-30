"""Monthly return seasonality analysis for individual stocks (/seasonality)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from fin_estimate import resolve_fin_estimate_symbol
from yahoo_market import fetch_daily_candles, to_yahoo_symbol

LOOKBACK_YEARS = 10
DEFAULT_FOCUS_MONTHS: tuple[int, ...] = (6, 7, 8, 9)
MIN_MONTHLY_OBS = 24
MIN_PER_MONTH = 3

MONTH_LABELS_KO: dict[int, str] = {
    1: "1월",
    2: "2월",
    3: "3월",
    4: "4월",
    5: "5월",
    6: "6월",
    7: "7월",
    8: "8월",
    9: "9월",
    10: "10월",
    11: "11월",
    12: "12월",
}


def parse_seasonality_ticker(command: str) -> str:
    parts = command.strip().split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        raise ValueError("missing ticker")
    return parts[1].strip()


def _fetch_history(yahoo_symbol: str, years: int = LOOKBACK_YEARS) -> pd.DataFrame:
    range_key = f"{years}y" if years <= 10 else "max"
    frame = fetch_daily_candles(yahoo_symbol, range_=range_key, interval="1d")
    if frame.empty:
        return frame
    cutoff = pd.Timestamp(date.today() - timedelta(days=365 * years + 5))
    return frame[frame.index >= cutoff].copy()


def compute_monthly_returns(daily: pd.DataFrame) -> pd.Series:
    """Month-end to month-end simple returns (%)."""
    close = daily["close"].dropna().sort_index()
    if close.empty:
        return pd.Series(dtype=float)
    month_end = close.resample("ME").last()
    return (month_end.pct_change().dropna() * 100.0).astype(float)


def _safe_mean(series: pd.Series) -> float:
    clean = series.dropna()
    return float(clean.mean()) if not clean.empty else float("nan")


def _months_label_ko(months: tuple[int, ...]) -> str:
    return "·".join(MONTH_LABELS_KO[m] for m in sorted(months))


def classify_seasonality(
    focus_mean: float,
    other_mean: float,
    p_value: float,
    focus_months: tuple[int, ...],
) -> dict[str, Any]:
    months_str = _months_label_ko(focus_months)
    significant = bool(np.isfinite(p_value) and p_value < 0.05)
    diff = focus_mean - other_mean if np.isfinite(focus_mean) and np.isfinite(other_mean) else float("nan")

    if not np.isfinite(focus_mean) or not np.isfinite(other_mean):
        return {
            "label": "데이터 부족",
            "label_en": "insufficient",
            "tone": "muted",
            "significant": False,
            "summary_ko": "월별 수익률 표본이 부족해 계절성을 판정할 수 없습니다.",
        }

    p_txt = f"{p_value:.3f}" if np.isfinite(p_value) else "n/a"

    if diff > 0.05:
        if significant:
            label, tone = "계절성 있음", "positive"
            summary = (
                f"분석 기간 동안 {months_str} 평균 월수익률({focus_mean:+.2f}%)이 "
                f"나머지 달({other_mean:+.2f}%)보다 높으며, "
                f"Welch t-검정 p={p_txt}으로 통계적으로 유의합니다."
            )
        else:
            label, tone = "약한 상방 경향", "caution"
            summary = (
                f"{months_str} 평균 수익률({focus_mean:+.2f}%)이 나머지 달({other_mean:+.2f}%)보다 "
                f"높은 경향이나, p={p_txt}으로 5% 유의수준에서는 유의하지 않습니다."
            )
    elif diff < -0.05:
        if significant:
            label, tone = "역계절성", "negative"
            summary = (
                f"{months_str} 평균 월수익률({focus_mean:+.2f}%)이 "
                f"나머지 달({other_mean:+.2f}%)보다 낮으며, "
                f"Welch t-검정 p={p_txt}으로 통계적으로 유의합니다."
            )
        else:
            label, tone = "약한 하방 경향", "caution"
            summary = (
                f"{months_str} 평균 수익률이 나머지 달보다 낮은 경향이나, "
                f"p={p_txt}으로 유의하지 않습니다."
            )
    else:
        label, tone = "계절성 없음", "neutral"
        summary = (
            f"{months_str}({focus_mean:+.2f}%)과 나머지 달({other_mean:+.2f}%)의 "
            f"평균 월수익률 차이가 크지 않아 뚜렷한 계절성은 보이지 않습니다."
        )

    return {
        "label": label,
        "label_en": tone,
        "tone": tone,
        "significant": significant,
        "summary_ko": summary,
    }


def analyze_monthly_seasonality(
    monthly_ret: pd.Series,
    *,
    focus_months: tuple[int, ...] = DEFAULT_FOCUS_MONTHS,
) -> dict[str, Any]:
    if monthly_ret is None or monthly_ret.empty or len(monthly_ret) < MIN_MONTHLY_OBS:
        raise ValueError(
            f"월별 수익률 표본이 부족합니다 (최소 {MIN_MONTHLY_OBS}개월 필요)."
        )

    frame = monthly_ret.to_frame("ret")
    frame["month"] = frame.index.month
    frame["year"] = frame.index.year

    by_month: list[dict[str, Any]] = []
    for month in range(1, 13):
        subset = frame.loc[frame["month"] == month, "ret"]
        n = int(len(subset))
        by_month.append(
            {
                "month": month,
                "label_ko": MONTH_LABELS_KO[month],
                "mean_pct": _safe_mean(subset),
                "median_pct": float(subset.median()) if n else float("nan"),
                "std_pct": float(subset.std()) if n > 1 else float("nan"),
                "win_rate_pct": float((subset > 0).mean() * 100.0) if n else float("nan"),
                "n": n,
                "in_focus": month in focus_months,
            }
        )

    focus = frame.loc[frame["month"].isin(focus_months), "ret"].dropna()
    other = frame.loc[~frame["month"].isin(focus_months), "ret"].dropna()

    t_stat, p_value = (float("nan"), float("nan"))
    if len(focus) >= MIN_PER_MONTH and len(other) >= MIN_PER_MONTH:
        t_stat, p_value = stats.ttest_ind(
            focus,
            other,
            equal_var=False,
            nan_policy="omit",
        )

    focus_mean = _safe_mean(focus)
    other_mean = _safe_mean(other)
    verdict = classify_seasonality(focus_mean, other_mean, float(p_value), focus_months)

    # Year-by-year: focus-season cumulative return per calendar year
    yearly_focus: list[dict[str, Any]] = []
    for year, group in frame.groupby("year"):
        focus_rows = group[group["month"].isin(focus_months)]
        if focus_rows.empty:
            continue
        # Compound monthly returns within the focus season for that year
        compounded = float((1 + focus_rows["ret"] / 100.0).prod() - 1.0) * 100.0
        yearly_focus.append({"year": int(year), "return_pct": compounded})

    years_covered = sorted(frame["year"].unique().tolist())
    return {
        "monthly_stats": by_month,
        "focus_months": list(focus_months),
        "focus_label_ko": _months_label_ko(focus_months),
        "focus_mean_pct": focus_mean,
        "other_mean_pct": other_mean,
        "diff_focus_minus_other_pct": (
            focus_mean - other_mean
            if np.isfinite(focus_mean) and np.isfinite(other_mean)
            else float("nan")
        ),
        "ttest_t": float(t_stat),
        "ttest_p": float(p_value),
        "focus_n": int(len(focus)),
        "other_n": int(len(other)),
        "verdict": verdict,
        "yearly_focus": yearly_focus,
        "years_covered": [int(y) for y in years_covered],
        "n_months": int(len(monthly_ret)),
        "start_date": monthly_ret.index.min().date().isoformat(),
        "end_date": monthly_ret.index.max().date().isoformat(),
    }


def run_seasonality_analysis(
    token: str,
    *,
    focus_months: tuple[int, ...] = DEFAULT_FOCUS_MONTHS,
    years: int = LOOKBACK_YEARS,
) -> dict[str, Any]:
    resolved = resolve_fin_estimate_symbol(token)
    yahoo = resolved["yahoo"]
    display = resolved.get("display") or yahoo

    daily = _fetch_history(yahoo, years=years)
    if daily.empty:
        raise ValueError(f"{display}: 주가 이력을 가져올 수 없습니다 ({yahoo}).")

    monthly = compute_monthly_returns(daily)
    analysis = analyze_monthly_seasonality(monthly, focus_months=focus_months)

    return {
        "ok": True,
        "query": token,
        "symbol": yahoo,
        "yahoo_symbol": to_yahoo_symbol(yahoo),
        "display": display,
        "market": resolved.get("market"),
        "currency": resolved.get("currency"),
        "lookback_years": years,
        **analysis,
    }


def seasonality_web_payload(
    ticker: str,
    *,
    focus_months: tuple[int, ...] = DEFAULT_FOCUS_MONTHS,
) -> dict[str, Any]:
    try:
        return run_seasonality_analysis(ticker, focus_months=focus_months)
    except Exception as exc:
        return {"ok": False, "error": str(exc), "query": ticker}

"""Build event-study return series for country indices around event dates."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from adr_providers import _fetch_yahoo_chart
from idx_data import MARKET_MAP, MarketInstruments

# /event compares only these four /idx cash indices.
EVENT_STUDY_COUNTRIES: tuple[str, ...] = (
    "United States",
    "Japan",
    "South Korea",
    "China",
)

COUNTRY_LABEL_KO: dict[str, str] = {
    "United States": "미국",
    "Japan": "일본",
    "South Korea": "한국",
    "China": "중국",
}

HORIZON_DAYS: tuple[int, ...] = (30, 60, 90)
WINDOW_PRE_DAYS = 30
WINDOW_POST_DAYS = 95  # need ≥90d post for horizon stats
WINDOW_DAYS = WINDOW_POST_DAYS  # backward-compat alias used in captions
MIN_POINTS = 5

# Impact thresholds on mean cumulative return (%) across available horizons.
_STRONG = 3.0
_MILD = 1.0


def event_study_markets() -> list[MarketInstruments]:
    out: list[MarketInstruments] = []
    for country in EVENT_STUDY_COUNTRIES:
        instruments = MARKET_MAP.get(country)
        if instruments:
            out.append(instruments)
    return out


def _trading_day_offsets(index: pd.DatetimeIndex, event_ts: pd.Timestamp) -> list[int]:
    pre_n = int((index < event_ts).sum())
    offsets: list[int] = []
    pre_i = 0
    post_i = 0
    for ts in index:
        if ts < event_ts:
            offsets.append(pre_i - pre_n)
            pre_i += 1
        else:
            offsets.append(post_i)
            post_i += 1
    return offsets


def _fetch_index_window(symbol: str, event_date: date) -> pd.DataFrame:
    start = event_date - timedelta(days=WINDOW_PRE_DAYS + 25)
    end = event_date + timedelta(days=WINDOW_POST_DAYS + 25)
    frame = _fetch_yahoo_chart(symbol, start, end)
    if frame.empty or "close" not in frame.columns:
        return pd.DataFrame()
    frame = frame.copy()
    frame.index = pd.to_datetime(frame.index).tz_localize(None)
    frame = frame.sort_index()
    frame = frame[~frame.index.duplicated(keep="last")]
    return frame[["close"]].dropna()


def align_series_to_event(close: pd.Series, event_date: date) -> pd.DataFrame | None:
    """Rebase closes so first trading day on/after event_date is t=0 at 0% return."""
    if close is None or close.empty:
        return None
    event_ts = pd.Timestamp(event_date)
    window_start = event_ts - pd.Timedelta(days=WINDOW_PRE_DAYS)
    window_end = event_ts + pd.Timedelta(days=WINDOW_POST_DAYS)
    series = close[(close.index >= window_start) & (close.index <= window_end)].dropna()
    if series.empty:
        return None

    on_or_after = series[series.index >= event_ts]
    if on_or_after.empty:
        return None
    base_ts = on_or_after.index[0]
    base_px = float(on_or_after.iloc[0])
    if not np.isfinite(base_px) or base_px <= 0:
        return None

    event = pd.DataFrame({"close": series})
    event["trading_day_offset"] = _trading_day_offsets(event.index, base_ts)
    event["rebased_return_pct"] = (event["close"] / base_px - 1.0) * 100.0
    event["event_date"] = event_date.isoformat()
    event["t0_date"] = base_ts.date().isoformat()
    if len(event) < MIN_POINTS:
        return None
    return event


def return_at_calendar_horizon(frame: pd.DataFrame, days: int) -> float | None:
    """Cumulative rebased return (%) at first session on/after t0 + `days` calendar days."""
    if frame is None or frame.empty or "trading_day_offset" not in frame.columns:
        return None
    t0 = frame[frame["trading_day_offset"] == 0]
    if t0.empty:
        return None
    t0_ts = t0.index[0]
    target = t0_ts + pd.Timedelta(days=days)
    after = frame[frame.index >= target]
    if after.empty:
        return None
    value = float(after["rebased_return_pct"].iloc[0])
    return value if np.isfinite(value) else None


def horizon_returns_for_frame(frame: pd.DataFrame) -> dict[str, float | None]:
    return {f"d{d}": return_at_calendar_horizon(frame, d) for d in HORIZON_DAYS}


def build_event_country_panel(event_date: date) -> dict[str, Any]:
    """For one event date, align all study-country indices."""
    series_list: list[dict[str, Any]] = []
    errors: list[str] = []
    for market in event_study_markets():
        try:
            hist = _fetch_index_window(market.index_symbol, event_date)
            if hist.empty:
                errors.append(f"{market.country} ({market.index_symbol}): no history")
                continue
            aligned = align_series_to_event(hist["close"], event_date)
            if aligned is None:
                errors.append(f"{market.country} ({market.index_symbol}): align failed")
                continue
            horizons = horizon_returns_for_frame(aligned)
            series_list.append(
                {
                    "country": market.country,
                    "country_ko": COUNTRY_LABEL_KO.get(market.country, market.country),
                    "symbol": market.index_symbol,
                    "name": market.index_name,
                    "frame": aligned,
                    "horizons": horizons,
                }
            )
        except Exception as exc:
            errors.append(f"{market.country} ({market.index_symbol}): {exc}")
    return {
        "event_date": event_date,
        "event_date_str": event_date.isoformat(),
        "series": series_list,
        "errors": errors,
    }


def average_paths_across_events(panels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Average rebased return path per country across successful event panels."""
    by_country: dict[str, list[pd.DataFrame]] = {}
    meta: dict[str, dict[str, str]] = {}
    for panel in panels:
        for item in panel.get("series") or []:
            country = item["country"]
            frame = item["frame"]
            by_country.setdefault(country, []).append(frame)
            meta[country] = {
                "symbol": item["symbol"],
                "name": item["name"],
                "country_ko": item.get("country_ko")
                or COUNTRY_LABEL_KO.get(country, country),
            }

    out: list[dict[str, Any]] = []
    for country, frames in by_country.items():
        pieces = []
        for frame in frames:
            piece = (
                frame[["trading_day_offset", "rebased_return_pct"]]
                .drop_duplicates(subset=["trading_day_offset"])
                .set_index("trading_day_offset")["rebased_return_pct"]
            )
            pieces.append(piece)
        if not pieces:
            continue
        merged = pd.concat(pieces, axis=1)
        mean = merged.mean(axis=1, skipna=True).dropna()
        if mean.empty:
            continue
        avg_frame = pd.DataFrame(
            {
                "trading_day_offset": mean.index.astype(int),
                "rebased_return_pct": mean.values,
            }
        ).sort_values("trading_day_offset")
        # Average horizon returns across events (skip missing)
        horizon_lists: dict[str, list[float]] = {f"d{d}": [] for d in HORIZON_DAYS}
        for frame in frames:
            for d in HORIZON_DAYS:
                val = return_at_calendar_horizon(frame, d)
                if val is not None:
                    horizon_lists[f"d{d}"].append(val)
        avg_horizons = {
            key: (float(np.mean(vals)) if vals else None)
            for key, vals in horizon_lists.items()
        }
        out.append(
            {
                "country": country,
                "country_ko": meta[country]["country_ko"],
                "symbol": meta[country]["symbol"],
                "name": meta[country]["name"],
                "n_events": int(merged.shape[1]),
                "frame": avg_frame,
                "horizons": avg_horizons,
                "horizon_counts": {k: len(v) for k, v in horizon_lists.items()},
            }
        )
    # Stable order
    order = {c: i for i, c in enumerate(EVENT_STUDY_COUNTRIES)}
    out.sort(key=lambda x: order.get(x["country"], 99))
    return out


def classify_impact(horizons: dict[str, float | None]) -> dict[str, Any]:
    """Rule-based impact label from mean 30/60/90d cumulative returns."""
    vals = [horizons.get(f"d{d}") for d in HORIZON_DAYS]
    present = [v for v in vals if v is not None and np.isfinite(v)]
    if not present:
        return {
            "label": "데이터 부족",
            "label_en": "insufficient",
            "tone": "muted",
            "mean_pct": None,
            "summary_ko": "해당 국가의 사후 수익률 데이터가 부족해 영향을 판정할 수 없습니다.",
        }

    mean_pct = float(np.mean(present))
    # Consistency: share of horizons with same sign as mean
    if abs(mean_pct) < _MILD:
        label, label_en, tone = "중립", "neutral", "neutral"
        summary = (
            f"이벤트 이후 평균 누적수익률이 약 {mean_pct:+.1f}%로, "
            "지수에 뚜렷한 방향성 충격은 제한적이었던 것으로 보입니다."
        )
    elif mean_pct <= -_STRONG:
        label, label_en, tone = "부정", "negative", "negative"
        summary = (
            f"이벤트 이후 평균 누적수익률이 약 {mean_pct:+.1f}%로, "
            "주가지수에 부정적인 영향이 있었던 것으로 판단됩니다."
        )
    elif mean_pct <= -_MILD:
        label, label_en, tone = "약소 부정", "mild_negative", "negative"
        summary = (
            f"이벤트 이후 평균 누적수익률이 약 {mean_pct:+.1f}%로, "
            "완만한 하방 압력이 있었던 것으로 보입니다."
        )
    elif mean_pct >= _STRONG:
        label, label_en, tone = "긍정", "positive", "positive"
        summary = (
            f"이벤트 이후 평균 누적수익률이 약 {mean_pct:+.1f}%로, "
            "주가지수에 긍정적인(또는 상대적으로 견조한) 흐름이 나타난 것으로 판단됩니다."
        )
    else:
        label, label_en, tone = "약소 긍정", "mild_positive", "positive"
        summary = (
            f"이벤트 이후 평균 누적수익률이 약 {mean_pct:+.1f}%로, "
            "완만한 상방 흐름이 있었던 것으로 보입니다."
        )

    bits = []
    for d in HORIZON_DAYS:
        v = horizons.get(f"d{d}")
        bits.append(f"{d}일 {v:+.1f}%" if v is not None else f"{d}일 n/a")
    summary = f"{summary} ({', '.join(bits)})"

    return {
        "label": label,
        "label_en": label_en,
        "tone": tone,
        "mean_pct": mean_pct,
        "summary_ko": summary,
    }


def build_impact_comments(averages: list[dict[str, Any]], *, query: str) -> dict[str, Any]:
    countries: list[dict[str, Any]] = []
    for item in averages:
        impact = classify_impact(item.get("horizons") or {})
        countries.append(
            {
                "country": item["country"],
                "country_ko": item.get("country_ko")
                or COUNTRY_LABEL_KO.get(item["country"], item["country"]),
                "symbol": item.get("symbol"),
                "n_events": item.get("n_events"),
                "horizons": item.get("horizons") or {},
                "impact": impact,
            }
        )

    lines = [
        f"「{query}」 유사 사건들을 t=0으로 정렬해 "
        f"미국·일본·한국·중국 지수의 사후 30/60/90일 평균 누적수익률을 비교했습니다."
    ]
    for row in countries:
        imp = row["impact"]
        lines.append(
            f"· {row['country_ko']}: [{imp['label']}] {imp['summary_ko']}"
        )
    if not countries:
        lines.append("비교 가능한 국가 지수 시계열이 없습니다.")

    return {
        "query": query,
        "countries": countries,
        "narrative_ko": "\n".join(lines),
    }


def run_event_study(events: list[dict[str, Any]], *, query: str = "") -> dict[str, Any]:
    """events items need date (date) or date_str / _date."""
    panels: list[dict[str, Any]] = []
    for item in events:
        d = item.get("_date") or item.get("date")
        if isinstance(d, str):
            d = date.fromisoformat(d[:10])
        if not isinstance(d, date):
            continue
        panel = build_event_country_panel(d)
        panel["title"] = item.get("title") or ""
        panel["note"] = item.get("note") or ""
        panels.append(panel)

    usable = [p for p in panels if p.get("series")]
    averages = average_paths_across_events(usable) if usable else []
    impact = build_impact_comments(averages, query=query or "")
    return {
        "panels": panels,
        "averages": averages,
        "impact": impact,
        "window_pre_days": WINDOW_PRE_DAYS,
        "window_post_days": WINDOW_POST_DAYS,
        "window_days": WINDOW_DAYS,
        "horizon_days": list(HORIZON_DAYS),
        "countries": list(EVENT_STUDY_COUNTRIES),
    }

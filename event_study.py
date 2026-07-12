"""Build event-study return series for country indices around event dates."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from adr_providers import _fetch_yahoo_chart
from idx_data import MARKET_MAP, MarketInstruments

# Representative markets used for /event (subset of /idx MARKET_MAP).
EVENT_STUDY_COUNTRIES: tuple[str, ...] = (
    "United States",
    "Japan",
    "United Kingdom",
    "Germany",
    "South Korea",
    "China",
    "Taiwan",
    "India",
    "Hong Kong",
    "Brazil",
)

WINDOW_DAYS = 60  # calendar days before/after t=0
MIN_POINTS = 5


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
    start = event_date - timedelta(days=WINDOW_DAYS + 20)
    end = event_date + timedelta(days=WINDOW_DAYS + 20)
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
    window_start = event_ts - pd.Timedelta(days=WINDOW_DAYS)
    window_end = event_ts + pd.Timedelta(days=WINDOW_DAYS)
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
            series_list.append(
                {
                    "country": market.country,
                    "symbol": market.index_symbol,
                    "name": market.index_name,
                    "frame": aligned,
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
            meta[country] = {"symbol": item["symbol"], "name": item["name"]}

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
        out.append(
            {
                "country": country,
                "symbol": meta[country]["symbol"],
                "name": meta[country]["name"],
                "n_events": int(merged.shape[1]),
                "frame": avg_frame,
            }
        )
    return out


def run_event_study(events: list[dict[str, Any]]) -> dict[str, Any]:
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
    return {
        "panels": panels,
        "averages": averages,
        "window_days": WINDOW_DAYS,
        "countries": list(EVENT_STUDY_COUNTRIES),
    }

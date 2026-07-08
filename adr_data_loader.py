"""Load underlying share price/volume around ADR US listing."""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import yfinance as yf

from adr_mapping import AdrProfile, get_listing_date

WINDOW_YEARS = 2
EVENT_BUFFER_DAYS = 5
MIN_TRADING_DAYS = 40


def _calendar_window(listing: date) -> tuple[date, date]:
    start = listing - timedelta(days=WINDOW_YEARS * 365)
    end = listing + timedelta(days=WINDOW_YEARS * 365)
    return start, end


def _fetch_history(symbol: str, fallback_symbol: str) -> pd.DataFrame:
    df = yf.Ticker(symbol).history(period="max", auto_adjust=True)
    if not df.empty:
        return df
    if fallback_symbol and fallback_symbol != symbol:
        return yf.Ticker(fallback_symbol).history(period="max", auto_adjust=True)
    return df


def _prepare_df(df: pd.DataFrame) -> pd.DataFrame:
    out = df[["Close", "Volume"]].copy()
    out.index = pd.to_datetime(out.index).tz_localize(None)
    out = out.rename(columns={"Close": "close", "Volume": "volume"})
    out["daily_return"] = out["close"].pct_change()
    return out


def load_underlying_window(
    profile: AdrProfile,
    listing_date: date | None = None,
) -> dict:
    if listing_date is None:
        listing_date, listing_source = get_listing_date(profile)
    else:
        listing_source = profile.listing_source

    us_adr_listing_date = listing_date
    us_adr_listing_source = listing_source

    target_start, target_end = _calendar_window(listing_date)

    raw = _fetch_history(profile.underlying_symbol, profile.adr_symbol)
    if raw.empty:
        raise ValueError(
            f"No underlying data for {profile.underlying_symbol} ({profile.home_exchange})"
        )

    df = _prepare_df(raw)
    data_start = df.index.min().date()
    data_end = df.index.max().date()

    # Use as much of the ±2y window as Yahoo provides
    start = max(target_start, data_start)
    end = min(target_end, data_end)
    listing_ts = pd.Timestamp(listing_date)

    # If the ADR listing is older than Yahoo underlying history, align the event date.
    if listing_ts < df.index.min() or listing_ts > df.index.max():
        earliest_post_end = df.index.min() + pd.Timedelta(days=WINDOW_YEARS * 365)
        if earliest_post_end > df.index.max():
            raise ValueError(
                f"Not enough underlying history for {profile.underlying_symbol} "
                f"(listing {listing_date}, data {data_start}–{data_end})"
            )
        listing_ts = df.index.min() + pd.Timedelta(days=30)
        listing_date = listing_ts.date()
        listing_source = f"{listing_source}+aligned_to_underlying_data"
        target_start, target_end = _calendar_window(listing_date)
        start = max(target_start, data_start)
        end = min(target_end, data_end)

    pre = df[df.index < listing_ts - pd.Timedelta(days=EVENT_BUFFER_DAYS)].copy()
    post = df[df.index > listing_ts + pd.Timedelta(days=EVENT_BUFFER_DAYS)].copy()
    pre = pre[pre.index >= pd.Timestamp(start)]
    post = post[post.index <= pd.Timestamp(end)]

    coverage_note = ""
    if listing_ts < pd.Timestamp(data_start) + pd.Timedelta(days=60):
        coverage_note = (
            "US ADR listing predates underlying Yahoo history; "
            "event date aligned to start of underlying data."
        )

    if len(pre) < MIN_TRADING_DAYS and len(post) >= MIN_TRADING_DAYS:
        coverage_note = (
            (coverage_note + " " if coverage_note else "")
            + "Pre-listing window limited; post-listing analysis only."
        )
    elif len(pre) < MIN_TRADING_DAYS:
        raise ValueError(
            f"Insufficient pre-listing data for {profile.underlying_symbol}: "
            f"{len(pre)} trading days (need {MIN_TRADING_DAYS})."
        )

    if len(post) < MIN_TRADING_DAYS:
        raise ValueError(
            f"Insufficient post-listing data for {profile.underlying_symbol}: "
            f"{len(post)} trading days (need {MIN_TRADING_DAYS})."
        )

    event = df[(df.index >= pd.Timestamp(start)) & (df.index <= pd.Timestamp(end))].copy()
    event["days_from_listing"] = (event.index - listing_ts).days

    pre_n = int((event.index < listing_ts).sum())
    offsets: list[int] = []
    pre_i = 0
    post_i = 0
    for ts in event.index:
        if ts < listing_ts:
            offsets.append(pre_i - pre_n)
            pre_i += 1
        else:
            offsets.append(post_i)
            post_i += 1
    event["trading_day_offset"] = offsets
    event["phase"] = event["days_from_listing"].apply(
        lambda d: "pre"
        if d < -EVENT_BUFFER_DAYS
        else ("post" if d > EVENT_BUFFER_DAYS else "event")
    )

    pre_target_days = (listing_date - target_start).days
    pre_actual_days = (listing_date - start).days
    if start > target_start:
        coverage_note = (
            (coverage_note + " " if coverage_note else "")
            + f"Pre-window clipped: requested {pre_target_days}d, "
            f"available {pre_actual_days}d (data from {data_start})."
        )

    return {
        "profile": profile,
        "listing_date": listing_date,
        "listing_source": listing_source,
        "us_adr_listing_date": us_adr_listing_date,
        "us_adr_listing_source": us_adr_listing_source,
        "full": event,
        "pre": pre,
        "post": post,
        "window_start": start,
        "window_end": end,
        "target_window_start": target_start,
        "target_window_end": target_end,
        "data_start": data_start,
        "data_end": data_end,
        "coverage_note": coverage_note,
    }


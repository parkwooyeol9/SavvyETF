"""Climate Risk Monitor data — USGS earthquakes + Open-Meteo Europe weather.

No API keys required. Used by /esg monitor.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")
UTC = ZoneInfo("UTC")

USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"

# European city panel for extreme-weather / anomaly board
EUROPE_CITIES: list[dict[str, Any]] = [
    {"id": "london", "name": "London", "lat": 51.51, "lon": -0.13, "tz": "Europe/London"},
    {"id": "paris", "name": "Paris", "lat": 48.86, "lon": 2.35, "tz": "Europe/Paris"},
    {"id": "berlin", "name": "Berlin", "lat": 52.52, "lon": 13.41, "tz": "Europe/Berlin"},
    {"id": "madrid", "name": "Madrid", "lat": 40.42, "lon": -3.70, "tz": "Europe/Madrid"},
    {"id": "rome", "name": "Rome", "lat": 41.90, "lon": 12.50, "tz": "Europe/Rome"},
    {"id": "amsterdam", "name": "Amsterdam", "lat": 52.37, "lon": 4.90, "tz": "Europe/Amsterdam"},
    {"id": "vienna", "name": "Vienna", "lat": 48.21, "lon": 16.37, "tz": "Europe/Vienna"},
    {"id": "warsaw", "name": "Warsaw", "lat": 52.23, "lon": 21.01, "tz": "Europe/Warsaw"},
    {"id": "athens", "name": "Athens", "lat": 37.98, "lon": 23.73, "tz": "Europe/Athens"},
    {"id": "stockholm", "name": "Stockholm", "lat": 59.33, "lon": 18.07, "tz": "Europe/Stockholm"},
]

# Rough Europe bounding box for regional quake highlight
EUROPE_BBOX = {"min_lat": 34.0, "max_lat": 72.0, "min_lon": -25.0, "max_lon": 45.0}

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "SavvyETF-ClimateMonitor/1.0"})


def _get_json(url: str, params: dict[str, Any] | None = None, timeout: int = 45) -> dict[str, Any]:
    response = SESSION.get(url, params=params or {}, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected JSON from {url}")
    return payload


def _in_europe(lat: float, lon: float) -> bool:
    return (
        EUROPE_BBOX["min_lat"] <= lat <= EUROPE_BBOX["max_lat"]
        and EUROPE_BBOX["min_lon"] <= lon <= EUROPE_BBOX["max_lon"]
    )


def fetch_earthquakes(
    *,
    days: int = 7,
    min_magnitude: float = 4.5,
    limit: int = 80,
) -> dict[str, Any]:
    """Fetch recent earthquakes from USGS FDSN GeoJSON (no API key)."""
    end = datetime.now(UTC)
    start = end - timedelta(days=days)
    payload = _get_json(
        USGS_URL,
        {
            "format": "geojson",
            "starttime": start.strftime("%Y-%m-%dT%H:%M:%S"),
            "endtime": end.strftime("%Y-%m-%dT%H:%M:%S"),
            "minmagnitude": min_magnitude,
            "orderby": "time",
            "limit": limit,
        },
    )
    events: list[dict[str, Any]] = []
    for feature in payload.get("features") or []:
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or [None, None, None]
        lon, lat, depth = (coords + [None, None, None])[:3]
        try:
            mag = float(props.get("mag")) if props.get("mag") is not None else None
        except (TypeError, ValueError):
            mag = None
        if mag is None or lat is None or lon is None:
            continue
        ts_ms = props.get("time")
        when = (
            datetime.fromtimestamp(ts_ms / 1000, tz=UTC).astimezone(KST)
            if isinstance(ts_ms, (int, float))
            else None
        )
        event = {
            "id": feature.get("id") or props.get("code"),
            "mag": mag,
            "place": props.get("place") or "Unknown",
            "lat": float(lat),
            "lon": float(lon),
            "depth_km": float(depth) if depth is not None else None,
            "time_utc": (
                datetime.fromtimestamp(ts_ms / 1000, tz=UTC).isoformat()
                if isinstance(ts_ms, (int, float))
                else None
            ),
            "time_kst": when.strftime("%Y-%m-%d %H:%M KST") if when else None,
            "url": props.get("url"),
            "tsunami": int(props.get("tsunami") or 0),
            "in_europe": _in_europe(float(lat), float(lon)),
        }
        events.append(event)

    events.sort(key=lambda e: e["mag"], reverse=True)
    europe = [e for e in events if e["in_europe"]]
    significant = [e for e in events if e["mag"] >= 6.0]
    return {
        "days": days,
        "min_magnitude": min_magnitude,
        "count": len(events),
        "europe_count": len(europe),
        "significant_count": len(significant),
        "max_mag": events[0]["mag"] if events else None,
        "events": events,
        "europe": europe,
        "significant": significant,
        "source": "USGS Earthquake Hazards Program (FDSN GeoJSON)",
        "source_url": "https://earthquake.usgs.gov/",
    }


def _mean(values: list[float | None]) -> float | None:
    nums = [float(v) for v in values if v is not None]
    if not nums:
        return None
    return sum(nums) / len(nums)


def _fetch_city_archive(
    city: dict[str, Any],
    start: date,
    end: date,
) -> dict[str, Any]:
    payload = _get_json(
        OPEN_METEO_ARCHIVE,
        {
            "latitude": city["lat"],
            "longitude": city["lon"],
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "daily": "temperature_2m_mean,temperature_2m_max,precipitation_sum",
            "timezone": city["tz"],
        },
    )
    daily = payload.get("daily") or {}
    return {
        "city": city,
        "dates": list(daily.get("time") or []),
        "t_mean": list(daily.get("temperature_2m_mean") or []),
        "t_max": list(daily.get("temperature_2m_max") or []),
        "precip": list(daily.get("precipitation_sum") or []),
    }


def _fetch_city_forecast(city: dict[str, Any], past_days: int = 7) -> dict[str, Any]:
    """Recent observed temps via forecast API past_days (more reliable near real-time)."""
    payload = _get_json(
        OPEN_METEO_FORECAST,
        {
            "latitude": city["lat"],
            "longitude": city["lon"],
            "past_days": past_days,
            "forecast_days": 1,
            "daily": "temperature_2m_mean,temperature_2m_max,precipitation_sum",
            "timezone": city["tz"],
        },
    )
    daily = payload.get("daily") or {}
    return {
        "city": city,
        "dates": list(daily.get("time") or []),
        "t_mean": list(daily.get("temperature_2m_mean") or []),
        "t_max": list(daily.get("temperature_2m_max") or []),
        "precip": list(daily.get("precipitation_sum") or []),
    }


def fetch_europe_weather(*, recent_days: int = 7, baseline_years: int = 5) -> dict[str, Any]:
    """Europe city board: recent temps + anomaly vs same calendar window (N-year mean)."""
    today = datetime.now(KST).date()
    # Exclude today (partial) — use through yesterday
    end = today - timedelta(days=1)
    start = end - timedelta(days=recent_days - 1)

    cities_out: list[dict[str, Any]] = []
    errors: list[str] = []

    def process_city(city: dict[str, Any]) -> dict[str, Any]:
        recent = _fetch_city_forecast(city, past_days=recent_days + 1)
        # Align to [start, end]
        recent_pairs = [
            (d, tm, tx, p)
            for d, tm, tx, p in zip(
                recent["dates"], recent["t_mean"], recent["t_max"], recent["precip"]
            )
            if start.isoformat() <= d <= end.isoformat()
        ]
        recent_mean = _mean([tm for _, tm, _, _ in recent_pairs])
        recent_max = max((tx for _, _, tx, _ in recent_pairs if tx is not None), default=None)
        recent_precip = sum(p for _, _, _, p in recent_pairs if p is not None)

        # Baseline: same calendar window over previous N years
        baseline_means: list[float] = []
        for year_offset in range(1, baseline_years + 1):
            try:
                b_end = end.replace(year=end.year - year_offset)
                b_start = start.replace(year=start.year - year_offset)
            except ValueError:
                # Feb 29 edge
                b_end = end - timedelta(days=365 * year_offset)
                b_start = start - timedelta(days=365 * year_offset)
            hist = _fetch_city_archive(city, b_start, b_end)
            m = _mean(hist["t_mean"])
            if m is not None:
                baseline_means.append(m)

        baseline = _mean(baseline_means) if baseline_means else None
        anomaly = (
            round(recent_mean - baseline, 2)
            if recent_mean is not None and baseline is not None
            else None
        )
        hot_days = sum(1 for _, _, tx, _ in recent_pairs if tx is not None and tx >= 32)
        cold_days = sum(1 for _, _, tx, _ in recent_pairs if tx is not None and tx <= 0)

        flags: list[str] = []
        if anomaly is not None and anomaly >= 3.0:
            flags.append("heat_anomaly")
        if anomaly is not None and anomaly <= -3.0:
            flags.append("cold_anomaly")
        if recent_max is not None and recent_max >= 35:
            flags.append("extreme_heat")
        if hot_days >= 3:
            flags.append("heatwave_risk")
        if cold_days >= 3:
            flags.append("cold_spell")
        if recent_precip >= 40:
            flags.append("heavy_rain")

        return {
            "id": city["id"],
            "name": city["name"],
            "lat": city["lat"],
            "lon": city["lon"],
            "recent_mean_c": round(recent_mean, 2) if recent_mean is not None else None,
            "recent_max_c": round(recent_max, 2) if recent_max is not None else None,
            "recent_precip_mm": round(recent_precip, 1),
            "baseline_mean_c": round(baseline, 2) if baseline is not None else None,
            "anomaly_c": anomaly,
            "hot_days_ge32": hot_days,
            "cold_days_le0": cold_days,
            "flags": flags,
            "series": [
                {
                    "date": d,
                    "t_mean": tm,
                    "t_max": tx,
                    "precip": p,
                }
                for d, tm, tx, p in recent_pairs
            ],
        }

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(process_city, city): city["id"] for city in EUROPE_CITIES}
        for fut in as_completed(futures):
            city_id = futures[fut]
            try:
                cities_out.append(fut.result())
            except Exception as exc:
                errors.append(f"{city_id}: {exc}")

    cities_out.sort(key=lambda row: abs(row.get("anomaly_c") or 0), reverse=True)
    flagged = [c for c in cities_out if c.get("flags")]
    return {
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "recent_days": recent_days,
        "baseline_years": baseline_years,
        "cities": cities_out,
        "flagged_count": len(flagged),
        "flagged": flagged,
        "errors": errors,
        "source": "Open-Meteo (forecast past_days + archive climatology)",
        "source_url": "https://open-meteo.com/",
    }


def _climate_score(quakes: dict[str, Any], europe: dict[str, Any]) -> dict[str, Any]:
    """Simple 0–100 climate-risk score for the dashboard gauge."""
    score = 15
    drivers: list[str] = []

    max_mag = quakes.get("max_mag")
    if max_mag is not None:
        if max_mag >= 7.0:
            score += 35
            drivers.append(f"M{max_mag:.1f} 강진")
        elif max_mag >= 6.0:
            score += 22
            drivers.append(f"M{max_mag:.1f} 유감지진")
        elif max_mag >= 5.0:
            score += 10
            drivers.append(f"M{max_mag:.1f} 지진")

    eu_quakes = quakes.get("europe_count") or 0
    if eu_quakes >= 3:
        score += 15
        drivers.append(f"유럽 지진 {eu_quakes}건")
    elif eu_quakes >= 1:
        score += 8
        drivers.append(f"유럽 지진 {eu_quakes}건")

    flagged = europe.get("flagged_count") or 0
    if flagged >= 5:
        score += 30
        drivers.append(f"유럽 이상기후 {flagged}도시")
    elif flagged >= 2:
        score += 18
        drivers.append(f"유럽 이상기후 {flagged}도시")
    elif flagged >= 1:
        score += 10
        drivers.append(f"유럽 이상기후 {flagged}도시")

    heat_flags = sum(
        1
        for c in europe.get("cities") or []
        if "extreme_heat" in (c.get("flags") or []) or "heatwave_risk" in (c.get("flags") or [])
    )
    if heat_flags >= 3:
        score += 12
        drivers.append("다수 도시 폭염")

    score = max(0, min(100, int(score)))
    if score >= 70:
        level = "HIGH"
        label = "경계"
    elif score >= 45:
        level = "ELEVATED"
        label = "주의"
    elif score >= 25:
        level = "WATCH"
        label = "관심"
    else:
        level = "CALM"
        label = "평온"
    return {"score": score, "level": level, "label": label, "drivers": drivers[:5]}


def build_climate_monitor_bundle(
    *,
    quake_days: int = 7,
    min_magnitude: float = 4.5,
    weather_days: int = 7,
) -> dict[str, Any]:
    """Fetch all climate monitor datasets and compute risk score."""
    generated_at = datetime.now(KST)
    errors: list[str] = []
    quakes: dict[str, Any] = {}
    europe: dict[str, Any] = {}

    with ThreadPoolExecutor(max_workers=2) as pool:
        fut_q = pool.submit(fetch_earthquakes, days=quake_days, min_magnitude=min_magnitude)
        fut_e = pool.submit(fetch_europe_weather, recent_days=weather_days)
        try:
            quakes = fut_q.result()
        except Exception as exc:
            errors.append(f"earthquakes: {exc}")
            quakes = {
                "days": quake_days,
                "count": 0,
                "europe_count": 0,
                "significant_count": 0,
                "max_mag": None,
                "events": [],
                "europe": [],
                "significant": [],
                "source": "USGS",
                "error": str(exc),
            }
        try:
            europe = fut_e.result()
        except Exception as exc:
            errors.append(f"europe_weather: {exc}")
            europe = {
                "cities": [],
                "flagged": [],
                "flagged_count": 0,
                "errors": [str(exc)],
                "source": "Open-Meteo",
            }

    risk = _climate_score(quakes, europe)
    return {
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "earthquakes": quakes,
        "europe_weather": europe,
        "risk": risk,
        "errors": errors + list(europe.get("errors") or []),
        "apis": {
            "earthquakes": "USGS FDSN Event API (no key)",
            "europe_weather": "Open-Meteo forecast + archive (no key)",
        },
    }

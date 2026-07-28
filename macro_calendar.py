"""Economic calendar fetchers: Finnhub → Investing.com → Forex Factory public JSON."""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from lxml import html as lxml_html

KST = ZoneInfo("Asia/Seoul")
PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
FF_CACHE_PATH = DATA_DIR / "ff_calendar_cache.json"
FF_CACHE_TTL_SECONDS = 3600

INVESTING_CALENDAR_URL = (
    "https://www.investing.com/economic-calendar/Service/getCalendarFilteredData"
)
FF_CALENDAR_URLS = (
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
)

# Investing.com country ids (subset)
_INVESTING_COUNTRY_IDS = {
    "US": "5",
    "EU": "72",  # Euro Zone
    "GB": "4",
    "JP": "35",
    "CN": "37",
}


def _impact_rank(impact: str) -> int:
    mapping = {"high": 3, "medium": 2, "low": 1}
    return mapping.get(str(impact).lower(), 0)


def _normalize_country(value: str) -> str:
    raw = str(value or "").strip().upper()
    if raw in {"US", "USA", "UNITED STATES"}:
        return "US"
    if raw in {"USD"}:
        return "US"
    if raw in {"EU", "EUR", "EURO ZONE", "EUROZONE"}:
        return "EU"
    if raw in {"GB", "UK", "GBP", "UNITED KINGDOM"}:
        return "GB"
    if raw in {"JP", "JPY", "JAPAN"}:
        return "JP"
    if raw in {"CN", "CNY", "CHINA"}:
        return "CN"
    return raw


def _normalize_impact(value: str | int | None) -> str:
    if value is None:
        return "low"
    if isinstance(value, int):
        return {3: "high", 2: "medium", 1: "low"}.get(value, "low")
    text = str(value).strip().lower()
    if text in {"high", "3", "red"}:
        return "high"
    if text in {"medium", "med", "2", "orange", "moderate"}:
        return "medium"
    return "low"


def _cell_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text in {"", "-", "—", "n/a", "N/A"}:
        return None
    return text


def fetch_investing_economic_calendar(
    days_back: int = 2,
    days_forward: int = 7,
) -> list[dict[str, Any]]:
    """Best-effort Investing.com calendar (often Cloudflare-blocked from cloud IPs)."""
    start = datetime.now(KST).date() - timedelta(days=days_back)
    end = datetime.now(KST).date() + timedelta(days=days_forward)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Origin": "https://www.investing.com",
        "Referer": "https://www.investing.com/economic-calendar/",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    payload: list[tuple[str, str]] = [
        ("dateFrom", start.isoformat()),
        ("dateTo", end.isoformat()),
        ("timeZone", "55"),  # Seoul
        ("timeFilter", "timeOnly"),
        ("currentTab", "custom"),
        ("submitFilters", "1"),
        ("limit_from", "0"),
        ("country[]", _INVESTING_COUNTRY_IDS["US"]),
        ("importance[]", "3"),
    ]
    response = requests.post(
        INVESTING_CALENDAR_URL,
        data=payload,
        headers=headers,
        timeout=25,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Investing.com calendar HTTP {response.status_code}")
    try:
        payload_json = response.json()
    except Exception as exc:
        raise RuntimeError(f"Investing.com calendar JSON error: {exc}") from exc
    html_blob = payload_json.get("data") or ""
    if not html_blob:
        raise RuntimeError("Investing.com calendar empty payload")

    tree = lxml_html.fromstring(html_blob)
    rows = tree.xpath('//tr[contains(@class,"js-event-item")]')
    events: list[dict[str, Any]] = []
    for row in rows:
        dt_raw = row.get("data-event-datetime") or ""
        # e.g. 2026/07/29 08:30:00
        date_part = ""
        time_part = ""
        if dt_raw:
            cleaned = dt_raw.replace("/", "-")
            bits = cleaned.split(" ")
            date_part = bits[0][:10] if bits else ""
            if len(bits) > 1:
                time_part = bits[1][:5]
        event_name = " ".join(
            t.strip()
            for t in row.xpath('.//td[contains(@class,"event")]//text()')
            if t and t.strip()
        )
        if not event_name:
            continue
        bull_count = len(
            row.xpath(
                './/td[contains(@class,"sentiment")]'
                '//i[contains(@class,"grayFullBullishIcon")]'
            )
        )
        impact = {3: "high", 2: "medium"}.get(bull_count, "low")
        actual = _cell_text(
            " ".join(row.xpath('.//td[contains(@class,"act")]//text()'))
        )
        estimate = _cell_text(
            " ".join(row.xpath('.//td[contains(@class,"fore")]//text()'))
        )
        prev = _cell_text(
            " ".join(row.xpath('.//td[contains(@class,"prev")]//text()'))
        )
        events.append(
            {
                "date": date_part,
                "time": time_part,
                "country": "US",
                "event": event_name,
                "impact": impact,
                "actual": actual,
                "estimate": estimate,
                "prev": prev,
                "unit": "",
                "source": "investing",
            }
        )
    if not events:
        raise RuntimeError("Investing.com calendar parsed 0 events")
    return events


def _load_ff_cache() -> list[dict[str, Any]] | None:
    if not FF_CACHE_PATH.exists():
        return None
    try:
        payload = json.loads(FF_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    if time.time() - float(payload.get("loaded_at", 0)) > FF_CACHE_TTL_SECONDS:
        return None
    rows = payload.get("events")
    return rows if isinstance(rows, list) else None


def _save_ff_cache(events: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FF_CACHE_PATH.write_text(
        json.dumps(
            {"loaded_at": time.time(), "events": events},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def fetch_ff_economic_calendar() -> list[dict[str, Any]]:
    """Forex Factory weekly JSON via nfs.faireconomy.media (public export)."""
    cached = _load_ff_cache()
    if cached is not None:
        return cached

    headers = {
        "User-Agent": "SavvyETF/1.0 (+https://github.com/parkwooyeol9/SavvyETF)",
        "Accept": "application/json",
    }
    raw_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    for url in FF_CALENDAR_URLS:
        try:
            response = requests.get(url, headers=headers, timeout=25)
            if response.status_code == 429 or "rate limited" in response.text.lower():
                errors.append("FF calendar rate-limited (hourly export)")
                continue
            response.raise_for_status()
            try:
                payload = response.json()
            except Exception:
                errors.append("FF calendar non-JSON response")
                continue
            if isinstance(payload, list):
                raw_rows.extend(payload)
        except Exception as exc:
            errors.append(f"{url}: {exc}")

    if not raw_rows:
        if cached is None and FF_CACHE_PATH.exists():
            # Stale cache better than empty when rate-limited
            try:
                payload = json.loads(FF_CACHE_PATH.read_text(encoding="utf-8"))
                rows = payload.get("events")
                if isinstance(rows, list) and rows:
                    return rows
            except Exception:
                pass
        raise RuntimeError(
            "Forex Factory calendar unavailable: " + "; ".join(errors[:2])
        )

    events: list[dict[str, Any]] = []
    for row in raw_rows:
        country = _normalize_country(str(row.get("country") or ""))
        impact = _normalize_impact(row.get("impact"))
        if country != "US" and impact != "high":
            continue
        date_raw = str(row.get("date") or "")
        # 2026-07-29T08:30:00-04:00
        date_part = ""
        time_part = ""
        try:
            parsed = datetime.fromisoformat(date_raw)
            # Display in KST for the dashboard
            local = parsed.astimezone(KST)
            date_part = local.strftime("%Y-%m-%d")
            time_part = local.strftime("%H:%M")
        except Exception:
            date_part = date_raw[:10]
        events.append(
            {
                "date": date_part,
                "time": time_part,
                "country": country,
                "event": str(row.get("title") or row.get("event") or "").strip(),
                "impact": impact,
                "actual": _cell_text(row.get("actual")),
                "estimate": _cell_text(row.get("forecast")),
                "prev": _cell_text(row.get("previous")),
                "unit": "",
                "source": "forexfactory",
            }
        )

    events = [e for e in events if e.get("event")]
    events.sort(
        key=lambda row: (
            row.get("date", ""),
            -_impact_rank(row.get("impact", "")),
            row.get("time", ""),
        )
    )
    if events:
        _save_ff_cache(events)
    return events


def fetch_economic_calendar(
    *,
    finnhub_fetcher=None,
) -> tuple[list[dict[str, Any]], str | None, list[str]]:
    """
    Return (events, source, errors).
    Order: Finnhub → Investing.com → Forex Factory public JSON.
    """
    errors: list[str] = []

    if finnhub_fetcher is not None:
        try:
            rows = finnhub_fetcher()
            if rows:
                for row in rows:
                    row.setdefault("source", "finnhub")
                    row["country"] = _normalize_country(str(row.get("country") or ""))
                    row["impact"] = _normalize_impact(row.get("impact"))
                return rows, "finnhub", errors
        except Exception as exc:
            msg = str(exc)
            if "token=" in msg.lower() or "403" in msg:
                errors.append("Finnhub calendar unavailable (plan/403)")
            else:
                errors.append(f"Finnhub calendar: {msg[:80]}")

    try:
        rows = fetch_investing_economic_calendar()
        if rows:
            return rows, "investing", errors
    except Exception as exc:
        errors.append(f"Investing.com calendar: {exc}")

    try:
        rows = fetch_ff_economic_calendar()
        if rows:
            return rows, "forexfactory", errors
    except Exception as exc:
        errors.append(f"Forex Factory calendar: {exc}")

    return [], None, errors

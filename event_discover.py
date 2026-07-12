"""Discover historical event dates for /event studies."""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data" / "event_studies"
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
MAX_EVENTS = 5

# Curated fallbacks when Gemini is unavailable.
EVENT_CATALOG: dict[str, list[dict[str, str]]] = {
    "일본 지진": [
        {"date": "2011-03-11", "title": "동일본 대지진 (Tōhoku)", "note": "M9.0 · Fukushima nuclear crisis"},
        {"date": "1995-01-17", "title": "한신·아와지 대지진 (Kobe)", "note": "M6.9"},
        {"date": "2004-10-23", "title": "니가타현 주에쓰 지진", "note": "M6.8"},
        {"date": "2016-04-16", "title": "구마모토 지진", "note": "M7.0 mainshock"},
    ],
    "japan earthquake": [
        {"date": "2011-03-11", "title": "Tōhoku earthquake", "note": "M9.0"},
        {"date": "1995-01-17", "title": "Kobe earthquake", "note": "M6.9"},
        {"date": "2016-04-16", "title": "Kumamoto earthquake", "note": "M7.0"},
    ],
    "리먼": [
        {"date": "2008-09-15", "title": "Lehman Brothers bankruptcy", "note": "Global Financial Crisis"},
        {"date": "2008-03-16", "title": "Bear Stearns rescue", "note": "JPMorgan takeover"},
        {"date": "2008-09-07", "title": "Fannie Mae / Freddie Mac conservatorship", "note": ""},
    ],
    "lehman": [
        {"date": "2008-09-15", "title": "Lehman Brothers bankruptcy", "note": "GFC"},
    ],
    "코로나": [
        {"date": "2020-02-20", "title": "COVID equity crash onset", "note": "Global risk-off"},
        {"date": "2020-03-11", "title": "WHO pandemic declaration", "note": ""},
        {"date": "2020-03-23", "title": "US equity market low (approx)", "note": "Fed/fiscal response phase"},
    ],
    "covid": [
        {"date": "2020-02-20", "title": "COVID crash onset", "note": ""},
        {"date": "2020-03-11", "title": "WHO pandemic declaration", "note": ""},
        {"date": "2020-03-23", "title": "US market low (approx)", "note": ""},
    ],
    "우크라이나": [
        {"date": "2022-02-24", "title": "Russia invasion of Ukraine", "note": "Energy/food shock"},
        {"date": "2014-02-27", "title": "Crimea annexation onset", "note": ""},
    ],
    "ukraine": [
        {"date": "2022-02-24", "title": "Russia invasion of Ukraine", "note": ""},
    ],
    "브렉시트": [
        {"date": "2016-06-23", "title": "Brexit referendum", "note": "Leave win"},
    ],
    "brexit": [
        {"date": "2016-06-23", "title": "Brexit referendum", "note": ""},
    ],
    "실리콘밸리은행": [
        {"date": "2023-03-10", "title": "SVB failure", "note": "US regional bank stress"},
        {"date": "2023-03-19", "title": "UBS–Credit Suisse rescue", "note": ""},
    ],
    "svb": [
        {"date": "2023-03-10", "title": "SVB failure", "note": ""},
    ],
}


def _load_dotenv() -> None:
    load_dotenv(PROJECT_DIR / ".env", override=False)


def _gemini_api_key() -> str:
    _load_dotenv()
    return os.environ.get("GEMINI_API_KEY", "").strip() or os.environ.get("GOOGLE_API_KEY", "").strip()


def _gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL


def _parse_date(value: str) -> date | None:
    text = (value or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _catalog_match(query: str) -> list[dict[str, Any]] | None:
    q = re.sub(r"\s+", "", query.lower())
    for key, events in EVENT_CATALOG.items():
        key_n = re.sub(r"\s+", "", key.lower())
        if key_n in q or q in key_n:
            out = []
            for item in events:
                d = _parse_date(item["date"])
                if not d:
                    continue
                out.append(
                    {
                        "date": d,
                        "date_str": d.isoformat(),
                        "title": item.get("title") or "",
                        "note": item.get("note") or "",
                        "source": "catalog",
                    }
                )
            return out[:MAX_EVENTS] or None
    return None


def _discover_with_gemini(query: str) -> tuple[list[dict[str, Any]], str]:
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    prompt = f"""
You are a financial historian. Given an event keyword, list the most important PAST
historical occurrences that markets would care about (crises, disasters, wars, policy shocks).

Keyword: {query!r}

Return JSON only:
{{
  "events": [
    {{
      "date": "YYYY-MM-DD",
      "title": "short English or Korean title",
      "note": "one-line why it mattered for markets"
    }}
  ],
  "summary_ko": "1-2 Korean sentences describing what you selected"
}}

Rules:
- Prefer major, well-documented market-relevant dates (up to {MAX_EVENTS}).
- Dates must be in the past, not future.
- Prefer equity-market open dates when the event spans multiple days (use the primary shock day).
- If the keyword is vague, pick the best-known analogous episodes.
- No investment advice.
""".strip()

    url = f"{GEMINI_API_ROOT}/{_gemini_model()}:generateContent"
    response = requests.post(
        url,
        params={"key": api_key},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        },
        timeout=90,
    )
    if not response.ok:
        raise RuntimeError(f"Gemini HTTP {response.status_code}: {response.text[:300]}")

    payload = response.json()
    candidates = payload.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned no candidates")
    parts = candidates[0].get("content", {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if part.get("text"))
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    parsed = json.loads(text)
    events_raw = parsed.get("events") or []
    out: list[dict[str, Any]] = []
    today = date.today()
    for item in events_raw:
        if not isinstance(item, dict):
            continue
        d = _parse_date(str(item.get("date") or ""))
        if not d or d >= today:
            continue
        out.append(
            {
                "date": d,
                "date_str": d.isoformat(),
                "title": str(item.get("title") or "").strip(),
                "note": str(item.get("note") or "").strip(),
                "source": "gemini",
            }
        )
    # newest first then keep unique dates
    out.sort(key=lambda e: e["date"], reverse=True)
    dedup: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in out:
        if item["date_str"] in seen:
            continue
        seen.add(item["date_str"])
        dedup.append(item)
        if len(dedup) >= MAX_EVENTS:
            break
    if not dedup:
        raise RuntimeError("Gemini returned no usable past event dates")
    return dedup, str(parsed.get("summary_ko") or "").strip()


def discover_event_dates(query: str) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        raise ValueError("empty event query")

    catalog = _catalog_match(query)
    summary_ko = ""
    source = "catalog"
    events: list[dict[str, Any]]

    if catalog:
        events = catalog
        summary_ko = f"카탈로그에서 '{query}' 관련 주요 과거 사례를 불러왔습니다."
        source = "catalog"
    else:
        try:
            events, summary_ko = _discover_with_gemini(query)
            source = "gemini"
        except Exception as exc:
            raise RuntimeError(
                f"이벤트 일자를 찾지 못했습니다: {exc}\n"
                "예: 일본 지진, 리먼, 코로나, 우크라이나, 브렉시트, SVB"
            ) from exc

    payload = {
        "query": query,
        "source": source,
        "summary_ko": summary_ko,
        "events": [
            {
                "date": e["date_str"],
                "title": e["title"],
                "note": e["note"],
                "source": e.get("source", source),
            }
            for e in events
        ],
        "discovered_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    save_event_dates(payload)
    # attach parsed date objects for pipeline
    for item, original in zip(payload["events"], events):
        item["_date"] = original["date"]
    return payload


def save_event_dates(payload: dict[str, Any]) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe = re.sub(r"[^\w\-]+", "_", payload.get("query") or "event")[:40]
    path = DATA_DIR / f"{stamp}_{safe}.json"
    serializable = {
        k: v
        for k, v in payload.items()
        if k != "events"
    }
    serializable["events"] = [
        {kk: vv for kk, vv in ev.items() if not kk.startswith("_")}
        for ev in payload.get("events") or []
    ]
    path.write_text(json.dumps(serializable, ensure_ascii=False, indent=2), encoding="utf-8")
    payload["saved_path"] = str(path)
    return path

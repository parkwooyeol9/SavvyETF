"""Multi-source AI governance screen for web AI 거버넌스 tab.

Sources (best-effort, soft-fail each):
  - Open DART keyword disclosure screen
  - SEC EDGAR cybersecurity / Item 1.05 8-K pulse
  - Finnhub market news (AI/governance keyword filter)
  - Naver news (KR AI basic law / privacy headlines)
  - Static AI policy calendar (KR AI기본법 + EU AI Act milestones)
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")

AI_NEWS_KEYWORDS = (
    "artificial intelligence",
    "ai act",
    "ai governance",
    "cybersecurity",
    "data breach",
    "privacy",
    "openai",
    "chatgpt",
    "generative ai",
    "인공지능",
    "개인정보",
    "사이버",
    "정보유출",
    "ai기본법",
    "딥페이크",
)

NAVER_QUERIES = (
    "AI기본법",
    "인공지능 개인정보",
    "사이버보안 공시",
)

# Static milestones — no API dependency. Update occasionally by hand.
AI_POLICY_CALENDAR: list[dict[str, str]] = [
    {
        "date": "2026-01-22",
        "region": "KR",
        "title": "AI기본법 전면 시행",
        "note": "고영향 AI·생성형 표시·내부 거버넌스 의무 본격 적용",
    },
    {
        "date": "2026-07-21",
        "region": "KR",
        "title": "AI기본법 후속 개정·시행령",
        "note": "공공조달 우선·포용·창업 지원 조항 구체화",
    },
    {
        "date": "2026-08-02",
        "region": "EU",
        "title": "EU AI Act — GPAI 의무 단계",
        "note": "일반목적 AI(GPAI) 관련 의무 타임라인 (사업자 준수 점검)",
    },
    {
        "date": "2027-08-02",
        "region": "EU",
        "title": "EU AI Act — 고위험 AI 전면",
        "note": "고위험 시스템 요구사항 전면 적용 예정 구간",
    },
]


def _match_news(text: str) -> bool:
    low = (text or "").lower()
    return any(k.lower() in low for k in AI_NEWS_KEYWORDS)


def _policy_events(*, ahead_days: int = 180, behind_days: int = 120) -> list[dict[str, Any]]:
    today = datetime.now(KST).date()
    start = today - timedelta(days=behind_days)
    end = today + timedelta(days=ahead_days)
    out: list[dict[str, Any]] = []
    for row in AI_POLICY_CALENDAR:
        try:
            d = datetime.strptime(row["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        if start <= d <= end:
            out.append(
                {
                    **row,
                    "days_from_today": (d - today).days,
                    "status": "past" if d < today else ("today" if d == today else "upcoming"),
                }
            )
    out.sort(key=lambda x: x.get("date") or "")
    return out


def _fetch_dart(query: str | None = None) -> dict[str, Any]:
    from esg_data import build_esg_ai_gov_profile

    profile = build_esg_ai_gov_profile(query)
    return {
        "ok": True,
        "source": "opendart",
        "days": profile.get("days"),
        "keywords": profile.get("keywords") or [],
        "query": profile.get("query"),
        "corp_name": profile.get("corp_name"),
        "hit_count": len(profile.get("hits") or []),
        "hits": profile.get("hits") or [],
        "generated_at": profile.get("generated_at"),
    }


def _fetch_sec_cyber(*, days: int = 30, sample_size: int = 12) -> dict[str, Any]:
    from macro_supplements import _fetch_edgar_search, _normalize_edgar_hit

    end = datetime.now(KST).date()
    start = end - timedelta(days=days)
    params = {
        "q": '"Item 1.05" OR cybersecurity OR "data breach"',
        "forms": "8-K",
        "dateRange": "custom",
        "startdt": start.isoformat(),
        "enddt": end.isoformat(),
        "from": 0,
        "size": min(sample_size, 40),
    }
    payload = _fetch_edgar_search(params)
    hits = payload.get("hits", {})
    total = hits.get("total", {})
    count = int(total.get("value", 0)) if isinstance(total, dict) else 0
    filings = [_normalize_edgar_hit(hit) for hit in hits.get("hits", [])]
    # Prefer Item 1.05 when present in the sample.
    cyberish = [
        f
        for f in filings
        if "1.05" in (f.get("items") or "")
        or "cyber" in (f.get("item_summary") or "").lower()
        or "cyber" in (f.get("company") or "").lower()
    ]
    return {
        "ok": True,
        "source": "sec_edgar",
        "window_days": days,
        "filing_count": count,
        "filings": (cyberish or filings)[:sample_size],
    }


def _fetch_finnhub_ai_news(*, limit: int = 10) -> dict[str, Any]:
    from macro_supplements import fetch_finnhub_market_news, _finnhub_api_key, _finnhub_get

    if not _finnhub_api_key():
        return {"ok": False, "source": "finnhub", "error": "FINNHUB_API_KEY not set", "headlines": []}
    raw = fetch_finnhub_market_news(limit_per_category=12)
    filtered = [
        h
        for h in raw
        if _match_news(h.get("headline") or "") or _match_news(h.get("summary") or "")
    ]

    # Company news for AI / hyperscaler names (governance & cyber often appear here).
    end = datetime.now(KST).date()
    start = end - timedelta(days=14)
    for symbol in ("NVDA", "MSFT", "GOOGL", "META", "AMZN", "PANW", "CRWD"):
        try:
            items = _finnhub_get(
                "company-news",
                {
                    "symbol": symbol,
                    "from": start.isoformat(),
                    "to": end.isoformat(),
                },
            )
        except Exception:
            continue
        if not isinstance(items, list):
            continue
        for item in items[:4]:
            title = str(item.get("headline") or "").strip()
            if not title:
                continue
            if not (_match_news(title) or _match_news(str(item.get("summary") or ""))):
                continue
            ts = item.get("datetime")
            if isinstance(ts, (int, float)):
                published = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            else:
                published = ""
            filtered.append(
                {
                    "category": f"company:{symbol}",
                    "headline": title,
                    "source": str(item.get("source") or "Finnhub"),
                    "published": published,
                    "summary": str(item.get("summary") or "").strip()[:220],
                    "url": str(item.get("url") or ""),
                }
            )

    # Dedupe by normalized headline
    seen: set[str] = set()
    uniq: list[dict[str, str]] = []
    for h in filtered:
        key = re.sub(r"[^a-z0-9가-힣]+", "", (h.get("headline") or "").lower())
        if not key or key in seen:
            continue
        seen.add(key)
        uniq.append(h)

    return {
        "ok": True,
        "source": "finnhub",
        "headlines": (uniq or raw)[:limit],
        "filtered": bool(uniq),
    }


def _fetch_naver_ai_news(*, limit: int = 8) -> dict[str, Any]:
    from naver_news import fetch_naver_news

    headlines: list[dict[str, str]] = []
    seen: set[str] = set()
    for query in NAVER_QUERIES:
        try:
            rows = fetch_naver_news(query, limit=4)
        except Exception:
            rows = []
        for row in rows:
            title = (row.get("title") or "").strip()
            key = re.sub(r"\s+", "", title.lower())
            if not title or key in seen:
                continue
            seen.add(key)
            headlines.append(
                {
                    "headline": title,
                    "source": row.get("source") or "Naver",
                    "published": row.get("date") or "",
                    "url": row.get("url") or "",
                    "query": query,
                }
            )
        if len(headlines) >= limit:
            break
    return {
        "ok": True,
        "source": "naver",
        "headlines": headlines[:limit],
    }


def build_ai_gov_screen(*, query: str | None = None) -> dict[str, Any]:
    """Aggregate AI governance signals for dashboard + Telegram."""
    generated_at = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    errors: list[str] = []
    dart: dict[str, Any] = {}
    sec: dict[str, Any] = {}
    finnhub: dict[str, Any] = {}
    naver: dict[str, Any] = {}

    with ThreadPoolExecutor(max_workers=4) as pool:
        fut_dart = pool.submit(_fetch_dart, query)
        fut_sec = pool.submit(_fetch_sec_cyber)
        fut_fh = pool.submit(_fetch_finnhub_ai_news)
        fut_nv = pool.submit(_fetch_naver_ai_news)
        try:
            dart = fut_dart.result()
        except Exception as exc:
            errors.append(f"dart: {exc}")
            dart = {"ok": False, "source": "opendart", "error": str(exc), "hits": []}
        try:
            sec = fut_sec.result()
        except Exception as exc:
            errors.append(f"sec: {exc}")
            sec = {"ok": False, "source": "sec_edgar", "error": str(exc), "filings": []}
        try:
            finnhub = fut_fh.result()
        except Exception as exc:
            errors.append(f"finnhub: {exc}")
            finnhub = {"ok": False, "source": "finnhub", "error": str(exc), "headlines": []}
        try:
            naver = fut_nv.result()
        except Exception as exc:
            errors.append(f"naver: {exc}")
            naver = {"ok": False, "source": "naver", "error": str(exc), "headlines": []}

    policy = _policy_events()
    ok = bool(
        dart.get("ok")
        or sec.get("ok")
        or finnhub.get("ok")
        or naver.get("ok")
        or policy
    )
    return {
        "ok": ok,
        "generated_at": generated_at,
        "note": (
            "DART·SEC·Finnhub·Naver·정책 캘린더 합성. "
            "기존 ESG 브리프 슬롯은 덮어쓰지 않음."
        ),
        "dart": dart,
        "sec": sec,
        "finnhub": finnhub,
        "naver": naver,
        "policy": {"ok": True, "events": policy},
        "errors": errors,
    }

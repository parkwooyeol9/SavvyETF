"""Live ETF시황 payload — KR/US new listings + equity holdings analysis.

Sources:
  - etfcheck.co.kr ``getIssueNewItem`` / ``getGlobalIssueNewItem``
  - KR holdings: etfcheck daily PDF weights (``getEtfPdfRankListWeight``)
  - US holdings: Yahoo top holdings via ``etf_memb_us`` (fallback; not daily CU)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from etfcheck_client import (
    BASE_URL,
    EtfCheckClient,
    fetch_global_new_listings,
    fetch_kr_pdf_weights,
    fetch_new_listings,
)

KST = ZoneInfo("Asia/Seoul")

_KR_HARD_EXCLUDE = (
    "국채",
    "채권",
    "머니마켓",
    "mmf",
    "초단기",
    "단기채권",
    "단일종목",
    "cd금리",
    "cp금리",
    "혼합",
    "인버스",
    "레버리지",
)

_US_EXCLUDE_NAME = (
    "2x ",
    "3x ",
    " -2x",
    "leveraged",
    "leverage shares",
    "buffer",
    "bffr",
    "uncapped",
    "daily long",
    "daily short",
    "single stock",
)


def is_kr_equity_listing(name: str) -> bool:
    text = str(name or "").lower()
    compact = text.replace(" ", "")
    for token in _KR_HARD_EXCLUDE:
        t = token.lower().replace(" ", "")
        if t and t in compact:
            return False
    return True


def is_us_equity_listing(name: str, *, category: str = "") -> bool:
    blob = f"{name} {category}".lower()
    if "trading--leveraged" in blob or "trading--inverse" in blob:
        return False
    if any(tok in blob for tok in _US_EXCLUDE_NAME):
        return False
    # Prefer equity categories when present
    if "fixed income" in blob or "bond" in blob or "commodity" in blob:
        return False
    return True


def _fmt_list_date(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    if len(text) >= 10 and text[4] == "-":
        return text[:10]
    return text or ""


def _normalize_kr(row: dict[str, Any]) -> dict[str, Any]:
    name = str(row.get("F16002") or "").strip()
    code = str(row.get("F16013") or "").strip().upper()
    return {
        "market": "KR",
        "code": code,
        "name": name,
        "list_date": _fmt_list_date(row.get("LIST_DATE") or row.get("F16017")),
        "change_pct": _safe_float(row.get("F15004")),
        "price": _safe_float(row.get("F15001")),
        "isin": str(row.get("F16012") or "") or None,
        "ctg_code": str(row.get("ctg_code") or "") or None,
        "equity_eligible": is_kr_equity_listing(name),
        "source": "etfcheck",
    }


def _normalize_us(row: dict[str, Any]) -> dict[str, Any]:
    name = str(row.get("FUNDNAME") or "").strip()
    symbol = str(row.get("SYMBOL") or "").strip().upper()
    return {
        "market": "US",
        "code": symbol,
        "name": name,
        "list_date": _fmt_list_date(row.get("LIST_DATE") or row.get("INCEPDATE")),
        "change_pct": _safe_float(row.get("F15004")),
        "price": _safe_float(row.get("F15001")),
        "mstar_id": str(row.get("MSTARID") or "") or None,
        "equity_eligible": is_us_equity_listing(name),
        "source": "etfcheck",
    }


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _analyze_weights(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    weights = [
        float(h["weight_pct"])
        for h in holdings
        if isinstance(h.get("weight_pct"), (int, float))
    ]
    top10 = sum(weights[:10]) if weights else None
    top5 = sum(weights[:5]) if weights else None
    max_w = max(weights) if weights else None
    hhi = sum((w / 100.0) ** 2 for w in weights) if weights else None
    return {
        "holding_count": len(holdings),
        "top5_weight_pct": round(top5, 2) if top5 is not None else None,
        "top10_weight_pct": round(top10, 2) if top10 is not None else None,
        "max_weight_pct": round(max_w, 2) if max_w is not None else None,
        "hhi": round(hhi, 4) if hhi is not None else None,
        "coverage_weight_pct": round(sum(weights), 2) if weights else None,
    }


def _analyze_kr_equity(
    client: EtfCheckClient,
    listing: dict[str, Any],
    *,
    top_n: int = 12,
) -> dict[str, Any] | None:
    code = listing["code"]
    try:
        holdings = fetch_kr_pdf_weights(client, code, limit=top_n)
    except Exception as exc:
        return {
            "market": "KR",
            "code": code,
            "name": listing.get("name"),
            "list_date": listing.get("list_date"),
            "ok": False,
            "error": str(exc),
            "source": "etfcheck_pdf",
        }
    if not holdings:
        return None
    return {
        "market": "KR",
        "code": code,
        "name": listing.get("name"),
        "list_date": listing.get("list_date"),
        "ok": True,
        "source": "etfcheck_pdf",
        "as_of": holdings[0].get("as_of"),
        "stats": _analyze_weights(holdings),
        "holdings": holdings,
    }


def _analyze_us_equity(listing: dict[str, Any], *, top_n: int = 10) -> dict[str, Any] | None:
    symbol = listing["code"]
    try:
        from etf_memb_us import build_etf_memb_us_profile

        profile = build_etf_memb_us_profile(symbol)
    except Exception as exc:
        return {
            "market": "US",
            "code": symbol,
            "name": listing.get("name"),
            "list_date": listing.get("list_date"),
            "ok": False,
            "error": str(exc),
            "source": "yahoo_top_holdings",
        }
    holdings = (profile.get("holdings") or [])[:top_n]
    if not holdings:
        return None
    return {
        "market": "US",
        "code": symbol,
        "name": profile.get("name") or listing.get("name"),
        "list_date": listing.get("list_date"),
        "ok": True,
        "source": "yahoo_top_holdings",
        "as_of": profile.get("generated_at"),
        "stats": _analyze_weights(holdings),
        "holdings": [
            {
                "code": h.get("code"),
                "name": h.get("name"),
                "weight_pct": h.get("weight_pct"),
            }
            for h in holdings
        ],
        "note": "Yahoo top holdings — not full daily CU; lag/stale possible for new launches.",
    }


def etf_new_payload(
    *,
    kr_limit: int = 15,
    us_limit: int = 15,
    analyze_kr: int = 4,
    analyze_us: int = 2,
    holdings_top_n: int = 12,
) -> dict[str, Any]:
    """Build dashboard JSON for the ETF시황 live panel."""
    generated_at = datetime.now(KST)
    try:
        client = EtfCheckClient()
        client.warmup()
        kr_raw = fetch_new_listings(client, limit=max(kr_limit, 30), domestic_only=True)
        us_raw = fetch_global_new_listings(client, limit=max(us_limit, 40))
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "generated_at": generated_at.isoformat(),
            "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
            "source": BASE_URL,
        }

    kr = [_normalize_kr(r) for r in kr_raw][:kr_limit]
    us = [_normalize_us(r) for r in us_raw][:us_limit]

    analyses: list[dict[str, Any]] = []
    for listing in kr:
        if len([a for a in analyses if a.get("market") == "KR"]) >= analyze_kr:
            break
        if not listing.get("equity_eligible"):
            continue
        result = _analyze_kr_equity(client, listing, top_n=holdings_top_n)
        if result:
            analyses.append(result)

    for listing in us:
        if len([a for a in analyses if a.get("market") == "US" and a.get("ok")]) >= analyze_us:
            break
        if not listing.get("equity_eligible"):
            continue
        result = _analyze_us_equity(listing, top_n=min(10, holdings_top_n))
        if not result:
            continue
        # Skip Yahoo rate-limit / empty failures so we can try the next listing.
        if not result.get("ok"):
            err = str(result.get("error") or "").lower()
            if "rate limit" in err or "too many requests" in err:
                continue
            # Keep one soft failure only if we have no US analysis yet.
            if any(a.get("market") == "US" for a in analyses):
                continue
        analyses.append(result)

    return {
        "ok": True,
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "source": BASE_URL,
        "kr_new": kr,
        "us_new": us,
        "analyses": analyses,
        "notes": [
            "한국·미국 신규상장: ETF CHECK (코스콤).",
            "한국 주식형 구성종목: ETF CHECK 일간 PDF/CU 비중.",
            "미국 구성종목: Yahoo top holdings (일간 전체 CU 아님).",
        ],
    }

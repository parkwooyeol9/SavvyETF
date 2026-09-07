"""On-demand KR/US ETF holdings lookup for the dashboard.

KR: ETF CHECK daily PDF weights.
US: ETF CHECK global PDF (MSTARID via getGlobalEtfMast).
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from etfcheck_client import (
    BASE_URL,
    EtfCheckClient,
    fetch_global_etf_item_info,
    fetch_global_etf_mast,
    fetch_global_etf_pdf_detail,
    fetch_kr_pdf_weights,
)
from etf_kor15 import _normalize_holding

KST = ZoneInfo("Asia/Seoul")

_KR_CODE = re.compile(r"^[0-9A-Z]{6}$")
_US_TICKER = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def _looks_kr(ticker: str) -> bool:
    return bool(_KR_CODE.fullmatch(ticker) and re.search(r"\d", ticker))


def _looks_us(ticker: str) -> bool:
    return bool(_US_TICKER.fullmatch(ticker) and not _looks_kr(ticker))


def _stats(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    weights = [
        float(h["weight_pct"])
        for h in holdings
        if isinstance(h.get("weight_pct"), (int, float))
    ]
    return {
        "holding_count": len(holdings),
        "top5_weight_pct": round(sum(weights[:5]), 2) if weights else None,
        "top10_weight_pct": round(sum(weights[:10]), 2) if weights else None,
        "max_weight_pct": round(max(weights), 2) if weights else None,
        "coverage_weight_pct": round(sum(weights), 2) if weights else None,
    }


def holdings_lookup_payload(
    ticker: str,
    *,
    limit: int = 80,
    market: str | None = None,
) -> dict[str, Any]:
    ticker = (ticker or "").strip().upper()
    if not ticker:
        return {"ok": False, "error": "티커를 입력하세요."}
    limit = max(10, min(300, int(limit)))
    hint = (market or "").strip().upper() or None
    if hint not in {None, "KR", "US"}:
        hint = None

    resolved = hint
    if resolved is None:
        if _looks_kr(ticker):
            resolved = "KR"
        elif _looks_us(ticker):
            resolved = "US"
        else:
            return {
                "ok": False,
                "ticker": ticker,
                "error": "국내 또는 미국 상장 ETF 티커만 조회할 수 있습니다.",
            }

    client = EtfCheckClient()
    client.warmup()
    if resolved == "KR":
        rows = fetch_kr_pdf_weights(client, ticker, limit=limit)
        holdings = [
            {
                "code": r.get("code"),
                "name": r.get("name"),
                "weight_pct": r.get("weight_pct"),
                "price": r.get("price"),
                "change_pct": r.get("change_pct"),
            }
            for r in rows
        ]
        if not holdings:
            return {
                "ok": False,
                "ticker": ticker,
                "market": "KR",
                "source": "etfcheck_pdf",
                "error": "ETF CHECK PDF 구성종목이 비어 있습니다.",
            }
        as_of = next((r.get("as_of") for r in rows if r.get("as_of")), None)
        return {
            "ok": True,
            "ticker": ticker,
            "market": "KR",
            "name": ticker,
            "as_of": as_of,
            "source": "etfcheck_pdf",
            "source_note": "국내 편입비: ETF CHECK 일간 PDF",
            "holdings": holdings,
            "stats": _stats(holdings),
            "generated_at_display": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
            "source_url": BASE_URL,
        }

    mast = {
        str(r.get("SYMBOL") or "").strip().upper(): r
        for r in fetch_global_etf_mast(client)
        if isinstance(r, dict) and r.get("SYMBOL")
    }
    row = mast.get(ticker)
    if not row or not row.get("MSTARID"):
        return {
            "ok": False,
            "ticker": ticker,
            "market": "US",
            "source": "etfcheck_global_pdf",
            "error": "ETF CHECK 글로벌 마스터에 없는 티커입니다.",
        }
    mstar = str(row["MSTARID"])
    info = fetch_global_etf_item_info(client, mstar) or {}
    raw = fetch_global_etf_pdf_detail(client, mstar, limit=max(limit, 400))
    holdings = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        norm = _normalize_holding(item)
        if norm:
            if isinstance(norm.get("weight_pct"), (int, float)):
                norm["weight_pct"] = round(float(norm["weight_pct"]), 2)
            holdings.append(norm)
    holdings = holdings[: max(1, limit)]
    if not holdings:
        return {
            "ok": False,
            "ticker": ticker,
            "market": "US",
            "source": "etfcheck_global_pdf",
            "error": "ETF CHECK 글로벌 PDF 구성종목이 비어 있습니다.",
        }
    as_of = str(info.get("TRADEDATE") or "").strip() or None
    if as_of and re.fullmatch(r"\d{8}", as_of):
        as_of = f"{as_of[:4]}-{as_of[4:6]}-{as_of[6:]}"
    name = str(info.get("FUNDNAME") or row.get("FUNDNAME") or ticker).strip()
    return {
        "ok": True,
        "ticker": ticker,
        "market": "US",
        "name": name,
        "as_of": as_of,
        "source": "etfcheck_global_pdf",
        "source_note": "미국 편입비: ETF CHECK 글로벌 PDF",
        "holdings": holdings,
        "stats": _stats(holdings),
        "generated_at_display": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "source_url": BASE_URL,
    }

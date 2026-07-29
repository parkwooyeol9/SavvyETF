"""Lightweight ETF CHECK (etfcheck.co.kr) HTTP client — no Selenium/Playwright.

The site gates APIs with a SHA-256 ``Checkclient`` header derived from a
time-bucketed key (see ``/js/build.js`` axios interceptor). The key is rotated
occasionally by the site — set ``ETFCHECK_CHECK_KEY`` or let the client refresh
from ``/js/build.js`` when 403s appear.
"""

from __future__ import annotations

import hashlib
import os
import re
import time
from typing import Any

import requests

BASE_URL = "https://www.etfcheck.co.kr"
# From webpack module in /js/build.js (`t.exports={key:"…"}`). Rotated by site.
_CHECK_KEY = "vfSddfdv"
_CACHED_KEY: str | None = None
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _resolve_check_key(*, force_refresh: bool = False) -> str:
    """Prefer env, then cached/build.js scrape, then bundled fallback."""
    global _CACHED_KEY, _CHECK_KEY
    env = (os.environ.get("ETFCHECK_CHECK_KEY") or "").strip()
    if env:
        return env
    if _CACHED_KEY and not force_refresh:
        return _CACHED_KEY
    if force_refresh or not _CACHED_KEY:
        try:
            response = requests.get(
                f"{BASE_URL}/js/build.js",
                headers={"User-Agent": _USER_AGENT, "Referer": f"{BASE_URL}/"},
                timeout=20,
            )
            response.raise_for_status()
            text = response.text
            match = re.search(r'exports=\{key:"([^"]{3,64})"\}', text)
            if not match:
                match = re.search(r'\{key:"([^"]{3,64})"\}', text)
            if match:
                _CACHED_KEY = match.group(1)
                _CHECK_KEY = _CACHED_KEY
                return _CACHED_KEY
        except Exception:
            pass
    return _CACHED_KEY or _CHECK_KEY


def checkclient_token(now_ms: int | None = None, *, key: str | None = None) -> str:
    """Mirror the site's axios interceptor (SHA-256 of key-indexed time bucket).

    JS: ``r += n[a[i] - "0"]`` — out-of-range indexes become the string
    ``\"undefined\"`` (key length is often < 10).
    """
    key = key or _resolve_check_key()
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    bucket = str(now_ms // 30_000)
    parts: list[str] = []
    for digit in bucket:
        idx = ord(digit) - ord("0")
        if 0 <= idx < len(key):
            parts.append(key[idx])
        else:
            parts.append("undefined")
    return hashlib.sha256("".join(parts).encode("utf-8")).hexdigest()


class EtfCheckClient:
    """Session-backed JSON client for Koscom ETF CHECK public endpoints."""

    def __init__(self, *, timeout: float = 25.0) -> None:
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": _USER_AGENT,
                "Accept": "application/json, text/plain, */*",
                "Referer": f"{BASE_URL}/",
                "Origin": BASE_URL,
            }
        )

    def _refresh_auth_headers(self, *, force_key_refresh: bool = False) -> None:
        token = checkclient_token(key=_resolve_check_key(force_refresh=force_key_refresh))
        # Site sets ``Checkclient``; keep lowercase aliases for compatibility.
        self.session.headers["Checkclient"] = token
        self.session.headers["checkclient"] = token
        self.session.headers["etfcheckclient"] = token

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._refresh_auth_headers()
        response = self.session.get(
            f"{BASE_URL}{path}",
            params=params or {},
            timeout=self.timeout,
        )
        if response.status_code == 403:
            # Key may have rotated — refresh once from build.js and retry.
            self._refresh_auth_headers(force_key_refresh=True)
            response = self.session.get(
                f"{BASE_URL}{path}",
                params=params or {},
                timeout=self.timeout,
            )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError(f"ETF CHECK {path}: unexpected payload type")
        if not payload.get("success"):
            message = payload.get("message") or "unknown error"
            raise RuntimeError(f"ETF CHECK {path}: {message}")
        return payload

    def warmup(self) -> None:
        """Hit the homepage once so cookies exist (tiny HTML, no JS render)."""
        self._refresh_auth_headers()
        self.session.get(BASE_URL + "/", timeout=self.timeout)


def fetch_global_etf_mast(client: EtfCheckClient) -> list[dict[str, Any]]:
    """Full US/global ETF master list (SYMBOL → MSTARID)."""
    payload = client.get_json("/user/common/getGlobalEtfMast", {})
    rows = payload.get("results") or []
    return rows if isinstance(rows, list) else []


def fetch_global_etf_item_info(
    client: EtfCheckClient,
    mstar_id: str,
) -> dict[str, Any] | None:
    """Fund outline (AUM, ADV, name) for a Morningstar / ETF CHECK code."""
    code = str(mstar_id or "").strip()
    if not code:
        return None
    payload = client.get_json("/user/etp/getGlobalEtfItemInfo", {"code": code})
    rows = payload.get("results") or []
    if not isinstance(rows, list) or not rows:
        return None
    row = rows[0]
    return row if isinstance(row, dict) else None


def fetch_global_etf_pdf_detail(
    client: EtfCheckClient,
    mstar_id: str,
    *,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Holdings/PDF rows for a US ETF (``limit`` expands beyond the default top 20)."""
    code = str(mstar_id or "").strip()
    if not code:
        return []
    payload = client.get_json(
        "/user/etp/getGlobalEtfPdfDetail",
        {"code": code, "limit": max(20, int(limit))},
    )
    rows = payload.get("results") or []
    return rows if isinstance(rows, list) else []


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_rank_volume(
    client: EtfCheckClient,
    *,
    order: str = "D",
    order_col: str = "P",
    limit: int = 15,
) -> list[dict[str, Any]]:
    """Korean ETF volume/turnover ranking.

    order_col: ``P`` = 거래대금, ``V`` = 거래량
    order: ``D`` 당일, ``BD`` 전일, ``5D`` / ``10D`` averages
    """
    payload = client.get_json(
        "/user/etp/getEtpRankListVolume",
        {
            "type": "ETF",
            "nation": "kr",  # accepted by API; mixin also sends type/annuity/ctg
            "annuityCode": "A",
            "ctgLargeCode": "A",
            "order": order,
            "orderCol": order_col,
            "orderBy": "DESC",
            "limit": limit,
            "leverage": "",
            "inverse": "",
            "invCode": "",
            "coveredCall": "",
        },
    )
    rows = payload.get("results") or []
    return rows if isinstance(rows, list) else []


def fetch_rank_inflow(
    client: EtfCheckClient,
    *,
    order: str = "D",
    limit: int = 15,
) -> list[dict[str, Any]]:
    """Korean ETF net inflow ranking. ``order=D`` 전일, ``W`` uses Inflow2 endpoint."""
    path = (
        "/user/etp/getEtpRankListInflow"
        if order == "D"
        else "/user/etp/getEtpRankListInflow2"
    )
    payload = client.get_json(
        path,
        {
            "type": "ETF",
            "annuityCode": "A",
            "ctgLargeCode": "A",
            "order": order,
            "orderBy": "DESC",
            "limit": limit,
            "leverage": "",
            "inverse": "",
            "invCode": "",
            "coveredCall": "",
        },
    )
    rows = payload.get("results") or []
    return rows if isinstance(rows, list) else []


def fetch_new_listings(
    client: EtfCheckClient,
    *,
    limit: int = 15,
    domestic_only: bool = True,
) -> list[dict[str, Any]]:
    """Recent Korean ETF/ETN listings (omit ``today`` for the rolling list)."""
    payload = client.get_json("/user/etp/getIssueNewItem", {})
    rows = payload.get("results") or []
    if not isinstance(rows, list):
        return []
    if domestic_only:
        rows = [row for row in rows if int(row.get("domestic_flag") or 0) == 1]
    rows.sort(key=lambda row: str(row.get("LIST_DATE") or ""), reverse=True)
    return rows[:limit]


def fetch_global_new_listings(
    client: EtfCheckClient,
    *,
    limit: int = 15,
) -> list[dict[str, Any]]:
    """Recent US/global ETF listings from ETF CHECK ``getGlobalIssueNewItem``."""
    payload = client.get_json("/user/etp/getGlobalIssueNewItem", {})
    rows = payload.get("results") or []
    if not isinstance(rows, list):
        return []
    rows = [row for row in rows if str(row.get("ETP_TYPE") or "ETF").upper() == "ETF"]
    rows.sort(
        key=lambda row: str(row.get("LIST_DATE") or row.get("INCEPDATE") or ""),
        reverse=True,
    )
    return rows[:limit]


def fetch_kr_pdf_weights(
    client: EtfCheckClient,
    code: str,
    *,
    limit: int = 15,
) -> list[dict[str, Any]]:
    """Daily CU/PDF weights for a Korean ETF (``getEtfPdfRankListWeight?code=``)."""
    code = str(code or "").strip().upper()
    if not code:
        return []
    payload = client.get_json("/user/etp/getEtfPdfRankListWeight", {"code": code})
    rows = payload.get("results") or []
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        weight_raw = row.get("WEIGHT")
        try:
            weight = float(weight_raw) if weight_raw is not None else None
        except (TypeError, ValueError):
            weight = None
        member = str(
            row.get("F16013_PDF") or row.get("F16013_T") or row.get("F16013") or ""
        ).strip()
        name = str(row.get("NAME") or row.get("F16004") or row.get("F16002") or "").strip()
        if not member and not name:
            continue
        out.append(
            {
                "code": member or name,
                "name": name or member,
                "weight_pct": weight,
                "price": _safe_float(row.get("F15001")),
                "change_pct": _safe_float(row.get("F15004")),
                "as_of": str(row.get("F12506") or "") or None,
                "market": str(row.get("F16288") or "") or None,
            }
        )
    out.sort(key=lambda r: (r.get("weight_pct") is None, -(r.get("weight_pct") or 0)))
    return out[: max(1, limit)]

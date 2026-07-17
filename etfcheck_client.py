"""Lightweight ETF CHECK (etfcheck.co.kr) HTTP client — no Selenium/Playwright.

The site gates APIs with a SHA-256 ``checkclient`` header derived from a
time-bucketed salt. Responses are small JSON; keep request concurrency at 1
so Render Starter (512MB) stays stable.
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

import requests

BASE_URL = "https://www.etfcheck.co.kr"
_CHECK_SALT = "#$dser#GVEWS329@"
_USER_AGENT = (
    "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)"
)


def checkclient_token(now_ms: int | None = None) -> str:
    """Mirror the site's axios interceptor (SHA-256 of salt-indexed time bucket)."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    bucket = str(now_ms // 30_000)
    material = "".join(_CHECK_SALT[int(digit)] for digit in bucket)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


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
            }
        )

    def _refresh_auth_headers(self) -> None:
        token = checkclient_token()
        self.session.headers["checkclient"] = token
        self.session.headers["etfcheckclient"] = token

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._refresh_auth_headers()
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
    """Recent ETF/ETN listings (omit ``today`` to get the rolling new-item list)."""
    payload = client.get_json("/user/etp/getIssueNewItem", {})
    rows = payload.get("results") or []
    if not isinstance(rows, list):
        return []
    if domestic_only:
        rows = [row for row in rows if int(row.get("domestic_flag") or 0) == 1]
    rows.sort(key=lambda row: str(row.get("LIST_DATE") or ""), reverse=True)
    return rows[:limit]

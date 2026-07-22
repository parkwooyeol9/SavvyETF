"""Publish brief snapshots from the Telegram bot to the Vercel dashboard.

No-ops unless WEB_PUBLISH_URL and WEB_INGEST_SECRET are set.
"""

from __future__ import annotations

import base64
import io
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")

VALID_TABS = {"kr", "us", "etf", "esg"}


def _ensure_dotenv() -> None:
    try:
        from dotenv import load_dotenv
        from pathlib import Path

        load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    except Exception:
        pass


def publish_configured() -> bool:
    _ensure_dotenv()
    return bool(
        os.environ.get("WEB_PUBLISH_URL", "").strip()
        and os.environ.get("WEB_INGEST_SECRET", "").strip()
    )


def chart_to_image_payload(
    chart: io.BytesIO,
    *,
    id: str = "chart",
    caption: str | None = None,
) -> dict[str, Any]:
    """Encode a PNG chart buffer for dashboard ingest.

    Rewinds the buffer afterward so the same BytesIO can still be sent to Telegram.
    """
    chart.seek(0)
    payload = {
        "id": id,
        "caption": caption,
        "png_base64": base64.b64encode(chart.read()).decode("ascii"),
    }
    chart.seek(0)
    return payload


def publish_brief(
    tab: str,
    slot: str,
    *,
    title: str,
    generated_at: str | None = None,
    html: str | None = None,
    sections: list[dict[str, Any]] | None = None,
    images: list[dict[str, Any]] | None = None,
    meta: dict[str, Any] | None = None,
) -> bool:
    """
    POST a snapshot to the Vercel /api/ingest endpoint.

    Returns True on success, False on skip/failure (never raises to callers).
    """
    _ensure_dotenv()
    url = os.environ.get("WEB_PUBLISH_URL", "").strip()
    secret = os.environ.get("WEB_INGEST_SECRET", "").strip()
    if not url or not secret:
        return False

    if tab not in VALID_TABS:
        print(f"web_publish skipped: invalid tab {tab!r}")
        return False
    if not slot or not title:
        print("web_publish skipped: missing slot/title")
        return False

    payload: dict[str, Any] = {
        "tab": tab,
        "slot": slot,
        "title": title,
        "generated_at": generated_at
        or datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S %Z"),
        "meta": meta or {},
    }
    if html:
        payload["html"] = html
    if sections:
        payload["sections"] = sections
    if images:
        payload["images"] = images

    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        print(f"web_publish network error ({tab}/{slot}): {exc}")
        return False

    if not response.ok:
        print(
            f"web_publish failed ({tab}/{slot}): "
            f"HTTP {response.status_code} {response.text[:300]}"
        )
        return False

    print(f"web_publish ok ({tab}/{slot}) → {url}")
    return True


def section_from_html(text: str, heading: str | None = None) -> list[dict[str, Any]]:
    """Wrap Telegram HTML / plain text as a single dashboard section."""
    if not text or not str(text).strip():
        return []
    item: dict[str, Any] = {"html_or_text": str(text)}
    if heading:
        item["heading"] = heading
    return [item]

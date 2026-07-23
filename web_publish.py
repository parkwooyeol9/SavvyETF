"""Publish brief snapshots from the Telegram bot to the Vercel dashboard.

Always writes a local Render copy first (homepage fallback). Then POSTs to
WEB_PUBLISH_URL when WEB_INGEST_SECRET is set. Local success is enough for
the dashboard proxy; remote Blob failures are logged but non-fatal.
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
    Save locally, then POST a snapshot to Vercel /api/ingest when configured.

    Returns True when the local store write succeeds (dashboard can show it via
    Render fallback). Remote Blob failures do not flip the return to False.
    """
    _ensure_dotenv()

    if tab not in VALID_TABS:
        print(f"web_publish skipped: invalid tab {tab!r}")
        return False
    if not slot or not title:
        print("web_publish skipped: missing slot/title")
        return False

    generated = generated_at or datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S %Z")

    local_ok = False
    try:
        from web_briefs_store import record_publish_result, upsert_brief

        upsert_brief(
            tab,
            slot,
            title=title,
            generated_at=generated,
            html=html,
            sections=sections,
            images=images,
            meta=meta,
        )
        local_ok = True
        print(f"web_publish local ok ({tab}/{slot})")
    except Exception as exc:
        print(f"web_publish local failed ({tab}/{slot}): {exc}")
        try:
            from web_briefs_store import record_publish_result

            record_publish_result(
                tab=tab,
                slot=slot,
                local_ok=False,
                remote_ok=None,
                error=f"local: {exc}",
            )
        except Exception:
            pass
        # Still try remote if configured — better than dropping both paths.

    url = os.environ.get("WEB_PUBLISH_URL", "").strip()
    secret = os.environ.get("WEB_INGEST_SECRET", "").strip()
    if not url or not secret:
        try:
            from web_briefs_store import record_publish_result

            record_publish_result(
                tab=tab,
                slot=slot,
                local_ok=local_ok,
                remote_ok=None,
                error="remote skipped: WEB_PUBLISH_URL/WEB_INGEST_SECRET unset",
            )
        except Exception:
            pass
        return local_ok

    payload: dict[str, Any] = {
        "tab": tab,
        "slot": slot,
        "title": title,
        "generated_at": generated,
        "meta": meta or {},
    }
    if html:
        payload["html"] = html
    if sections:
        payload["sections"] = sections
    if images:
        payload["images"] = images

    remote_ok = False
    http_status: int | None = None
    err: str | None = None
    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            timeout=60,
        )
        http_status = response.status_code
    except requests.RequestException as exc:
        err = f"network: {exc}"
        print(f"web_publish network error ({tab}/{slot}): {exc}")
    else:
        if response.ok:
            remote_ok = True
            print(f"web_publish ok ({tab}/{slot}) → {url}")
        else:
            err = f"HTTP {response.status_code} {response.text[:300]}"
            print(f"web_publish failed ({tab}/{slot}): {err}")

    try:
        from web_briefs_store import record_publish_result

        record_publish_result(
            tab=tab,
            slot=slot,
            local_ok=local_ok,
            remote_ok=remote_ok,
            error=err,
            http_status=http_status,
        )
    except Exception:
        pass

    return local_ok or remote_ok


def section_from_html(text: str, heading: str | None = None) -> list[dict[str, Any]]:
    """Wrap Telegram HTML / plain text as a single dashboard section."""
    if not text or not str(text).strip():
        return []
    item: dict[str, Any] = {"html_or_text": str(text)}
    if heading:
        item["heading"] = heading
    return [item]

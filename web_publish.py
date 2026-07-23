"""Publish brief snapshots from the Telegram bot to durable remote + local store.

Order:
  1. Always write a local Render copy (homepage fallback after redeploys need reseed).
  2. If Cloudflare R2 is configured, write JSON + PNGs there (primary durable store)
     with stable image keys and orphan PNG GC.
  3. If WEB_PUBLISH_URL + WEB_INGEST_SECRET are set, POST to Vercel /api/ingest
     (also writes R2/Blob on the webapp side).

Local or R2 success is enough for the dashboard; Vercel ingest failures are non-fatal.
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
    """True when any durable publish path beyond local disk is available."""
    _ensure_dotenv()
    try:
        from r2_briefs import r2_configured

        if r2_configured():
            return True
    except Exception:
        pass
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
    Save locally, then R2 (if configured), then POST to Vercel ingest when set.

    Returns True when local or R2 write succeeds.
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

    r2_ok: bool | None = None
    r2_err: str | None = None
    try:
        from r2_briefs import r2_configured, upsert_brief_r2

        if r2_configured():
            upsert_brief_r2(
                tab,
                slot,
                title=title,
                generated_at=generated,
                html=html,
                sections=sections,
                images=images,
                meta=meta,
            )
            r2_ok = True
            print(f"web_publish r2 ok ({tab}/{slot})")
        else:
            r2_ok = None
    except Exception as exc:
        r2_ok = False
        r2_err = f"r2: {exc}"
        print(f"web_publish r2 failed ({tab}/{slot}): {exc}")

    url = os.environ.get("WEB_PUBLISH_URL", "").strip()
    secret = os.environ.get("WEB_INGEST_SECRET", "").strip()
    remote_ok: bool | None = None
    http_status: int | None = None
    err: str | None = r2_err

    if not url or not secret:
        if r2_ok is None and not local_ok:
            err = err or "remote skipped: WEB_PUBLISH_URL/WEB_INGEST_SECRET unset"
        try:
            from web_briefs_store import record_publish_result

            record_publish_result(
                tab=tab,
                slot=slot,
                local_ok=local_ok,
                remote_ok=True if r2_ok else (None if r2_ok is None else False),
                error=err,
            )
        except Exception:
            pass
        return local_ok or bool(r2_ok)

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
        ingest_err = f"network: {exc}"
        err = f"{err}; {ingest_err}" if err else ingest_err
        print(f"web_publish network error ({tab}/{slot}): {exc}")
        remote_ok = False
    else:
        if response.ok:
            remote_ok = True
            print(f"web_publish ingest ok ({tab}/{slot}) → {url}")
        else:
            ingest_err = f"HTTP {response.status_code} {response.text[:300]}"
            err = f"{err}; {ingest_err}" if err else ingest_err
            print(f"web_publish ingest failed ({tab}/{slot}): {err}")
            remote_ok = False

    # remote_ok for health: R2 or ingest success
    combined_remote = bool(r2_ok) or bool(remote_ok)
    try:
        from web_briefs_store import record_publish_result

        record_publish_result(
            tab=tab,
            slot=slot,
            local_ok=local_ok,
            remote_ok=combined_remote if (r2_ok is not None or remote_ok is not None) else None,
            error=err,
            http_status=http_status,
        )
    except Exception:
        pass

    return local_ok or bool(r2_ok) or bool(remote_ok)


def section_from_html(text: str, heading: str | None = None) -> list[dict[str, Any]]:
    """Wrap Telegram HTML / plain text as a single dashboard section."""
    if not text or not str(text).strip():
        return []
    item: dict[str, Any] = {"html_or_text": str(text)}
    if heading:
        item["heading"] = heading
    return [item]

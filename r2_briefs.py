"""Cloudflare R2 (S3-compatible) brief store for the Telegram bot.

Writes tab JSON + chart PNGs with stable keys and deletes orphan versioned
PNGs under each slot prefix. Used as the durable remote store (Hobby Blob
replacement) so Render redeploys / Blob blocks do not wipe the homepage.

Env:
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME
  R2_PUBLIC_BASE_URL   optional public CDN (r2.dev / custom). If unset, image
                       URLs use BRIEF_MEDIA_BASE_URL or WEB_PUBLISH_URL origin
                       + /api/briefs/media/...
  BRIEF_MEDIA_BASE_URL optional override for media proxy base
"""

from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

VALID_TABS = ("kr", "us", "etf", "esg")


def _ensure_dotenv() -> None:
    try:
        from dotenv import load_dotenv
        from pathlib import Path

        load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    except Exception:
        pass


def _safe_part(value: str, fallback: str = "x") -> str:
    cleaned = re.sub(r"[^a-z0-9_-]", "", (value or "").strip().lower())
    return (cleaned[:64] or fallback)


def r2_configured() -> bool:
    _ensure_dotenv()
    return bool(
        os.environ.get("R2_ACCOUNT_ID", "").strip()
        and os.environ.get("R2_ACCESS_KEY_ID", "").strip()
        and os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
        and os.environ.get("R2_BUCKET_NAME", "").strip()
    )


def _client():
    import boto3
    from botocore.config import Config

    account = os.environ["R2_ACCOUNT_ID"].strip()
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"].strip(),
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"].strip(),
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def _bucket() -> str:
    return os.environ["R2_BUCKET_NAME"].strip()


def _tab_key(tab: str) -> str:
    return f"briefs/{_safe_part(tab)}.json"


def _image_key(tab: str, slot: str, image_id: str) -> str:
    return (
        f"briefs/images/{_safe_part(tab)}/"
        f"{_safe_part(slot, 'slot')}/{_safe_part(image_id, 'chart')}.png"
    )


def _slot_prefix(tab: str, slot: str) -> str:
    return f"briefs/images/{_safe_part(tab)}/{_safe_part(slot, 'slot')}/"


def _media_base() -> str:
    public = (os.environ.get("R2_PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if public:
        return public
    media = (os.environ.get("BRIEF_MEDIA_BASE_URL") or "").strip().rstrip("/")
    if media:
        return media
    publish = (os.environ.get("WEB_PUBLISH_URL") or "").strip()
    if publish:
        # https://savvyetf.vercel.app/api/ingest → https://savvyetf.vercel.app
        from urllib.parse import urlparse

        parsed = urlparse(publish)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}/api/briefs/media"
    bot = (
        os.environ.get("SUMMARY_PUBLIC_URL")
        or os.environ.get("BOT_PUBLIC_URL")
        or ""
    ).strip().rstrip("/")
    if bot:
        # Last resort: keep images on Render local API until webapp reads JSON
        return f"{bot}/api/web-briefs/images-proxy"
    return ""


def _public_url(key: str, version: int | str) -> str:
    base = _media_base()
    if not base:
        return f"/{key}?v={version}"
    if base.endswith("/api/briefs/media"):
        return f"{base}/{key}?v={version}"
    if "/api/web-briefs/images" in base:
        # unused placeholder — prefer R2 public / Vercel media
        return f"{base.rstrip('/')}/{key}?v={version}"
    return f"{base}/{key}?v={version}"


def _get_json(client, key: str) -> dict[str, Any] | None:
    try:
        obj = client.get_object(Bucket=_bucket(), Key=key)
    except client.exceptions.NoSuchKey:
        return None
    except Exception as exc:
        msg = str(exc)
        if "NoSuchKey" in msg or "404" in msg or "Not Found" in msg:
            return None
        raise
    raw = obj["Body"].read().decode("utf-8")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def _put_bytes(
    client,
    key: str,
    body: bytes,
    content_type: str,
    *,
    cache_control: str = "public, max-age=60",
) -> None:
    client.put_object(
        Bucket=_bucket(),
        Key=key,
        Body=body,
        ContentType=content_type,
        CacheControl=cache_control,
    )


def _list_keys(client, prefix: str) -> list[str]:
    keys: list[str] = []
    token = None
    while True:
        kwargs: dict[str, Any] = {"Bucket": _bucket(), "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        for item in resp.get("Contents") or []:
            k = item.get("Key")
            if k:
                keys.append(k)
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    return keys


def gc_slot_image_orphans(client, tab: str, slot: str, keep_ids: set[str]) -> int:
    """Delete objects under the slot prefix that are not stable `{id}.png` keepers."""
    prefix = _slot_prefix(tab, slot)
    keep_names = {f"{_safe_part(i, 'chart')}.png" for i in keep_ids}
    doomed = []
    for key in _list_keys(client, prefix):
        name = key.rsplit("/", 1)[-1]
        if name not in keep_names:
            doomed.append(key)
    if not doomed:
        return 0
    # delete_objects max 1000
    deleted = 0
    for i in range(0, len(doomed), 900):
        chunk = doomed[i : i + 900]
        client.delete_objects(
            Bucket=_bucket(),
            Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
        )
        deleted += len(chunk)
    return deleted


def _save_images(
    client,
    tab: str,
    slot: str,
    images: list[dict[str, Any]] | None,
) -> list[dict[str, Any]] | None:
    if not images:
        return None
    out: list[dict[str, Any]] = []
    keep_ids: set[str] = set()
    version = int(datetime.now(timezone.utc).timestamp() * 1000)
    for image in images:
        image_id = _safe_part(str(image.get("id") or "chart"), "chart")
        raw_b64 = image.get("png_base64") or ""
        if not raw_b64:
            url = image.get("url")
            if url:
                out.append(
                    {
                        "id": image_id,
                        "url": url,
                        "caption": image.get("caption"),
                    }
                )
                keep_ids.add(image_id)
            continue
        try:
            buf = base64.b64decode(raw_b64)
        except Exception:
            continue
        if len(buf) < 8 or buf[:4] != b"\x89PNG":
            continue
        key = _image_key(tab, slot, image_id)
        _put_bytes(client, key, buf, "image/png")
        keep_ids.add(image_id)
        out.append(
            {
                "id": image_id,
                "url": _public_url(key, version),
                "caption": image.get("caption"),
            }
        )
    try:
        removed = gc_slot_image_orphans(client, tab, slot, keep_ids)
        if removed:
            print(f"r2 GC removed {removed} orphan PNG(s) under {tab}/{slot}")
    except Exception as exc:
        print(f"r2 GC warning ({tab}/{slot}): {exc}")
    return out or None


def upsert_brief_r2(
    tab: str,
    slot: str,
    *,
    title: str,
    generated_at: str,
    html: str | None = None,
    sections: list[dict[str, Any]] | None = None,
    images: list[dict[str, Any]] | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write one brief slot to R2. Returns the updated tab payload."""
    _ensure_dotenv()
    if not r2_configured():
        raise RuntimeError("R2 is not configured")
    if tab not in VALID_TABS:
        raise ValueError(f"Invalid tab: {tab}")
    slot_key = _safe_part(slot, "")
    if not slot_key:
        raise ValueError("Missing slot")
    if not (title or "").strip():
        raise ValueError("Missing title")
    if not (generated_at or "").strip():
        generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    client = _client()
    current = _get_json(client, _tab_key(tab)) or {
        "tab": tab,
        "updated_at": None,
        "slots": {},
    }
    slots = current.get("slots") if isinstance(current.get("slots"), dict) else {}
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    uploaded = _save_images(client, tab, slot_key, images)

    slot_payload: dict[str, Any] = {
        "slot": slot_key,
        "generated_at": generated_at,
        "title": (title or "")[:200],
        "meta": meta or {},
        "received_at": now,
    }
    if html:
        slot_payload["html"] = html
    if sections:
        slot_payload["sections"] = sections
    if uploaded:
        slot_payload["images"] = uploaded

    slots[slot_key] = slot_payload
    next_tab = {"tab": tab, "updated_at": now, "slots": slots}
    _put_bytes(
        client,
        _tab_key(tab),
        json.dumps(next_tab, ensure_ascii=False, indent=2).encode("utf-8"),
        "application/json",
        cache_control="public, max-age=30",
    )
    return next_tab

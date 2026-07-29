"""Cloudflare R2 (S3-compatible) brief store for the Telegram bot.

Layout (per-slot — one write cannot erase sibling slots):
  briefs/{tab}/slots/{slot}.json
  briefs/{tab}/history/{slot}/{ts}.json   (rolling backup, last N)
  briefs/{tab}.json                      (legacy monolith — read/migrate only)

Images:
  briefs/images/{tab}/{slot}/{id}.png

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
HISTORY_KEEP = 5


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


def _legacy_tab_key(tab: str) -> str:
    return f"briefs/{_safe_part(tab)}.json"


def _slot_key(tab: str, slot: str) -> str:
    return f"briefs/{_safe_part(tab)}/slots/{_safe_part(slot, 'slot')}.json"


def _slots_prefix(tab: str) -> str:
    return f"briefs/{_safe_part(tab)}/slots/"


def _history_key(tab: str, slot: str, ts: str) -> str:
    return (
        f"briefs/{_safe_part(tab)}/history/"
        f"{_safe_part(slot, 'slot')}/{_safe_part(ts, 't')}.json"
    )


def _history_prefix(tab: str, slot: str) -> str:
    return f"briefs/{_safe_part(tab)}/history/{_safe_part(slot, 'slot')}/"


def _image_key(tab: str, slot: str, image_id: str) -> str:
    return (
        f"briefs/images/{_safe_part(tab)}/"
        f"{_safe_part(slot, 'slot')}/{_safe_part(image_id, 'chart')}.png"
    )


def _slot_image_prefix(tab: str, slot: str) -> str:
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
        return f"{bot}/api/web-briefs/images-proxy"
    return ""


def _public_url(key: str, version: int | str) -> str:
    base = _media_base()
    if not base:
        return f"/{key}?v={version}"
    if base.endswith("/api/briefs/media"):
        return f"{base}/{key}?v={version}"
    if "/api/web-briefs/images" in base:
        return f"{base.rstrip('/')}/{key}?v={version}"
    return f"{base}/{key}?v={version}"


def _get_json(client, key: str) -> dict[str, Any] | None:
    """Return parsed JSON object, or None if missing. Corrupt JSON raises."""
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
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Corrupt brief JSON at {key}: {exc}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Corrupt brief JSON at {key}: expected object")
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


def _normalize_slot(slot_key: str, raw: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    title = (raw.get("title") or slot_key or "").strip()
    generated = (raw.get("generated_at") or raw.get("received_at") or "").strip()
    if not title or not generated:
        return None
    out: dict[str, Any] = {
        "slot": _safe_part(str(raw.get("slot") or slot_key), slot_key),
        "generated_at": generated,
        "title": title[:200],
        "meta": raw.get("meta") if isinstance(raw.get("meta"), dict) else {},
    }
    if raw.get("received_at"):
        out["received_at"] = raw["received_at"]
    if raw.get("html"):
        out["html"] = raw["html"]
    if raw.get("sections"):
        out["sections"] = raw["sections"]
    if raw.get("images"):
        out["images"] = raw["images"]
    return out


def _assemble_tab(client, tab: str) -> dict[str, Any]:
    """Load all slots for a tab (per-slot files + legacy monolith fallback)."""
    slots: dict[str, Any] = {}
    updated_at: str | None = None

    for key in _list_keys(client, _slots_prefix(tab)):
        if not key.endswith(".json"):
            continue
        name = key.rsplit("/", 1)[-1][:-5]
        try:
            parsed = _get_json(client, key)
        except Exception as exc:
            print(f"r2 skip corrupt slot {key}: {exc}")
            continue
        if not parsed:
            continue
        slot = _normalize_slot(name, parsed)
        if not slot:
            continue
        slots[slot["slot"]] = slot
        recv = slot.get("received_at")
        if isinstance(recv, str) and (updated_at is None or recv > updated_at):
            updated_at = recv

    # Legacy monolith: fill only missing slots (per-slot wins).
    try:
        legacy = _get_json(client, _legacy_tab_key(tab))
    except Exception as exc:
        print(f"r2 legacy read warning ({tab}): {exc}")
        legacy = None
    if legacy and isinstance(legacy.get("slots"), dict):
        for key, raw in legacy["slots"].items():
            slot = _normalize_slot(str(key), raw if isinstance(raw, dict) else {})
            if not slot:
                continue
            if slot["slot"] in slots:
                continue
            slots[slot["slot"]] = slot
        leg_upd = legacy.get("updated_at")
        if isinstance(leg_upd, str) and (updated_at is None or leg_upd > updated_at):
            updated_at = leg_upd

    return {"tab": tab, "updated_at": updated_at, "slots": slots}


def _migrate_legacy_slots(client, tab: str) -> int:
    """Split legacy tab JSON into per-slot objects (idempotent)."""
    try:
        legacy = _get_json(client, _legacy_tab_key(tab))
    except Exception:
        return 0
    if not legacy or not isinstance(legacy.get("slots"), dict):
        return 0
    written = 0
    for key, raw in legacy["slots"].items():
        slot = _normalize_slot(str(key), raw if isinstance(raw, dict) else {})
        if not slot:
            continue
        slot_key = slot["slot"]
        dest = _slot_key(tab, slot_key)
        existing = None
        try:
            existing = _get_json(client, dest)
        except Exception:
            pass
        if existing:
            continue
        _put_bytes(
            client,
            dest,
            json.dumps(slot, ensure_ascii=False, indent=2).encode("utf-8"),
            "application/json",
            cache_control="public, max-age=30",
        )
        written += 1
    if written:
        print(f"r2 migrated {written} legacy slot(s) for {tab}")
    return written


def _gc_history(client, tab: str, slot: str) -> None:
    keys = sorted(_list_keys(client, _history_prefix(tab, slot)))
    if len(keys) <= HISTORY_KEEP:
        return
    doomed = keys[: len(keys) - HISTORY_KEEP]
    for i in range(0, len(doomed), 900):
        chunk = doomed[i : i + 900]
        client.delete_objects(
            Bucket=_bucket(),
            Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
        )


def gc_slot_image_orphans(client, tab: str, slot: str, keep_ids: set[str]) -> int:
    """Delete objects under the slot image prefix that are not stable `{id}.png`."""
    prefix = _slot_image_prefix(tab, slot)
    keep_names = {f"{_safe_part(i, 'chart')}.png" for i in keep_ids}
    doomed = []
    for key in _list_keys(client, prefix):
        name = key.rsplit("/", 1)[-1]
        if name not in keep_names:
            doomed.append(key)
    if not doomed:
        return 0
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
    """Write one brief slot object. Sibling slots are never rewritten."""
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
    try:
        _migrate_legacy_slots(client, tab)
    except Exception as exc:
        print(f"r2 legacy migrate warning ({tab}): {exc}")

    uploaded = _save_images(client, tab, slot_key, images)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
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

    body = json.dumps(slot_payload, ensure_ascii=False, indent=2).encode("utf-8")
    dest = _slot_key(tab, slot_key)
    _put_bytes(
        client,
        dest,
        body,
        "application/json",
        cache_control="public, max-age=30",
    )

    # Rolling history backup (best-effort).
    try:
        ts = now.replace(":", "").replace(".", "").replace("+00:00", "Z")
        _put_bytes(
            client,
            _history_key(tab, slot_key, ts),
            body,
            "application/json",
            cache_control="private, max-age=0",
        )
        _gc_history(client, tab, slot_key)
    except Exception as exc:
        print(f"r2 history warning ({tab}/{slot_key}): {exc}")

    return _assemble_tab(client, tab)

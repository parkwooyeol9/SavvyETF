"""Local on-disk brief snapshots for the Vercel dashboard fallback.

Vercel Blob can fail (e.g. store blocked). The Telegram bot always keeps a
copy here so the homepage can still load via Render → Vercel proxy.
"""

from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
STORE_DIR = DATA_DIR / "web_briefs"
IMAGES_DIR = STORE_DIR / "images"

VALID_TABS = ("kr", "us", "etf", "esg")


def _safe_part(value: str, fallback: str = "x") -> str:
    cleaned = re.sub(r"[^a-z0-9_-]", "", (value or "").strip().lower())
    return (cleaned[:64] or fallback)


def _tab_path(tab: str) -> Path:
    return STORE_DIR / f"{_safe_part(tab)}.json"


def _empty_tab(tab: str) -> dict[str, Any]:
    return {"tab": tab, "updated_at": None, "slots": {}}


def _public_base() -> str:
    return (
        os.environ.get("SUMMARY_PUBLIC_URL")
        or os.environ.get("BOT_PUBLIC_URL")
        or "https://savvyetf-bot.onrender.com"
    ).rstrip("/")


def _read_tab(tab: str) -> dict[str, Any]:
    path = _tab_path(tab)
    if not path.is_file():
        return _empty_tab(tab)
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty_tab(tab)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("slots"), dict):
        return _empty_tab(tab)
    return {
        "tab": tab,
        "updated_at": parsed.get("updated_at"),
        "slots": parsed.get("slots") or {},
    }


def _write_tab(tab: str, payload: dict[str, Any]) -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    path = _tab_path(tab)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _image_rel_path(tab: str, slot: str, image_id: str) -> Path:
    return (
        IMAGES_DIR
        / _safe_part(tab)
        / _safe_part(slot, "slot")
        / f"{_safe_part(image_id, 'chart')}.png"
    )


def _save_images(
    tab: str,
    slot: str,
    images: list[dict[str, Any]] | None,
) -> list[dict[str, Any]] | None:
    if not images:
        return None
    out: list[dict[str, Any]] = []
    base = _public_base()
    for image in images:
        image_id = _safe_part(str(image.get("id") or "chart"), "chart")
        raw_b64 = image.get("png_base64") or ""
        if not raw_b64:
            # Already-hosted URL (e.g. re-seed) — keep as-is.
            url = image.get("url")
            if url:
                out.append(
                    {
                        "id": image_id,
                        "url": url,
                        "caption": image.get("caption"),
                    }
                )
            continue
        try:
            buf = base64.b64decode(raw_b64)
        except Exception:
            continue
        if len(buf) < 8 or buf[:4] != b"\x89PNG":
            continue
        rel = _image_rel_path(tab, slot, image_id)
        rel.parent.mkdir(parents=True, exist_ok=True)
        rel.write_bytes(buf)
        out.append(
            {
                "id": image_id,
                "url": (
                    f"{base}/api/web-briefs/images/"
                    f"{_safe_part(tab)}/{_safe_part(slot, 'slot')}/{image_id}.png"
                ),
                "caption": image.get("caption"),
            }
        )
    return out or None


def upsert_brief(
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
    """Persist one brief slot locally. Returns the updated tab payload."""
    if tab not in VALID_TABS:
        raise ValueError(f"Invalid tab: {tab}")
    slot_key = _safe_part(slot, "")
    if not slot_key:
        raise ValueError("Missing slot")
    if not title or not generated_at:
        raise ValueError("Missing title or generated_at")

    current = _read_tab(tab)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    uploaded = _save_images(tab, slot_key, images)
    slot_payload: dict[str, Any] = {
        "slot": slot_key,
        "generated_at": generated_at,
        "title": title[:200],
        "meta": meta or {},
        "received_at": now,
    }
    if html:
        slot_payload["html"] = html
    if sections:
        slot_payload["sections"] = sections
    if uploaded:
        slot_payload["images"] = uploaded

    next_tab = {
        "tab": tab,
        "updated_at": now,
        "slots": {
            **current.get("slots", {}),
            slot_key: slot_payload,
        },
    }
    _write_tab(tab, next_tab)
    return next_tab


def load_all_briefs() -> dict[str, Any]:
    """Return {kr,us,etf,esg} tab payloads, seeding from on-disk HTML when empty."""
    out = {tab: _read_tab(tab) for tab in VALID_TABS}
    _seed_from_html_files(out)
    return out


def load_image_bytes(tab: str, slot: str, image_id: str) -> bytes | None:
    path = _image_rel_path(tab, slot, image_id)
    if not path.is_file():
        return None
    return path.read_bytes()


def _seed_slot_from_html(
    briefs: dict[str, Any],
    tab: str,
    slot: str,
    *,
    title: str,
    html_path: Path,
    meta_path: Path | None = None,
) -> None:
    tab_payload = briefs.get(tab) or _empty_tab(tab)
    slots = tab_payload.get("slots") or {}
    if slot in slots and (slots[slot].get("html") or slots[slot].get("sections")):
        return
    if not html_path.is_file():
        return
    try:
        html = html_path.read_text(encoding="utf-8")
    except OSError:
        return
    if not html.strip() or "not generated yet" in html.lower():
        return
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    if meta_path and meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            generated_at = (
                meta.get("generated_at_display")
                or meta.get("generated_at")
                or generated_at
            )
        except (OSError, json.JSONDecodeError):
            pass
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    slots[slot] = {
        "slot": slot,
        "generated_at": generated_at,
        "title": title,
        "html": html,
        "meta": {"seeded_from": str(html_path.name)},
        "received_at": now,
    }
    tab_payload["slots"] = slots
    tab_payload["updated_at"] = now
    briefs[tab] = tab_payload
    try:
        _write_tab(tab, tab_payload)
    except OSError:
        pass


def _seed_from_html_files(briefs: dict[str, Any]) -> None:
    """Backfill US/KR HTML slots from the bot's existing summary files."""
    from summary_builder import SUMMARY_HTML_PATH, SUMMARY_META_PATH
    from summary_kor_builder import (
        SUMMARY_KOR_HTML_PATH,
        SUMMARY_KOR_INTRA_HTML_PATH,
        SUMMARY_KOR_INTRA_META_PATH,
        SUMMARY_KOR_META_PATH,
    )
    from summary_nxt_builder import SUMMARY_NXT_HTML_PATH, SUMMARY_NXT_META_PATH

    try:
        from reddit_builder import REDDIT_HTML_PATH, REDDIT_META_PATH
    except Exception:
        REDDIT_HTML_PATH = DATA_DIR / "reddit.html"
        REDDIT_META_PATH = DATA_DIR / "reddit_meta.json"

    _seed_slot_from_html(
        briefs,
        "us",
        "summary",
        title="미국 시황 /summary",
        html_path=SUMMARY_HTML_PATH,
        meta_path=SUMMARY_META_PATH,
    )
    _seed_slot_from_html(
        briefs,
        "us",
        "reddit",
        title="미국 시황 /reddit",
        html_path=REDDIT_HTML_PATH,
        meta_path=REDDIT_META_PATH,
    )
    _seed_slot_from_html(
        briefs,
        "kr",
        "summary_kor",
        title="국내 시황 /summary_kor",
        html_path=SUMMARY_KOR_HTML_PATH,
        meta_path=SUMMARY_KOR_META_PATH,
    )
    _seed_slot_from_html(
        briefs,
        "kr",
        "summary_kor_intra",
        title="국내 시황 /summary_kor_intra",
        html_path=SUMMARY_KOR_INTRA_HTML_PATH,
        meta_path=SUMMARY_KOR_INTRA_META_PATH,
    )
    _seed_slot_from_html(
        briefs,
        "kr",
        "summary_nxt",
        title="국내 시황 /summary_nxt",
        html_path=SUMMARY_NXT_HTML_PATH,
        meta_path=SUMMARY_NXT_META_PATH,
    )


# Last remote publish attempt (in-memory; exposed on /health)
_LAST_PUBLISH: dict[str, Any] = {
    "ok": None,
    "at": None,
    "tab": None,
    "slot": None,
    "error": None,
    "http_status": None,
    "local_ok": None,
}


def record_publish_result(
    *,
    tab: str,
    slot: str,
    local_ok: bool,
    remote_ok: bool | None,
    error: str | None = None,
    http_status: int | None = None,
) -> None:
    _LAST_PUBLISH.update(
        {
            "ok": remote_ok,
            "local_ok": local_ok,
            "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "tab": tab,
            "slot": slot,
            "error": (error or "")[:400] or None,
            "http_status": http_status,
        }
    )


def last_publish_status() -> dict[str, Any]:
    return dict(_LAST_PUBLISH)

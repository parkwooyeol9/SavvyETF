"""Cloudflare R2 helpers for non-brief data (ETF DB snapshots, credit monitor).

Layout:
  etf_db/latest.json
  etf_db/snapshots/{YYYY-MM-DD}.json   (hot window, last MAX_R2_SNAPSHOTS)
  etf_db/archive/{YYYY-MM-DD}.json     (older days — never deleted)
  credit_monitor/latest.json
  credit_monitor/snapshots/{YYYY-MM-DD}.json

Reuses the same R2_* env as r2_briefs.py.
"""

from __future__ import annotations

import json
import re
from typing import Any

from r2_briefs import (
    _bucket,
    _client,
    _copy_object,
    _get_json,
    _key_exists,
    _list_keys,
    _put_bytes,
    r2_configured,
)

ETF_DB_LATEST_KEY = "etf_db/latest.json"
ETF_DB_SNAPSHOTS_PREFIX = "etf_db/snapshots/"
ETF_DB_ARCHIVE_PREFIX = "etf_db/archive/"
CREDIT_MONITOR_LATEST_KEY = "credit_monitor/latest.json"
MAX_R2_SNAPSHOTS = 90


def _ymd(day: str) -> str | None:
    s = (day or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    return None


def put_json(key: str, payload: dict[str, Any] | list[Any]) -> bool:
    if not r2_configured():
        return False
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    client = _client()
    _put_bytes(
        client,
        key,
        body,
        "application/json; charset=utf-8",
        cache_control="public, max-age=120",
    )
    return True


def _kst_today() -> str:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")


def put_json_daily(
    latest_key: str,
    payload: dict[str, Any] | list[Any],
    *,
    day: str | None = None,
) -> bool:
    """Write latest + snapshots/{YYYY-MM-DD}.json. Keep every day (payloads are small)."""
    ymd = _ymd((day or "")[:10])
    if not ymd and isinstance(payload, dict):
        ymd = _ymd(str(payload.get("as_of") or payload.get("as_of_kst") or "")[:10])
    ymd = ymd or _kst_today()
    parent = latest_key.rsplit("/", 1)[0] if "/" in latest_key else latest_key
    latest_ok = put_json(latest_key, payload)
    snap_ok = put_json(f"{parent}/snapshots/{ymd}.json", payload)
    return bool(latest_ok and snap_ok)


def put_bytes(
    key: str,
    body: bytes,
    content_type: str,
    *,
    cache_control: str = "public, max-age=120",
) -> bool:
    if not r2_configured():
        return False
    _put_bytes(_client(), key, body, content_type, cache_control=cache_control)
    return True


def get_json(key: str) -> dict[str, Any] | None:
    if not r2_configured():
        return None
    return _get_json(_client(), key)


def upload_etf_snapshot(day: str, snapshot: dict[str, Any]) -> bool:
    ymd = _ymd(day) or _ymd(str(snapshot.get("date") or ""))
    if not ymd:
        raise ValueError(f"invalid ETF snapshot day: {day!r}")
    return put_json(f"{ETF_DB_SNAPSHOTS_PREFIX}{ymd}.json", snapshot)


def upload_etf_latest(payload: dict[str, Any]) -> bool:
    return put_json(ETF_DB_LATEST_KEY, payload)


def list_etf_snapshot_days_r2() -> list[str]:
    if not r2_configured():
        return []
    client = _client()
    days: list[str] = []
    for key in _list_keys(client, ETF_DB_SNAPSHOTS_PREFIX):
        if not key.endswith(".json"):
            continue
        day = key.rsplit("/", 1)[-1].removesuffix(".json")
        if _ymd(day):
            days.append(day)
    return sorted(days)


def list_prefix_keys(prefix: str) -> list[str]:
    if not r2_configured():
        return []
    return _list_keys(_client(), prefix)


def list_etf_archive_days_r2() -> list[str]:
    if not r2_configured():
        return []
    days: list[str] = []
    for key in _list_keys(_client(), ETF_DB_ARCHIVE_PREFIX):
        if not key.endswith(".json"):
            continue
        day = key.rsplit("/", 1)[-1].removesuffix(".json")
        if _ymd(day):
            days.append(day)
    return sorted(days)


def archive_etf_snapshots_r2() -> dict[str, int]:
    """Move hot snapshots older than MAX_R2_SNAPSHOTS into archive/. Never delete uncopied objects."""
    result = {"archived": 0, "deleted": 0, "failed": 0}
    if not r2_configured():
        return result
    client = _client()
    keys = sorted(
        k
        for k in _list_keys(client, ETF_DB_SNAPSHOTS_PREFIX)
        if k.endswith(".json") and _ymd(k.rsplit("/", 1)[-1].removesuffix(".json"))
    )
    doomed = keys[:-MAX_R2_SNAPSHOTS] if len(keys) > MAX_R2_SNAPSHOTS else []
    for key in doomed:
        dest = f"{ETF_DB_ARCHIVE_PREFIX}{key.rsplit('/', 1)[-1]}"
        try:
            if not _key_exists(client, dest):
                _copy_object(client, key, dest)
            result["archived"] += 1
            client.delete_object(Bucket=_bucket(), Key=key)
            result["deleted"] += 1
        except Exception as exc:
            result["failed"] += 1
            print(f"r2_data archive etf snapshot failed ({key}): {exc}")
    return result


def prune_etf_snapshots_r2() -> int:
    """Backward-compatible alias: archive then drop from the hot prefix. Returns archived count."""
    return archive_etf_snapshots_r2().get("archived", 0)


def publish_etf_db_to_r2(payload: dict[str, Any], *, snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    """Best-effort upload of latest (+ optional same-day snapshot)."""
    result: dict[str, Any] = {
        "ok": False,
        "latest": False,
        "snapshot": False,
        "pruned": 0,
        "archived": 0,
    }
    if not r2_configured():
        result["error"] = "R2 not configured"
        return result
    try:
        result["latest"] = upload_etf_latest(payload)
        day = str(payload.get("as_of") or "")[:10]
        if snapshot is None and day:
            from etf_db import load_snapshot

            snapshot = load_snapshot(day)
        if snapshot and day:
            result["snapshot"] = upload_etf_snapshot(day, snapshot)
            moved = archive_etf_snapshots_r2()
            result["archived"] = moved.get("archived", 0)
            result["pruned"] = result["archived"]
        result["ok"] = bool(result["latest"])
    except Exception as exc:
        result["error"] = str(exc)
        print(f"publish_etf_db_to_r2 failed: {exc}")
    return result


def sync_etf_snapshots_from_r2(*, local_dir) -> int:
    """Download missing snapshot days from R2 into local SNAPSHOT_DIR. Returns count written."""
    if not r2_configured():
        return 0
    from pathlib import Path

    root = Path(local_dir)
    root.mkdir(parents=True, exist_ok=True)
    client = _client()
    keys = sorted(
        k
        for k in _list_keys(client, ETF_DB_SNAPSHOTS_PREFIX)
        if k.endswith(".json")
    )[-MAX_R2_SNAPSHOTS:]
    written = 0
    for key in keys:
        day = key.rsplit("/", 1)[-1].removesuffix(".json")
        if not _ymd(day):
            continue
        dest = root / f"{day}.json"
        if dest.is_file():
            continue
        data = _get_json(client, key)
        if not data:
            continue
        dest.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        written += 1
    return written


def upload_credit_monitor(board: dict[str, Any]) -> bool:
    return put_json_daily(
        CREDIT_MONITOR_LATEST_KEY,
        board,
        day=str(board.get("as_of") or "")[:10],
    )


def load_credit_monitor() -> dict[str, Any] | None:
    return get_json(CREDIT_MONITOR_LATEST_KEY)

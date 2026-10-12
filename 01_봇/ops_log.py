"""Make swallowed exceptions visible without changing control flow.

Many collectors deliberately keep going when one source fails (Yahoo 429, Naver
blocks, a malformed row). That is fine, but a bare ``except Exception: pass``
also hides the failure from the logs and from /health. ``note_suppressed``
records the failure, prints at most one line per call site per window, and
exposes per-site counts through ``suppressed_summary()`` for the health check.

It must never raise: it runs inside ``except`` blocks.
"""

from __future__ import annotations
import path_setup  # noqa: F401  # numbered folders on sys.path

import os
import threading
import time
from typing import Any

_lock = threading.Lock()
# site -> [count, last_logged_monotonic, last_error_text, last_seen_epoch]
_sites: dict[str, list[Any]] = {}


def _window_seconds() -> float:
    try:
        return max(0.0, float(os.environ.get("SUPPRESSED_LOG_WINDOW_SECONDS", "600")))
    except ValueError:
        return 600.0


def note_suppressed(site: str, exc: BaseException | None = None) -> None:
    """Record an exception that the caller is intentionally ignoring."""
    try:
        text = f"{type(exc).__name__}: {exc}"[:300] if exc is not None else "unknown"
        now = time.monotonic()
        should_log = False
        with _lock:
            entry = _sites.get(site)
            if entry is None:
                entry = [0, None, "", 0.0]
                _sites[site] = entry
            entry[0] += 1
            entry[2] = text
            entry[3] = time.time()
            if entry[1] is None or now - entry[1] >= _window_seconds():
                entry[1] = now
                should_log = True
            count = entry[0]
        if should_log:
            print(f"[suppressed] {site} ({count}x so far): {text}", flush=True)
    except Exception:  # noqa: BLE001 — logging must never break the caller
        pass


def suppressed_summary(limit: int = 20) -> dict[str, Any]:
    """Top call sites by count, for /health and debugging."""
    with _lock:
        rows = [
            {"site": site, "count": e[0], "last_error": e[2], "last_seen": e[3]}
            for site, e in _sites.items()
        ]
    rows.sort(key=lambda r: r["count"], reverse=True)
    return {"sites": len(rows), "total": sum(r["count"] for r in rows), "top": rows[:limit]}

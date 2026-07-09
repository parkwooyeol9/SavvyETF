"""Defer heavy scheduled jobs briefly after process start (Render health check / RAM)."""

from __future__ import annotations

import os
import time

_SERVICE_STARTED: float | None = None


def mark_service_started() -> None:
    global _SERVICE_STARTED
    _SERVICE_STARTED = time.monotonic()


def startup_grace_seconds() -> int:
    raw = os.environ.get("SCHEDULER_STARTUP_GRACE_SECONDS", "180").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 180


def past_startup_grace() -> bool:
    grace = startup_grace_seconds()
    if grace <= 0 or _SERVICE_STARTED is None:
        return True
    return time.monotonic() - _SERVICE_STARTED >= grace


def startup_grace_status() -> str:
    if _SERVICE_STARTED is None:
        return "startup grace not armed"
    grace = startup_grace_seconds()
    if grace <= 0:
        return "startup grace disabled"
    remaining = grace - (time.monotonic() - _SERVICE_STARTED)
    if remaining <= 0:
        return "startup grace elapsed"
    return f"startup grace {int(remaining)}s remaining"

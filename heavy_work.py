"""Serialize memory-heavy work (yfinance warmup, summary, macro)."""

from __future__ import annotations

import os
import threading
import time

from memory_debug import log_memory
from scheduler_grace import past_startup_grace, startup_grace_status

# Work exclusion lock — held for the full duration of heavy work.
# Never re-acquire it from the owner thread for status reads (use _owner_lock).
_heavy_lock = threading.Lock()
_owner_lock = threading.Lock()
_owner: str | None = None
_yield_requested = threading.Event()


class HeavyWorkYield(Exception):
    """Low-priority work should stop and release the heavy-work lock."""


def _heavy_work_enabled() -> bool:
    return os.environ.get("HEAVY_WORK_SERIALIZE", "true").lower() not in {
        "0",
        "false",
        "no",
    }


def heavy_work_owner() -> str | None:
    """Return current owner without taking the work lock (avoids deadlock)."""
    with _owner_lock:
        return _owner


def request_heavy_work_yield() -> None:
    _yield_requested.set()


def clear_heavy_work_yield() -> None:
    _yield_requested.clear()


def heavy_work_status() -> str:
    owner = heavy_work_owner()
    return owner or "none"


def heavy_work_should_yield() -> bool:
    return _yield_requested.is_set()


def try_begin_heavy_work(label: str) -> bool:
    if not _heavy_work_enabled():
        return True

    acquired = _heavy_lock.acquire(blocking=False)
    if not acquired:
        return False

    global _owner
    with _owner_lock:
        _owner = label
    log_memory(f"heavy work begin: {label}")
    return True


def begin_heavy_work_blocking(label: str, *, timeout: float | None = None) -> bool:
    if not _heavy_work_enabled():
        return True

    deadline = None if timeout is None else time.monotonic() + timeout
    while True:
        if try_begin_heavy_work(label):
            return True
        if timeout is not None and time.monotonic() >= deadline:
            return False
        time.sleep(0.25)


def end_heavy_work(label: str | None = None, *, force: bool = False) -> None:
    if not _heavy_work_enabled():
        return

    global _owner
    # Owner already holds _heavy_lock. Do NOT re-acquire it — threading.Lock is
    # not reentrant and that deadlocks the scheduler threads permanently.
    with _owner_lock:
        if not force and label and _owner not in {None, label}:
            return
        _owner = None
    try:
        _heavy_lock.release()
    except RuntimeError:
        pass
    log_memory(f"heavy work end: {label or 'unknown'}")


def heavy_work_yield_point(label: str) -> None:
    if not heavy_work_should_yield():
        return
    print(f"{label}: yielding for higher-priority work")
    end_heavy_work(force=True)
    raise HeavyWorkYield()


def wait_for_startup_grace(label: str) -> None:
    while not past_startup_grace():
        print(f"{label}: waiting — {startup_grace_status()}")
        time.sleep(5)

"""Lightweight RSS logging for diagnosing OOM on small containers."""

from __future__ import annotations

import os
import resource
import sys


def rss_mb() -> float | None:
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except OSError:
        pass

    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return usage / (1024 * 1024)
    return usage / 1024


def memory_debug_enabled() -> bool:
    return os.environ.get("MEMORY_DEBUG", "true").lower() not in {"0", "false", "no"}


def log_memory(label: str) -> None:
    if not memory_debug_enabled():
        return
    rss = rss_mb()
    if rss is None:
        print(f"[mem] {label}")
    else:
        print(f"[mem] {label}: {rss:.1f} MB RSS")

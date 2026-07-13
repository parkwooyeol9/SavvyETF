"""Shared schedule-slot helpers for catch-up windows.

Exact ``minute == N`` checks miss jobs when:
  - startup grace overlaps the target minute
  - heavy-work lock is busy for >1 minute
  - poll drift wakes the loop at minute+1

Use a short catch-up window so due jobs still fire once per slot.
"""

from __future__ import annotations

from datetime import datetime, timedelta


DEFAULT_CATCHUP_MINUTES = 15


def due_slot_id(
    now: datetime,
    hour: int,
    minute: int = 0,
    *,
    last_slot: str | None,
    window_minutes: int = DEFAULT_CATCHUP_MINUTES,
    slot_fmt: str = "%Y-%m-%d-%H-%M",
) -> str | None:
    """Return slot id if ``now`` is within [scheduled, scheduled+window) and not done."""
    scheduled = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now < scheduled:
        return None
    if now >= scheduled + timedelta(minutes=max(1, window_minutes)):
        return None
    slot = scheduled.strftime(slot_fmt)
    if last_slot == slot:
        return None
    return slot


def due_hourly_slot_id(
    now: datetime,
    hours: list[int] | tuple[int, ...],
    *,
    last_slot: str | None,
    window_minutes: int = DEFAULT_CATCHUP_MINUTES,
) -> str | None:
    """Hourly jobs historically keyed as ``%Y-%m-%d-%H`` (minute forced to 00)."""
    if now.hour not in hours:
        return None
    return due_slot_id(
        now,
        now.hour,
        0,
        last_slot=last_slot,
        window_minutes=window_minutes,
        slot_fmt="%Y-%m-%d-%H",
    )

"""Shared schedule-slot helpers for catch-up windows.

Exact ``minute == N`` checks miss jobs when:
  - startup grace overlaps the target minute
  - heavy-work lock is busy for >1 minute
  - poll drift wakes the loop at minute+1
  - Render redeploy finishes after the target minute

Use a catch-up window so due jobs still fire once per slot.
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
    """Return the earliest due hourly slot still inside its catch-up window.

    Important: do **not** require ``now.hour in hours``. Otherwise a 11:00 job
    with a multi-hour catch-up cannot fire at 11:40 / 12:10 after a redeploy.
    """
    for hour in sorted({int(h) for h in hours}):
        if not 0 <= hour <= 23:
            continue
        slot = due_slot_id(
            now,
            hour,
            0,
            last_slot=last_slot,
            window_minutes=window_minutes,
            slot_fmt="%Y-%m-%d-%H",
        )
        if slot:
            return slot
    return None

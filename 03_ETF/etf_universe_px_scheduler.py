"""Daily ETF universe return refresh — one run per market group, each after its own close.

asia (kr, jp, cn) — 16:10 KST, Mon–Fri.
  Seoul and Tokyo closed at 15:30, Shanghai at 16:00 KST.
  The run takes about 3 minutes, between 15:40 summary_kor and 16:20 etfcheck.
west (us, eu, hk) — 07:40 KST, Tue–Sat (the KST morning after each session).
  The US cash close is in and the 07:00 US summary has had its slot.
  Hong Kong closes at 17:00 KST, inside the 17:15–18:20 Korea jobs, so it comes here.
  One run per group: a run before a market's close only re-publishes the previous close.

Each run rewrites only its group's markets in latest.json.
The job itself is mostly Yahoo I/O. It takes the shared heavy-work lock
so it does not run beside the Korea crawl or the summaries.
"""

from __future__ import annotations

import path_setup  # noqa: F401

import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
DEFAULT_POLL_SECONDS = 60
DEFAULT_CATCHUP_MINUTES = 40
DEFAULT_DEADLINE_SECONDS = 25 * 60
# A failed run used to retry every poll for the whole catch-up window.
# The try key ends in "_slot", so it is mirrored to R2 and survives a restart.
MAX_ATTEMPTS_PER_SLOT = 2


@dataclass(frozen=True)
class Group:
    name: str
    env: str
    default_time: str
    # KST weekdays (Mon=0) on which the slot runs.
    weekdays: frozenset[int]
    # State key infix. Asia keeps the original keys so health history carries on.
    key: str

    def state(self, field: str) -> str:
        return f"last_etf_universe_px{self.key}_{field}"


GROUPS = (
    Group("asia", "ETF_UNIVERSE_PX_SCHEDULE_KST", "16:10", frozenset({0, 1, 2, 3, 4}), ""),
    Group("west", "ETF_UNIVERSE_PX_WEST_SCHEDULE_KST", "07:40", frozenset({1, 2, 3, 4, 5}), "_west"),
)


def _attempts_used(group: Group, slot: str) -> int:
    raw = str(_load_state().get(group.state("try_slot")) or "")
    tried_slot, _, count = raw.rpartition("#")
    if tried_slot != slot:
        return 0
    try:
        return int(count)
    except ValueError:
        return 0


def _schedule_time_kst(group: Group) -> tuple[int, int]:
    raw = os.environ.get(group.env, group.default_time).strip()
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour = int(hour_s)
        minute = int(minute_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    hour_s, minute_s = group.default_time.split(":", 1)
    return int(hour_s), int(minute_s)


def _catchup_minutes() -> int:
    try:
        return max(15, min(50, int(os.environ.get("ETF_UNIVERSE_PX_CATCHUP_MINUTES", str(DEFAULT_CATCHUP_MINUTES)))))
    except ValueError:
        return DEFAULT_CATCHUP_MINUTES


def _enabled() -> bool:
    return os.environ.get("ETF_UNIVERSE_PX_SCHEDULE_ENABLED", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def run_scheduled_etf_universe_px(group: Group = GROUPS[0]) -> bool:
    from etf_universe_px import MARKET_GROUPS, build_payload, publish
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    label = f"scheduled-etf-universe-px-{group.name}"
    if not begin_heavy_work_blocking(label, timeout=120):
        print(f"Scheduled etf_universe_px {group.name} skipped: heavy work still busy ({heavy_work_status()})")
        update_scheduler_state(**{group.state("error"): f"heavy work busy ({heavy_work_status()})"})
        return False
    try:
        update_scheduler_state(**{group.state("attempt_at"): datetime.now(KST).isoformat()})
        payload = build_payload(
            markets=MARKET_GROUPS[group.name],
            deadline=time.time() + DEFAULT_DEADLINE_SECONDS,
        )
        uploaded = publish(payload)
        print(
            f"Scheduled etf_universe_px {group.name}: "
            f"as_of={payload.get('as_of')} returns={payload.get('n_with_returns')} "
            f"backfill={payload.get('n_backfill')} bump={payload.get('n_bump')} "
            f"uploaded={uploaded}"
        )
        update_scheduler_state(**{
            group.state("ok_at"): datetime.now(KST).isoformat(),
            group.state("as_of"): payload.get("as_of"),
            group.state("error"): "" if uploaded or payload.get("n_with_returns") else "upload failed",
        })
        return bool(payload.get("n_with_returns"))
    except Exception as exc:
        print(f"Scheduled etf_universe_px {group.name} failed: {exc}")
        update_scheduler_state(**{group.state("error"): str(exc)})
        return False
    finally:
        end_heavy_work(label)


def start_etf_universe_px_scheduler() -> None:
    if not _enabled():
        print("etf_universe_px scheduler disabled.")
        return
    times = {group.name: _schedule_time_kst(group) for group in GROUPS}
    catchup = _catchup_minutes()

    def loop() -> None:
        state = _load_state()
        last_slots = {group.name: state.get(group.state("slot")) for group in GROUPS}
        print(
            "etf_universe_px scheduler active — "
            + ", ".join(f"{name} {h:02d}:{m:02d} KST" for name, (h, m) in times.items())
            + f" ({catchup}m catch-up)"
        )
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(DEFAULT_POLL_SECONDS)
                    continue
                now = datetime.now(KST)
                update_scheduler_state(etf_universe_px_scheduler_heartbeat=now.isoformat())
                for group in GROUPS:
                    hour, minute = times[group.name]
                    slot = due_slot_id(
                        now, hour, minute, last_slot=last_slots[group.name], window_minutes=catchup
                    )
                    if not slot:
                        continue
                    if now.weekday() not in group.weekdays:
                        print(f"Scheduled etf_universe_px {group.name} skipped ({slot}): no new session")
                    elif _attempts_used(group, slot) >= MAX_ATTEMPTS_PER_SLOT:
                        print(
                            f"Scheduled etf_universe_px {group.name} gave up ({slot}): "
                            f"{MAX_ATTEMPTS_PER_SLOT} attempts used"
                        )
                    else:
                        # Count the attempt before running: an out-of-memory restart never reaches the end.
                        update_scheduler_state(**{
                            group.state("try_slot"): f"{slot}#{_attempts_used(group, slot) + 1}"
                        })
                        if not run_scheduled_etf_universe_px(group):
                            continue
                    last_slots[group.name] = slot
                    update_scheduler_state(**{group.state("slot"): slot})
            except Exception as exc:
                print(f"etf_universe_px scheduler loop error: {exc}")
            time.sleep(DEFAULT_POLL_SECONDS)

    thread = threading.Thread(target=loop, name="etf-universe-px-scheduler", daemon=True)
    thread.start()

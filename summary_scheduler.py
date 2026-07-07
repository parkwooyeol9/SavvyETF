import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from summary_builder import KST, caches_ready, generate_and_save_summary

PROJECT_DIR = Path(__file__).resolve().parent
SCHEDULER_STATE_PATH = PROJECT_DIR / "data" / "scheduler_state.json"
DEFAULT_SCHEDULE_HOURS = (6, 22)


def _schedule_hours() -> tuple[int, ...]:
    raw = os.environ.get("SUMMARY_SCHEDULE_HOURS_KST", "6,22")
    return tuple(int(part.strip()) for part in raw.split(",") if part.strip())


def _load_last_slot() -> str | None:
    if not SCHEDULER_STATE_PATH.exists():
        return None
    try:
        data = json.loads(SCHEDULER_STATE_PATH.read_text(encoding="utf-8"))
        return data.get("last_slot")
    except (json.JSONDecodeError, OSError):
        return None


def _save_last_slot(slot: str) -> None:
    SCHEDULER_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEDULER_STATE_PATH.write_text(
        json.dumps({"last_slot": slot}, indent=2),
        encoding="utf-8",
    )


def _current_slot(now: datetime) -> str:
    return now.strftime("%Y-%m-%d-%H")


def run_scheduled_summary(
    token: str,
    broadcast_fn,
    refresh_cache_fn,
    public_url: str = "",
) -> bool:
    if not caches_ready():
        print("Scheduled summary skipped: caches not ready.")
        return False

    try:
        refresh_cache_fn()
        summary = generate_and_save_summary(public_url=public_url)
        messages = summary["telegram_messages"]
        broadcast_fn(token, messages)
        print(f"Scheduled summary sent ({len(messages)} message(s)).")
        return True
    except Exception as exc:
        print(f"Scheduled summary failed: {exc}")
        return False


def start_summary_scheduler(
    token: str,
    broadcast_fn,
    refresh_cache_fn,
    public_url: str = "",
) -> None:
    if os.environ.get("SUMMARY_SCHEDULE_ENABLED", "true").lower() in {"0", "false", "no"}:
        print("Summary scheduler disabled.")
        return

    hours = _schedule_hours()

    def loop() -> None:
        last_slot = _load_last_slot()
        print(f"Summary scheduler active (KST hours: {hours})")
        while True:
            now = datetime.now(KST)
            if now.hour in hours and now.minute == 0:
                slot = _current_slot(now)
                if slot != last_slot:
                    if run_scheduled_summary(token, broadcast_fn, refresh_cache_fn, public_url):
                        last_slot = slot
                        _save_last_slot(slot)
            time.sleep(20)

    thread = threading.Thread(target=loop, name="summary-scheduler", daemon=True)
    thread.start()

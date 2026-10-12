"""Daily AI 시황 refresh — default 05:10 KST, every day.

The Claude pipeline (``Claude_DB/ai_pulse``) collects guru, developer, hiring,
and economy series into local CSVs, then ``export_web.py --upload`` publishes
``ai_pulse/{pulse,economy}/latest.json`` for the public tab.

05:10 sits in the open dawn gap. The bot's first heavy job is the US summary
at 07:00 (45-minute catch-up). Vercel money-flow runs at 03:30. A 50-minute
catch-up closes this slot at 06:00, so a late start still finishes before 07:00.

History CSVs are not in git. They are kept in R2 at
``ai_pulse/state/data.tar.gz`` and restored when the container disk is empty.
There is no launchd job; the earlier 07:30 Mac draft overlaps the US summary.
"""

from __future__ import annotations

import io
import os
import subprocess
import sys
import tarfile
import threading
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from scheduler_grace import past_startup_grace
from scheduler_slots import due_slot_id
from summary_scheduler import _load_state, update_scheduler_state

KST = ZoneInfo("Asia/Seoul")
REPO_ROOT = Path(__file__).resolve().parent
PULSE_ROOT = REPO_ROOT / "Claude_DB" / "ai_pulse"
CODE_DIR = PULSE_ROOT / "4_코드"
DATA_DIR = PULSE_ROOT / "2_결과물" / "data"
STATE_KEY = "ai_pulse/state/data.tar.gz"

DEFAULT_HOUR_KST = 5
DEFAULT_MINUTE_KST = 10
DEFAULT_POLL_SECONDS = 60
DEFAULT_CATCHUP_MINUTES = 50


def _schedule_time_kst() -> tuple[int, int]:
    raw = os.environ.get("AI_PULSE_SCHEDULE_KST", "5:10").strip()
    try:
        hour_s, minute_s = raw.split(":", 1)
        hour = int(hour_s)
        minute = int(minute_s)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return DEFAULT_HOUR_KST, DEFAULT_MINUTE_KST


def _catchup_minutes() -> int:
    try:
        return max(20, int(os.environ.get("AI_PULSE_CATCHUP_MINUTES", str(DEFAULT_CATCHUP_MINUTES))))
    except ValueError:
        return DEFAULT_CATCHUP_MINUTES


def _enabled() -> bool:
    return os.environ.get("AI_PULSE_SCHEDULE_ENABLED", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _pack_state(data_dir: Path) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in sorted(data_dir.iterdir()):
            if path.is_file() and path.suffix.lower() in {".csv", ".json"}:
                tar.add(path, arcname=path.name)
    return buf.getvalue()


def _unpack_state(blob: bytes, data_dir: Path) -> int:
    data_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            name = Path(member.name).name
            if Path(name).suffix.lower() not in {".csv", ".json"}:
                continue
            src = tar.extractfile(member)
            if src is None:
                continue
            (data_dir / name).write_bytes(src.read())
            written += 1
    return written


def restore_state(data_dir: Path = DATA_DIR) -> bool:
    """Load yesterday's CSVs when this disk has none (fresh Render container)."""
    if any(data_dir.glob("*.csv")):
        return True
    from r2_data import get_bytes

    blob = get_bytes(STATE_KEY)
    if not blob:
        print("ai_pulse: no history archive on R2 — first run starts empty")
        return False
    n = _unpack_state(blob, data_dir)
    print(f"ai_pulse: restored {n} history files from R2")
    return n > 0


def save_state(data_dir: Path = DATA_DIR) -> bool:
    if not data_dir.is_dir() or not any(data_dir.glob("*.csv")):
        return False
    from r2_data import put_bytes

    blob = _pack_state(data_dir)
    ok = put_bytes(
        STATE_KEY,
        blob,
        "application/gzip",
        cache_control="private, max-age=300",
    )
    print(f"ai_pulse: history archive {'saved' if ok else 'not saved'} ({len(blob)} bytes)")
    return ok


def _published_today() -> bool:
    from r2_data import get_json

    today = datetime.now(KST).date().isoformat()
    for key in ("ai_pulse/pulse/latest.json", "ai_pulse/economy/latest.json"):
        doc = get_json(key)
        generated = str(doc.get("generated") or "")[:10] if isinstance(doc, dict) else ""
        if generated != today:
            print(f"ai_pulse: {key} generated={generated or 'missing'} wanted {today}")
            return False
    return True


def _run_step(script: str, *args: str, timeout: int) -> bool:
    path = CODE_DIR / script
    if not path.is_file():
        print(f"ai_pulse: missing {path}")
        return False
    env = os.environ.copy()
    env["SAVVYETF_DIR"] = str(REPO_ROOT)
    env.setdefault("PYTHONUNBUFFERED", "1")
    cmd = [sys.executable, str(path), *args]
    print(f"ai_pulse: start {script} {' '.join(args)}".rstrip())
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(PULSE_ROOT),
            env=env,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print(f"ai_pulse: {script} timed out after {timeout}s")
        return False
    if proc.returncode != 0:
        print(f"ai_pulse: {script} exit {proc.returncode}")
        return False
    return True


def run_scheduled_ai_pulse() -> bool:
    from heavy_work import begin_heavy_work_blocking, end_heavy_work, heavy_work_status

    update_scheduler_state(last_ai_pulse_attempt_at=datetime.now(KST).isoformat())
    if not begin_heavy_work_blocking("scheduled-ai-pulse", timeout=180):
        print(f"Scheduled ai_pulse skipped: heavy work still busy ({heavy_work_status()})")
        update_scheduler_state(last_ai_pulse_error=f"heavy work busy ({heavy_work_status()})")
        return False
    try:
        restore_state()
        fetch_ok = _run_step("fetch_all.py", timeout=20 * 60)
        if fetch_ok or any(DATA_DIR.glob("*.csv")):
            _run_step("build_dashboard.py", timeout=120)
        econ_ok = _run_step("fetch_economy.py", timeout=15 * 60)
        if econ_ok or (DATA_DIR / "econ_status.json").is_file():
            _run_step("build_economy.py", timeout=120)
        exported = _run_step("export_web.py", "--upload", timeout=180)
        save_state()
        fresh = exported and _published_today()
        if fresh:
            update_scheduler_state(
                last_ai_pulse_ok_at=datetime.now(KST).isoformat(),
                last_ai_pulse_error=None,
            )
            print("Scheduled ai_pulse: R2 latest JSON is today")
        else:
            update_scheduler_state(last_ai_pulse_error="export did not publish today's JSON")
            print("Scheduled ai_pulse: publish check failed")
        return fresh
    except Exception as exc:
        print(f"Scheduled ai_pulse failed: {exc}")
        update_scheduler_state(last_ai_pulse_error=str(exc)[:300])
        return False
    finally:
        end_heavy_work("scheduled-ai-pulse")


def start_ai_pulse_scheduler() -> None:
    if not _enabled():
        print("ai_pulse scheduler disabled.")
        return

    hour, minute = _schedule_time_kst()
    catchup_minutes = _catchup_minutes()

    def loop() -> None:
        last_slot = _load_state().get("last_ai_pulse_slot")
        print(
            f"ai_pulse scheduler active — daily {hour:02d}:{minute:02d} KST "
            f"({catchup_minutes}m catch-up)"
        )
        while True:
            try:
                if not past_startup_grace():
                    time.sleep(DEFAULT_POLL_SECONDS)
                    continue
                now = datetime.now(KST)
                update_scheduler_state(ai_pulse_scheduler_heartbeat=now.isoformat())
                slot = due_slot_id(
                    now,
                    hour,
                    minute,
                    last_slot=last_slot,
                    window_minutes=catchup_minutes,
                )
                if slot and run_scheduled_ai_pulse():
                    last_slot = slot
                    update_scheduler_state(last_ai_pulse_slot=slot)
            except Exception as exc:
                print(f"ai_pulse scheduler loop error: {exc}")
            time.sleep(DEFAULT_POLL_SECONDS)

    threading.Thread(target=loop, name="ai-pulse-scheduler", daemon=True).start()

"""Run ETF CHECK Playwright captures in short-lived child processes."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from memory_debug import log_memory

PROJECT_DIR = Path(__file__).resolve().parent
WORKER_SCRIPT = PROJECT_DIR / "etfcheck_worker.py"
_capture_lock = threading.Lock()


def try_begin_etfcheck_capture() -> bool:
    return _capture_lock.acquire(blocking=False)


def end_etfcheck_capture() -> None:
    try:
        _capture_lock.release()
    except RuntimeError:
        pass


def run_capture_in_subprocess(mode: str) -> Path:
    """
    Spawn a fresh Python process for one screenshot capture.

    When the child exits, Chromium + Playwright driver RAM is returned to the OS.
    This prevents /etfcheck repeats from accumulating leaked browser memory in the bot.
    """
    if mode not in {"volume", "inflow"}:
        raise ValueError(f"unsupported capture mode: {mode}")

    log_memory(f"etfcheck parent before subprocess ({mode})")
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
        output_path = Path(handle.name)

    cmd = [sys.executable, str(WORKER_SCRIPT), mode, str(output_path)]
    try:
        subprocess.run(
            cmd,
            check=True,
            timeout=_subprocess_timeout(),
            cwd=str(PROJECT_DIR),
            env=os.environ.copy(),
        )
    except Exception:
        output_path.unlink(missing_ok=True)
        raise

    if not output_path.exists() or output_path.stat().st_size == 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(f"ETF CHECK worker produced no output for mode={mode}")

    size_kb = output_path.stat().st_size // 1024
    log_memory(f"etfcheck parent after subprocess ({mode}, {size_kb} KB file)")
    return output_path


def _subprocess_timeout() -> int:
    raw = os.environ.get("ETFCHECK_SUBPROCESS_TIMEOUT", "120").strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return 120


def cleanup_capture_file(path: Path | None) -> None:
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass

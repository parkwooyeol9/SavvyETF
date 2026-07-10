"""Run ETF CHECK Playwright captures in short-lived child processes."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from heavy_work import (
    begin_heavy_work_blocking,
    clear_heavy_work_yield,
    end_heavy_work,
    request_heavy_work_yield,
    try_begin_heavy_work,
)
from memory_debug import log_memory

PROJECT_DIR = Path(__file__).resolve().parent
WORKER_SCRIPT = PROJECT_DIR / "etfcheck_worker.py"


def try_begin_etfcheck_capture() -> bool:
    request_heavy_work_yield()
    return try_begin_heavy_work("etfcheck-capture")


def end_etfcheck_capture() -> None:
    clear_heavy_work_yield()
    end_heavy_work("etfcheck-capture")


def run_capture_in_subprocess(mode: str) -> Path:
    """
    Spawn a fresh Python process for one screenshot capture.

    When the child exits, Chromium + Playwright driver RAM is returned to the OS.
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


def begin_etfcheck_capture_blocking() -> bool:
    request_heavy_work_yield()
    return begin_heavy_work_blocking("etfcheck-capture")


def run_capture_with_heavy_lock(mode: str) -> Path:
    if not begin_etfcheck_capture_blocking():
        raise RuntimeError("another heavy task is running")
    try:
        return run_capture_in_subprocess(mode)
    finally:
        end_etfcheck_capture()

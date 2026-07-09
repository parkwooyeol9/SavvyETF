"""ETF CHECK capture pipeline for /etfcheck."""

from __future__ import annotations

import io
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from etfcheck_capture import (
    _capture_gap_seconds,
    format_etfcheck_telegram,
    format_etfcheck_turnover_telegram,
)
from etfcheck_subprocess import cleanup_capture_file, run_capture_in_subprocess
from memory_debug import log_memory

KST = ZoneInfo("Asia/Seoul")


def _photo_message(text: str, image_path: Path) -> dict:
    return {"text": text, "photo_path": image_path}


def _load_photo_bytes(path: Path) -> io.BytesIO:
    buffer = io.BytesIO(path.read_bytes())
    buffer.seek(0)
    return buffer


def run_etfcheck_turnover_capture() -> dict:
    generated_at = datetime.now(KST)
    image_path: Path | None = None
    try:
        image_path = run_capture_in_subprocess("volume")
        text = format_etfcheck_turnover_telegram(
            {"generated_at": generated_at.isoformat(), "source": "etfcheck.co.kr"}
        )
        telegram_messages = [
            {
                "text": "🇰🇷 ETF CHECK — 일간 거래대금 TOP\n(한국 ETF · 당일 · 장마감 후)",
                "photo": _load_photo_bytes(image_path),
            },
            {"text": text, "parse_mode": "HTML"},
        ]
        return {
            "generated_at": generated_at.isoformat(),
            "text_summary": text,
            "telegram_messages": telegram_messages,
        }
    finally:
        cleanup_capture_file(image_path)


def iter_etfcheck_capture_messages() -> list[dict]:
    """
  Yield Telegram payloads one capture at a time.

    Each Playwright run happens in a child process so Chromium RAM is freed
    before the next capture starts.
    """
    generated_at = datetime.now(KST).isoformat()
    gap = _capture_gap_seconds()
    volume_path: Path | None = None
    inflow_path: Path | None = None

    messages: list[dict] = []

    try:
        log_memory("etfcheck /etfcheck volume capture begin")
        volume_path = run_capture_in_subprocess("volume")
        messages.append(
            _photo_message(
                "🇰🇷 ETF CHECK — 일간 거래대금 TOP\n(한국 ETF · 당일)",
                volume_path,
            )
        )

        print(f"ETF CHECK: waiting {gap}s between subprocess captures")
        time.sleep(gap)

        log_memory("etfcheck /etfcheck inflow capture begin")
        inflow_path = run_capture_in_subprocess("inflow")
        messages.append(
            _photo_message(
                f"🇰🇷 ETF CHECK — 일간 순유입 TOP\n(한국 ETF · 전일 · +{gap}s 후 2nd capture)",
                inflow_path,
            )
        )

        text = format_etfcheck_telegram(
            {
                "generated_at": generated_at,
                "source": "etfcheck.co.kr",
            }
        )
        messages.append({"text": text, "parse_mode": "HTML"})
        return messages
    except Exception:
        cleanup_capture_file(volume_path)
        cleanup_capture_file(inflow_path)
        raise


def run_etfcheck_capture() -> dict:
    """Backward-compatible wrapper; prefer iter_etfcheck_capture_messages in bot."""
    messages = iter_etfcheck_capture_messages()
    return {
        "text_summary": next(
            (message["text"] for message in reversed(messages) if message.get("parse_mode") == "HTML"),
            "",
        ),
        "telegram_messages": messages,
    }

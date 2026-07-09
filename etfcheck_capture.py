"""Capture ETF CHECK (etfcheck.co.kr) ranking screens for /etfcheck."""

from __future__ import annotations

import gc
import io
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from etfcheck_browser import etfcheck_browser_context, _jpeg_quality
from memory_debug import log_memory

KST = ZoneInfo("Asia/Seoul")
BASE_URL = "https://www.etfcheck.co.kr"

VOLUME_URL = f"{BASE_URL}/mobile/rank/volume"
INFLOW_URL = f"{BASE_URL}/mobile/rank/inflow"


def _viewport() -> dict[str, int]:
    width = int(os.environ.get("ETFCHECK_VIEWPORT_WIDTH", "430"))
    height = int(os.environ.get("ETFCHECK_VIEWPORT_HEIGHT", "1000"))
    return {"width": width, "height": height}


def _wait_ms() -> int:
    try:
        return max(1000, int(os.environ.get("ETFCHECK_RENDER_WAIT_MS", "3000")))
    except ValueError:
        return 3000


def _capture_gap_seconds() -> int:
    raw = os.environ.get("ETFCHECK_CAPTURE_GAP_SECONDS", "30").strip()
    try:
        return max(5, int(raw))
    except ValueError:
        return 30


def _dismiss_overlays(page) -> None:
    for selector in (
        "button[aria-label='clear']",
        ".v-dialog .v-btn:has-text('닫기')",
        ".v-dialog .v-btn:has-text('확인')",
        ".v-dialog .v-btn:has-text('동의')",
    ):
        try:
            locator = page.locator(selector).first
            if locator.is_visible(timeout=800):
                locator.click(timeout=1500)
        except Exception:
            pass


def _wait_rank_table(page) -> None:
    page.wait_for_selector("button:has-text('더보기')", timeout=20000)
    page.wait_for_timeout(_wait_ms())


def _select_period_option(page, option_text: str) -> None:
    page.locator(".v-input.select_1").click(timeout=5000)
    page.wait_for_timeout(500)
    if option_text == "전일":
        page.keyboard.press("ArrowUp")
    page.keyboard.press("Enter")
    page.wait_for_timeout(800)


def _capture_page_bytes(page) -> bytes:
    # JPEG keeps Telegram payloads and peak RAM much lower than full-page PNG.
    return page.screenshot(full_page=True, type="jpeg", quality=_jpeg_quality())


def _capture_page(page) -> io.BytesIO:
    buffer = io.BytesIO(_capture_page_bytes(page))
    buffer.seek(0)
    return buffer


def capture_volume_turnover_daily(page) -> io.BytesIO:
    page.goto(VOLUME_URL, wait_until="domcontentloaded", timeout=45000)
    _dismiss_overlays(page)
    page.get_by_role("button", name="한국").click(timeout=5000)
    page.get_by_role("button", name="거래대금").click(timeout=5000)
    _wait_rank_table(page)
    log_memory("volume page ready")
    return _capture_page(page)


def capture_inflow_daily(page) -> io.BytesIO:
    page.goto(INFLOW_URL, wait_until="domcontentloaded", timeout=45000)
    _dismiss_overlays(page)
    page.get_by_role("button", name="한국").click(timeout=5000)
    _select_period_option(page, "전일")
    page.get_by_role("button", name="순유입").click(timeout=5000)
    _wait_rank_table(page)
    log_memory("inflow page ready")
    return _capture_page(page)


def _capture_volume_standalone() -> io.BytesIO:
    with etfcheck_browser_context(_viewport()) as context:
        page = context.new_page()
        try:
            return capture_volume_turnover_daily(page)
        finally:
            page.close()


def _capture_inflow_standalone() -> io.BytesIO:
    with etfcheck_browser_context(_viewport()) as context:
        page = context.new_page()
        try:
            return capture_inflow_daily(page)
        finally:
            page.close()


def capture_volume_to_file(output: Path) -> None:
    shot = _capture_volume_standalone()
    try:
        output.write_bytes(shot.getbuffer())
    finally:
        shot.close()


def capture_inflow_to_file(output: Path) -> None:
    shot = _capture_inflow_standalone()
    try:
        output.write_bytes(shot.getbuffer())
    finally:
        shot.close()


def _wait_between_captures() -> None:
    gap = _capture_gap_seconds()
    print(f"ETF CHECK: waiting {gap}s between browser sessions for memory reclaim")
    time.sleep(gap)
    gc.collect()


def capture_turnover_only() -> dict[str, Any]:
    generated_at = datetime.now(KST)
    return {
        "generated_at": generated_at.isoformat(),
        "source": "etfcheck.co.kr",
        "screenshots": {"volume_turnover": _capture_volume_standalone()},
    }


def capture_inflow_only() -> dict[str, Any]:
    generated_at = datetime.now(KST)
    return {
        "generated_at": generated_at.isoformat(),
        "source": "etfcheck.co.kr",
        "screenshots": {"inflow_daily": _capture_inflow_standalone()},
    }


def capture_etfcheck_screenshots() -> dict[str, Any]:
    """
    Legacy in-process capture (two browser sessions).

    Prefer etfcheck_subprocess.run_capture_in_subprocess() from the bot process.
    """
    generated_at = datetime.now(KST)
    volume_shot = _capture_volume_standalone()
    _wait_between_captures()
    inflow_shot = _capture_inflow_standalone()
    return {
        "generated_at": generated_at.isoformat(),
        "source": "etfcheck.co.kr",
        "screenshots": {
            "volume_turnover": volume_shot,
            "inflow_daily": inflow_shot,
        },
    }


def format_etfcheck_turnover_telegram(result: dict[str, Any]) -> str:
    ts = datetime.fromisoformat(result["generated_at"]).strftime("%Y-%m-%d %H:%M KST")
    return (
        "<b>🇰🇷 ETF CHECK 일간 거래대금</b>\n"
        f"<i>{ts}</i>\n"
        f"출처: <a href=\"{BASE_URL}\">etfcheck.co.kr</a> (코스콤)\n"
        "한국 ETF · 당일 거래대금 TOP\n"
        "<i>장마감 후 15:45 KST 자동 캡처 (브라우저 1회)</i>"
    )


def format_etfcheck_telegram(result: dict[str, Any]) -> str:
    ts = datetime.fromisoformat(result["generated_at"]).strftime("%Y-%m-%d %H:%M KST")
    gap = _capture_gap_seconds()
    return (
        "<b>🇰🇷 ETF CHECK 랭킹 캡처</b>\n"
        f"<i>{ts}</i>\n"
        f"출처: <a href=\"{BASE_URL}\">etfcheck.co.kr</a> (코스콤)\n\n"
        "1️⃣ 일간 거래대금 TOP (한국 ETF, 당일)\n"
        "2️⃣ 일간 순유입 TOP (한국 ETF, 전일)\n\n"
        f"<i>메모리 절약: 브라우저 2회 분리 캡처 (간격 {gap}s)</i>"
    )

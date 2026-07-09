"""Capture ETF CHECK (etfcheck.co.kr) ranking screens for /etfcheck."""

from __future__ import annotations

import io
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
BASE_URL = "https://www.etfcheck.co.kr"
MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)

VOLUME_URL = f"{BASE_URL}/mobile/rank/volume"
INFLOW_URL = f"{BASE_URL}/mobile/rank/inflow"


def _viewport() -> dict[str, int]:
    width = int(os.environ.get("ETFCHECK_VIEWPORT_WIDTH", "430"))
    height = int(os.environ.get("ETFCHECK_VIEWPORT_HEIGHT", "1400"))
    return {"width": width, "height": height}


def _wait_ms() -> int:
    try:
        return max(1000, int(os.environ.get("ETFCHECK_RENDER_WAIT_MS", "3500")))
    except ValueError:
        return 3500


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


def _capture_page(page, *, clip_height: int | None = None) -> io.BytesIO:
    if clip_height:
        shot = page.screenshot(full_page=False, clip={"x": 0, "y": 0, "width": _viewport()["width"], "height": clip_height})
    else:
        shot = page.screenshot(full_page=True)
    buffer = io.BytesIO(shot)
    buffer.seek(0)
    return buffer


def capture_volume_turnover_daily(page) -> io.BytesIO:
    page.goto(VOLUME_URL, wait_until="domcontentloaded", timeout=45000)
    _dismiss_overlays(page)
    page.get_by_role("button", name="한국").click(timeout=5000)
    page.get_by_role("button", name="거래대금").click(timeout=5000)
    _wait_rank_table(page)
    return _capture_page(page)


def capture_inflow_daily(page) -> io.BytesIO:
    page.goto(INFLOW_URL, wait_until="domcontentloaded", timeout=45000)
    _dismiss_overlays(page)
    page.get_by_role("button", name="한국").click(timeout=5000)
    _select_period_option(page, "전일")
    page.get_by_role("button", name="순유입").click(timeout=5000)
    _wait_rank_table(page)
    return _capture_page(page)


def capture_turnover_only() -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    generated_at = datetime.now(KST)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport=_viewport(),
            user_agent=MOBILE_UA,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = context.new_page()
        try:
            shot = capture_volume_turnover_daily(page)
        finally:
            context.close()
            browser.close()

    return {
        "generated_at": generated_at.isoformat(),
        "source": "etfcheck.co.kr",
        "screenshots": {"volume_turnover": shot},
    }


def capture_etfcheck_screenshots() -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    generated_at = datetime.now(KST)
    shots: dict[str, io.BytesIO] = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport=_viewport(),
            user_agent=MOBILE_UA,
            locale="ko-KR",
            timezone_id="Asia/Seoul",
        )
        page = context.new_page()
        try:
            shots["volume_turnover"] = capture_volume_turnover_daily(page)
            shots["inflow_daily"] = capture_inflow_daily(page)
        finally:
            context.close()
            browser.close()

    return {
        "generated_at": generated_at.isoformat(),
        "source": "etfcheck.co.kr",
        "screenshots": shots,
    }


def format_etfcheck_turnover_telegram(result: dict[str, Any]) -> str:
    ts = datetime.fromisoformat(result["generated_at"]).strftime("%Y-%m-%d %H:%M KST")
    return (
        "<b>🇰🇷 ETF CHECK 일간 거래대금</b>\n"
        f"<i>{ts}</i>\n"
        f"출처: <a href=\"{BASE_URL}\">etfcheck.co.kr</a> (코스콤)\n"
        "한국 ETF · 당일 거래대금 TOP\n"
        "<i>장마감 후 데이터 반영 시점에 자동 캡처</i>"
    )


def format_etfcheck_telegram(result: dict[str, Any]) -> str:
    ts = datetime.fromisoformat(result["generated_at"]).strftime("%Y-%m-%d %H:%M KST")
    return (
        "<b>🇰🇷 ETF CHECK 랭킹 캡처</b>\n"
        f"<i>{ts}</i>\n"
        f"출처: <a href=\"{BASE_URL}\">etfcheck.co.kr</a> (코스콤)\n\n"
        "1️⃣ 일간 거래대금 TOP (한국 ETF, 당일)\n"
        "2️⃣ 일간 순유입 TOP (한국 ETF, 전일)\n\n"
        "<i>공식 Open API 없음 — 웹 화면 캡처 방식</i>"
    )

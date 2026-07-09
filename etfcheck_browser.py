"""Shared low-memory Playwright browser helpers for ETF CHECK."""

from __future__ import annotations

import gc
from contextlib import contextmanager
from typing import Iterator

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)

# Keep Chromium lean on 512MB Render instances.
CHROMIUM_ARGS = [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--mute-audio",
    "--no-first-run",
    "--js-flags=--max-old-space-size=192",
]


@contextmanager
def etfcheck_browser_context(viewport: dict[str, int]) -> Iterator:
    from playwright.sync_api import sync_playwright

    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=True, args=CHROMIUM_ARGS)
    context = browser.new_context(
        viewport=viewport,
        user_agent=MOBILE_UA,
        locale="ko-KR",
        timezone_id="Asia/Seoul",
    )
    try:
        yield context
    finally:
        context.close()
        browser.close()
        playwright.stop()
        gc.collect()

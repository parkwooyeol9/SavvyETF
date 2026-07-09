"""Shared low-memory Playwright browser helpers for ETF CHECK."""

from __future__ import annotations

import gc
import os
from contextlib import contextmanager
from typing import Iterator

from memory_debug import log_memory

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
    "--disable-features=TranslateUI",
    "--js-flags=--max-old-space-size=128",
]


def _jpeg_quality() -> int:
    raw = os.environ.get("ETFCHECK_JPEG_QUALITY", "72").strip()
    try:
        return max(40, min(95, int(raw)))
    except ValueError:
        return 72


def _launch_chromium(playwright):
    launch_kwargs = {"headless": True, "args": CHROMIUM_ARGS}
    channel = os.environ.get("ETFCHECK_CHROMIUM_CHANNEL", "chromium-headless-shell").strip()
    if channel:
        try:
            return playwright.chromium.launch(channel=channel, **launch_kwargs)
        except Exception as exc:
            print(f"ETF CHECK: chromium channel {channel!r} unavailable ({exc}); using bundled Chromium")
    return playwright.chromium.launch(**launch_kwargs)


@contextmanager
def etfcheck_browser_context(viewport: dict[str, int]) -> Iterator:
    from playwright.sync_api import sync_playwright

    log_memory("playwright start")
    playwright = sync_playwright().start()
    browser = _launch_chromium(playwright)
    context = browser.new_context(
        viewport=viewport,
        user_agent=MOBILE_UA,
        locale="ko-KR",
        timezone_id="Asia/Seoul",
    )
    try:
        yield context
    finally:
        try:
            context.close()
        except Exception:
            pass
        try:
            browser.close()
        except Exception:
            pass
        try:
            playwright.stop()
        except Exception:
            pass
        gc.collect()
        log_memory("playwright stopped")

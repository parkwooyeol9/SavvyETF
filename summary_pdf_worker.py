"""Playwright worker: HTML file -> PDF (isolated subprocess)."""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: summary_pdf_worker.py <input.html> <output.pdf>")

    html_path = Path(sys.argv[1]).resolve()
    pdf_path = Path(sys.argv[2]).resolve()
    if not html_path.is_file():
        raise SystemExit(f"HTML file not found: {html_path}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(html_path.as_uri(), wait_until="networkidle", timeout=90_000)
            page.pdf(
                path=str(pdf_path),
                format="A4",
                print_background=True,
                margin={"top": "12mm", "right": "10mm", "bottom": "12mm", "left": "10mm"},
            )
        finally:
            browser.close()


if __name__ == "__main__":
    main()

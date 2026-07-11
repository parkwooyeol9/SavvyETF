"""Build /summary PDF with Pillow only (no matplotlib file handles).

Charts must already be PNG bytes (or anything convertible via getvalue/read).
Text pages are drawn with ImageDraw + a downloaded CJK TTF.
"""

from __future__ import annotations

import re
import textwrap
from io import BytesIO
from pathlib import Path

from ai_briefing import _strip_disclaimer

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
SUMMARY_PDF_PATH = DATA_DIR / "summary.pdf"
_RUNTIME_FONT = DATA_DIR / "fonts" / "NanumGothic.ttf"
_FONT_URL = (
    "https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/"
    "NanumGothic-Regular.ttf"
)

# A4 at 140 DPI
_PAGE_W = 1158
_PAGE_H = 1637
_MARGIN = 56

_font_path: Path | None = None
_font_tried = False


def _safe(text: object) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\x00", "")
    value = re.sub(r"[\U00010000-\U0010FFFF]", "", value)
    return value.strip()


def _ensure_font_path() -> Path | None:
    global _font_path, _font_tried
    if _font_tried:
        return _font_path
    _font_tried = True

    font_path = _RUNTIME_FONT
    if not font_path.is_file() or font_path.stat().st_size < 1000:
        try:
            import requests

            font_path.parent.mkdir(parents=True, exist_ok=True)
            response = requests.get(_FONT_URL, timeout=60)
            response.raise_for_status()
            font_path.write_bytes(response.content)
            print(f"Downloaded PDF font to {font_path} ({len(response.content)} bytes)")
        except Exception as exc:
            print(f"PDF CJK font download skipped: {exc}")
            _font_path = None
            return None

    _font_path = font_path
    return font_path


def _load_font(size: int):
    from PIL import ImageFont

    path = _ensure_font_path()
    if path is not None:
        try:
            return ImageFont.truetype(str(path), size=size)
        except Exception as exc:
            print(f"PDF font load failed ({size}pt): {exc}")
    return ImageFont.load_default()


def chart_to_png_bytes(chart) -> bytes | None:
    """Snapshot chart payload to raw PNG bytes. Never reuses live buffers."""
    if chart is None:
        return None
    if isinstance(chart, (bytes, bytearray, memoryview)):
        data = bytes(chart)
        return data or None
    if getattr(chart, "closed", False):
        return None
    getvalue = getattr(chart, "getvalue", None)
    if callable(getvalue):
        try:
            data = getvalue()
            if data:
                return bytes(data)
        except Exception as exc:
            print(f"PDF chart getvalue failed: {exc}")
    try:
        read = getattr(chart, "read", None)
        seek = getattr(chart, "seek", None)
        if not callable(read):
            return None
        pos = None
        if callable(seek) and hasattr(chart, "tell"):
            try:
                pos = chart.tell()
            except Exception:
                pos = None
            try:
                chart.seek(0)
            except Exception as exc:
                print(f"PDF chart seek failed: {exc}")
                return None
        data = read()
        if callable(seek) and pos is not None:
            try:
                chart.seek(pos)
            except Exception:
                pass
        return bytes(data) if data else None
    except Exception as exc:
        print(f"PDF chart snapshot failed: {exc}")
        return None


def _render_text_page(title: str, paragraphs: list[str]):
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (_PAGE_W, _PAGE_H), "white")
    draw = ImageDraw.Draw(img)
    title_font = _load_font(28)
    body_font = _load_font(16)
    y = _MARGIN
    if title:
        draw.text((_MARGIN, y), _safe(title), font=title_font, fill=(17, 17, 17))
        y += 44
    for para in paragraphs:
        for line in textwrap.wrap(_safe(para), width=78) or [""]:
            if y > _PAGE_H - _MARGIN:
                break
            draw.text((_MARGIN, y), line, font=body_font, fill=(34, 34, 34))
            y += 24
        y += 10
    return img


def _render_chart_page(png_bytes: bytes, caption: str = ""):
    from PIL import Image, ImageDraw

    page = Image.new("RGB", (_PAGE_W, _PAGE_H), "white")
    draw = ImageDraw.Draw(page)
    y = _MARGIN
    if caption:
        draw.text((_MARGIN, y), _safe(caption), font=_load_font(20), fill=(17, 17, 17))
        y += 36

    with Image.open(BytesIO(png_bytes)) as src:
        chart = src.convert("RGB")
        chart.load()
        chart = chart.copy()

    max_w = _PAGE_W - 2 * _MARGIN
    max_h = _PAGE_H - y - _MARGIN
    chart.thumbnail((max_w, max_h))
    x = _MARGIN + (max_w - chart.width) // 2
    page.paste(chart, (x, y))
    return page


def _images_to_pdf(images: list, out: Path) -> None:
    """Write RGB PIL images to PDF via an in-memory buffer (no live file handles)."""
    if not images:
        raise RuntimeError("No PDF pages to write")

    # Detach every page into a fully-loaded RGB copy.
    pages = []
    for image in images:
        rgb = image.convert("RGB")
        rgb.load()
        pages.append(rgb.copy())
        try:
            image.close()
        except Exception:
            pass

    first, rest = pages[0], pages[1:]
    pdf_buf = BytesIO()
    first.save(
        pdf_buf,
        format="PDF",
        save_all=True,
        append_images=rest,
        resolution=140.0,
    )
    data = pdf_buf.getvalue()
    pdf_buf.close()
    for page in pages:
        try:
            page.close()
        except Exception:
            pass

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    if not out.is_file() or out.stat().st_size < 100:
        raise RuntimeError(f"PDF write failed or empty: {out}")


def _leader_chart(pack: dict):
    return pack.get("chart_png") or pack.get("chart")


def build_summary_pdf(summary: dict, output_path: Path | None = None) -> Path:
    out = output_path or SUMMARY_PDF_PATH
    pages = []

    header_lines = [
        _safe(summary.get("generated_at_display", "")),
        f"Tickers with news: {summary.get('ticker_count', 0)}",
        "PDF export via Pillow (no Selenium / no matplotlib)",
    ]
    pages.append(_render_text_page("SavvyETF Market Brief", header_lines))

    for universe in summary.get("universes") or []:
        name = str(universe.get("name", universe.get("key", "Universe")))
        paragraphs: list[str] = []
        for mode in ("surge", "dropvol"):
            board = (universe.get("boards") or {}).get(mode) or {}
            title = (
                "Price up + volume surge"
                if mode == "surge"
                else "Price down + volume surge"
            )
            paragraphs.append(title)
            rows = board.get("top") or []
            if not rows:
                paragraphs.append("  (no rows)")
            for idx, (ticker, value) in enumerate(rows, start=1):
                paragraphs.append(f"  {idx}. {ticker}  {value}")
            paragraphs.append("")

        for ticker in universe.get("tickers") or []:
            headlines = (summary.get("news_by_ticker") or {}).get(ticker) or []
            if not headlines:
                continue
            paragraphs.append(f"News - {ticker}")
            for item in headlines[:3]:
                paragraphs.append(f"  - {item.get('title', '')} ({item.get('source', '')})")
            paragraphs.append("")

        pages.append(_render_text_page(name, paragraphs))

    ai = summary.get("ai_analysis") or {}
    brief = _strip_disclaimer((ai.get("market_brief_ko") or "").strip())
    if brief:
        paras = [p for p in re.split(r"\n+", brief) if p.strip()]
        notes = ai.get("chart_notes_ko") or {}
        if notes:
            paras.append("")
            paras.append("Chart notes")
            for key, note in notes.items():
                paras.append(f"[{key}] {note}")
        pages.append(_render_text_page("AI market briefing", paras))

    heatmap = summary.get("heatmap_sp") or {}
    heatmap_png = chart_to_png_bytes(heatmap.get("chart"))
    if heatmap_png:
        try:
            pages.append(
                _render_chart_page(heatmap_png, heatmap.get("caption", "S&P 500 heatmap"))
            )
        except Exception as exc:
            print(f"PDF heatmap page skipped: {exc}")
    elif heatmap.get("error"):
        pages.append(_render_text_page("S&P 500 heatmap", [f"Unavailable: {heatmap['error']}"]))

    for key, pack in (summary.get("leader_charts") or {}).items():
        if not isinstance(pack, dict):
            continue
        raw = chart_to_png_bytes(_leader_chart(pack))
        if not raw:
            continue
        caption = pack.get("caption") or pack.get("ticker") or str(key)
        try:
            pages.append(_render_chart_page(raw, str(caption)))
        except Exception as exc:
            print(f"PDF leader page skipped: {exc}")

    macro = summary.get("macro") or {}
    macro_png = chart_to_png_bytes(macro.get("chart"))
    if macro_png:
        try:
            pages.append(_render_chart_page(macro_png, macro.get("caption", "Macro dashboard")))
        except Exception as exc:
            print(f"PDF macro page skipped: {exc}")

    for symbol in ("BTC", "ETH"):
        entry = (summary.get("crypto") or {}).get(symbol) or {}
        raw = chart_to_png_bytes(entry.get("chart"))
        if not raw:
            continue
        try:
            pages.append(_render_chart_page(raw, entry.get("label") or symbol))
        except Exception as exc:
            print(f"PDF crypto page skipped: {exc}")

    pages.append(
        _render_text_page(
            "Notes",
            [
                "Not financial advice.",
                "Web brief: /summary",
                "Generated by SavvyETF bot.",
            ],
        )
    )

    _images_to_pdf(pages, out)
    print(f"Summary PDF written: {out} ({out.stat().st_size} bytes, pages={len(pages)})")
    return out


def load_summary_pdf_bytes() -> bytes | None:
    if not SUMMARY_PDF_PATH.exists():
        return None
    return SUMMARY_PDF_PATH.read_bytes()

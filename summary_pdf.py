"""Build /summary PDF from PNG page bytes only (no Pillow PDF plugin).

Pillow's PdfParser/Image.save(..., format='PDF') has caused
'I/O operation on closed file' on Render. This module:
  1) draws pages with Pillow to PNG bytes
  2) converts each page to JPEG bytes
  3) writes a minimal PDF by hand from those bytes
"""

from __future__ import annotations

import re
import textwrap
import traceback
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

# A4 at 120 DPI (smaller pages = less memory on Render)
_PAGE_W = 992
_PAGE_H = 1403
_MARGIN = 48

_font_bytes: bytes | None = None
_font_tried = False
_font_path: Path | None = None


def _safe(text: object) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\x00", "")
    value = re.sub(r"[\U00010000-\U0010FFFF]", "", value)
    return value.strip()


def _ensure_font_file() -> Path | None:
    """Ensure NanumGothic exists on disk and return its path (not a BytesIO)."""
    global _font_bytes, _font_tried, _font_path
    if _font_tried:
        return _font_path
    _font_tried = True

    font_path = _RUNTIME_FONT
    if font_path.is_file() and font_path.stat().st_size >= 1000:
        try:
            _font_bytes = font_path.read_bytes()
            _font_path = font_path
            return _font_path
        except Exception as exc:
            print(f"PDF font read failed: {exc}")

    try:
        import requests

        font_path.parent.mkdir(parents=True, exist_ok=True)
        response = requests.get(_FONT_URL, timeout=60)
        response.raise_for_status()
        data = response.content
        font_path.write_bytes(data)
        _font_bytes = data
        _font_path = font_path
        print(f"Downloaded PDF font ({len(data)} bytes)")
        return _font_path
    except Exception as exc:
        print(f"PDF CJK font download skipped: {exc}")
        _font_bytes = None
        _font_path = None
        return None


def _load_font(size: int):
    from PIL import ImageFont

    path = _ensure_font_file()
    if path is not None:
        try:
            # Load from a real filesystem path. BytesIO fonts can be GC-closed
            # mid-draw under memory pressure ("I/O operation on closed file").
            return ImageFont.truetype(str(path), size=size)
        except Exception as exc:
            print(f"PDF font load failed ({size}pt): {exc}")
    return ImageFont.load_default()


def chart_to_png_bytes(chart) -> bytes | None:
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
            return None
    return None


def _image_to_png_bytes(img) -> bytes:
    buf = BytesIO()
    img.save(buf, format="PNG", optimize=False)
    data = buf.getvalue()
    buf.close()
    try:
        img.close()
    except Exception:
        pass
    return data


def _png_to_jpeg_bytes(png_bytes: bytes, quality: int = 85) -> tuple[bytes, int, int]:
    from PIL import Image

    with Image.open(BytesIO(png_bytes)) as src:
        rgb = src.convert("RGB")
        rgb.load()
        width, height = rgb.size
        out = BytesIO()
        rgb.save(out, format="JPEG", quality=quality, optimize=True)
        data = out.getvalue()
        out.close()
        try:
            rgb.close()
        except Exception:
            pass
    return data, width, height


def _render_text_page_png(title: str, paragraphs: list[str]) -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (_PAGE_W, _PAGE_H), "white")
    draw = ImageDraw.Draw(img)
    title_font = _load_font(26)
    body_font = _load_font(15)
    y = _MARGIN
    if title:
        draw.text((_MARGIN, y), _safe(title), font=title_font, fill=(17, 17, 17))
        y += 40
    for para in paragraphs:
        for line in textwrap.wrap(_safe(para), width=72) or [""]:
            if y > _PAGE_H - _MARGIN:
                break
            draw.text((_MARGIN, y), line, font=body_font, fill=(34, 34, 34))
            y += 22
        y += 8
    return _image_to_png_bytes(img)


def _render_chart_page_png(png_bytes: bytes, caption: str = "") -> bytes:
    from PIL import Image, ImageDraw

    page = Image.new("RGB", (_PAGE_W, _PAGE_H), "white")
    draw = ImageDraw.Draw(page)
    y = _MARGIN
    if caption:
        draw.text((_MARGIN, y), _safe(caption), font=_load_font(18), fill=(17, 17, 17))
        y += 32

    with Image.open(BytesIO(png_bytes)) as src:
        chart = src.convert("RGB")
        chart.load()
        chart = chart.copy()

    max_w = _PAGE_W - 2 * _MARGIN
    max_h = _PAGE_H - y - _MARGIN
    chart.thumbnail((max_w, max_h))
    x = _MARGIN + (max_w - chart.width) // 2
    page.paste(chart, (x, y))
    try:
        chart.close()
    except Exception:
        pass
    return _image_to_png_bytes(page)


def _jpeg_pages_to_pdf(pages: list[tuple[bytes, int, int]], out: Path) -> None:
    """Write a minimal PDF 1.4 file embedding one JPEG image per page."""
    if not pages:
        raise RuntimeError("No PDF pages to write")

    # A4 in PDF points (1/72 inch). Images are scaled to fill the page.
    page_w, page_h = 595, 842

    objects: list[bytes] = []

    def add_obj(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog_id = add_obj(b"")  # 1
    pages_id = add_obj(b"")  # 2
    page_obj_ids: list[int] = []

    for jpeg_data, _width, _height in pages:
        content = f"q\n{page_w} 0 0 {page_h} 0 0 cm\n/Im0 Do\nQ\n".encode("ascii")
        content_id = add_obj(
            f"<< /Length {len(content)} >>\nstream\n".encode("ascii")
            + content
            + b"endstream"
        )
        image_id = add_obj(
            (
                f"<< /Type /XObject /Subtype /Image "
                f"/Width {_width} /Height {_height} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 "
                f"/Filter /DCTDecode /Length {len(jpeg_data)} >>\nstream\n"
            ).encode("ascii")
            + jpeg_data
            + b"\nendstream"
        )
        page_id = add_obj(
            (
                f"<< /Type /Page /Parent {pages_id} 0 R "
                f"/MediaBox [0 0 {page_w} {page_h}] "
                f"/Contents {content_id} 0 R "
                f"/Resources << /XObject << /Im0 {image_id} 0 R >> >> >>"
            ).encode("ascii")
        )
        page_obj_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    objects[pages_id - 1] = (
        f"<< /Type /Pages /Count {len(page_obj_ids)} /Kids [{kids}] >>".encode("ascii")
    )
    objects[catalog_id - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode(
        "ascii"
    )

    out_buf = bytearray()
    out_buf.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for idx, body in enumerate(objects, start=1):
        offsets.append(len(out_buf))
        out_buf.extend(f"{idx} 0 obj\n".encode("ascii"))
        out_buf.extend(body)
        out_buf.extend(b"\nendobj\n")

    xref_pos = len(out_buf)
    out_buf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out_buf.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out_buf.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    out_buf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n"
        ).encode("ascii")
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(bytes(out_buf))
    if not out.is_file() or out.stat().st_size < 100:
        raise RuntimeError(f"PDF write failed or empty: {out}")


def _png_pages_to_pdf(png_pages: list[bytes], out: Path) -> None:
    jpeg_pages: list[tuple[bytes, int, int]] = []
    for png in png_pages:
        jpeg_pages.append(_png_to_jpeg_bytes(png))
    _jpeg_pages_to_pdf(jpeg_pages, out)


def _leader_chart(pack: dict):
    return pack.get("chart_png") or pack.get("chart")


def build_summary_pdf(summary: dict, output_path: Path | None = None) -> Path:
    out = output_path or SUMMARY_PDF_PATH
    png_pages: list[bytes] = []

    header_lines = [
        _safe(summary.get("generated_at_display", "")),
        f"Tickers with news: {summary.get('ticker_count', 0)}",
        "PDF export via hand-written JPEG PDF (no Pillow PDF plugin)",
    ]
    png_pages.append(_render_text_page_png("SavvyETF Market Brief", header_lines))

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
                paragraphs.append(
                    f"  - {item.get('title', '')} ({item.get('source', '')})"
                )
            paragraphs.append("")

        png_pages.append(_render_text_page_png(name, paragraphs))

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
        png_pages.append(_render_text_page_png("AI market briefing", paras))

    heatmap = summary.get("heatmap_sp") or {}
    heatmap_png = chart_to_png_bytes(heatmap.get("chart"))
    if heatmap_png:
        try:
            png_pages.append(
                _render_chart_page_png(
                    heatmap_png, heatmap.get("caption", "S&P 500 heatmap")
                )
            )
        except Exception as exc:
            print(f"PDF heatmap page skipped: {exc}")
    elif heatmap.get("error"):
        png_pages.append(
            _render_text_page_png("S&P 500 heatmap", [f"Unavailable: {heatmap['error']}"])
        )

    for key, pack in (summary.get("leader_charts") or {}).items():
        if not isinstance(pack, dict):
            continue
        raw = chart_to_png_bytes(_leader_chart(pack))
        if not raw:
            continue
        caption = pack.get("caption") or pack.get("ticker") or str(key)
        try:
            png_pages.append(_render_chart_page_png(raw, str(caption)))
        except Exception as exc:
            print(f"PDF leader page skipped: {exc}")

    macro = summary.get("macro") or {}
    macro_png = chart_to_png_bytes(macro.get("chart"))
    if macro_png:
        try:
            png_pages.append(
                _render_chart_page_png(macro_png, macro.get("caption", "Macro dashboard"))
            )
        except Exception as exc:
            print(f"PDF macro page skipped: {exc}")

    for symbol in ("BTC", "ETH"):
        entry = (summary.get("crypto") or {}).get(symbol) or {}
        raw = chart_to_png_bytes(entry.get("chart"))
        if not raw:
            continue
        try:
            png_pages.append(
                _render_chart_page_png(raw, entry.get("label") or symbol)
            )
        except Exception as exc:
            print(f"PDF crypto page skipped: {exc}")

    png_pages.append(
        _render_text_page_png(
            "Notes",
            [
                "Not financial advice.",
                "Web brief: /summary",
                "Generated by SavvyETF bot.",
            ],
        )
    )

    if not png_pages:
        raise RuntimeError("No PDF pages rendered")

    _png_pages_to_pdf(png_pages, out)
    print(
        f"Summary PDF written: {out} ({out.stat().st_size} bytes, pages={len(png_pages)})"
    )
    return out


def build_summary_pdf_safe(summary: dict, output_path: Path | None = None) -> Path:
    """Build PDF; on failure retry text-only, and always log traceback."""
    try:
        return build_summary_pdf(summary, output_path=output_path)
    except Exception as first_exc:
        traceback.print_exc()
        print(f"Full PDF failed ({first_exc}); retrying text-only PDF")
        out = output_path or SUMMARY_PDF_PATH
        try:
            png_pages = [
                _render_text_page_png(
                    "SavvyETF Market Brief",
                    [
                        _safe(summary.get("generated_at_display", "")),
                        "Chart pages skipped due to PDF render error.",
                        f"Error: {first_exc}",
                    ],
                )
            ]
            ai = summary.get("ai_analysis") or {}
            brief = _strip_disclaimer((ai.get("market_brief_ko") or "").strip())
            if brief:
                paras = [p for p in re.split(r"\n+", brief) if p.strip()]
                png_pages.append(_render_text_page_png("AI market briefing", paras))
            for universe in summary.get("universes") or []:
                name = str(universe.get("name", universe.get("key", "Universe")))
                paragraphs: list[str] = []
                for mode in ("surge", "dropvol"):
                    board = (universe.get("boards") or {}).get(mode) or {}
                    paragraphs.append(mode)
                    for idx, (ticker, value) in enumerate(board.get("top") or [], start=1):
                        paragraphs.append(f"  {idx}. {ticker}  {value}")
                png_pages.append(_render_text_page_png(name, paragraphs))
            png_pages.append(
                _render_text_page_png("Notes", ["Not financial advice.", "Web brief: /summary"])
            )
            _png_pages_to_pdf(png_pages, out)
            print(f"Text-only PDF written: {out} ({out.stat().st_size} bytes)")
            return out
        except Exception:
            traceback.print_exc()
            raise first_exc


def load_summary_pdf_bytes() -> bytes | None:
    if not SUMMARY_PDF_PATH.exists():
        return None
    return SUMMARY_PDF_PATH.read_bytes()

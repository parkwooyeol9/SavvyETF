"""Build /event PDF from PNG page bytes (Pillow → JPEG → PDF, no Selenium)."""

from __future__ import annotations

import textwrap
from io import BytesIO
from pathlib import Path
from typing import Any

from summary_pdf import (
    ACCENT,
    ACCENT2,
    DANGER,
    MUTED,
    PANEL2,
    TEXT,
    WARN,
    _CONTENT_BOTTOM,
    _MARGIN,
    _PAGE_H,
    _PAGE_W,
    _draw_footer,
    _ensure_font_file,
    _image_to_png_bytes,
    _load_font,
    _new_page,
    _png_pages_to_pdf,
    _safe,
    _text_width,
    chart_to_png_bytes,
)

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
EVENT_PDF_PATH = DATA_DIR / "event.pdf"

TONE_COLOR = {
    "negative": DANGER,
    "positive": ACCENT2,
    "neutral": WARN,
    "muted": MUTED,
}


def _wrap_draw(draw, text: str, x: int, y: int, *, font, fill, max_width: int, line_h: int) -> int:
    # Approximate wrap by character count for CJK+ASCII mix
    avg = max(1, _text_width(draw, "가", font) or 12)
    chars = max(12, max_width // avg)
    lines = []
    for para in (text or "").splitlines() or [""]:
        lines.extend(textwrap.wrap(para, width=chars) or [""])
    for line in lines:
        if y > _CONTENT_BOTTOM - 20:
            break
        draw.text((x, y), _safe(line), font=font, fill=fill)
        y += line_h
    return y


def _fmt_pct(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.2f}%"


def _render_cover_page(report: dict[str, Any]) -> bytes:
    discovery = report.get("discovery") or {}
    impact = report.get("impact") or {}
    img, draw = _new_page()
    y = 48
    draw.text((_MARGIN, y), "SavvyETF /event", font=_load_font(16), fill=ACCENT)
    y += 36
    query = _safe(report.get("query") or discovery.get("query") or "")
    draw.text((_MARGIN, y), query, font=_load_font(28), fill=TEXT)
    y += 44
    draw.text(
        (_MARGIN, y),
        _safe(report.get("generated_at_display") or ""),
        font=_load_font(13),
        fill=MUTED,
    )
    y += 28
    draw.text(
        (_MARGIN, y),
        "비교: 미국 · 일본 · 한국 · 중국  (/idx 현금 지수)",
        font=_load_font(14),
        fill=MUTED,
    )
    y += 36

    draw.rounded_rectangle(
        (_MARGIN, y, _PAGE_W - _MARGIN, y + 8),
        radius=4,
        fill=ACCENT,
    )
    y += 28

    draw.text((_MARGIN, y), "과거 유사 사례", font=_load_font(18), fill=TEXT)
    y += 30
    summary = _safe(discovery.get("summary_ko") or "")
    if summary:
        y = _wrap_draw(
            draw, summary, _MARGIN, y, font=_load_font(14), fill=MUTED, max_width=_PAGE_W - 2 * _MARGIN, line_h=22
        )
        y += 12

    for idx, ev in enumerate(discovery.get("events") or [], start=1):
        if y > _CONTENT_BOTTOM - 80:
            break
        line = f"{idx}. {_safe(ev.get('date'))}  —  {_safe(ev.get('title'))}"
        draw.text((_MARGIN, y), line, font=_load_font(15), fill=TEXT)
        y += 24
        note = _safe(ev.get("note") or "")
        if note:
            y = _wrap_draw(
                draw,
                note,
                _MARGIN + 18,
                y,
                font=_load_font(12),
                fill=MUTED,
                max_width=_PAGE_W - 2 * _MARGIN - 18,
                line_h=18,
            )
            y += 6

    y += 16
    if y < _CONTENT_BOTTOM - 120:
        draw.text((_MARGIN, y), "국가별 영향 요약", font=_load_font(18), fill=TEXT)
        y += 28
        for row in impact.get("countries") or []:
            if y > _CONTENT_BOTTOM - 40:
                break
            imp = row.get("impact") or {}
            tone = TONE_COLOR.get(str(imp.get("tone") or "muted"), MUTED)
            label = _safe(imp.get("label") or "")
            country = _safe(row.get("country_ko") or row.get("country") or "")
            chip = f"[{label}]"
            draw.text((_MARGIN, y), country, font=_load_font(15), fill=TEXT)
            tw = _text_width(draw, country + "  ", _load_font(15))
            draw.text((_MARGIN + tw, y), chip, font=_load_font(15), fill=tone)
            y += 26

    _draw_footer(draw, "event cover")
    return _image_to_png_bytes(img)


def _render_impact_page(report: dict[str, Any]) -> bytes:
    impact = report.get("impact") or {}
    img, draw = _new_page()
    y = 48
    draw.text((_MARGIN, y), "국가별 영향 판단", font=_load_font(22), fill=TEXT)
    y += 40

    narrative = _safe(impact.get("narrative_ko") or "")
    y = _wrap_draw(
        draw,
        narrative,
        _MARGIN,
        y,
        font=_load_font(14),
        fill=MUTED,
        max_width=_PAGE_W - 2 * _MARGIN,
        line_h=22,
    )
    y += 20

    for row in impact.get("countries") or []:
        if y > _CONTENT_BOTTOM - 100:
            break
        imp = row.get("impact") or {}
        tone = TONE_COLOR.get(str(imp.get("tone") or "muted"), MUTED)
        country = _safe(row.get("country_ko") or row.get("country") or "")
        label = _safe(imp.get("label") or "")
        horizons = row.get("horizons") or {}

        box_h = 110
        draw.rounded_rectangle(
            (_MARGIN, y, _PAGE_W - _MARGIN, y + box_h),
            radius=12,
            fill=PANEL2,
            outline=tone,
            width=2,
        )
        draw.text((_MARGIN + 16, y + 14), f"{country}  [{label}]", font=_load_font(16), fill=TEXT)
        metrics = (
            f"+30일 {_fmt_pct(horizons.get('d30'))}   "
            f"+60일 {_fmt_pct(horizons.get('d60'))}   "
            f"+90일 {_fmt_pct(horizons.get('d90'))}"
        )
        draw.text((_MARGIN + 16, y + 42), metrics, font=_load_font(13), fill=ACCENT)
        _wrap_draw(
            draw,
            _safe(imp.get("summary_ko") or ""),
            _MARGIN + 16,
            y + 66,
            font=_load_font(12),
            fill=MUTED,
            max_width=_PAGE_W - 2 * _MARGIN - 32,
            line_h=18,
        )
        y += box_h + 14

    _draw_footer(draw, "impact")
    return _image_to_png_bytes(img)


def _render_chart_page(title: str, chart_buf: Any, subtitle: str = "") -> bytes | None:
    from PIL import Image

    raw = chart_to_png_bytes(chart_buf)
    if not raw:
        return None
    img, draw = _new_page()
    y = 40
    draw.text((_MARGIN, y), _safe(title), font=_load_font(18), fill=TEXT)
    y += 28
    if subtitle:
        draw.text((_MARGIN, y), _safe(subtitle), font=_load_font(12), fill=MUTED)
        y += 22

    with Image.open(BytesIO(raw)) as src:
        chart = src.convert("RGB")
        max_w = _PAGE_W - 2 * _MARGIN
        max_h = _CONTENT_BOTTOM - y - 20
        w, h = chart.size
        scale = min(max_w / w, max_h / h, 1.0)
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        chart = chart.resize((nw, nh), Image.Resampling.LANCZOS)
        x = _MARGIN + (max_w - nw) // 2
        img.paste(chart, (x, y))
        chart.close()

    _draw_footer(draw, "chart")
    return _image_to_png_bytes(img)


def build_event_pdf(
    report: dict[str, Any],
    chart_buffers: dict[str, Any],
    *,
    output_path: Path | None = None,
) -> Path:
    _ensure_font_file()
    from cjk_font import configure_matplotlib_cjk

    configure_matplotlib_cjk()

    pages: list[bytes] = [
        _render_cover_page(report),
        _render_impact_page(report),
    ]

    bar = chart_buffers.get("horizon_bars")
    if bar is not None:
        page = _render_chart_page(
            "이벤트 후 30·60·90일 평균 누적수익률",
            bar,
            subtitle="미국 · 일본 · 한국 · 중국",
        )
        if page:
            pages.append(page)

    avg = chart_buffers.get("average")
    if avg is not None:
        page = _render_chart_page("이벤트 평균 경로 (t=0 리베이스)", avg)
        if page:
            pages.append(page)

    study = report.get("study") or {}
    for panel in study.get("panels") or []:
        date_str = panel.get("event_date_str") or ""
        buf = chart_buffers.get(date_str)
        if buf is None:
            continue
        title = f"Event {date_str}"
        if panel.get("title"):
            title = f"{title} — {_safe(panel.get('title'))}"
        page = _render_chart_page(title, buf)
        if page:
            pages.append(page)

    out = output_path or EVENT_PDF_PATH
    _png_pages_to_pdf(pages, out)
    print(f"Event PDF written: {out} ({out.stat().st_size} bytes, pages={len(pages)})")
    return out


def load_event_pdf_bytes() -> bytes | None:
    if EVENT_PDF_PATH.is_file():
        return EVENT_PDF_PATH.read_bytes()
    return None

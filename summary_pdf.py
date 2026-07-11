"""Build /summary PDF from PNG page bytes only (no Pillow PDF plugin).

Visual style matches the SavvyETF web brief (dark mesh, accent cards).
Pages are drawn with Pillow → JPEG → hand-written PDF bytes.
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

# A4 @ 144 DPI — sharper charts without blowing Render memory
_PAGE_W = 1191
_PAGE_H = 1684
_MARGIN = 52

# Brand palette (aligned with web/css/styles.css)
BG = (11, 16, 24)
PANEL = (20, 29, 43)
PANEL2 = (26, 37, 56)
BORDER = (43, 54, 72)
TEXT = (232, 238, 245)
MUTED = (143, 163, 184)
ACCENT = (77, 163, 255)
ACCENT2 = (61, 214, 140)
WARN = (251, 191, 36)
DANGER = (248, 113, 113)
WHITE = (255, 255, 255)

UNIVERSE_COLORS = {
    "etf": ACCENT,
    "sp": ACCENT2,
    "nas": (167, 139, 250),
}

_font_bytes: bytes | None = None
_font_tried = False
_font_path: Path | None = None
_font_cache: dict[int, object] = {}


def _safe(text: object) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\x00", "")
    value = re.sub(r"[\U00010000-\U0010FFFF]", "", value)
    return value.strip()


def _ensure_font_file() -> Path | None:
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

    cached = _font_cache.get(size)
    if cached is not None:
        return cached

    path = _ensure_font_file()
    font = None
    if path is not None:
        try:
            font = ImageFont.truetype(str(path), size=size)
        except Exception as exc:
            print(f"PDF font load failed ({size}pt): {exc}")
    if font is None:
        font = ImageFont.load_default()
    _font_cache[size] = font
    return font


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


def _png_to_jpeg_bytes(png_bytes: bytes, quality: int = 90) -> tuple[bytes, int, int]:
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


def _new_page():
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (_PAGE_W, _PAGE_H), BG)
    draw = ImageDraw.Draw(img)
    # Subtle top wash — brand atmosphere without noisy overlays
    for i in range(0, 220, 4):
        tone = 11 + min(10, (220 - i) // 28)
        draw.line((0, i, _PAGE_W, i), fill=(tone, tone + 2, tone + 6))
    # Accent hairline under header zone
    draw.rectangle((0, 0, 6, _PAGE_H), fill=ACCENT)
    return img, draw


def _text_width(draw, text: str, font) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def _draw_footer(draw, page_label: str = "") -> None:
    y = _PAGE_H - 36
    draw.line((_MARGIN, y - 10, _PAGE_W - _MARGIN, y - 10), fill=BORDER, width=1)
    draw.text((_MARGIN, y), "SavvyETF Market Brief", font=_load_font(12), fill=MUTED)
    if page_label:
        w = _text_width(draw, page_label, _load_font(12))
        draw.text((_PAGE_W - _MARGIN - w, y), page_label, font=_load_font(12), fill=MUTED)


def _draw_section_chip(draw, x: int, y: int, label: str, color: tuple[int, int, int]) -> int:
    font = _load_font(13)
    pad_x, pad_y = 12, 6
    tw = _text_width(draw, label, font)
    w, h = tw + pad_x * 2, 28
    draw.rounded_rectangle((x, y, x + w, y + h), radius=8, fill=PANEL2, outline=color, width=2)
    draw.text((x + pad_x, y + pad_y), label, font=font, fill=color)
    return h


def _draw_stat_chip(draw, x: int, y: int, label: str, value: str) -> int:
    font_l = _load_font(11)
    font_v = _load_font(16)
    pad = 14
    inner_w = max(_text_width(draw, label, font_l), _text_width(draw, value, font_v)) + pad * 2
    h = 58
    draw.rounded_rectangle((x, y, x + inner_w, y + h), radius=12, fill=PANEL, outline=BORDER, width=1)
    draw.text((x + pad, y + 8), label, font=font_l, fill=MUTED)
    draw.text((x + pad, y + 28), value, font=font_v, fill=TEXT)
    return inner_w


def _parse_metric(value: object) -> tuple[str, bool | None]:
    text = _safe(value)
    positive = None
    if text.startswith("+") or (text and text[0].isdigit()):
        positive = True
    if text.startswith("-"):
        positive = False
    return text, positive


def _draw_rank_row(
    draw,
    x: int,
    y: int,
    width: int,
    rank: int,
    ticker: str,
    metric: str,
    accent: tuple[int, int, int],
    bullish: bool,
) -> int:
    h = 44
    draw.rounded_rectangle((x, y, x + width, y + h), radius=10, fill=PANEL2, outline=BORDER, width=1)
    # Rank badge
    badge = 28
    bx = x + 10
    by = y + (h - badge) // 2
    badge_color = accent if rank == 1 else BORDER
    draw.rounded_rectangle((bx, by, bx + badge, by + badge), radius=8, fill=badge_color)
    rf = _load_font(13)
    rn = str(rank)
    rw = _text_width(draw, rn, rf)
    draw.text((bx + (badge - rw) // 2, by + 6), rn, font=rf, fill=WHITE if rank == 1 else MUTED)

    draw.text((bx + badge + 12, y + 12), _safe(ticker), font=_load_font(16), fill=TEXT)

    metric_text, positive = _parse_metric(metric)
    if positive is None:
        positive = bullish
    mcolor = ACCENT2 if positive else DANGER
    mw = _text_width(draw, metric_text, _load_font(14))
    draw.text((x + width - mw - 14, y + 13), metric_text, font=_load_font(14), fill=mcolor)
    return h


def _draw_wrapped(
    draw,
    text: str,
    x: int,
    y: int,
    max_width_chars: int,
    font,
    fill,
    line_h: int,
    max_y: int,
) -> int:
    for line in textwrap.wrap(_safe(text), width=max_width_chars) or [""]:
        if y > max_y:
            return y
        draw.text((x, y), line, font=font, fill=fill)
        y += line_h
    return y


def _open_chart(png_bytes: bytes):
    from PIL import Image

    with Image.open(BytesIO(png_bytes)) as src:
        chart = src.convert("RGB")
        chart.load()
        return chart.copy()


def _paste_chart_in_frame(
    page,
    draw,
    chart,
    x: int,
    y: int,
    max_w: int,
    max_h: int,
    title: str = "",
    subtitle: str = "",
) -> int:
    """Draw a framed chart sized to content (no tall empty padding). Returns bottom y."""
    start_y = y
    if title:
        draw.text((x + 4, y), _safe(title), font=_load_font(18), fill=TEXT)
        y += 24
        if subtitle:
            draw.text((x + 4, y), _safe(subtitle)[:110], font=_load_font(12), fill=MUTED)
            y += 20
        y += 6

    pad = 10
    used = y - start_y
    avail_w = max(40, max_w - pad * 2)
    avail_h = max(40, max_h - used - pad * 2)

    chart = chart.copy()
    chart.thumbnail((avail_w, avail_h))
    frame_h = chart.height + pad * 2
    frame = (x, y, x + max_w, y + frame_h)
    draw.rounded_rectangle(frame, radius=14, fill=PANEL, outline=BORDER, width=1)

    cx = x + pad + (avail_w - chart.width) // 2
    cy = y + pad
    page.paste(chart, (cx, cy))
    try:
        chart.close()
    except Exception:
        pass
    return int(frame[3])


# ── Page builders ──────────────────────────────────────────────────────────


def _render_cover_page(summary: dict) -> bytes:
    img, draw = _new_page()

    draw.rounded_rectangle((_MARGIN, 72, _MARGIN + 56, 128), radius=14, fill=ACCENT)
    draw.text((_MARGIN + 14, 86), "S", font=_load_font(32), fill=BG)

    draw.text((_MARGIN + 72, 78), "SavvyETF", font=_load_font(36), fill=TEXT)
    draw.text((_MARGIN + 72, 122), "Market Brief", font=_load_font(22), fill=ACCENT)

    y = 170
    draw.text(
        (_MARGIN, y),
        _safe(summary.get("generated_at_display", "")),
        font=_load_font(16),
        fill=MUTED,
    )
    y += 34

    draw.text((_MARGIN, y), "오늘의 마켓 브리프", font=_load_font(40), fill=TEXT)
    y += 48
    y = _draw_wrapped(
        draw,
        "ETF · S&P 500 랭킹, 리더 차트, 히트맵, 매크로, BTC/ETH, AI 브리핑을 한 권으로 정리했습니다.",
        _MARGIN,
        y,
        42,
        _load_font(15),
        MUTED,
        24,
        380,
    )
    y += 18

    x = _MARGIN
    for label, value in (
        ("Universes", str(len(summary.get("universes") or []))),
        ("News tickers", str(summary.get("ticker_count", 0))),
        ("Charts", _count_charts(summary)),
    ):
        w = _draw_stat_chip(draw, x, y, label, value)
        x += w + 14
    y += 72

    draw.rounded_rectangle(
        (_MARGIN, y, _PAGE_W - _MARGIN, y + 100),
        radius=16,
        fill=PANEL,
        outline=BORDER,
        width=1,
    )
    draw.text((_MARGIN + 24, y + 16), "Inside this brief", font=_load_font(14), fill=MUTED)
    draw.text(
        (_MARGIN + 24, y + 44),
        "① Rankings   ② Leader TA   ③ Heatmap   ④ Macro   ⑤ Crypto   ⑥ AI brief",
        font=_load_font(15),
        fill=TEXT,
    )
    draw.text(
        (_MARGIN + 24, y + 70),
        "Rankings → news → heatmap → macro → crypto → AI brief",
        font=_load_font(13),
        fill=MUTED,
    )
    y += 118

    # Cover collage: up to 3 chart thumbnails
    thumbs: list[tuple[bytes, str]] = []
    for ukey, pack in (summary.get("leader_charts") or {}).items():
        if not isinstance(pack, dict):
            continue
        raw = chart_to_png_bytes(_leader_chart(pack))
        if raw:
            thumbs.append((raw, str(pack.get("ticker") or ukey)))
    heat = chart_to_png_bytes((summary.get("heatmap_sp") or {}).get("chart"))
    if heat:
        thumbs.append((heat, "Heatmap"))
    macro = chart_to_png_bytes((summary.get("macro") or {}).get("chart"))
    if macro:
        thumbs.append((macro, "Macro"))
    thumbs = thumbs[:3]

    if thumbs:
        gap = 14
        col_w = (_PAGE_W - 2 * _MARGIN - gap * (len(thumbs) - 1)) // len(thumbs)
        max_h = min(420, _PAGE_H - y - 56)
        for i, (raw, label) in enumerate(thumbs):
            tx = _MARGIN + i * (col_w + gap)
            chart = _open_chart(raw)
            _paste_chart_in_frame(img, draw, chart, tx, y, col_w, max_h, title=label)
            try:
                chart.close()
            except Exception:
                pass

    _draw_footer(draw, "cover")
    return _image_to_png_bytes(img)


def _count_charts(summary: dict) -> str:
    n = 0
    if chart_to_png_bytes((summary.get("heatmap_sp") or {}).get("chart")):
        n += 1
    n += sum(
        1
        for pack in (summary.get("leader_charts") or {}).values()
        if isinstance(pack, dict) and chart_to_png_bytes(pack.get("chart_png") or pack.get("chart"))
    )
    if chart_to_png_bytes((summary.get("macro") or {}).get("chart")):
        n += 1
    for symbol in ("BTC", "ETH"):
        if chart_to_png_bytes(((summary.get("crypto") or {}).get(symbol) or {}).get("chart")):
            n += 1
    return str(n)


def _render_universe_rankings_page(universe: dict, summary: dict) -> bytes:
    img, draw = _new_page()
    ukey = str(universe.get("key", ""))
    accent = UNIVERSE_COLORS.get(ukey, ACCENT)
    name = _safe(universe.get("name", ukey or "Universe"))

    y = _MARGIN
    _draw_section_chip(draw, _MARGIN, y, ukey.upper() or "UNI", accent)
    draw.text((_MARGIN + 90, y), name, font=_load_font(28), fill=TEXT)
    y += 40
    draw.text(
        (_MARGIN, y),
        "Price: last trading day return  ·  Volume: latest / 21d avg",
        font=_load_font(13),
        fill=MUTED,
    )
    y += 26

    leader_pack = (summary.get("leader_charts") or {}).get(ukey) or {}
    leader_png = (
        chart_to_png_bytes(_leader_chart(leader_pack))
        if isinstance(leader_pack, dict)
        else None
    )

    col_gap = 16
    col_w = (_PAGE_W - 2 * _MARGIN - col_gap) // 2
    boards = [
        ("surge", "Price up + volume surge", True, ACCENT2),
        ("dropvol", "Price down + volume surge", False, DANGER),
    ]

    content_bottom = y
    for col, (mode, title, bullish, mode_color) in enumerate(boards):
        x = _MARGIN + col * (col_w + col_gap)
        cy = y
        draw.rounded_rectangle(
            (x, cy, x + col_w, cy + 34),
            radius=10,
            fill=PANEL,
            outline=mode_color,
            width=2,
        )
        draw.text((x + 12, cy + 7), title, font=_load_font(13), fill=mode_color)
        cy += 42

        rows = ((universe.get("boards") or {}).get(mode) or {}).get("top") or []
        if not rows:
            draw.text((x + 8, cy), "(no rows)", font=_load_font(14), fill=MUTED)
            content_bottom = max(content_bottom, cy + 28)
            continue
        for idx, row in enumerate(rows[:6], start=1):
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                ticker, metric = row[0], row[1]
            else:
                ticker, metric = row, ""
            h = _draw_rank_row(
                draw, x, cy, col_w, idx, str(ticker), str(metric), accent, bullish
            )
            cy += h + 6
        content_bottom = max(content_bottom, cy)

    if leader_png:
        note = ((summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}).get(ukey, "")
        ticker = (leader_pack or {}).get("ticker") or universe.get("leader_ticker") or ukey
        chart_y = content_bottom + 14
        chart_budget = max(220, _PAGE_H - chart_y - 56)
        chart = _open_chart(leader_png)
        _paste_chart_in_frame(
            img,
            draw,
            chart,
            _MARGIN,
            chart_y,
            _PAGE_W - 2 * _MARGIN,
            chart_budget,
            title=f"Leader — {_safe(ticker)}",
            subtitle=_safe(note),
        )
        try:
            chart.close()
        except Exception:
            pass
    else:
        leader = universe.get("leader_ticker")
        if leader:
            ly = content_bottom + 18
            draw.rounded_rectangle(
                (_MARGIN, ly, _PAGE_W - _MARGIN, ly + 64),
                radius=14,
                fill=PANEL,
                outline=accent,
                width=2,
            )
            draw.text((_MARGIN + 20, ly + 10), "Top surge leader", font=_load_font(12), fill=MUTED)
            draw.text((_MARGIN + 20, ly + 30), _safe(leader), font=_load_font(24), fill=TEXT)

    _draw_footer(draw, f"{ukey} rankings")
    return _image_to_png_bytes(img)


def _render_news_page(universe: dict, summary: dict) -> bytes | None:
    ukey = str(universe.get("key", ""))
    accent = UNIVERSE_COLORS.get(ukey, ACCENT)
    blocks: list[tuple[str, list[dict]]] = []
    for ticker in universe.get("tickers") or []:
        headlines = (summary.get("news_by_ticker") or {}).get(ticker) or []
        if headlines:
            blocks.append((str(ticker), headlines[:3]))
    if not blocks:
        return None

    img, draw = _new_page()
    y = _MARGIN
    _draw_section_chip(draw, _MARGIN, y, "NEWS", accent)
    draw.text(
        (_MARGIN + 90, y),
        f"{_safe(universe.get('name', ukey))} — Headlines",
        font=_load_font(26),
        fill=TEXT,
    )
    y += 48

    for ticker, headlines in blocks:
        if y > _PAGE_H - 140:
            break
        draw.rounded_rectangle(
            (_MARGIN, y, _PAGE_W - _MARGIN, y + 30),
            radius=8,
            fill=PANEL2,
            outline=BORDER,
            width=1,
        )
        draw.text((_MARGIN + 14, y + 6), ticker, font=_load_font(15), fill=accent)
        y += 38
        for item in headlines:
            title = _safe(item.get("title", ""))
            source = _safe(item.get("source", ""))
            y = _draw_wrapped(draw, f"• {title}", _MARGIN + 8, y, 68, _load_font(14), TEXT, 20, _PAGE_H - 70)
            if source:
                draw.text((_MARGIN + 22, y), source, font=_load_font(12), fill=MUTED)
                y += 16
            y += 4
        y += 10

    _draw_footer(draw, f"{ukey} news")
    return _image_to_png_bytes(img)


def _render_ai_page(summary: dict) -> bytes | None:
    ai = summary.get("ai_analysis") or {}
    brief = _strip_disclaimer((ai.get("market_brief_ko") or "").strip())
    if not brief:
        return None

    img, draw = _new_page()
    y = _MARGIN
    _draw_section_chip(draw, _MARGIN, y, "AI", WARN)
    draw.text((_MARGIN + 70, y), "AI 시장 브리핑", font=_load_font(28), fill=TEXT)
    y += 36
    meta = f"source: {_safe(ai.get('source', 'ai'))}  ·  articles: {ai.get('article_count', 0)}"
    draw.text((_MARGIN, y), meta, font=_load_font(13), fill=MUTED)
    y += 24

    paras = [p.strip() for p in re.split(r"\n+", brief) if p.strip()]
    notes = ai.get("chart_notes_ko") or {}

    # Pre-measure content height so the panel hugs the text (no empty mid-page box).
    body_font = _load_font(15)
    note_font = _load_font(13)
    line_h, note_h = 22, 18
    content_h = 18
    for para in paras:
        content_h += max(1, len(textwrap.wrap(para, width=58))) * line_h + 10
    if notes:
        content_h += 28
        for key, note in notes.items():
            content_h += max(1, len(textwrap.wrap(f"[{key}] {note}", width=58))) * note_h

    panel_top = y
    panel_h = min(_PAGE_H - 56 - panel_top, content_h + 16)
    draw.rounded_rectangle(
        (_MARGIN, panel_top, _PAGE_W - _MARGIN, panel_top + panel_h),
        radius=16,
        fill=PANEL,
        outline=BORDER,
        width=1,
    )
    y = panel_top + 16
    max_y = panel_top + panel_h - 12

    for para in paras:
        y = _draw_wrapped(
            draw,
            para,
            _MARGIN + 20,
            y,
            58,
            body_font,
            TEXT,
            line_h,
            max_y,
        )
        y += 10
        if y > max_y:
            break

    if notes and y < max_y - 40:
        draw.text((_MARGIN + 20, y), "Chart notes", font=_load_font(14), fill=ACCENT)
        y += 22
        for key, note in notes.items():
            y = _draw_wrapped(
                draw,
                f"[{key}] {note}",
                _MARGIN + 20,
                y,
                58,
                note_font,
                MUTED,
                note_h,
                max_y,
            )
            if y > max_y:
                break

    _draw_footer(draw, "AI briefing")
    return _image_to_png_bytes(img)


def _render_chart_showcase(
    png_bytes: bytes,
    eyebrow: str,
    title: str,
    subtitle: str = "",
    accent: tuple[int, int, int] = ACCENT,
) -> bytes:
    img, draw = _new_page()
    y = _MARGIN
    _draw_section_chip(draw, _MARGIN, y, eyebrow, accent)
    draw.text((_MARGIN + 100, y), _safe(title)[:48], font=_load_font(24), fill=TEXT)
    y += 40
    if subtitle:
        y = _draw_wrapped(draw, subtitle, _MARGIN, y, 72, _load_font(12), MUTED, 18, y + 54)
        y += 8

    chart = _open_chart(png_bytes)
    _paste_chart_in_frame(
        img,
        draw,
        chart,
        _MARGIN,
        y,
        _PAGE_W - 2 * _MARGIN,
        _PAGE_H - y - 52,
    )
    try:
        chart.close()
    except Exception:
        pass

    _draw_footer(draw, eyebrow.lower())
    return _image_to_png_bytes(img)


def _render_dual_chart_page(
    left: tuple[bytes, str],
    right: tuple[bytes, str],
    eyebrow: str,
    title: str,
) -> bytes:
    img, draw = _new_page()
    y = _MARGIN
    _draw_section_chip(draw, _MARGIN, y, eyebrow, ACCENT)
    draw.text((_MARGIN + 100, y), _safe(title), font=_load_font(24), fill=TEXT)
    y += 42

    gap = 16
    col_w = (_PAGE_W - 2 * _MARGIN - gap) // 2
    max_h = _PAGE_H - y - 52

    for col, (raw, caption) in enumerate((left, right)):
        x = _MARGIN + col * (col_w + gap)
        chart = _open_chart(raw)
        _paste_chart_in_frame(img, draw, chart, x, y, col_w, max_h, title=caption)
        try:
            chart.close()
        except Exception:
            pass

    _draw_footer(draw, eyebrow.lower())
    return _image_to_png_bytes(img)


def _render_notes_page() -> bytes:
    img, draw = _new_page()
    y = _MARGIN
    draw.text((_MARGIN, y), "Notes", font=_load_font(28), fill=TEXT)
    y += 44
    lines = [
        "본 자료는 투자 권유가 아닙니다. Not financial advice.",
        "데이터: Yahoo Finance chart API · Finnhub (premarket) · Gemini (AI brief).",
        "웹 브리프: /summary  ·  PDF: /summary.pdf",
        "Generated by SavvyETF bot.",
    ]
    for line in lines:
        draw.rounded_rectangle(
            (_MARGIN, y, _PAGE_W - _MARGIN, y + 48),
            radius=12,
            fill=PANEL,
            outline=BORDER,
            width=1,
        )
        draw.text((_MARGIN + 18, y + 14), line, font=_load_font(14), fill=MUTED)
        y += 58

    _draw_footer(draw, "notes")
    return _image_to_png_bytes(img)


# Kept for text-only fallback compatibility
def _render_text_page_png(title: str, paragraphs: list[str]) -> bytes:
    img, draw = _new_page()
    y = _MARGIN
    draw.text((_MARGIN, y), _safe(title), font=_load_font(26), fill=TEXT)
    y += 44
    for para in paragraphs:
        y = _draw_wrapped(draw, para, _MARGIN, y, 68, _load_font(14), MUTED, 22, _PAGE_H - 60)
        y += 10
    _draw_footer(draw)
    return _image_to_png_bytes(img)


def _jpeg_pages_to_pdf(pages: list[tuple[bytes, int, int]], out: Path) -> None:
    if not pages:
        raise RuntimeError("No PDF pages to write")

    page_w, page_h = 595, 842
    objects: list[bytes] = []

    def add_obj(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog_id = add_obj(b"")
    pages_id = add_obj(b"")
    page_obj_ids: list[int] = []

    for jpeg_data, width, height in pages:
        content = f"q\n{page_w} 0 0 {page_h} 0 0 cm\n/Im0 Do\nQ\n".encode("ascii")
        content_id = add_obj(
            f"<< /Length {len(content)} >>\nstream\n".encode("ascii") + content + b"endstream"
        )
        image_id = add_obj(
            (
                f"<< /Type /XObject /Subtype /Image "
                f"/Width {width} /Height {height} "
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
    objects[catalog_id - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("ascii")

    out_buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
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
    _jpeg_pages_to_pdf([_png_to_jpeg_bytes(png) for png in png_pages], out)


def _leader_chart(pack: dict):
    return pack.get("chart_png") or pack.get("chart")


def build_summary_pdf(summary: dict, output_path: Path | None = None) -> Path:
    out = output_path or SUMMARY_PDF_PATH
    png_pages: list[bytes] = []

    png_pages.append(_render_cover_page(summary))

    for universe in summary.get("universes") or []:
        png_pages.append(_render_universe_rankings_page(universe, summary))
        news_page = _render_news_page(universe, summary)
        if news_page:
            png_pages.append(news_page)
        # Leader TA is already embedded under rankings — skip duplicate full-page chart.

    ai_page = _render_ai_page(summary)
    if ai_page:
        png_pages.append(ai_page)

    heatmap = summary.get("heatmap_sp") or {}
    heatmap_png = chart_to_png_bytes(heatmap.get("chart"))
    if heatmap_png:
        try:
            png_pages.append(
                _render_chart_showcase(
                    heatmap_png,
                    "HEATMAP",
                    "S&P 500 Heatmap",
                    subtitle=_safe(heatmap.get("caption", "")),
                    accent=ACCENT2,
                )
            )
        except Exception as exc:
            print(f"PDF heatmap page skipped: {exc}")
    elif heatmap.get("error"):
        png_pages.append(
            _render_text_page_png("S&P 500 heatmap", [f"Unavailable: {heatmap['error']}"])
        )

    # Any leader charts not already rendered with a universe
    rendered_keys = {str(u.get("key", "")) for u in (summary.get("universes") or [])}
    for key, pack in (summary.get("leader_charts") or {}).items():
        if key in rendered_keys or not isinstance(pack, dict):
            continue
        raw = chart_to_png_bytes(_leader_chart(pack))
        if not raw:
            continue
        try:
            png_pages.append(
                _render_chart_showcase(
                    raw,
                    "CHART",
                    str(pack.get("ticker") or key),
                    subtitle=_safe(pack.get("caption", "")),
                )
            )
        except Exception as exc:
            print(f"PDF leader page skipped: {exc}")

    macro = summary.get("macro") or {}
    macro_png = chart_to_png_bytes(macro.get("chart"))
    if macro_png:
        try:
            png_pages.append(
                _render_chart_showcase(
                    macro_png,
                    "MACRO",
                    "Macro Risk Dashboard",
                    subtitle=_safe(macro.get("caption", "")),
                    accent=WARN,
                )
            )
        except Exception as exc:
            print(f"PDF macro page skipped: {exc}")

    crypto_charts: list[tuple[bytes, str]] = []
    for symbol in ("BTC", "ETH"):
        entry = (summary.get("crypto") or {}).get(symbol) or {}
        raw = chart_to_png_bytes(entry.get("chart"))
        if raw:
            crypto_charts.append((raw, str(entry.get("label") or symbol)))

    if len(crypto_charts) == 2:
        try:
            png_pages.append(
                _render_dual_chart_page(
                    crypto_charts[0],
                    crypto_charts[1],
                    "CRYPTO",
                    "Bitcoin & Ethereum",
                )
            )
        except Exception as exc:
            print(f"PDF crypto pages skipped: {exc}")
    else:
        for raw, label in crypto_charts:
            try:
                png_pages.append(
                    _render_chart_showcase(raw, "CRYPTO", f"{label} technical chart", accent=ACCENT)
                )
            except Exception as exc:
                print(f"PDF crypto page skipped: {exc}")

    png_pages.append(_render_notes_page())

    if not png_pages:
        raise RuntimeError("No PDF pages rendered")

    _png_pages_to_pdf(png_pages, out)
    print(
        f"Summary PDF written: {out} ({out.stat().st_size} bytes, pages={len(png_pages)})"
    )
    return out


def build_summary_pdf_safe(summary: dict, output_path: Path | None = None) -> Path:
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

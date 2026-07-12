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
SUMMARY_PRE_PDF_PATH = DATA_DIR / "summary_pre.pdf"
SUMMARY_KOR_PDF_PATH = DATA_DIR / "summary_kor.pdf"

# A4 @ 144 DPI — sharper charts without blowing Render memory
_PAGE_W = 1191
_PAGE_H = 1684
_MARGIN = 40
_FOOTER_H = 44
_CONTENT_BOTTOM = _PAGE_H - _FOOTER_H

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
    "kospi": ACCENT,
    "kosdaq": ACCENT2,
}

_font_path: Path | None = None
_font_tried = False
_font_cache: dict[int, object] = {}


def _safe(text: object) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\x00", "")
    value = re.sub(r"[\U00010000-\U0010FFFF]", "", value)
    return value.strip()


def _ensure_font_file() -> Path | None:
    global _font_tried, _font_path
    if _font_tried:
        return _font_path
    _font_tried = True
    from cjk_font import resolve_cjk_font_path

    _font_path = resolve_cjk_font_path(allow_download=True)
    if _font_path is None:
        print("PDF CJK font unavailable — Hangul may render as boxes")
    return _font_path


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


def _fit_text(draw, text: str, font, max_width: int) -> str:
    """Truncate text to fit pixel width (CJK-safe; avoids mid-line overflow)."""
    text = _safe(text)
    if not text:
        return text
    if _text_width(draw, text, font) <= max_width:
        return text
    ellipsis = "…"
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        candidate = text[:mid].rstrip() + ellipsis
        if _text_width(draw, candidate, font) <= max_width:
            lo = mid
        else:
            hi = mid - 1
    return (text[:lo].rstrip() + ellipsis) if lo else ellipsis


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
    *,
    max_pixel_width: int | None = None,
) -> int:
    """Wrap text. Prefer pixel width for CJK so Hangul does not overflow."""
    content = _safe(text)
    if not content:
        return y

    if max_pixel_width and max_pixel_width > 0:
        lines: list[str] = []
        current = ""
        for ch in content:
            trial = current + ch
            if current and _text_width(draw, trial, font) > max_pixel_width:
                lines.append(current)
                current = ch
            else:
                current = trial
        if current:
            lines.append(current)
    else:
        lines = textwrap.wrap(content, width=max_width_chars) or [""]

    for line in lines:
        if y > max_y:
            return y
        draw.text((x, y), line, font=font, fill=fill)
        y += line_h
    return y


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
    y = _PAGE_H - 32
    draw.line((_MARGIN, y - 8, _PAGE_W - _MARGIN, y - 8), fill=BORDER, width=1)
    draw.text((_MARGIN, y), "SavvyETF Market Brief", font=_load_font(11), fill=MUTED)
    if page_label:
        w = _text_width(draw, page_label, _load_font(11))
        draw.text((_PAGE_W - _MARGIN - w, y), page_label, font=_load_font(11), fill=MUTED)


def _draw_section_chip(draw, x: int, y: int, label: str, color: tuple[int, int, int]) -> int:
    font = _load_font(13)
    pad_x, pad_y = 12, 6
    tw = _text_width(draw, label, font)
    w, h = tw + pad_x * 2, 28
    draw.rounded_rectangle((x, y, x + w, y + h), radius=8, fill=PANEL2, outline=color, width=2)
    draw.text((x + pad_x, y + pad_y), label, font=font, fill=color)
    return h


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
    h = 36
    draw.rounded_rectangle((x, y, x + width, y + h), radius=8, fill=PANEL2, outline=BORDER, width=1)
    badge = 24
    bx = x + 8
    by = y + (h - badge) // 2
    badge_color = accent if rank == 1 else BORDER
    draw.rounded_rectangle((bx, by, bx + badge, by + badge), radius=6, fill=badge_color)
    rf = _load_font(12)
    rn = str(rank)
    rw = _text_width(draw, rn, rf)
    draw.text((bx + (badge - rw) // 2, by + 4), rn, font=rf, fill=WHITE if rank == 1 else MUTED)

    draw.text((bx + badge + 10, y + 8), _safe(ticker), font=_load_font(14), fill=TEXT)

    metric_text, positive = _parse_metric(metric)
    if positive is None:
        positive = bullish
    mcolor = ACCENT2 if positive else DANGER
    mw = _text_width(draw, metric_text, _load_font(13))
    draw.text((x + width - mw - 12, y + 9), metric_text, font=_load_font(13), fill=mcolor)
    return h


def _open_chart(png_bytes: bytes):
    from PIL import Image

    with Image.open(BytesIO(png_bytes)) as src:
        chart = src.convert("RGB")
        chart.load()
        return chart.copy()


def _fit_chart(chart, max_w: int, max_h: int, *, upscale: bool = True):
    """Scale chart to the largest size that fits in the box."""
    from PIL import Image

    w, h = chart.size
    if w <= 0 or h <= 0 or max_w <= 0 or max_h <= 0:
        return chart
    scale = min(max_w / w, max_h / h)
    if not upscale:
        scale = min(scale, 1.0)
    nw = max(1, int(w * scale))
    nh = max(1, int(h * scale))
    if (nw, nh) == (w, h):
        return chart
    return chart.resize((nw, nh), Image.Resampling.LANCZOS)


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
    *,
    fill: bool = False,
) -> int:
    """Paste a framed chart. fill=True expands the frame to use the full max_h budget."""
    start_y = y
    if title:
        draw.text((x + 2, y), _safe(title), font=_load_font(16), fill=TEXT)
        y += 22
        if subtitle:
            draw.text((x + 2, y), _safe(subtitle)[:120], font=_load_font(11), fill=MUTED)
            y += 16
        y += 4

    pad = 8
    used = y - start_y
    avail_w = max(40, max_w - pad * 2)
    avail_h = max(40, max_h - used - pad * 2)

    chart = chart.copy()
    chart = _fit_chart(chart, avail_w, avail_h, upscale=True)

    if fill:
        frame_h = avail_h + pad * 2
    else:
        frame_h = chart.height + pad * 2
    frame = (x, y, x + max_w, y + frame_h)
    draw.rounded_rectangle(frame, radius=12, fill=PANEL, outline=BORDER, width=1)

    cx = x + pad + (avail_w - chart.width) // 2
    cy = y + pad + ((avail_h - chart.height) // 2 if fill else 0)
    page.paste(chart, (cx, cy))
    try:
        chart.close()
    except Exception:
        pass
    return int(frame[3])


def _collect_news_blocks(
    universe: dict, summary: dict, *, max_tickers: int = 6, max_headlines: int = 2
) -> list[tuple[str, list[dict]]]:
    blocks: list[tuple[str, list[dict]]] = []
    for ticker in universe.get("tickers") or []:
        headlines = (summary.get("news_by_ticker") or {}).get(ticker) or []
        if headlines:
            blocks.append((str(ticker), headlines[:max_headlines]))
        if len(blocks) >= max_tickers:
            break
    return blocks


def _draw_compact_news(
    draw,
    blocks: list[tuple[str, list[dict]]],
    x: int,
    y: int,
    width: int,
    accent: tuple[int, int, int],
    max_y: int,
    *,
    heading: str = "Headlines",
    label_fn=None,
) -> int:
    if not blocks or y >= max_y - 40:
        return y
    draw.text((x, y), heading, font=_load_font(13), fill=MUTED)
    y += 20
    for ticker, headlines in blocks:
        if y > max_y - 24:
            break
        title = _safe((headlines[0] or {}).get("title", ""))
        source = _safe((headlines[0] or {}).get("source", ""))
        ticker_label = label_fn(ticker) if callable(label_fn) else ticker
        line = f"{ticker_label}  {title}"
        if source:
            line = f"{line}  · {source}"
        draw.rounded_rectangle((x, y, x + width, y + 28), radius=7, fill=PANEL2, outline=BORDER, width=1)
        font = _load_font(12)
        draw.text((x + 10, y + 6), _fit_text(draw, line, font, width - 24), font=font, fill=TEXT)
        # Color ticker prefix hint via small accent bar
        draw.rectangle((x, y, x + 4, y + 28), fill=accent)
        y += 32
    return y


# ── Page builders ──────────────────────────────────────────────────────────


def _render_universe_rankings_page(universe: dict, summary: dict) -> bytes:
    """One dense page: rankings + compact headlines + leader chart filling the rest."""
    img, draw = _new_page()
    ukey = str(universe.get("key", ""))
    accent = UNIVERSE_COLORS.get(ukey, ACCENT)
    name = _safe(universe.get("name", ukey or "Universe"))
    is_pre = summary.get("kind") == "summary_pre"
    is_kor = summary.get("kind") == "summary_kor"
    notes_reserve = 52 if (is_pre or is_kor) else 0
    content_limit = _CONTENT_BOTTOM - notes_reserve

    y = _MARGIN
    if is_pre:
        chip = "PRE"
        chip_color = WARN
    elif is_kor:
        chip = ukey.upper() or "KR"
        chip_color = accent
    else:
        chip = ukey.upper() or "UNI"
        chip_color = accent
    _draw_section_chip(draw, _MARGIN, y, chip, chip_color)
    draw.text((_MARGIN + 86, y + 2), name, font=_load_font(24), fill=TEXT)
    y += 34
    when = _safe(summary.get("generated_at_display", ""))
    if is_pre:
        metric_line = "Pre-market % vs previous close  ·  Finnhub extended-hours"
    elif is_kor:
        metric_line = "Price: last day return  ·  Volume: latest / 21d avg  ·  Yahoo .KS/.KQ"
    else:
        metric_line = "Price: last day return  ·  Volume: latest / 21d avg"
    if when:
        metric_line = f"{when}  ·  {metric_line}"
    draw.text((_MARGIN, y), metric_line[:110], font=_load_font(12), fill=MUTED)
    y += 22

    leader_pack = (summary.get("leader_charts") or {}).get(ukey) or {}
    leader_png = (
        chart_to_png_bytes(_leader_chart(leader_pack))
        if isinstance(leader_pack, dict)
        else None
    )
    news_blocks = _collect_news_blocks(universe, summary, max_tickers=5, max_headlines=1)

    col_gap = 12
    col_w = (_PAGE_W - 2 * _MARGIN - col_gap) // 2
    if is_pre:
        boards = [
            ("surge", "▲ Premarket gainers", True, ACCENT2),
            ("dropvol", "▼ Premarket losers", False, DANGER),
        ]
    elif is_kor:
        boards = [
            ("surge", "▲ 상승+거래 급증", True, ACCENT2),
            ("dropvol", "▼ 하락+거래 급증", False, DANGER),
        ]
    else:
        boards = [
            ("surge", "▲ Surge (price↑ + vol)", True, ACCENT2),
            ("dropvol", "▼ Drop + volume", False, DANGER),
        ]

    content_bottom = y
    for col, (mode, title, bullish, mode_color) in enumerate(boards):
        x = _MARGIN + col * (col_w + col_gap)
        cy = y
        draw.rounded_rectangle(
            (x, cy, x + col_w, cy + 28),
            radius=8,
            fill=PANEL,
            outline=mode_color,
            width=2,
        )
        draw.text((x + 10, cy + 5), title, font=_load_font(12), fill=mode_color)
        cy += 34

        rows = ((universe.get("boards") or {}).get(mode) or {}).get("top") or []
        if not rows:
            draw.text((x + 8, cy), "(no rows)", font=_load_font(13), fill=MUTED)
            content_bottom = max(content_bottom, cy + 24)
            continue
        for idx, row in enumerate(rows[:5], start=1):
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                ticker, metric = row[0], row[1]
            else:
                ticker, metric = row, ""
            display = str(ticker)
            if is_kor:
                try:
                    from kr_names import format_kr_ticker_label

                    display = format_kr_ticker_label(str(ticker))
                except Exception:
                    display = str(ticker)
            h = _draw_rank_row(
                draw, x, cy, col_w, idx, display, str(metric), accent, bullish
            )
            cy += h + 4
        content_bottom = max(content_bottom, cy)

    y = content_bottom + 10
    page_w = _PAGE_W - 2 * _MARGIN

    # Compact headlines packed above the chart so leftover space goes to the chart.
    if news_blocks:
        news_kwargs = {}
        if is_kor:
            from kr_names import format_kr_ticker_label

            news_kwargs = {
                "heading": "Naver News",
                "label_fn": format_kr_ticker_label,
            }
        y = _draw_compact_news(
            draw,
            news_blocks,
            _MARGIN,
            y,
            page_w,
            accent,
            max_y=content_limit - 280,
            **news_kwargs,
        )
        y += 8

    if leader_png:
        note = ((summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}).get(ukey, "")
        ticker = (leader_pack or {}).get("ticker") or universe.get("leader_ticker") or ukey
        chart_budget = max(240, content_limit - y)
        chart = _open_chart(leader_png)
        _paste_chart_in_frame(
            img,
            draw,
            chart,
            _MARGIN,
            y,
            page_w,
            chart_budget,
            title=(
                f"{'Premarket leader' if is_pre else 'Leader'} — {_safe(ticker)}"
                if not is_kor
                else f"리더 — {_safe(ticker)}"
            ),
            subtitle=_safe(note),
            fill=True,
        )
        try:
            chart.close()
        except Exception:
            pass
    else:
        leader = universe.get("leader_ticker")
        if leader:
            draw.rounded_rectangle(
                (_MARGIN, y, _PAGE_W - _MARGIN, min(y + 56, content_limit)),
                radius=12,
                fill=PANEL,
                outline=accent,
                width=2,
            )
            draw.text((_MARGIN + 16, y + 8), "Top surge leader", font=_load_font(12), fill=MUTED)
            draw.text((_MARGIN + 16, y + 26), _safe(leader), font=_load_font(22), fill=TEXT)

    if is_pre or is_kor:
        notes_y = _CONTENT_BOTTOM - notes_reserve
        draw.rounded_rectangle(
            (_MARGIN, notes_y, _PAGE_W - _MARGIN, notes_y + notes_reserve - 4),
            radius=10,
            fill=PANEL2,
            outline=BORDER,
            width=1,
        )
        if is_pre:
            line1 = "Not financial advice · Finnhub pre/extended · PDF: /summary_pre.pdf"
            line2 = "SavvyETF premarket brief · ETF excluded"
            footer = "premarket"
        else:
            line1 = "투자 권유 아님 · Yahoo(.KS/.KQ) · Naver News · PDF: /summary_kor.pdf"
            line2 = "SavvyETF Korea brief · KOSPI200 + KOSDAQ100"
            footer = "korea"
        draw.text((_MARGIN + 14, notes_y + 8), line1, font=_load_font(12), fill=MUTED)
        draw.text((_MARGIN + 14, notes_y + 26), line2, font=_load_font(12), fill=MUTED)
        _draw_footer(draw, footer)
        return _image_to_png_bytes(img)

    _draw_footer(draw, f"{ukey} rankings")
    return _image_to_png_bytes(img)


def _render_news_page(universe: dict, summary: dict) -> bytes | None:
    """Fallback only — prefer packing news into the rankings page."""
    blocks = _collect_news_blocks(universe, summary, max_tickers=8, max_headlines=3)
    if not blocks:
        return None

    ukey = str(universe.get("key", ""))
    accent = UNIVERSE_COLORS.get(ukey, ACCENT)
    img, draw = _new_page()
    y = _MARGIN
    _draw_section_chip(draw, _MARGIN, y, "NEWS", accent)
    draw.text(
        (_MARGIN + 86, y + 2),
        f"{_safe(universe.get('name', ukey))} — Headlines",
        font=_load_font(22),
        fill=TEXT,
    )
    y += 40
    y = _draw_compact_news(draw, blocks, _MARGIN, y, _PAGE_W - 2 * _MARGIN, accent, _CONTENT_BOTTOM)
    _draw_footer(draw, f"{ukey} news")
    return _image_to_png_bytes(img)


def _render_ai_closing_page(
    summary: dict, crypto_charts: list[tuple[bytes, str]] | None = None
) -> bytes | None:
    """AI brief + notes (+ optional crypto) packed onto one page."""
    ai = summary.get("ai_analysis") or {}
    brief = _strip_disclaimer((ai.get("market_brief_ko") or "").strip())
    crypto_charts = crypto_charts or []
    if not brief and not crypto_charts:
        return None

    img, draw = _new_page()
    y = _MARGIN
    notes_h = 52
    usable_bottom = _CONTENT_BOTTOM - notes_h - 10

    if brief:
        _draw_section_chip(draw, _MARGIN, y, "AI", WARN)
        draw.text((_MARGIN + 64, y + 2), "AI 시장 브리핑", font=_load_font(24), fill=TEXT)
        y += 34
        meta = f"source: {_safe(ai.get('source', 'ai'))}  ·  articles: {ai.get('article_count', 0)}"
        draw.text((_MARGIN, y), meta, font=_load_font(12), fill=MUTED)
        y += 18

        paras = [p.strip() for p in re.split(r"\n+", brief) if p.strip()]
        notes = ai.get("chart_notes_ko") or {}

        # Hug AI text when there is no crypto below; leftover space gets a filler chart.
        if crypto_charts:
            crypto_band = max(220, int((usable_bottom - y) * 0.42))
            max_y = usable_bottom - crypto_band - 8
        else:
            line_h = 20
            est = 24
            for para in paras:
                est += max(1, len(textwrap.wrap(para, width=62))) * line_h + 8
            if notes:
                est += 24
                for key, note in notes.items():
                    est += max(1, len(textwrap.wrap(f"[{key}] {note}", width=62))) * 17
            max_y = min(usable_bottom, y + est + 20)
            # If leftover is small, just extend the panel so the page isn't hollow.
            if usable_bottom - max_y < 260:
                max_y = usable_bottom

        draw.rounded_rectangle(
            (_MARGIN, y, _PAGE_W - _MARGIN, max_y),
            radius=12,
            fill=PANEL,
            outline=BORDER,
            width=1,
        )
        ty = y + 12
        for para in paras:
            ty = _draw_wrapped(
                draw,
                para,
                _MARGIN + 16,
                ty,
                62,
                _load_font(14),
                TEXT,
                20,
                max_y - 10,
                max_pixel_width=_PAGE_W - 2 * _MARGIN - 32,
            )
            ty += 8
            if ty > max_y - 10:
                break
        if notes and ty < max_y - 36:
            draw.text((_MARGIN + 16, ty), "Chart notes", font=_load_font(12), fill=ACCENT)
            ty += 18
            for key, note in notes.items():
                ty = _draw_wrapped(
                    draw,
                    f"[{key}] {note}",
                    _MARGIN + 16,
                    ty,
                    62,
                    _load_font(12),
                    MUTED,
                    17,
                    max_y - 8,
                    max_pixel_width=_PAGE_W - 2 * _MARGIN - 32,
                )
        y = max_y + 8

    if crypto_charts:
        _draw_section_chip(draw, _MARGIN, y, "CRYPTO", ACCENT)
        draw.text((_MARGIN + 96, y + 2), "Bitcoin & Ethereum", font=_load_font(18), fill=TEXT)
        y += 32
        gap = 12
        n = min(2, len(crypto_charts))
        col_w = (_PAGE_W - 2 * _MARGIN - gap * (n - 1)) // n
        chart_h = max(160, usable_bottom - y)
        for col, (raw, caption) in enumerate(crypto_charts[:2]):
            x = _MARGIN + col * (col_w + gap)
            chart = _open_chart(raw)
            _paste_chart_in_frame(
                img, draw, chart, x, y, col_w, chart_h, title=caption, fill=True
            )
            try:
                chart.close()
            except Exception:
                pass

    notes_y = _CONTENT_BOTTOM - notes_h
    draw.rounded_rectangle(
        (_MARGIN, notes_y, _PAGE_W - _MARGIN, notes_y + notes_h - 4),
        radius=10,
        fill=PANEL2,
        outline=BORDER,
        width=1,
    )
    draw.text(
        (_MARGIN + 14, notes_y + 8),
        "Not financial advice · Yahoo / Finnhub / Gemini · Web: /summary  PDF: /summary.pdf",
        font=_load_font(12),
        fill=MUTED,
    )
    draw.text(
        (_MARGIN + 14, notes_y + 26),
        "Generated by SavvyETF bot",
        font=_load_font(12),
        fill=MUTED,
    )

    _draw_footer(draw, "AI & notes")
    return _image_to_png_bytes(img)


def _render_ai_page(summary: dict) -> bytes | None:
    return _render_ai_closing_page(summary, crypto_charts=None)


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
    draw.text((_MARGIN + 96, y + 2), _fit_text(draw, _safe(title), _load_font(22), _PAGE_W - _MARGIN - 120), font=_load_font(22), fill=TEXT)
    y += 34
    if subtitle:
        y = _draw_wrapped(
            draw,
            subtitle,
            _MARGIN,
            y,
            78,
            _load_font(11),
            MUTED,
            16,
            y + 48,
            max_pixel_width=_PAGE_W - 2 * _MARGIN,
        )
        y += 6

    chart = _open_chart(png_bytes)
    _paste_chart_in_frame(
        img,
        draw,
        chart,
        _MARGIN,
        y,
        _PAGE_W - 2 * _MARGIN,
        _CONTENT_BOTTOM - y,
        fill=True,
    )
    try:
        chart.close()
    except Exception:
        pass

    _draw_footer(draw, eyebrow.lower())
    return _image_to_png_bytes(img)


def _render_markets_page(summary: dict) -> bytes | None:
    """Heatmap + macro stacked on one page, each filling its band."""
    heatmap = summary.get("heatmap_sp") or {}
    macro = summary.get("macro") or {}
    heat_png = chart_to_png_bytes(heatmap.get("chart"))
    macro_png = chart_to_png_bytes(macro.get("chart"))
    if not heat_png and not macro_png:
        if heatmap.get("error"):
            return _render_text_page_png(
                "S&P 500 heatmap", [f"Unavailable: {heatmap['error']}"]
            )
        return None

    img, draw = _new_page()
    y = _MARGIN
    _draw_section_chip(draw, _MARGIN, y, "MARKETS", ACCENT2)
    draw.text((_MARGIN + 110, y + 2), "Heatmap & Macro", font=_load_font(22), fill=TEXT)
    y += 36

    charts: list[tuple[bytes, str, str, tuple[int, int, int]]] = []
    if heat_png:
        charts.append(
            (
                heat_png,
                "S&P 500 Heatmap",
                _safe(heatmap.get("caption", "")),
                ACCENT2,
            )
        )
    if macro_png:
        charts.append(
            (
                macro_png,
                "Macro Risk",
                _safe(macro.get("caption", "")),
                WARN,
            )
        )

    gap = 12
    band = (_CONTENT_BOTTOM - y - gap * (len(charts) - 1)) // len(charts)
    for raw, title, subtitle, accent in charts:
        chart = _open_chart(raw)
        _paste_chart_in_frame(
            img,
            draw,
            chart,
            _MARGIN,
            y,
            _PAGE_W - 2 * _MARGIN,
            band,
            title=title,
            subtitle=subtitle,
            fill=True,
        )
        try:
            chart.close()
        except Exception:
            pass
        y += band + gap

    _draw_footer(draw, "markets")
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
    draw.text((_MARGIN + 96, y + 2), _safe(title), font=_load_font(22), fill=TEXT)
    y += 36

    gap = 12
    col_w = (_PAGE_W - 2 * _MARGIN - gap) // 2
    max_h = _CONTENT_BOTTOM - y

    for col, (raw, caption) in enumerate((left, right)):
        x = _MARGIN + col * (col_w + gap)
        chart = _open_chart(raw)
        _paste_chart_in_frame(img, draw, chart, x, y, col_w, max_h, title=caption, fill=True)
        try:
            chart.close()
        except Exception:
            pass

    _draw_footer(draw, eyebrow.lower())
    return _image_to_png_bytes(img)


def _render_notes_page() -> bytes:
    """Legacy single notes page — prefer AI closing strip."""
    img, draw = _new_page()
    y = _MARGIN
    draw.text((_MARGIN, y), "Notes", font=_load_font(24), fill=TEXT)
    y += 36
    for line in (
        "본 자료는 투자 권유가 아닙니다. Not financial advice.",
        "데이터: Yahoo Finance · Finnhub · Gemini",
        "웹 브리프: /summary  ·  PDF: /summary.pdf",
    ):
        draw.rounded_rectangle(
            (_MARGIN, y, _PAGE_W - _MARGIN, y + 42),
            radius=10,
            fill=PANEL,
            outline=BORDER,
            width=1,
        )
        draw.text((_MARGIN + 16, y + 12), line, font=_load_font(13), fill=MUTED)
        y += 50
    _draw_footer(draw, "notes")
    return _image_to_png_bytes(img)


# Kept for text-only fallback compatibility
def _render_text_page_png(title: str, paragraphs: list[str]) -> bytes:
    img, draw = _new_page()
    y = _MARGIN
    draw.text((_MARGIN, y), _safe(title), font=_load_font(26), fill=TEXT)
    y += 44
    for para in paragraphs:
        y = _draw_wrapped(
            draw,
            para,
            _MARGIN,
            y,
            68,
            _load_font(14),
            MUTED,
            22,
            _PAGE_H - 60,
            max_pixel_width=_PAGE_W - 2 * _MARGIN,
        )
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
    kind = str(summary.get("kind") or "summary")
    is_pre = kind == "summary_pre"
    is_kor = kind == "summary_kor"
    # Warm CJK font early so Hangul never falls back to the default bitmap font.
    _ensure_font_file()
    if is_kor:
        from cjk_font import configure_matplotlib_cjk

        configure_matplotlib_cjk()
    if output_path is not None:
        out = output_path
    elif is_pre:
        out = SUMMARY_PRE_PDF_PATH
    elif is_kor:
        out = SUMMARY_KOR_PDF_PATH
    else:
        out = SUMMARY_PDF_PATH
    png_pages: list[bytes] = []

    for universe in summary.get("universes") or []:
        # Rankings + headlines + leader chart share one dense page.
        png_pages.append(_render_universe_rankings_page(universe, summary))

    if is_kor:
        for ukey in ("kospi", "kosdaq"):
            pack = (summary.get("dart_by_universe") or {}).get(ukey) or {}
            if not isinstance(pack, dict) or pack.get("error"):
                continue
            raw = chart_to_png_bytes(pack.get("chart"))
            if not raw:
                continue
            try:
                png_pages.append(
                    _render_chart_showcase(
                        raw,
                        "DART",
                        str(pack.get("corp_name") or pack.get("leader_ticker") or ukey),
                        subtitle=_safe(pack.get("caption", "")),
                    )
                )
            except Exception as exc:
                print(f"PDF DART page skipped ({ukey}): {exc}")

    if not is_pre and not is_kor:
        markets = _render_markets_page(summary)
        if markets:
            png_pages.append(markets)

    # Orphan leader charts (no matching universe page)
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

    crypto_charts: list[tuple[bytes, str]] = []
    if not is_pre and not is_kor:
        for symbol in ("BTC", "ETH"):
            entry = (summary.get("crypto") or {}).get(symbol) or {}
            raw = chart_to_png_bytes(entry.get("chart"))
            if raw:
                crypto_charts.append((raw, str(entry.get("label") or symbol)))

    brief = _strip_disclaimer(
        ((summary.get("ai_analysis") or {}).get("market_brief_ko") or "").strip()
    )
    if brief or crypto_charts:
        closing = _render_ai_closing_page(summary, crypto_charts=crypto_charts)
        if closing:
            png_pages.append(closing)
        elif crypto_charts:
            if len(crypto_charts) == 2:
                png_pages.append(
                    _render_dual_chart_page(
                        crypto_charts[0],
                        crypto_charts[1],
                        "CRYPTO",
                        "Bitcoin & Ethereum",
                    )
                )
            else:
                for raw, label in crypto_charts:
                    png_pages.append(
                        _render_chart_showcase(
                            raw, "CRYPTO", f"{label} technical chart", accent=ACCENT
                        )
                    )
            png_pages.append(_render_notes_page())
    elif not is_pre and not is_kor:
        # Close brief always ends with a notes page; pre/kor keep notes on rankings pages.
        png_pages.append(_render_notes_page())

    if not png_pages:
        raise RuntimeError("No PDF pages rendered")

    _png_pages_to_pdf(png_pages, out)
    label = {"summary_pre": "Premarket", "summary_kor": "Korea"}.get(kind, "Summary")
    print(
        f"{label} PDF written: {out} ({out.stat().st_size} bytes, pages={len(png_pages)})"
    )
    return out


def build_summary_pdf_safe(summary: dict, output_path: Path | None = None) -> Path:
    kind = str(summary.get("kind") or "summary")
    is_pre = kind == "summary_pre"
    is_kor = kind == "summary_kor"
    try:
        return build_summary_pdf(summary, output_path=output_path)
    except Exception as first_exc:
        traceback.print_exc()
        print(f"Full PDF failed ({first_exc}); retrying text-only PDF")
        if output_path is not None:
            out = output_path
        elif is_pre:
            out = SUMMARY_PRE_PDF_PATH
        elif is_kor:
            out = SUMMARY_KOR_PDF_PATH
        else:
            out = SUMMARY_PDF_PATH
        try:
            title = {
                "summary_pre": "SavvyETF Premarket Brief",
                "summary_kor": "SavvyETF Korea Brief",
            }.get(kind, "SavvyETF Market Brief")
            png_pages = [
                _render_text_page_png(
                    title,
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
            if not is_pre and not is_kor:
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


def load_summary_pre_pdf_bytes() -> bytes | None:
    if not SUMMARY_PRE_PDF_PATH.exists():
        return None
    return SUMMARY_PRE_PDF_PATH.read_bytes()


def load_summary_kor_pdf_bytes() -> bytes | None:
    if not SUMMARY_KOR_PDF_PATH.exists():
        return None
    return SUMMARY_KOR_PDF_PATH.read_bytes()

"""Build a downloadable PDF from /summary data (no Selenium / no external fonts)."""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

from ai_briefing import _strip_disclaimer

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
SUMMARY_PDF_PATH = DATA_DIR / "summary.pdf"

# Built into ReportLab — no TTF download / apt fonts needed on Render.
_KOREAN_FONT = "HYGothic-Medium"


def _ensure_fonts() -> str:
    try:
        pdfmetrics.getFont(_KOREAN_FONT)
    except KeyError:
        pdfmetrics.registerFont(UnicodeCIDFont(_KOREAN_FONT))
    return _KOREAN_FONT


def _safe(text: object) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\x00", "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Drop supplementary-plane emoji that some CID fonts lack
    value = re.sub(r"[\U00010000-\U0010FFFF]", "", value)
    return value.strip()


def _p(text: object, style: ParagraphStyle) -> Paragraph:
    return Paragraph(_safe(text) or "&nbsp;", style)


def _chart_flowable(chart, *, max_width: float, max_height: float) -> Image | None:
    if chart is None:
        return None
    try:
        chart.seek(0)
        raw = chart.read()
        chart.seek(0)
    except Exception:
        return None
    if not raw:
        return None
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    try:
        tmp.write(raw)
        tmp.close()
        img = Image(tmp.name)
        img.hAlign = "LEFT"
        # Scale to fit box
        aspect = float(img.imageHeight) / float(img.imageWidth) if img.imageWidth else 1.0
        width = max_width
        height = width * aspect
        if height > max_height:
            height = max_height
            width = height / aspect if aspect else max_width
        img.drawWidth = width
        img.drawHeight = height
        # Keep temp path alive on the Image object until build finishes
        img._savvy_tmp = tmp.name  # type: ignore[attr-defined]
        return img
    except Exception:
        Path(tmp.name).unlink(missing_ok=True)
        return None


def build_summary_pdf(summary: dict, output_path: Path | None = None) -> Path:
    font = _ensure_fonts()
    out = output_path or SUMMARY_PDF_PATH
    out.parent.mkdir(parents=True, exist_ok=True)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "SavvyTitle",
        parent=styles["Title"],
        fontName=font,
        fontSize=18,
        leading=22,
        spaceAfter=8,
    )
    h_style = ParagraphStyle(
        "SavvyH",
        parent=styles["Heading2"],
        fontName=font,
        fontSize=13,
        leading=17,
        spaceBefore=12,
        spaceAfter=6,
        textColor="#14468c",
    )
    body = ParagraphStyle(
        "SavvyBody",
        parent=styles["BodyText"],
        fontName=font,
        fontSize=10,
        leading=14,
        spaceAfter=3,
    )
    meta = ParagraphStyle(
        "SavvyMeta",
        parent=body,
        fontSize=9,
        textColor="#555555",
    )
    sub = ParagraphStyle(
        "SavvySub",
        parent=body,
        fontSize=11,
        leading=15,
        spaceBefore=4,
        spaceAfter=2,
    )

    story: list = []
    story.append(_p("SavvyETF Market Brief", title_style))
    story.append(_p(summary.get("generated_at_display", ""), meta))
    story.append(
        _p(
            f"Tickers with news: {summary.get('ticker_count', 0)} | PDF export (ReportLab, no Selenium)",
            meta,
        )
    )
    story.append(Spacer(1, 4 * mm))

    page_width = A4[0] - 36 * mm

    for universe in summary.get("universes") or []:
        name = universe.get("name", universe.get("key", "Universe"))
        story.append(_p(str(name), h_style))
        for mode in ("surge", "dropvol"):
            board = (universe.get("boards") or {}).get(mode) or {}
            title = (
                "Price up + volume surge"
                if mode == "surge"
                else "Price down + volume surge"
            )
            story.append(_p(title, sub))
            rows = board.get("top") or []
            if not rows:
                story.append(_p("No rows", body))
            for idx, (ticker, value) in enumerate(rows, start=1):
                story.append(_p(f"{idx}. {ticker}  {value}", body))

        for ticker in universe.get("tickers") or []:
            headlines = (summary.get("news_by_ticker") or {}).get(ticker) or []
            if not headlines:
                continue
            story.append(_p(f"News - {ticker}", sub))
            for item in headlines[:3]:
                story.append(
                    _p(f"- {item.get('title', '')} ({item.get('source', '')})", body)
                )

    ai = summary.get("ai_analysis") or {}
    brief = _strip_disclaimer((ai.get("market_brief_ko") or "").strip())
    if brief:
        story.append(_p("AI market briefing", h_style))
        for para in re.split(r"\n+", brief):
            if para.strip():
                story.append(_p(para.strip(), body))
        notes = ai.get("chart_notes_ko") or {}
        if notes:
            story.append(_p("Chart notes", sub))
            for key, note in notes.items():
                story.append(_p(f"[{key}] {note}", body))

    heatmap = summary.get("heatmap_sp") or {}
    if heatmap.get("chart") is not None:
        story.append(_p("S&P 500 heatmap", h_style))
        if heatmap.get("caption"):
            story.append(_p(heatmap.get("caption"), meta))
        img = _chart_flowable(heatmap.get("chart"), max_width=page_width, max_height=110 * mm)
        if img:
            story.append(img)
    elif heatmap.get("error"):
        story.append(_p("S&P 500 heatmap", h_style))
        story.append(_p(f"Unavailable: {heatmap['error']}", body))

    leaders = summary.get("leader_charts") or {}
    if leaders:
        story.append(_p("Leader charts", h_style))
        for key, pack in leaders.items():
            if isinstance(pack, dict) and pack.get("chart") is not None:
                if pack.get("caption") or key:
                    story.append(_p(pack.get("caption") or str(key), meta))
                img = _chart_flowable(pack.get("chart"), max_width=page_width, max_height=95 * mm)
                if img:
                    story.append(img)

    macro = summary.get("macro") or {}
    if macro.get("chart") is not None:
        story.append(_p("Macro dashboard", h_style))
        if macro.get("caption"):
            story.append(_p(macro.get("caption"), meta))
        img = _chart_flowable(macro.get("chart"), max_width=page_width, max_height=100 * mm)
        if img:
            story.append(img)

    crypto = summary.get("crypto") or {}
    if crypto:
        story.append(_p("Crypto", h_style))
        for symbol in ("BTC", "ETH"):
            entry = crypto.get(symbol) or {}
            if entry.get("chart") is not None:
                story.append(_p(entry.get("label") or symbol, meta))
                img = _chart_flowable(entry.get("chart"), max_width=page_width, max_height=90 * mm)
                if img:
                    story.append(img)

    doc = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="SavvyETF Market Brief",
        author="SavvyETF",
    )
    try:
        doc.build(story)
    finally:
        # Cleanup temp chart files
        for item in story:
            tmp = getattr(item, "_savvy_tmp", None)
            if tmp:
                Path(tmp).unlink(missing_ok=True)

    if not out.is_file() or out.stat().st_size < 100:
        raise RuntimeError(f"PDF write failed or empty: {out}")
    print(f"Summary PDF written: {out} ({out.stat().st_size} bytes, font={font})")
    return out


def load_summary_pdf_bytes() -> bytes | None:
    if not SUMMARY_PDF_PATH.exists():
        return None
    return SUMMARY_PDF_PATH.read_bytes()

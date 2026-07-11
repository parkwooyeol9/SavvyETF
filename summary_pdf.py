"""Build a downloadable PDF from /summary data (no Selenium/Playwright)."""

from __future__ import annotations

import re
import tempfile
from io import BytesIO
from pathlib import Path

from fpdf import FPDF

from ai_briefing import _strip_disclaimer

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
SUMMARY_PDF_PATH = DATA_DIR / "summary.pdf"
FONTS_DIR = PROJECT_DIR / "fonts"

# Prefer bundled/project font, then common system CJK fonts (Render: fonts-nanum).
_FONT_CANDIDATES = (
    FONTS_DIR / "NanumGothic.ttf",
    FONTS_DIR / "NotoSansKR-Regular.ttf",
    Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf"),
    Path("/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf"),
    Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
    Path("/Library/Fonts/Arial Unicode.ttf"),
)


def _find_unicode_font() -> Path | None:
    for path in _FONT_CANDIDATES:
        if path.exists():
            return path
    return None


def _safe(text: object) -> str:
    value = "" if text is None else str(text)
    # fpdf is happier without unpaired surrogates / nulls
    return value.replace("\x00", "").strip()


class SummaryPDF(FPDF):
    def footer(self) -> None:
        self.set_y(-12)
        self.set_font(self._body_font, size=8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"SavvyETF · page {self.page_no()}/{{nb}} · not financial advice", align="C")


def _add_wrapped(pdf: SummaryPDF, text: str, *, size: int = 10, indent: float = 0) -> None:
    pdf.set_font(pdf._body_font, size=size)
    pdf.set_text_color(30, 30, 30)
    pdf.set_x(pdf.l_margin + indent)
    pdf.multi_cell(pdf.epw - indent, 5.5, _safe(text))


def _section_title(pdf: SummaryPDF, title: str) -> None:
    pdf.ln(4)
    pdf.set_font(pdf._body_font, size=13)
    pdf.set_text_color(20, 70, 140)
    pdf.multi_cell(pdf.epw, 7, _safe(title))
    pdf.set_draw_color(200, 200, 200)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + pdf.epw, pdf.get_y())
    pdf.ln(2)


def _write_image(pdf: SummaryPDF, chart, *, caption: str = "", max_h: float = 90) -> None:
    if chart is None:
        return
    try:
        chart.seek(0)
        raw = chart.read()
        chart.seek(0)
    except Exception:
        return
    if not raw:
        return
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
        handle.write(raw)
        path = handle.name
    try:
        if caption:
            _add_wrapped(pdf, caption, size=9)
        # Keep aspect; width fills page content area.
        pdf.image(path, w=pdf.epw, h=max_h, keep_aspect_ratio=True)
        pdf.ln(3)
    except Exception as exc:
        _add_wrapped(pdf, f"(chart unavailable: {exc})", size=9)
    finally:
        Path(path).unlink(missing_ok=True)


def build_summary_pdf(summary: dict, output_path: Path | None = None) -> Path:
    """Render summary dict to PDF. Raises RuntimeError if no Unicode font is available."""
    font_path = _find_unicode_font()
    if font_path is None:
        raise RuntimeError(
            "No CJK-capable font found for PDF. "
            "Install fonts-nanum (Docker) or place NanumGothic.ttf under fonts/."
        )

    out = output_path or SUMMARY_PDF_PATH
    out.parent.mkdir(parents=True, exist_ok=True)

    pdf = SummaryPDF(format="A4", unit="mm")
    pdf._body_font = "SummarySans"
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.alias_nb_pages()
    pdf.add_font("SummarySans", fname=str(font_path))
    pdf.add_page()

    pdf.set_font("SummarySans", size=18)
    pdf.set_text_color(15, 15, 15)
    pdf.multi_cell(pdf.epw, 9, "SavvyETF Market Brief")
    pdf.set_font("SummarySans", size=11)
    pdf.set_text_color(80, 80, 80)
    pdf.multi_cell(
        pdf.epw,
        6,
        _safe(summary.get("generated_at_display", "")),
    )
    pdf.multi_cell(
        pdf.epw,
        6,
        f"Tickers with news: {summary.get('ticker_count', 0)} · Generated without browser/Selenium",
    )

    for universe in summary.get("universes") or []:
        name = universe.get("name", universe.get("key", "Universe"))
        _section_title(pdf, str(name))
        for mode in ("surge", "dropvol"):
            board = (universe.get("boards") or {}).get(mode) or {}
            title = "Price up + volume surge" if mode == "surge" else "Price down + volume surge"
            pdf.set_font("SummarySans", size=11)
            pdf.set_text_color(40, 40, 40)
            pdf.multi_cell(pdf.epw, 6, title)
            rows = board.get("top") or []
            if not rows:
                _add_wrapped(pdf, "No rows", size=9, indent=2)
            for idx, (ticker, value) in enumerate(rows, start=1):
                _add_wrapped(pdf, f"{idx}. {ticker}  {value}", size=10, indent=2)
            pdf.ln(1)

        for ticker in universe.get("tickers") or []:
            headlines = (summary.get("news_by_ticker") or {}).get(ticker) or []
            if not headlines:
                continue
            pdf.set_font("SummarySans", size=10)
            pdf.set_text_color(20, 70, 140)
            pdf.multi_cell(pdf.epw, 5.5, f"News · {ticker}")
            for item in headlines[:3]:
                line = f"- {item.get('title', '')} ({item.get('source', '')})"
                _add_wrapped(pdf, line, size=9, indent=2)

    ai = summary.get("ai_analysis") or {}
    brief = _strip_disclaimer((ai.get("market_brief_ko") or "").strip())
    if brief:
        _section_title(pdf, "AI market briefing")
        for para in re.split(r"\n+", brief):
            if para.strip():
                _add_wrapped(pdf, para.strip(), size=10)
        notes = ai.get("chart_notes_ko") or {}
        if notes:
            pdf.ln(2)
            pdf.set_font("SummarySans", size=11)
            pdf.multi_cell(pdf.epw, 6, "Chart notes")
            for key, note in notes.items():
                _add_wrapped(pdf, f"[{key}] {note}", size=9)

    heatmap = summary.get("heatmap_sp") or {}
    if heatmap.get("chart") is not None:
        _section_title(pdf, "S&P 500 heatmap")
        _write_image(pdf, heatmap.get("chart"), caption=heatmap.get("caption", ""), max_h=100)
    elif heatmap.get("error"):
        _section_title(pdf, "S&P 500 heatmap")
        _add_wrapped(pdf, f"Unavailable: {heatmap['error']}", size=9)

    leaders = summary.get("leader_charts") or {}
    if leaders:
        _section_title(pdf, "Leader charts")
        for key, pack in leaders.items():
            if isinstance(pack, dict) and pack.get("chart") is not None:
                _write_image(
                    pdf,
                    pack.get("chart"),
                    caption=pack.get("caption") or str(key),
                    max_h=85,
                )

    macro = summary.get("macro") or {}
    if macro.get("chart") is not None:
        _section_title(pdf, "Macro dashboard")
        _write_image(pdf, macro.get("chart"), caption=macro.get("caption", ""), max_h=95)

    crypto = summary.get("crypto") or {}
    if crypto:
        _section_title(pdf, "Crypto")
        for symbol in ("BTC", "ETH"):
            entry = crypto.get(symbol) or {}
            if entry.get("chart") is not None:
                _write_image(
                    pdf,
                    entry.get("chart"),
                    caption=entry.get("label") or symbol,
                    max_h=80,
                )

    pdf.output(str(out))
    return out


def load_summary_pdf_bytes() -> bytes | None:
    if not SUMMARY_PDF_PATH.exists():
        return None
    return SUMMARY_PDF_PATH.read_bytes()

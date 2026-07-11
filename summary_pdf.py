"""Build /summary PDF with matplotlib only (already in requirements — no reportlab/fpdf)."""

from __future__ import annotations

import re
import textwrap
from io import BytesIO
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.backends.backend_pdf import PdfPages

from ai_briefing import _strip_disclaimer

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
SUMMARY_PDF_PATH = DATA_DIR / "summary.pdf"
_RUNTIME_FONT = DATA_DIR / "fonts" / "NanumGothic.ttf"
_FONT_URL = (
    "https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/"
    "NanumGothic-Regular.ttf"
)

_font_name: str | None = None


def _safe(text: object) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\x00", "")
    value = re.sub(r"[\U00010000-\U0010FFFF]", "", value)
    return value.strip()


def _ensure_font() -> str:
    """Prefer a runtime-downloaded CJK font; fall back to DejaVu (Latin only)."""
    global _font_name
    if _font_name:
        return _font_name

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
            _font_name = "DejaVu Sans"
            return _font_name

    try:
        font_manager.fontManager.addfont(str(font_path))
        props = font_manager.FontProperties(fname=str(font_path))
        _font_name = props.get_name()
        plt.rcParams["font.family"] = _font_name
        plt.rcParams["axes.unicode_minus"] = False
        print(f"PDF using font: {_font_name}")
        return _font_name
    except Exception as exc:
        print(f"PDF font register failed: {exc}")
        _font_name = "DejaVu Sans"
        return _font_name


def _new_text_page(title: str = "") -> tuple:
    fig = plt.figure(figsize=(8.27, 11.69))  # A4 inches
    ax = fig.add_axes([0.08, 0.06, 0.84, 0.88])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    y = 0.96
    if title:
        ax.text(0, y, _safe(title), fontsize=16, fontweight="bold", va="top")
        y -= 0.05
    return fig, ax, y


def _write_lines(ax, y: float, lines: list[str], *, fontsize: int = 10, dy: float = 0.028) -> float:
    for line in lines:
        if y < 0.05:
            break
        ax.text(0, y, _safe(line), fontsize=fontsize, va="top", wrap=False)
        y -= dy
    return y


def _add_text_block(pdf: PdfPages, title: str, paragraphs: list[str]) -> None:
    font = _ensure_font()
    plt.rcParams["font.family"] = font
    fig, ax, y = _new_text_page(title)
    for para in paragraphs:
        wrapped = textwrap.wrap(_safe(para), width=88) or [""]
        if y < 0.08:
            pdf.savefig(fig)
            plt.close(fig)
            fig, ax, y = _new_text_page(title)
        y = _write_lines(ax, y, wrapped, fontsize=10)
        y -= 0.015
    pdf.savefig(fig)
    plt.close(fig)


def _add_chart_page(pdf: PdfPages, chart, caption: str = "") -> None:
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
    try:
        import matplotlib.image as mpimg

        img = mpimg.imread(BytesIO(raw), format="png")
        fig = plt.figure(figsize=(8.27, 11.69))
        if caption:
            fig.suptitle(_safe(caption), fontsize=11, y=0.98)
        ax = fig.add_axes([0.06, 0.2, 0.88, 0.7])
        ax.imshow(img)
        ax.axis("off")
        pdf.savefig(fig)
        plt.close(fig)
    except Exception as exc:
        print(f"PDF chart page skipped: {exc}")


def build_summary_pdf(summary: dict, output_path: Path | None = None) -> Path:
    out = output_path or SUMMARY_PDF_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    _ensure_font()

    with PdfPages(out) as pdf:
        header_lines = [
            _safe(summary.get("generated_at_display", "")),
            f"Tickers with news: {summary.get('ticker_count', 0)}",
            "PDF export via matplotlib (no Selenium / no extra PDF packages)",
        ]
        _add_text_block(pdf, "SavvyETF Market Brief", header_lines)

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

            _add_text_block(pdf, name, paragraphs)

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
            _add_text_block(pdf, "AI market briefing", paras)

        heatmap = summary.get("heatmap_sp") or {}
        if heatmap.get("chart") is not None:
            _add_chart_page(pdf, heatmap.get("chart"), heatmap.get("caption", "S&P 500 heatmap"))
        elif heatmap.get("error"):
            _add_text_block(pdf, "S&P 500 heatmap", [f"Unavailable: {heatmap['error']}"])

        leaders = summary.get("leader_charts") or {}
        for key, pack in (leaders or {}).items():
            if isinstance(pack, dict) and pack.get("chart") is not None:
                _add_chart_page(pdf, pack.get("chart"), pack.get("caption") or str(key))

        macro = summary.get("macro") or {}
        if macro.get("chart") is not None:
            _add_chart_page(pdf, macro.get("chart"), macro.get("caption", "Macro dashboard"))

        crypto = summary.get("crypto") or {}
        for symbol in ("BTC", "ETH"):
            entry = (crypto or {}).get(symbol) or {}
            if entry.get("chart") is not None:
                _add_chart_page(pdf, entry.get("chart"), entry.get("label") or symbol)

        # Footer page
        _add_text_block(
            pdf,
            "Notes",
            [
                "Not financial advice.",
                "Web brief: /summary",
                "Generated by SavvyETF bot.",
            ],
        )

    if not out.is_file() or out.stat().st_size < 100:
        raise RuntimeError(f"PDF write failed or empty: {out}")
    print(f"Summary PDF written: {out} ({out.stat().st_size} bytes)")
    return out


def load_summary_pdf_bytes() -> bytes | None:
    if not SUMMARY_PDF_PATH.exists():
        return None
    return SUMMARY_PDF_PATH.read_bytes()

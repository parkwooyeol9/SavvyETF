"""Build /summary PDF without matplotlib PdfPages (avoids closed-file I/O bugs).

Each page is rendered to PNG with matplotlib, then stitched into a PDF with Pillow.
"""

from __future__ import annotations

import re
import textwrap
from io import BytesIO
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

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
_PAGE_SIZE = (8.27, 11.69)  # A4 inches


def _safe(text: object) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\x00", "")
    value = re.sub(r"[\U00010000-\U0010FFFF]", "", value)
    return value.strip()


def _ensure_font() -> str:
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


def _chart_to_png_bytes(chart) -> bytes | None:
    if chart is None:
        return None
    if isinstance(chart, (bytes, bytearray)):
        return bytes(chart)
    # Prefer getbuffer/getvalue before seek/read — works even at EOF.
    for getter in ("getbuffer", "getvalue"):
        fn = getattr(chart, getter, None)
        if not callable(fn):
            continue
        try:
            data = bytes(fn())
            if data:
                return data
        except Exception:
            continue
    try:
        pos = chart.tell() if hasattr(chart, "tell") else None
        if hasattr(chart, "seek"):
            chart.seek(0)
        data = chart.read()
        if hasattr(chart, "seek") and pos is not None:
            try:
                chart.seek(pos)
            except Exception:
                pass
        return bytes(data) if data else None
    except Exception as exc:
        print(f"PDF chart snapshot failed: {exc}")
        return None


def _fig_to_png_bytes(fig) -> bytes:
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=140, facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _render_text_page(title: str, paragraphs: list[str]) -> bytes:
    _ensure_font()
    fig = plt.figure(figsize=_PAGE_SIZE, facecolor="white")
    ax = fig.add_axes([0.08, 0.06, 0.84, 0.88])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    y = 0.97
    if title:
        ax.text(0, y, _safe(title), fontsize=16, fontweight="bold", va="top", color="#111")
        y -= 0.05
    for para in paragraphs:
        for line in textwrap.wrap(_safe(para), width=88) or [""]:
            if y < 0.04:
                break
            ax.text(0, y, line, fontsize=10, va="top", color="#222")
            y -= 0.028
        y -= 0.012
    return _fig_to_png_bytes(fig)


def _render_chart_page(png_bytes: bytes, caption: str = "") -> bytes:
    import matplotlib.image as mpimg

    img = mpimg.imread(BytesIO(png_bytes), format="png")
    fig = plt.figure(figsize=_PAGE_SIZE, facecolor="white")
    if caption:
        fig.suptitle(_safe(caption), fontsize=11, y=0.97, color="#111")
    ax = fig.add_axes([0.06, 0.18, 0.88, 0.72])
    ax.imshow(img)
    ax.axis("off")
    return _fig_to_png_bytes(fig)


def _png_pages_to_pdf(pages: list[bytes], out: Path) -> None:
    from PIL import Image

    if not pages:
        raise RuntimeError("No PDF pages to write")

    images: list[Image.Image] = []
    try:
        for raw in pages:
            images.append(Image.open(BytesIO(raw)).convert("RGB"))
        first, rest = images[0], images[1:]
        out.parent.mkdir(parents=True, exist_ok=True)
        first.save(
            str(out),
            format="PDF",
            save_all=True,
            append_images=rest,
            resolution=140.0,
        )
    finally:
        for image in images:
            try:
                image.close()
            except Exception:
                pass


def _leader_chart(pack: dict):
    return pack.get("chart_png") or pack.get("chart")


def build_summary_pdf(summary: dict, output_path: Path | None = None) -> Path:
    out = output_path or SUMMARY_PDF_PATH
    _ensure_font()

    pages: list[bytes] = []

    header_lines = [
        _safe(summary.get("generated_at_display", "")),
        f"Tickers with news: {summary.get('ticker_count', 0)}",
        "PDF export via matplotlib+Pillow (no Selenium)",
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
    heatmap_png = _chart_to_png_bytes(heatmap.get("chart"))
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
        raw = _chart_to_png_bytes(_leader_chart(pack))
        if not raw:
            continue
        caption = pack.get("caption") or pack.get("ticker") or str(key)
        try:
            pages.append(_render_chart_page(raw, str(caption)))
        except Exception as exc:
            print(f"PDF leader page skipped: {exc}")

    macro = summary.get("macro") or {}
    macro_png = _chart_to_png_bytes(macro.get("chart"))
    if macro_png:
        try:
            pages.append(_render_chart_page(macro_png, macro.get("caption", "Macro dashboard")))
        except Exception as exc:
            print(f"PDF macro page skipped: {exc}")

    for symbol in ("BTC", "ETH"):
        entry = (summary.get("crypto") or {}).get(symbol) or {}
        raw = _chart_to_png_bytes(entry.get("chart"))
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

    _png_pages_to_pdf(pages, out)
    if not out.is_file() or out.stat().st_size < 100:
        raise RuntimeError(f"PDF write failed or empty: {out}")
    print(f"Summary PDF written: {out} ({out.stat().st_size} bytes, pages={len(pages)})")
    return out


def load_summary_pdf_bytes() -> bytes | None:
    if not SUMMARY_PDF_PATH.exists():
        return None
    return SUMMARY_PDF_PATH.read_bytes()

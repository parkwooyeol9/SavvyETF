"""Render SavvyETF market brief as a styled PDF (homepage-like UI)."""

from __future__ import annotations

import base64
import os
import subprocess
import sys
import tempfile
from io import BytesIO
from pathlib import Path

from ai_briefing import _strip_disclaimer
from news_crawler import _display_ticker_label
from summary_builder import (
    BOARD_TITLES,
    DATA_DIR,
    DEFAULT_TOP_N,
    UNIVERSE_STYLE,
    _esc,
    _render_board_html,
)

PROJECT_DIR = Path(__file__).resolve().parent
WORKER_SCRIPT = PROJECT_DIR / "summary_pdf_worker.py"
SUMMARY_PDF_PATH = DATA_DIR / "summary.pdf"

PDF_CSS = """
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Instrument+Serif&display=swap');

:root {
  --bg: #0b1018;
  --panel: #141d2b;
  --panel-2: #1a2538;
  --text: #e8eef5;
  --muted: #8fa3b8;
  --accent: #4da3ff;
  --accent-2: #3dd68c;
  --border: #2b3648;
}

@page {
  size: A4;
  margin: 14mm 12mm;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(ellipse 80% 45% at 12% -8%, rgba(77, 163, 255, 0.16), transparent 58%),
    radial-gradient(ellipse 55% 35% at 92% 4%, rgba(61, 214, 140, 0.08), transparent 52%);
}

.wrap {
  max-width: 780px;
  margin: 0 auto;
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 18px;
  margin-bottom: 22px;
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 11pt;
  letter-spacing: -0.02em;
}

.brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px rgba(77, 163, 255, 0.55);
}

.doc-tag {
  font-size: 8pt;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-2);
  padding: 0.28rem 0.65rem;
  border-radius: 999px;
  border: 1px solid rgba(61, 214, 140, 0.25);
  background: rgba(61, 214, 140, 0.08);
}

.hero h1 {
  font-family: "Instrument Serif", Georgia, serif;
  font-size: 24pt;
  font-weight: 400;
  line-height: 1.12;
  margin: 0 0 8px;
  letter-spacing: -0.02em;
}

.hero .meta {
  color: var(--muted);
  font-size: 9.5pt;
  margin: 0 0 14px;
}

.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 24px;
}

.pill {
  font-size: 8pt;
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--muted);
  background: rgba(255, 255, 255, 0.03);
}

.section {
  margin: 26px 0;
  page-break-inside: avoid;
}

.section-divider {
  border: none;
  height: 1px;
  margin: 28px 0;
  background: linear-gradient(90deg, transparent, var(--border) 15%, var(--border) 85%, transparent);
}

.universe-section {
  padding: 18px 16px 22px;
  border: 1px solid var(--border);
  border-radius: 14px;
  border-top: 4px solid var(--section-color);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), transparent 100px);
  page-break-inside: avoid;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.section-emoji { font-size: 16pt; line-height: 1; }

.section-header h2 {
  margin: 0;
  font-family: "Instrument Serif", Georgia, serif;
  font-size: 16pt;
  font-weight: 400;
}

.meta {
  color: var(--muted);
  font-size: 9pt;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
}

.card h3 {
  margin: 0 0 8px;
  font-size: 10pt;
  color: var(--accent);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
}

caption {
  text-align: left;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 8pt;
}

th, td {
  padding: 5px 3px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.pos { color: var(--accent-2); font-variant-numeric: tabular-nums; }

.news-heading {
  margin: 18px 0 10px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
  font-size: 10pt;
  color: var(--accent);
}

.news-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.news-block {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  page-break-inside: avoid;
}

.news-block h4 {
  margin: 0 0 6px;
  font-size: 9pt;
}

ul { margin: 0; padding-left: 16px; }
li { margin-bottom: 6px; font-size: 8.8pt; }
li .meta { display: block; margin-top: 2px; font-size: 8pt; }

.leader-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 18px 0 8px;
}

.leader-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  page-break-inside: avoid;
}

.leader-card h3 {
  margin: 0 0 6px;
  font-size: 10pt;
}

.leader-card img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.heatmap-section,
.ai-brief {
  margin: 22px 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  page-break-inside: avoid;
}

.heatmap-section h2,
.ai-brief h2 {
  margin: 0 0 8px;
  font-family: "Instrument Serif", Georgia, serif;
  font-size: 14pt;
  font-weight: 400;
}

.heatmap-section img {
  width: 100%;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.ai-brief p { margin: 0.45rem 0; line-height: 1.6; }

.footer {
  margin-top: 28px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 8pt;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

a { color: var(--accent); text-decoration: none; }
"""


def _buffer_to_data_uri(buffer: BytesIO | None, mime: str) -> str:
    if buffer is None:
        return ""
    buffer.seek(0)
    encoded = base64.b64encode(buffer.read()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _render_leader_charts_html(summary: dict) -> str:
    leaders = summary.get("leader_charts") or {}
    chart_notes = (summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}
    if not leaders:
        return ""

    cards: list[str] = []
    for ukey, pack in leaders.items():
        style = UNIVERSE_STYLE.get(ukey, {"emoji": "📊", "label": ukey})
        ticker = pack.get("ticker", "")
        label = ticker
        if ukey == "etf" and ticker:
            label = _display_ticker_label(ticker, "etf")
        title = f"{style['emoji']} {style.get('label', ukey)} leader — {label}"
        note = chart_notes.get(ukey, "").strip()
        chart = pack.get("chart_png")
        if chart is None:
            error = pack.get("error", "chart unavailable")
            cards.append(
                f"<article class='leader-card'><h3>{_esc(title)}</h3>"
                f"<p class='meta'>{_esc(error)}</p></article>"
            )
            continue
        img = _buffer_to_data_uri(chart, "image/png")
        note_html = f"<p class='meta'>{_esc(note)}</p>" if note else ""
        cards.append(
            f"<article class='leader-card'><h3>{_esc(title)}</h3>"
            f"{note_html}<img src='{img}' alt='{_esc(ticker)} chart' /></article>"
        )

    return f"""
    <section class="section">
      <h2 style="font-family:'Instrument Serif',Georgia,serif;font-size:14pt;font-weight:400;margin:0 0 10px;">
        📈 Top leaders
      </h2>
      <div class="leader-grid">{''.join(cards)}</div>
    </section>
    """


def _render_heatmap_pdf_html(summary: dict) -> str:
    pack = summary.get("heatmap_sp") or {}
    if pack.get("error"):
        return (
            "<section class='heatmap-section'><h2>🗺️ S&amp;P 500 Heatmap</h2>"
            f"<p class='meta'>Heatmap unavailable: {_esc(pack['error'])}</p></section>"
        )
    chart = pack.get("chart")
    if chart is None:
        return ""
    img = _buffer_to_data_uri(chart, "image/png")
    caption = _esc(pack.get("caption", "S&P 500 heatmap"))
    return f"""
    <section class="heatmap-section">
      <h2>🗺️ S&amp;P 500 Heatmap</h2>
      <p class="meta">{caption}</p>
      <img src="{img}" alt="S&amp;P 500 heatmap" />
    </section>
    """


def _render_ai_pdf_html(summary: dict) -> str:
    ai_analysis = summary.get("ai_analysis") or {}
    brief_ko = _strip_disclaimer(ai_analysis.get("market_brief_ko", "").strip())
    if not brief_ko:
        return ""
    ai_lines = "".join(f"<p>{_esc(line)}</p>" for line in brief_ko.split("\n") if line.strip())
    source = ai_analysis.get("source", "")
    article_count = ai_analysis.get("article_count", 0)
    return f"""
    <section class="ai-brief">
      <h2>🤖 AI 시장 브리핑</h2>
      <p class="meta">트렌딩 뉴스 {article_count}건 분석 ({_esc(source)})</p>
      {ai_lines}
    </section>
    """


def render_summary_pdf_html(summary: dict, public_url: str = "") -> str:
    title = f"Market Brief — {summary['generated_at_display']}"
    ticker_universe = summary.get("ticker_universe", {})

    sections_html: list[str] = []
    for index, universe in enumerate(summary["universes"]):
        ukey = universe["key"]
        style = UNIVERSE_STYLE.get(ukey, {"emoji": "📊", "label": universe["name"], "color": "#4da3ff"})
        divider = '<hr class="section-divider" />' if index > 0 else ""
        cards = "".join(
            _render_board_html(universe["boards"][mode], mode, universe_key=ukey)
            for mode in ("surge", "dropvol")
        )

        news_html: list[str] = []
        for ticker in universe["tickers"]:
            headlines = summary["news_by_ticker"].get(ticker, [])
            items = "".join(
                (
                    f"<li><strong>{_esc(item['title'])}</strong>"
                    f"<span class='meta'>{_esc(item['source'])} | {_esc(item['date'])}</span></li>"
                )
                for item in headlines
            )
            if not items:
                items = "<li class='meta'>No recent headlines</li>"
            label = _display_ticker_label(ticker, ticker_universe.get(ticker))
            news_html.append(f"<div class='news-block'><h4>{_esc(label)}</h4><ul>{items}</ul></div>")

        sections_html.append(
            f"""
            {divider}
            <section class="universe-section section-{ukey}" style="--section-color: {style['color']}">
              <div class="section-header">
                <span class="section-emoji">{style['emoji']}</span>
                <h2>{_esc(universe['name'])}</h2>
              </div>
              <p class="meta">Price: last trading day return | Volume: latest day / 21d avg</p>
              <div class="grid">{cards}</div>
              <h3 class="news-heading">News (top leaders)</h3>
              <div class="news-grid">{''.join(news_html)}</div>
            </section>
            """
        )

    link_html = (
        f"<p class='meta'>Live brief: <a href='{_esc(public_url)}'>{_esc(public_url)}</a></p>"
        if public_url
        else ""
    )

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>{_esc(title)}</title>
  <style>{PDF_CSS}</style>
</head>
<body>
  <div class="wrap">
    <header class="site-header">
      <div class="brand"><span class="brand-dot"></span> SavvyETF</div>
      <span class="doc-tag">Market Brief PDF</span>
    </header>

    <section class="hero">
      <h1>{_esc(title)}</h1>
      <p class="meta">Top {DEFAULT_TOP_N} per board · {summary['ticker_count']} tickers with news</p>
      {link_html}
      <div class="pill-row">
        <span class="pill">ETF + S&amp;P 500</span>
        <span class="pill">Volume surge rankings</span>
        <span class="pill">AI briefing</span>
        <span class="pill">Heatmap</span>
      </div>
    </section>

    {''.join(sections_html)}
    {_render_leader_charts_html(summary)}
    {_render_heatmap_pdf_html(summary)}
    {_render_ai_pdf_html(summary)}

    <footer class="footer">
      <span>SavvyETF · Generated {summary['generated_at_display']}</span>
      <span>Not financial advice</span>
    </footer>
  </div>
</body>
</html>"""


def _pdf_enabled() -> bool:
    return os.environ.get("SUMMARY_PDF_ENABLED", "true").lower() not in {"0", "false", "no"}


def _pdf_timeout_seconds() -> int:
    raw = os.environ.get("SUMMARY_PDF_TIMEOUT", "120").strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return 120


def _run_pdf_worker(html_path: Path, pdf_path: Path) -> None:
    cmd = [sys.executable, str(WORKER_SCRIPT), str(html_path), str(pdf_path)]
    subprocess.run(cmd, check=True, timeout=_pdf_timeout_seconds(), cwd=str(PROJECT_DIR))


def generate_summary_pdf(summary: dict, public_url: str = "") -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    html_content = render_summary_pdf_html(summary, public_url=public_url)

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".html",
        delete=False,
        dir=str(DATA_DIR),
    ) as handle:
        handle.write(html_content)
        html_path = Path(handle.name)

    pdf_path = SUMMARY_PDF_PATH
    try:
        _run_pdf_worker(html_path, pdf_path)
    finally:
        html_path.unlink(missing_ok=True)

    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        raise RuntimeError("PDF worker produced no output")
    return pdf_path


def generate_and_attach_summary_pdf(summary: dict, public_url: str = "") -> Path | None:
    if not _pdf_enabled():
        return None
    try:
        pdf_path = generate_summary_pdf(summary, public_url=public_url)
        size_kb = pdf_path.stat().st_size // 1024
        print(f"Summary PDF generated ({size_kb} KB): {pdf_path}")
        return pdf_path
    except Exception as exc:
        print(f"Summary PDF generation failed: {exc}")
        return None

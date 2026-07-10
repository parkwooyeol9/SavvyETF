import base64
import html
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo

from news_crawler import _display_ticker_label, fetch_crypto_news, fetch_news_for_tickers
from heatmap import plot_market_heatmap
from ai_briefing import _strip_disclaimer, generate_ai_briefing
from summary_analyst import collect_leader_charts, generate_chart_notes
from stock_crawler import (
    DEFAULT_TOP_N,
    UNIVERSES,
    _ranking_slice,
    get_ranking_tickers,
    get_top_leader_ticker,
    is_cache_ready,
)

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
SUMMARY_HTML_PATH = DATA_DIR / "summary.html"
SUMMARY_META_PATH = DATA_DIR / "summary_meta.json"
SUMMARY_PDF_PATH = DATA_DIR / "summary.pdf"
PDF_WORKER_SCRIPT = PROJECT_DIR / "summary_pdf_worker.py"

KST = ZoneInfo("Asia/Seoul")
SUMMARY_UNIVERSES = ("etf", "sp")
SUMMARY_NEWS_PER_TICKER = 2
TELEGRAM_CHUNK_SIZE = 3800

UNIVERSE_STYLE = {
    "etf": {"emoji": "📦", "label": "ETF", "color": "#4da3ff"},
    "sp": {"emoji": "🇺🇸", "label": "S&P 500", "color": "#3dd68c"},
    "nas": {"emoji": "💻", "label": "NASDAQ 100", "color": "#a78bfa"},
}

BOARD_TITLES = {
    "surge": "Price up + volume surge",
    "dropvol": "Price down + volume surge",
}


def _esc(text: str) -> str:
    return html.escape(str(text), quote=False)


def _summary_boards(universe: str) -> dict[str, dict]:
    boards: dict[str, dict] = {}
    for mode in ("surge", "dropvol"):
        boards[mode] = _ranking_slice(universe, mode, DEFAULT_TOP_N, 0)
    return boards


def caches_ready() -> bool:
    return all(is_cache_ready(universe) for universe in SUMMARY_UNIVERSES)


def build_market_summary(news_limit: int = SUMMARY_NEWS_PER_TICKER) -> dict:
    if not caches_ready():
        raise RuntimeError("Ranking caches are not ready yet.")

    generated_at = datetime.now(KST)
    universes: list[dict] = []
    all_tickers: list[str] = []
    ticker_universe: dict[str, str] = {}

    for universe in SUMMARY_UNIVERSES:
        boards = _summary_boards(universe)
        tickers, _ = get_ranking_tickers(universe=universe, mode="all")
        leader_ticker = get_top_leader_ticker(universe, "surge")
        for ticker in tickers:
            if ticker not in all_tickers:
                all_tickers.append(ticker)
            ticker_universe[ticker] = universe
        universes.append(
            {
                "key": universe,
                "name": UNIVERSES[universe]["label"],
                "boards": boards,
                "tickers": tickers,
                "leader_ticker": leader_ticker,
            }
        )

    news_by_ticker: dict[str, list[dict[str, str]]] = {}
    for universe in SUMMARY_UNIVERSES:
        universe_tickers = [ticker for ticker in all_tickers if ticker_universe.get(ticker) == universe]
        if universe_tickers:
            news_by_ticker.update(
                fetch_news_for_tickers(universe_tickers, limit=news_limit, universe=universe)
            )

    return {
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "universes": universes,
        "news_by_ticker": news_by_ticker,
        "ticker_universe": ticker_universe,
        "ticker_count": len(all_tickers),
    }


def _render_board_html(board: dict, mode: str, *, universe_key: str) -> str:
    top_rows = "".join(
        (
            f"<tr><td>{html.escape(_display_ticker_label(t, universe_key if universe_key == 'etf' else None))}</td>"
            f"<td class='pos'>{html.escape(v)}</td></tr>"
        )
        for t, v in board["top"]
    )
    return f"""
    <div class="card">
      <h3>{html.escape(BOARD_TITLES[mode])}</h3>
      <table>
        <caption>Top {DEFAULT_TOP_N}</caption>
        <thead><tr><th>Ticker</th><th>Daily | Vol</th></tr></thead>
        <tbody>{top_rows}</tbody>
      </table>
    </div>
    """


def _render_heatmap_html(summary: dict) -> str:
    pack = summary.get("heatmap_sp") or {}
    if pack.get("error"):
        return f"""
    <section class="heatmap-section">
      <h2>🗺️ S&amp;P 500 Heatmap</h2>
      <p class="meta">Heatmap unavailable: {_esc(pack['error'])}</p>
    </section>
    """
    chart = pack.get("chart")
    if chart is None:
        return ""
    chart.seek(0)
    import base64

    encoded = base64.b64encode(chart.read()).decode("ascii")
    chart.seek(0)
    caption = _esc(pack.get("caption", "S&P 500 heatmap"))
    return f"""
    <section class="heatmap-section">
      <h2>🗺️ S&amp;P 500 Heatmap</h2>
      <p class="meta">{caption}</p>
      <img src="data:image/png;base64,{encoded}" alt="S&amp;P 500 heatmap" style="width:100%;max-width:100%;border-radius:12px;border:1px solid var(--border);" />
    </section>
    """


def _format_heatmap_telegram(summary: dict) -> list[dict]:
    pack = summary.get("heatmap_sp") or {}
    if pack.get("error"):
        return [{"text": f"🗺️ S&P 500 heatmap\n\n(unavailable: {pack['error']})"}]
    chart = pack.get("chart")
    if chart is None:
        return []
    chart.seek(0)
    return [{"text": pack.get("caption", "S&P 500 heatmap"), "photo": chart}]


def _render_ai_html(summary: dict) -> str:
    ai_analysis = summary.get("ai_analysis") or {}
    brief_ko = _strip_disclaimer(ai_analysis.get("market_brief_ko", "").strip())
    if not brief_ko:
        return ""
    ai_lines = "".join(f"<p>{_esc(line)}</p>" for line in brief_ko.split("\n") if line.strip())
    source = ai_analysis.get("source", "")
    article_count = ai_analysis.get("article_count", 0)
    articles_html = ""
    for item in (ai_analysis.get("articles") or [])[:8]:
        articles_html += (
            f"<li><strong>{_esc(item.get('title', ''))}</strong>"
            f"<span class='meta'>{_esc(item.get('source', ''))}</span></li>"
        )
    articles_block = f"<ul>{articles_html}</ul>" if articles_html else ""
    return f"""
    <section class="ai-brief">
      <h2>🤖 AI 시장 브리핑</h2>
      <p class="meta">트렌딩 뉴스 {article_count}건 분석 ({_esc(source)})</p>
      {ai_lines}
      {articles_block}
    </section>
    """


def _format_ai_telegram(summary: dict) -> list[dict]:
    ai_analysis = summary.get("ai_analysis") or {}
    brief_ko = _strip_disclaimer(ai_analysis.get("market_brief_ko", "").strip())
    if not brief_ko:
        return []
    source = ai_analysis.get("source", "ai")
    article_count = ai_analysis.get("article_count", 0)
    ai_header = "🤖 AI 시장 브리핑 (한국어)\n"
    if ai_analysis.get("error") and source == "rules":
        ai_header += "(Gemini unavailable — headline-based fallback)\n"
    ai_header += f"출처: {source} | 분석 기사 {article_count}건\n\n"
    return [{"text": ai_header + brief_ko}]


def render_summary_html(summary: dict, public_url: str = "") -> str:
    title = f"SavvyETF Market Brief — {summary['generated_at_display']}"

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
                    f"<li><strong>{html.escape(item['title'])}</strong>"
                    f"<span class='meta'>{html.escape(item['source'])} | {html.escape(item['date'])}</span></li>"
                )
                for item in headlines
            )
            if not items:
                items = "<li class='meta'>No recent headlines</li>"
            label = _display_ticker_label(
                ticker,
                summary.get("ticker_universe", {}).get(ticker),
            )
            news_html.append(f"<div class='news-block'><h4>{html.escape(label)}</h4><ul>{items}</ul></div>")

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
        f"<p class='meta'>Live URL: <a href='{html.escape(public_url)}'>{html.escape(public_url)}</a></p>"
        if public_url
        else ""
    )

    heatmap_html = _render_heatmap_html(summary)
    ai_html = _render_ai_html(summary)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)}</title>
  <style>
    :root {{
      --bg: #0f1419;
      --panel: #1a2332;
      --text: #e7ecf3;
      --muted: #9aa7b8;
      --accent: #4da3ff;
      --pos: #3dd68c;
      --neg: #ff6b6b;
      --border: #2b3648;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }}
    .wrap {{ max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }}
    h1 {{ font-size: 1.6rem; margin-bottom: 0.25rem; }}
    h2 {{ margin: 0; font-size: 1.35rem; }}
    h3 {{ margin: 0 0 0.75rem; font-size: 1rem; color: var(--accent); }}
    h3.news-heading {{
      margin-top: 2rem;
      padding-top: 1.25rem;
      border-top: 1px dashed var(--border);
    }}
    h4 {{ margin: 0 0 0.5rem; font-size: 0.95rem; }}
    .meta {{ color: var(--muted); font-size: 0.9rem; }}
    .section-divider {{
      border: none;
      height: 2px;
      margin: 3.5rem 0;
      background: linear-gradient(90deg, transparent, var(--border) 15%, var(--border) 85%, transparent);
    }}
    .universe-section {{
      margin-bottom: 1rem;
      padding: 1.75rem 1.25rem 2.5rem;
      border: 1px solid var(--border);
      border-radius: 16px;
      border-top: 4px solid var(--section-color);
      background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent 120px);
    }}
    .section-header {{
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }}
    .section-emoji {{ font-size: 1.6rem; line-height: 1; }}
    .grid {{ display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }}
    .split {{ display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.92rem; }}
    caption {{ text-align: left; font-weight: 600; margin-bottom: 6px; color: var(--muted); }}
    th, td {{ padding: 6px 4px; border-bottom: 1px solid var(--border); text-align: left; }}
    .pos {{ color: var(--pos); font-variant-numeric: tabular-nums; }}
    .neg {{ color: var(--neg); font-variant-numeric: tabular-nums; }}
    .news-grid {{
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }}
    .news-block {{
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
    }}
    ul {{ margin: 0; padding-left: 18px; }}
    li {{ margin-bottom: 8px; }}
    li .meta {{ display: block; margin-top: 2px; }}
    a {{ color: var(--accent); }}
    .ai-brief {{
      margin: 1.5rem 0 2.5rem;
      padding: 1.25rem 1.25rem 1rem;
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 12px;
      background: var(--panel);
    }}
    .ai-brief p {{ margin: 0.55rem 0; line-height: 1.65; }}
    .heatmap-section {{
      margin: 2.5rem 0;
      padding: 1.25rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--panel);
    }}
    @media (max-width: 720px) {{
      .split {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>{html.escape(title)}</h1>
    <p class="meta">Tickers with news: {summary['ticker_count']} (top {DEFAULT_TOP_N} per board)</p>
    {link_html}
    {''.join(sections_html)}
    {heatmap_html}
    {ai_html}
  </div>
</body>
</html>"""


def _format_ranking_block_telegram(title: str, top: list, *, universe_key: str) -> list[str]:
    lines = [f"<b>{_esc(title)}</b>", ""]
    lines.append(f"<b>▲ Top {DEFAULT_TOP_N}</b>")
    for ticker, value in top:
        label = _esc(_display_ticker_label(ticker, universe_key if universe_key == "etf" else None))
        lines.append(f"  • <code>{label}</code>  {_esc(value)}")
    lines.append("")
    return lines


def _format_universe_telegram(universe: dict, summary: dict) -> list[dict]:
    ukey = universe["key"]
    style = UNIVERSE_STYLE.get(ukey, {"emoji": "📊"})
    header = f"<b>{style['emoji']} {_esc(universe['name'])}</b>\n"

    ranking_lines = [header, "<i>Last trading day return | latest vol / 21d avg</i>", ""]
    for mode in ("surge", "dropvol"):
        board = universe["boards"][mode]
        ranking_lines.extend(
            _format_ranking_block_telegram(BOARD_TITLES[mode], board["top"], universe_key=ukey)
        )
    messages = [{"text": "\n".join(ranking_lines).rstrip(), "parse_mode": "HTML"}]

    leader = universe.get("leader_ticker")
    leaders = summary.get("leader_charts") or {}
    leader_pack = leaders.get(ukey) or {}
    chart_notes = (summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}
    if leader:
        leader_label = leader
        if ukey == "etf":
            leader_label = _display_ticker_label(leader, "etf")
        caption_lines = [f"📈 Top leader: {leader_label} (price up + volume surge)"]
        note = chart_notes.get(ukey, "").strip()
        if note:
            caption_lines.extend(["", note])
        chart_reply: dict = {
            "text": "\n".join(caption_lines),
        }
        chart_png = leader_pack.get("chart_png")
        if chart_png is not None:
            chart_png.seek(0)
            chart_reply["photo"] = chart_png
        else:
            chart_reply["chart_ticker"] = leader
        messages.append(chart_reply)

    news_lines = [header, "<b>📰 News</b>", ""]
    has_news = False
    ticker_blocks: list[list[str]] = []
    for ticker in universe["tickers"]:
        headlines = summary["news_by_ticker"].get(ticker, [])
        if not headlines:
            continue
        has_news = True
        label = _esc(
            _display_ticker_label(
                ticker,
                summary.get("ticker_universe", {}).get(ticker),
            )
        )
        block = [f"<b>{label}</b>"]
        for item in headlines:
            block.append(f"• {_esc(item['title'])}")
            block.append(f"  <i>{_esc(item['source'])} | {_esc(item['date'])}</i>")
        block.append("")
        ticker_blocks.append(block)

    if not has_news:
        messages.append({"text": f"{header}\n<b>📰 News</b>\n\n<i>No recent headlines</i>", "parse_mode": "HTML"})
        return messages

    current = news_lines[:]
    current_len = len("\n".join(current))
    for block in ticker_blocks:
        block_text = "\n".join(block)
        extra = len(block_text) + 1
        if current_len + extra > TELEGRAM_CHUNK_SIZE and len(current) > len(news_lines):
            messages.append({"text": "\n".join(current).rstrip(), "parse_mode": "HTML"})
            current = [header, "<b>📰 News (continued)</b>", ""]
            current_len = len("\n".join(current))
        current.extend(block)
        current_len += extra

    if current:
        messages.append({"text": "\n".join(current).rstrip(), "parse_mode": "HTML"})
    return messages


def render_summary_telegram(summary: dict, public_url: str = "") -> list[dict]:
    messages: list[dict] = []

    for universe in summary["universes"]:
        messages.extend(_format_universe_telegram(universe, summary))

    messages.extend(_format_heatmap_telegram(summary))
    messages.extend(_format_ai_telegram(summary))

    return messages


def save_summary(summary: dict, html_content: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_HTML_PATH.write_text(html_content, encoding="utf-8")
    meta = {
        "generated_at": summary["generated_at"],
        "generated_at_display": summary["generated_at_display"],
        "ticker_count": summary["ticker_count"],
    }
    SUMMARY_META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def load_summary_html() -> str | None:
    if SUMMARY_HTML_PATH.exists():
        return SUMMARY_HTML_PATH.read_text(encoding="utf-8")
    return None


def _build_macro_appendix() -> dict:
    try:
        from macro_analyst import format_macro_ai_telegram, generate_macro_ai_brief
        from macro_charts import format_macro_chart_caption, format_macro_text, plot_macro_dashboard
        from macro_data import build_macro_bundle
        from macro_scores import compute_macro_stress

        bundle = build_macro_bundle(force=False)
        stress = compute_macro_stress(
            bundle["snapshot"],
            edgar=bundle.get("edgar"),
            finnhub=bundle.get("finnhub"),
        )
        chart = plot_macro_dashboard(bundle, stress)
        chart.seek(0)
        ai_brief = generate_macro_ai_brief(bundle, stress)
        return {
            "chart": chart,
            "caption": format_macro_chart_caption(bundle, stress),
            "text_html": format_macro_text(bundle, stress),
            "ai_brief": format_macro_ai_telegram(ai_brief),
        }
    except Exception as exc:
        return {"error": str(exc)}


def _build_crypto_appendix() -> dict:
    from analysis import analyze_crypto

    appendix: dict[str, dict] = {}
    for symbol, label in (("BTC", "Bitcoin"), ("ETH", "Ethereum")):
        entry: dict = {"symbol": symbol, "label": label}
        try:
            chart = analyze_crypto(symbol)
            chart.seek(0)
            entry["chart"] = chart
        except Exception as exc:
            entry["chart_error"] = str(exc)
        try:
            entry["news"] = fetch_crypto_news(symbol, limit=3)
        except Exception:
            entry["news"] = []
        appendix[symbol] = entry
    return appendix


def generate_and_save_summary(public_url: str = "") -> dict:
    summary = build_market_summary()
    leader_charts = collect_leader_charts(summary)
    summary["leader_charts"] = leader_charts
    ai_brief = generate_ai_briefing()
    ai_brief["chart_notes_ko"] = generate_chart_notes(summary, leader_charts)
    summary["ai_analysis"] = ai_brief
    try:
        heatmap_buf, heatmap_caption, _ = plot_market_heatmap("sp")
        summary["heatmap_sp"] = {"chart": heatmap_buf, "caption": heatmap_caption}
    except Exception as exc:
        summary["heatmap_sp"] = {"error": str(exc)}

    summary["macro"] = _build_macro_appendix()
    summary["crypto"] = _build_crypto_appendix()

    html_content = render_summary_html(summary, public_url=public_url)
    save_summary(summary, html_content)
    summary["html"] = html_content
    summary["telegram_messages"] = render_summary_telegram(summary, public_url=public_url)

    pdf_path = _save_summary_pdf(summary, public_url=public_url)
    if pdf_path is not None:
        summary["pdf_path"] = str(pdf_path)
        summary["telegram_messages"].append(
            {
                "text": f"📄 SavvyETF Market Brief PDF\n{summary['generated_at_display']}",
                "document_path": str(pdf_path),
            }
        )

    return summary


PDF_CSS = """
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Instrument+Serif&display=swap');
:root {
  --bg: #0b1018; --panel: #141d2b; --text: #e8eef5; --muted: #8fa3b8;
  --accent: #4da3ff; --accent-2: #3dd68c; --border: #2b3648;
}
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; background: var(--bg); color: var(--text);
  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 10.5pt; line-height: 1.55;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1;
  background:
    radial-gradient(ellipse 80% 45% at 12% -8%, rgba(77,163,255,0.16), transparent 58%),
    radial-gradient(ellipse 55% 35% at 92% 4%, rgba(61,214,140,0.08), transparent 52%);
}
.wrap { max-width: 780px; margin: 0 auto; }
.site-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 0 0 18px; margin-bottom: 22px; border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 11pt; }
.brand-dot {
  width: 9px; height: 9px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 10px rgba(77,163,255,0.55);
}
.doc-tag {
  font-size: 8pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent-2); padding: 0.28rem 0.65rem; border-radius: 999px;
  border: 1px solid rgba(61,214,140,0.25); background: rgba(61,214,140,0.08);
}
.hero h1 {
  font-family: "Instrument Serif", Georgia, serif; font-size: 24pt; font-weight: 400;
  line-height: 1.12; margin: 0 0 8px;
}
.hero .meta { color: var(--muted); font-size: 9.5pt; margin: 0 0 14px; }
.pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 24px; }
.pill {
  font-size: 8pt; padding: 0.22rem 0.55rem; border-radius: 999px;
  border: 1px solid var(--border); color: var(--muted); background: rgba(255,255,255,0.03);
}
.section { margin: 26px 0; page-break-inside: avoid; }
.section-divider {
  border: none; height: 1px; margin: 28px 0;
  background: linear-gradient(90deg, transparent, var(--border) 15%, var(--border) 85%, transparent);
}
.universe-section {
  padding: 18px 16px 22px; border: 1px solid var(--border); border-radius: 14px;
  border-top: 4px solid var(--section-color);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), transparent 100px);
  page-break-inside: avoid;
}
.section-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
  padding-bottom: 10px; border-bottom: 1px solid var(--border);
}
.section-emoji { font-size: 16pt; }
.section-header h2 {
  margin: 0; font-family: "Instrument Serif", Georgia, serif; font-size: 16pt; font-weight: 400;
}
.meta { color: var(--muted); font-size: 9pt; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
.card h3 { margin: 0 0 8px; font-size: 10pt; color: var(--accent); }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
caption { text-align: left; font-weight: 600; margin-bottom: 4px; color: var(--muted); font-size: 8pt; }
th, td { padding: 5px 3px; border-bottom: 1px solid var(--border); text-align: left; }
.pos { color: var(--accent-2); font-variant-numeric: tabular-nums; }
.news-heading {
  margin: 18px 0 10px; padding-top: 12px; border-top: 1px dashed var(--border);
  font-size: 10pt; color: var(--accent);
}
.news-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.news-block {
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px; page-break-inside: avoid;
}
.news-block h4 { margin: 0 0 6px; font-size: 9pt; }
ul { margin: 0; padding-left: 16px; }
li { margin-bottom: 6px; font-size: 8.8pt; }
li .meta { display: block; margin-top: 2px; font-size: 8pt; }
.leader-grid, .crypto-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 18px 0 8px; }
.leader-card, .crypto-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  padding: 10px; page-break-inside: avoid;
}
.leader-card h3, .crypto-card h3 { margin: 0 0 6px; font-size: 10pt; }
.leader-card img, .crypto-card img, .appendix-section img {
  width: 100%; border-radius: 8px; border: 1px solid var(--border);
}
.heatmap-section, .ai-brief, .appendix-section {
  margin: 22px 0; padding: 14px; border: 1px solid var(--border); border-radius: 12px;
  background: var(--panel); page-break-inside: avoid;
}
.heatmap-section h2, .ai-brief h2, .appendix-section h2 {
  margin: 0 0 8px; font-family: "Instrument Serif", Georgia, serif; font-size: 14pt; font-weight: 400;
}
.ai-brief p, .macro-line { margin: 0.35rem 0; line-height: 1.55; font-size: 9pt; }
.metric { color: var(--accent-2); font-family: ui-monospace, monospace; }
.footer {
  margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--border);
  color: var(--muted); font-size: 8pt; display: flex; justify-content: space-between;
}
a { color: var(--accent); text-decoration: none; }
"""


def _buffer_to_data_uri(buffer: BytesIO | None, mime: str) -> str:
    if buffer is None:
        return ""
    buffer.seek(0)
    encoded = base64.b64encode(buffer.read()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _telegram_html_to_pdf_blocks(text: str) -> str:
    blocks: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        cleaned = re.sub(r"<br\s*/?>", "", stripped, flags=re.I)
        cleaned = re.sub(r"</?i>", "", cleaned)
        cleaned = re.sub(r"<b>(.*?)</b>", r"<strong>\1</strong>", cleaned, flags=re.I)
        cleaned = re.sub(r"<code>(.*?)</code>", r"<span class='metric'>\1</span>", cleaned, flags=re.I)
        blocks.append(f"<p class='macro-line'>{cleaned}</p>")
    return "".join(blocks)


def _render_leader_charts_pdf_html(summary: dict) -> str:
    leaders = summary.get("leader_charts") or {}
    chart_notes = (summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}
    if not leaders:
        return ""

    cards: list[str] = []
    for ukey, pack in leaders.items():
        style = UNIVERSE_STYLE.get(ukey, {"emoji": "📊", "label": ukey})
        ticker = pack.get("ticker", "")
        label = _display_ticker_label(ticker, "etf") if ukey == "etf" and ticker else ticker
        title = f"{style['emoji']} {style.get('label', ukey)} leader — {label}"
        chart = pack.get("chart_png")
        if chart is None:
            cards.append(
                f"<article class='leader-card'><h3>{_esc(title)}</h3>"
                f"<p class='meta'>{_esc(pack.get('error', 'chart unavailable'))}</p></article>"
            )
            continue
        note = chart_notes.get(ukey, "").strip()
        note_html = f"<p class='meta'>{_esc(note)}</p>" if note else ""
        cards.append(
            f"<article class='leader-card'><h3>{_esc(title)}</h3>{note_html}"
            f"<img src='{_buffer_to_data_uri(chart, 'image/png')}' alt='{_esc(ticker)} chart' /></article>"
        )

    return (
        "<section class='section'><h2 style=\"font-family:'Instrument Serif',Georgia,serif;"
        "font-size:14pt;font-weight:400;margin:0 0 10px;\">📈 Top leaders</h2>"
        f"<div class='leader-grid'>{''.join(cards)}</div></section>"
    )


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
    return (
        "<section class='heatmap-section'><h2>🗺️ S&amp;P 500 Heatmap</h2>"
        f"<p class='meta'>{_esc(pack.get('caption', 'S&P 500 heatmap'))}</p>"
        f"<img src='{_buffer_to_data_uri(chart, 'image/png')}' alt='S&amp;P 500 heatmap' /></section>"
    )


def _render_ai_pdf_html(summary: dict) -> str:
    ai_analysis = summary.get("ai_analysis") or {}
    brief_ko = _strip_disclaimer(ai_analysis.get("market_brief_ko", "").strip())
    if not brief_ko:
        return ""
    ai_lines = "".join(f"<p>{_esc(line)}</p>" for line in brief_ko.split("\n") if line.strip())
    return (
        "<section class='ai-brief'><h2>🤖 AI 시장 브리핑</h2>"
        f"<p class='meta'>트렌딩 뉴스 {ai_analysis.get('article_count', 0)}건 분석 "
        f"({_esc(ai_analysis.get('source', ''))})</p>{ai_lines}</section>"
    )


def _render_macro_pdf_html(summary: dict) -> str:
    macro = summary.get("macro") or {}
    if macro.get("error"):
        return (
            "<section class='appendix-section'><h2>📊 Macro Risk Monitor</h2>"
            f"<p class='meta'>Unavailable: {_esc(macro['error'])}</p></section>"
        )

    chart_html = ""
    chart = macro.get("chart")
    if chart is not None:
        chart_html = (
            f"<p class='meta'>{_esc(macro.get('caption', ''))}</p>"
            f"<img src='{_buffer_to_data_uri(chart, 'image/png')}' alt='Macro dashboard' />"
        )

    text_html = _telegram_html_to_pdf_blocks(macro.get("text_html", ""))
    ai_html = ""
    ai_brief = (macro.get("ai_brief") or "").strip()
    if ai_brief:
        ai_html = (
            "<h3 style='font-size:11pt;color:var(--accent);margin:14px 0 6px;'>AI macro comment</h3>"
            + "".join(
                f"<p class='macro-line'>{_esc(line)}</p>"
                for line in ai_brief.split("\n")
                if line.strip()
            )
        )

    return (
        "<hr class='section-divider' />"
        "<section class='appendix-section'><h2>📊 Macro Risk Monitor</h2>"
        f"{chart_html}{text_html}{ai_html}</section>"
    )


def _render_crypto_pdf_html(summary: dict) -> str:
    crypto = summary.get("crypto") or {}
    if not crypto:
        return ""

    cards: list[str] = []
    for symbol in ("BTC", "ETH"):
        entry = crypto.get(symbol) or {}
        label = entry.get("label", symbol)
        news_items = "".join(
            (
                f"<li><strong>{_esc(item['title'])}</strong>"
                f"<span class='meta'>{_esc(item['source'])} | {_esc(item['date'])}</span></li>"
            )
            for item in (entry.get("news") or [])
        )
        if not news_items:
            news_items = "<li class='meta'>No recent headlines</li>"

        chart_html = ""
        if entry.get("chart") is not None:
            chart_html = (
                f"<img src='{_buffer_to_data_uri(entry['chart'], 'image/png')}' "
                f"alt='{_esc(symbol)} technical analysis' />"
            )
        elif entry.get("chart_error"):
            chart_html = f"<p class='meta'>Chart unavailable: {_esc(entry['chart_error'])}</p>"

        cards.append(
            f"<article class='crypto-card'><h3>🪙 {label} ({symbol})</h3>"
            f"{chart_html}<h4 style='margin:10px 0 6px;font-size:9pt;'>News</h4>"
            f"<ul>{news_items}</ul></article>"
        )

    return (
        "<section class='appendix-section'><h2>🪙 Crypto — Bitcoin &amp; Ethereum</h2>"
        f"<p class='meta'>Technical analysis (/coin) + top headlines</p>"
        f"<div class='crypto-grid'>{''.join(cards)}</div></section>"
    )


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
        <span class="pill">Macro monitor</span>
        <span class="pill">BTC + ETH</span>
        <span class="pill">AI briefing</span>
      </div>
    </section>
    {''.join(sections_html)}
    {_render_leader_charts_pdf_html(summary)}
    {_render_heatmap_pdf_html(summary)}
    {_render_ai_pdf_html(summary)}
    {_render_macro_pdf_html(summary)}
    {_render_crypto_pdf_html(summary)}
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
    raw = os.environ.get("SUMMARY_PDF_TIMEOUT", "180").strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return 180


def _run_pdf_worker(html_path: Path, pdf_path: Path) -> None:
    cmd = [sys.executable, str(PDF_WORKER_SCRIPT), str(html_path), str(pdf_path)]
    subprocess.run(cmd, check=True, timeout=_pdf_timeout_seconds(), cwd=str(PROJECT_DIR))


def _save_summary_pdf(summary: dict, public_url: str = "") -> Path | None:
    if not _pdf_enabled():
        return None

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

    try:
        _run_pdf_worker(html_path, SUMMARY_PDF_PATH)
    except Exception as exc:
        print(f"Summary PDF generation failed: {exc}")
        return None
    finally:
        html_path.unlink(missing_ok=True)

    if not SUMMARY_PDF_PATH.exists() or SUMMARY_PDF_PATH.stat().st_size == 0:
        print("Summary PDF generation failed: empty output")
        return None

    size_kb = SUMMARY_PDF_PATH.stat().st_size // 1024
    print(f"Summary PDF generated ({size_kb} KB): {SUMMARY_PDF_PATH}")
    return SUMMARY_PDF_PATH

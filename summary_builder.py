import base64
import html
import json
import os
import re
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

KST = ZoneInfo("Asia/Seoul")
SUMMARY_UNIVERSES = ("etf", "sp")
SUMMARY_NEWS_PER_TICKER = 2
TELEGRAM_CHUNK_SIZE = 3800

UNIVERSE_STYLE = {
    "etf": {"emoji": "📦", "label": "ETF", "color": "#4da3ff"},
    "sp": {"emoji": "🇺🇸", "label": "S&P 500", "color": "#3dd68c"},
    "nas": {"emoji": "💻", "label": "NASDAQ 100", "color": "#a78bfa"},
    "kospi": {"emoji": "🇰🇷", "label": "KOSPI 200", "color": "#4da3ff"},
    "kosdaq": {"emoji": "📈", "label": "KOSDAQ 100", "color": "#3dd68c"},
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
    data_uri = _buffer_to_data_uri(chart, "image/png")
    if not data_uri:
        return ""
    caption = _esc(pack.get("caption", "S&P 500 heatmap"))
    return f"""
    <section class="heatmap-section">
      <h2>🗺️ S&amp;P 500 Heatmap</h2>
      <p class="meta">{caption}</p>
      <img src="{data_uri}" alt="S&amp;P 500 heatmap" style="width:100%;max-width:100%;border-radius:12px;border:1px solid var(--border);" />
    </section>
    """


def _format_heatmap_telegram(summary: dict) -> list[dict]:
    pack = summary.get("heatmap_sp") or {}
    if pack.get("error"):
        return [{"text": f"🗺️ S&P 500 heatmap\n\n(unavailable: {pack['error']})"}]
    photo = _as_photo_buffer(pack.get("chart"))
    if photo is None:
        return []
    return [{"text": pack.get("caption", "S&P 500 heatmap"), "photo": photo}]


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


def _chart_png_bytes(chart) -> bytes | None:
    """Return raw PNG bytes from bytes or a buffer (never requires a live handle)."""
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
            return bytes(data) if data else None
        except Exception:
            pass
    try:
        if hasattr(chart, "seek"):
            chart.seek(0)
        data = chart.read()
        if hasattr(chart, "seek"):
            try:
                chart.seek(0)
            except Exception:
                pass
        return bytes(data) if data else None
    except Exception:
        return None


def _as_photo_buffer(chart) -> BytesIO | None:
    """Telegram sendPhoto needs a file-like object."""
    data = _chart_png_bytes(chart)
    if not data:
        return None
    buf = BytesIO(data)
    buf.seek(0)
    return buf


def _buffer_to_data_uri(buffer, mime: str) -> str:
    data = _chart_png_bytes(buffer)
    if not data:
        return ""
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _telegram_html_to_web_blocks(text: str) -> str:
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


def _render_leader_charts_html(summary: dict) -> str:
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
        "<section class='appendix-section'><h2>📈 Top leaders</h2>"
        f"<div class='leader-grid'>{''.join(cards)}</div></section>"
    )


def _render_macro_html(summary: dict) -> str:
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

    text_html = _telegram_html_to_web_blocks(macro.get("text_html", ""))
    ai_html = ""
    ai_brief = (macro.get("ai_brief") or "").strip()
    if ai_brief:
        ai_html = (
            "<h3 class='subheading'>AI macro comment</h3>"
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


def _render_crypto_html(summary: dict) -> str:
    crypto = summary.get("crypto") or {}
    if not crypto:
        return ""

    cards: list[str] = []
    for symbol in ("BTC", "ETH"):
        entry = crypto.get(symbol) or {}
        label = entry.get("label", symbol)
        news_items = "".join(
            (
                f"<li><strong>{_esc(item.get('title', ''))}</strong>"
                f"<span class='meta'>{_esc(item.get('source', ''))} | "
                f"{_esc(item.get('date', 'N/A'))}</span></li>"
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
            f"{chart_html}<h4 class='subheading'>News</h4>"
            f"<ul>{news_items}</ul></article>"
        )

    return (
        "<section class='appendix-section'><h2>🪙 Crypto — Bitcoin &amp; Ethereum</h2>"
        f"<p class='meta'>Technical analysis (/coin) + top headlines</p>"
        f"<div class='crypto-grid'>{''.join(cards)}</div></section>"
    )


def _summary_web_base_url(public_url: str) -> str:
    if not public_url:
        return ""
    return public_url.rstrip("/").removesuffix("/summary")


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
                    f"<li><strong>{html.escape(item.get('title', ''))}</strong>"
                    f"<span class='meta'>{html.escape(item.get('source', ''))} | "
                    f"{html.escape(item.get('date', 'N/A'))}</span></li>"
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
        "<p class='meta'><a href='/summary.pdf'>Download PDF</a>"
        " · browser-free export (no Selenium)</p>"
    )
    base_url = _summary_web_base_url(public_url)
    if public_url:
        pdf_url = (
            f"{public_url}.pdf"
            if public_url.rstrip("/").endswith("/summary")
            else f"{public_url.rstrip('/')}/summary.pdf"
        )
        link_html = (
            f"<p class='meta'>Live brief: <a href='{html.escape(public_url)}'>{html.escape(public_url)}</a>"
            f" · <a href='{html.escape(pdf_url)}'>Download PDF</a></p>"
        )

    css_link = (
        f'<link rel="stylesheet" href="{html.escape(base_url)}/css/styles.css" />'
        if base_url
        else ""
    )
    fonts_link = (
        '<link rel="preconnect" href="https://fonts.googleapis.com" />'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'
        '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700'
        '&family=Instrument+Serif&display=swap" rel="stylesheet" />'
    )

    heatmap_html = _render_heatmap_html(summary)
    ai_html = _render_ai_html(summary)
    leader_html = _render_leader_charts_html(summary)
    macro_html = _render_macro_html(summary)
    crypto_html = _render_crypto_html(summary)

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)}</title>
  {fonts_link}
  {css_link}
  <style>
    body {{ margin: 0; }}
    .summary-wrap {{ max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }}
    .summary-hero {{
      margin-bottom: 2rem; padding: 1.5rem; border: 1px solid var(--border, #2b3648);
      border-radius: var(--radius, 14px); background: var(--panel, #141d2b);
    }}
    .summary-hero h1 {{ font-family: var(--serif, Georgia, serif); font-size: 1.75rem; margin: 0 0 0.5rem; }}
    .brand {{ display: flex; align-items: center; gap: 10px; font-weight: 700; margin-bottom: 1rem; }}
    .brand-dot {{ width: 9px; height: 9px; border-radius: 50%; background: var(--accent, #4da3ff); }}
    .pill-row {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 1rem; }}
    .pill {{
      font-size: 0.8rem; padding: 4px 10px; border-radius: 999px;
      border: 1px solid var(--border, #2b3648); color: var(--muted, #8fa3b8);
    }}
    h2 {{ margin: 0; font-size: 1.35rem; }}
    h3 {{ margin: 0 0 0.75rem; font-size: 1rem; color: var(--accent, #4da3ff); }}
    h3.news-heading {{
      margin-top: 2rem; padding-top: 1.25rem; border-top: 1px dashed var(--border, #2b3648);
    }}
    h4 {{ margin: 0 0 0.5rem; font-size: 0.95rem; }}
    .meta {{ color: var(--muted, #8fa3b8); font-size: 0.9rem; }}
    .subheading {{ font-size: 0.95rem; color: var(--accent, #4da3ff); margin: 14px 0 6px; }}
    .section-divider {{
      border: none; height: 2px; margin: 3.5rem 0;
      background: linear-gradient(90deg, transparent, var(--border, #2b3648) 15%, var(--border, #2b3648) 85%, transparent);
    }}
    .universe-section {{
      margin-bottom: 1rem; padding: 1.75rem 1.25rem 2.5rem;
      border: 1px solid var(--border, #2b3648); border-radius: 16px;
      border-top: 4px solid var(--section-color); background: var(--panel, #141d2b);
    }}
    .section-header {{ display: flex; align-items: center; gap: 12px; margin-bottom: 1.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border, #2b3648); }}
    .section-emoji {{ font-size: 1.6rem; line-height: 1; }}
    .grid {{ display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
    .split {{ display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.92rem; }}
    caption {{ text-align: left; font-weight: 600; margin-bottom: 6px; color: var(--muted, #8fa3b8); }}
    th, td {{ padding: 6px 4px; border-bottom: 1px solid var(--border, #2b3648); text-align: left; }}
    .pos {{ color: var(--accent-2, #3dd68c); font-variant-numeric: tabular-nums; }}
    .neg {{ color: #ff6b6b; font-variant-numeric: tabular-nums; }}
    .news-grid {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }}
    .news-block {{ background: rgba(255,255,255,0.02); border: 1px solid var(--border, #2b3648); border-radius: 10px; padding: 12px; }}
    ul {{ margin: 0; padding-left: 18px; }}
    li {{ margin-bottom: 8px; }}
    li .meta {{ display: block; margin-top: 2px; }}
    .ai-brief, .heatmap-section, .appendix-section {{
      margin: 2rem 0; padding: 1.25rem; border: 1px solid var(--border, #2b3648);
      border-radius: 12px; background: var(--panel, #141d2b);
    }}
    .ai-brief {{ border-left: 4px solid var(--accent, #4da3ff); }}
    .ai-brief p, .macro-line {{ margin: 0.55rem 0; line-height: 1.65; }}
    .leader-grid, .crypto-grid {{ display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
    .leader-card, .crypto-card img, .appendix-section img {{
      width: 100%; border-radius: 8px; border: 1px solid var(--border, #2b3648);
    }}
    .summary-footer {{
      margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border, #2b3648);
      color: var(--muted, #8fa3b8); font-size: 0.85rem;
    }}
    @media (max-width: 720px) {{ .split {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <div class="summary-wrap">
    <div class="brand"><span class="brand-dot"></span> SavvyETF</div>
    <section class="summary-hero">
      <h1>{html.escape(title)}</h1>
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
    {leader_html}
    {heatmap_html}
    {ai_html}
    {macro_html}
    {crypto_html}
    <footer class="summary-footer">
      SavvyETF · Generated {summary['generated_at_display']} · Not financial advice
    </footer>
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
        photo = _as_photo_buffer(leader_pack.get("chart_png"))
        if photo is not None:
            chart_reply["photo"] = photo
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


def resolve_summary_public_url() -> str:
    explicit = os.environ.get("SUMMARY_PUBLIC_URL", "").strip().rstrip("/")
    if explicit:
        return explicit if explicit.endswith("/summary") else f"{explicit}/summary"

    for env_key in ("RENDER_EXTERNAL_URL", "RENDER_SERVICE_URL"):
        render_base = os.environ.get(env_key, "").strip().rstrip("/")
        if render_base:
            return f"{render_base}/summary"

    port = os.environ.get("PORT", "8080")
    return f"http://localhost:{port}/summary"


def _format_macro_crypto_telegram(summary: dict) -> list[dict]:
    messages: list[dict] = []

    macro = summary.get("macro") or {}
    if macro.get("error"):
        messages.append({"text": f"📊 Macro dashboard\n\n(unavailable: {macro['error']})"})
    elif macro.get("chart") is not None:
        photo = _as_photo_buffer(macro.get("chart"))
        if photo is not None:
            messages.append(
                {"text": macro.get("caption", "Macro risk dashboard"), "photo": photo}
            )

    crypto = summary.get("crypto") or {}
    for symbol in ("BTC", "ETH"):
        entry = crypto.get(symbol) or {}
        label = entry.get("label", symbol)
        if entry.get("chart") is not None:
            photo = _as_photo_buffer(entry.get("chart"))
            if photo is not None:
                messages.append(
                    {"text": f"🪙 {label} ({symbol}) technical chart", "photo": photo}
                )
        elif entry.get("chart_error"):
            messages.append({"text": f"🪙 {label} ({symbol})\nChart unavailable: {entry['chart_error']}"})

    return messages


def render_summary_telegram(summary: dict, public_url: str = "") -> list[dict]:
    messages: list[dict] = []

    for universe in summary["universes"]:
        messages.extend(_format_universe_telegram(universe, summary))

    messages.extend(_format_heatmap_telegram(summary))
    messages.extend(_format_ai_telegram(summary))
    messages.extend(_format_macro_crypto_telegram(summary))

    return messages


def save_summary(summary: dict, html_content: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_HTML_PATH.write_text(html_content, encoding="utf-8")
    meta = {
        "generated_at": summary["generated_at"],
        "generated_at_display": summary["generated_at_display"],
        "ticker_count": summary["ticker_count"],
        "has_pdf": bool(summary.get("pdf_path")),
    }
    SUMMARY_META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def load_summary_html() -> str | None:
    if SUMMARY_HTML_PATH.exists():
        return SUMMARY_HTML_PATH.read_text(encoding="utf-8")
    return None


def resolve_summary_pdf_public_url(public_url: str = "") -> str:
    web = public_url.strip() if public_url else resolve_summary_public_url()
    if web.endswith("/summary"):
        return f"{web}.pdf"
    return f"{web.rstrip('/')}/summary.pdf"


def resolve_summary_pre_pdf_public_url(public_url: str = "") -> str:
    web = public_url.strip() if public_url else resolve_summary_public_url()
    if web.endswith("/summary"):
        return f"{web.rsplit('/summary', 1)[0]}/summary_pre.pdf"
    return f"{web.rstrip('/')}/summary_pre.pdf"


def resolve_summary_kor_pdf_public_url(public_url: str = "") -> str:
    web = public_url.strip() if public_url else resolve_summary_public_url()
    if web.endswith("/summary"):
        return f"{web.rsplit('/summary', 1)[0]}/summary_kor.pdf"
    if web.endswith("/summary_kor"):
        return f"{web}.pdf"
    if web.endswith("/summary_kor_intra"):
        return f"{web.rsplit('/summary_kor_intra', 1)[0]}/summary_kor.pdf"
    return f"{web.rstrip('/')}/summary_kor.pdf"


def resolve_summary_kor_intra_pdf_public_url(public_url: str = "") -> str:
    web = public_url.strip() if public_url else resolve_summary_public_url()
    if web.endswith("/summary"):
        return f"{web.rsplit('/summary', 1)[0]}/summary_kor_intra.pdf"
    if web.endswith("/summary_kor_intra"):
        return f"{web}.pdf"
    if web.endswith("/summary_kor"):
        return f"{web.rsplit('/summary_kor', 1)[0]}/summary_kor_intra.pdf"
    return f"{web.rstrip('/')}/summary_kor_intra.pdf"


def resolve_reddit_pdf_public_url(public_url: str = "") -> str:
    web = public_url.strip() if public_url else resolve_summary_public_url()
    if web.endswith("/summary"):
        return f"{web.rsplit('/summary', 1)[0]}/reddit.pdf"
    if web.endswith("/reddit"):
        return f"{web}.pdf"
    if web.endswith("/reddit.pdf"):
        return web
    return f"{web.rstrip('/')}/reddit.pdf"


def format_summary_pdf_message(summary: dict, public_url: str = "") -> dict | None:
    pdf_path = summary.get("pdf_path")
    if not pdf_path:
        return None
    path = Path(pdf_path)
    if not path.exists():
        return None
    kind = summary.get("kind")
    if kind == "summary_pre":
        url = resolve_summary_pre_pdf_public_url(public_url)
        title = "Premarket brief PDF"
    elif kind == "summary_kor_intra":
        url = resolve_summary_kor_intra_pdf_public_url(public_url)
        title = "Korea intraday brief PDF"
    elif kind == "summary_kor":
        url = resolve_summary_kor_pdf_public_url(public_url)
        title = "Korea brief PDF"
    elif kind == "reddit":
        url = resolve_reddit_pdf_public_url(public_url)
        title = "Reddit / WSB brief PDF"
    else:
        url = resolve_summary_pdf_public_url(public_url)
        title = "Market brief PDF"
    return {
        "text": (
            f"📄 {title}\n"
            f"{summary.get('generated_at_display', '')}\n\n"
            "Same dense layout as the Telegram brief.\n"
            f"🔗 {url}"
        ),
        "document_path": str(path),
        "button_text": "PDF 다운로드",
        "button_url": url,
    }


def _build_macro_appendix(*, force: bool = False) -> dict:
    try:
        from macro_analyst import format_macro_ai_telegram, generate_macro_ai_brief
        from macro_charts import format_macro_chart_caption, format_macro_text, plot_macro_dashboard
        from macro_data import build_macro_bundle
        from macro_scores import compute_macro_stress

        bundle = build_macro_bundle(force=force)
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


def _freeze_chart_buffer(chart) -> bytes | None:
    """Copy chart payload to immutable bytes so later readers never hit a closed buffer."""
    return _chart_png_bytes(chart)


def _freeze_summary_charts(summary: dict) -> None:
    heatmap = summary.get("heatmap_sp") or {}
    if heatmap.get("chart") is not None:
        heatmap["chart"] = _freeze_chart_buffer(heatmap.get("chart"))

    for pack in (summary.get("leader_charts") or {}).values():
        if not isinstance(pack, dict):
            continue
        for key in ("chart_png", "chart"):
            if pack.get(key) is not None:
                pack[key] = _freeze_chart_buffer(pack.get(key))

    macro = summary.get("macro") or {}
    if macro.get("chart") is not None:
        macro["chart"] = _freeze_chart_buffer(macro.get("chart"))

    for entry in (summary.get("crypto") or {}).values():
        if isinstance(entry, dict) and entry.get("chart") is not None:
            entry["chart"] = _freeze_chart_buffer(entry.get("chart"))


def _minimal_summary_html(summary: dict, public_url: str = "", *, error: str = "") -> str:
    """Fallback page so /summary is never blank after a partial generate."""
    when = html.escape(str(summary.get("generated_at_display", "")))
    err = html.escape(error) if error else ""
    pdf_link = ""
    if summary.get("pdf_path"):
        pdf_url = resolve_summary_pdf_public_url(public_url)
        pdf_link = f'<p><a href="{html.escape(pdf_url)}">Download PDF</a></p>'
    detail = f"<p class='meta'>HTML render note: {err}</p>" if err else ""
    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>SavvyETF Market Brief</title>
<style>body{{font-family:system-ui,sans-serif;background:#0b1018;color:#e8eef5;padding:2rem}}
a{{color:#4da3ff}}.meta{{color:#8fa3b8}}</style></head>
<body>
  <h1>SavvyETF Market Brief</h1>
  <p class="meta">{when}</p>
  <p>Full web layout was unavailable, but the brief was generated.</p>
  {pdf_link}
  {detail}
  <p class="meta">Re-run /summary if this page looks incomplete.</p>
</body></html>"""


def generate_and_save_summary(public_url: str = "", *, force_macro: bool = False) -> dict:
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

    summary["macro"] = _build_macro_appendix(force=force_macro)
    summary["crypto"] = _build_crypto_appendix()
    # Freeze to raw bytes BEFORE any consumer (PDF/HTML/Telegram) touches charts.
    _freeze_summary_charts(summary)

    # Save HTML first so /summary is never left blank when PDF succeeds but HTML fails.
    try:
        html_content = render_summary_html(summary, public_url=public_url)
        save_summary(summary, html_content)
        summary["html"] = html_content
    except Exception as exc:
        summary["html_error"] = str(exc)
        print(f"Summary HTML export failed: {exc}")
        try:
            stub = _minimal_summary_html(summary, public_url, error=str(exc))
            save_summary(summary, stub)
            summary["html"] = stub
        except Exception as stub_exc:
            print(f"Summary HTML stub failed: {stub_exc}")

    try:
        from summary_pdf import SUMMARY_PDF_PATH, build_summary_pdf_safe

        pdf_path = build_summary_pdf_safe(summary, output_path=SUMMARY_PDF_PATH)
        summary["pdf_path"] = str(pdf_path)
        # Refresh meta now that PDF exists.
        if summary.get("html"):
            try:
                save_summary(summary, summary["html"])
            except Exception as meta_exc:
                print(f"Summary meta refresh failed: {meta_exc}")
    except Exception as exc:
        summary["pdf_path"] = None
        summary["pdf_error"] = str(exc)
        print(f"Summary PDF export skipped: {exc}")

    summary["telegram_messages"] = render_summary_telegram(summary, public_url=public_url)
    web_url = public_url.strip() if public_url else resolve_summary_public_url()
    summary["telegram_messages"].append(format_summary_web_link_message(summary, web_url))
    pdf_message = format_summary_pdf_message(summary, web_url)
    if pdf_message:
        summary["telegram_messages"].append(pdf_message)
    elif summary.get("pdf_error"):
        summary["telegram_messages"].append(
            {"text": f"PDF export unavailable: {summary['pdf_error']}"}
        )
    if summary.get("html_error"):
        summary["telegram_messages"].append(
            {"text": f"Web page note: HTML fell back to a simple page ({summary['html_error']})"}
        )

    try:
        from web_publish import publish_brief

        publish_brief(
            "us",
            "summary",
            title="미국 시황 /summary",
            generated_at=summary.get("generated_at_display")
            or summary.get("generated_at"),
            html=summary.get("html"),
            meta={"has_pdf": bool(summary.get("pdf_path"))},
        )
    except Exception as pub_exc:
        print(f"web_publish summary skipped: {pub_exc}")

    return summary


def format_summary_web_link_message(summary: dict, public_url: str = "") -> dict:
    url = public_url.strip() if public_url else resolve_summary_public_url()
    is_local = "localhost" in url or "127.0.0.1" in url

    lines = [
        "🌐 전체 마켓 브리프 (웹 페이지)",
        summary["generated_at_display"],
        "",
        "랭킹·리더 차트·히트맵·매크로·BTC/ETH·AI 브리핑이 한 페이지에 모여 있습니다.",
        f"🔗 {url}",
    ]
    if is_local:
        lines.append("")
        lines.append("로컬 테스트: PC 브라우저에서 위 주소를 여세요.")

    message: dict = {"text": "\n".join(lines)}
    if not is_local:
        message["button_text"] = "웹 브리프 열기"
        message["button_url"] = url
    return message

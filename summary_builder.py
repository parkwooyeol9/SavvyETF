import html
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from news_crawler import fetch_news_for_tickers
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

KST = ZoneInfo("Asia/Seoul")
SUMMARY_UNIVERSES = ("etf", "sp", "nas")
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

    for universe in SUMMARY_UNIVERSES:
        boards = _summary_boards(universe)
        tickers, _ = get_ranking_tickers(universe=universe, mode="all")
        leader_ticker = get_top_leader_ticker(universe, "surge")
        all_tickers.extend(t for t in tickers if t not in all_tickers)
        universes.append(
            {
                "key": universe,
                "name": UNIVERSES[universe]["label"],
                "boards": boards,
                "tickers": tickers,
                "leader_ticker": leader_ticker,
            }
        )

    news_by_ticker = fetch_news_for_tickers(all_tickers, limit=news_limit)
    return {
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "universes": universes,
        "news_by_ticker": news_by_ticker,
        "ticker_count": len(all_tickers),
    }


def _render_board_html(board: dict, mode: str) -> str:
    top_rows = "".join(
        f"<tr><td>{html.escape(t)}</td><td class='pos'>{html.escape(v)}</td></tr>"
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


def render_summary_html(summary: dict, public_url: str = "") -> str:
    title = f"SavvyETF Market Brief — {summary['generated_at_display']}"

    sections_html: list[str] = []
    for index, universe in enumerate(summary["universes"]):
        ukey = universe["key"]
        style = UNIVERSE_STYLE.get(ukey, {"emoji": "📊", "label": universe["name"], "color": "#4da3ff"})
        divider = '<hr class="section-divider" />' if index > 0 else ""
        cards = "".join(
            _render_board_html(universe["boards"][mode], mode)
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
            news_html.append(f"<div class='news-block'><h4>{html.escape(ticker)}</h4><ul>{items}</ul></div>")

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
  </div>
</body>
</html>"""


def _format_ranking_block_telegram(title: str, top: list) -> list[str]:
    lines = [f"<b>{_esc(title)}</b>", ""]
    lines.append(f"<b>▲ Top {DEFAULT_TOP_N}</b>")
    for ticker, value in top:
        lines.append(f"  • <code>{_esc(ticker)}</code>  {_esc(value)}")
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
            _format_ranking_block_telegram(BOARD_TITLES[mode], board["top"])
        )
    messages = [{"text": "\n".join(ranking_lines).rstrip(), "parse_mode": "HTML"}]

    leader = universe.get("leader_ticker")
    if leader:
        messages.append(
            {
                "text": f"📈 Top leader: <b>{_esc(leader)}</b> (price up + volume surge)",
                "parse_mode": "HTML",
                "chart_ticker": leader,
            }
        )

    news_lines = [header, "<b>📰 News</b>", ""]
    has_news = False
    ticker_blocks: list[list[str]] = []
    for ticker in universe["tickers"]:
        headlines = summary["news_by_ticker"].get(ticker, [])
        if not headlines:
            continue
        has_news = True
        block = [f"<b>{_esc(ticker)}</b>"]
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

    header_lines = [
        "<b>📊 SavvyETF Market Brief</b>",
        "",
        f"<i>{_esc(summary['generated_at_display'])}</i>",
        "<i>Price: last trading day | Volume: latest / 21d avg</i>",
    ]
    if public_url:
        header_lines.extend(["", f'🌐 <a href="{_esc(public_url)}">Open full summary page</a>'])
    header_lines.extend([
        "",
        "<i>Next messages: ETF → S&P 500 → NASDAQ 100</i>",
        "<i>(each: rankings, top-leader chart, then news)</i>",
    ])
    messages.append({"text": "\n".join(header_lines), "parse_mode": "HTML"})

    for universe in summary["universes"]:
        messages.extend(_format_universe_telegram(universe, summary))

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


def generate_and_save_summary(public_url: str = "") -> dict:
    summary = build_market_summary()
    html_content = render_summary_html(summary, public_url=public_url)
    save_summary(summary, html_content)
    summary["html"] = html_content
    summary["telegram_messages"] = render_summary_telegram(summary, public_url=public_url)
    return summary

import html
import json
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from news_crawler import fetch_news_for_tickers
from stock_crawler import (
    DEFAULT_BOTTOM_N,
    DEFAULT_TOP_N,
    UNIVERSES,
    VOL_METRIC_LABELS,
    _format_price,
    _format_volume_ratio,
    get_rankings,
    is_cache_ready,
)

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
SUMMARY_HTML_PATH = DATA_DIR / "summary.html"
SUMMARY_META_PATH = DATA_DIR / "summary_meta.json"

KST = ZoneInfo("Asia/Seoul")
SUMMARY_UNIVERSES = ("etf", "sp", "nas")
DEFAULT_SUMMARY_PERIOD = "1mo"
SUMMARY_NEWS_PER_TICKER = 2
TELEGRAM_CHUNK_SIZE = 3800

UNIVERSE_STYLE = {
    "etf": {"emoji": "📦", "label": "ETF", "color": "#4da3ff"},
    "sp": {"emoji": "🇺🇸", "label": "S&P 500", "color": "#3dd68c"},
    "nas": {"emoji": "💻", "label": "NASDAQ 100", "color": "#a78bfa"},
}


def _esc(text: str) -> str:
    return html.escape(str(text), quote=False)


def _ranking_board(
    universe: str,
    period: str,
    sort_by: str,
    top_n: int = DEFAULT_TOP_N,
    bottom_n: int = DEFAULT_BOTTOM_N,
) -> dict:
    df, column, label, scanned, skipped = get_rankings(universe, period, sort_by)
    formatter = _format_price if sort_by == "price" else _format_volume_ratio
    top = [(row["Ticker"], formatter(row[column])) for _, row in df.head(top_n).iterrows()]
    bottom_df = df.sort_values(by=column, ascending=True).head(bottom_n)
    bottom = [(row["Ticker"], formatter(row[column])) for _, row in bottom_df.iterrows()]
    return {
        "label": label,
        "sort_by": sort_by,
        "top": top,
        "bottom": bottom,
        "scanned": scanned,
        "skipped": skipped,
    }


def _ordered_unique_tickers(*groups: list[tuple[str, str]]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for group in groups:
        for ticker, _ in group:
            if ticker not in seen:
                seen.add(ticker)
                ordered.append(ticker)
    return ordered


def _chunk_text(lines: list[str], max_len: int = TELEGRAM_CHUNK_SIZE) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for line in lines:
        extra = len(line) + (1 if current else 0)
        if current and current_len + extra > max_len:
            chunks.append("\n".join(current))
            current = [line]
            current_len = len(line)
        else:
            current.append(line)
            current_len += extra
    if current:
        chunks.append("\n".join(current))
    return chunks


def caches_ready() -> bool:
    return all(is_cache_ready(universe) for universe in SUMMARY_UNIVERSES)


def build_market_summary(
    period: str = DEFAULT_SUMMARY_PERIOD,
    news_limit: int = SUMMARY_NEWS_PER_TICKER,
) -> dict:
    if not caches_ready():
        raise RuntimeError("Ranking caches are not ready yet.")

    generated_at = datetime.now(KST)
    universes: list[dict] = []
    all_tickers: list[str] = []

    for universe in SUMMARY_UNIVERSES:
        price_board = _ranking_board(universe, period, "price")
        vol_board = _ranking_board(universe, period, "vol")
        tickers = _ordered_unique_tickers(
            price_board["top"],
            price_board["bottom"],
            vol_board["top"],
            vol_board["bottom"],
        )
        all_tickers.extend(t for t in tickers if t not in all_tickers)
        universes.append(
            {
                "key": universe,
                "name": UNIVERSES[universe]["label"],
                "price": price_board,
                "vol": vol_board,
                "tickers": tickers,
            }
        )

    news_by_ticker = fetch_news_for_tickers(all_tickers, limit=news_limit)
    return {
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "period": period,
        "universes": universes,
        "news_by_ticker": news_by_ticker,
        "ticker_count": len(all_tickers),
    }


def render_summary_html(summary: dict, public_url: str = "") -> str:
    period = summary["period"]
    title = f"SavvyETF Market Brief — {summary['generated_at_display']}"

    sections_html: list[str] = []
    for index, universe in enumerate(summary["universes"]):
        ukey = universe["key"]
        style = UNIVERSE_STYLE.get(ukey, {"emoji": "📊", "label": universe["name"], "color": "#4da3ff"})
        divider = (
            '<hr class="section-divider" />'
            if index > 0
            else ""
        )
        cards: list[str] = []
        for board_key, board_title in (
            ("price", "Price return"),
            ("vol", f"Volume ({VOL_METRIC_LABELS.get(period, 'ratio')})"),
        ):
            board = universe[board_key]
            top_rows = "".join(
                f"<tr><td>{html.escape(t)}</td><td class='pos'>{html.escape(v)}</td></tr>"
                for t, v in board["top"]
            )
            bottom_rows = "".join(
                f"<tr><td>{html.escape(t)}</td><td class='neg'>{html.escape(v)}</td></tr>"
                for t, v in board["bottom"]
            )
            cards.append(
                f"""
                <div class="card">
                  <h3>{board_title} ({period})</h3>
                  <div class="split">
                    <table>
                      <caption>Top 5</caption>
                      <thead><tr><th>Ticker</th><th>Value</th></tr></thead>
                      <tbody>{top_rows}</tbody>
                    </table>
                    <table>
                      <caption>Bottom 5</caption>
                      <thead><tr><th>Ticker</th><th>Value</th></tr></thead>
                      <tbody>{bottom_rows}</tbody>
                    </table>
                  </div>
                </div>
                """
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
              <div class="grid">{''.join(cards)}</div>
              <h3 class="news-heading">News</h3>
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
    <p class="meta">Period: {html.escape(period)} | Tickers with news: {summary['ticker_count']}</p>
    {link_html}
    {''.join(sections_html)}
  </div>
</body>
</html>"""


def _format_ranking_block_telegram(title: str, top: list, bottom: list) -> list[str]:
    lines = [f"<b>{_esc(title)}</b>", ""]
    lines.append("<b>▲ Top 5</b>")
    for ticker, value in top:
        lines.append(f"  • <code>{_esc(ticker)}</code>  {_esc(value)}")
    lines.extend(["", "<b>▼ Bottom 5</b>"])
    for ticker, value in bottom:
        lines.append(f"  • <code>{_esc(ticker)}</code>  {_esc(value)}")
    lines.append("")
    return lines


def _format_universe_telegram(universe: dict, summary: dict, period: str) -> list[dict]:
    ukey = universe["key"]
    style = UNIVERSE_STYLE.get(ukey, {"emoji": "📊"})
    header = f"<b>{style['emoji']} {_esc(universe['name'])}</b>\n"

    ranking_lines = [header, ""]
    ranking_lines.extend(_format_ranking_block_telegram(f"Price return ({period})", universe["price"]["top"], universe["price"]["bottom"]))
    vol_label = VOL_METRIC_LABELS.get(period, "volume ratio")
    ranking_lines.extend(_format_ranking_block_telegram(f"Volume ({vol_label})", universe["vol"]["top"], universe["vol"]["bottom"]))
    messages = [{"text": "\n".join(ranking_lines).rstrip(), "parse_mode": "HTML"}]

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
    """Telegram messages: header, then per-universe ranking + news (split if long)."""
    period = summary["period"]
    messages: list[dict] = []

    header_lines = [
        "<b>📊 SavvyETF Market Brief</b>",
        "",
        f"<i>{_esc(summary['generated_at_display'])}</i>",
        f"Period: <b>{_esc(period)}</b>",
    ]
    if public_url:
        header_lines.extend(["", f'🌐 <a href="{_esc(public_url)}">Open full summary page</a>'])
    header_lines.extend([
        "",
        "<i>Next messages: ETF → S&P 500 → NASDAQ 100</i>",
        "<i>(each: rankings, then news)</i>",
    ])
    messages.append({"text": "\n".join(header_lines), "parse_mode": "HTML"})

    for universe in summary["universes"]:
        messages.extend(_format_universe_telegram(universe, summary, period))

    return messages


def save_summary(summary: dict, html_content: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_HTML_PATH.write_text(html_content, encoding="utf-8")
    meta = {
        "generated_at": summary["generated_at"],
        "generated_at_display": summary["generated_at_display"],
        "period": summary["period"],
        "ticker_count": summary["ticker_count"],
    }
    SUMMARY_META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def load_summary_html() -> str | None:
    if SUMMARY_HTML_PATH.exists():
        return SUMMARY_HTML_PATH.read_text(encoding="utf-8")
    return None


def generate_and_save_summary(period: str = DEFAULT_SUMMARY_PERIOD, public_url: str = "") -> dict:
    summary = build_market_summary(period=period)
    html_content = render_summary_html(summary, public_url=public_url)
    save_summary(summary, html_content)
    summary["html"] = html_content
    summary["telegram_messages"] = render_summary_telegram(summary, public_url=public_url)
    return summary

"""Premarket market brief (/summary_pre): Finnhub pre-market quotes only (S&P 500).

Unlike /summary (US close), this brief must NOT pull Yahoo daily rankings, heatmaps,
macro, crypto, or daily TA leader charts — those are regular-session / post-close data.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from news_crawler import fetch_news_for_tickers
from premarket_rankings import build_premarket_rankings, format_premarket_telegram
from summary_builder import (
    DEFAULT_TOP_N,
    TELEGRAM_CHUNK_SIZE,
    UNIVERSE_STYLE,
    _esc,
    format_summary_pdf_message,
    resolve_summary_public_url,
)

KST = ZoneInfo("Asia/Seoul")
SUMMARY_PRE_UNIVERSES = ("sp",)
SUMMARY_PRE_NEWS_PER_TICKER = 2


def build_premarket_summary(news_limit: int = SUMMARY_PRE_NEWS_PER_TICKER) -> dict:
    generated_at = datetime.now(KST)
    universes: list[dict] = []
    all_tickers: list[str] = []
    ticker_universe: dict[str, str] = {}
    premarket_by_universe: dict[str, dict] = {}

    for universe in SUMMARY_PRE_UNIVERSES:
        result = build_premarket_rankings(universe)
        premarket_by_universe[universe] = result

        gainers = result.get("gainers") or []
        losers = result.get("losers") or []
        tickers = [row["ticker"] for row in gainers[:DEFAULT_TOP_N]]
        for row in losers[:DEFAULT_TOP_N]:
            if row["ticker"] not in tickers:
                tickers.append(row["ticker"])

        for ticker in tickers:
            if ticker not in all_tickers:
                all_tickers.append(ticker)
            ticker_universe[ticker] = universe

        boards = {
            "surge": {
                "top": [
                    (row["ticker"], f"{row['change_pct']:+.2f}%")
                    for row in gainers[:DEFAULT_TOP_N]
                ]
            },
            "dropvol": {
                "top": [
                    (row["ticker"], f"{row['change_pct']:+.2f}%")
                    for row in losers[:DEFAULT_TOP_N]
                ]
            },
        }
        universes.append(
            {
                "key": universe,
                "name": f"{result['label']} (pre-market)",
                "boards": boards,
                "tickers": tickers,
                "leader_ticker": gainers[0]["ticker"] if gainers else None,
                "session": result.get("session"),
                "premarket": result,
            }
        )

    news_by_ticker: dict[str, list[dict[str, str]]] = {}
    if all_tickers:
        news_by_ticker.update(
            fetch_news_for_tickers(all_tickers, limit=news_limit, universe="sp")
        )

    return {
        "kind": "summary_pre",
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "universes": universes,
        "news_by_ticker": news_by_ticker,
        "ticker_universe": ticker_universe,
        "ticker_count": len(all_tickers),
        "premarket_by_universe": premarket_by_universe,
        # Explicit empties so PDF/Telegram helpers never chase close-brief fields.
        "leader_charts": {},
        "ai_analysis": {
            "chart_notes_ko": {},
            "market_brief_ko": "",
            "source": "premarket",
            "article_count": 0,
        },
        "heatmap_sp": None,
        "macro": None,
        "crypto": None,
    }


def _format_pre_universe_telegram(universe: dict, summary: dict) -> list[dict]:
    messages: list[dict] = []
    pre = universe.get("premarket")
    if pre:
        messages.append({"text": format_premarket_telegram(pre), "parse_mode": "HTML"})
    else:
        ukey = universe["key"]
        style = UNIVERSE_STYLE.get(ukey, {"emoji": "🌅"})
        messages.append(
            {
                "text": f"{style['emoji']} {universe['name']}\n(no premarket rows)",
            }
        )

    # News only — no Yahoo daily leader charts (those belong to /summary after the close).
    ukey = universe["key"]
    style = UNIVERSE_STYLE.get(ukey, {"emoji": "🌅"})
    header = f"<b>{style['emoji']} {_esc(universe['name'])}</b>\n"
    news_lines = [header, "<b>📰 News</b>", ""]
    has_news = False
    ticker_blocks: list[list[str]] = []
    for ticker in universe.get("tickers") or []:
        headlines = summary.get("news_by_ticker", {}).get(ticker, [])
        if not headlines:
            continue
        has_news = True
        block = [f"<b>{_esc(ticker)}</b>"]
        for item in headlines[:SUMMARY_PRE_NEWS_PER_TICKER]:
            block.append(f"• {_esc(item.get('title', ''))}")
            block.append(
                f"<i>{_esc(item.get('source', ''))} | {_esc(item.get('date', 'N/A'))}</i>"
            )
        block.append("")
        ticker_blocks.append(block)

    if not has_news:
        messages.append(
            {
                "text": f"{header}\n<b>📰 News</b>\n\n<i>No recent headlines</i>",
                "parse_mode": "HTML",
            }
        )
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


def render_summary_pre_telegram(summary: dict) -> list[dict]:
    messages: list[dict] = [
        {
            "text": (
                "<b>🌅 SavvyETF Premarket Brief</b>\n"
                f"<i>{_esc(summary.get('generated_at_display', ''))}</i>\n"
                "S&P 500 pre-market % vs previous close (Finnhub) · ETF excluded\n"
                "<i>Not financial advice.</i>"
            ),
            "parse_mode": "HTML",
        }
    ]
    for universe in summary.get("universes") or []:
        messages.extend(_format_pre_universe_telegram(universe, summary))
    return messages


def generate_summary_pre(public_url: str = "") -> dict:
    """Build Telegram + PDF from Finnhub pre-market data only."""
    summary = build_premarket_summary()

    try:
        from summary_pdf import SUMMARY_PRE_PDF_PATH, build_summary_pdf_safe

        pdf_path = build_summary_pdf_safe(summary, output_path=SUMMARY_PRE_PDF_PATH)
        summary["pdf_path"] = str(pdf_path)
    except Exception as exc:
        summary["pdf_path"] = None
        summary["pdf_error"] = str(exc)
        print(f"Premarket PDF export skipped: {exc}")

    messages = render_summary_pre_telegram(summary)
    web = public_url.strip() if public_url else resolve_summary_public_url()
    messages.append(
        {
            "text": (
                "Premarket PDF: /summary_pre.pdf\n"
                f"(Close brief /summary updates after the US session: {web})"
            )
        }
    )
    pdf_message = format_summary_pdf_message(summary, web)
    if pdf_message:
        messages.append(pdf_message)
    elif summary.get("pdf_error"):
        messages.append({"text": f"PDF export unavailable: {summary['pdf_error']}"})

    summary["telegram_messages"] = messages

    try:
        from web_publish import publish_brief, section_from_html

        body_parts = []
        for msg in messages:
            if isinstance(msg, dict) and msg.get("text"):
                body_parts.append(str(msg["text"]))
            elif isinstance(msg, str):
                body_parts.append(msg)
        publish_brief(
            "us",
            "summary_pre",
            title="미국 시황 /summary_pre",
            generated_at=summary.get("generated_at_display")
            or summary.get("generated_at"),
            sections=section_from_html(
                "\n\n".join(body_parts), heading="Premarket brief"
            ),
            meta={"has_pdf": bool(summary.get("pdf_path"))},
        )
    except Exception as pub_exc:
        print(f"web_publish summary_pre skipped: {pub_exc}")

    return summary

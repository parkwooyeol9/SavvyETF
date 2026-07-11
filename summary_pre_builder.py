"""Premarket market brief (/summary_pre): S&P 500 via /sp_pre, no ETF."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from news_crawler import _display_ticker_label, fetch_news_for_tickers
from premarket_rankings import build_premarket_rankings, format_premarket_telegram
from summary_analyst import collect_leader_charts, generate_chart_notes
from summary_builder import (
    DEFAULT_TOP_N,
    TELEGRAM_CHUNK_SIZE,
    UNIVERSE_STYLE,
    _as_photo_buffer,
    _esc,
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
        # News/charts focus on top of each board.
        tickers = [row["ticker"] for row in gainers[:DEFAULT_TOP_N]]
        for row in losers[:DEFAULT_TOP_N]:
            if row["ticker"] not in tickers:
                tickers.append(row["ticker"])

        leader_ticker = gainers[0]["ticker"] if gainers else None
        for ticker in tickers:
            if ticker not in all_tickers:
                all_tickers.append(ticker)
            ticker_universe[ticker] = universe

        # Shape compatible with summary telegram/HTML helpers where useful.
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
                "leader_ticker": leader_ticker,
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

    leader = universe.get("leader_ticker")
    leaders = summary.get("leader_charts") or {}
    leader_pack = leaders.get(universe["key"]) or {}
    chart_notes = (summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}
    if leader:
        caption_lines = [
            f"📈 Premarket leader: {_display_ticker_label(leader, None)}",
            f"Session: {universe.get('session', 'pre-market')}",
        ]
        note = chart_notes.get(universe["key"], "").strip()
        if note:
            caption_lines.extend(["", note])
        chart_reply: dict = {"text": "\n".join(caption_lines)}
        photo = _as_photo_buffer(leader_pack.get("chart_png"))
        if photo is not None:
            chart_reply["photo"] = photo
        else:
            chart_reply["chart_ticker"] = leader
        messages.append(chart_reply)

    # News blocks (chunked)
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
                "S&P 500 pre-market returns (/sp_pre) · ETF excluded\n"
                "<i>Not financial advice.</i>"
            ),
            "parse_mode": "HTML",
        }
    ]
    for universe in summary.get("universes") or []:
        messages.extend(_format_pre_universe_telegram(universe, summary))
    return messages


def generate_summary_pre(public_url: str = "") -> dict:
    summary = build_premarket_summary()
    leader_charts = collect_leader_charts(summary)
    summary["leader_charts"] = leader_charts
    summary["ai_analysis"] = {
        "chart_notes_ko": generate_chart_notes(summary, leader_charts),
        "market_brief_ko": "",
        "source": "rules",
        "article_count": 0,
    }

    messages = render_summary_pre_telegram(summary)
    web = public_url.strip() if public_url else resolve_summary_public_url()
    messages.append(
        {
            "text": (
                "🌐 Regular close brief (web)\n"
                f"{web}\n\n"
                "Premarket brief is Telegram-only; full /summary page updates after the US close."
            )
        }
    )
    summary["telegram_messages"] = messages
    return summary

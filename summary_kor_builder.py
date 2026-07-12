"""Korean market brief (/summary_kor): KOSPI 200 + KOSDAQ 100."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from kr_names import format_kr_ticker_label
from news_crawler import fetch_news_for_tickers
from stock_crawler import (
    DEFAULT_TOP_N,
    UNIVERSES,
    _ranking_slice,
    get_top_leader_ticker,
    is_cache_ready,
    warmup_cache,
)
from summary_analyst import collect_leader_charts, generate_chart_notes
from summary_builder import (
    TELEGRAM_CHUNK_SIZE,
    _as_photo_buffer,
    _esc,
    _freeze_summary_charts,
    format_summary_pdf_message,
    resolve_summary_public_url,
)

KST = ZoneInfo("Asia/Seoul")
SUMMARY_KOR_UNIVERSES = ("kospi", "kosdaq")
SUMMARY_KOR_NEWS_PER_TICKER = 2
PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"

UNIVERSE_STYLE = {
    "kospi": {"emoji": "🇰🇷", "label": "KOSPI 200", "color": "#4da3ff"},
    "kosdaq": {"emoji": "📈", "label": "KOSDAQ 100", "color": "#3dd68c"},
}


def caches_ready_kor() -> bool:
    return all(is_cache_ready(u) for u in SUMMARY_KOR_UNIVERSES)


def ensure_kor_caches() -> list[str]:
    missing: list[str] = []
    for universe in SUMMARY_KOR_UNIVERSES:
        if is_cache_ready(universe):
            continue
        try:
            warmup_cache(universe)
        except Exception as exc:
            print(f"KOSPI/KOSDAQ cache warmup failed ({universe}): {exc}")
        if not is_cache_ready(universe):
            missing.append(universe)
    return missing


def _summary_boards(universe: str) -> dict:
    # Same shape as summary_builder: each mode is the full _ranking_slice dict
    # (with a list under "top"), not {"top": <slice dict>}.
    return {
        mode: _ranking_slice(universe, mode, DEFAULT_TOP_N, 0)
        for mode in ("surge", "dropvol")
    }


def build_kor_market_summary(news_limit: int = SUMMARY_KOR_NEWS_PER_TICKER) -> dict:
    generated_at = datetime.now(KST)
    universes: list[dict] = []
    all_tickers: list[str] = []
    ticker_universe: dict[str, str] = {}

    for universe in SUMMARY_KOR_UNIVERSES:
        boards = _summary_boards(universe)
        tickers = get_ranking_tickers_for_boards(boards)
        leader = get_top_leader_ticker(universe, "surge")
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
                "leader_ticker": leader,
            }
        )

    news_by_ticker: dict[str, list[dict[str, str]]] = {}
    if all_tickers:
        news_by_ticker.update(fetch_news_for_tickers(all_tickers, limit=news_limit))

    return {
        "kind": "summary_kor",
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "universes": universes,
        "news_by_ticker": news_by_ticker,
        "ticker_universe": ticker_universe,
        "ticker_count": len(all_tickers),
    }


def get_ranking_tickers_for_boards(boards: dict) -> list[str]:
    tickers: list[str] = []
    for mode in ("surge", "dropvol"):
        for row in (boards.get(mode) or {}).get("top") or []:
            ticker = row[0] if isinstance(row, (list, tuple)) else row
            if ticker and ticker not in tickers:
                tickers.append(str(ticker))
    return tickers


def _format_boards_telegram(universe: dict) -> str:
    ukey = universe["key"]
    style = UNIVERSE_STYLE.get(ukey, {"emoji": "🇰🇷", "label": universe["name"]})
    lines = [
        f"<b>{style['emoji']} {_esc(universe['name'])}</b>",
        "Price: last day return · Volume: latest / 21d avg",
        "",
    ]
    for mode, title in (
        ("surge", "▲ 상승+거래대금 급증"),
        ("dropvol", "▼ 하락+거래대금 급증"),
    ):
        lines.append(f"<b>{title}</b>")
        rows = ((universe.get("boards") or {}).get(mode) or {}).get("top") or []
        if not rows:
            lines.append("<i>(no rows)</i>")
        for idx, row in enumerate(rows, start=1):
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                ticker, metric = row[0], row[1]
            else:
                ticker, metric = row, ""
            label = format_kr_ticker_label(str(ticker))
            lines.append(f"{idx}. {_esc(label)}  {_esc(metric)}")
        lines.append("")
    return "\n".join(lines).rstrip()


def _format_universe_telegram(universe: dict, summary: dict) -> list[dict]:
    messages: list[dict] = [{"text": _format_boards_telegram(universe), "parse_mode": "HTML"}]

    leader = universe.get("leader_ticker")
    leaders = summary.get("leader_charts") or {}
    leader_pack = leaders.get(universe["key"]) or {}
    chart_notes = (summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}
    if leader:
        caption = [
            f"📈 Top leader: {format_kr_ticker_label(leader)}",
        ]
        note = chart_notes.get(universe["key"], "").strip()
        if note:
            caption.extend(["", note])
        chart_reply: dict = {"text": "\n".join(caption)}
        photo = _as_photo_buffer(leader_pack.get("chart_png"))
        if photo is not None:
            chart_reply["photo"] = photo
        else:
            chart_reply["chart_ticker"] = leader
        messages.append(chart_reply)

    ukey = universe["key"]
    style = UNIVERSE_STYLE.get(ukey, {"emoji": "🇰🇷"})
    header = f"<b>{style['emoji']} {_esc(universe['name'])}</b>\n"
    news_lines = [header, "<b>📰 News</b>", ""]
    has_news = False
    ticker_blocks: list[list[str]] = []
    for ticker in universe.get("tickers") or []:
        headlines = summary.get("news_by_ticker", {}).get(ticker, [])
        if not headlines:
            continue
        has_news = True
        block = [f"<b>{_esc(format_kr_ticker_label(ticker))}</b>"]
        for item in headlines[:SUMMARY_KOR_NEWS_PER_TICKER]:
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


def render_summary_kor_telegram(summary: dict) -> list[dict]:
    messages: list[dict] = [
        {
            "text": (
                "<b>🇰🇷 SavvyETF Korea Brief</b>\n"
                f"<i>{_esc(summary.get('generated_at_display', ''))}</i>\n"
                "KOSPI 200 + KOSDAQ 100 · Yahoo Finance daily bars\n"
                "<i>Not financial advice.</i>"
            ),
            "parse_mode": "HTML",
        }
    ]
    for universe in summary.get("universes") or []:
        messages.extend(_format_universe_telegram(universe, summary))
    return messages


def generate_summary_kor(public_url: str = "") -> dict:
    missing = ensure_kor_caches()
    if missing:
        labels = ", ".join(UNIVERSES[u]["label"] for u in missing)
        raise RuntimeError(
            f"Korea summary caches are not ready ({labels}). Try /summary_kor again shortly."
        )

    summary = build_kor_market_summary()
    leader_charts = collect_leader_charts(summary)
    summary["leader_charts"] = leader_charts
    summary["ai_analysis"] = {
        "chart_notes_ko": generate_chart_notes(summary, leader_charts),
        "market_brief_ko": "",
        "source": "rules",
        "article_count": 0,
    }
    _freeze_summary_charts(summary)

    try:
        from summary_pdf import SUMMARY_KOR_PDF_PATH, build_summary_pdf_safe

        pdf_path = build_summary_pdf_safe(summary, output_path=SUMMARY_KOR_PDF_PATH)
        summary["pdf_path"] = str(pdf_path)
    except Exception as exc:
        summary["pdf_path"] = None
        summary["pdf_error"] = str(exc)
        print(f"Korea PDF export skipped: {exc}")

    messages = render_summary_kor_telegram(summary)
    web = public_url.strip() if public_url else resolve_summary_public_url()
    messages.append(
        {
            "text": (
                "📄 Korea brief PDF: /summary_kor.pdf\n"
                f"US close brief (web): {web}"
            )
        }
    )
    pdf_message = format_summary_pdf_message(summary, web)
    if pdf_message:
        messages.append(pdf_message)
    elif summary.get("pdf_error"):
        messages.append({"text": f"PDF export unavailable: {summary['pdf_error']}"})

    summary["telegram_messages"] = messages
    return summary

"""Korean market brief (/summary_kor): KOSPI 200 + KOSDAQ 100."""

from __future__ import annotations

import base64
import html
import json
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from ai_briefing import _strip_disclaimer
from data_briefing import (
    brief_paragraphs_html,
    format_brief_paragraphs,
    generate_data_briefing_from_kor_summary,
)
from kr_names import format_kr_ticker_label, kr_code_from_yahoo
from naver_news import fetch_naver_news_for_tickers
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
    _chart_png_bytes,
    _esc,
    _freeze_chart_buffer,
    _freeze_summary_charts,
    format_summary_pdf_message,
    resolve_summary_public_url,
)

KST = ZoneInfo("Asia/Seoul")
SUMMARY_KOR_UNIVERSES = ("kospi", "kosdaq")
SUMMARY_KOR_NEWS_PER_TICKER = 2
PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
SUMMARY_KOR_HTML_PATH = DATA_DIR / "summary_kor.html"
SUMMARY_KOR_META_PATH = DATA_DIR / "summary_kor_meta.json"
SUMMARY_KOR_INTRA_HTML_PATH = DATA_DIR / "summary_kor_intra.html"
SUMMARY_KOR_INTRA_META_PATH = DATA_DIR / "summary_kor_intra_meta.json"

UNIVERSE_STYLE = {
    "kospi": {"emoji": "🇰🇷", "label": "KOSPI 200", "color": "#4da3ff"},
    "kosdaq": {"emoji": "📈", "label": "KOSDAQ 100", "color": "#3dd68c"},
}

BOARD_TITLES_KO = {
    "surge": "▲ 상승+거래대금 급증",
    "dropvol": "▼ 하락+거래대금 급증",
}


def caches_ready_kor() -> bool:
    return all(is_cache_ready(u) for u in SUMMARY_KOR_UNIVERSES)


def ensure_kor_caches(*, force: bool = False) -> list[str]:
    """Ensure KOSPI/KOSDAQ ranking caches exist.

    ``force=True`` rebuilds from Yahoo so mid-session (intraday) briefs
    are not stuck on a morning same-day disk cache.
    """
    missing: list[str] = []
    for universe in SUMMARY_KOR_UNIVERSES:
        if not force and is_cache_ready(universe):
            continue
        try:
            warmup_cache(universe, force=force)
        except Exception as exc:
            print(f"KOSPI/KOSDAQ cache warmup failed ({universe}): {exc}")
        if not is_cache_ready(universe):
            missing.append(universe)
    return missing


def _is_intraday(summary: dict | None = None, *, intraday: bool = False) -> bool:
    if intraday:
        return True
    if not summary:
        return False
    return summary.get("kind") == "summary_kor_intra" or bool(summary.get("intraday"))


def _price_metric_line(*, intraday: bool) -> str:
    if intraday:
        return "장중 수익률 = (Naver 1분봉 종가 − 전일 종가) / 전일 종가 · 거래량=당일누적/21일평균"
    return "Price: last day return · Volume: latest / 21d avg"


def _summary_boards(universe: str) -> dict:
    # Same shape as summary_builder: each mode is the full _ranking_slice dict
    # (with a list under "top"), not {"top": <slice dict>}.
    return {
        mode: _ranking_slice(universe, mode, DEFAULT_TOP_N, 0)
        for mode in ("surge", "dropvol")
    }


def build_kor_market_summary(
    news_limit: int = SUMMARY_KOR_NEWS_PER_TICKER,
    *,
    intraday: bool = False,
) -> dict:
    generated_at = datetime.now(KST)
    universes: list[dict] = []
    all_tickers: list[str] = []
    ticker_universe: dict[str, str] = {}
    intraday_meta: dict[str, dict] = {}

    for universe in SUMMARY_KOR_UNIVERSES:
        if intraday:
            from kr_intra_rankings import build_kr_intraday_summary_boards

            boards, meta, leader = build_kr_intraday_summary_boards(
                universe, top_n=DEFAULT_TOP_N
            )
            intraday_meta[universe] = {
                "source": meta.get("source"),
                "used_minute": meta.get("used_minute"),
                "scanned": meta.get("scanned"),
                "sample_bar_time": meta.get("sample_bar_time"),
                "session": meta.get("session"),
            }
        else:
            boards = _summary_boards(universe)
            leader = get_top_leader_ticker(universe, "surge")
        tickers = get_ranking_tickers_for_boards(boards)
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

    # Always Naver Korean crawl — never Yahoo/Google English news.
    news_by_ticker: dict[str, list[dict[str, str]]] = {}
    for universe in universes:
        tickers = universe.get("tickers") or []
        if not tickers:
            continue
        news_by_ticker.update(
            fetch_naver_news_for_tickers(
                tickers,
                limit=news_limit,
                universe=universe["key"],
                korean_only=True,
            )
        )

    return {
        "kind": "summary_kor_intra" if intraday else "summary_kor",
        "intraday": bool(intraday),
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "universes": universes,
        "news_by_ticker": news_by_ticker,
        "ticker_universe": ticker_universe,
        "ticker_count": len(all_tickers),
        "news_source": "naver",
        "intraday_meta": intraday_meta,
        "price_source": (
            "Naver 1m vs previous close"
            if intraday
            else "Yahoo daily cache"
        ),
    }


def get_ranking_tickers_for_boards(boards: dict) -> list[str]:
    tickers: list[str] = []
    for mode in ("surge", "dropvol"):
        for row in (boards.get(mode) or {}).get("top") or []:
            ticker = row[0] if isinstance(row, (list, tuple)) else row
            if ticker and ticker not in tickers:
                tickers.append(str(ticker))
    return tickers


def _attach_dart_for_leaders(summary: dict) -> dict[str, dict]:
    """DART financials for KOSPI + KOSDAQ surge leaders only."""
    from dart_charts import format_dart_chart_caption, plot_dart_dashboard
    from dart_data import build_dart_profile, format_dart_telegram

    dart_by_universe: dict[str, dict] = {}
    for universe in summary.get("universes") or []:
        ukey = universe.get("key") or ""
        leader = universe.get("leader_ticker")
        if not ukey or not leader:
            continue
        code = kr_code_from_yahoo(str(leader))
        try:
            profile = build_dart_profile(code)
            chart = plot_dart_dashboard(profile)
            latest = profile.get("latest_metrics") or {}
            # Drop DataFrame / raw company blob — keep JSON-safe metrics only.
            dart_by_universe[ukey] = {
                "leader_ticker": str(leader),
                "corp_name": profile.get("corp_name", ""),
                "stock_code": profile.get("stock_code", code),
                "latest_year": profile.get("latest_year"),
                "ratios": dict(profile.get("ratios") or {}),
                "latest_metrics": {
                    key: (
                        None
                        if value is None
                        or (isinstance(value, float) and value != value)
                        else value
                    )
                    for key, value in latest.items()
                    if key
                    in {
                        "year",
                        "revenue",
                        "operating_profit",
                        "net_income",
                        "total_assets",
                        "total_equity",
                        "total_liabilities",
                        "eps",
                    }
                },
                "text_summary": format_dart_telegram(profile),
                "caption": format_dart_chart_caption(profile),
                "chart": chart,
            }
        except Exception as exc:
            dart_by_universe[ukey] = {
                "leader_ticker": str(leader),
                "error": str(exc),
            }
            print(f"DART attach failed for {ukey} {leader}: {exc}")
    return dart_by_universe


def _freeze_dart_charts(summary: dict) -> None:
    for pack in (summary.get("dart_by_universe") or {}).values():
        if isinstance(pack, dict) and pack.get("chart") is not None:
            pack["chart"] = _freeze_chart_buffer(pack.get("chart"))


def _format_boards_telegram(universe: dict, summary: dict | None = None) -> str:
    ukey = universe["key"]
    style = UNIVERSE_STYLE.get(ukey, {"emoji": "🇰🇷", "label": universe["name"]})
    intraday = _is_intraday(summary)
    lines = [
        f"<b>{style['emoji']} {_esc(universe['name'])}</b>",
        _price_metric_line(intraday=intraday),
        "",
    ]
    for mode, title in BOARD_TITLES_KO.items():
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


def _format_dart_telegram_block(universe: dict, summary: dict) -> list[dict]:
    ukey = universe.get("key") or ""
    pack = (summary.get("dart_by_universe") or {}).get(ukey) or {}
    if not pack:
        return []
    if pack.get("error"):
        leader = pack.get("leader_ticker") or universe.get("leader_ticker") or ""
        return [
            {
                "text": (
                    f"🇰🇷 DART 재무 — {format_kr_ticker_label(str(leader))}\n"
                    f"(unavailable: {pack['error']})"
                )
            }
        ]

    messages: list[dict] = []
    photo = _as_photo_buffer(pack.get("chart"))
    caption = pack.get("caption") or f"DART {pack.get('corp_name', '')}"
    if photo is not None:
        messages.append({"text": caption, "photo": photo})
    text = pack.get("text_summary")
    if text:
        messages.append({"text": text, "parse_mode": "HTML"})
    return messages


def _format_universe_telegram(universe: dict, summary: dict) -> list[dict]:
    messages: list[dict] = [
        {"text": _format_boards_telegram(universe, summary), "parse_mode": "HTML"}
    ]

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

    messages.extend(_format_dart_telegram_block(universe, summary))

    ukey = universe["key"]
    style = UNIVERSE_STYLE.get(ukey, {"emoji": "🇰🇷"})
    header = f"<b>{style['emoji']} {_esc(universe['name'])}</b>\n"
    news_lines = [header, "<b>📰 Naver News (한국어)</b>", ""]
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
                "text": f"{header}\n<b>📰 Naver News (한국어)</b>\n\n<i>No recent headlines</i>",
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
            current = [header, "<b>📰 Naver News (continued)</b>", ""]
            current_len = len("\n".join(current))
        current.extend(block)
        current_len += extra
    if current:
        messages.append({"text": "\n".join(current).rstrip(), "parse_mode": "HTML"})
    return messages


def render_summary_kor_telegram(summary: dict) -> list[dict]:
    intraday = _is_intraday(summary)
    title = "🇰🇷 SavvyETF Korea Intraday Brief" if intraday else "🇰🇷 SavvyETF Korea Brief"
    source_line = (
        "KOSPI 200 + KOSDAQ 100 · Naver 1분봉 vs 전일 종가 · Naver News · DART"
        if intraday
        else "KOSPI 200 + KOSDAQ 100 · Yahoo prices · Naver News · DART"
    )
    messages: list[dict] = [
        {
            "text": (
                f"<b>{title}</b>\n"
                f"<i>{_esc(summary.get('generated_at_display', ''))}</i>\n"
                f"{source_line}\n"
                "<i>Not financial advice.</i>"
            ),
            "parse_mode": "HTML",
        }
    ]
    for universe in summary.get("universes") or []:
        messages.extend(_format_universe_telegram(universe, summary))
    messages.extend(_format_kor_data_briefing_telegram(summary))
    return messages


def _format_kor_data_briefing_telegram(summary: dict) -> list[dict]:
    ai = summary.get("ai_analysis") or {}
    brief_ko = format_brief_paragraphs(str(ai.get("market_brief_ko") or ""), blank_lines=2)
    if not brief_ko:
        return []
    source = ai.get("source", "ai")
    article_count = ai.get("article_count", 0)
    header = "📝 데이터 브리핑 · 국내시황\n"
    if ai.get("error") and source == "rules":
        header += "(Gemini unavailable — data fallback)\n"
    header += f"출처: {source} | 참고 뉴스 {article_count}건\n\n"
    return [{"text": header + brief_ko}]


def _render_kor_data_briefing_html(summary: dict) -> str:
    ai = summary.get("ai_analysis") or {}
    brief_ko = _strip_disclaimer(str(ai.get("market_brief_ko") or "").strip())
    if not brief_ko:
        return ""
    paras = brief_paragraphs_html(brief_ko, esc=html.escape)
    source = html.escape(str(ai.get("source") or ""))
    article_count = ai.get("article_count", 0)
    return f"""
    <section class="appendix-section ai-brief">
      <h2>📝 데이터 브리핑 · 국내시황</h2>
      <p class="meta">보드·차트 노트·네이버 뉴스 기반 · {article_count}건 참고 ({source})</p>
      {paras}
    </section>
    """


def resolve_summary_kor_public_url(public_url: str = "", *, intraday: bool = False) -> str:
    """Public HTML URL for Korea brief — separate from US /summary."""
    suffix = "/summary_kor_intra" if intraday else "/summary_kor"
    env_key = "SUMMARY_KOR_INTRA_PUBLIC_URL" if intraday else "SUMMARY_KOR_PUBLIC_URL"
    explicit = os.environ.get(env_key, "").strip().rstrip("/")
    if explicit:
        return explicit if explicit.endswith(suffix) else f"{explicit}{suffix}"

    web = public_url.strip() if public_url else resolve_summary_public_url()
    if web.endswith("/summary"):
        return f"{web.rsplit('/summary', 1)[0]}{suffix}"
    if web.endswith(suffix):
        return web
    if web.endswith("/summary_kor") and intraday:
        return f"{web.rsplit('/summary_kor', 1)[0]}{suffix}"
    return f"{web.rstrip('/')}{suffix}"


def _buffer_to_data_uri(buffer, mime: str) -> str:
    data = _chart_png_bytes(buffer)
    if not data:
        return ""
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _render_kor_board_html(board: dict, mode: str) -> str:
    top_rows = "".join(
        (
            f"<tr><td>{html.escape(format_kr_ticker_label(t))}</td>"
            f"<td class='pos'>{html.escape(str(v))}</td></tr>"
        )
        for t, v in board.get("top") or []
    )
    return f"""
    <div class="card">
      <h3>{html.escape(BOARD_TITLES_KO[mode])}</h3>
      <table>
        <caption>Top {DEFAULT_TOP_N}</caption>
        <thead><tr><th>종목</th><th>등락 | 거래량</th></tr></thead>
        <tbody>{top_rows}</tbody>
      </table>
    </div>
    """


def _render_kor_dart_html(summary: dict) -> str:
    packs = summary.get("dart_by_universe") or {}
    if not packs:
        return ""
    cards: list[str] = []
    for ukey in SUMMARY_KOR_UNIVERSES:
        pack = packs.get(ukey) or {}
        style = UNIVERSE_STYLE.get(ukey, {})
        label = style.get("label", ukey)
        if pack.get("error"):
            cards.append(
                f"<div class='dart-card'><h3>{html.escape(label)} DART</h3>"
                f"<p class='meta'>unavailable: {html.escape(str(pack['error']))}</p></div>"
            )
            continue
        img = ""
        data_uri = _buffer_to_data_uri(pack.get("chart"), "image/png")
        if data_uri:
            img = (
                f"<img src='{data_uri}' alt='DART {html.escape(pack.get('corp_name', ''))}' "
                "style='width:100%;border-radius:8px;border:1px solid var(--border,#2b3648)' />"
            )
        metrics = pack.get("latest_metrics") or {}
        ratios = pack.get("ratios") or {}
        year = pack.get("latest_year", "")
        from dart_data import _format_krw, _format_pct

        cards.append(
            f"""
            <div class="dart-card">
              <h3>{html.escape(label)} · {html.escape(pack.get('corp_name', ''))}</h3>
              <p class="meta">{html.escape(str(pack.get('caption', '')))}</p>
              {img}
              <ul>
                <li>매출({year}): <strong>{html.escape(_format_krw(metrics.get('revenue')))}</strong></li>
                <li>영업이익: <strong>{html.escape(_format_krw(metrics.get('operating_profit')))}</strong></li>
                <li>당기순이익: <strong>{html.escape(_format_krw(metrics.get('net_income')))}</strong></li>
                <li>영업이익률: <strong>{html.escape(_format_pct(ratios.get('operating_margin')))}</strong>
                    · ROE: <strong>{html.escape(_format_pct(ratios.get('roe')))}</strong></li>
                <li>매출 YoY: <strong>{html.escape(_format_pct(ratios.get('revenue_growth'), signed=True))}</strong></li>
              </ul>
            </div>
            """
        )
    return f"""
    <section class="appendix-section">
      <h2>🇰🇷 DART 재무 (Top leaders)</h2>
      <p class="meta">KOSPI / KOSDAQ surge #1 · Open DART 연결 사업보고서</p>
      <div class="leader-grid">{''.join(cards)}</div>
    </section>
    """


def _render_kor_leaders_html(summary: dict) -> str:
    leaders = summary.get("leader_charts") or {}
    chart_notes = (summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}
    if not leaders:
        return ""
    cards: list[str] = []
    for ukey in SUMMARY_KOR_UNIVERSES:
        pack = leaders.get(ukey) or {}
        if not isinstance(pack, dict):
            continue
        ticker = pack.get("ticker") or ""
        data_uri = _buffer_to_data_uri(pack.get("chart_png") or pack.get("chart"), "image/png")
        if not data_uri:
            continue
        note = html.escape((chart_notes.get(ukey) or "").strip())
        note_html = f"<p class='meta'>{note}</p>" if note else ""
        cards.append(
            f"""
            <div class="leader-card">
              <h3>{html.escape(format_kr_ticker_label(str(ticker)))}</h3>
              {note_html}
              <img src="{data_uri}" alt="{html.escape(str(ticker))}" />
            </div>
            """
        )
    if not cards:
        return ""
    return f"""
    <section class="appendix-section">
      <h2>📈 Leader charts</h2>
      <div class="leader-grid">{''.join(cards)}</div>
    </section>
    """


def render_summary_kor_html(summary: dict, public_url: str = "") -> str:
    intraday = _is_intraday(summary)
    title_prefix = "SavvyETF Korea Intraday Brief" if intraday else "SavvyETF Korea Brief"
    title = f"{title_prefix} — {summary.get('generated_at_display', '')}"
    kor_url = resolve_summary_kor_public_url(public_url, intraday=intraday)
    path_suffix = "/summary_kor_intra" if intraday else "/summary_kor"
    pdf_url = (
        f"{kor_url}.pdf"
        if kor_url.rstrip("/").endswith(path_suffix)
        else f"{kor_url.rstrip('/')}{path_suffix}.pdf"
    )
    base_url = kor_url.rstrip("/").removesuffix(path_suffix)
    metric_meta = _price_metric_line(intraday=intraday)

    sections_html: list[str] = []
    for index, universe in enumerate(summary.get("universes") or []):
        ukey = universe["key"]
        style = UNIVERSE_STYLE.get(
            ukey, {"emoji": "🇰🇷", "label": universe["name"], "color": "#4da3ff"}
        )
        divider = '<hr class="section-divider" />' if index > 0 else ""
        cards = "".join(
            _render_kor_board_html(universe["boards"][mode], mode)
            for mode in ("surge", "dropvol")
            if mode in (universe.get("boards") or {})
        )

        news_html: list[str] = []
        for ticker in universe.get("tickers") or []:
            headlines = (summary.get("news_by_ticker") or {}).get(ticker, [])
            items = "".join(
                (
                    f"<li><strong>{html.escape(item.get('title', ''))}</strong>"
                    f"<span class='meta'>{html.escape(item.get('source', ''))} | "
                    f"{html.escape(item.get('date', 'N/A'))}</span></li>"
                )
                for item in headlines
            )
            if not items:
                items = "<li class='meta'>최근 헤드라인 없음</li>"
            news_html.append(
                f"<div class='news-block'><h4>{html.escape(format_kr_ticker_label(ticker))}</h4>"
                f"<ul>{items}</ul></div>"
            )

        sections_html.append(
            f"""
            {divider}
            <section class="universe-section section-{ukey}" style="--section-color: {style['color']}">
              <div class="section-header">
                <span class="section-emoji">{style['emoji']}</span>
                <h2>{_esc(universe['name'])}</h2>
              </div>
              <p class="meta">{html.escape(metric_meta)}</p>
              <div class="grid">{cards}</div>
              <h3 class="news-heading">Naver News (한국어)</h3>
              <div class="news-grid">{''.join(news_html)}</div>
            </section>
            """
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
    .summary-wrap {{ max-width: none; width: 100%; margin: 0 auto; padding: 18px 12px 40px; box-sizing: border-box; }}
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
    table {{ width: 100%; border-collapse: collapse; font-size: 0.92rem; }}
    caption {{ text-align: left; font-weight: 600; margin-bottom: 6px; color: var(--muted, #8fa3b8); }}
    th, td {{ padding: 6px 4px; border-bottom: 1px solid var(--border, #2b3648); text-align: left; }}
    .pos {{ color: var(--accent-2, #3dd68c); font-variant-numeric: tabular-nums; }}
    .news-grid {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }}
    .news-block {{ background: rgba(255,255,255,0.02); border: 1px solid var(--border, #2b3648); border-radius: 10px; padding: 12px; }}
    ul {{ margin: 0; padding-left: 18px; }}
    li {{ margin-bottom: 8px; }}
    li .meta {{ display: block; margin-top: 2px; }}
    .appendix-section {{
      margin: 2rem 0; padding: 1.25rem; border: 1px solid var(--border, #2b3648);
      border-radius: 12px; background: var(--panel, #141d2b);
    }}
    .leader-grid {{ display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
    .leader-card img, .dart-card img {{
      width: 100%; border-radius: 8px; border: 1px solid var(--border, #2b3648);
    }}
    .dart-card {{ background: rgba(255,255,255,0.02); border: 1px solid var(--border, #2b3648); border-radius: 10px; padding: 12px; }}
    .ai-brief p.brief-para {{ margin: 0 0 1.25rem; line-height: 1.65; }}
    .ai-brief p.brief-para:last-child {{ margin-bottom: 0; }}
    .summary-footer {{
      margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border, #2b3648);
      color: var(--muted, #8fa3b8); font-size: 0.85rem;
    }}
    .card {{ background: rgba(255,255,255,0.02); border: 1px solid var(--border, #2b3648); border-radius: 10px; padding: 12px; }}
  </style>
</head>
<body>
  <div class="summary-wrap">
    <div class="brand"><span class="brand-dot"></span> SavvyETF</div>
    <section class="summary-hero">
      <h1>{html.escape(title)}</h1>
      <p class="meta">KOSPI 200 + KOSDAQ 100 · {summary.get('ticker_count', 0)} tickers · {"장중" if intraday else "종가"} · Naver News · DART</p>
      <p class="meta">Live: <a href="{html.escape(kor_url)}">{html.escape(kor_url)}</a>
         · <a href="{html.escape(pdf_url)}">PDF</a>
         · US brief: <a href="{html.escape(base_url + '/summary') if base_url else '/summary'}">/summary</a></p>
      <div class="pill-row">
        <span class="pill">KOSPI 200</span>
        <span class="pill">KOSDAQ 100</span>
        <span class="pill">{"Intraday" if intraday else "EOD"}</span>
        <span class="pill">Naver News</span>
        <span class="pill">DART financials</span>
      </div>
    </section>
    {''.join(sections_html)}
    {_render_kor_data_briefing_html(summary)}
    {_render_kor_leaders_html(summary)}
    {_render_kor_dart_html(summary)}
    <footer class="summary-footer">
      SavvyETF Korea{" Intraday" if intraday else ""} · Generated {html.escape(str(summary.get('generated_at_display', '')))} · Not financial advice
    </footer>
  </div>
</body>
</html>"""


def save_summary_kor(summary: dict, html_content: str) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    intraday = _is_intraday(summary)
    html_path = SUMMARY_KOR_INTRA_HTML_PATH if intraday else SUMMARY_KOR_HTML_PATH
    meta_path = SUMMARY_KOR_INTRA_META_PATH if intraday else SUMMARY_KOR_META_PATH
    html_path.write_text(html_content, encoding="utf-8")
    meta = {
        "generated_at": summary.get("generated_at"),
        "generated_at_display": summary.get("generated_at_display"),
        "ticker_count": summary.get("ticker_count"),
        "has_pdf": bool(summary.get("pdf_path")),
        "news_source": summary.get("news_source", "naver"),
        "intraday": intraday,
        "kind": summary.get("kind"),
        "data_briefing_source": (summary.get("ai_analysis") or {}).get("source"),
        "has_data_briefing": bool(
            ((summary.get("ai_analysis") or {}).get("market_brief_ko") or "").strip()
        ),
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def load_summary_kor_html() -> str | None:
    if SUMMARY_KOR_HTML_PATH.exists():
        return SUMMARY_KOR_HTML_PATH.read_text(encoding="utf-8")
    return None


def load_summary_kor_intra_html() -> str | None:
    if SUMMARY_KOR_INTRA_HTML_PATH.exists():
        return SUMMARY_KOR_INTRA_HTML_PATH.read_text(encoding="utf-8")
    return None


def _minimal_summary_kor_html(summary: dict, public_url: str = "", *, error: str = "") -> str:
    when = html.escape(str(summary.get("generated_at_display", "")))
    err = html.escape(error) if error else ""
    intraday = _is_intraday(summary)
    kor_url = resolve_summary_kor_public_url(public_url, intraday=intraday)
    path_suffix = "/summary_kor_intra" if intraday else "/summary_kor"
    pdf_url = (
        f"{kor_url}.pdf"
        if kor_url.endswith(path_suffix)
        else f"{kor_url}{path_suffix}.pdf"
    )
    label = "SavvyETF Korea Intraday Brief" if intraday else "SavvyETF Korea Brief"
    cmd = "/summary_kor_intra" if intraday else "/summary_kor"
    detail = f"<p class='meta'>HTML render note: {err}</p>" if err else ""
    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>{label}</title>
<style>body{{font-family:system-ui,sans-serif;background:#0b1018;color:#e8eef5;padding:2rem}}
a{{color:#4da3ff}}.meta{{color:#8fa3b8}}</style></head>
<body>
  <h1>{label}</h1>
  <p class="meta">{when}</p>
  <p>Full web layout was unavailable, but the brief was generated.</p>
  <p><a href="{html.escape(pdf_url)}">Download PDF</a></p>
  {detail}
  <p class="meta">Re-run {cmd} if this page looks incomplete.</p>
</body></html>"""


def generate_summary_kor(
    public_url: str = "",
    *,
    intraday: bool = False,
    force_refresh: bool | None = None,
) -> dict:
    if intraday:
        # Live Naver 1m rankings — do not use Yahoo same-day disk cache.
        summary = build_kor_market_summary(intraday=True)
    else:
        force = False if force_refresh is None else bool(force_refresh)
        missing = ensure_kor_caches(force=force)
        if missing:
            labels = ", ".join(UNIVERSES[u]["label"] for u in missing)
            raise RuntimeError(
                f"Korea summary caches are not ready ({labels}). Try /summary_kor again shortly."
            )
        summary = build_kor_market_summary(intraday=False)
    leader_charts = collect_leader_charts(summary)
    summary["leader_charts"] = leader_charts
    chart_notes = generate_chart_notes(summary, leader_charts)
    summary["dart_by_universe"] = _attach_dart_for_leaders(summary)

    # Final stage: Gemini (or rules fallback) 3-paragraph briefing from boards/notes/news/DART.
    briefing = generate_data_briefing_from_kor_summary(
        summary,
        chart_notes_ko=chart_notes,
    )
    summary["ai_analysis"] = {
        "chart_notes_ko": chart_notes,
        "market_brief_ko": briefing.get("market_brief_ko") or "",
        "source": briefing.get("source") or "rules",
        "article_count": briefing.get("article_count") or 0,
        "briefing_market": briefing.get("market") or "kr",
        "error": briefing.get("error"),
    }
    _freeze_summary_charts(summary)
    _freeze_dart_charts(summary)

    kor_web = resolve_summary_kor_public_url(public_url, intraday=intraday)
    path_suffix = "/summary_kor_intra" if intraday else "/summary_kor"

    try:
        html_content = render_summary_kor_html(summary, public_url=public_url or kor_web)
        save_summary_kor(summary, html_content)
        summary["html"] = html_content
    except Exception as exc:
        summary["html_error"] = str(exc)
        print(f"Korea HTML export failed: {exc}")
        try:
            stub = _minimal_summary_kor_html(summary, public_url or kor_web, error=str(exc))
            save_summary_kor(summary, stub)
            summary["html"] = stub
        except Exception as stub_exc:
            print(f"Korea HTML stub also failed: {stub_exc}")

    try:
        from summary_pdf import (
            SUMMARY_KOR_INTRA_PDF_PATH,
            SUMMARY_KOR_PDF_PATH,
            build_summary_pdf_safe,
        )

        pdf_out = SUMMARY_KOR_INTRA_PDF_PATH if intraday else SUMMARY_KOR_PDF_PATH
        pdf_path = build_summary_pdf_safe(summary, output_path=pdf_out)
        summary["pdf_path"] = str(pdf_path)
    except Exception as exc:
        summary["pdf_path"] = None
        summary["pdf_error"] = str(exc)
        print(f"Korea PDF export skipped: {exc}")

    messages = render_summary_kor_telegram(summary)
    label = "Korea intraday brief" if intraday else "Korea brief"
    messages.append(
        {
            "text": (
                f"🇰🇷 {label} (web): {kor_web}\n"
                f"📄 PDF: {kor_web}.pdf"
                if kor_web.endswith(path_suffix)
                else f"🇰🇷 {label} (web): {kor_web}\n📄 PDF: {path_suffix}.pdf"
            )
        }
    )
    pdf_message = format_summary_pdf_message(summary, public_url or kor_web)
    if pdf_message:
        messages.append(pdf_message)
    elif summary.get("pdf_error"):
        messages.append({"text": f"PDF export unavailable: {summary['pdf_error']}"})

    summary["telegram_messages"] = messages

    try:
        from web_publish import publish_brief

        slot = "summary_kor_intra" if intraday else "summary_kor"
        title = "국내 시황 /summary_kor_intra" if intraday else "국내 시황 /summary_kor"
        publish_brief(
            "kr",
            slot,
            title=title,
            generated_at=summary.get("generated_at_display")
            or summary.get("generated_at"),
            html=summary.get("html"),
            meta={"intraday": intraday, "has_pdf": bool(summary.get("pdf_path"))},
        )
    except Exception as pub_exc:
        print(f"web_publish summary_kor skipped: {pub_exc}")

    return summary


def generate_summary_kor_intra(public_url: str = "") -> dict:
    """Intraday Korea brief: Naver 1m vs previous close (same as /kospi_intra)."""
    return generate_summary_kor(public_url=public_url, intraday=True)

"""Reusable Gemini data briefing from freshly generated market payloads.

Designed for Korea / US / ETF / ESG briefs. Callers pass structured context
(boards, chart notes, crawled headlines, optional extras); Gemini returns
exactly three Korean paragraphs of market commentary.

First wired into ``/summary_kor`` (and ``/summary_kor_intra``). Other markets
can reuse ``generate_data_briefing`` once their packers are added.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import requests

GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
MAX_CONTEXT_CHARS = 18000

MARKET_LABELS = {
    "kr": "국내시황",
    "us": "미국시황",
    "etf": "ETF시황",
    "esg": "ESG시황",
}

DISCLAIMER_PATTERNS = (
    "본 내용은 교육 목적",
    "투자 조언이 아님",
    "투자 조언이 아닌",
    "투자 권유가 아님",
    "투자 권유 아님",
    "참고용이며",
    "교육 목적으로 제공",
)


def _load_dotenv() -> None:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)


def _gemini_api_key() -> str:
    _load_dotenv()
    return (
        os.environ.get("GEMINI_API_KEY", "").strip()
        or os.environ.get("GOOGLE_API_KEY", "").strip()
    )


def _gemini_model() -> str:
    return (
        os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip()
        or DEFAULT_GEMINI_MODEL
    )


def _strip_disclaimer(brief: str) -> str:
    lines = [line.strip() for line in brief.split("\n") if line.strip()]
    while lines:
        last = lines[-1]
        if any(pattern in last for pattern in DISCLAIMER_PATTERNS):
            lines.pop()
        else:
            break
    return "\n".join(lines)


def _parse_llm_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _call_gemini_json(prompt: str) -> dict[str, Any]:
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    url = f"{GEMINI_API_ROOT}/{_gemini_model()}:generateContent"
    response = requests.post(
        url,
        params={"key": api_key},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.35,
                "responseMimeType": "application/json",
            },
        },
        timeout=90,
    )
    if not response.ok:
        raise RuntimeError(f"Gemini HTTP {response.status_code}: {response.text[:300]}")

    payload = response.json()
    candidates = payload.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned no candidates")

    parts_out = candidates[0].get("content", {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts_out if part.get("text"))
    if not text:
        raise RuntimeError("Gemini returned empty text")
    return _parse_llm_json(text)


def _normalize_three_paragraphs(brief: str) -> str:
    """Force a 3-paragraph shape when the model returns lines or more blocks."""
    text = _strip_disclaimer(brief).strip()
    if not text:
        return ""

    # Prefer blank-line separated paragraphs.
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) >= 3:
        return "\n\n".join(paras[:3])

    # Fall back to single newlines → join into up to 3 blocks.
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if len(lines) >= 3:
        # If many short lines, fold into thirds.
        if len(lines) > 3:
            n = len(lines)
            a, b = max(1, n // 3), max(2, (2 * n) // 3)
            return "\n\n".join(
                [
                    " ".join(lines[:a]),
                    " ".join(lines[a:b]),
                    " ".join(lines[b:]),
                ]
            )
        return "\n\n".join(lines[:3])

    if len(lines) == 2:
        return "\n\n".join(lines + ["변동성 구간에서는 추격보다 선별과 리스크 관리가 우선입니다."])
    if len(lines) == 1:
        return "\n\n".join(
            [
                lines[0],
                "업종·종목 간 온도 차가 크므로 개별 수급과 뉴스를 함께 확인할 필요가 있습니다.",
                "단기 모멘텀보다 핵심 이슈를 기준으로 관심 종목을 정리하는 접근이 유리해 보입니다.",
            ]
        )
    return ""


def format_brief_paragraphs(brief: str, *, blank_lines: int = 2) -> str:
    """Join paragraphs with extra blank lines for Telegram / plain-text display."""
    text = _strip_disclaimer(brief).strip()
    if not text:
        return ""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) <= 1:
        paras = [ln.strip() for ln in text.split("\n") if ln.strip()]
    sep = "\n" * (max(1, blank_lines) + 1)
    return sep.join(paras)


def brief_paragraphs_html(brief: str, *, esc=None) -> str:
    """Render briefing paragraphs as spaced HTML ``<p>`` blocks."""
    escape = esc or (lambda s: s)
    text = _strip_disclaimer(brief).strip()
    if not text:
        return ""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) <= 1:
        paras = [ln.strip() for ln in text.split("\n") if ln.strip()]
    return "".join(
        f'<p class="brief-para">{escape(p)}</p>' for p in paras
    )


def _truncate(text: str, limit: int = MAX_CONTEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 20] + "\n…(truncated)"


def pack_kor_summary_context(summary: dict, chart_notes_ko: dict | None = None) -> dict[str, Any]:
    """Build a market-agnostic briefing payload from a Korea summary dict."""
    from kr_names import format_kr_ticker_label

    chart_notes_ko = chart_notes_ko or (summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}
    board_lines: list[str] = []
    for universe in summary.get("universes") or []:
        name = universe.get("name") or universe.get("key") or ""
        board_lines.append(f"[{name}]")
        boards = universe.get("boards") or {}
        for mode, title in (
            ("surge", "상승+거래대금 급증"),
            ("dropvol", "하락+거래대금 급증"),
        ):
            rows = (boards.get(mode) or {}).get("top") or []
            board_lines.append(f"  {title}:")
            if not rows:
                board_lines.append("    (없음)")
                continue
            for idx, row in enumerate(rows[:8], start=1):
                if isinstance(row, (list, tuple)) and len(row) >= 2:
                    ticker, metric = row[0], row[1]
                else:
                    ticker, metric = row, ""
                label = format_kr_ticker_label(str(ticker))
                board_lines.append(f"    {idx}. {label}  {metric}")
        leader = universe.get("leader_ticker")
        if leader:
            board_lines.append(f"  leader: {format_kr_ticker_label(str(leader))}")
        note = (chart_notes_ko.get(universe.get("key") or "") or "").strip()
        if note:
            board_lines.append(f"  chart_note: {note}")
        board_lines.append("")

    news_items: list[dict[str, str]] = []
    news_by_ticker = summary.get("news_by_ticker") or {}
    for ticker, headlines in news_by_ticker.items():
        label = format_kr_ticker_label(str(ticker))
        for item in (headlines or [])[:3]:
            title = (item.get("title") or "").strip()
            if not title:
                continue
            news_items.append(
                {
                    "ticker": label,
                    "title": title,
                    "source": str(item.get("source") or "Naver"),
                    "date": str(item.get("date") or ""),
                }
            )

    dart_lines: list[str] = []
    for ukey, pack in (summary.get("dart_by_universe") or {}).items():
        if not isinstance(pack, dict) or pack.get("error"):
            continue
        corp = pack.get("corp_name") or pack.get("leader_ticker") or ukey
        metrics = pack.get("metrics") or {}
        bits = [f"DART {corp}"]
        if pack.get("text_summary"):
            bits.append(str(pack["text_summary"])[:400])
        elif metrics:
            bits.append(str(metrics)[:400])
        dart_lines.append(" — ".join(bits))

    intraday = bool(summary.get("intraday"))
    title = (
        "국내 장중 시황 (/summary_kor_intra)"
        if intraday
        else "국내 마감 시황 (/summary_kor)"
    )
    extra_parts = [
        f"price_source: {summary.get('price_source', '')}",
        f"news_source: {summary.get('news_source', 'naver')}",
        f"ticker_count: {summary.get('ticker_count', 0)}",
    ]
    if dart_lines:
        extra_parts.append("DART leaders:\n" + "\n".join(dart_lines))

    return {
        "market": "kr",
        "title": title,
        "generated_at": str(summary.get("generated_at_display") or summary.get("generated_at") or ""),
        "boards_text": "\n".join(board_lines).strip(),
        "chart_notes": chart_notes_ko,
        "news_items": news_items,
        "extra_context": "\n".join(extra_parts),
    }


def _build_prompt(payload: dict[str, Any]) -> str:
    market = str(payload.get("market") or "kr").lower()
    market_label = MARKET_LABELS.get(market, market)
    title = payload.get("title") or market_label
    generated_at = payload.get("generated_at") or ""
    boards_text = (payload.get("boards_text") or "").strip() or "(보드 데이터 없음)"
    chart_notes = payload.get("chart_notes") or {}
    if isinstance(chart_notes, dict):
        notes_text = "\n".join(
            f"- {k}: {v}" for k, v in chart_notes.items() if str(v).strip()
        ) or "(차트 노트 없음)"
    else:
        notes_text = str(chart_notes).strip() or "(차트 노트 없음)"

    news_items = payload.get("news_items") or []
    news_lines: list[str] = []
    for idx, item in enumerate(news_items[:40], start=1):
        if isinstance(item, dict):
            ticker = item.get("ticker") or item.get("symbol") or ""
            headline = item.get("title") or item.get("headline") or ""
            source = item.get("source") or ""
            date = item.get("date") or item.get("published") or ""
            news_lines.append(
                f"{idx}. [{ticker}] {headline} ({source}{', ' + date if date else ''})"
            )
        else:
            news_lines.append(f"{idx}. {item}")
    news_text = "\n".join(news_lines) if news_lines else "(뉴스 없음)"
    extra = (payload.get("extra_context") or "").strip() or "(추가 컨텍스트 없음)"

    context = _truncate(
        f"""MARKET: {market_label} ({market})
TITLE: {title}
AS_OF: {generated_at}

BOARDS / RANKINGS:
{boards_text}

CHART NOTES:
{notes_text}

CRAWLED NEWS:
{news_text}

EXTRA:
{extra}
"""
    )

    return f"""You are a financial market analyst writing a Korean market briefing for retail investors.

Using ONLY the freshly generated data below (rankings/boards, chart notes, crawled news, extras), write a {market_label} commentary.

Return JSON only:
{{
  "market_brief_ko": "Exactly 3 paragraphs in Korean, separated by blank lines (\\n\\n). Paragraph 1 = overall market tone from boards/flows. Paragraph 2 = key movers and news themes. Paragraph 3 = practical stance (selectivity / risk control — NOT a buy/sell order)."
}}

Rules:
- Write ALL text in Korean.
- Exactly 3 paragraphs (no bullets, no numbering, no markdown).
- Synthesize; do not list every ticker or headline.
- Be concrete when the data supports it (sectors, leaders, surge/drop names).
- Do not invent numbers that are not in the data.
- Do not end with a legal disclaimer or "투자 조언이 아님" line.

DATA:
{context}
"""


def _rule_based_brief(payload: dict[str, Any]) -> str:
    market = str(payload.get("market") or "kr").lower()
    label = MARKET_LABELS.get(market, "시황")
    news_items = payload.get("news_items") or []
    themes: list[str] = []
    for item in news_items[:5]:
        if isinstance(item, dict):
            title = str(item.get("title") or "").strip()
            if title:
                themes.append(title[:80])
        elif str(item).strip():
            themes.append(str(item)[:80])

    boards = (payload.get("boards_text") or "").strip()
    mover_hint = ""
    for line in boards.splitlines():
        stripped = line.strip()
        if stripped[:1].isdigit() and "." in stripped:
            mover_hint = stripped
            break

    p1 = (
        f"{label} 기준으로 보면 거래대금이 실린 종목 중심의 차별화 장세가 이어지는 흐름입니다."
        + (f" 대표적으로 {mover_hint} 등이 보드 상단에 위치합니다." if mover_hint else "")
    )
    if themes:
        p2 = (
            "뉴스 측면에서는 "
            + ", ".join(themes[:3])
            + " 등 이슈가 동시에 거론되며, 업종·종목 간 온도 차가 큽니다."
        )
    else:
        p2 = (
            "수집된 헤드라인이 제한적이라 뉴스 해석 여지는 좁지만, "
            "보드상 수급·등락 신호를 우선해 해석하는 편이 안전합니다."
        )
    p3 = (
        "단기 추격보다는 거래대금·뉴스·차트 노트가 겹치는 종목을 선별하고 "
        "변동성 구간에서는 비중과 리스크 관리를 우선하는 접근이 필요해 보입니다."
    )
    return "\n\n".join([p1, p2, p3])


def generate_data_briefing(payload: dict[str, Any] | None = None, **kwargs: Any) -> dict[str, Any]:
    """Generate a 3-paragraph Korean briefing from structured market data.

    Accepts either a single ``payload`` dict or keyword fields:
    market, title, generated_at, boards_text, chart_notes, news_items, extra_context.
    """
    data: dict[str, Any] = dict(payload or {})
    data.update({k: v for k, v in kwargs.items() if v is not None})
    market = str(data.get("market") or "kr").lower()
    data["market"] = market

    news_items = data.get("news_items") or []
    article_count = len(news_items) if isinstance(news_items, list) else 0

    try:
        if _gemini_api_key():
            parsed = _call_gemini_json(_build_prompt(data))
            brief = _normalize_three_paragraphs(str(parsed.get("market_brief_ko", "")))
            if not brief:
                raise RuntimeError("Empty market_brief_ko from Gemini")
            return {
                "market_brief_ko": brief,
                "source": "gemini",
                "article_count": article_count,
                "market": market,
                "market_label": MARKET_LABELS.get(market, market),
                "title": data.get("title") or MARKET_LABELS.get(market, market),
                "generated_at": data.get("generated_at") or "",
            }
    except Exception as exc:
        return {
            "market_brief_ko": _normalize_three_paragraphs(_rule_based_brief(data)),
            "source": "rules",
            "article_count": article_count,
            "market": market,
            "market_label": MARKET_LABELS.get(market, market),
            "title": data.get("title") or MARKET_LABELS.get(market, market),
            "generated_at": data.get("generated_at") or "",
            "error": str(exc),
        }

    return {
        "market_brief_ko": _normalize_three_paragraphs(_rule_based_brief(data)),
        "source": "rules",
        "article_count": article_count,
        "market": market,
        "market_label": MARKET_LABELS.get(market, market),
        "title": data.get("title") or MARKET_LABELS.get(market, market),
        "generated_at": data.get("generated_at") or "",
        "error": "GEMINI_API_KEY not set",
    }


def generate_data_briefing_from_kor_summary(
    summary: dict,
    *,
    chart_notes_ko: dict | None = None,
) -> dict[str, Any]:
    """Convenience wrapper used at the end of ``/summary_kor``."""
    payload = pack_kor_summary_context(summary, chart_notes_ko=chart_notes_ko)
    return generate_data_briefing(payload)


def pack_us_summary_context(summary: dict, chart_notes_ko: dict | None = None) -> dict[str, Any]:
    """Build a briefing payload from the US ``/summary`` market dict."""
    from news_crawler import _display_ticker_label

    chart_notes_ko = chart_notes_ko or (summary.get("ai_analysis") or {}).get("chart_notes_ko") or {}
    board_lines: list[str] = []
    for universe in summary.get("universes") or []:
        ukey = universe.get("key") or ""
        name = universe.get("name") or ukey
        board_lines.append(f"[{name}]")
        boards = universe.get("boards") or {}
        for mode, title in (
            ("surge", "Price up + volume surge"),
            ("dropvol", "Price down + volume surge"),
        ):
            rows = (boards.get(mode) or {}).get("top") or []
            board_lines.append(f"  {title}:")
            if not rows:
                board_lines.append("    (empty)")
                continue
            for idx, row in enumerate(rows[:8], start=1):
                if isinstance(row, (list, tuple)) and len(row) >= 2:
                    ticker, metric = row[0], row[1]
                else:
                    ticker, metric = row, ""
                label = _display_ticker_label(str(ticker), ukey if ukey == "etf" else None)
                board_lines.append(f"    {idx}. {label}  {metric}")
        leader = universe.get("leader_ticker")
        if leader:
            board_lines.append(
                f"  leader: {_display_ticker_label(str(leader), ukey if ukey == 'etf' else None)}"
            )
        note = (chart_notes_ko.get(ukey) or "").strip()
        if note:
            board_lines.append(f"  chart_note: {note}")
        board_lines.append("")

    news_items: list[dict[str, str]] = []
    ticker_universe = summary.get("ticker_universe") or {}
    for ticker, headlines in (summary.get("news_by_ticker") or {}).items():
        ukey = ticker_universe.get(ticker)
        label = _display_ticker_label(str(ticker), ukey if ukey == "etf" else None)
        for item in (headlines or [])[:3]:
            title = (item.get("title") or "").strip()
            if not title:
                continue
            news_items.append(
                {
                    "ticker": label,
                    "title": title,
                    "source": str(item.get("source") or item.get("publisher") or ""),
                    "date": str(item.get("date") or item.get("published") or ""),
                }
            )

    extra_parts = [
        f"ticker_count: {summary.get('ticker_count', 0)}",
        f"universes: {', '.join(u.get('key', '') for u in (summary.get('universes') or []))}",
    ]
    heatmap = summary.get("heatmap_sp") or {}
    if heatmap.get("caption"):
        extra_parts.append(f"heatmap: {heatmap.get('caption')}")
    elif heatmap.get("error"):
        extra_parts.append(f"heatmap_error: {heatmap.get('error')}")

    macro = summary.get("macro") or {}
    if macro.get("caption"):
        extra_parts.append(f"macro: {macro.get('caption')}")
    if macro.get("ai_comment") or macro.get("macro_brief_ko"):
        extra_parts.append(
            f"macro_ai: {macro.get('ai_comment') or macro.get('macro_brief_ko')}"
        )
    if macro.get("error"):
        extra_parts.append(f"macro_error: {macro.get('error')}")

    crypto = summary.get("crypto") or {}
    for symbol in ("BTC", "ETH"):
        entry = crypto.get(symbol) or {}
        if entry.get("label") or entry.get("chart_error"):
            extra_parts.append(
                f"crypto_{symbol}: {entry.get('label') or symbol}"
                + (f" ({entry.get('chart_error')})" if entry.get("chart_error") else "")
            )

    return {
        "market": "us",
        "title": "미국 시황 (/summary)",
        "generated_at": str(summary.get("generated_at_display") or summary.get("generated_at") or ""),
        "boards_text": "\n".join(board_lines).strip(),
        "chart_notes": chart_notes_ko,
        "news_items": news_items,
        "extra_context": "\n".join(extra_parts),
    }


def generate_data_briefing_from_us_summary(
    summary: dict,
    *,
    chart_notes_ko: dict | None = None,
) -> dict[str, Any]:
    """Convenience wrapper used at the end of ``/summary``."""
    payload = pack_us_summary_context(summary, chart_notes_ko=chart_notes_ko)
    return generate_data_briefing(payload)


def format_data_briefing_telegram(
    briefing: dict[str, Any],
    *,
    include_meta: bool = True,
) -> list[dict]:
    brief_ko = format_brief_paragraphs(str(briefing.get("market_brief_ko", "")), blank_lines=2)
    if not brief_ko:
        return [{"text": "데이터 브리핑을 생성하지 못했습니다 (빈 결과)."}]

    label = briefing.get("market_label") or MARKET_LABELS.get(
        str(briefing.get("market") or "kr"), "시황"
    )
    source = briefing.get("source", "rules")
    article_count = briefing.get("article_count", 0)
    header = f"📝 데이터 브리핑 · {label}\n"
    if include_meta:
        if briefing.get("error") and source == "rules":
            header += "(Gemini unavailable — data fallback)\n"
        header += f"출처: {source} | 참고 뉴스 {article_count}건\n"
        if briefing.get("generated_at"):
            header += f"기준: {briefing['generated_at']}\n"
        header += "\n"
    return [{"text": header + brief_ko}]

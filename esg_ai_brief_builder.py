"""Weekly AI governance data briefing → NEW brief slot ``esg_ai_gov_brief``.

Does not touch esg_monitor / esg_overview / esg_accident / esg_data_briefing.
"""

from __future__ import annotations

import html as html_lib
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from data_briefing import (
    format_brief_paragraphs,
    format_data_briefing_telegram,
    generate_data_briefing,
)

KST = ZoneInfo("Asia/Seoul")


def _pack_ai_gov_brief_context(screen: dict[str, Any]) -> dict[str, Any]:
    board: list[str] = ["[AI Governance Screen]"]
    dart = screen.get("dart") or {}
    board.append(
        f"  DART hits={dart.get('hit_count') or len(dart.get('hits') or [])} "
        f"days={dart.get('days')} query={dart.get('query') or 'market'}"
    )
    for hit in (dart.get("hits") or [])[:8]:
        if isinstance(hit, dict):
            board.append(
                f"    {hit.get('date')} {hit.get('corp_name')} — {hit.get('report_nm')}"
            )

    sec = screen.get("sec") or {}
    board.append(
        f"  SEC cyber filings window={sec.get('window_days')} "
        f"count≈{sec.get('filing_count')} sample={len(sec.get('filings') or [])}"
    )
    for filing in (sec.get("filings") or [])[:5]:
        if isinstance(filing, dict):
            board.append(
                f"    {filing.get('file_date')} {filing.get('company')} "
                f"[{filing.get('item_summary') or filing.get('items')}]"
            )

    policy = (screen.get("policy") or {}).get("events") or []
    if policy:
        board.append("  Policy calendar:")
        for ev in policy[:6]:
            board.append(
                f"    {ev.get('date')} [{ev.get('region')}] {ev.get('title')} "
                f"({ev.get('status')}, {ev.get('days_from_today')}d)"
            )

    news_items: list[dict[str, str]] = []
    for block in (screen.get("naver"), screen.get("finnhub")):
        for h in (block or {}).get("headlines") or []:
            if not isinstance(h, dict):
                continue
            title = (h.get("headline") or "").strip()
            if not title:
                continue
            news_items.append(
                {
                    "title": title,
                    "source": str(h.get("source") or ""),
                    "published": str(h.get("published") or ""),
                }
            )

    chart_notes = {
        "lens": "AI transformation vs AI governance for ETF investors",
        "reg": "Use KR AI Basic Act / EU AI Act only when calendar or news supports it",
        "dart": "Do not invent DART filings; quote only provided hits",
    }
    errors = screen.get("errors") or []
    if errors:
        chart_notes["gaps"] = "; ".join(str(e) for e in errors[:4])

    return {
        "market": "esg",
        "title": "AI 거버넌스 주간 브리프",
        "generated_at": screen.get("generated_at")
        or datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "boards_text": "\n".join(board),
        "news_items": news_items[:16],
        "chart_notes": chart_notes,
        "extra_context": (
            "Write three Korean paragraphs for investors: "
            "(1) AI transformation market tone, "
            "(2) governance/privacy/cyber disclosure & regulation, "
            "(3) what to watch next week. No investment advice."
        ),
    }


def generate_ai_gov_briefing(*, publish: bool = True, query: str | None = None) -> dict[str, Any]:
    from ai_gov_screen import build_ai_gov_screen

    screen = build_ai_gov_screen(query=query)
    payload = _pack_ai_gov_brief_context(screen)
    briefing = generate_data_briefing(payload)

    messages = format_data_briefing_telegram(briefing)
    result: dict[str, Any] = {
        "kind": "ai_gov_briefing",
        "generated_at": payload.get("generated_at"),
        "screen": screen,
        "briefing": briefing,
        "telegram_messages": messages,
        "market_brief_ko": format_brief_paragraphs(
            str(briefing.get("market_brief_ko") or ""),
            blank_lines=2,
        ),
    }

    if publish:
        try:
            from web_publish import publish_brief, section_from_html

            brief_html = "".join(
                f"<p>{html_lib.escape(p)}</p>"
                for p in (briefing.get("market_brief_ko") or "").split("\n\n")
                if p.strip()
            )
            # NEW slot only — never overwrite esg_data_briefing / accident / etc.
            publish_brief(
                "esg",
                "esg_ai_gov_brief",
                title="AI 거버넌스 주간 브리프",
                generated_at=payload.get("generated_at"),
                sections=section_from_html(
                    brief_html or (briefing.get("market_brief_ko") or ""),
                    heading="AI governance weekly brief",
                ),
                meta={
                    "source": briefing.get("source"),
                    "dart_hits": (screen.get("dart") or {}).get("hit_count"),
                    "sec_count": (screen.get("sec") or {}).get("filing_count"),
                    "lens": "ai_governance",
                },
            )
        except Exception as pub_exc:
            print(f"web_publish esg_ai_gov_brief skipped: {pub_exc}")

    return result

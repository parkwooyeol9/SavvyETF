"""Pipeline for /esg Telegram command."""

from __future__ import annotations

from typing import Any

from esg_data import (
    ESG_HELP,
    build_esg_accident_profile,
    build_esg_ai_gov_profile,
    build_esg_div_profile,
    build_esg_fin_profile,
    build_esg_overview_profile,
    build_esg_own_profile,
    build_esg_return_profile,
    format_esg_accident_telegram,
    format_esg_ai_gov_telegram,
    format_esg_div_telegram,
    format_esg_fin_telegram,
    format_esg_overview_telegram,
    format_esg_own_telegram,
    format_esg_return_telegram,
)

MODES = {
    "fin": "fin",
    "financial": "fin",
    "실적": "fin",
    "재무": "fin",
    "div": "div",
    "dividend": "div",
    "배당": "div",
    "own": "own",
    "ownership": "own",
    "소유": "own",
    "지분": "own",
    "return": "return",
    "returns": "return",
    "환원": "return",
    "자사주": "return",
    "accident": "accident",
    "accidents": "accident",
    "중대재해": "accident",
    "재해": "accident",
    "aigov": "aigov",
    "ai-gov": "aigov",
    "ai_gov": "aigov",
    "인공지능": "aigov",
    "개인정보": "aigov",
    "보안": "aigov",
    "aibrief": "aibrief",
    "ai-brief": "aibrief",
    "ai_brief": "aibrief",
    "monitor": "monitor",
    "climate": "monitor",
    "기후": "monitor",
    "기후리스크": "monitor",
    "overview": "overview",
    "all": "overview",
    "요약": "overview",
}

# Modes that do not require a company query.
OPTIONAL_QUERY_MODES = {"accident", "monitor", "aigov", "aibrief"}


def is_esg_command(command: str) -> bool:
    token = command.strip().split()[0].lower() if command.strip() else ""
    return token in {"/esg", "/esg분석", "/governance"}


def parse_esg_command(command: str) -> tuple[str, str | None]:
    """
    Return (mode, query).

    /esg                         → help
    /esg help                    → help
    /esg 삼성전자                 → overview, 삼성전자
    /esg fin 삼성전자             → fin, 삼성전자
    /esg accident                → accident, None
    /esg accident 삼성전자        → accident, 삼성전자
    /esg aigov                   → aigov, None
    /esg aibrief                 → aibrief, None
    /esg monitor                 → monitor, None
    """
    parts = command.strip().split()
    if len(parts) < 2:
        return "help", None

    first = parts[1].lower()
    if first in {"help", "도움", "?", "h"}:
        return "help", None

    if first in MODES:
        mode = MODES[first]
        query = " ".join(parts[2:]).strip() or None
        if mode not in OPTIONAL_QUERY_MODES and not query:
            raise ValueError(f"Usage: /esg {first} <기업명|종목코드>")
        return mode, query

    # Treat remainder as company query → overview
    query = " ".join(parts[1:]).strip()
    if not query:
        return "help", None
    return "overview", query


def run_esg(
    mode: str,
    query: str | None = None,
    *,
    publish: bool = True,
) -> dict[str, Any]:
    if mode == "help":
        return {
            "mode": "help",
            "telegram_messages": [{"text": ESG_HELP, "parse_mode": "HTML"}],
        }

    if mode == "fin":
        profile = build_esg_fin_profile(query or "")
        text = format_esg_fin_telegram(profile)
    elif mode == "div":
        profile = build_esg_div_profile(query or "")
        text = format_esg_div_telegram(profile)
    elif mode == "own":
        profile = build_esg_own_profile(query or "")
        text = format_esg_own_telegram(profile)
    elif mode == "return":
        profile = build_esg_return_profile(query or "")
        text = format_esg_return_telegram(profile)
    elif mode == "accident":
        profile = build_esg_accident_profile(query)
        text = format_esg_accident_telegram(profile)
    elif mode == "aigov":
        profile = build_esg_ai_gov_profile(query)
        text = format_esg_ai_gov_telegram(profile)
    elif mode == "aibrief":
        from esg_ai_brief_builder import generate_ai_gov_briefing

        return generate_ai_gov_briefing(publish=publish, query=query)
    elif mode == "overview":
        profile = build_esg_overview_profile(query or "")
        text = format_esg_overview_telegram(profile)
    elif mode == "monitor":
        from climate_pipeline import run_climate_monitor

        return run_climate_monitor(publish=publish)
    else:
        raise ValueError(f"Unknown /esg mode: {mode}")

    result = {
        "mode": mode,
        "profile": profile,
        "text_summary": text,
        "telegram_messages": [{"text": text, "parse_mode": "HTML"}],
    }

    # Dashboard slots — only NEW aigov slot or existing accident/overview.
    # Never rewrite sibling slots.
    if publish and mode in {"accident", "overview", "aigov"}:
        try:
            from web_publish import publish_brief, section_from_html

            if mode == "accident":
                slot = "esg_accident"
                title = "거버넌스·안전 공시 · /esg accident"
            elif mode == "aigov":
                slot = "esg_ai_gov"
                title = "AI·개인정보·보안 공시 · /esg aigov"
            else:
                slot = "esg_overview"
                title = f"거버넌스 품질 스크린 · /esg {query or 'overview'}"
            publish_brief(
                "esg",
                slot,
                title=title,
                generated_at=profile.get("generated_at"),
                sections=section_from_html(text, heading=title),
                meta={"mode": mode, "query": query},
            )
        except Exception as pub_exc:
            print(f"web_publish esg/{mode} skipped: {pub_exc}")

    return result

"""Korean AI macro risk commentary for /macro."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import requests

from macro_scores import StressResult

GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

DISCLAIMER_PATTERNS = (
    "본 내용은 교육 목적",
    "투자 조언이 아님",
    "투자 권유",
    "참고용이며",
)


def _load_dotenv() -> None:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)


def _gemini_api_key() -> str:
    _load_dotenv()
    return os.environ.get("GEMINI_API_KEY", "").strip() or os.environ.get("GOOGLE_API_KEY", "").strip()


def _gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL


def _strip_disclaimer(text: str) -> str:
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    while lines:
        if any(p in lines[-1] for p in DISCLAIMER_PATTERNS):
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


def _call_gemini_text(prompt: str) -> dict[str, Any]:
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


def _build_macro_context(bundle: dict, stress: StressResult) -> str:
    snap = bundle.get("snapshot") or {}
    lines = [
        f"As of: {snap.get('as_of', '')}",
        f"Stress score: {stress.score}/100 — {stress.regime}",
        (
            "Components: "
            f"curve={stress.components.get('curve'):.0f}, "
            f"credit={stress.components.get('credit'):.0f}, "
            f"volatility={stress.components.get('volatility'):.0f}, "
            f"risk_appetite={stress.components.get('risk_appetite'):.0f}"
        ),
        f"Key drivers: {' | '.join(stress.drivers)}",
        "",
        "Snapshot:",
        f"- 10Y Treasury: {snap.get('DGS10')}%",
        f"- 2Y Treasury: {snap.get('DGS2')}%",
        f"- 10Y-2Y spread: {snap.get('T10Y2Y')}%",
        f"- HY OAS: {snap.get('HY_OAS')}%",
        f"- IG OAS: {snap.get('IG_OAS')}%",
        f"- VIX: {snap.get('VIX')}",
        f"- S&P 500 20d: {snap.get('SPY_20D')}%",
        f"- HYG/TLT 20d: {snap.get('HYG_TLT_20D')}%",
    ]

    finnhub = bundle.get("finnhub") or {}
    if finnhub.get("available"):
        upcoming = finnhub.get("high_impact_upcoming") or []
        lines.append(f"- Finnhub high-impact US events ahead: {len(upcoming)}")
        for event in upcoming[:3]:
            lines.append(f"  * {event.get('date')} {event.get('event')}")

    edgar = bundle.get("edgar") or {}
    pulse = edgar.get("pulse") or {}
    if pulse.get("filing_count"):
        lines.append(f"- SEC 8-K filings (7d): {pulse.get('filing_count')}")
    mentions = (edgar.get("macro_mentions") or {}).get("mention_count")
    if mentions:
        lines.append(f"- SEC macro-theme mentions (14d): {mentions}")

    return "\n".join(lines)


def _rule_based_macro_brief(stress: StressResult, bundle: dict) -> str:
    snap = bundle.get("snapshot") or {}
    if stress.score >= 75:
        tone = "현재 매크로 스트레스는 높은 편으로, 변동성·신용·금리 리스크가 동시에 부각된 환경입니다."
        stance = "포지션 축소와 방어적 섹터 비중, 현금·헤지 여력 확보가 우선입니다."
    elif stress.score >= 55:
        tone = "매크로 환경은 중간 이상의 스트레스 구간으로, 일부 지표에서 경계 신호가 관측됩니다."
        stance = "추격 매수보다 선별적 접근과 분할 매수, 이벤트 리스크 관리가 필요합니다."
    elif stress.score >= 35:
        tone = "전반적으로는 경계 구간이지만, 아직 전면적인 스트레스 국면은 아닙니다."
        stance = "핵심 지표(금리 곡선, 신용 스프레드, VIX)를 보며 대응하는 것이 좋습니다."
    else:
        tone = "현재 매크로 스트레스는 낮은 수준으로, 시장은 비교적 안정적인 국면에 가깝습니다."
        stance = "리스크 관리 전제 하에 보유 비중을 유지하되, 과도한 레버리지는 피하는 편이 낫습니다."

    driver = stress.drivers[0] if stress.drivers else "특이 신호 제한적"
    vix = snap.get("VIX")
    spread = snap.get("T10Y2Y")
    line3 = f"주요 신호: {driver}"
    if vix is not None:
        line3 += f" | VIX {vix:.1f}"
    if spread is not None:
        line3 += f" | 10Y-2Y {spread:+.2f}%"

    return "\n".join([tone, line3, stance])


def generate_macro_ai_brief(bundle: dict, stress: StressResult) -> dict[str, Any]:
    context = _build_macro_context(bundle, stress)
    prompt = f"""You are a macro strategist writing for Korean retail investors.

Using the macro risk dashboard data below, return JSON only:
{{
  "macro_brief_ko": "Exactly 3-4 lines in Korean separated by \\\\n. Explain: (1) current macro risk environment level in plain language (calm/caution/elevated/high stress), (2) the 1-2 most important drivers from the data, (3) practical portfolio stance for the next few weeks (risk control, selectivity, patience — NOT specific buy/sell orders). Do NOT add legal disclaimers."
}}

DATA:
{context}
"""

    try:
        if _gemini_api_key():
            parsed = _call_gemini_text(prompt)
            brief = _strip_disclaimer(str(parsed.get("macro_brief_ko", "")).strip())
            if brief:
                return {"macro_brief_ko": brief, "source": "gemini"}
    except Exception as exc:
        fallback = {
            "macro_brief_ko": _rule_based_macro_brief(stress, bundle),
            "source": "rules",
            "error": str(exc),
        }
        return fallback

    return {
        "macro_brief_ko": _rule_based_macro_brief(stress, bundle),
        "source": "rules",
    }


def format_macro_ai_telegram(ai_brief: dict[str, Any]) -> str:
    text = str(ai_brief.get("macro_brief_ko", "")).strip()
    if not text:
        return ""
    source = ai_brief.get("source", "rules")
    header = "🤖 AI 매크로 리스크 코멘트 (한국어)\n"
    if ai_brief.get("error") and source == "rules":
        header += "(Gemini unavailable — rule-based fallback)\n"
    header += f"출처: {source}\n\n"
    return header + text

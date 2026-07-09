"""Gemini ETF comparison recommendation for /comp."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import requests

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


def _fmt_money(value: float | None) -> str:
    if value is None:
        return "n/a"
    if abs(value) >= 1_000_000_000_000:
        return f"${value / 1_000_000_000_000:.2f}T"
    if abs(value) >= 1_000_000_000:
        return f"${value / 1_000_000_000:.2f}B"
    if abs(value) >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    return f"${value:,.0f}"


def _build_comparison_context(comparison: dict[str, Any]) -> str:
    lines = [
        f"Tickers: {', '.join(comparison.get('symbols') or [])}",
        f"Generated: {comparison.get('generated_at', '')}",
        "",
        "Profiles:",
    ]
    for profile in comparison.get("profiles") or []:
        lines.append(f"- {profile['symbol']}: {profile.get('name', '')}")
        lines.append(
            f"  AUM {_fmt_money(profile.get('aum_usd'))} | "
            f"ER {profile.get('expense_ratio_pct')}% | "
            f"Div yield {profile.get('dividend_yield_pct')}%"
        )
        lines.append(
            f"  Premium/disc {profile.get('premium_discount_pct')}% | "
            f"1Y {profile.get('return_1y_pct')}% | YTD {profile.get('return_ytd_pct')}%"
        )
        lines.append(
            f"  Avg $ vol 21D {_fmt_money(profile.get('avg_dollar_volume_21d'))} | "
            f"Beta {profile.get('beta_3y')}"
        )
        if profile.get("price_source") == "index_proxy":
            lines.append(
                f"  Chart uses index proxy {profile.get('price_proxy')} "
                f"(ETF history {profile.get('history_trading_days')}d)"
            )
        if profile.get("benchmark"):
            lines.append(f"  Benchmark: {profile.get('benchmark')}")

    performance = comparison.get("performance") or {}
    latest = performance.get("latest_values") or {}
    if latest:
        lines.append("")
        lines.append("Normalized performance (latest index level, base=100):")
        for symbol, value in latest.items():
            lines.append(f"  {symbol}: {value:.1f}")

    overlap = comparison.get("overlap")
    if overlap is not None and not overlap.empty:
        lines.append("")
        lines.append("Holdings overlap:")
        for _, row in overlap.iterrows():
            lines.append(
                f"  {row['etf_a']} vs {row['etf_b']}: "
                f"{row['overlap_weight_pct']}% weight overlap, "
                f"{row['common_holdings']} common names"
            )

    return "\n".join(lines)


def _score_profile(profile: dict[str, Any], profiles: list[dict[str, Any]]) -> float:
    score = 0.0

    er = profile.get("expense_ratio_pct")
    if er is not None:
        ers = [p["expense_ratio_pct"] for p in profiles if p.get("expense_ratio_pct") is not None]
        if ers:
            score += 30 * (1 - (er - min(ers)) / max(max(ers) - min(ers), 0.0001))

    dv = profile.get("avg_dollar_volume_21d")
    if dv is not None:
        dvs = [p["avg_dollar_volume_21d"] for p in profiles if p.get("avg_dollar_volume_21d")]
        if dvs:
            score += 25 * (dv - min(dvs)) / max(max(dvs) - min(dvs), 1)

    aum = profile.get("aum_usd")
    if aum is not None:
        aums = [p["aum_usd"] for p in profiles if p.get("aum_usd")]
        if aums:
            score += 15 * (aum - min(aums)) / max(max(aums) - min(aums), 1)

    prem = profile.get("premium_discount_pct")
    if prem is not None:
        prems = [abs(p["premium_discount_pct"]) for p in profiles if p.get("premium_discount_pct") is not None]
        if prems:
            score += 10 * (1 - (abs(prem) - min(prems)) / max(max(prems) - min(prems), 0.0001))

    ret = profile.get("return_1y_pct")
    if ret is not None:
        rets = [p["return_1y_pct"] for p in profiles if p.get("return_1y_pct") is not None]
        if rets:
            score += 20 * (ret - min(rets)) / max(max(rets) - min(rets), 0.0001)

    return score


def _rule_based_recommendation(comparison: dict[str, Any]) -> dict[str, Any]:
    profiles = comparison.get("profiles") or []
    if not profiles:
        return {"pick": "", "commentary_ko": "비교할 ETF 데이터가 없습니다.", "source": "rules"}

    ranked = sorted(profiles, key=lambda p: _score_profile(p, profiles), reverse=True)
    pick = ranked[0]
    runner = ranked[1] if len(ranked) > 1 else None

    lines = [
        f"비용·유동성·규모·수익률을 종합하면 <b>{pick['symbol']}</b>이(가) 상대적으로 유리해 보입니다.",
    ]
    if pick.get("expense_ratio_pct") is not None:
        lines.append(f"총보수 {pick['expense_ratio_pct']:.2f}%와 거래 유동성을 감안한 선택입니다.")
    if runner:
        lines.append(
            f"대안으로 <b>{runner['symbol']}</b>도 검토할 만하나, "
            f"지수가 다르거나 보유 목적(성장 vs 대형주)에 따라 우선순위가 달라질 수 있습니다."
        )
    if len(profiles) >= 2:
        same_index = []
        for p in profiles:
            proxy = p.get("price_proxy") or p.get("symbol")
            same_index.append((p["symbol"], proxy))
        ndx_group = [s for s, px in same_index if px in {"^NDX", "QNDX", "QQQ"} or s in {"QQQ", "QNDX", "QQQM"}]
        if len(ndx_group) >= 2:
            lines.append("QQQ·QNDX 등 동일 지수군은 총보수·유동성·추적 품질 기준으로 고르는 것이 일반적입니다.")

    return {
        "pick": pick["symbol"],
        "runner_up": runner["symbol"] if runner else "",
        "commentary_ko": "\n".join(lines),
        "source": "rules",
    }


def generate_etf_compare_brief(comparison: dict[str, Any]) -> dict[str, Any]:
    context = _build_comparison_context(comparison)
    prompt = f"""You are an ETF analyst writing for Korean retail investors.

Using the ETF comparison data and chart context below, return JSON only:
{{
  "pick": "TICKER you would lean toward overall (one symbol from the list)",
  "runner_up": "second-choice TICKER or empty string",
  "commentary_ko": "Exactly 4-5 lines in Korean separated by \\\\n. Read the metrics and normalized performance. Explain: (1) which ETF you favor and why (cost, liquidity, tracking, overlap), (2) when a different ticker might be better, (3) whether holding multiple together adds diversification or is redundant. If tickers track different indices, say they are not direct substitutes. Do NOT add legal disclaimers."
}}

DATA:
{context}
"""

    try:
        if _gemini_api_key():
            parsed = _call_gemini_text(prompt)
            commentary = _strip_disclaimer(str(parsed.get("commentary_ko", "")).strip())
            if commentary:
                return {
                    "pick": str(parsed.get("pick", "")).strip().upper(),
                    "runner_up": str(parsed.get("runner_up", "")).strip().upper(),
                    "commentary_ko": commentary,
                    "source": "gemini",
                }
    except Exception as exc:
        fallback = _rule_based_recommendation(comparison)
        fallback["error"] = str(exc)
        return fallback

    return _rule_based_recommendation(comparison)


def format_etf_compare_ai_telegram(ai_brief: dict[str, Any]) -> str:
    commentary = str(ai_brief.get("commentary_ko", "")).strip()
    if not commentary:
        return ""

    pick = ai_brief.get("pick", "")
    header = "🤖 AI ETF 비교 코멘트 (한국어)\n"
    if pick:
        header += f"추천 1순위: <b>{pick}</b>"
        runner = ai_brief.get("runner_up")
        if runner:
            header += f" | 대안: <b>{runner}</b>"
        header += "\n"
    if ai_brief.get("error") and ai_brief.get("source") == "rules":
        header += "(Gemini unavailable — rule-based fallback)\n"
    header += f"출처: {ai_brief.get('source', 'rules')}\n\n"
    return header + commentary

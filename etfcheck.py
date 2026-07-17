"""ETF CHECK briefs for Telegram — fund flow, turnover, new listings.

Uses HTTP JSON only (see etfcheck_client). No browser automation.
Command: /etfcheck [all|inflow|volume|new]
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from etfcheck_client import (
    BASE_URL,
    EtfCheckClient,
    fetch_new_listings,
    fetch_rank_inflow,
    fetch_rank_volume,
)

KST = ZoneInfo("Asia/Seoul")
DEFAULT_TOP_N = 10


def is_etfcheck_command(command: str) -> bool:
    token = command.strip().split()[0].lower() if command.strip() else ""
    return token in {"/etfcheck", "/etf_check", "/etf체크"}


def parse_etfcheck_mode(command: str) -> str:
    parts = command.strip().split()
    if len(parts) < 2:
        return "all"
    mode = parts[1].lower()
    aliases = {
        "all": "all",
        "전체": "all",
        "inflow": "inflow",
        "flow": "inflow",
        "수급": "inflow",
        "순유입": "inflow",
        "volume": "volume",
        "turnover": "volume",
        "거래대금": "volume",
        "대금": "volume",
        "new": "new",
        "listing": "new",
        "listings": "new",
        "신규": "new",
        "상장": "new",
    }
    if mode not in aliases:
        raise ValueError(
            "Usage: /etfcheck [all|inflow|volume|new]\n"
            "예: /etfcheck · /etfcheck inflow · /etfcheck volume · /etfcheck new"
        )
    return aliases[mode]


def _esc(text: Any) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _fmt_억(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "n/a"
    eok = number / 1e8
    if abs(eok) >= 100:
        return f"{eok:,.0f}억"
    if abs(eok) >= 10:
        return f"{eok:,.1f}억"
    return f"{eok:,.2f}억"


def _fmt_pct(value: Any) -> str:
    try:
        return f"{float(value):+.2f}%"
    except (TypeError, ValueError):
        return "n/a"


def _fmt_list_date(value: Any) -> str:
    text = str(value or "")
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return text or "n/a"


def build_etfcheck_brief(*, mode: str = "all", top_n: int = DEFAULT_TOP_N) -> dict[str, Any]:
    """Fetch requested boards. Sequential GETs only — low RAM."""
    client = EtfCheckClient()
    client.warmup()

    generated_at = datetime.now(KST)
    brief: dict[str, Any] = {
        "mode": mode,
        "generated_at": generated_at.isoformat(),
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "source": BASE_URL,
        "volume": [],
        "inflow": [],
        "new_listings": [],
    }

    if mode in {"all", "volume"}:
        brief["volume"] = fetch_rank_volume(client, order="D", order_col="P", limit=top_n)
    if mode in {"all", "inflow"}:
        brief["inflow"] = fetch_rank_inflow(client, order="D", limit=top_n)
    if mode in {"all", "new"}:
        brief["new_listings"] = fetch_new_listings(client, limit=top_n, domestic_only=True)

    return brief


def format_etfcheck_telegram(brief: dict[str, Any]) -> str:
    lines = [
        "<b>🇰🇷 ETF CHECK</b>",
        f"<i>{_esc(brief.get('generated_at_display', ''))}</i>",
        f'출처: <a href="{BASE_URL}">{_esc(BASE_URL.replace("https://", ""))}</a> (코스콤)',
        "<i>HTTP JSON · no browser</i>",
        "",
    ]

    volume = brief.get("volume") or []
    if volume:
        lines.append("<b>1️⃣ 당일 거래대금 TOP (한국 ETF)</b>")
        for idx, row in enumerate(volume, start=1):
            lines.append(
                f"{idx}. <code>{_esc(row.get('F16013'))}</code> {_esc(row.get('F16002'))}\n"
                f"    대금 {_fmt_억(row.get('RANK_VALUE') or row.get('F15023'))} · "
                f"등락 {_fmt_pct(row.get('F15004'))}"
            )
        lines.append("")

    inflow = brief.get("inflow") or []
    if inflow:
        lines.append("<b>2️⃣ 전일 순유입 TOP (한국 ETF)</b>")
        for idx, row in enumerate(inflow, start=1):
            lines.append(
                f"{idx}. <code>{_esc(row.get('F16013'))}</code> {_esc(row.get('F16002'))}\n"
                f"    순유입 {_fmt_억(row.get('INFLOW') or row.get('RANK_VALUE'))} · "
                f"등락 {_fmt_pct(row.get('YIELD') or row.get('F15004'))}"
            )
        lines.append("")

    listings = brief.get("new_listings") or []
    if listings:
        lines.append("<b>3️⃣ 국내 신규 상장 (최근)</b>")
        for idx, row in enumerate(listings, start=1):
            lines.append(
                f"{idx}. <code>{_esc(row.get('F16013'))}</code> {_esc(row.get('F16002'))}\n"
                f"    상장 {_fmt_list_date(row.get('LIST_DATE'))} · "
                f"등락 {_fmt_pct(row.get('F15004'))}"
            )
        lines.append("")

    if not volume and not inflow and not listings:
        lines.append("<i>조회 결과가 없습니다. 잠시 후 다시 시도하세요.</i>")

    lines.extend(["<i>Not financial advice.</i>"])
    return "\n".join(lines).rstrip()

"""ESG + geopolitics data briefing builder (dashboard tabs → Gemini 3 paragraphs)."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from data_briefing import (
    format_brief_paragraphs,
    format_data_briefing_telegram,
    generate_data_briefing_from_esg,
)

KST = ZoneInfo("Asia/Seoul")
UA = "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)"


def webapp_public_base() -> str:
    explicit = os.environ.get("WEBAPP_PUBLIC_URL", "").strip().rstrip("/")
    if explicit:
        return explicit
    publish = os.environ.get("WEB_PUBLISH_URL", "").strip().rstrip("/")
    if publish.endswith("/api/ingest"):
        return publish[: -len("/api/ingest")]
    return "https://savvyetf.vercel.app"


def _fetch_json(url: str, timeout: int = 45) -> dict[str, Any]:
    res = requests.get(
        url,
        headers={"User-Agent": UA, "Accept": "application/json"},
        timeout=timeout,
    )
    if not res.ok:
        return {"ok": False, "error": f"HTTP {res.status_code} for {url}"}
    payload = res.json()
    if isinstance(payload, dict):
        return payload
    return {"ok": False, "error": "non-object JSON", "raw": payload}


def fetch_geo_payload(*, range_: str = "1mo") -> dict[str, Any]:
    base = webapp_public_base()
    return _fetch_json(f"{base}/api/geo?range={range_}")


def fetch_esg_themes_payload() -> dict[str, Any]:
    base = webapp_public_base()
    return _fetch_json(f"{base}/api/esg-themes")


def fetch_esg_carbon_payload() -> dict[str, Any]:
    base = webapp_public_base()
    return _fetch_json(f"{base}/api/esg-carbon")


def collect_esg_geo_snapshot() -> dict[str, Any]:
    """Gather climate (bot-native) + geo/themes/carbon (webapp APIs)."""
    from climate_data import build_climate_monitor_bundle

    generated_at = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    climate: dict[str, Any] = {}
    geo: dict[str, Any] = {}
    themes: dict[str, Any] = {}
    carbon: dict[str, Any] = {}
    accident: dict[str, Any] = {}
    errors: list[str] = []

    with ThreadPoolExecutor(max_workers=4) as pool:
        fut_climate = pool.submit(build_climate_monitor_bundle)
        fut_geo = pool.submit(fetch_geo_payload)
        fut_themes = pool.submit(fetch_esg_themes_payload)
        fut_carbon = pool.submit(fetch_esg_carbon_payload)
        try:
            climate = fut_climate.result()
        except Exception as exc:
            errors.append(f"climate: {exc}")
            climate = {"error": str(exc), "risk": {}}
        try:
            geo = fut_geo.result()
        except Exception as exc:
            errors.append(f"geo: {exc}")
            geo = {"ok": False, "error": str(exc)}
        try:
            themes = fut_themes.result()
        except Exception as exc:
            errors.append(f"themes: {exc}")
            themes = {"ok": False, "error": str(exc), "pillars": []}
        try:
            carbon = fut_carbon.result()
        except Exception as exc:
            errors.append(f"carbon: {exc}")
            carbon = {"ok": False, "error": str(exc)}

    # Optional DART accident screen — best-effort, do not fail the brief.
    try:
        from esg_data import build_esg_accident_profile

        accident = build_esg_accident_profile(None)
    except Exception as exc:
        errors.append(f"accident: {exc}")
        accident = {"hits": [], "error": str(exc)}

    return {
        "generated_at": generated_at,
        "climate": climate,
        "geo": geo,
        "themes": themes,
        "carbon": carbon,
        "accident": accident,
        "errors": errors,
    }


def generate_esg_geo_briefing(*, publish: bool = True) -> dict[str, Any]:
    """Build ESG·지정학 3-paragraph briefing + Telegram messages."""
    snapshot = collect_esg_geo_snapshot()
    briefing = generate_data_briefing_from_esg(
        climate=snapshot.get("climate"),
        geo=snapshot.get("geo"),
        themes=snapshot.get("themes"),
        carbon=snapshot.get("carbon"),
        accident=snapshot.get("accident"),
        generated_at=str(snapshot.get("generated_at") or ""),
    )

    risk = (snapshot.get("climate") or {}).get("risk") or {}
    composite = (snapshot.get("geo") or {}).get("composite") or {}
    header_lines = [
        "<b>🌍 ESG·지정학 데이터 브리핑</b>",
        f"<i>{snapshot.get('generated_at', '')}</i>",
    ]
    if risk:
        header_lines.append(
            f"기후위험 {risk.get('score')}/100 · {risk.get('level')} ({risk.get('label')})"
        )
    if composite:
        header_lines.append(
            f"지정학 종합 {composite.get('score')} · {composite.get('label')}"
        )
    header_lines.append("<i>Not financial advice.</i>")

    messages: list[dict[str, Any]] = [
        {"text": "\n".join(header_lines), "parse_mode": "HTML"},
    ]
    messages.extend(format_data_briefing_telegram(briefing))

    # Compact snapshot footnotes (keep short for Telegram).
    footnote_bits: list[str] = []
    hormuz = (snapshot.get("geo") or {}).get("hormuz") or {}
    if hormuz.get("verdict") or hormuz.get("status"):
        footnote_bits.append(
            f"Hormuz: {hormuz.get('verdict') or hormuz.get('status')}"
        )
    severe = [
        cp.get("name") or cp.get("id")
        for cp in ((snapshot.get("geo") or {}).get("chokepoints") or [])
        if isinstance(cp, dict)
        and str(cp.get("status") or "").lower() in {"severe", "elevated", "warning", "high"}
    ]
    if severe:
        footnote_bits.append("Chokepoints: " + ", ".join(str(s) for s in severe[:4]))
    if footnote_bits:
        messages.append({"text": "📌 " + " · ".join(footnote_bits)})

    result: dict[str, Any] = {
        "kind": "esg_geo_briefing",
        "generated_at": snapshot.get("generated_at"),
        "snapshot": snapshot,
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
            import html as html_lib

            brief_html = "".join(
                f"<p>{html_lib.escape(p)}</p>"
                for p in (briefing.get("market_brief_ko") or "").split("\n\n")
                if p.strip()
            )
            publish_brief(
                "esg",
                "esg_data_briefing",
                title="ESG·지정학 데이터 브리핑",
                generated_at=snapshot.get("generated_at"),
                sections=section_from_html(
                    brief_html or (briefing.get("market_brief_ko") or ""),
                    heading="ESG · Geopolitics data briefing",
                ),
                meta={
                    "source": briefing.get("source"),
                    "climate_score": risk.get("score"),
                    "geo_score": composite.get("score"),
                    "article_count": briefing.get("article_count"),
                },
            )
        except Exception as pub_exc:
            print(f"web_publish esg_data_briefing skipped: {pub_exc}")

    return result

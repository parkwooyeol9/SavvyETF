"""Publish ETF memb breakdown for a domestic new listing (web dashboard)."""

from __future__ import annotations

from typing import Any


def is_eligible_equity_etf(name: str) -> bool:
    """Exclude bond/single-stock products from new-listing memb picks."""
    text = str(name or "")
    if "국채" in text or "단일종목" in text:
        return False
    return True


def pick_new_listing_for_memb(
    new_listings: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Return the first eligible new listing whose holdings can be fetched."""
    from dart_etf_memb import build_etf_memb_profile

    for row in new_listings:
        name = str(row.get("F16002") or "")
        if not is_eligible_equity_etf(name):
            continue
        ticker = str(row.get("F16013") or "").strip()
        if not ticker:
            continue
        try:
            profile = build_etf_memb_profile(ticker)
            if profile.get("holdings"):
                return {"listing": row, "profile": profile}
        except Exception as exc:
            print(f"etf_memb pick skip {ticker} ({name}): {exc}")
    return None


def publish_etf_memb_from_brief(brief: dict[str, Any]) -> bool:
    """Publish one new-listing equity ETF memb slot to the web dashboard."""
    new_listings = brief.get("new_listings") or []
    if not new_listings:
        return False

    picked = pick_new_listing_for_memb(new_listings)
    if not picked:
        print("etf_memb publish skipped: no eligible new listing with holdings.")
        return False

    profile = picked["profile"]
    listing = picked["listing"]
    from dart_etf_memb import format_etf_memb_telegram
    from dart_etf_memb_charts import format_etf_memb_chart_caption, plot_etf_memb_dashboard
    from web_publish import chart_to_image_payload, publish_brief, section_from_html

    chart = plot_etf_memb_dashboard(profile)
    text = format_etf_memb_telegram(profile)
    caption = format_etf_memb_chart_caption(profile)
    ticker = str(profile.get("ticker") or listing.get("F16013") or "")

    return publish_brief(
        "etf",
        "etf_memb",
        title=f"신규상장 ETF 구성 — {profile.get('name') or ticker}",
        generated_at=brief.get("generated_at_display") or brief.get("generated_at"),
        sections=section_from_html(text, heading=f"{ticker} 편입종목"),
        images=[chart_to_image_payload(chart, id="holdings", caption=caption)],
        meta={
            "ticker": ticker,
            "name": profile.get("name"),
            "list_date": listing.get("LIST_DATE"),
            "listing_name": listing.get("F16002"),
        },
    )

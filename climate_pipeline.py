"""Climate Risk Monitor pipeline for /esg monitor."""

from __future__ import annotations

from typing import Any

from climate_charts import (
    format_climate_chart_caption,
    format_climate_monitor_telegram,
    plot_climate_monitor_dashboard,
)
from climate_data import build_climate_monitor_bundle


def run_climate_monitor(*, publish: bool = True) -> dict[str, Any]:
    """Build climate monitor brief with chart + Telegram messages + optional web publish."""
    from chart_buffers import snapshot_png_buffer

    bundle = build_climate_monitor_bundle()
    chart = plot_climate_monitor_dashboard(bundle)
    text = format_climate_monitor_telegram(bundle)
    caption = format_climate_chart_caption(bundle)

    # Independent buffers for Telegram photo vs web publish ingest
    chart_tg = snapshot_png_buffer(chart)
    chart_web = snapshot_png_buffer(chart)

    telegram_messages: list[dict[str, Any]] = [
        {"text": caption, "photo": chart_tg},
        {"text": text, "parse_mode": "HTML"},
    ]

    result: dict[str, Any] = {
        "mode": "monitor",
        "bundle": bundle,
        "chart": chart_tg,
        "text_summary": text,
        "telegram_messages": telegram_messages,
    }

    if publish:
        try:
            from web_publish import chart_to_image_payload, publish_brief, section_from_html

            publish_brief(
                "esg",
                "esg_monitor",
                title="물리적 기후위험 · /esg monitor",
                generated_at=bundle.get("generated_at_display")
                or bundle.get("generated_at"),
                sections=section_from_html(
                    text, heading="Physical climate risk & adaptation"
                ),
                images=[
                    chart_to_image_payload(
                        chart_web,
                        id="climate_dashboard",
                        caption=caption,
                    )
                ],
                meta={
                    "mode": "monitor",
                    "risk": bundle.get("risk"),
                    "quake_count": (bundle.get("earthquakes") or {}).get("count"),
                    "europe_flagged": (bundle.get("europe_weather") or {}).get(
                        "flagged_count"
                    ),
                },
            )
        except Exception as pub_exc:
            print(f"web_publish esg_monitor skipped: {pub_exc}")

    return result

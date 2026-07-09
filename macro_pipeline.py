"""Macro risk monitor pipeline."""

from __future__ import annotations

from macro_analyst import format_macro_ai_telegram, generate_macro_ai_brief
from macro_charts import format_macro_chart_caption, format_macro_text, plot_macro_dashboard
from macro_data import build_macro_bundle
from macro_scores import compute_macro_stress


def run_macro_dashboard(force: bool = False) -> dict:
    bundle = build_macro_bundle(force=force)
    stress = compute_macro_stress(
        bundle["snapshot"],
        edgar=bundle.get("edgar"),
        finnhub=bundle.get("finnhub"),
    )
    chart = plot_macro_dashboard(bundle, stress)
    text = format_macro_text(bundle, stress)
    ai_brief = generate_macro_ai_brief(bundle, stress)
    telegram_messages = [
        {
            "text": format_macro_chart_caption(bundle, stress),
            "photo": chart,
        },
        {
            "text": text,
            "parse_mode": "HTML",
        },
        {
            "text": format_macro_ai_telegram(ai_brief),
        },
    ]
    return {
        "bundle": bundle,
        "stress": stress,
        "chart": chart,
        "text_summary": text,
        "ai_brief": ai_brief,
        "telegram_messages": telegram_messages,
    }

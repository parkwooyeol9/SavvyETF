"""DART financial analysis pipeline for /dart."""

from __future__ import annotations

from dart_charts import format_dart_chart_caption, plot_dart_dashboard
from dart_data import build_dart_profile, format_dart_telegram


def run_dart_analysis(query: str) -> dict:
    profile = build_dart_profile(query)
    chart = plot_dart_dashboard(profile)
    text = format_dart_telegram(profile)

    telegram_messages: list[dict] = [
        {
            "text": format_dart_chart_caption(profile),
            "photo": chart,
        },
        {
            "text": text,
            "parse_mode": "HTML",
        },
    ]

    return {
        "profile": profile,
        "chart": chart,
        "text_summary": text,
        "telegram_messages": telegram_messages,
    }

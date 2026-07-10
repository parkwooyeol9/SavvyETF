"""Financial analysis pipeline for /financial."""

from __future__ import annotations

from financial_charts import format_financial_chart_caption, plot_financial_dashboard
from financial_data import build_financial_profile, format_financial_telegram


def run_financial_analysis(symbol: str) -> dict:
    profile = build_financial_profile(symbol)
    chart = plot_financial_dashboard(profile)
    text = format_financial_telegram(profile)

    telegram_messages: list[dict] = [
        {
            "text": format_financial_chart_caption(profile),
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

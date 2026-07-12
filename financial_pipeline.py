"""Financial analysis pipeline for /financial."""

from __future__ import annotations

from financial_charts import format_financial_chart_caption, plot_financial_dashboard
from financial_data import build_financial_profile, format_financial_telegram


def _slim_profile(profile: dict) -> dict:
    """Drop heavy series after the chart is drawn (Render memory)."""
    slim = dict(profile)
    slim.pop("timeseries", None)
    slim.pop("finnhub_snapshot", None)
    return slim


def run_financial_analysis(symbol: str, *, light: bool = False) -> dict:
    profile = build_financial_profile(
        symbol,
        check_sp500=not light,
        light=light,
    )
    chart = plot_financial_dashboard(profile)
    text = format_financial_telegram(profile)
    stored = _slim_profile(profile)

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
        "profile": stored,
        "chart": chart,
        "text_summary": text,
        "telegram_messages": telegram_messages,
    }

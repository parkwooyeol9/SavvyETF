"""ETF CHECK capture pipeline for /etfcheck."""

from __future__ import annotations

from etfcheck_capture import (
    capture_etfcheck_screenshots,
    capture_turnover_only,
    format_etfcheck_telegram,
    format_etfcheck_turnover_telegram,
)


def run_etfcheck_turnover_capture() -> dict:
    result = capture_turnover_only()
    text = format_etfcheck_turnover_telegram(result)
    shot = result["screenshots"]["volume_turnover"]
    telegram_messages = [
        {
            "text": "🇰🇷 ETF CHECK — 일간 거래대금 TOP\n(한국 ETF · 당일 · 장마감 후)",
            "photo": shot,
        },
        {"text": text, "parse_mode": "HTML"},
    ]
    return {
        "result": result,
        "text_summary": text,
        "telegram_messages": telegram_messages,
    }


def run_etfcheck_capture() -> dict:
    result = capture_etfcheck_screenshots()
    text = format_etfcheck_telegram(result)
    shots = result["screenshots"]
    telegram_messages = [
        {"text": "🇰🇷 ETF CHECK — 일간 거래대금 TOP\n(한국 ETF · 당일)", "photo": shots["volume_turnover"]},
        {"text": "🇰🇷 ETF CHECK — 일간 순유입 TOP\n(한국 ETF · 전일)", "photo": shots["inflow_daily"]},
        {"text": text, "parse_mode": "HTML"},
    ]
    return {
        "result": result,
        "text_summary": text,
        "telegram_messages": telegram_messages,
    }

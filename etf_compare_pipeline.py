"""ETF comparison pipeline for /comp."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from etf_compare import compare_etfs, format_comp_telegram
from etf_compare_analyst import format_etf_compare_ai_telegram, generate_etf_compare_brief
from etf_compare_charts import format_comp_chart_caption, plot_etf_compare_dashboard
from etf_compare_excel import export_etf_compare_excel

KST = ZoneInfo("Asia/Seoul")


def run_etf_comparison(symbols: list[str]) -> dict:
    comparison = compare_etfs(symbols)
    run_id = datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    excel_path = export_etf_compare_excel(comparison, run_id=run_id)
    chart = plot_etf_compare_dashboard(comparison)
    ai_brief = generate_etf_compare_brief(comparison)
    text = format_comp_telegram(comparison["profiles"], excel_path.name)
    ai_text = format_etf_compare_ai_telegram(ai_brief)

    telegram_messages: list[dict] = [
        {
            "text": format_comp_chart_caption(comparison),
            "photo": chart,
        },
        {
            "text": text,
            "parse_mode": "HTML",
        },
    ]
    if ai_text:
        telegram_messages.append({"text": ai_text, "parse_mode": "HTML"})
    telegram_messages.append(
        {
            "text": f"📎 ETF comparison workbook: {excel_path.name}",
            "document_path": str(excel_path),
        }
    )

    return {
        "comparison": comparison,
        "excel_path": excel_path,
        "chart": chart,
        "ai_brief": ai_brief,
        "text_summary": text,
        "telegram_messages": telegram_messages,
    }

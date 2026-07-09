"""End-to-end ADR impact pipeline (for SavvyETF bot)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from adr_analysis import analyze_adr_list
from adr_charts import (
    plot_aligned_overlay_returns,
    plot_panel_summary,
    plot_single_adr,
    save_all_charts,
)
from adr_excel_export import export_analysis_excel

KST = ZoneInfo("Asia/Seoul")


def run_adr_analysis(symbols: list[str]) -> dict:
    if not symbols:
        raise ValueError("Provide at least one ADR symbol (e.g. TSM ASML ARM)")

    run_id = datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    analysis = analyze_adr_list(symbols)
    chart_paths = save_all_charts(analysis, run_id=run_id)
    excel_path = export_analysis_excel(analysis, run_id=run_id, chart_paths=chart_paths)

    panel_buf = plot_panel_summary(analysis)
    overlay_buf = plot_aligned_overlay_returns(analysis)
    single_charts: dict[str, object] = {}
    for result in analysis["results"]:
        sym = result["metrics"]["adr_symbol"]
        single_charts[sym] = plot_single_adr(result)

    tickers = ", ".join(analysis["summary"]["adr_symbol"].tolist()) if not analysis["summary"].empty else ""
    text_lines = [
        "ADR Listing Impact Analysis",
        f"Run: {run_id}",
        f"Tickers: {tickers}",
        "",
    ]
    for _, row in analysis["summary"].iterrows():
        sig = " (p<0.05)" if row.get("significant_at_5pct") else ""
        text_lines.extend(
            [
                f"▸ {row['adr_symbol']} → {row['underlying_symbol']} ({row['company_name']})",
                f"  US ADR listing: {row.get('us_adr_listing_date', '')}",
                f"  Analysis event: {row.get('analysis_event_date', '')} ({row.get('analysis_event_source', '')})",
                f"  Pre avg return: {row['pre_avg_daily_return_pct']:.4f}%/day ({int(row['pre_trading_days'])}d)",
                f"  Post avg return: {row['post_avg_daily_return_pct']:.4f}%/day ({int(row['post_trading_days'])}d)",
            ]
        )
        ratio = row.get("volume_post_to_pre_ratio")
        if ratio == ratio:
            text_lines.append(f"  Volume post/pre: {ratio:.2f}x{sig}")
        else:
            text_lines.append("  Volume post/pre: n/a")
        note = row.get("coverage_note", "")
        if note:
            text_lines.append(f"  Note: {note}")
        text_lines.append("")

    if analysis.get("errors"):
        text_lines.append("Warnings:")
        text_lines.extend(f"  • {e}" for e in analysis["errors"])

    return {
        "run_id": run_id,
        "analysis": analysis,
        "excel_path": excel_path,
        "chart_paths": chart_paths,
        "panel_chart": panel_buf,
        "overlay_chart": overlay_buf,
        "single_charts": single_charts,
        "text_summary": "\n".join(text_lines).strip(),
    }


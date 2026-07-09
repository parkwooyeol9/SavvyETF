"""Export ETF comparison workbook."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = PROJECT_DIR / "data" / "etf_compare"
KST = ZoneInfo("Asia/Seoul")


def export_etf_compare_excel(comparison: dict, run_id: str | None = None) -> Path:
    run_id = run_id or datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"etf_compare_{run_id}.xlsx"

    symbols = ", ".join(comparison["symbols"])
    notes = pd.DataFrame(
        [
            {"field": "Generated at (KST)", "value": comparison["generated_at"]},
            {"field": "Tickers", "value": symbols},
            {"field": "Data source", "value": "Yahoo Finance (yfinance)"},
            {
                "field": "Premium/Discount",
                "value": "(Market Price / NAV - 1) * 100; positive = premium",
            },
            {
                "field": "Returns",
                "value": "Total return from adjusted close; 1M/3M/6M/1Y use trading-day windows",
            },
            {
                "field": "Overlap",
                "value": "Sum of min(top-holding weights) for shared names across ETF pairs",
            },
        ]
    )

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        notes.to_excel(writer, sheet_name="README", index=False)
        comparison["comparison"].to_excel(writer, sheet_name="Comparison", index=False)
        comparison["holdings"].to_excel(writer, sheet_name="Top_Holdings", index=False)
        if not comparison["overlap"].empty:
            comparison["overlap"].to_excel(writer, sheet_name="Holdings_Overlap", index=False)

        workbook = writer.book
        for sheet_name in ("Comparison", "Top_Holdings", "Holdings_Overlap", "README"):
            if sheet_name not in workbook.sheetnames:
                continue
            ws = workbook[sheet_name]
            for col in ws.columns:
                letter = col[0].column_letter
                max_len = 0
                for cell in col:
                    if cell.value is not None:
                        max_len = max(max_len, len(str(cell.value)))
                ws.column_dimensions[letter].width = min(max(max_len + 2, 12), 48)

    return path

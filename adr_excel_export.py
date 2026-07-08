"""Export ADR analysis to Excel."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from adr_data_loader import EVENT_BUFFER_DAYS

PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = PROJECT_DIR / "data" / "adr_output"
KST = ZoneInfo("Asia/Seoul")


def _format_event_sheet(event: pd.DataFrame) -> pd.DataFrame:
    out = event.reset_index().rename(columns={"index": "date", "Date": "date"})
    cols = [
        c
        for c in [
            "date",
            "close",
            "volume",
            "daily_return",
            "days_from_listing",
            "trading_day_offset",
            "phase",
            "price_index",
        ]
        if c in out.columns
    ]
    return out[cols]


def export_analysis_excel(analysis: dict, run_id: str | None = None) -> Path:
    run_id = run_id or datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    out_dir = OUTPUT_DIR / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"adr_impact_{run_id}.xlsx"

    summary = analysis["summary"].copy()
    notes = pd.DataFrame(
        {
            "field": [
                "generated_at",
                "window",
                "pre_post_definition",
                "listing_date_source",
                "significance_test",
            ],
            "value": [
                datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
                "±2 calendar years around analysis event date",
                f"Pre/post exclude ±{EVENT_BUFFER_DAYS} days around event (buffer)",
                "US ADR listing date from registry/yfinance; event date aligned if underlying Yahoo history is limited",
                "Welch t-test: post vs pre daily returns (skipped if limited pre data)",
            ],
        }
    )

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        notes.to_excel(writer, sheet_name="README", index=False)
        summary.to_excel(writer, sheet_name="Summary", index=False)

        for result in analysis["results"]:
            sym = result["metrics"]["adr_symbol"]
            sheet = sym[:31]
            _format_event_sheet(result["event"]).to_excel(writer, sheet_name=sheet, index=False)

        if analysis.get("errors"):
            pd.DataFrame({"errors": analysis["errors"]}).to_excel(
                writer, sheet_name="Errors", index=False
            )

    return path


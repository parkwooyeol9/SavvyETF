"""Excel export for /etf_holdings."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from dart_data import PROJECT_DIR

KST = ZoneInfo("Asia/Seoul")
OUTPUT_DIR = PROJECT_DIR / "data" / "etf_holdings"


def export_etf_holdings_excel(profile: dict, run_id: str | None = None) -> Path:
    run_id = run_id or datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    etf = profile["etf"]
    holding = profile.get("holding_ticker") or profile["holding_query"]
    safe_h = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in str(holding))
    path = OUTPUT_DIR / f"etf_holdings_{etf}_{safe_h}_{run_id}.xlsx"

    notes = pd.DataFrame(
        [
            {"field": "Generated at (KST)", "value": profile["generated_at"]},
            {"field": "ETF", "value": f"{profile['etf']} — {profile['etf_name']}"},
            {
                "field": "Holding",
                "value": f"{profile.get('holding_ticker')} {profile.get('holding_name')}".strip(),
            },
            {"field": "Query", "value": profile["holding_query"]},
            {"field": "Points", "value": profile["n_points"]},
            {"field": "Range", "value": f"{profile['start']} → {profile['end']}"},
            {
                "field": "Latest weight %",
                "value": round(profile["latest_weight_pct"], 6),
            },
            {
                "field": "Period Δ %p",
                "value": round(profile["delta_weight_pct"], 6),
            },
            {
                "field": "Frequency note",
                "value": profile.get("frequency_note") or "",
            },
            {
                "field": "Sources",
                "value": "; ".join(profile.get("notes") or []),
            },
            {
                "field": "Feasibility",
                "value": str(profile.get("feasibility") or {}),
            },
        ]
    )

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        notes.to_excel(writer, sheet_name="README", index=False)
        profile["dataframe"].to_excel(writer, sheet_name="Weight_History", index=False)
        workbook = writer.book
        for sheet_name in workbook.sheetnames:
            ws = workbook[sheet_name]
            for col in ws.columns:
                letter = col[0].column_letter
                max_len = 0
                for cell in col:
                    if cell.value is not None:
                        max_len = max(max_len, len(str(cell.value)))
                ws.column_dimensions[letter].width = min(max(max_len + 2, 12), 56)

    return path

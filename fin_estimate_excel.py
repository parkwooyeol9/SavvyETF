"""Excel export for /fin_estimate (forward estimates + quarterly history)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from fin_estimate import TARGET_YEARS

PROJECT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = PROJECT_DIR / "data" / "fin_estimate"
KST = timezone(timedelta(hours=9))


def _autosize(writer: pd.ExcelWriter, sheet_names: list[str]) -> None:
    workbook = writer.book
    for sheet_name in sheet_names:
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


def _estimates_frame(profiles: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for profile in profiles:
        resolved = profile.get("resolved") or {}
        for year in TARGET_YEARS:
            bucket = (profile.get("years") or {}).get(year) or {}
            rows.append(
                {
                    "ticker": resolved.get("yahoo") or resolved.get("fmp"),
                    "display": resolved.get("display"),
                    "market": resolved.get("market"),
                    "currency": resolved.get("currency"),
                    "year": year,
                    "revenue": bucket.get("revenue"),
                    "operating_income_or_ebit": bucket.get("operating_income"),
                    "net_income": bucket.get("net_income"),
                    "eps": bucket.get("eps"),
                    "revenue_analysts": bucket.get("revenue_analysts"),
                    "eps_analysts": bucket.get("eps_analysts"),
                    "sources": ", ".join(bucket.get("sources") or []),
                    "notes": ", ".join(bucket.get("notes") or []),
                }
            )
    return pd.DataFrame(rows)


def _quarterly_frame(profiles: list[dict[str, Any]]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for profile in profiles:
        history = profile.get("history") or {}
        frame = history.get("quarterly")
        if isinstance(frame, pd.DataFrame) and not frame.empty:
            frames.append(frame.copy())
    if not frames:
        return pd.DataFrame(
            columns=[
                "ticker",
                "market",
                "period_end",
                "fiscal_year",
                "fiscal_period",
                "revenue",
                "operating_income",
                "net_income",
                "eps",
                "currency",
                "source",
            ]
        )
    out = pd.concat(frames, ignore_index=True)
    out["period_end"] = pd.to_datetime(out["period_end"], errors="coerce")
    out = out.sort_values(["ticker", "period_end"]).reset_index(drop=True)
    return out


def export_fin_estimate_excel(
    profiles: list[dict[str, Any]],
    *,
    run_id: str | None = None,
) -> Path:
    run_id = run_id or datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tickers = "_".join(
        str((p.get("resolved") or {}).get("yahoo") or "TICK").replace(".", "")
        for p in profiles
    )[:40]
    path = OUTPUT_DIR / f"fin_estimate_{tickers}_{run_id}.xlsx"

    estimates = _estimates_frame(profiles)
    quarterly = _quarterly_frame(profiles)

    history_notes: list[str] = []
    for profile in profiles:
        resolved = profile.get("resolved") or {}
        hist = profile.get("history") or {}
        history_notes.append(
            f"{resolved.get('yahoo')}: rows={hist.get('row_count', 0)} "
            f"span={hist.get('min_period')}→{hist.get('max_period')} "
            f"notes={'; '.join(hist.get('notes') or [])}"
        )

    readme = pd.DataFrame(
        [
            {"field": "Generated at (KST)", "value": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")},
            {
                "field": "Tickers",
                "value": ", ".join(
                    str((p.get("resolved") or {}).get("yahoo")) for p in profiles
                ),
            },
            {
                "field": "Estimates sheet",
                "value": "Forward consensus 2026–2028 (FMP primary; KR Naver fallback)",
            },
            {
                "field": "Quarterly sheet",
                "value": (
                    "Historical quarterly P&L from 2000 where available "
                    "(US: FMP+Finnhub+SEC; KR: DART). Gaps mean vendor has no row."
                ),
            },
            {
                "field": "Operating income",
                "value": "Estimates: FMP EBIT used as OpInc proxy; History: reported operating income when available",
            },
            {"field": "History coverage", "value": " | ".join(history_notes) or "n/a"},
            {"field": "Disclaimer", "value": "Not financial advice. FY/report conventions differ by market."},
        ]
    )

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        readme.to_excel(writer, sheet_name="README", index=False)
        estimates.to_excel(writer, sheet_name="Estimates", index=False)
        q_out = quarterly.copy()
        if not q_out.empty and "period_end" in q_out.columns:
            q_out["period_end"] = q_out["period_end"].dt.strftime("%Y-%m-%d")
        q_out.to_excel(writer, sheet_name="Quarterly", index=False)
        _autosize(writer, ["README", "Estimates", "Quarterly"])

    return path

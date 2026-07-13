"""Historical quarterly / annual P&L for /fin_estimate Excel export.

US:
  - FMP income-statement (Q1–Q4, free-plan limit=5 each) for recent quarters
  - Finnhub financials-reported for ~decade of 10-Q/10-K
  - SEC companyfacts (XBRL) to extend history (often from ~2008, not always 2000)

KR:
  - Open DART fnlttSinglAcntAll from earliest available year (often ~2015+)
    report codes Q1/H1/Q3/FY

Target window starts at HISTORY_START_YEAR (2000); earlier gaps are left blank.
"""

from __future__ import annotations

import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from fin_estimate import FMP_STABLE, USER_AGENT, _ensure_dotenv, _fmp_api_key, _safe_float

KST = timezone(timedelta(hours=9))
HISTORY_START_YEAR = 2000
PROJECT_DIR = Path(__file__).resolve().parent

# DART report codes
DART_Q1 = "11013"
DART_H1 = "11012"
DART_Q3 = "11014"
DART_FY = "11011"
DART_REPORT_LABELS = {
    DART_Q1: "Q1",
    DART_H1: "H1",
    DART_Q3: "Q3",
    DART_FY: "FY",
}


def _finnhub_api_key() -> str:
    _ensure_dotenv()
    return os.environ.get("FINNHUB_API_KEY", "").strip()


def _sec_headers() -> dict[str, str]:
    _ensure_dotenv()
    custom = os.environ.get("SEC_EDGAR_USER_AGENT", "").strip()
    if custom:
        ua = custom
    else:
        email = os.environ.get("SEC_CONTACT_EMAIL", "").strip()
        ua = f"SavvyETF/1.0 ({email})" if email else "SavvyETF/1.0 (fin-estimate@localhost)"
    return {"User-Agent": ua, "Accept": "application/json"}


def _pad_cik(cik: str | int | None) -> str | None:
    if cik is None:
        return None
    digits = re.sub(r"\D", "", str(cik))
    if not digits:
        return None
    return digits.zfill(10)


def _empty_row(**kwargs: Any) -> dict[str, Any]:
    base = {
        "ticker": None,
        "market": None,
        "period_end": None,
        "fiscal_year": None,
        "fiscal_period": None,
        "revenue": None,
        "operating_income": None,
        "net_income": None,
        "eps": None,
        "currency": None,
        "source": None,
    }
    base.update(kwargs)
    return base


def _merge_history_rows(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
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
    frame = pd.DataFrame(rows)
    frame["period_end"] = pd.to_datetime(frame["period_end"], errors="coerce")
    frame = frame.dropna(subset=["period_end"])
    frame = frame[frame["period_end"].dt.year >= HISTORY_START_YEAR]
    # Prefer richer / primary sources when same period_end + ticker collide.
    priority = {"FMP": 0, "Finnhub": 1, "SEC": 2, "DART": 0}
    frame["_prio"] = frame["source"].map(lambda s: priority.get(str(s), 9))
    frame = (
        frame.sort_values(["ticker", "period_end", "_prio"])
        .drop_duplicates(subset=["ticker", "period_end", "fiscal_period"], keep="first")
        .drop(columns=["_prio"])
        .sort_values(["ticker", "period_end"])
        .reset_index(drop=True)
    )
    return frame


def fetch_fmp_quarterly_income(symbol: str) -> list[dict[str, Any]]:
    """Recent quarters via FMP (free plan: limit<=5 per quarter bucket)."""
    key = _fmp_api_key()
    if not key:
        return []
    rows: list[dict[str, Any]] = []
    for period in ("Q1", "Q2", "Q3", "Q4"):
        try:
            response = requests.get(
                f"{FMP_STABLE}/income-statement",
                params={
                    "symbol": symbol,
                    "period": period,
                    "limit": 5,
                    "apikey": key,
                },
                headers={"User-Agent": USER_AGENT},
                timeout=30,
            )
            if response.status_code != 200:
                continue
            payload = response.json()
        except Exception:
            continue
        if not isinstance(payload, list):
            continue
        for item in payload:
            end = item.get("date")
            year = None
            if end and re.match(r"^20\d{2}", str(end)):
                year = int(str(end)[:4])
            rows.append(
                _empty_row(
                    ticker=symbol,
                    market="US" if "." not in symbol else "KR",
                    period_end=end,
                    fiscal_year=year,
                    fiscal_period=period,
                    revenue=_safe_float(item.get("revenue")),
                    operating_income=_safe_float(
                        item.get("operatingIncome") or item.get("ebit")
                    ),
                    net_income=_safe_float(item.get("netIncome")),
                    eps=_safe_float(item.get("epsdiluted") or item.get("eps")),
                    currency=item.get("reportedCurrency"),
                    source="FMP",
                )
            )
        time.sleep(0.15)
    return rows


def fetch_fmp_profile_meta(symbol: str) -> dict[str, Any]:
    key = _fmp_api_key()
    if not key:
        return {}
    try:
        response = requests.get(
            f"{FMP_STABLE}/profile",
            params={"symbol": symbol, "apikey": key},
            headers={"User-Agent": USER_AGENT},
            timeout=25,
        )
        if response.status_code != 200:
            return {}
        payload = response.json()
        if isinstance(payload, list) and payload:
            return payload[0]
    except Exception:
        return {}
    return {}


def _finnhub_pick_ic(ic_rows: list[dict[str, Any]], patterns: list[str]) -> float | None:
    for row in ic_rows:
        concept = str(row.get("concept") or "")
        label = str(row.get("label") or "")
        blob = f"{concept} {label}"
        for pattern in patterns:
            if re.search(pattern, blob, flags=re.IGNORECASE):
                value = _safe_float(row.get("value"))
                if value is not None:
                    return value
    return None


def fetch_finnhub_reported_quarterly(symbol: str) -> list[dict[str, Any]]:
    key = _finnhub_api_key()
    if not key:
        return []
    try:
        response = requests.get(
            "https://finnhub.io/api/v1/stock/financials-reported",
            params={
                "symbol": symbol,
                "freq": "quarterly",
                "from": f"{HISTORY_START_YEAR}-01-01",
                "to": date.today().isoformat(),
                "token": key,
            },
            timeout=45,
        )
        if response.status_code != 200:
            return []
        payload = response.json()
    except Exception:
        return []
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []

    rows: list[dict[str, Any]] = []
    for item in data:
        ic = ((item.get("report") or {}).get("ic")) or []
        if not isinstance(ic, list):
            continue
        quarter = item.get("quarter")
        year = item.get("year")
        end = (item.get("endDate") or "")[:10] or None
        period = f"Q{quarter}" if quarter not in (None, 0, "0") else "FY"
        rows.append(
            _empty_row(
                ticker=symbol,
                market="US",
                period_end=end,
                fiscal_year=year,
                fiscal_period=period,
                revenue=_finnhub_pick_ic(
                    ic, [r"us-gaap_Revenues$", r"\bRevenues\b", r"RevenueFromContract"]
                ),
                operating_income=_finnhub_pick_ic(
                    ic, [r"OperatingIncomeLoss", r"Operating income"]
                ),
                net_income=_finnhub_pick_ic(ic, [r"NetIncomeLoss$", r"Net income"]),
                eps=_finnhub_pick_ic(ic, [r"EarningsPerShareDiluted", r"Diluted"]),
                currency="USD",
                source="Finnhub",
            )
        )
    return rows


def _sec_series_points(facts: dict[str, Any], concepts: list[str]) -> list[dict[str, Any]]:
    us_gaap = ((facts.get("facts") or {}).get("us-gaap")) or {}
    points: list[dict[str, Any]] = []
    for concept in concepts:
        node = us_gaap.get(concept) or {}
        units = node.get("units") or {}
        series = None
        for unit_key in ("USD", "USD/shares"):
            if unit_key in units:
                series = units[unit_key]
                break
        if not series:
            continue
        for point in series:
            form = str(point.get("form") or "")
            if form not in {"10-Q", "10-K", "10-Q/A", "10-K/A"}:
                continue
            end = point.get("end")
            start = point.get("start")
            fp = point.get("fp")
            if not end or not fp:
                continue
            # Prefer single-quarter durations (~70-100d). Keep FY separately.
            if start and end and fp in {"Q1", "Q2", "Q3", "Q4"}:
                try:
                    d0 = datetime.fromisoformat(str(start))
                    d1 = datetime.fromisoformat(str(end))
                    days = (d1 - d0).days
                except ValueError:
                    days = None
                if days is not None and not (65 <= days <= 110):
                    continue
            points.append(
                {
                    "concept": concept,
                    "end": end,
                    "fp": fp,
                    "fy": point.get("fy"),
                    "val": _safe_float(point.get("val")),
                    "filed": point.get("filed") or "",
                    "form": form,
                }
            )
    return points


def fetch_sec_quarterly_income(cik: str, symbol: str) -> list[dict[str, Any]]:
    cik_pad = _pad_cik(cik)
    if not cik_pad:
        return []
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik_pad}.json"
    try:
        response = requests.get(url, headers=_sec_headers(), timeout=60)
        if response.status_code != 200:
            return []
        facts = response.json()
    except Exception:
        return []

    revenue_pts = _sec_series_points(
        facts,
        [
            "Revenues",
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "SalesRevenueNet",
        ],
    )
    op_pts = _sec_series_points(facts, ["OperatingIncomeLoss"])
    ni_pts = _sec_series_points(facts, ["NetIncomeLoss"])
    eps_pts = _sec_series_points(facts, ["EarningsPerShareDiluted", "EarningsPerShareBasic"])

    def _best_map(points: list[dict[str, Any]]) -> dict[tuple[str, str], float]:
        best: dict[tuple[str, str], tuple[str, float]] = {}
        for point in points:
            if point["val"] is None:
                continue
            key = (str(point["end"]), str(point["fp"]))
            prev = best.get(key)
            if prev is None or str(point["filed"]) >= prev[0]:
                best[key] = (str(point["filed"]), float(point["val"]))
        return {key: value for key, (_filed, value) in best.items()}

    rev_map = _best_map(revenue_pts)
    op_map = _best_map(op_pts)
    ni_map = _best_map(ni_pts)
    eps_map = _best_map(eps_pts)
    keys = sorted(set(rev_map) | set(op_map) | set(ni_map) | set(eps_map))

    rows: list[dict[str, Any]] = []
    for end, fp in keys:
        if fp not in {"Q1", "Q2", "Q3", "Q4", "FY"}:
            continue
        year = int(end[:4]) if re.match(r"^20\d{2}", end) else None
        rows.append(
            _empty_row(
                ticker=symbol,
                market="US",
                period_end=end,
                fiscal_year=year,
                fiscal_period=fp,
                revenue=rev_map.get((end, fp)),
                operating_income=op_map.get((end, fp)),
                net_income=ni_map.get((end, fp)),
                eps=eps_map.get((end, fp)),
                currency="USD",
                source="SEC",
            )
        )
    return rows


def fetch_dart_period_history(corp_code: str, ticker: str) -> list[dict[str, Any]]:
    """DART quarterly/half/annual statements from HISTORY_START_YEAR onward."""
    from dart_data import ACCOUNT_RULES, _extract_metrics, _dart_get

    current_year = datetime.now(KST).year
    rows: list[dict[str, Any]] = []
    for year in range(max(HISTORY_START_YEAR, 2015), current_year + 1):
        for report_code, label in DART_REPORT_LABELS.items():
            try:
                payload = _dart_get(
                    "fnlttSinglAcntAll.json",
                    {
                        "corp_code": corp_code,
                        "bsns_year": str(year),
                        "reprt_code": report_code,
                        "fs_div": "CFS",
                    },
                )
            except RuntimeError as exc:
                message = str(exc)
                if "013" in message or "조회된 데이타가 없습니다" in message:
                    continue
                # Keep going for other years on transient account misses.
                continue
            except Exception:
                continue
            metrics = _extract_metrics(payload.get("list") or [])
            if not any(metrics.get(k) is not None for k in ACCOUNT_RULES):
                continue
            # Approximate period-end dates for Korea calendar FY.
            end_map = {
                "Q1": f"{year}-03-31",
                "H1": f"{year}-06-30",
                "Q3": f"{year}-09-30",
                "FY": f"{year}-12-31",
            }
            rows.append(
                _empty_row(
                    ticker=ticker,
                    market="KR",
                    period_end=end_map[label],
                    fiscal_year=year,
                    fiscal_period=label,
                    revenue=_safe_float(metrics.get("revenue")),
                    operating_income=_safe_float(metrics.get("operating_profit")),
                    net_income=_safe_float(metrics.get("net_income")),
                    eps=_safe_float(metrics.get("eps")),
                    currency="KRW",
                    source="DART",
                )
            )
            time.sleep(0.12)
    return rows


def collect_history_for_profile(profile: dict[str, Any]) -> dict[str, Any]:
    """Attach quarterly (+ optional annual-like FY rows) history to one profile."""
    resolved = profile.get("resolved") or {}
    market = resolved.get("market") or "US"
    symbol = resolved.get("fmp") or resolved.get("yahoo")
    notes: list[str] = []
    errors: list[str] = []
    rows: list[dict[str, Any]] = []

    if market == "US":
        meta = fetch_fmp_profile_meta(symbol)
        cik = meta.get("cik")
        try:
            rows.extend(fetch_fmp_quarterly_income(symbol))
        except Exception as exc:
            errors.append(f"FMP quarterly: {exc}")
        try:
            rows.extend(fetch_finnhub_reported_quarterly(symbol))
        except Exception as exc:
            errors.append(f"Finnhub reported: {exc}")
        if cik:
            try:
                rows.extend(fetch_sec_quarterly_income(str(cik), symbol))
            except Exception as exc:
                errors.append(f"SEC companyfacts: {exc}")
        else:
            notes.append("SEC skipped (no CIK from FMP profile)")
        notes.append(
            "US history: FMP recent + Finnhub filings + SEC XBRL "
            "(XBRL usually starts mid/late 2000s, not always 2000)"
        )
    else:
        code = resolved.get("code")
        corp_code = None
        try:
            from dart_data import resolve_corp

            query = code or resolved.get("display") or symbol
            corp = resolve_corp(str(code or query))
            corp_code = corp.get("corp_code")
        except Exception as exc:
            errors.append(f"DART resolve: {exc}")
        if corp_code:
            try:
                rows.extend(fetch_dart_period_history(str(corp_code), symbol))
            except Exception as exc:
                errors.append(f"DART history: {exc}")
            notes.append(
                "KR history: Open DART (structured statements typically from ~2015; "
                "H1/Q3 may be cumulative YTD depending on filing)"
            )
        # Attempt FMP anyway (usually blocked on free plan).
        try:
            fmp_rows = fetch_fmp_quarterly_income(symbol)
            if fmp_rows:
                rows.extend(fmp_rows)
        except Exception:
            pass

    frame = _merge_history_rows(rows)
    if not frame.empty:
        frame["ticker"] = symbol
        frame["market"] = market
        if resolved.get("currency"):
            frame["currency"] = frame["currency"].fillna(resolved["currency"])

    return {
        "quarterly": frame,
        "notes": notes,
        "errors": errors,
        "row_count": int(len(frame)),
        "min_period": (
            frame["period_end"].min().date().isoformat() if not frame.empty else None
        ),
        "max_period": (
            frame["period_end"].max().date().isoformat() if not frame.empty else None
        ),
    }


def attach_histories(profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for profile in profiles:
        history = collect_history_for_profile(profile)
        profile = dict(profile)
        profile["history"] = history
        profile["errors"] = list(profile.get("errors") or []) + list(
            history.get("errors") or []
        )
        profile["notes"] = list(profile.get("notes") or []) + list(
            history.get("notes") or []
        )
        enriched.append(profile)
    return enriched

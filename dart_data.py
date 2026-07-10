"""Korean corporate fundamentals via Open DART API for /dart."""

from __future__ import annotations

import io
import json
import os
import re
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import requests

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
CORP_CACHE_PATH = DATA_DIR / "dart_corp_codes.json"
DART_BASE = "https://opendart.fss.or.kr/api"
KST = ZoneInfo("Asia/Seoul")
CORP_CACHE_TTL_SECONDS = 86_400
ANNUAL_REPORT_CODE = "11011"
DEFAULT_FS_DIV = "CFS"
HISTORY_YEARS = 5

ACCOUNT_RULES: dict[str, list[str]] = {
    "revenue": [
        r"^매출액$",
        r"^수익\(매출액\)$",
        r"^영업수익$",
        r"^Ⅰ\.?\s*영업수익$",
        r"^매출$",
    ],
    "operating_profit": [r"^영업이익", r"^영업이익\(손실\)$"],
    "net_income": [r"^당기순이익", r"^분기순이익", r"^연결당기순이익"],
    "total_assets": [r"^자산총계$"],
    "total_equity": [r"^자본총계$", r"^지배기업.*소유주지분$"],
    "total_liabilities": [r"^부채총계$"],
    "eps": [r"^주당순이익", r"^기본주당순이익", r"^기본주당이익"],
}


def _dart_api_key() -> str:
    return (
        os.environ.get("DART_API_KEY", "").strip()
        or os.environ.get("dart_api_key", "").strip().strip("'\"")
    )


def _dart_get(path: str, params: dict[str, Any]) -> dict:
    key = _dart_api_key()
    if not key:
        raise RuntimeError("DART_API_KEY is not set in .env")

    query = {**params, "crtfc_key": key}
    response = requests.get(f"{DART_BASE}/{path}", params=query, timeout=45)
    response.raise_for_status()
    payload = response.json()
    status = str(payload.get("status", ""))
    if status != "000":
        message = payload.get("message", "unknown DART error")
        raise RuntimeError(f"DART API error ({status}): {message}")
    return payload


def parse_dart_query(command: str) -> str:
    parts = command.strip().split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        raise ValueError("missing company name")
    return parts[1].strip()


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", "", value.lower())


def _load_corp_cache() -> dict | None:
    if not CORP_CACHE_PATH.is_file():
        return None
    try:
        payload = json.loads(CORP_CACHE_PATH.read_text(encoding="utf-8"))
        updated_at = float(payload.get("updated_at", 0))
        if time.time() - updated_at > CORP_CACHE_TTL_SECONDS:
            return None
        return payload
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


def _save_corp_cache(corps: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"updated_at": time.time(), "corps": corps}
    CORP_CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def load_corp_directory(force: bool = False) -> list[dict]:
    if not force:
        cached = _load_corp_cache()
        if cached and cached.get("corps"):
            return cached["corps"]

    key = _dart_api_key()
    if not key:
        raise RuntimeError("DART_API_KEY is not set in .env")

    response = requests.get(f"{DART_BASE}/corpCode.xml", params={"crtfc_key": key}, timeout=90)
    response.raise_for_status()

    corps: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        xml_name = next(name for name in archive.namelist() if name.lower().endswith(".xml"))
        root = ET.fromstring(archive.read(xml_name))
        for item in root.findall("list"):
            corp_code = (item.findtext("corp_code") or "").strip()
            corp_name = (item.findtext("corp_name") or "").strip()
            if not corp_code or not corp_name:
                continue
            stock_code = (item.findtext("stock_code") or "").strip()
            corps.append(
                {
                    "corp_code": corp_code,
                    "corp_name": corp_name,
                    "corp_eng_name": (item.findtext("corp_eng_name") or "").strip(),
                    "stock_code": stock_code,
                    "modify_date": (item.findtext("modify_date") or "").strip(),
                }
            )

    _save_corp_cache(corps)
    print(f"DART corp directory refreshed ({len(corps)} companies).")
    return corps


def resolve_corp(query: str) -> dict:
    corps = load_corp_directory()
    query = query.strip()
    query_norm = _normalize_name(query)

    if re.fullmatch(r"\d{6}", query):
        matches = [corp for corp in corps if corp.get("stock_code") == query]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise RuntimeError(f"Multiple DART matches for stock code {query}.")

    exact = [corp for corp in corps if _normalize_name(corp["corp_name"]) == query_norm]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        names = ", ".join(corp["corp_name"] for corp in exact[:5])
        raise RuntimeError(f"Multiple exact matches: {names}")

    contains = [corp for corp in corps if query_norm in _normalize_name(corp["corp_name"])]
    if not contains:
        eng = [corp for corp in corps if query.lower() in (corp.get("corp_eng_name") or "").lower()]
        contains = eng
    if not contains:
        raise RuntimeError(f"No Korean listed company matched '{query}' in DART.")

    contains.sort(key=lambda corp: (len(corp["corp_name"]), corp["corp_name"]))
    if len(contains) > 1:
        preview = ", ".join(corp["corp_name"] for corp in contains[:5])
        if len(contains) > 5:
            preview += f" … (+{len(contains) - 5})"
        raise RuntimeError(
            f"Multiple matches for '{query}'. Try a more specific name.\nCandidates: {preview}"
        )
    return contains[0]


def _parse_amount(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "")
    if not text or text == "-":
        return None
    if text.startswith("(") and text.endswith(")"):
        text = f"-{text[1:-1]}"
    try:
        return float(text)
    except ValueError:
        return None


def _match_account(account_nm: str, patterns: list[str]) -> bool:
    cleaned = re.sub(r"\s+", "", account_nm or "")
    return any(re.search(pattern, cleaned) for pattern in patterns)


def _extract_metrics(rows: list[dict]) -> dict[str, float | None]:
    metrics: dict[str, float | None] = {key: None for key in ACCOUNT_RULES}
    for row in rows:
        account_nm = row.get("account_nm", "")
        for key, patterns in ACCOUNT_RULES.items():
            if metrics[key] is not None:
                continue
            if _match_account(account_nm, patterns):
                metrics[key] = _parse_amount(row.get("thstrm_amount"))
    return metrics


def fetch_company_profile(corp_code: str) -> dict[str, Any]:
    payload = _dart_get("company.json", {"corp_code": corp_code})
    return payload


def fetch_annual_financials(corp_code: str, year: int, *, fs_div: str = DEFAULT_FS_DIV) -> dict[str, float | None]:
    payload = _dart_get(
        "fnlttSinglAcntAll.json",
        {
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": ANNUAL_REPORT_CODE,
            "fs_div": fs_div,
        },
    )
    rows = payload.get("list") or []
    if not rows:
        return {key: None for key in ACCOUNT_RULES}
    return _extract_metrics(rows)


def _year_history() -> list[int]:
    current_year = datetime.now(KST).year
    return list(range(current_year - HISTORY_YEARS, current_year))


def build_financial_history(corp_code: str, years: list[int] | None = None) -> pd.DataFrame:
    years = years or _year_history()
    records: list[dict[str, Any]] = []
    for year in years:
        try:
            metrics = fetch_annual_financials(corp_code, year)
        except RuntimeError as exc:
            if "조회된 데이타가 없습니다" in str(exc) or "013" in str(exc):
                continue
            raise
        row = {"year": year, **metrics}
        records.append(row)
        time.sleep(0.15)

    if not records:
        raise RuntimeError("No annual financial statements found in DART for this company.")

    frame = pd.DataFrame(records).sort_values("year")
    for column in ("revenue", "operating_profit", "net_income", "total_assets", "total_equity", "eps"):
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def _format_krw(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    abs_value = abs(value)
    if abs_value >= 1_000_000_000_000:
        return f"{value / 1_000_000_000_000:.2f}조"
    if abs_value >= 100_000_000:
        return f"{value / 100_000_000:.1f}억"
    if abs_value >= 10_000:
        return f"{value / 10_000:.1f}만"
    return f"{value:,.0f}원"


def _format_pct(value: float | None, *, signed: bool = False) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    if signed:
        return f"{value:+.1f}%"
    return f"{value:.1f}%"


def _latest_ratios(history: pd.DataFrame) -> dict[str, float | None]:
    if history.empty:
        return {}
    latest = history.iloc[-1]
    revenue = latest.get("revenue")
    op = latest.get("operating_profit")
    net = latest.get("net_income")
    assets = latest.get("total_assets")
    equity = latest.get("total_equity")
    liabilities = latest.get("total_liabilities")

    ratios: dict[str, float | None] = {
        "operating_margin": (op / revenue * 100) if revenue and op is not None else None,
        "net_margin": (net / revenue * 100) if revenue and net is not None else None,
        "roe": (net / equity * 100) if equity and net is not None else None,
        "debt_ratio": (liabilities / assets * 100) if assets and liabilities is not None else None,
    }

    if len(history) >= 2:
        prev = history.iloc[-2]
        prev_rev = prev.get("revenue")
        prev_net = prev.get("net_income")
        if prev_rev and revenue:
            ratios["revenue_growth"] = (revenue / prev_rev - 1) * 100
        if prev_net and net:
            ratios["net_income_growth"] = (net / prev_net - 1) * 100

    return ratios


def build_dart_profile(query: str) -> dict[str, Any]:
    corp = resolve_corp(query)
    company = fetch_company_profile(corp["corp_code"])
    history = build_financial_history(corp["corp_code"])
    ratios = _latest_ratios(history)
    latest = history.iloc[-1]
    latest_year = int(latest["year"])

    stock_code = corp.get("stock_code") or company.get("stock_code") or ""
    stock_label = f"{stock_code} · " if stock_code and stock_code != " " else ""

    return {
        "query": query,
        "corp_code": corp["corp_code"],
        "corp_name": corp["corp_name"],
        "stock_code": stock_code.strip(),
        "company": company,
        "history": history,
        "latest_year": latest_year,
        "ratios": ratios,
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "display_name": f"{corp['corp_name']} ({stock_label}DART {corp['corp_code']})".rstrip(),
        "industry": company.get("induty_code", "n/a"),
        "ceo": company.get("ceo_nm", "n/a"),
        "latest_metrics": latest.to_dict(),
    }


def format_dart_telegram(profile: dict[str, Any]) -> str:
    latest = profile["latest_metrics"]
    ratios = profile["ratios"]
    year = profile["latest_year"]
    company = profile.get("company") or {}

    lines = [
        f"<b>🇰🇷 DART 재무분석 — {profile['corp_name']}</b>",
    ]
    if profile.get("stock_code"):
        lines.append(f"종목코드: <code>{profile['stock_code']}</code>")
    lines.extend(
        [
            f"대표이사: {_esc(company.get('ceo_nm', 'n/a'))} · 업종코드: {_esc(company.get('induty_code', 'n/a'))}",
            f"<i>{profile['generated_at']} · 사업연도 {year} 사업보고서(연결)</i>",
            "",
            f"<b>{year} 주요 재무 (연결, 원)</b>",
            f"매출액: <code>{_format_krw(latest.get('revenue'))}</code>",
            f"영업이익: <code>{_format_krw(latest.get('operating_profit'))}</code>",
            f"당기순이익: <code>{_format_krw(latest.get('net_income'))}</code>",
            f"자산총계: <code>{_format_krw(latest.get('total_assets'))}</code>",
            f"자본총계: <code>{_format_krw(latest.get('total_equity'))}</code>",
        ]
    )
    if latest.get("eps") is not None and not pd.isna(latest.get("eps")):
        lines.append(f"주당순이익(EPS): <code>{latest['eps']:,.0f}원</code>")

    lines.extend(
        [
            "",
            "<b>수익성 · 성장</b>",
            f"영업이익률: <code>{_format_pct(ratios.get('operating_margin'))}</code>",
            f"순이익률: <code>{_format_pct(ratios.get('net_margin'))}</code>",
            f"ROE: <code>{_format_pct(ratios.get('roe'))}</code>",
            f"부채비율: <code>{_format_pct(ratios.get('debt_ratio'))}</code>",
            f"매출 성장(YoY): <code>{_format_pct(ratios.get('revenue_growth'), signed=True)}</code>",
            f"순이익 성장(YoY): <code>{_format_pct(ratios.get('net_income_growth'), signed=True)}</code>",
            "",
            "<i>Source: Open DART (opendart.fss.or.kr)</i>",
            "<i>Not financial advice.</i>",
        ]
    )
    return "\n".join(lines)


def _esc(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )

"""ESG / governance briefs powered by Open DART (same stack as /dart).

Modes map roughly to the product screens:
  fin     — earnings + cash flow + financial health
  return  — treasury / buyback disclosures + shareholder-return timeline
  own     — ownership (largest + related) + 5% majorstock signals
  div     — 3y dividend history (DPS, payout, yield)
  accident— 중대재해-related disclosures (90d screen)
  overview— short pack combining the above
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from dart_data import (
    ANNUAL_REPORT_CODE,
    DEFAULT_FS_DIV,
    _dart_get,
    _esc,
    _format_krw,
    _format_pct,
    _parse_amount,
    build_dart_profile,
    fetch_company_profile,
    resolve_corp,
)

KST = ZoneInfo("Asia/Seoul")
VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

REPORT_ANNUAL = "11011"
REPORT_CODES_QUARTERLY = (
    ("11013", "1Q"),
    ("11012", "반기"),
    ("11014", "3Q"),
    ("11011", "연간"),
)

ACCIDENT_KEYWORDS = (
    "중대재해",
    "산업재해",
    "산재사망",
    "사망사고",
    "중대재해관련",
)

RETURN_DISCLOSURE_KEYWORDS = (
    "자기주식",
    "자사주",
    "기업가치제고",
    "기업가치 제고",
    "주주환원",
    "배당결정",
    "배당금",
    "소각",
)

CF_ACCOUNT_RULES: dict[str, list[str]] = {
    "cfo": [r"영업활동현금흐름", r"영업활동으로인한현금흐름"],
    "cfi": [r"투자활동현금흐름", r"투자활동으로인한현금흐름"],
    "cff": [r"재무활동현금흐름", r"재무활동으로인한현금흐름"],
    "cash_begin": [r"^기초현금및현금성자산$"],
    "cash_end": [r"^기말현금및현금성자산$"],
    "cash_change": [r"현금및현금성자산의증가", r"현금및현금성자산의증감"],
}


def _dart_get_soft(path: str, params: dict[str, Any]) -> dict | None:
    try:
        return _dart_get(path, params)
    except RuntimeError as exc:
        text = str(exc)
        if "(013)" in text or "조회된 데이타가 없습니다" in text:
            return None
        raise


def _viewer(rcept_no: str | None) -> str | None:
    if not rcept_no:
        return None
    return VIEWER_URL.format(rcept_no=rcept_no)


def _parse_pct_like(raw: Any) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "").replace("%", "")
    if not text or text == "-":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_qty(raw: Any) -> float | None:
    return _parse_amount(str(raw) if raw is not None else None)


def _match_cf(account_nm: str, patterns: list[str]) -> bool:
    cleaned = re.sub(r"\s+", "", account_nm or "")
    return any(re.search(pattern, cleaned) for pattern in patterns)


def _latest_annual_year() -> int:
    # Prefer prior calendar year (annual filings usually available by Mar–May).
    now = datetime.now(KST)
    return now.year - 1 if now.month < 5 else now.year - 1


def fetch_cashflow(corp_code: str, year: int) -> dict[str, Any]:
    payload = _dart_get_soft(
        "fnlttSinglAcntAll.json",
        {
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": ANNUAL_REPORT_CODE,
            "fs_div": DEFAULT_FS_DIV,
        },
    )
    metrics: dict[str, float | None] = {key: None for key in CF_ACCOUNT_RULES}
    rcept_no = None
    if not payload:
        return {"year": year, "metrics": metrics, "rcept_no": None}
    for row in payload.get("list") or []:
        if row.get("sj_div") != "CF":
            continue
        if not rcept_no:
            rcept_no = row.get("rcept_no")
        account_nm = row.get("account_nm") or ""
        for key, patterns in CF_ACCOUNT_RULES.items():
            if metrics[key] is not None:
                continue
            if _match_cf(account_nm, patterns):
                metrics[key] = _parse_amount(row.get("thstrm_amount"))
    return {"year": year, "metrics": metrics, "rcept_no": rcept_no}


def fetch_alot_matter(
    corp_code: str, year: int, reprt_code: str = REPORT_ANNUAL
) -> list[dict[str, Any]]:
    payload = _dart_get_soft(
        "alotMatter.json",
        {
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": reprt_code,
        },
    )
    return list(payload.get("list") or []) if payload else []


def _alot_lookup(
    rows: list[dict[str, Any]],
    se_substr: str,
    *,
    stock_knd: str | None = None,
) -> dict[str, Any] | None:
    for row in rows:
        se = row.get("se") or ""
        if se_substr not in se:
            continue
        if stock_knd is not None and (row.get("stock_knd") or "-") != stock_knd:
            continue
        return row
    return None


def parse_dividend_bundle(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Parse alotMatter rows into structured dividend metrics (당기/전기/전전기)."""
    if not rows:
        return {}
    rcept_no = rows[0].get("rcept_no")
    stlm_dt = rows[0].get("stlm_dt")

    def triple(se: str, stock_knd: str | None = None) -> dict[str, float | None]:
        row = _alot_lookup(rows, se, stock_knd=stock_knd)
        if not row:
            return {"thstrm": None, "frmtrm": None, "lwfr": None}
        return {
            "thstrm": _parse_pct_like(row.get("thstrm"))
            if "%" in se
            else _parse_amount(row.get("thstrm")),
            "frmtrm": _parse_pct_like(row.get("frmtrm"))
            if "%" in se
            else _parse_amount(row.get("frmtrm")),
            "lwfr": _parse_pct_like(row.get("lwfr"))
            if "%" in se
            else _parse_amount(row.get("lwfr")),
        }

    # Amounts in DART dividend table are often 백만원 for totals.
    cash_total = triple("현금배당금총액")
    payout = triple("(연결)현금배당성향(%)")
    if payout["thstrm"] is None:
        payout = triple("현금배당성향(%)")
    yield_common = triple("현금배당수익률(%)", stock_knd="보통주")
    dps_common = triple("주당 현금배당금(원)", stock_knd="보통주")
    ni_conn = triple("(연결)당기순이익")
    eps_conn = triple("(연결)주당순이익")

    return {
        "rcept_no": rcept_no,
        "stlm_dt": stlm_dt,
        "cash_dividend_total_mn": cash_total,  # 백만원
        "payout_pct": payout,
        "yield_common_pct": yield_common,
        "dps_common": dps_common,
        "ni_conn_mn": ni_conn,
        "eps_conn": eps_conn,
    }


def fetch_dividend_history(corp_code: str, years: int = 3) -> dict[str, Any]:
    """Build ~3y annual dividend series from the latest annual alotMatter triples."""
    base_year = _latest_annual_year()
    rows: list[dict[str, Any]] = []
    used_year = None
    for year in range(base_year, base_year - 3, -1):
        rows = fetch_alot_matter(corp_code, year, REPORT_ANNUAL)
        if rows:
            used_year = year
            break
        time.sleep(0.12)
    bundle = parse_dividend_bundle(rows)
    if not bundle:
        return {"years": [], "series": [], "source_year": None, "rcept_no": None}

    labels = [used_year, used_year - 1, used_year - 2]
    keys = ("thstrm", "frmtrm", "lwfr")
    series = []
    for label, key in zip(labels, keys):
        cash_mn = (bundle.get("cash_dividend_total_mn") or {}).get(key)
        series.append(
            {
                "year": label,
                "dps": (bundle.get("dps_common") or {}).get(key),
                "payout_pct": (bundle.get("payout_pct") or {}).get(key),
                "yield_pct": (bundle.get("yield_common_pct") or {}).get(key),
                "cash_total_krw": cash_mn * 1_000_000 if cash_mn is not None else None,
                "ni_krw": (
                    (bundle.get("ni_conn_mn") or {}).get(key) * 1_000_000
                    if (bundle.get("ni_conn_mn") or {}).get(key) is not None
                    else None
                ),
            }
        )

    # Quarterly cumulative DPS → approximate quarterly increments (latest year).
    quarterly: list[dict[str, Any]] = []
    cumulative: list[tuple[str, float | None]] = []
    for code, label in REPORT_CODES_QUARTERLY:
        qrows = fetch_alot_matter(corp_code, used_year, code)
        dps_row = _alot_lookup(qrows, "주당 현금배당금(원)", stock_knd="보통주")
        value = _parse_amount(dps_row.get("thstrm")) if dps_row else None
        cumulative.append((label, value))
        time.sleep(0.12)
    prev = 0.0
    for label, value in cumulative:
        if value is None:
            quarterly.append({"period": label, "dps_cum": None, "dps_q": None})
            continue
        quarterly.append(
            {
                "period": label,
                "dps_cum": value,
                "dps_q": value - prev if label != "연간" else value - prev,
            }
        )
        prev = value

    # Cash shareholder-return proxy: cash dividends + treasury acquisitions (shares, not KRW).
    return {
        "source_year": used_year,
        "rcept_no": bundle.get("rcept_no"),
        "viewer": _viewer(bundle.get("rcept_no")),
        "years": labels,
        "series": series,
        "quarterly_dps": quarterly,
        "stlm_dt": bundle.get("stlm_dt"),
    }


def fetch_ownership(corp_code: str, year: int | None = None) -> dict[str, Any]:
    year = year or _latest_annual_year()
    payload = _dart_get_soft(
        "hyslrSttus.json",
        {
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": REPORT_ANNUAL,
        },
    )
    rows = list(payload.get("list") or []) if payload else []
    if not rows and year > _latest_annual_year() - 2:
        time.sleep(0.12)
        return fetch_ownership(corp_code, year - 1)

    holders: list[dict[str, Any]] = []
    for row in rows:
        if (row.get("stock_knd") or "") not in {"보통주", "의결권있는주식", "-"} and row.get(
            "stock_knd"
        ):
            # Keep common / voting; still include if stock_knd blank.
            if "우선" in str(row.get("stock_knd")):
                continue
        holders.append(
            {
                "name": re.sub(r"\s+", " ", str(row.get("nm") or "")).strip(),
                "relate": re.sub(r"\s+", " ", str(row.get("relate") or "")).strip(),
                "shares": _parse_qty(row.get("trmend_posesn_stock_co")),
                "pct": _parse_pct_like(row.get("trmend_posesn_stock_qota_rt")),
                "rcept_no": row.get("rcept_no"),
            }
        )

    largest = [h for h in holders if "최대주주" in (h["relate"] or "") and "특수" not in (h["relate"] or "")]
    related = [h for h in holders if "특수관계" in (h["relate"] or "")]
    other = [h for h in holders if h not in largest and h not in related]

    def _sum_pct(items: list[dict[str, Any]]) -> float | None:
        vals = [h["pct"] for h in items if h.get("pct") is not None]
        return sum(vals) if vals else None

    mrhl = _dart_get_soft(
        "mrhlSttus.json",
        {
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": REPORT_ANNUAL,
        },
    )
    minority = None
    if mrhl and mrhl.get("list"):
        row = mrhl["list"][0]
        minority = {
            "holder_rate": row.get("shrholdr_rate"),
            "stock_rate": _parse_pct_like(str(row.get("hold_stock_rate", "")).replace("%", "")),
            "holders": _parse_qty(row.get("shrholdr_co")),
            "shares": _parse_qty(row.get("hold_stock_co")),
        }

    rcept_no = holders[0]["rcept_no"] if holders else None
    return {
        "year": year,
        "holders": holders,
        "largest": largest,
        "related": related,
        "other_major": other,
        "largest_pct": _sum_pct(largest),
        "related_pct": _sum_pct(related),
        "largest_related_pct": _sum_pct(largest + related),
        "minority": minority,
        "rcept_no": rcept_no,
        "viewer": _viewer(rcept_no),
    }


def fetch_treasury(corp_code: str, year: int | None = None) -> dict[str, Any]:
    year = year or _latest_annual_year()
    payload = _dart_get_soft(
        "tesstkAcqsDspsSttus.json",
        {
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": REPORT_ANNUAL,
        },
    )
    rows = list(payload.get("list") or []) if payload else []
    totals = [
        row
        for row in rows
        if (row.get("acqs_mth1") or "") == "총계" or (row.get("acqs_mth3") or "") == "총계"
    ]
    parsed = []
    for row in totals:
        parsed.append(
            {
                "stock_knd": row.get("stock_knd"),
                "begin": _parse_qty(row.get("bsis_qy")),
                "acquired": _parse_qty(row.get("change_qy_acqs")),
                "disposed": _parse_qty(row.get("change_qy_dsps")),
                "retired": _parse_qty(row.get("change_qy_incnr")),
                "end": _parse_qty(row.get("trmend_qy")),
                "stlm_dt": row.get("stlm_dt"),
                "rcept_no": row.get("rcept_no"),
            }
        )
    rcept_no = parsed[0]["rcept_no"] if parsed else (rows[0].get("rcept_no") if rows else None)
    return {
        "year": year,
        "totals": parsed,
        "rcept_no": rcept_no,
        "viewer": _viewer(rcept_no),
    }


def fetch_majorstock(corp_code: str, limit: int = 20) -> dict[str, Any]:
    payload = _dart_get_soft("majorstock.json", {"corp_code": corp_code})
    rows = list(payload.get("list") or []) if payload else []
    items: list[dict[str, Any]] = []
    for row in rows[:limit]:
        items.append(
            {
                "date": row.get("rcept_dt"),
                "reporter": row.get("repror"),
                "report_tp": row.get("report_tp"),
                "shares": _parse_qty(row.get("stkqy")),
                "shares_chg": _parse_qty(row.get("stkqy_irds")),
                "pct": _parse_pct_like(row.get("stkrt")),
                "pct_chg": _parse_pct_like(row.get("stkrt_irds")),
                "reason": row.get("report_resn"),
                "rcept_no": row.get("rcept_no"),
                "viewer": _viewer(row.get("rcept_no")),
            }
        )

    # Dispute / activism heuristic: many filings or large |Δ%| in last 365 days.
    cutoff = (datetime.now(KST) - timedelta(days=365)).strftime("%Y-%m-%d")
    recent = [i for i in items if (i.get("date") or "") >= cutoff]
    large_moves = [
        i
        for i in recent
        if i.get("pct_chg") is not None and abs(float(i["pct_chg"])) >= 1.0
    ]
    reporters = {i.get("reporter") for i in recent if i.get("reporter")}
    signal = None
    if len(recent) >= 8 or len(large_moves) >= 3 or len(reporters) >= 4:
        signal = (
            f"최근 1년 대량보유 공시 {len(recent)}건 · "
            f"|Δ지분|≥1%p {len(large_moves)}건 · 보고자 {len(reporters)}명 — "
            "경영권/지분변동 모니터링 권고"
        )
    elif recent:
        signal = f"최근 1년 대량보유 공시 {len(recent)}건 (특이 신호 약함)"
    else:
        signal = "최근 1년 대량보유 공시 없음/미제공"

    return {
        "items": items,
        "recent_count": len(recent),
        "large_move_count": len(large_moves),
        "signal": signal,
    }


def fetch_disclosure_timeline(
    corp_code: str,
    *,
    days: int = 365,
    keywords: tuple[str, ...] = RETURN_DISCLOSURE_KEYWORDS,
    max_pages: int = 5,
    limit: int = 25,
) -> list[dict[str, Any]]:
    end = datetime.now(KST)
    bgn = end - timedelta(days=days)
    hits: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        payload = _dart_get_soft(
            "list.json",
            {
                "corp_code": corp_code,
                "bgn_de": bgn.strftime("%Y%m%d"),
                "end_de": end.strftime("%Y%m%d"),
                "page_count": "100",
                "page_no": str(page),
            },
        )
        rows = list(payload.get("list") or []) if payload else []
        if not rows:
            break
        for row in rows:
            name = (row.get("report_nm") or "").strip()
            if not any(k in name for k in keywords):
                continue
            hits.append(
                {
                    "date": row.get("rcept_dt"),
                    "report_nm": name,
                    "corp_name": row.get("corp_name"),
                    "rcept_no": row.get("rcept_no"),
                    "viewer": _viewer(row.get("rcept_no")),
                }
            )
        time.sleep(0.12)
        if len(hits) >= limit:
            break
    hits.sort(key=lambda x: x.get("date") or "", reverse=True)
    return hits[:limit]


def screen_accident_disclosures(
    *,
    days: int = 90,
    corp_code: str | None = None,
    max_pages: int = 10,
    limit: int = 30,
) -> list[dict[str, Any]]:
    end = datetime.now(KST)
    bgn = end - timedelta(days=days)
    hits: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        params: dict[str, Any] = {
            "bgn_de": bgn.strftime("%Y%m%d"),
            "end_de": end.strftime("%Y%m%d"),
            "page_count": "100",
            "page_no": str(page),
        }
        if corp_code:
            params["corp_code"] = corp_code
        payload = _dart_get_soft("list.json", params)
        rows = list(payload.get("list") or []) if payload else []
        if not rows:
            break
        for row in rows:
            name = (row.get("report_nm") or "").strip()
            if not any(k in name for k in ACCIDENT_KEYWORDS):
                continue
            hits.append(
                {
                    "date": row.get("rcept_dt"),
                    "corp_name": row.get("corp_name"),
                    "stock_code": (row.get("stock_code") or "").strip(),
                    "report_nm": name,
                    "rcept_no": row.get("rcept_no"),
                    "viewer": _viewer(row.get("rcept_no")),
                }
            )
        time.sleep(0.12)
        if len(hits) >= limit:
            break
    hits.sort(key=lambda x: x.get("date") or "", reverse=True)
    return hits[:limit]


def build_esg_fin_profile(query: str) -> dict[str, Any]:
    dart = build_dart_profile(query)
    year = int(dart["latest_year"])
    cash = fetch_cashflow(dart["corp_code"], year)
    cf = cash["metrics"]
    ratios = dart["ratios"]
    health_notes: list[str] = []
    debt = ratios.get("debt_ratio")
    if debt is not None:
        if debt >= 200:
            health_notes.append(f"부채비율 {_format_pct(debt)} — 레버리지 높음")
        elif debt >= 100:
            health_notes.append(f"부채비율 {_format_pct(debt)} — 보통~경계")
        else:
            health_notes.append(f"부채비율 {_format_pct(debt)} — 양호 구간")
    cfo = cf.get("cfo")
    if cfo is not None:
        if cfo > 0:
            health_notes.append("영업현금흐름(+) — 본업 현금창출력 확인")
        else:
            health_notes.append("영업현금흐름(−) — 운전자본·이익질 점검 필요")
    cfi = cf.get("cfi")
    if cfo is not None and cfi is not None and cfo > 0 and cfi < 0:
        health_notes.append("CFO+ / CFI− 패턴 — 성장투자 병행 가능")

    return {
        "mode": "fin",
        "query": query,
        "corp_name": dart["corp_name"],
        "corp_code": dart["corp_code"],
        "stock_code": dart.get("stock_code"),
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "dart": dart,
        "cashflow": cash,
        "health_notes": health_notes,
        "viewer": _viewer(cash.get("rcept_no")),
    }


def build_esg_div_profile(query: str) -> dict[str, Any]:
    corp = resolve_corp(query)
    company = fetch_company_profile(corp["corp_code"])
    hist = fetch_dividend_history(corp["corp_code"], years=3)
    return {
        "mode": "div",
        "query": query,
        "corp_name": corp["corp_name"],
        "corp_code": corp["corp_code"],
        "stock_code": (corp.get("stock_code") or company.get("stock_code") or "").strip(),
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "dividend": hist,
    }


def build_esg_own_profile(query: str) -> dict[str, Any]:
    corp = resolve_corp(query)
    company = fetch_company_profile(corp["corp_code"])
    ownership = fetch_ownership(corp["corp_code"])
    major = fetch_majorstock(corp["corp_code"])
    treasury = fetch_treasury(corp["corp_code"])
    return {
        "mode": "own",
        "query": query,
        "corp_name": corp["corp_name"],
        "corp_code": corp["corp_code"],
        "stock_code": (corp.get("stock_code") or company.get("stock_code") or "").strip(),
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "ownership": ownership,
        "majorstock": major,
        "treasury": treasury,
    }


def build_esg_return_profile(query: str) -> dict[str, Any]:
    corp = resolve_corp(query)
    company = fetch_company_profile(corp["corp_code"])
    treasury = fetch_treasury(corp["corp_code"])
    timeline = fetch_disclosure_timeline(corp["corp_code"], days=365)
    dividend = fetch_dividend_history(corp["corp_code"], years=3)
    # Aggregate treasury share activity (not KRW — DART table is share counts).
    acq = sum((t.get("acquired") or 0) for t in treasury.get("totals") or [])
    dsp = sum((t.get("disposed") or 0) for t in treasury.get("totals") or [])
    ret = sum((t.get("retired") or 0) for t in treasury.get("totals") or [])
    cash_div = None
    if dividend.get("series"):
        cash_div = dividend["series"][0].get("cash_total_krw")
    return {
        "mode": "return",
        "query": query,
        "corp_name": corp["corp_name"],
        "corp_code": corp["corp_code"],
        "stock_code": (corp.get("stock_code") or company.get("stock_code") or "").strip(),
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "treasury": treasury,
        "timeline": timeline,
        "dividend": dividend,
        "aggregates": {
            "treasury_acquired_shares": acq or None,
            "treasury_disposed_shares": dsp or None,
            "treasury_retired_shares": ret or None,
            "cash_dividend_krw": cash_div,
        },
    }


def build_esg_accident_profile(query: str | None = None) -> dict[str, Any]:
    corp = None
    corp_code = None
    if query:
        corp = resolve_corp(query)
        corp_code = corp["corp_code"]
    hits = screen_accident_disclosures(days=90, corp_code=corp_code)
    return {
        "mode": "accident",
        "query": query,
        "corp_name": corp["corp_name"] if corp else None,
        "corp_code": corp_code,
        "stock_code": (corp.get("stock_code") if corp else "") or "",
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "days": 90,
        "hits": hits,
    }


def build_esg_overview_profile(query: str) -> dict[str, Any]:
    """Compact hub combining fin snapshot + ownership + dividend + return timeline head."""
    fin = build_esg_fin_profile(query)
    own = build_esg_own_profile(query)
    div = build_esg_div_profile(query)
    # Reuse corp from fin; light return timeline only (skip full treasury year if slow)
    timeline = fetch_disclosure_timeline(fin["corp_code"], days=180, limit=8)
    return {
        "mode": "overview",
        "query": query,
        "corp_name": fin["corp_name"],
        "corp_code": fin["corp_code"],
        "stock_code": fin.get("stock_code"),
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "fin": fin,
        "own": own,
        "div": div,
        "timeline": timeline,
    }


def _fmt_shares(value: float | None) -> str:
    if value is None:
        return "n/a"
    if abs(value) >= 100_000_000:
        return f"{value / 100_000_000:.2f}억주"
    if abs(value) >= 10_000:
        return f"{value / 10_000:.1f}만주"
    return f"{value:,.0f}주"


def _fmt_dps(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:,.0f}원"


def format_esg_fin_telegram(profile: dict[str, Any]) -> str:
    dart = profile["dart"]
    latest = dart["latest_metrics"]
    ratios = dart["ratios"]
    year = dart["latest_year"]
    cf = profile["cashflow"]["metrics"]
    lines = [
        f"<b>🧭 ESG · 실적/건전성 — {_esc(profile['corp_name'])}</b>",
        f"<i>{profile['generated_at']} · DART 사업보고서 {year} (연결)</i>",
    ]
    if profile.get("stock_code"):
        lines.append(f"종목 <code>{profile['stock_code']}</code>")
    lines.extend(
        [
            "",
            "<b>손익</b>",
            f"매출 {_format_krw(latest.get('revenue'))} · 영업이익 {_format_krw(latest.get('operating_profit'))}",
            f"당기순이익 {_format_krw(latest.get('net_income'))} · EPS {_fmt_dps(latest.get('eps'))}",
            f"영업이익률 {_format_pct(ratios.get('operating_margin'))} · ROE {_format_pct(ratios.get('roe'))}",
            f"매출 YoY {_format_pct(ratios.get('revenue_growth'), signed=True)} · "
            f"순이익 YoY {_format_pct(ratios.get('net_income_growth'), signed=True)}",
            "",
            "<b>현금흐름</b>",
            f"영업(CFO) {_format_krw(cf.get('cfo'))}",
            f"투자(CFI) {_format_krw(cf.get('cfi'))}",
            f"재무(CFF) {_format_krw(cf.get('cff'))}",
            f"기초현금 {_format_krw(cf.get('cash_begin'))} → 기말 {_format_krw(cf.get('cash_end'))}",
            "",
            "<b>재무건전성 메모</b>",
        ]
    )
    for note in profile.get("health_notes") or ["데이터 부족"]:
        lines.append(f"· {_esc(note)}")
    if profile.get("viewer"):
        lines.append(f'\n<a href="{profile["viewer"]}">공시 원문</a>')
    lines.extend(["", "<i>Source: Open DART · Not financial advice.</i>"])
    return "\n".join(lines)


def format_esg_div_telegram(profile: dict[str, Any]) -> str:
    div = profile.get("dividend") or {}
    lines = [
        f"<b>💸 ESG · 배당 — {_esc(profile['corp_name'])}</b>",
        f"<i>{profile['generated_at']} · 사업보고서 {div.get('source_year', '?')} 기준 3개년</i>",
    ]
    if profile.get("stock_code"):
        lines.append(f"종목 <code>{profile['stock_code']}</code>")
    lines.append("")
    lines.append("<b>연간 (보통주)</b>")
    for row in div.get("series") or []:
        lines.append(
            f"{row.get('year')}: DPS {_fmt_dps(row.get('dps'))} · "
            f"성향 {_format_pct(row.get('payout_pct'))} · "
            f"시가배당률 {_format_pct(row.get('yield_pct'))} · "
            f"현금배당 {_format_krw(row.get('cash_total_krw'))}"
        )
    q = div.get("quarterly_dps") or []
    if q:
        lines.append("")
        lines.append(f"<b>{div.get('source_year')} 분기 누적→추정 DPS</b>")
        for row in q:
            lines.append(
                f"{row.get('period')}: 누적 {_fmt_dps(row.get('dps_cum'))} · "
                f"구간 {_fmt_dps(row.get('dps_q'))}"
            )
    if div.get("viewer"):
        lines.append(f'\n<a href="{div["viewer"]}">배당 공시 원문</a>')
    lines.extend(
        [
            "",
            "<i>현금성 주주환원율(배당+자사주)은 /esg return 에서 자사주 수량과 함께 확인.</i>",
            "<i>Source: Open DART alotMatter · Not financial advice.</i>",
        ]
    )
    return "\n".join(lines)


def format_esg_own_telegram(profile: dict[str, Any]) -> str:
    own = profile.get("ownership") or {}
    major = profile.get("majorstock") or {}
    treasury = profile.get("treasury") or {}
    lines = [
        f"<b>🏛️ ESG · 소유구조 — {_esc(profile['corp_name'])}</b>",
        f"<i>{profile['generated_at']} · 사업연도 {own.get('year', '?')}</i>",
    ]
    if profile.get("stock_code"):
        lines.append(f"종목 <code>{profile['stock_code']}</code>")
    lines.extend(
        [
            "",
            "<b>지분 요약</b>",
            f"최대주주 {_format_pct(own.get('largest_pct'))} · "
            f"특수관계인 {_format_pct(own.get('related_pct'))} · "
            f"합산 {_format_pct(own.get('largest_related_pct'))}",
        ]
    )
    minority = own.get("minority") or {}
    if minority:
        holders_n = minority.get("holders")
        holders_s = f"{holders_n:,.0f}명" if holders_n is not None else "n/a"
        lines.append(
            f"소액주주 지분 {_format_pct(minority.get('stock_rate'))} (주주수 {holders_s})"
        )
    lines.append("")
    lines.append("<b>최대주주·특수관계인 TOP</b>")
    top = (own.get("largest") or []) + (own.get("related") or [])
    top = sorted(top, key=lambda h: h.get("pct") or 0, reverse=True)[:8]
    for idx, h in enumerate(top, start=1):
        lines.append(
            f"{idx}. {_esc(h.get('name'))} ({_esc(h.get('relate'))}) "
            f"{_format_pct(h.get('pct'))} · {_fmt_shares(h.get('shares'))}"
        )
    if treasury.get("totals"):
        lines.append("")
        lines.append("<b>자기주식 (기말)</b>")
        for t in treasury["totals"]:
            lines.append(
                f"{_esc(t.get('stock_knd'))}: {_fmt_shares(t.get('end'))} "
                f"(취득 {_fmt_shares(t.get('acquired'))} · 소각 {_fmt_shares(t.get('retired'))})"
            )
    lines.extend(["", "<b>5% 대량보유 신호</b>", f"· {_esc(major.get('signal'))}"])
    for item in (major.get("items") or [])[:5]:
        link = f'<a href="{item["viewer"]}">원문</a>' if item.get("viewer") else ""
        lines.append(
            f"· {item.get('date')} {_esc(item.get('reporter'))} "
            f"{_format_pct(item.get('pct'))} (Δ {_format_pct(item.get('pct_chg'), signed=True)}) {link}"
        )
    if own.get("viewer"):
        lines.append(f'\n<a href="{own["viewer"]}">최대주주 현황 원문</a>')
    lines.extend(["", "<i>Source: Open DART hyslr/majorstock · Not financial advice.</i>"])
    return "\n".join(lines)


def format_esg_return_telegram(profile: dict[str, Any]) -> str:
    agg = profile.get("aggregates") or {}
    treasury = profile.get("treasury") or {}
    div = profile.get("dividend") or {}
    lines = [
        f"<b>🔁 ESG · 주주환원 — {_esc(profile['corp_name'])}</b>",
        f"<i>{profile['generated_at']}</i>",
    ]
    if profile.get("stock_code"):
        lines.append(f"종목 <code>{profile['stock_code']}</code>")
    lines.extend(
        [
            "",
            "<b>합산 (최근 사업연도)</b>",
            f"현금배당 {_format_krw(agg.get('cash_dividend_krw'))}",
            f"자사주 취득 {_fmt_shares(agg.get('treasury_acquired_shares'))} · "
            f"처분 {_fmt_shares(agg.get('treasury_disposed_shares'))} · "
            f"소각 {_fmt_shares(agg.get('treasury_retired_shares'))}",
            "",
            "<b>자기주식 총계 상세</b>",
        ]
    )
    for t in treasury.get("totals") or []:
        lines.append(
            f"{_esc(t.get('stock_knd'))}: 기초 {_fmt_shares(t.get('begin'))} → "
            f"기말 {_fmt_shares(t.get('end'))}"
        )
    if treasury.get("viewer"):
        lines.append(f'<a href="{treasury["viewer"]}">자기주식 현황 원문</a>')
    if div.get("series"):
        row = div["series"][0]
        lines.extend(
            [
                "",
                f"<b>배당 스냅샷 ({row.get('year')})</b>",
                f"DPS {_fmt_dps(row.get('dps'))} · 성향 {_format_pct(row.get('payout_pct'))} · "
                f"시가배당률 {_format_pct(row.get('yield_pct'))}",
            ]
        )
        if div.get("viewer"):
            lines.append(f'<a href="{div["viewer"]}">배당 원문</a>')
    lines.append("")
    lines.append("<b>공시 타임라인 (최근)</b>")
    for item in (profile.get("timeline") or [])[:12]:
        link = f'<a href="{item["viewer"]}">원문</a>' if item.get("viewer") else ""
        lines.append(f"· {item.get('date')} {_esc(item.get('report_nm'))} {link}")
    if not profile.get("timeline"):
        lines.append("· 해당 키워드 공시 없음")
    lines.extend(["", "<i>Source: Open DART · Not financial advice.</i>"])
    return "\n".join(lines)


def format_esg_accident_telegram(profile: dict[str, Any]) -> str:
    scope = profile.get("corp_name") or "전체 시장"
    lines = [
        f"<b>⚠️ ESG · 중대재해 공시 스크리닝 — {_esc(scope)}</b>",
        f"<i>{profile['generated_at']} · 최근 {profile.get('days', 90)}일</i>",
        f"키워드: {', '.join(ACCIDENT_KEYWORDS)}",
        "",
    ]
    hits = profile.get("hits") or []
    if not hits:
        lines.append("해당 기간 중대재해 관련 공시가 없습니다.")
    else:
        lines.append(f"<b>{len(hits)}건</b>")
        for idx, item in enumerate(hits, start=1):
            code = item.get("stock_code") or ""
            code_s = f" <code>{code}</code>" if code else ""
            link = f'<a href="{item["viewer"]}">원문</a>' if item.get("viewer") else ""
            lines.append(
                f"{idx}. {item.get('date')} {_esc(item.get('corp_name'))}{code_s}\n"
                f"    {_esc(item.get('report_nm'))} {link}"
            )
    lines.extend(["", "<i>Source: Open DART list · Not legal advice.</i>"])
    return "\n".join(lines)


def format_esg_overview_telegram(profile: dict[str, Any]) -> str:
    fin = profile["fin"]
    dart = fin["dart"]
    ratios = dart["ratios"]
    own = profile["own"]["ownership"]
    major = profile["own"]["majorstock"]
    div = profile["div"]["dividend"]
    lines = [
        f"<b>🧭 ESG 허브 — {_esc(profile['corp_name'])}</b>",
        f"<i>{profile['generated_at']}</i>",
    ]
    if profile.get("stock_code"):
        lines.append(f"종목 <code>{profile['stock_code']}</code>")
    lines.extend(
        [
            "",
            f"<b>실적 {dart['latest_year']}</b>",
            f"매출 {_format_krw(dart['latest_metrics'].get('revenue'))} · "
            f"영업이익 {_format_krw(dart['latest_metrics'].get('operating_profit'))} · "
            f"ROE {_format_pct(ratios.get('roe'))}",
            f"부채비율 {_format_pct(ratios.get('debt_ratio'))}",
            "",
            "<b>소유</b>",
            f"최대+특수 {_format_pct(own.get('largest_related_pct'))} · "
            f"{_esc(major.get('signal'))}",
            "",
            "<b>배당</b>",
        ]
    )
    if div.get("series"):
        row = div["series"][0]
        lines.append(
            f"{row.get('year')} DPS {_fmt_dps(row.get('dps'))} · "
            f"성향 {_format_pct(row.get('payout_pct'))} · "
            f"시가배당률 {_format_pct(row.get('yield_pct'))}"
        )
    else:
        lines.append("배당 데이터 없음")
    lines.append("")
    lines.append("<b>주주환원 공시 (최근)</b>")
    for item in (profile.get("timeline") or [])[:5]:
        link = f'<a href="{item["viewer"]}">원문</a>' if item.get("viewer") else ""
        lines.append(f"· {item.get('date')} {_esc(item.get('report_nm'))} {link}")
    lines.extend(
        [
            "",
            "<b>세부 명령</b>",
            "<code>/esg fin 기업</code> · <code>/esg div 기업</code> · "
            "<code>/esg own 기업</code>",
            "<code>/esg return 기업</code> · <code>/esg accident [기업]</code>",
            "",
            "<i>Source: Open DART · Not financial advice.</i>",
        ]
    )
    return "\n".join(lines)


ESG_HELP = """\
<b>🧭 /esg — ESG·거버넌스 + Climate Risk</b>

<code>/esg monitor</code> — Climate Risk Monitor (유럽 이상기후·지진 차트)
<code>/esg 삼성전자</code> — 허브 요약
<code>/esg fin 삼성전자</code> — 실적·현금흐름·건전성
<code>/esg div 삼성전자</code> — 3년 배당 (DPS·성향·시가배당률)
<code>/esg own 삼성전자</code> — 소유구조 + 5% 대량보유 신호
<code>/esg return 삼성전자</code> — 자사주·주주환원 공시 타임라인
<code>/esg accident</code> — 최근 90일 중대재해 공시 스크리닝
<code>/esg accident 기업</code> — 특정 기업만

종목코드도 가능: <code>/esg 005930</code>
"""

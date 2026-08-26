"""NLP pulse keyed sources for the dashboard — DART, SEC 8-K, Finnhub earnings.

API keys live on the Render bot. Vercel calls /api/web/nlp-pulse instead of
expecting DART_API_KEY / FINNHUB_API_KEY in the webapp env.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
LOOKBACK_DAYS = 2

DART_EVENT_KEYS = (
    "실적",
    "배당",
    "유상증자",
    "자기주식",
    "최대주주",
    "합병",
    "영업정지",
    "횡령",
    "조회공시",
    "공급계약",
    "단일판매",
    "투자판단",
    "소송",
    "배임",
    "감사보고서",
)

# Keep in sync with webapp/src/lib/nlpPulse.ts NLP_UNIVERSE tickers.
KR_STOCK_CODES = {
    "005930",
    "000660",
    "373220",
    "005380",
    "000270",
    "207940",
    "068270",
    "105560",
    "055550",
    "035420",
    "035720",
    "005490",
    "006400",
    "012450",
    "009540",
    "015760",
    "051910",
    "028260",
    "012330",
    "003670",
}
US_TICKERS = {
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "GOOGL",
    "GOOG",
    "AVGO",
    "TSLA",
    "BRK.B",
    "BRK-B",
    "JPM",
    "LLY",
    "UNH",
    "XOM",
    "V",
    "JNJ",
    "WMT",
    "MA",
    "PG",
    "HD",
    "COST",
    "NFLX",
    "ORCL",
    "BAC",
}


def _iso(d: datetime) -> str:
    return d.date().isoformat()


def _ymd(d: datetime) -> str:
    return d.strftime("%Y%m%d")


def _fetch_dart() -> tuple[list[dict[str, Any]], str | None]:
    try:
        from dart_data import _dart_get
    except Exception as exc:
        return [], f"DART import: {exc}"

    end = datetime.now(KST)
    start = end - timedelta(days=LOOKBACK_DAYS)
    hits: list[dict[str, Any]] = []
    try:
        for page in range(1, 5):
            payload = _dart_get(
                "list.json",
                {
                    "bgn_de": _ymd(start),
                    "end_de": _ymd(end),
                    "page_count": "100",
                    "page_no": str(page),
                },
            )
            rows = list(payload.get("list") or [])
            if not rows:
                break
            for row in rows:
                report = str(row.get("report_nm") or "").strip()
                matched = [k for k in DART_EVENT_KEYS if k in report]
                code = str(row.get("stock_code") or "").strip()
                if not matched or code not in KR_STOCK_CODES:
                    continue
                rcept = str(row.get("rcept_no") or "")
                raw_dt = str(row.get("rcept_dt") or "")
                date = (
                    f"{raw_dt[:4]}-{raw_dt[4:6]}-{raw_dt[6:8]}"
                    if len(raw_dt) == 8
                    else raw_dt
                )
                hits.append(
                    {
                        "corp_name": str(row.get("corp_name") or ""),
                        "stock_code": code,
                        "report_nm": report,
                        "rcept_no": rcept,
                        "date": date,
                        "matched": matched,
                        "url": (
                            f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept}"
                            if rcept
                            else None
                        ),
                    }
                )
                if len(hits) >= 40:
                    return hits, None
        return hits, None
    except Exception as exc:
        return hits, str(exc)[:180]


def _fetch_sec() -> tuple[list[dict[str, Any]], str | None]:
    try:
        from macro_supplements import _fetch_edgar_search
    except Exception as exc:
        return [], f"SEC import: {exc}"

    end = datetime.now(KST)
    start = end - timedelta(days=LOOKBACK_DAYS)
    try:
        payload = _fetch_edgar_search(
            {
                "q": (
                    '"Item 2.02" OR "Item 5.02" OR "Item 8.01" OR "Item 7.01" '
                    "OR earnings OR guidance"
                ),
                "forms": "8-K",
                "dateRange": "custom",
                "startdt": _iso(start),
                "enddt": _iso(end),
                "from": 0,
                "size": 40,
            }
        )
        hits: list[dict[str, Any]] = []
        for hit in (payload.get("hits") or {}).get("hits") or []:
            src = hit.get("_source") or {}
            tickers = [str(t).upper() for t in (src.get("tickers") or [])]
            wanted = [t for t in tickers if t in US_TICKERS or t.replace("-", ".") in US_TICKERS]
            if not wanted:
                continue
            display = (src.get("display_names") or [""])[0]
            company = str(display).split("(")[0].strip()
            items = src.get("items") or []
            cik = src.get("cik")
            hits.append(
                {
                    "company": company,
                    "tickers": wanted,
                    "items": items,
                    "form": src.get("form") or "8-K",
                    "file_date": src.get("file_date") or _iso(end),
                    "cik": cik,
                    "url": (
                        f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}"
                        if cik
                        else "https://www.sec.gov/edgar/search/"
                    ),
                }
            )
        return hits, None
    except Exception as exc:
        return [], str(exc)[:180]


def _fetch_earnings() -> tuple[list[dict[str, Any]], str | None]:
    try:
        from finnhub_market import _get
    except Exception as exc:
        return [], f"Finnhub import: {exc}"

    start = datetime.now(KST) - timedelta(days=1)
    end = datetime.now(KST) + timedelta(days=7)
    try:
        payload = _get(
            "calendar/earnings",
            {"from": _iso(start), "to": _iso(end)},
        )
        rows = payload.get("earningsCalendar") or []
        hits: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = str(row.get("symbol") or "").upper()
            code = sym.replace(".KS", "").replace(".KQ", "")
            if sym not in US_TICKERS and code not in KR_STOCK_CODES:
                continue
            hits.append(
                {
                    "symbol": sym,
                    "date": row.get("date") or "",
                    "hour": row.get("hour") or "",
                    "epsEstimate": row.get("epsEstimate"),
                    "epsActual": row.get("epsActual"),
                }
            )
        return hits, None
    except Exception as exc:
        return [], str(exc)[:180]


def build_nlp_pulse_keyed() -> dict[str, Any]:
    dart, dart_err = _fetch_dart()
    sec, sec_err = _fetch_sec()
    earnings, earn_err = _fetch_earnings()
    sources: list[str] = []
    errors: list[str] = []
    if dart_err:
        errors.append(f"DART {dart_err}")
    else:
        sources.append("Open DART")
    if sec_err:
        errors.append(f"SEC {sec_err}")
    else:
        sources.append("SEC EDGAR")
    if earn_err:
        errors.append(f"Finnhub {earn_err}")
    else:
        sources.append("Finnhub earnings")
    return {
        "ok": True,
        "generated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "lookback_days": LOOKBACK_DAYS,
        "dart": dart,
        "sec": sec,
        "earnings": earnings,
        "sources": sources,
        "errors": errors,
    }

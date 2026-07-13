"""Consensus financial estimates for /fin_estimate (US + Korea).

Primary: Financial Modeling Prep ``/stable/analyst-estimates``
  - revenueAvg / ebitAvg / netIncomeAvg / epsAvg by fiscal year-end date
  - Free plan covers US; Korea symbols often require a paid FMP plan

Fallback:
  - Korea: Naver/WiseReport (매출·영업이익·당기순이익, ~2 estimate years)
  - US (if FMP fails): Yahoo revenue/EPS only

Target display years: 2026 / 2027 / 2028 (blank when vendor has no row).
"""

from __future__ import annotations

import html
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests
import yfinance as yf
from lxml import html as lxml_html

from stock_crawler import _quiet_yfinance

KST = timezone(timedelta(hours=9))
TARGET_YEARS = (2026, 2027, 2028)
PROJECT_DIR = Path(__file__).resolve().parent
FMP_STABLE = "https://financialmodelingprep.com/stable"
NAVER_COMP_ROOT = "https://navercomp.wisereport.co.kr"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _ensure_dotenv() -> None:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_DIR / ".env", override=False)


def _fmp_api_key() -> str:
    _ensure_dotenv()
    return os.environ.get("FMP_API_KEY", "").strip()


def parse_fin_estimate_tickers(command: str) -> list[str]:
    parts = command.strip().split()
    if len(parts) < 2:
        raise ValueError("missing ticker")
    tokens = [p.strip() for p in parts[1:] if p.strip()]
    if not tokens:
        raise ValueError("missing ticker")
    if len(tokens) > 6:
        raise ValueError("too many tickers (max 6)")
    return tokens


def _looks_korean(text: str) -> bool:
    return bool(re.search(r"[가-힣]", text))


def _yahoo_suffix_for_code(code: str) -> str:
    """Prefer .KS / .KQ from committed universe lists; default .KS."""
    from pathlib import Path

    root = Path(__file__).resolve().parent / "data" / "universes"
    for path, suffix in (
        (root / "kosdaq100.json", ".KQ"),
        (root / "kospi200.json", ".KS"),
    ):
        if not path.is_file():
            continue
        try:
            import json

            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for row in doc.get("constituents") or []:
            if str(row.get("code") or "").strip() == code:
                return suffix
    return ".KS"


def resolve_fin_estimate_symbol(token: str) -> dict[str, Any]:
    """Resolve a user token to a Yahoo/FMP symbol + market metadata."""
    raw = token.strip()
    if not raw:
        raise ValueError("empty ticker")

    upper = raw.upper().replace(" ", "")
    if upper.endswith((".KS", ".KQ")):
        code = upper.split(".", 1)[0]
        if not re.fullmatch(r"\d{6}", code):
            raise ValueError(f"invalid Korea ticker: {token}")
        from kr_names import format_kr_ticker_label

        return {
            "query": raw,
            "market": "KR",
            "code": code,
            "yahoo": upper,
            "fmp": upper,
            "display": format_kr_ticker_label(upper),
            "currency": "KRW",
        }

    if re.fullmatch(r"\d{6}", upper):
        suffix = _yahoo_suffix_for_code(upper)
        yahoo = f"{upper}{suffix}"
        from kr_names import format_kr_ticker_label

        return {
            "query": raw,
            "market": "KR",
            "code": upper,
            "yahoo": yahoo,
            "fmp": yahoo,
            "display": format_kr_ticker_label(yahoo),
            "currency": "KRW",
        }

    if _looks_korean(raw):
        from dart_data import resolve_corp
        from kr_names import format_kr_ticker_label

        corp = resolve_corp(raw)
        code = str(corp.get("stock_code") or "").strip()
        if not re.fullmatch(r"\d{6}", code):
            raise RuntimeError(f"'{raw}' has no 6-digit stock code in DART.")
        suffix = _yahoo_suffix_for_code(code)
        yahoo = f"{code}{suffix}"
        return {
            "query": raw,
            "market": "KR",
            "code": code,
            "yahoo": yahoo,
            "fmp": yahoo,
            "display": corp.get("corp_name") or format_kr_ticker_label(yahoo),
            "currency": "KRW",
            "corp_name": corp.get("corp_name"),
        }

    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,11}", upper):
        raise ValueError(f"invalid ticker: {token}")
    return {
        "query": raw,
        "market": "US",
        "code": None,
        "yahoo": upper,
        "fmp": upper,
        "display": upper,
        "currency": "USD",
    }


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def _parse_kr_number(text: str) -> float | None:
    cleaned = re.sub(r"[^\d.\-]", "", (text or "").replace(",", ""))
    if not cleaned or cleaned in {"-", "."}:
        return None
    return _safe_float(cleaned)


def _year_from_fy_end_ts(ts: Any) -> int | None:
    value = _safe_float(ts)
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).year
    except (OverflowError, OSError, ValueError):
        return None


def _empty_year_bucket() -> dict[str, Any]:
    return {
        "revenue": None,
        "operating_income": None,
        "net_income": None,
        "eps": None,
        "revenue_analysts": None,
        "eps_analysts": None,
        "revenue_low": None,
        "revenue_high": None,
        "eps_low": None,
        "eps_high": None,
        "sources": [],
        "notes": [],
    }


def _merge_year_bucket(dst: dict[str, Any], src: dict[str, Any], *, overwrite: bool = False) -> None:
    for key in (
        "revenue",
        "operating_income",
        "net_income",
        "eps",
        "revenue_analysts",
        "eps_analysts",
        "revenue_low",
        "revenue_high",
        "eps_low",
        "eps_high",
    ):
        if src.get(key) is None:
            continue
        if overwrite or dst.get(key) is None:
            dst[key] = src[key]
    dst["sources"] = list(dict.fromkeys((dst.get("sources") or []) + (src.get("sources") or [])))
    dst["notes"] = list(dict.fromkeys((dst.get("notes") or []) + (src.get("notes") or [])))


def _fmp_get(path: str, params: dict[str, Any]) -> Any:
    key = _fmp_api_key()
    if not key:
        raise RuntimeError("FMP_API_KEY not set in .env")
    response = requests.get(
        f"{FMP_STABLE}{path}",
        params={**params, "apikey": key},
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    text = (response.text or "").strip()
    # Free plan blocks some non-US symbols with HTTP 402 + plain-text premium notice.
    if response.status_code == 402:
        raise RuntimeError(
            "FMP plan does not include this symbol/endpoint "
            "(KR tickers often need a paid plan)"
        )
    if response.status_code == 403:
        raise RuntimeError(f"FMP forbidden: {text[:180]}")
    if response.status_code != 200:
        raise RuntimeError(f"FMP HTTP {response.status_code}: {text[:180]}")
    try:
        payload = response.json()
    except ValueError as exc:
        if "Premium Query Parameter" in text or "upgrade your plan" in text.lower():
            raise RuntimeError(
                "FMP plan does not include this symbol/endpoint "
                "(KR tickers often need a paid plan)"
            ) from exc
        raise RuntimeError(f"FMP non-JSON response: {text[:180]}") from exc
    if isinstance(payload, dict) and payload.get("Error Message"):
        raise RuntimeError(str(payload["Error Message"])[:240])
    return payload


def fetch_fmp_estimates(fmp_symbol: str) -> dict[str, Any]:
    """FMP annual analyst estimates → TARGET_YEARS buckets."""
    out: dict[str, Any] = {
        "ok": False,
        "years": {year: _empty_year_bucket() for year in TARGET_YEARS},
        "company_name": fmp_symbol,
        "currency": None,
        "fy_end_month": None,
        "errors": [],
        "source": "Financial Modeling Prep",
        "raw_count": 0,
    }
    try:
        rows = _fmp_get(
            "/analyst-estimates",
            # Free plan rejects limit>10 with a premium notice.
            {"symbol": fmp_symbol, "period": "annual", "limit": 10},
        )
    except Exception as exc:
        out["errors"].append(f"FMP estimates: {exc}")
        return out

    if not isinstance(rows, list) or not rows:
        out["errors"].append("FMP estimates empty")
        return out

    try:
        profiles = _fmp_get("/profile", {"symbol": fmp_symbol})
        if isinstance(profiles, list) and profiles:
            profile = profiles[0]
            out["company_name"] = profile.get("companyName") or fmp_symbol
            out["currency"] = profile.get("currency")
    except Exception:
        pass

    filled = 0
    for row in rows:
        date_raw = str(row.get("date") or "")
        match = re.match(r"^(20\d{2})-(\d{2})-(\d{2})", date_raw)
        if not match:
            continue
        year = int(match.group(1))
        month = int(match.group(2))
        if out.get("fy_end_month") is None:
            out["fy_end_month"] = month
        if year not in out["years"]:
            continue
        bucket = out["years"][year]
        revenue = _safe_float(row.get("revenueAvg"))
        ebit = _safe_float(row.get("ebitAvg"))
        net_income = _safe_float(row.get("netIncomeAvg"))
        eps = _safe_float(row.get("epsAvg"))
        if revenue is not None:
            bucket["revenue"] = revenue
            bucket["revenue_low"] = _safe_float(row.get("revenueLow"))
            bucket["revenue_high"] = _safe_float(row.get("revenueHigh"))
            bucket["revenue_analysts"] = _safe_float(row.get("numAnalystsRevenue"))
            bucket["sources"].append("FMP revenue")
        if ebit is not None:
            # FMP exposes EBIT consensus (closest free proxy for operating income).
            bucket["operating_income"] = ebit
            bucket["sources"].append("FMP EBIT")
            bucket["notes"].append("영업이익 열=EBIT(FMP)")
        if net_income is not None:
            bucket["net_income"] = net_income
            bucket["sources"].append("FMP net income")
        if eps is not None:
            bucket["eps"] = eps
            bucket["eps_low"] = _safe_float(row.get("epsLow"))
            bucket["eps_high"] = _safe_float(row.get("epsHigh"))
            bucket["eps_analysts"] = _safe_float(row.get("numAnalystsEps"))
            bucket["sources"].append("FMP EPS")
        filled += 1

    out["raw_count"] = filled
    if filled == 0:
        out["errors"].append("FMP returned rows but none matched 2026–2028")
        return out
    out["ok"] = True
    return out


def _yahoo_raw(node: Any) -> float | None:
    if node is None:
        return None
    if isinstance(node, dict):
        return _safe_float(node.get("raw", node.get("fmt")))
    return _safe_float(node)


def _yahoo_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/plain,*/*",
        }
    )
    return session


def _yahoo_crumb(session: requests.Session) -> str:
    session.get("https://fc.yahoo.com", timeout=20)
    response = session.get(
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
        timeout=20,
    )
    if response.status_code != 200 or not response.text.strip():
        raise RuntimeError(f"Yahoo crumb unavailable ({response.status_code})")
    return response.text.strip()


def _fetch_yahoo_quote_summary(yahoo_symbol: str) -> dict[str, Any]:
    """Direct quoteSummary (earningsTrend) — avoids heavier yfinance .info pulls."""
    session = _yahoo_session()
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            crumb = _yahoo_crumb(session)
            response = session.get(
                f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{yahoo_symbol}",
                params={
                    "modules": "earningsTrend,defaultKeyStatistics,price,summaryDetail",
                    "crumb": crumb,
                },
                timeout=30,
            )
            if response.status_code == 429:
                raise RuntimeError("Yahoo rate limited (429)")
            response.raise_for_status()
            payload = response.json()
            results = (payload.get("quoteSummary") or {}).get("result") or []
            if not results:
                err = (payload.get("quoteSummary") or {}).get("error") or {}
                raise RuntimeError(err.get("description") or "empty quoteSummary")
            return results[0]
        except Exception as exc:
            last_exc = exc
            if attempt < 2:
                import time

                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last_exc) if last_exc else "Yahoo quoteSummary failed")


def _apply_yahoo_period_estimates(
    out: dict[str, Any],
    *,
    period_map: dict[str, int],
    rev: pd.DataFrame,
    eps: pd.DataFrame,
    shares: float | None,
) -> None:
    for period in ("0y", "+1y"):
        year = period_map.get(period)
        if year not in out["years"]:
            continue
        bucket = out["years"][year]
        if period in rev.index:
            row = rev.loc[period]
            bucket["revenue"] = _safe_float(row.get("avg"))
            bucket["revenue_low"] = _safe_float(row.get("low"))
            bucket["revenue_high"] = _safe_float(row.get("high"))
            bucket["revenue_analysts"] = _safe_float(row.get("numberOfAnalysts"))
            bucket["sources"].append("Yahoo revenue")
        if period in eps.index:
            row = eps.loc[period]
            bucket["eps"] = _safe_float(row.get("avg"))
            bucket["eps_low"] = _safe_float(row.get("low"))
            bucket["eps_high"] = _safe_float(row.get("high"))
            bucket["eps_analysts"] = _safe_float(row.get("numberOfAnalysts"))
            bucket["sources"].append("Yahoo EPS")
            if bucket["eps"] is not None and shares:
                bucket["net_income"] = bucket["eps"] * shares
                bucket["notes"].append("순이익=EPS×발행주식수(근사)")
                bucket["sources"].append("Yahoo EPS×shares")


def fetch_yahoo_estimates(yahoo_symbol: str) -> dict[str, Any]:
    """Pull Yahoo consensus revenue/EPS for 0y and +1y; map to FY-end calendar years."""
    out: dict[str, Any] = {
        "ok": False,
        "years": {year: _empty_year_bucket() for year in TARGET_YEARS},
        "period_map": {},
        "company_name": yahoo_symbol,
        "currency": None,
        "shares_outstanding": None,
        "fy_end_month": None,
        "errors": [],
        "source": "Yahoo Finance",
    }

    # 1) Prefer light quoteSummary HTTP (less likely to trip yfinance rate limits).
    try:
        summary = _fetch_yahoo_quote_summary(yahoo_symbol)
        price = summary.get("price") or {}
        dks = summary.get("defaultKeyStatistics") or {}
        trends = ((summary.get("earningsTrend") or {}).get("trend")) or []

        out["company_name"] = (
            (price.get("shortName") or price.get("longName") or yahoo_symbol)
        )
        out["currency"] = (
            (price.get("currency") or (dks.get("financialCurrency")))
            if not isinstance(price.get("currency"), dict)
            else (price.get("currency") or {}).get("raw")
        )
        if isinstance(out["currency"], dict):
            out["currency"] = out["currency"].get("raw") or out["currency"].get("fmt")

        shares = _yahoo_raw(dks.get("sharesOutstanding")) or _yahoo_raw(
            dks.get("impliedSharesOutstanding")
        )
        out["shares_outstanding"] = shares

        next_fy_year = _year_from_fy_end_ts(_yahoo_raw(dks.get("nextFiscalYearEnd")))
        last_fy_year = _year_from_fy_end_ts(_yahoo_raw(dks.get("lastFiscalYearEnd")))
        if next_fy_year is None and last_fy_year is not None:
            next_fy_year = last_fy_year + 1
        period_map: dict[str, int] = {}
        if next_fy_year is not None:
            period_map["0y"] = next_fy_year
            period_map["+1y"] = next_fy_year + 1
            try:
                ts = int(_yahoo_raw(dks.get("nextFiscalYearEnd")) or 0)
                if ts:
                    out["fy_end_month"] = datetime.fromtimestamp(
                        ts, tz=timezone.utc
                    ).month
            except Exception:
                pass
        out["period_map"] = period_map

        rev_rows: list[dict[str, Any]] = []
        eps_rows: list[dict[str, Any]] = []
        for item in trends:
            period = item.get("period")
            if period not in {"0y", "+1y"}:
                continue
            rev_est = item.get("revenueEstimate") or {}
            eps_est = item.get("earningsEstimate") or {}
            rev_rows.append(
                {
                    "period": period,
                    "avg": _yahoo_raw(rev_est.get("avg")),
                    "low": _yahoo_raw(rev_est.get("low")),
                    "high": _yahoo_raw(rev_est.get("high")),
                    "numberOfAnalysts": _yahoo_raw(rev_est.get("numberOfAnalysts")),
                }
            )
            eps_rows.append(
                {
                    "period": period,
                    "avg": _yahoo_raw(eps_est.get("avg")),
                    "low": _yahoo_raw(eps_est.get("low")),
                    "high": _yahoo_raw(eps_est.get("high")),
                    "numberOfAnalysts": _yahoo_raw(eps_est.get("numberOfAnalysts")),
                }
            )
        rev = (
            pd.DataFrame(rev_rows).set_index("period")
            if rev_rows
            else pd.DataFrame()
        )
        eps = (
            pd.DataFrame(eps_rows).set_index("period")
            if eps_rows
            else pd.DataFrame()
        )
        if rev.empty and eps.empty:
            raise RuntimeError("Yahoo earningsTrend empty")
        _apply_yahoo_period_estimates(
            out, period_map=period_map, rev=rev, eps=eps, shares=shares
        )
        out["ok"] = True
        return out
    except Exception as exc:
        out["errors"].append(f"Yahoo quoteSummary: {exc}")

    # 2) Fallback: yfinance analysis properties.
    try:
        with _quiet_yfinance():
            ticker = yf.Ticker(yahoo_symbol)
            info = ticker.info or {}
            rev = ticker.revenue_estimate
            eps = ticker.earnings_estimate
    except Exception as exc:
        out["errors"].append(f"Yahoo yfinance: {exc}")
        return out

    out["company_name"] = (
        info.get("shortName") or info.get("longName") or yahoo_symbol
    )
    out["currency"] = info.get("currency") or info.get("financialCurrency")
    shares = _safe_float(info.get("sharesOutstanding")) or _safe_float(
        info.get("impliedSharesOutstanding")
    )
    out["shares_outstanding"] = shares

    next_fy_year = _year_from_fy_end_ts(info.get("nextFiscalYearEnd"))
    last_fy_year = _year_from_fy_end_ts(info.get("lastFiscalYearEnd"))
    if next_fy_year is None and last_fy_year is not None:
        next_fy_year = last_fy_year + 1
    period_map = {}
    if next_fy_year is not None:
        period_map["0y"] = next_fy_year
        period_map["+1y"] = next_fy_year + 1
        try:
            ts = int(info.get("nextFiscalYearEnd"))
            out["fy_end_month"] = datetime.fromtimestamp(ts, tz=timezone.utc).month
        except Exception:
            out["fy_end_month"] = None
    out["period_map"] = period_map

    if not isinstance(rev, pd.DataFrame):
        rev = pd.DataFrame()
    if not isinstance(eps, pd.DataFrame):
        eps = pd.DataFrame()
    if rev.empty and eps.empty:
        out["errors"].append("Yahoo revenue/EPS estimates unavailable")
        return out

    _apply_yahoo_period_estimates(
        out, period_map=period_map, rev=rev, eps=eps, shares=shares
    )
    out["ok"] = True
    # Clear soft quoteSummary error if yfinance recovered.
    out["errors"] = [e for e in out["errors"] if "quoteSummary" not in e]
    return out


def _naver_encparam(code: str) -> str:
    url = f"{NAVER_COMP_ROOT}/v2/company/c1010001.aspx?cmp_cd={code}"
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Referer": "https://finance.naver.com/"},
        timeout=25,
    )
    response.raise_for_status()
    match = re.search(r"encparam\s*[:=]\s*'([^']+)'", response.text)
    if not match:
        raise RuntimeError(f"Naver encparam missing for {code}")
    return match.group(1)


def fetch_naver_consensus(code: str) -> dict[str, Any]:
    """Naver/WiseReport annual consensus: 매출·영업이익·당기순이익 (억원)."""
    out: dict[str, Any] = {
        "ok": False,
        "years": {year: _empty_year_bucket() for year in TARGET_YEARS},
        "unit": "억원",
        "errors": [],
        "source": "Naver/WiseReport",
        "raw_rows": [],
    }
    try:
        encparam = _naver_encparam(code)
        url = (
            f"{NAVER_COMP_ROOT}/v2/company/cF1002.aspx"
            f"?cmp_cd={code}&finGubun=MAIN&frqTyp=0&freq=A&encparam={encparam}"
        )
        response = requests.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Referer": f"{NAVER_COMP_ROOT}/v2/company/c1010001.aspx?cmp_cd={code}",
            },
            timeout=25,
        )
        response.raise_for_status()
    except Exception as exc:
        out["errors"].append(f"Naver consensus failed: {exc}")
        return out

    try:
        tree = lxml_html.fromstring(response.content)
    except Exception as exc:
        out["errors"].append(f"Naver HTML parse failed: {exc}")
        return out

    tables = tree.xpath("//table[@id='cTB25']") or tree.xpath("//table")
    if not tables:
        out["errors"].append("Naver consensus table not found")
        return out
    table = tables[0]

    rows: list[list[str]] = []
    for tr in table.xpath(".//tr"):
        cells = [
            " ".join(c.itertext()).strip()
            for c in tr.xpath("./th|./td")
        ]
        cells = [re.sub(r"\s+", " ", c) for c in cells if c is not None]
        if cells:
            rows.append(cells)

    estimate_rows = 0
    for cells in rows:
        label = cells[0] if cells else ""
        match = re.match(r"^(20\d{2})\s*\(\s*E\s*\)", label)
        if not match:
            continue
        year = int(match.group(1))
        # Columns: 재무년월, 매출, YoY, 영업이익, 당기순이익, EPS, ...
        if len(cells) < 5:
            continue
        revenue = _parse_kr_number(cells[1])
        operating = _parse_kr_number(cells[3])
        net_income = _parse_kr_number(cells[4])
        eps = _parse_kr_number(cells[5]) if len(cells) > 5 else None
        out["raw_rows"].append(
            {
                "year": year,
                "revenue_eok": revenue,
                "operating_income_eok": operating,
                "net_income_eok": net_income,
                "eps": eps,
            }
        )
        if year not in out["years"]:
            continue
        bucket = out["years"][year]
        # Store as KRW (억원 → 원)
        if revenue is not None:
            bucket["revenue"] = revenue * 1e8
            bucket["sources"].append("Naver 매출")
        if operating is not None:
            bucket["operating_income"] = operating * 1e8
            bucket["sources"].append("Naver 영업이익")
        if net_income is not None:
            bucket["net_income"] = net_income * 1e8
            bucket["sources"].append("Naver 당기순이익")
        if eps is not None:
            bucket["eps"] = eps
            bucket["sources"].append("Naver EPS")
        estimate_rows += 1

    if estimate_rows == 0:
        out["errors"].append("Naver estimate rows not found")
        return out
    out["ok"] = True
    return out


def build_fin_estimate_profile(token: str) -> dict[str, Any]:
    resolved = resolve_fin_estimate_symbol(token)
    generated_at = datetime.now(KST)
    profile: dict[str, Any] = {
        "query": token,
        "resolved": resolved,
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M KST"),
        "years": {year: _empty_year_bucket() for year in TARGET_YEARS},
        "sources": [],
        "notes": [],
        "errors": [],
    }

    fmp_symbol = resolved.get("fmp") or resolved["yahoo"]
    fmp = fetch_fmp_estimates(fmp_symbol)
    profile["errors"].extend(fmp.get("errors") or [])
    if fmp.get("company_name") and resolved["market"] == "US":
        resolved["display"] = fmp["company_name"]
    if fmp.get("currency"):
        resolved["currency"] = fmp["currency"]
    if fmp.get("fy_end_month"):
        profile["fy_end_month"] = fmp["fy_end_month"]

    if fmp.get("ok"):
        profile["sources"].append("Financial Modeling Prep")
        for year in TARGET_YEARS:
            _merge_year_bucket(profile["years"][year], fmp["years"][year], overwrite=True)

    # Korea: Naver fills gaps / replaces when FMP plan blocks KR symbols.
    if resolved["market"] == "KR" and resolved.get("code"):
        naver = fetch_naver_consensus(resolved["code"])
        profile["errors"].extend(naver.get("errors") or [])
        if naver.get("ok"):
            profile["sources"].append("Naver/WiseReport")
            profile["naver_unit"] = "억원"
            profile["errors"] = [
                err
                for err in profile["errors"]
                if "FMP plan does not include" not in err
            ]
            for year in TARGET_YEARS:
                src = naver["years"][year]
                dst = profile["years"][year]
                # Prefer Naver absolute OP/NI for Korea when present.
                _merge_year_bucket(dst, src, overwrite=True)
                dst["notes"] = [
                    note
                    for note in (dst.get("notes") or [])
                    if "EBIT" not in note and "EPS×" not in note
                ]

    # US fallback only if FMP failed entirely.
    if resolved["market"] == "US" and not fmp.get("ok"):
        yahoo = fetch_yahoo_estimates(resolved["yahoo"])
        profile["errors"].extend(yahoo.get("errors") or [])
        if yahoo.get("company_name"):
            resolved["display"] = yahoo["company_name"]
        if yahoo.get("currency"):
            resolved["currency"] = yahoo["currency"]
        if yahoo.get("fy_end_month") and not profile.get("fy_end_month"):
            profile["fy_end_month"] = yahoo["fy_end_month"]
        if yahoo.get("period_map"):
            profile["yahoo_period_map"] = yahoo["period_map"]
        if yahoo.get("ok"):
            profile["sources"].append("Yahoo Finance")
            for year in TARGET_YEARS:
                _merge_year_bucket(profile["years"][year], yahoo["years"][year])

    if not any(
        profile["years"][year].get(metric) is not None
        for year in TARGET_YEARS
        for metric in ("revenue", "operating_income", "net_income", "eps")
    ):
        profile["errors"].append("No consensus estimates found for target years")

    profile["sources"] = list(dict.fromkeys(profile["sources"]))
    for year in TARGET_YEARS:
        bucket = profile["years"][year]
        bucket["sources"] = list(dict.fromkeys(bucket.get("sources") or []))
        bucket["notes"] = list(dict.fromkeys(bucket.get("notes") or []))

    return profile


def build_fin_estimate_profiles(tokens: list[str]) -> list[dict[str, Any]]:
    return [build_fin_estimate_profile(token) for token in tokens]


def _fmt_money(value: float | None, currency: str, *, market: str) -> str:
    if value is None:
        return "—"
    abs_v = abs(value)
    sign = "-" if value < 0 else ""
    if currency == "KRW" or market == "KR":
        # Show 조 if large enough, else 억
        eok = value / 1e8
        if abs(eok) >= 10000:
            return f"{sign}{eok / 10000:,.1f}조"
        return f"{sign}{eok:,.0f}억"
    # USD / other
    if abs_v >= 1e12:
        return f"{sign}${abs_v / 1e12:,.2f}T"
    if abs_v >= 1e9:
        return f"{sign}${abs_v / 1e9:,.1f}B"
    if abs_v >= 1e6:
        return f"{sign}${abs_v / 1e6:,.0f}M"
    return f"{sign}${abs_v:,.0f}"


def _fmt_eps(value: float | None, currency: str) -> str:
    if value is None:
        return "—"
    if currency == "KRW":
        return f"{value:,.0f}원"
    return f"${value:,.2f}"


def _esc(text: Any) -> str:
    return html.escape(str(text or ""), quote=False)


def format_fin_estimate_telegram(profiles: list[dict[str, Any]], *, excel_name: str = "") -> str:
    if not profiles:
        return "No tickers."

    when = profiles[0].get("generated_at_display") or ""
    lines = [
        "<b>📈 Fin Estimates — 컨센서스 + 분기 재무</b>",
        f"<i>{_esc(when)}</i>",
        "전망: 2026 · 2027 · 2028 매출 / 영업이익(EBIT) / 순이익",
        "이력: 2000년~ 분기 재무 (가능한 구간) → Excel 첨부",
        "<i>Primary estimates: FMP · KR fallback: Naver · History: FMP/Finnhub/SEC/DART</i>",
        "",
    ]

    for profile in profiles:
        resolved = profile.get("resolved") or {}
        display = resolved.get("display") or resolved.get("yahoo")
        yahoo = resolved.get("yahoo")
        currency = resolved.get("currency") or ("KRW" if resolved.get("market") == "KR" else "USD")
        market = resolved.get("market") or "US"
        sources = ", ".join(profile.get("sources") or []) or "n/a"
        fy_month = profile.get("fy_end_month")
        fy_note = f" · FY ends M{fy_month}" if fy_month and fy_month != 12 else ""
        hist = profile.get("history") or {}
        hist_note = ""
        if hist.get("row_count"):
            hist_note = (
                f" · 분기이력 {hist.get('row_count')}행 "
                f"({hist.get('min_period')}→{hist.get('max_period')})"
            )

        lines.append(f"<b>{_esc(display)}</b> (<code>{_esc(yahoo)}</code>){fy_note}{hist_note}")
        lines.append(f"출처: {_esc(sources)}")
        lines.append("<pre>")
        lines.append(f"{'Year':<6}{'Rev':>10}{'OpInc':>10}{'NetInc':>10}{'EPS':>9}")
        for year in TARGET_YEARS:
            bucket = (profile.get("years") or {}).get(year) or {}
            rev = _fmt_money(bucket.get("revenue"), currency, market=market)
            opi = _fmt_money(bucket.get("operating_income"), currency, market=market)
            ni = _fmt_money(bucket.get("net_income"), currency, market=market)
            eps = _fmt_eps(bucket.get("eps"), currency)
            lines.append(f"{year:<6}{rev:>10}{opi:>10}{ni:>10}{eps:>9}")
        lines.append("</pre>")

        notes: list[str] = []
        for year in TARGET_YEARS:
            for note in ((profile.get("years") or {}).get(year) or {}).get("notes") or []:
                notes.append(note)
        notes.extend(profile.get("notes") or [])
        notes = list(dict.fromkeys(notes))
        if notes:
            lines.append("<i>" + _esc(" · ".join(notes[:4])) + "</i>")
        if profile.get("errors"):
            lines.append(
                "<i>⚠ "
                + _esc(" · ".join(str(e) for e in profile["errors"][:3]))
                + "</i>"
            )
        lines.append("")

    if excel_name:
        lines.append(f"📎 Excel: <code>{_esc(excel_name)}</code>")
    lines.append(
        "<i>투자 권유 아님. 2000년 이전/벤더 미제공 구간은 공란. "
        "미국 XBRL·한국 DART 구조화 데이터는 보통 2000년대 후반~2015년 전후부터입니다.</i>"
    )
    message = "\n".join(lines).rstrip()
    if len(message) > 4000:
        message = message[:3980] + "\n…(truncated)"
    return message


def run_fin_estimate(command: str) -> dict[str, Any]:
    tokens = parse_fin_estimate_tickers(command)
    profiles = build_fin_estimate_profiles(tokens)

    from fin_estimate_excel import export_fin_estimate_excel
    from fin_estimate_history import attach_histories

    profiles = attach_histories(profiles)
    excel_path = export_fin_estimate_excel(profiles)
    text = format_fin_estimate_telegram(profiles, excel_name=excel_path.name)
    return {
        "tokens": tokens,
        "profiles": profiles,
        "excel_path": str(excel_path),
        "telegram_messages": [
            {"text": text, "parse_mode": "HTML"},
            {
                "text": f"Fin Estimate workbook — {excel_path.name}",
                "document_path": str(excel_path),
            },
        ],
    }

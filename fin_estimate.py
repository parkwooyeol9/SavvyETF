"""Consensus financial estimates for /fin_estimate (US + Korea).

Vendor reality (free / currently connected):
  - Finnhub /stock/*-estimate → paid only (403 on current key)
  - Yahoo (yfinance): revenue + EPS for current FY (0y) and next FY (+1y);
    no operating-income consensus; net income ≈ EPS × shares
  - Naver/WiseReport (KR): 매출·영업이익·당기순이익 for ~2 estimate years (E)

Target display years: 2026 / 2027 / 2028 (blank when vendor has no row).
"""

from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
import requests
import yfinance as yf
from lxml import html as lxml_html

from stock_crawler import _quiet_yfinance

KST = timezone(timedelta(hours=9))
TARGET_YEARS = (2026, 2027, 2028)
NAVER_COMP_ROOT = "https://navercomp.wisereport.co.kr"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


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
    """Resolve a user token to a Yahoo symbol + market metadata."""
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
        "finnhub_estimates": "unavailable (paid plan required)",
    }

    yahoo = fetch_yahoo_estimates(resolved["yahoo"])
    if yahoo.get("company_name") and resolved["market"] == "US":
        resolved["display"] = yahoo["company_name"]
    if yahoo.get("currency"):
        resolved["currency"] = yahoo["currency"]
    if yahoo.get("fy_end_month"):
        profile["fy_end_month"] = yahoo["fy_end_month"]
    if yahoo.get("period_map"):
        profile["yahoo_period_map"] = yahoo["period_map"]
    profile["errors"].extend(yahoo.get("errors") or [])

    if yahoo.get("ok"):
        profile["sources"].append("Yahoo Finance")
        for year in TARGET_YEARS:
            src = yahoo["years"][year]
            dst = profile["years"][year]
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
                if dst.get(key) is None and src.get(key) is not None:
                    dst[key] = src[key]
            dst["sources"].extend(src.get("sources") or [])
            dst["notes"].extend(src.get("notes") or [])

    if resolved["market"] == "KR" and resolved.get("code"):
        naver = fetch_naver_consensus(resolved["code"])
        profile["errors"].extend(naver.get("errors") or [])
        if naver.get("ok"):
            profile["sources"].append("Naver/WiseReport")
            profile["naver_unit"] = "억원"
            # Naver already covers KR P&L — drop noisy Yahoo rate-limit noise.
            profile["errors"] = [
                err
                for err in profile["errors"]
                if "Yahoo" not in err and "yfinance" not in err
            ]
            for year in TARGET_YEARS:
                src = naver["years"][year]
                dst = profile["years"][year]
                # Prefer Naver absolute P&L consensus for Korea.
                for key in ("revenue", "operating_income", "net_income", "eps"):
                    if src.get(key) is not None:
                        dst[key] = src[key]
                # Drop Yahoo NI approximation note when Naver NI exists.
                if src.get("net_income") is not None:
                    dst["notes"] = [
                        note
                        for note in dst.get("notes") or []
                        if "EPS×" not in note
                    ]
                dst["sources"] = list(
                    dict.fromkeys((src.get("sources") or []) + (dst.get("sources") or []))
                )
                dst["notes"].extend(src.get("notes") or [])

    if not any(
        profile["years"][year].get(metric) is not None
        for year in TARGET_YEARS
        for metric in ("revenue", "operating_income", "net_income", "eps")
    ):
        profile["errors"].append("No consensus estimates found for target years")

    # De-dupe sources / notes
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


def format_fin_estimate_telegram(profiles: list[dict[str, Any]]) -> str:
    if not profiles:
        return "No tickers."

    when = profiles[0].get("generated_at_display") or ""
    lines = [
        "<b>📈 Fin Estimates — 컨센서스 전망</b>",
        f"<i>{_esc(when)}</i>",
        "대상: 2026 · 2027 · 2028 매출 / 영업이익 / 순이익",
        "<i>Finnhub estimate API는 현재 플랜에서 403 · Yahoo+Naver 사용</i>",
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
        period_map = profile.get("yahoo_period_map") or {}
        map_bits = []
        for period, year in sorted(period_map.items(), key=lambda item: item[1]):
            map_bits.append(f"{period}→{year}")
        map_note = f" · Yahoo {', '.join(map_bits)}" if map_bits else ""

        lines.append(f"<b>{_esc(display)}</b> (<code>{_esc(yahoo)}</code>){fy_note}")
        lines.append(f"출처: {_esc(sources)}{map_note}")
        lines.append("<pre>")
        lines.append(f"{'Year':<6}{'Rev':>10}{'OpInc':>10}{'NetInc':>10}{'EPS':>9}")
        for year in TARGET_YEARS:
            bucket = (profile.get("years") or {}).get(year) or {}
            rev = _fmt_money(bucket.get("revenue"), currency, market=market)
            opi = _fmt_money(bucket.get("operating_income"), currency, market=market)
            ni = _fmt_money(bucket.get("net_income"), currency, market=market)
            eps = _fmt_eps(bucket.get("eps"), currency)
            # Keep columns tight for Telegram monospace.
            lines.append(
                f"{year:<6}{rev:>10}{opi:>10}{ni:>10}{eps:>9}"
            )
        lines.append("</pre>")

        notes: list[str] = []
        for year in TARGET_YEARS:
            for note in ((profile.get("years") or {}).get(year) or {}).get("notes") or []:
                notes.append(note)
        notes.extend(profile.get("notes") or [])
        notes = list(dict.fromkeys(notes))
        if notes:
            lines.append("<i>" + _esc(" · ".join(notes)) + "</i>")
        if profile.get("errors"):
            lines.append(
                "<i>⚠ "
                + _esc(" · ".join(str(e) for e in profile["errors"][:3]))
                + "</i>"
            )
        lines.append("")

    lines.append(
        "<i>투자 권유 아님. 컨센서스는 벤더·회계연도(FY) 기준이며 "
        "캘린더 연도와 다를 수 있습니다. 영업이익은 한국(Naver)만 제공.</i>"
    )
    message = "\n".join(lines).rstrip()
    if len(message) > 4000:
        message = message[:3980] + "\n…(truncated)"
    return message


def run_fin_estimate(command: str) -> dict[str, Any]:
    tokens = parse_fin_estimate_tickers(command)
    profiles = build_fin_estimate_profiles(tokens)
    text = format_fin_estimate_telegram(profiles)
    return {
        "tokens": tokens,
        "profiles": profiles,
        "telegram_messages": [
            {"text": text, "parse_mode": "HTML"},
        ],
    }

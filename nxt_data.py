"""NXT (Nextrade ATS) volume / trading-value lookup.

Modes
-----
1. Live snapshot (default ``/nxt``)
   Naver realtime: KRX aq/aa + nxtOverMarketPriceInfo

2. Monthly cumulative (``/nxt 2026-06``)
   Nextrade official daily per-stock rows (accTdQty / accTrval)
   https://nextrade.co.kr/brdinfoTime/brdinfoTimeList.do

Default universe: Samsung Electronics (005930) + SK hynix (000660).
"""

from __future__ import annotations

import calendar
import html
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

KST = timezone(timedelta(hours=9))
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
NAVER_REALTIME = "https://polling.finance.naver.com/api/realtime"
NEXTRADE_DAILY = "https://nextrade.co.kr/brdinfoTime/brdinfoTimeList.do"

DEFAULT_NAMES = {
    "005930": "삼성전자",
    "000660": "SK하이닉스",
}

MONTH_RE = re.compile(r"^(\d{4})[-/.]?(\d{1,2})$")


def parse_nxt_command(command: str) -> tuple[date | None, list[str]]:
    """Parse `/nxt [yyyy-mm] [ticker…]`.

    Returns ``(month_start_or_None, ticker_tokens)``.
    Empty tickers → Samsung + SK hynix.
    """
    parts = command.strip().split()
    tokens = [p.strip() for p in parts[1:] if p.strip()]
    month: date | None = None
    ticker_tokens: list[str] = []
    for token in tokens:
        if month is None:
            parsed = _parse_year_month(token)
            if parsed is not None:
                month = parsed
                continue
        ticker_tokens.append(token)
    if not ticker_tokens:
        ticker_tokens = ["005930", "000660"]
    if len(ticker_tokens) > 8:
        raise ValueError("too many tickers (max 8)")
    return month, ticker_tokens


def _parse_year_month(token: str) -> date | None:
    match = MONTH_RE.fullmatch(token.strip())
    if not match:
        return None
    year = int(match.group(1))
    month = int(match.group(2))
    if year < 2025 or year > 2100:
        raise ValueError(f"unsupported year in '{token}' (NXT data from 2025+)")
    if month < 1 or month > 12:
        raise ValueError(f"invalid month in '{token}'")
    return date(year, month, 1)


def resolve_nxt_code(token: str) -> dict[str, str]:
    raw = token.strip()
    if not raw:
        raise ValueError("empty ticker")

    upper = raw.upper().replace(" ", "")
    if upper.endswith((".KS", ".KQ")):
        code = upper.split(".", 1)[0]
        if not re.fullmatch(r"\d{6}", code):
            raise ValueError(f"invalid Korea ticker: {token}")
        return {
            "query": raw,
            "code": code,
            "display": DEFAULT_NAMES.get(code) or code,
        }

    if re.fullmatch(r"\d{6}", upper):
        return {
            "query": raw,
            "code": upper,
            "display": DEFAULT_NAMES.get(upper) or upper,
        }

    aliases = {
        "삼성전자": "005930",
        "삼성": "005930",
        "samsung": "005930",
        "sk하이닉스": "000660",
        "하이닉스": "000660",
        "skhynix": "000660",
        "hynix": "000660",
    }
    key = raw.lower().replace(" ", "")
    if key in aliases:
        code = aliases[key]
        return {"query": raw, "code": code, "display": DEFAULT_NAMES[code]}

    if re.search(r"[가-힣]", raw):
        from dart_data import resolve_corp

        corp = resolve_corp(raw)
        code = str(corp.get("stock_code") or "").strip()
        if not re.fullmatch(r"\d{6}", code):
            raise RuntimeError(f"'{raw}' has no 6-digit stock code.")
        return {
            "query": raw,
            "code": code,
            "display": corp.get("corp_name") or DEFAULT_NAMES.get(code) or code,
        }

    raise ValueError(
        f"unsupported ticker '{token}'. Use 6-digit code or 삼성전자 / SK하이닉스."
    )


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).replace(",", "").strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace(",", "").replace("%", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _fetch_one_naver_realtime(code: str) -> dict[str, Any] | None:
    """Fetch one code at a time — batch queries sometimes omit rows."""
    response = requests.get(
        NAVER_REALTIME,
        params={"query": f"SERVICE_ITEM:{code}"},
        headers={
            "User-Agent": USER_AGENT,
            "Referer": "https://m.stock.naver.com/",
            "Accept": "application/json,text/plain,*/*",
        },
        timeout=25,
    )
    response.raise_for_status()
    payload = response.json()
    areas = ((payload.get("result") or {}).get("areas")) or []
    for area in areas:
        for row in area.get("datas") or []:
            row_code = str(row.get("cd") or "").strip()
            if row_code == code:
                return row
    return None


def fetch_naver_realtime_rows(codes: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for code in codes:
        row = _fetch_one_naver_realtime(code)
        if row:
            out[code] = row
    return out


def _parse_nxt_block(nxt: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(nxt, dict) or not nxt:
        return {
            "available": False,
            "status": None,
            "session": None,
            "price": None,
            "change": None,
            "change_pct": None,
            "open": None,
            "high": None,
            "low": None,
            "volume": None,
            "value": None,
            "traded_at": None,
        }
    return {
        "available": True,
        "status": nxt.get("overMarketStatus"),
        "session": nxt.get("tradingSessionType"),
        "price": _safe_int(
            str(nxt.get("overPrice") or "").replace(",", "")
        ),
        "change": _safe_int(
            str(nxt.get("compareToPreviousClosePrice") or "").replace(",", "")
        ),
        "change_pct": _safe_float(nxt.get("fluctuationsRatio")),
        "open": _safe_int(str(nxt.get("openPrice") or "").replace(",", "")),
        "high": _safe_int(str(nxt.get("highPrice") or "").replace(",", "")),
        "low": _safe_int(str(nxt.get("lowPrice") or "").replace(",", "")),
        "volume": _safe_int(nxt.get("accumulatedTradingVolumeRaw")),
        "value": _safe_int(nxt.get("accumulatedTradingValueRaw")),
        "traded_at": nxt.get("localTradedAt"),
    }


def build_nxt_snapshot(tokens: list[str] | None = None) -> dict[str, Any]:
    tokens = tokens or ["005930", "000660"]
    resolved = [resolve_nxt_code(token) for token in tokens]
    codes = [row["code"] for row in resolved]
    rows = fetch_naver_realtime_rows(codes)
    generated_at = datetime.now(KST)

    items: list[dict[str, Any]] = []
    errors: list[str] = []
    for meta in resolved:
        code = meta["code"]
        row = rows.get(code)
        if not row:
            errors.append(f"{code}: no Naver realtime row")
            items.append(
                {
                    **meta,
                    "krx_price": None,
                    "krx_volume": None,
                    "krx_value": None,
                    "market_status": None,
                    "nxt": _parse_nxt_block(None),
                }
            )
            continue
        nxt = _parse_nxt_block(row.get("nxtOverMarketPriceInfo"))
        display = meta["display"]
        if row.get("nm"):
            display = str(row.get("nm"))
        items.append(
            {
                "query": meta["query"],
                "code": code,
                "display": display,
                "krx_price": _safe_int(row.get("nv")),
                "krx_prev_close": _safe_int(row.get("pcv") or row.get("sv")),
                "krx_change": _safe_int(row.get("cv")),
                "krx_change_pct": _safe_float(row.get("cr")),
                "krx_volume": _safe_int(row.get("aq")),
                "krx_value": _safe_int(row.get("aa")),
                "market_status": row.get("ms"),
                "nxt": nxt,
            }
        )

    return {
        "mode": "live",
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M:%S KST"),
        "source": "Naver realtime (KRX aq/aa + nxtOverMarketPriceInfo)",
        "items": items,
        "errors": errors,
    }


def _weekday_candidates(year: int, month: int) -> list[date]:
    """Weekdays in month (Sat/Sun skipped; holidays return empty from API)."""
    last_day = calendar.monthrange(year, month)[1]
    out: list[date] = []
    for day in range(1, last_day + 1):
        d = date(year, month, day)
        if d.weekday() < 5:
            out.append(d)
    return out


def fetch_nextrade_day(code: str, day: date, session: requests.Session) -> dict[str, Any] | None:
    """One NXT trading day for a 6-digit code from nextrade.co.kr."""
    day_key = day.strftime("%Y%m%d")
    response = session.post(
        NEXTRADE_DAILY,
        data={
            "pageIndex": 1,
            "pageUnit": 20,
            "scAggDd": day_key,
            "scMktId": "",
            "searchKeyword": code,
            "sortKey": "",
            "sortType": "",
        },
        timeout=30,
    )
    response.raise_for_status()
    rows = (response.json().get("brdinfoTimeList") or [])
    for row in rows:
        isu = str(row.get("isuSrdCd") or "")
        if isu.endswith(code) and str(row.get("aggDd") or "") == day_key:
            return row
    for row in rows:
        if str(row.get("aggDd") or "") == day_key:
            return row
    return None


def build_nxt_month_snapshot(
    year: int,
    month: int,
    tokens: list[str] | None = None,
) -> dict[str, Any]:
    tokens = tokens or ["005930", "000660"]
    resolved = [resolve_nxt_code(token) for token in tokens]
    candidates = _weekday_candidates(year, month)
    generated_at = datetime.now(KST)

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Referer": "https://nextrade.co.kr/menu/transactionStatusMain/menuList.do",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
        }
    )

    items: list[dict[str, Any]] = []
    errors: list[str] = []
    for meta in resolved:
        code = meta["code"]
        daily: list[dict[str, Any]] = []
        for day in candidates:
            try:
                row = fetch_nextrade_day(code, day, session)
            except Exception as exc:
                errors.append(f"{code} {day.isoformat()}: {exc}")
                continue
            if not row:
                continue
            value = _safe_int(row.get("accTrval")) or 0
            volume = _safe_int(row.get("accTdQty")) or 0
            if value <= 0 and volume <= 0:
                continue
            daily.append(
                {
                    "date": day.isoformat(),
                    "price": _safe_int(row.get("curPrc")),
                    "volume": volume,
                    "value": value,
                }
            )
            time.sleep(0.04)

        total_value = sum(int(d["value"]) for d in daily)
        total_volume = sum(int(d["volume"]) for d in daily)
        if not daily:
            errors.append(f"{code}: no NXT days in {year}-{month:02d}")
        items.append(
            {
                "query": meta["query"],
                "code": code,
                "display": meta["display"],
                "session_days": len(daily),
                "nxt_volume": total_volume or None,
                "nxt_value": total_value or None,
                "daily": daily,
            }
        )

    return {
        "mode": "month",
        "year": year,
        "month": month,
        "month_label": f"{year}-{month:02d}",
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M:%S KST"),
        "source": "Nextrade brdinfoTimeList (NXT daily accTrval/accTdQty sum)",
        "items": items,
        "errors": errors,
    }


def _fmt_shares(value: int | None) -> str:
    if value is None:
        return "—"
    return f"{value:,}"


def _fmt_krw_value(value: int | None) -> str:
    if value is None:
        return "—"
    eok = value / 1e8
    if abs(eok) >= 10000:
        return f"{eok / 10000:,.2f}조"
    return f"{eok:,.0f}억"


def _fmt_price(value: int | None) -> str:
    if value is None:
        return "—"
    return f"{value:,}"


def _fmt_pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:+.2f}%"


def _esc(text: Any) -> str:
    return html.escape(str(text or ""), quote=False)


def format_nxt_telegram(snapshot: dict[str, Any]) -> str:
    if snapshot.get("mode") == "month":
        return _format_nxt_month_telegram(snapshot)

    lines = [
        "<b>📡 NXT vs KRX — 거래량</b>",
        f"<i>{_esc(snapshot.get('generated_at_display'))}</i>",
        f"<i>{_esc(snapshot.get('source'))}</i>",
        "",
    ]
    for item in snapshot.get("items") or []:
        nxt = item.get("nxt") or {}
        lines.append(
            f"<b>{_esc(item.get('display'))}</b> (<code>{_esc(item.get('code'))}</code>)"
        )
        lines.append(
            f"KRX  {_fmt_price(item.get('krx_price'))}원  "
            f"{_fmt_pct(item.get('krx_change_pct'))}  "
            f"[{_esc(item.get('market_status') or 'n/a')}]"
        )
        lines.append(
            f"  거래량 {_fmt_shares(item.get('krx_volume'))}주  ·  "
            f"대금 {_fmt_krw_value(item.get('krx_value'))}"
        )
        if nxt.get("available"):
            lines.append(
                f"NXT  {_fmt_price(nxt.get('price'))}원  "
                f"{_fmt_pct(nxt.get('change_pct'))}  "
                f"[{_esc(nxt.get('status'))}/{_esc(nxt.get('session'))}]"
            )
            lines.append(
                f"  거래량 {_fmt_shares(nxt.get('volume'))}주  ·  "
                f"대금 {_fmt_krw_value(nxt.get('value'))}"
            )
            krx_v = item.get("krx_volume")
            nxt_v = nxt.get("volume")
            if krx_v and nxt_v:
                share = 100.0 * nxt_v / krx_v
                lines.append(f"  NXT/KRX 거래량 비율 {share:.1f}%")
            if nxt.get("traded_at"):
                lines.append(f"  <i>NXT as-of {_esc(nxt.get('traded_at'))}</i>")
        else:
            lines.append("NXT  <i>데이터 없음 (미대상 또는 미개시)</i>")
        lines.append("")

    if snapshot.get("errors"):
        lines.append(
            "<i>⚠ " + _esc(" · ".join(snapshot["errors"][:4])) + "</i>"
        )
    lines.append(
        "<i>투자 권유 아님. NXT=넥스트레이드(ATS). "
        "KRX 수치는 Naver 정규장 누적, NXT는 over-market 누적입니다. "
        "월 누적은 /nxt 2026-06</i>"
    )
    text = "\n".join(lines).rstrip()
    if len(text) > 4000:
        text = text[:3980] + "\n…(truncated)"
    return text


def _format_nxt_month_telegram(snapshot: dict[str, Any]) -> str:
    label = snapshot.get("month_label") or ""
    lines = [
        f"<b>📡 NXT 월간 누적 — {_esc(label)}</b>",
        f"<i>{_esc(snapshot.get('generated_at_display'))}</i>",
        f"<i>{_esc(snapshot.get('source'))}</i>",
        "",
    ]
    grand_value = 0
    grand_volume = 0
    for item in snapshot.get("items") or []:
        value = item.get("nxt_value") or 0
        volume = item.get("nxt_volume") or 0
        grand_value += int(value)
        grand_volume += int(volume)
        lines.append(
            f"<b>{_esc(item.get('display'))}</b> (<code>{_esc(item.get('code'))}</code>)"
        )
        lines.append(f"  거래일 {item.get('session_days') or 0}일")
        lines.append(
            f"  거래량 {_fmt_shares(item.get('nxt_volume'))}주  ·  "
            f"대금 {_fmt_krw_value(item.get('nxt_value'))}"
        )
        lines.append("")

    if len(snapshot.get("items") or []) > 1 and grand_value:
        lines.append(
            f"<b>합계</b>  거래량 {_fmt_shares(grand_volume)}주  ·  "
            f"대금 {_fmt_krw_value(grand_value)}"
        )
        lines.append("")

    if snapshot.get("errors"):
        lines.append(
            "<i>⚠ " + _esc(" · ".join(snapshot["errors"][:4])) + "</i>"
        )
    lines.append(
        "<i>투자 권유 아님. NXT=넥스트레이드 정규시장 일별 누적 합산 "
        "(KRX 제외). 출처: nextrade.co.kr</i>"
    )
    text = "\n".join(lines).rstrip()
    if len(text) > 4000:
        text = text[:3980] + "\n…(truncated)"
    return text


def run_nxt(command: str) -> dict[str, Any]:
    month, tokens = parse_nxt_command(command)
    if month is not None:
        snapshot = build_nxt_month_snapshot(month.year, month.month, tokens)
    else:
        snapshot = build_nxt_snapshot(tokens)
    return {
        "snapshot": snapshot,
        "telegram_messages": [
            {"text": format_nxt_telegram(snapshot), "parse_mode": "HTML"},
        ],
    }

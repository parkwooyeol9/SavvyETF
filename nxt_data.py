"""NXT (Nextrade ATS) multi-command toolkit.

Telegram
--------
  /nxt                         live KRX vs NXT (삼성+하이닉스)
  /nxt help                    subcommand list
  /nxt live [TICKER…]          live snapshot
  /nxt 2026-06 [TICKER…]       monthly stock cumulative
  /nxt month 2026-06 […]
  /nxt stock TICKER [yyyy-mm]  one name: live + recent days (+ month)
  /nxt dailyvol [yyyy-mm]      market-wide daily volume/value (+ share %)
  /nxt daily [yyyy-mm-dd] [N]  top-N by NXT trading value that day
  /nxt top [yyyy-mm-dd] [N]    alias of daily
  /nxt movers [yyyy-mm-dd] [N] top gainers / losers that day
  /nxt close [yyyy-mm-dd] […]  NXT closing-auction snapshot
  /nxt share [yyyy-mm]         volume market-share trend
  /nxt compare yyyy-mm yyyy-mm [TICKER…]  month-over-month stocks

Data sources: nextrade.co.kr JSON endpoints (+ Naver realtime for live).
"""

from __future__ import annotations

import calendar
import html
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import requests

KST = timezone(timedelta(hours=9))
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
NAVER_REALTIME = "https://polling.finance.naver.com/api/realtime"
NEXTRADE_STOCK = "https://nextrade.co.kr/brdinfoTime/brdinfoTimeList.do"
NEXTRADE_STOCK_ALL = "https://nextrade.co.kr/brdinfoTime/brdinfoTimeListAll.do"
NEXTRADE_DAILY = "https://nextrade.co.kr/dailyInfo/dailyInfoListAll.do"
NEXTRADE_CLOSE = "https://nextrade.co.kr/brdinfoEnd/brdinfoEndList.do"

DEFAULT_CODES = ["005930", "000660"]
DEFAULT_NAMES = {
    "005930": "삼성전자",
    "000660": "SK하이닉스",
}

MONTH_RE = re.compile(r"^(\d{4})[-/.]?(\d{1,2})$")
DAY_RE = re.compile(r"^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})$")

HELP_TEXT = """<b>📡 /nxt 명령어</b>
<code>/nxt</code> · <code>/nxt live</code> — 당일 KRX vs NXT
<code>/nxt 2026-06</code> — 종목별 월간 NXT 누적
<code>/nxt stock 005930</code> — 종목 상세(+선택 월)
<code>/nxt dailyvol 2026-06</code> — NXT 시장 일별 대금·점유율
<code>/nxt daily 2026-06-30</code> — 당일 거래대금 TOP
<code>/nxt movers 2026-06-30</code> — 등락 TOP
<code>/nxt close 2026-07-13</code> — 종가매매
<code>/nxt share 2026-06</code> — 점유율 추이
<code>/nxt compare 2026-05 2026-06</code> — 월간 비교

티커 생략 시 삼성전자·SK하이닉스. 출처: nextrade.co.kr"""


# ---------------------------------------------------------------------------
# HTTP session
# ---------------------------------------------------------------------------


def _session(referer: str) -> requests.Session:
    sess = requests.Session()
    sess.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Referer": referer,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
        }
    )
    return sess


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def _parse_year_month(token: str) -> date | None:
    match = MONTH_RE.fullmatch(token.strip())
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2))
    if year < 2025 or year > 2100:
        raise ValueError(f"unsupported year in '{token}' (NXT from 2025+)")
    if not 1 <= month <= 12:
        raise ValueError(f"invalid month in '{token}'")
    return date(year, month, 1)


def _parse_day(token: str) -> date | None:
    match = DAY_RE.fullmatch(token.strip())
    if not match:
        return None
    year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
    try:
        return date(year, month, day)
    except ValueError as exc:
        raise ValueError(f"invalid date '{token}'") from exc


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


def _resolve_many(tokens: list[str] | None) -> list[dict[str, str]]:
    tokens = tokens or list(DEFAULT_CODES)
    if len(tokens) > 8:
        raise ValueError("too many tickers (max 8)")
    return [resolve_nxt_code(t) for t in tokens]


def _default_day() -> date:
    now = datetime.now(KST).date()
    # After midnight before open, prefer previous weekday.
    if now.weekday() >= 5:
        delta = now.weekday() - 4
        return now - timedelta(days=delta)
    return now


def _default_month() -> date:
    d = _default_day()
    return date(d.year, d.month, 1)


def _weekday_candidates(year: int, month: int) -> list[date]:
    last = calendar.monthrange(year, month)[1]
    return [
        date(year, month, day)
        for day in range(1, last + 1)
        if date(year, month, day).weekday() < 5
    ]


def _fmt_day_key(d: date) -> str:
    return d.strftime("%Y%m%d")


def _fmt_day_dash(d: date) -> str:
    return d.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Nextrade / Naver fetchers
# ---------------------------------------------------------------------------


def fetch_nextrade_day(
    code: str, day: date, session: requests.Session | None = None
) -> dict[str, Any] | None:
    sess = session or _session(
        "https://nextrade.co.kr/menu/transactionStatusMain/menuList.do"
    )
    day_key = _fmt_day_key(day)
    response = sess.post(
        NEXTRADE_STOCK,
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
    rows = response.json().get("brdinfoTimeList") or []
    for row in rows:
        isu = str(row.get("isuSrdCd") or "")
        if isu.endswith(code) and str(row.get("aggDd") or "") == day_key:
            return row
    return rows[0] if rows and str(rows[0].get("aggDd") or "") == day_key else None


def fetch_nextrade_day_universe(day: date) -> list[dict[str, Any]]:
    sess = _session(
        "https://nextrade.co.kr/menu/transactionStatusMain/menuList.do"
    )
    response = sess.post(
        NEXTRADE_STOCK_ALL,
        data={
            "pageUnit": 2000,
            "scAggDd": _fmt_day_key(day),
            "scMktId": "",
            "searchKeyword": "",
        },
        timeout=60,
    )
    response.raise_for_status()
    return list(response.json().get("rows") or [])


def fetch_market_daily(begin: date, end: date) -> list[dict[str, Any]]:
    sess = _session(
        "https://nextrade.co.kr/menu/transactionStatusDaily/menuList.do"
    )
    response = sess.post(
        NEXTRADE_DAILY,
        data={
            "pageUnit": 200,
            "scBeginDe": _fmt_day_key(begin),
            "scEndDe": _fmt_day_key(end),
        },
        timeout=45,
    )
    response.raise_for_status()
    rows = list(response.json().get("rows") or [])
    rows.sort(key=lambda r: str(r.get("aggDd") or ""))
    return rows


def fetch_closing_day(day: date, keyword: str = "") -> list[dict[str, Any]]:
    sess = _session(
        "https://nextrade.co.kr/menu/transactionStatusClosing/menuList.do"
    )
    response = sess.post(
        NEXTRADE_CLOSE,
        data={
            "pageIndex": 1,
            "pageUnit": 50,
            "scAggDd": _fmt_day_key(day),
            "scMktId": "",
            "searchKeyword": keyword,
            "sortKey": "",
            "sortType": "",
        },
        timeout=30,
    )
    response.raise_for_status()
    return list(response.json().get("brdinfoEndList") or [])


def _fetch_one_naver_realtime(code: str) -> dict[str, Any] | None:
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
    areas = ((response.json().get("result") or {}).get("areas")) or []
    for area in areas:
        for row in area.get("datas") or []:
            if str(row.get("cd") or "").strip() == code:
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
            "volume": None,
            "value": None,
            "traded_at": None,
        }
    return {
        "available": True,
        "status": nxt.get("overMarketStatus"),
        "session": nxt.get("tradingSessionType"),
        "price": _safe_int(str(nxt.get("overPrice") or "").replace(",", "")),
        "change": _safe_int(
            str(nxt.get("compareToPreviousClosePrice") or "").replace(",", "")
        ),
        "change_pct": _safe_float(nxt.get("fluctuationsRatio")),
        "volume": _safe_int(nxt.get("accumulatedTradingVolumeRaw")),
        "value": _safe_int(nxt.get("accumulatedTradingValueRaw")),
        "traded_at": nxt.get("localTradedAt"),
    }


def build_stock_month(
    code: str, year: int, month: int, *, display: str | None = None
) -> dict[str, Any]:
    sess = _session(
        "https://nextrade.co.kr/menu/transactionStatusMain/menuList.do"
    )
    daily: list[dict[str, Any]] = []
    for day in _weekday_candidates(year, month):
        try:
            row = fetch_nextrade_day(code, day, sess)
        except Exception:
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
                "change": _safe_int(row.get("contrastPrc")),
                "change_pct": _safe_float(row.get("upDownRate")),
                "volume": volume,
                "value": value,
                "open": _safe_int(row.get("oppr")),
                "high": _safe_int(row.get("hgpr")),
                "low": _safe_int(row.get("lwpr")),
            }
        )
        time.sleep(0.03)
    return {
        "code": code,
        "display": display or DEFAULT_NAMES.get(code) or code,
        "year": year,
        "month": month,
        "session_days": len(daily),
        "nxt_volume": sum(d["volume"] for d in daily) or None,
        "nxt_value": sum(d["value"] for d in daily) or None,
        "daily": daily,
    }


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------


def _esc(text: Any) -> str:
    return html.escape(str(text or ""), quote=False)


def _fmt_shares(value: int | None) -> str:
    if value is None:
        return "—"
    return f"{value:,}"


def _fmt_krw(value: int | None) -> str:
    if value is None:
        return "—"
    eok = value / 1e8
    if abs(eok) >= 10000:
        return f"{eok / 10000:,.2f}조"
    if abs(eok) >= 1:
        return f"{eok:,.0f}억"
    return f"{value:,}원"


def _fmt_price(value: int | None) -> str:
    if value is None:
        return "—"
    return f"{value:,}"


def _fmt_pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:+.2f}%"


def _clip(text: str, limit: int = 4000) -> str:
    text = text.rstrip()
    if len(text) > limit:
        return text[: limit - 12] + "\n…(truncated)"
    return text


def _now_label() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST")


def _telegram(text: str) -> dict[str, Any]:
    return {
        "snapshot": {},
        "telegram_messages": [{"text": _clip(text), "parse_mode": "HTML"}],
    }


# ---------------------------------------------------------------------------
# Command builders
# ---------------------------------------------------------------------------


def cmd_help() -> dict[str, Any]:
    return _telegram(HELP_TEXT)


def cmd_live(tokens: list[str] | None = None) -> dict[str, Any]:
    resolved = _resolve_many(tokens)
    rows = fetch_naver_realtime_rows([r["code"] for r in resolved])
    lines = [
        "<b>📡 NXT vs KRX — 당일</b>",
        f"<i>{_esc(_now_label())}</i>",
        "<i>Naver realtime · NXT=nxtOverMarketPriceInfo</i>",
        "",
    ]
    errors: list[str] = []
    for meta in resolved:
        code = meta["code"]
        row = rows.get(code)
        if not row:
            errors.append(f"{code}: no row")
            lines.append(f"<b>{_esc(meta['display'])}</b> (<code>{code}</code>) — 데이터 없음")
            lines.append("")
            continue
        nxt = _parse_nxt_block(row.get("nxtOverMarketPriceInfo"))
        display = str(row.get("nm") or meta["display"])
        krx_vol = _safe_int(row.get("aq"))
        krx_val = _safe_int(row.get("aa"))
        lines.append(f"<b>{_esc(display)}</b> (<code>{code}</code>)")
        lines.append(
            f"KRX  {_fmt_price(_safe_int(row.get('nv')))}원  "
            f"{_fmt_pct(_safe_float(row.get('cr')))}  "
            f"[{_esc(row.get('ms') or 'n/a')}]"
        )
        lines.append(
            f"  거래량 {_fmt_shares(krx_vol)}주 · 대금 {_fmt_krw(krx_val)}"
        )
        if nxt.get("available"):
            lines.append(
                f"NXT  {_fmt_price(nxt.get('price'))}원  "
                f"{_fmt_pct(nxt.get('change_pct'))}  "
                f"[{_esc(nxt.get('status'))}/{_esc(nxt.get('session'))}]"
            )
            lines.append(
                f"  거래량 {_fmt_shares(nxt.get('volume'))}주 · "
                f"대금 {_fmt_krw(nxt.get('value'))}"
            )
            if krx_vol and nxt.get("volume"):
                lines.append(
                    f"  NXT/KRX 거래량 {100.0 * nxt['volume'] / krx_vol:.1f}%"
                )
        else:
            lines.append("NXT  <i>데이터 없음</i>")
        lines.append("")
    if errors:
        lines.append("<i>⚠ " + _esc(" · ".join(errors[:4])) + "</i>")
    lines.append("<i>월간: /nxt 2026-06 · 도움말: /nxt help</i>")
    return _telegram("\n".join(lines))


def cmd_month(month: date, tokens: list[str] | None = None) -> dict[str, Any]:
    resolved = _resolve_many(tokens)
    items = [
        build_stock_month(
            meta["code"], month.year, month.month, display=meta["display"]
        )
        for meta in resolved
    ]
    label = f"{month.year}-{month.month:02d}"
    lines = [
        f"<b>📡 NXT 월간 누적 — {_esc(label)}</b>",
        f"<i>{_esc(_now_label())}</i>",
        "<i>Nextrade 일별 accTrval/accTdQty 합산</i>",
        "",
    ]
    grand_v = grand_q = 0
    for item in items:
        grand_v += int(item.get("nxt_value") or 0)
        grand_q += int(item.get("nxt_volume") or 0)
        lines.append(
            f"<b>{_esc(item['display'])}</b> (<code>{item['code']}</code>)"
        )
        lines.append(f"  거래일 {item.get('session_days') or 0}일")
        lines.append(
            f"  거래량 {_fmt_shares(item.get('nxt_volume'))}주 · "
            f"대금 {_fmt_krw(item.get('nxt_value'))}"
        )
        # peak day
        daily = item.get("daily") or []
        if daily:
            peak = max(daily, key=lambda d: d["value"])
            lines.append(
                f"  최대일 {peak['date'][5:]} 대금 {_fmt_krw(peak['value'])}"
            )
        lines.append("")
    if len(items) > 1 and grand_v:
        lines.append(
            f"<b>합계</b>  {_fmt_shares(grand_q)}주 · {_fmt_krw(grand_v)}"
        )
        lines.append("")
    lines.append("<i>일별 시장: /nxt dailyvol " + label + "</i>")
    return _telegram("\n".join(lines))


def cmd_stock(token: str, month: date | None = None) -> dict[str, Any]:
    meta = resolve_nxt_code(token)
    live = cmd_live([meta["code"]])
    live_text = live["telegram_messages"][0]["text"]

    sess = _session(
        "https://nextrade.co.kr/menu/transactionStatusMain/menuList.do"
    )
    recent: list[dict[str, Any]] = []
    day = _default_day()
    looked = 0
    while len(recent) < 5 and looked < 14:
        if day.weekday() < 5:
            row = fetch_nextrade_day(meta["code"], day, sess)
            if row:
                recent.append(
                    {
                        "date": day.isoformat(),
                        "price": _safe_int(row.get("curPrc")),
                        "volume": _safe_int(row.get("accTdQty")),
                        "value": _safe_int(row.get("accTrval")),
                        "change_pct": _safe_float(row.get("upDownRate")),
                    }
                )
            time.sleep(0.03)
        day -= timedelta(days=1)
        looked += 1

    lines = [
        f"<b>📡 NXT 종목 — {_esc(meta['display'])}</b>",
        "",
        live_text,
        "",
        "<b>최근 NXT 거래일</b>",
    ]
    for row in recent:
        lines.append(
            f"  {row['date'][5:]}  {_fmt_price(row['price'])}  "
            f"대금 {_fmt_krw(row['value'])}  량 {_fmt_shares(row['volume'])}"
        )

    if month is not None:
        item = build_stock_month(
            meta["code"], month.year, month.month, display=meta["display"]
        )
        lines.extend(
            [
                "",
                f"<b>{month.year}-{month.month:02d} 누적</b>",
                f"  {item['session_days']}일 · "
                f"{_fmt_shares(item.get('nxt_volume'))}주 · "
                f"{_fmt_krw(item.get('nxt_value'))}",
            ]
        )
    return _telegram("\n".join(lines))


def cmd_dailyvol(month: date | None = None) -> dict[str, Any]:
    month = month or _default_month()
    begin = month
    end = date(month.year, month.month, calendar.monthrange(month.year, month.month)[1])
    rows = fetch_market_daily(begin, end)
    label = f"{month.year}-{month.month:02d}"
    if not rows:
        return _telegram(f"NXT dailyvol: no rows for {label}")

    total_main = sum(_safe_int(r.get("mainAccTrval")) or 0 for r in rows)
    total_all = sum(_safe_int(r.get("totalAccTrval")) or 0 for r in rows)
    total_vol = sum(_safe_int(r.get("totalAccTdQty")) or 0 for r in rows)
    shares = [_safe_float(r.get("mktShr")) for r in rows if r.get("mktShr") is not None]
    avg_share = sum(shares) / len(shares) if shares else None

    lines = [
        f"<b>📡 NXT 시장 일별 — {_esc(label)}</b>",
        f"<i>{_esc(_now_label())}</i>",
        "<i>pre=장전 · main=정규 · aft=장후 · total=합 · mktShr=거래량점유율%</i>",
        "",
        f"거래일 {len(rows)}일",
        f"정규 대금 합 {_fmt_krw(total_main)}",
        f"전체 대금 합 {_fmt_krw(total_all)}  ·  거래량 {_fmt_shares(total_vol)}주",
        (
            f"평균 점유율 {avg_share:.2f}%"
            if avg_share is not None
            else "평균 점유율 —"
        ),
        "",
        "<b>일별 (정규 대금 / 점유율)</b>",
    ]
    show = rows
    if len(show) > 16:
        show = rows[:8] + [{"_gap": True}] + rows[-8:]  # type: ignore[list-item]
        lines.append("<i>(앞·뒤 8거래일)</i>")

    prev: int | None = None
    for r in show:
        if isinstance(r, dict) and r.get("_gap"):
            lines.append("  …")
            prev = None
            continue
        d = str(r.get("aggDd") or "")
        if len(d) == 8:
            d = f"{d[4:6]}-{d[6:8]}"
        main_v = _safe_int(r.get("mainAccTrval"))
        shr = _safe_float(r.get("mktShr"))
        marker = ""
        if prev is not None and main_v is not None:
            if main_v > prev * 1.25:
                marker = " ▲"
            elif main_v < prev * 0.75:
                marker = " ▼"
        if main_v is not None:
            prev = main_v
        shr_txt = f"{shr:.1f}%" if shr is not None else "—"
        lines.append(f"  {d}  {_fmt_krw(main_v)}  {shr_txt}{marker}")

    peak = max(rows, key=lambda r: _safe_int(r.get("mainAccTrval")) or 0)
    trough = min(rows, key=lambda r: _safe_int(r.get("mainAccTrval")) or 10**30)
    lines.extend(
        [
            "",
            f"최대 정규대금 {_esc(peak.get('aggDd'))} {_fmt_krw(_safe_int(peak.get('mainAccTrval')))}",
            f"최소 정규대금 {_esc(trough.get('aggDd'))} {_fmt_krw(_safe_int(trough.get('mainAccTrval')))}",
            "",
            "<i>종목 TOP: /nxt daily YYYY-MM-DD</i>",
        ]
    )
    return _telegram("\n".join(lines))


def cmd_daily_top(day: date | None = None, limit: int = 10) -> dict[str, Any]:
    day = day or _default_day()
    limit = max(3, min(30, limit))
    rows = fetch_nextrade_day_universe(day)
    if not rows:
        return _telegram(f"NXT daily: no rows for {_fmt_day_dash(day)}")
    ranked = sorted(
        rows,
        key=lambda r: _safe_int(r.get("accTrval")) or 0,
        reverse=True,
    )[:limit]
    total_v = sum(_safe_int(r.get("accTrval")) or 0 for r in rows)
    lines = [
        f"<b>📡 NXT 거래대금 TOP{limit} — {_esc(_fmt_day_dash(day))}</b>",
        f"<i>{_esc(_now_label())}</i>",
        f"전체 {len(rows)}종목 · 대금 {_fmt_krw(total_v)}",
        "",
    ]
    for i, r in enumerate(ranked, 1):
        code = str(r.get("isuSrdCd") or "").lstrip("A")
        name = r.get("isuAbwdNm") or code
        lines.append(
            f"{i}. <b>{_esc(name)}</b> (<code>{_esc(code)}</code>) "
            f"{_esc(r.get('mktNm') or '')}"
        )
        lines.append(
            f"   {_fmt_price(_safe_int(r.get('curPrc')))}  "
            f"{_fmt_pct(_safe_float(r.get('upDownRate')))}  "
            f"대금 {_fmt_krw(_safe_int(r.get('accTrval')))}  "
            f"량 {_fmt_shares(_safe_int(r.get('accTdQty')))}"
        )
    lines.append("")
    lines.append("<i>등락: /nxt movers " + _fmt_day_dash(day) + "</i>")
    return _telegram("\n".join(lines))


def cmd_movers(day: date | None = None, limit: int = 5) -> dict[str, Any]:
    day = day or _default_day()
    limit = max(3, min(15, limit))
    rows = fetch_nextrade_day_universe(day)
    usable = []
    for r in rows:
        pct = _safe_float(r.get("upDownRate"))
        if pct is None:
            # derive from contrast/base when needed
            base = _safe_int(r.get("basePrc"))
            cur = _safe_int(r.get("curPrc"))
            if base and cur:
                pct = (cur - base) / base * 100.0
        if pct is None:
            continue
        if (_safe_int(r.get("accTrval")) or 0) < 1_000_000_000:  # skip tiny
            continue
        usable.append((pct, r))
    if not usable:
        return _telegram(
            f"NXT movers: no usable rows for {_fmt_day_dash(day)} "
            "(upDownRate empty — try /nxt daily)"
        )
    usable.sort(key=lambda x: x[0], reverse=True)
    gainers = usable[:limit]
    losers = list(reversed(usable[-limit:]))

    def block(title: str, items: list) -> list[str]:
        out = [f"<b>{title}</b>"]
        for pct, r in items:
            code = str(r.get("isuSrdCd") or "").lstrip("A")
            out.append(
                f"  {_esc(r.get('isuAbwdNm'))} (<code>{code}</code>) "
                f"{_fmt_pct(pct)}  대금 {_fmt_krw(_safe_int(r.get('accTrval')))}"
            )
        return out

    lines = [
        f"<b>📡 NXT 등락 — {_esc(_fmt_day_dash(day))}</b>",
        f"<i>{_esc(_now_label())}</i>",
        "<i>거래대금 10억↑ 종목</i>",
        "",
        *block(f"▲ TOP{limit}", gainers),
        "",
        *block(f"▼ TOP{limit}", losers),
    ]
    return _telegram("\n".join(lines))


def cmd_close(day: date | None = None, tokens: list[str] | None = None) -> dict[str, Any]:
    day = day or _default_day()
    resolved = _resolve_many(tokens)
    lines = [
        f"<b>📡 NXT 종가매매 — {_esc(_fmt_day_dash(day))}</b>",
        f"<i>{_esc(_now_label())}</i>",
        "",
    ]
    for meta in resolved:
        rows = fetch_closing_day(day, meta["code"])
        row = None
        for candidate in rows:
            if str(candidate.get("isuSrdCd") or "").endswith(meta["code"]):
                row = candidate
                break
        row = row or (rows[0] if rows else None)
        lines.append(f"<b>{_esc(meta['display'])}</b> (<code>{meta['code']}</code>)")
        if not row:
            lines.append("  데이터 없음")
            lines.append("")
            continue
        # closing fields vary — print common ones
        price = _safe_int(row.get("clsPrc") or row.get("curPrc") or row.get("endPrc"))
        vol = _safe_int(row.get("accTdQty") or row.get("clsTdQty"))
        val = _safe_int(row.get("accTrval") or row.get("clsTrval"))
        lines.append(f"  종가 {_fmt_price(price)} · 량 {_fmt_shares(vol)} · 대금 {_fmt_krw(val)}")
        lines.append("")
    lines.append("<i>nextrade 종가매매(brdinfoEnd)</i>")
    return _telegram("\n".join(lines))


def cmd_share(month: date | None = None) -> dict[str, Any]:
    month = month or _default_month()
    begin = month
    end = date(month.year, month.month, calendar.monthrange(month.year, month.month)[1])
    rows = fetch_market_daily(begin, end)
    label = f"{month.year}-{month.month:02d}"
    if not rows:
        return _telegram(f"NXT share: no rows for {label}")
    shares = []
    for r in rows:
        shr = _safe_float(r.get("mktShr"))
        if shr is not None:
            shares.append((str(r.get("aggDd")), shr, _safe_int(r.get("totalAccTdQty"))))
    if not shares:
        return _telegram(f"NXT share: mktShr missing for {label}")
    avg = sum(s for _, s, _ in shares) / len(shares)
    mx = max(shares, key=lambda x: x[1])
    mn = min(shares, key=lambda x: x[1])
    lines = [
        f"<b>📡 NXT 거래량 점유율 — {_esc(label)}</b>",
        f"<i>{_esc(_now_label())}</i>",
        "<i>mktShr = NXT / (NXT+KRX) 거래량%</i>",
        "",
        f"평균 {avg:.2f}%  ·  최고 {mx[0]} {mx[1]:.2f}%  ·  최저 {mn[0]} {mn[1]:.2f}%",
        "",
    ]
    for d, shr, vol in shares:
        bar = "█" * int(round(shr / 2)) + "░" * max(0, 10 - int(round(shr / 2)))
        dd = f"{d[4:6]}-{d[6:8]}" if len(d) == 8 else d
        lines.append(f"  {dd}  {shr:5.2f}%  {bar}")
    return _telegram("\n".join(lines))


def cmd_compare(month_a: date, month_b: date, tokens: list[str] | None = None) -> dict[str, Any]:
    resolved = _resolve_many(tokens)
    lines = [
        f"<b>📡 NXT 월간 비교 — "
        f"{month_a.year}-{month_a.month:02d} vs {month_b.year}-{month_b.month:02d}</b>",
        f"<i>{_esc(_now_label())}</i>",
        "",
    ]
    for meta in resolved:
        a = build_stock_month(
            meta["code"], month_a.year, month_a.month, display=meta["display"]
        )
        b = build_stock_month(
            meta["code"], month_b.year, month_b.month, display=meta["display"]
        )
        va, vb = a.get("nxt_value") or 0, b.get("nxt_value") or 0
        qa, qb = a.get("nxt_volume") or 0, b.get("nxt_volume") or 0
        delta_v = ((vb - va) / va * 100.0) if va else None
        delta_q = ((qb - qa) / qa * 100.0) if qa else None
        lines.append(f"<b>{_esc(meta['display'])}</b> (<code>{meta['code']}</code>)")
        lines.append(
            f"  대금  {_fmt_krw(va)} → {_fmt_krw(vb)}  ({_fmt_pct(delta_v)})"
        )
        lines.append(
            f"  거래량 {_fmt_shares(qa)} → {_fmt_shares(qb)}  ({_fmt_pct(delta_q)})"
        )
        lines.append(
            f"  일수   {a.get('session_days')} → {b.get('session_days')}"
        )
        lines.append("")
    return _telegram("\n".join(lines))


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

_SUBCOMMANDS = {
    "help",
    "h",
    "?",
    "live",
    "month",
    "monthly",
    "stock",
    "ticker",
    "종목",
    "dailyvol",
    "vol",
    "market",
    "daily",
    "top",
    "movers",
    "move",
    "close",
    "closing",
    "share",
    "mktshr",
    "compare",
    "cmp",
}


def _pop_month(tokens: list[str]) -> tuple[date | None, list[str]]:
    if tokens:
        try:
            m = _parse_year_month(tokens[0])
        except ValueError:
            m = None
        if m is not None:
            return m, tokens[1:]
    return None, tokens


def _pop_day(tokens: list[str]) -> tuple[date | None, list[str]]:
    if tokens:
        try:
            d = _parse_day(tokens[0])
        except ValueError:
            d = None
        # reject bare yyyy-mm matched as day with day=0 — DAY_RE requires 3 groups
        if d is not None and MONTH_RE.fullmatch(tokens[0]) and tokens[0].count("-") == 1:
            # "2026-06" should not be a day
            return None, tokens
        if d is not None:
            return d, tokens[1:]
    return None, tokens


def _pop_int(tokens: list[str], default: int) -> tuple[int, list[str]]:
    if tokens and re.fullmatch(r"\d{1,2}", tokens[0]):
        return int(tokens[0]), tokens[1:]
    return default, tokens


def run_nxt(command: str) -> dict[str, Any]:
    parts = command.strip().split()
    args = [p for p in parts[1:] if p.strip()]
    if not args:
        return cmd_live()

    head = args[0].lower()

    # bare yyyy-mm → month cumulative
    try:
        bare_month = _parse_year_month(args[0])
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    if bare_month is not None and head not in _SUBCOMMANDS:
        return cmd_month(bare_month, args[1:] or None)

    # bare ticker(s) without subcommand → live
    if head not in _SUBCOMMANDS:
        return cmd_live(args)

    args = args[1:]
    if head in {"help", "h", "?"}:
        return cmd_help()
    if head == "live":
        return cmd_live(args or None)
    if head in {"month", "monthly"}:
        month, rest = _pop_month(args)
        if month is None:
            raise ValueError("Usage: /nxt month 2026-06 [TICKER…]")
        return cmd_month(month, rest or None)
    if head in {"stock", "ticker", "종목"}:
        if not args:
            raise ValueError("Usage: /nxt stock 005930 [2026-06]")
        month, rest = _pop_month(args[1:])
        # also allow /nxt stock 2026-06 005930
        if month is None:
            maybe_month, rest2 = _pop_month(args)
            if maybe_month is not None:
                if not rest2:
                    raise ValueError("Usage: /nxt stock 005930 [2026-06]")
                return cmd_stock(rest2[0], maybe_month)
            return cmd_stock(args[0], None)
        return cmd_stock(args[0], month)
    if head in {"dailyvol", "vol", "market"}:
        month, _ = _pop_month(args)
        return cmd_dailyvol(month)
    if head in {"daily", "top"}:
        day, rest = _pop_day(args)
        limit, _ = _pop_int(rest, 10)
        return cmd_daily_top(day, limit)
    if head in {"movers", "move"}:
        day, rest = _pop_day(args)
        limit, _ = _pop_int(rest, 5)
        return cmd_movers(day, limit)
    if head in {"close", "closing"}:
        day, rest = _pop_day(args)
        return cmd_close(day, rest or None)
    if head in {"share", "mktshr"}:
        month, _ = _pop_month(args)
        return cmd_share(month)
    if head in {"compare", "cmp"}:
        if len(args) < 2:
            raise ValueError("Usage: /nxt compare 2026-05 2026-06 [TICKER…]")
        m1 = _parse_year_month(args[0])
        m2 = _parse_year_month(args[1])
        if m1 is None or m2 is None:
            raise ValueError("Usage: /nxt compare 2026-05 2026-06 [TICKER…]")
        return cmd_compare(m1, m2, args[2:] or None)

    raise ValueError(f"unknown /nxt subcommand '{head}'. Try /nxt help")


# Back-compat aliases used by older imports / tests
def parse_nxt_tickers(command: str) -> list[str]:
    parts = command.strip().split()
    tokens = [p for p in parts[1:] if p.strip()]
    out: list[str] = []
    for token in tokens:
        if _parse_year_month(token) is not None:
            continue
        if token.lower() in _SUBCOMMANDS:
            continue
        out.append(token)
    return out or list(DEFAULT_CODES)


def build_nxt_snapshot(tokens: list[str] | None = None) -> dict[str, Any]:
    """Legacy live snapshot dict (for any external callers)."""
    resolved = _resolve_many(tokens)
    rows = fetch_naver_realtime_rows([r["code"] for r in resolved])
    items = []
    for meta in resolved:
        row = rows.get(meta["code"])
        nxt = _parse_nxt_block((row or {}).get("nxtOverMarketPriceInfo"))
        items.append(
            {
                **meta,
                "krx_price": _safe_int((row or {}).get("nv")),
                "krx_volume": _safe_int((row or {}).get("aq")),
                "krx_value": _safe_int((row or {}).get("aa")),
                "krx_change_pct": _safe_float((row or {}).get("cr")),
                "market_status": (row or {}).get("ms"),
                "nxt": nxt,
            }
        )
    return {
        "mode": "live",
        "generated_at_display": _now_label(),
        "items": items,
        "errors": [],
    }

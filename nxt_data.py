"""NXT (Nextrade ATS) vs KRX volume snapshot via Naver realtime.

Naver ``polling.finance.naver.com`` exposes:
  - ``aq`` / ``aa`` — day session accumulated volume / value (KRX tab)
  - ``nxtOverMarketPriceInfo`` — NXT OHLC, status, accumulated volume/value

Default universe: Samsung Electronics (005930) + SK hynix (000660).
"""

from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

KST = timezone(timedelta(hours=9))
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
NAVER_REALTIME = "https://polling.finance.naver.com/api/realtime"

DEFAULT_NAMES = {
    "005930": "삼성전자",
    "000660": "SK하이닉스",
}


def parse_nxt_tickers(command: str) -> list[str]:
    """Parse `/nxt [ticker…]`. Empty args → Samsung + SK hynix."""
    parts = command.strip().split()
    tokens = [p.strip() for p in parts[1:] if p.strip()]
    if not tokens:
        return ["005930", "000660"]
    if len(tokens) > 8:
        raise ValueError("too many tickers (max 8)")
    return tokens


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

    # Korean / English name aliases
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
        "generated_at_display": generated_at.strftime("%Y-%m-%d %H:%M:%S KST"),
        "source": "Naver realtime (KRX aq/aa + nxtOverMarketPriceInfo)",
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
        "KRX 수치는 Naver 정규장 누적, NXT는 over-market 누적입니다.</i>"
    )
    text = "\n".join(lines).rstrip()
    if len(text) > 4000:
        text = text[:3980] + "\n…(truncated)"
    return text


def run_nxt(command: str) -> dict[str, Any]:
    tokens = parse_nxt_tickers(command)
    snapshot = build_nxt_snapshot(tokens)
    return {
        "snapshot": snapshot,
        "telegram_messages": [
            {"text": format_nxt_telegram(snapshot), "parse_mode": "HTML"},
        ],
    }

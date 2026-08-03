"""KOFIA FreeSIS + Naver 증시자금 scraper (Render egress).

Ports webapp/src/lib/kofiaFreeSis.ts so 반대매매 can be collected outside
Vercel US IP ranges, then mirrored to R2 via r2_data.upload_credit_monitor.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
FREE_SIS = "https://freesis.kofia.or.kr"
FUND_SERVICE = "STATSCU0100000060"
CREDIT_SERVICE = "STATSCU0100000070"
UNIT_WON_SCALE = "01"
TIMEOUT = 20

DATA_DIR = Path(__file__).resolve().parent / "data" / "credit_monitor"
LATEST_PATH = DATA_DIR / "latest.json"


def _num(v: Any) -> float:
    if isinstance(v, (int, float)) and v == v:  # not NaN
        return float(v)
    if v is None:
        return 0.0
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def _ymd_to_iso(ymd: str) -> str:
    s = re.sub(r"\D", "", str(ymd))
    if len(s) != 8:
        return str(ymd)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def _lookback_range(days: int) -> tuple[str, str]:
    end = datetime.now(KST).date()
    start = end - timedelta(days=days)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


def _stress_from_ratio(ratio: float) -> tuple[str, str]:
    if ratio >= 10:
        return "extreme", "강제매도 압력 매우 큼"
    if ratio >= 5:
        return "high", "강제매도 압력 큼"
    if ratio >= 2:
        return "elevated", "다소 높음"
    return "calm", "안정"


def _parse_freesis_json(text: str) -> Any:
    cleaned = (
        text.replace(": NaN", ": null")
        .replace(":NaN", ":null")
        .replace(": -Infinity", ": null")
        .replace(":-Infinity", ":null")
        .replace(": Infinity", ": null")
        .replace(":Infinity", ":null")
        .replace(": undefined", ": null")
        .replace(":undefined", ":null")
    )
    # also handle word-boundary NaN without space variants already covered
    cleaned = re.sub(r":\s*NaN\b", ":null", cleaned)
    cleaned = re.sub(r":\s*-?Infinity\b", ":null", cleaned)
    return json.loads(cleaned)


class FreeSisClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": UA,
                "Accept": "application/json, text/html, */*",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": FREE_SIS,
            }
        )

    def warm(self) -> None:
        url = (
            f"{FREE_SIS}/stat/FreeSIS.do"
            f"?parentDivId=MSIS10000000000000&serviceId={FUND_SERVICE}"
        )
        self.session.get(url, timeout=TIMEOUT)

    def post(self, path: str, body: dict[str, Any]) -> Any:
        res = self.session.post(
            f"{FREE_SIS}{path}",
            json=body,
            headers={
                "Content-Type": "application/json",
                "Referer": (
                    f"{FREE_SIS}/stat/FreeSIS.do"
                    f"?parentDivId=MSIS10000000000000&serviceId={FUND_SERVICE}"
                ),
            },
            timeout=TIMEOUT,
        )
        text = res.text
        if not (
            "json" in (res.headers.get("content-type") or "").lower()
            or text.lstrip().startswith("{")
            or text.lstrip().startswith("[")
        ):
            raise RuntimeError(f"FreeSIS {path} non-JSON ({res.status_code})")
        try:
            return _parse_freesis_json(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"FreeSIS {path} JSON parse failed: {exc}") from exc


def _parse_fund_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in rows:
        date = _ymd_to_iso(str(r.get("TMPV1") or ""))
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            continue
        opp_ratio_pct = _num(r.get("TMPV7"))
        deposit = _num(r.get("TMPV2"))
        unsettled = _num(r.get("TMPV5"))
        opp_sell = _num(r.get("TMPV6"))
        if not deposit and not unsettled and not opp_sell and not opp_ratio_pct:
            continue
        out.append(
            {
                "date": date,
                "deposit": deposit,
                "deriv_deposit": _num(r.get("TMPV3")),
                "rp_balance": _num(r.get("TMPV4")),
                "unsettled": unsettled,
                "opp_sell": opp_sell,
                "opp_ratio_pct": opp_ratio_pct,
            }
        )
    out.sort(key=lambda x: x["date"])
    return out


def _parse_credit_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in rows:
        date = _ymd_to_iso(str(r.get("TMPV1") or ""))
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            continue
        loan_total = _num(r.get("TMPV2"))
        if not loan_total:
            continue
        out.append(
            {
                "date": date,
                "loan_total": loan_total,
                "loan_kospi": _num(r.get("TMPV3")),
                "loan_kosdaq": _num(r.get("TMPV4")),
                "short_total": _num(r.get("TMPV5")),
                "collateral_loan": _num(r.get("TMPV9")),
            }
        )
    out.sort(key=lambda x: x["date"])
    return out


def fetch_fund_series(client: FreeSisClient, start: str, end: str) -> list[dict[str, Any]]:
    meta = client.post(
        "/meta/getSrvData.do",
        {
            "dmSearchData": {
                "strSvrId": FUND_SERVICE,
                "tmpV1": "RD",
                "tmpV45": start,
                "tmpV46": end,
                "strGetCode": "Y",
            }
        },
    )
    servlet = (meta.get("dsGridServlet") or [{}])[0]
    obj = servlet.get("OBJ_NM") or f"{FUND_SERVICE}BO"
    listing = client.post(
        "/meta/getMetaDataList.do",
        {
            "dmSearch": {
                "strSvrId": FUND_SERVICE,
                "tmpV1": "RD",
                "tmpV40": UNIT_WON_SCALE,
                "tmpV45": start,
                "tmpV46": end,
                "OBJ_NM": obj,
            }
        },
    )
    return _parse_fund_rows(list(listing.get("ds1") or []))


def fetch_credit_series(client: FreeSisClient, start: str, end: str) -> list[dict[str, Any]]:
    meta = client.post(
        "/meta/getSrvData.do",
        {
            "dmSearchData": {
                "strSvrId": CREDIT_SERVICE,
                "tmpV1": "RD",
                "tmpV45": start,
                "tmpV46": end,
                "strGetCode": "Y",
            }
        },
    )
    servlet = (meta.get("dsGridServlet") or [{}])[0]
    obj = servlet.get("OBJ_NM") or f"{CREDIT_SERVICE}BO"
    listing = client.post(
        "/meta/getMetaDataList.do",
        {
            "dmSearch": {
                "strSvrId": CREDIT_SERVICE,
                "tmpV1": "RD",
                "tmpV40": UNIT_WON_SCALE,
                "tmpV45": start,
                "tmpV46": end,
                "OBJ_NM": obj,
            }
        },
    )
    return _parse_credit_rows(list(listing.get("ds1") or []))


def fetch_naver_credit_series() -> tuple[list[dict[str, float]], list[dict[str, Any]]]:
    res = requests.get(
        "https://finance.naver.com/sise/sise_deposit.naver",
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Referer": "https://finance.naver.com/",
            "Accept-Language": "ko-KR,ko;q=0.9",
        },
        timeout=TIMEOUT,
    )
    res.raise_for_status()
    # Naver often serves EUC-KR
    raw = res.content
    try:
        html = raw.decode("euc-kr")
    except UnicodeDecodeError:
        html = raw.decode("utf-8", errors="replace")

    deposit_series: list[dict[str, float]] = []
    credit_series: list[dict[str, Any]] = []
    for tr in re.findall(r"<tr[^>]*>[\s\S]*?</tr>", html, flags=re.I):
        cells = [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip()
            for c in re.findall(r"<t[dh][^>]*>[\s\S]*?</t[dh]>", tr, flags=re.I)
        ]
        if not cells or not re.fullmatch(r"\d{2}\.\d{2}\.\d{2}", cells[0]):
            continue
        date = "20" + cells[0].replace(".", "-")
        deposit_eok = _num(cells[1] if len(cells) > 1 else 0)
        credit_eok = _num(cells[3] if len(cells) > 3 else 0)
        if not deposit_eok and not credit_eok:
            continue
        deposit = deposit_eok * 1e8
        loan_total = credit_eok * 1e8
        deposit_series.append({"date": date, "deposit": deposit})
        credit_series.append(
            {
                "date": date,
                "loan_total": loan_total,
                "loan_kospi": 0,
                "loan_kosdaq": 0,
                "short_total": 0,
                "collateral_loan": 0,
            }
        )
    deposit_series.sort(key=lambda x: x["date"])
    credit_series.sort(key=lambda x: x["date"])
    return deposit_series, credit_series


def try_freesis(start: str, end: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    try:
        client = FreeSisClient()
        client.warm()
        fund = fetch_fund_series(client, start, end)
        credit: list[dict[str, Any]] = []
        try:
            credit = fetch_credit_series(client, start, end)
        except Exception:
            credit = []
        return fund, credit, None
    except Exception as exc:
        return [], [], str(exc)


def build_forced_sell_board(lookback_days: int = 60) -> dict[str, Any]:
    base_note = (
        "미수 기준 반대매매는 금투협 FreeSIS, 신용·예탁금은 FreeSIS 또는 네이버 증시자금. "
        "통상 1~2영업일 지연. Render→R2 캐시."
    )
    start, end = _lookback_range(lookback_days)
    fund, freesis_credit, freesis_error = try_freesis(start, end)

    deposit_series: list[dict[str, float]] = []
    naver_credit: list[dict[str, Any]] = []
    try:
        deposit_series, naver_credit = fetch_naver_credit_series()
    except Exception:
        pass

    credit_series = freesis_credit if freesis_credit else naver_credit
    fund_for_ui = fund
    if not fund_for_ui and deposit_series:
        fund_for_ui = [
            {
                "date": d["date"],
                "deposit": d["deposit"],
                "deriv_deposit": 0,
                "rp_balance": 0,
                "unsettled": 0,
                "opp_sell": 0,
                "opp_ratio_pct": 0,
            }
            for d in deposit_series
        ]

    sources = {
        "freesis_fund": len(fund) > 0,
        "freesis_credit": len(freesis_credit) > 0,
        "naver_credit": len(freesis_credit) == 0 and len(naver_credit) > 0,
        "r2": False,
    }

    generated_at = datetime.now(KST).isoformat()

    if not fund_for_ui and not credit_series:
        return {
            "as_of": None,
            "stress": "calm",
            "stress_label": "데이터 없음",
            "latest_fund": None,
            "latest_credit": None,
            "credit_delta": None,
            "fund_series": [],
            "credit_series": [],
            "sources": sources,
            "note": f"{base_note} 지금은 통계를 불러오지 못했습니다."
            + (f" ({freesis_error})" if freesis_error else ""),
            "generated_at": generated_at,
            "collected_on": "render",
        }

    latest_fund_kpi = fund[-1] if sources["freesis_fund"] else None
    latest_fund = latest_fund_kpi or (fund_for_ui[-1] if fund_for_ui else None)
    latest_credit = credit_series[-1] if credit_series else None
    prev_credit = credit_series[-2] if len(credit_series) >= 2 else None
    credit_delta = (
        (latest_credit["loan_total"] - prev_credit["loan_total"])
        if latest_credit and prev_credit
        else None
    )

    if sources["freesis_fund"]:
        stress, label = _stress_from_ratio(float((latest_fund_kpi or {}).get("opp_ratio_pct") or 0))
    else:
        stress, label = "calm", "신용만 표시"

    parts = [base_note]
    if sources["freesis_fund"]:
        parts.append("반대매매: FreeSIS")
    else:
        parts.append("반대매매: FreeSIS 접속 불가")
    if sources["freesis_credit"]:
        parts.append("신용: FreeSIS")
    elif sources["naver_credit"]:
        parts.append("신용·예탁금: 네이버 증시자금")

    return {
        "as_of": (latest_fund_kpi or latest_credit or latest_fund or {}).get("date")
        if (latest_fund_kpi or latest_credit or latest_fund)
        else None,
        "stress": stress,
        "stress_label": label,
        "latest_fund": latest_fund_kpi,
        "latest_credit": latest_credit,
        "credit_delta": credit_delta,
        "fund_series": fund if sources["freesis_fund"] else [],
        "credit_series": credit_series,
        "sources": sources,
        "note": " · ".join(parts),
        "generated_at": generated_at,
        "collected_on": "render",
    }


def save_local(board: dict[str, Any]) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LATEST_PATH.write_text(json.dumps(board, ensure_ascii=False), encoding="utf-8")
    return LATEST_PATH


def collect_and_publish(*, lookback_days: int = 60) -> dict[str, Any]:
    board = build_forced_sell_board(lookback_days=lookback_days)
    save_local(board)
    published = False
    pub_error = None
    try:
        from r2_data import upload_credit_monitor

        published = upload_credit_monitor(board)
    except Exception as exc:
        pub_error = str(exc)
        print(f"credit_monitor R2 upload failed: {exc}")
    return {
        "board": board,
        "r2": published,
        "error": pub_error,
        "as_of": board.get("as_of"),
        "freesis_fund": bool((board.get("sources") or {}).get("freesis_fund")),
    }

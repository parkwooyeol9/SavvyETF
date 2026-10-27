"""리밸런싱 백서 국내 지수 그룹 예상 — 매일 다시 계산해 R2 ``rebalance/whitepaper_live.json`` 에 올린다.

`research/rebalance_whitepaper/forward2.py` (10/16 일회성 계산)를 날짜 인자로 옮긴 것.
고정 입력은 ``Claude_Work/data/whitepaper_static.json`` (export_wp_static.py 출력):
이벤트·매매일·종목 교체 방식·적합된 가중 규칙·종목 유동비율/WICS/배당수익률.

매일 바뀌는 입력
  - 현재 비중: 그룹 대표 ETF 의 운용사 PDF(당일 → 최대 5영업일 전) 수량 × 네이버 종가 — 그룹당 1회 요청
  - 시가총액·종가: 네이버 시가총액 순위(KOSPI·KOSDAQ 보통주), 없으면 네이버 실시간 시세
  - 그룹 AUM: 네이버 ETF 목록 순자산 합
  - 20일 평균 거래대금: 네이버 일봉

매매일이 지난 이벤트는 다시 계산하지 않고 직전 R2 결과(매매일 전 마지막 계산)를 그대로 둔다.

실행 (저장소 루트)::

    python -m Claude_Work.rebalance.wp_forecast            # 계산만, Claude_Work/data/whitepaper_live.json 저장
    python -m Claude_Work.rebalance.wp_forecast --upload   # + R2 업로드
"""

from __future__ import annotations

import argparse
import json
import re
import statistics as st
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
STATIC = DATA / "whitepaper_static.json"
LOCAL_OUT = DATA / "whitepaper_live.json"
R2_KEY = "rebalance/whitepaper_live.json"
KST = ZoneInfo("Asia/Seoul")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
STOCK = re.compile(r"^[0-9][0-9A-Z]{5}$")
TOP2 = ("005930", "000660")
FIXED = {"K200", "KQ150", "MSCIK"}   # 방법론 공개 지수: 유동시총 비례(상한 없음)로 고정


def _num(s: Any) -> float:
    try:
        return float(str(s or "").replace(",", "").strip())
    except ValueError:
        return 0.0


def _retry(fn, tries: int = 3, pause: float = 2.0):
    for k in range(tries):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(pause * (k + 1))
    return None


# ---------------------------------------------------------------- 운용사 PDF (당일 1회)
def _isin(code: str) -> str:
    base = "KR7" + code + "00"
    digits = "".join(str(int(c, 36)) for c in base)
    s = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        s += d
    return base + str((10 - s % 10) % 10)


def _cells(html: str) -> list[list[str]]:
    rows = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        rows.append([re.sub(r"<[^>]+>|&nbsp;", " ", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)])
    return rows


def pdf_tiger(code: str, ymd: str) -> dict[str, float]:
    r = requests.post("https://investments.miraeasset.com/tigeretf/ko/product/search/detail/pdf/excel.do",
                      data={"ksdFund": _isin(code), "startDate": "", "endDate": "", "period": "Week01",
                            "fixDate": f"{ymd[:4]}.{ymd[4:6]}.{ymd[6:]}", "order": "SRD"}, headers=UA, timeout=30)
    r.raise_for_status()
    out: dict[str, float] = {}
    for c in _cells(r.text):
        if len(c) >= 5 and STOCK.match(c[1]):
            out[c[1]] = out.get(c[1], 0) + _num(c[3])
    return out


def pdf_sol(fund_cd: str, ymd: str) -> dict[str, float]:
    r = requests.get("https://www.soletf.com/api/fund/pdfList", params={"fund_cd": fund_cd, "work_dt": ymd}, headers=UA, timeout=30)
    r.raise_for_status()
    out: dict[str, float] = {}
    for row in r.json() or []:
        c = str(row.get("STOCK_CODE") or "")
        if STOCK.match(c):
            out[c] = out.get(c, 0) + float(row.get("QTY") or 0)
    return out


def pdf_plus(n: str, ymd: str) -> dict[str, float]:
    r = requests.get("https://www.plusetf.co.kr/api/v1/product/pdf/list",
                     params={"n": n, "page": 0, "d": ymd, "pageSize": 500}, headers=UA, timeout=30)
    r.raise_for_status()
    out: dict[str, float] = {}
    for row in r.json().get("content") or []:
        c = str(row.get("jmCd") or "")
        if str(row.get("wkdate")) == ymd and STOCK.match(c):
            out[c] = out.get(c, 0) + float(row.get("amount") or 0)
    return out


def pdf_hanaro(uid: str, ymd: str) -> dict[str, float]:
    r = requests.get(f"https://www.hanaroetf.com/api/v1/fund/{uid}/get-fund-holdings-list",
                     params={"baseDate": f"{ymd[:4]}.{ymd[4:6]}.{ymd[6:]}"}, headers=UA, timeout=30)
    r.raise_for_status()
    out: dict[str, float] = {}
    for c in _cells(r.text):
        if len(c) >= 5 and re.match(r"^KR7[0-9A-Z]{6}", c[1]):
            k = c[1][3:9]
            out[k] = out.get(k, 0) + _num(c[3])
    return out


def pdf_kodex(fid: str, ymd: str) -> dict[str, float]:
    # www.samsungfund.com 은 빠른 요청에 Cloudflare 429 → 모바일 도메인
    r = requests.get(f"https://m.samsungfund.com/api/v1/kodex/product-pdf/{fid}.do", params={"gijunYMD": ymd}, headers=UA, timeout=30)
    r.raise_for_status()
    out: dict[str, float] = {}
    for row in (r.json().get("pdf") or {}).get("list") or []:
        c = str(row.get("itmNo") or "")
        if STOCK.match(c):
            out[c] = out.get(c, 0) + _num(row.get("applyQ"))
    return out


PDF = {"tiger": (pdf_tiger, 0.5), "sol": (pdf_sol, 3.0), "plus": (pdf_plus, 0.5), "hanaro": (pdf_hanaro, 0.5), "kodex": (pdf_kodex, 4.0)}


def get_pdf(src: dict[str, Any], day: date) -> tuple[dict[str, float], str] | tuple[None, None]:
    fn, pause = PDF[src["kind"]]
    d = day
    for _ in range(6):                       # 당일 → 이전 평일 (휴장일은 빈 응답)
        if d.weekday() < 5:
            ymd = d.strftime("%Y%m%d")
            try:
                q = _retry(lambda: fn(src["id"], ymd))
            except Exception as exc:  # noqa: BLE001
                print(f"  PDF {src['kind']}:{src['id']} {ymd} 실패: {exc}")
                q = None
            time.sleep(pause)
            if q:
                return q, ymd
        d -= timedelta(days=1)
    return None, None


# ---------------------------------------------------------------- 네이버 시세
def market_rank(mkt: str) -> list[dict[str, Any]]:
    """시가총액 순위 (보통주만 — 우선주·스팩·리츠·인프라 제외). mcap 원, price 원."""
    out: list[dict[str, Any]] = []
    for page in range(1, 41):
        r = _retry(lambda: requests.get(f"https://m.stock.naver.com/api/stocks/marketValue/{mkt}",
                                        params={"page": page, "pageSize": 100}, headers=UA, timeout=30))
        stocks = r.json().get("stocks") or []
        if not stocks:
            break
        for x in stocks:
            n = x["stockName"]
            if (x.get("stockEndType") != "stock" or n.endswith(("우", "우B", "우C")) or "스팩" in n or n.endswith("리츠")
                    or "리츠부동산" in n or "(전환)" in n or "인프라" in n or "Reg.S" in n or "펀드" in n):
                continue
            out.append({"code": x["itemCode"], "name": n, "mcap": _num(x.get("marketValue")) * 1e8,
                        "price": _num(x.get("closePrice"))})
        time.sleep(0.2)
    return out


def realtime(codes: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(codes), 40):
        chunk = codes[i:i + 40]
        r = _retry(lambda: requests.get(f"https://polling.finance.naver.com/api/realtime/domestic/stock/{','.join(chunk)}",
                                        headers={**UA, "Referer": "https://m.stock.naver.com/"}, timeout=30))
        for row in r.json().get("datas") or []:
            out[str(row.get("itemCode"))] = {"name": row.get("stockName"),
                                             "price": _num(row.get("closePriceRaw") or row.get("closePrice")),
                                             "mcap": _num(row.get("marketValueFullRaw"))}
        time.sleep(0.3)
    return out


def etf_aum_eok() -> dict[str, tuple[str, float]]:
    r = _retry(lambda: requests.get("https://finance.naver.com/api/sise/etfItemList.nhn",
                                    params={"etfType": 0, "targetColumn": "market_sum", "sortOrder": "desc"}, headers=UA, timeout=30))
    d = json.loads(r.content.decode("euc-kr", errors="replace"))
    return {x["itemcode"]: (x["itemname"], float(x.get("marketSum") or 0)) for x in d["result"]["etfItemList"]}


class Market:
    """하루치 시세 캐시 — 종가·시총·종목명·20일 평균 거래대금."""

    def __init__(self, static: dict[str, Any], day: date):
        self.day = day
        cols = static["stock_cols"]
        self.info = {c: dict(zip(cols, v)) for c, v in static["stocks"].items()}
        self.rank = {"KOSPI": market_rank("KOSPI"), "KOSDAQ": market_rank("KOSDAQ")}
        self.q: dict[str, dict[str, Any]] = {x["code"]: x for m in self.rank.values() for x in m}
        self._adv: dict[str, float | None] = {}
        prev = DATA / "adv.json"            # fetch.py 가 모은 ADV(억원) 재사용
        if prev.exists():
            doc = json.loads(prev.read_text(encoding="utf-8"))
            if doc.get("as_of") == day.isoformat():
                self._adv.update({c: v * 1e8 for c, v in (doc.get("adv_eok") or {}).items() if v})

    def ensure(self, codes) -> None:
        miss = [c for c in codes if c not in self.q and STOCK.match(c)]
        if miss:
            for c, v in realtime(miss).items():
                self.q[c] = {"code": c, **v}

    def price(self, c: str) -> float | None:
        return (self.q.get(c) or {}).get("price") or None

    def name(self, c: str) -> str:
        return (self.q.get(c) or {}).get("name") or c

    def fl(self, c: str) -> float | None:
        return (self.info.get(c) or {}).get("float")

    def fmcap(self, c: str) -> float | None:
        m, f = (self.q.get(c) or {}).get("mcap"), self.fl(c)
        return m * f if m and f else None

    def adv20(self, c: str) -> float | None:
        if c not in self._adv:
            from . import naver

            try:
                df = naver.daily_bars(c, self.day - timedelta(days=45), self.day)
                self._adv[c] = float((df["close"] * df["volume"]).tail(20).mean()) if len(df) >= 5 else None
            except Exception:  # noqa: BLE001
                self._adv[c] = None
            time.sleep(0.08)
        return self._adv[c]


# ---------------------------------------------------------------- 가중 규칙 (forward.cap_weights 와 같은 계산)
def cap_weights(raw: dict[str, float], rest: float) -> dict[str, float]:
    lim = rest / 100
    tot = sum(raw.values())
    w = {c: raw[c] / tot for c in raw}
    for _ in range(50):
        over = {c for c in w if w[c] > lim + 1e-12}
        if not over:
            break
        excess = sum(w[c] - lim for c in over)
        for c in over:
            w[c] = lim
        free = [c for c in w if w[c] < lim - 1e-12]
        fs = sum(w[c] for c in free)
        if not fs:
            break
        for c in free:
            w[c] += excess * w[c] / fs
    return w


def apply(scheme: list, fm: dict[str, float]) -> dict[str, float]:
    k = scheme[0]
    if k == "none":
        t = sum(fm.values())
        return {c: v / t for c, v in fm.items()}
    if k == "eq":
        return {c: 1 / len(fm) for c in fm}
    if k == "cap":
        return cap_weights(fm, scheme[1])
    if k == "top2":
        t2 = [c for c in TOP2 if c in fm]
        rest = {c: v for c, v in fm.items() if c not in t2}
        share = 1 - 0.25 * len(t2)
        rw = cap_weights(rest, scheme[1] / share) if scheme[1] else {c: v / sum(rest.values()) for c, v in rest.items()}
        return {**{c: 0.25 for c in t2}, **{c: rw[c] * share for c in rest}}
    raise ValueError(k)


def label(s: list) -> str:
    if s[0] == "none":
        return "유동시총 비례(상한 없음)"
    if s[0] == "eq":
        return "동일비중"
    if s[0] == "cap":
        return f"유동시총 비례·종목 상한 {s[1]}%"
    return "삼성전자·SK하이닉스 각 25% + 나머지 유동시총 비례" + (f"·상한 {s[1]}%" if s[1] else "")


# ---------------------------------------------------------------- 종목 교체 (forward2 와 같은 규칙)
def liq_floor(M: Market, w0) -> float:
    a = sorted(x for x in (M.adv20(c) for c in w0) if x)
    return a[len(a) // 20] if a else 0


def sel_index(M: Market, u: dict[str, Any], w0, floor: float, asof: str):
    rk = M.rank[u["mkt"]]
    pos = {x["code"]: i + 1 for i, x in enumerate(rk)}
    add_rank, del_rank, max_chg = u["add_rank"], u["del_rank"], u["max_chg"]
    adds = [x["code"] for x in rk[:add_rank] if x["code"] not in w0 and (M.adv20(x["code"]) or 0) >= floor][:max_chg]
    dels = sorted([c for c in w0 if pos.get(c, 9999) > del_rank], key=lambda c: -pos.get(c, 9999))
    if len(dels) < len(adds):
        more = sorted([c for c in w0 if c not in dels], key=lambda c: -pos.get(c, 9999))
        dels += more[: len(adds) - len(dels)]
    dels = dels[: len(adds)] if adds else dels[: max_chg // 2]
    note = (f"{u['mkt']} 시가총액 {add_rank}위 이내 비구성 종목 편입, {del_rank}위 밖 구성종목 우선 편출(편입 수만큼, 최대 {max_chg}종목). "
            f"편입 후보는 20일 평균 거래대금 {floor/1e8:,.0f}억원(현 구성종목 하위 5%) 이상. KRX 산업군 대표성·상장기간 심사는 미반영")
    return adds, dels, note


def msci_sel(M: Market, w0, floor: float, asof: str):
    rk = M.rank["KOSPI"] + M.rank["KOSDAQ"]
    fm = {x["code"]: M.fmcap(x["code"]) for x in rk}
    fm = {c: v for c, v in fm.items() if v}
    order = sorted(fm, key=lambda c: -fm[c])
    tot = sum(fm.values())
    cum, run = {}, 0.0
    for c in order:
        cum[c] = (run + fm[c] / 2) / tot * 100
        run += fm[c]
    mem = [c for c in w0 if c in cum]
    adds = [c for c in order if c not in w0 and cum[c] <= 80 and (M.adv20(c) or 0) >= floor]
    dels = [c for c in w0 if c in cum and cum[c] > 90]
    note = (f"국내 상장 보통주 유동시총(시가총액 × 유동비율, {asof} 종가) 누적 커버리지로 근사 — 누적 80% 안 비구성 종목 편입, "
            f"90% 밖 구성종목 편출 (현재 구성종목 누적 위치 최대 {max((cum[c] for c in mem), default=0):.0f}%). "
            "MSCI 외국인 한도·FIF 반올림·규모 기준 미반영")
    return adds, dels, note


def hdiv_sel(M: Market, w0, floor: float, asof: str, keep: int = 45, max_chg: int = 3):
    rk = M.rank["KOSPI"][:200]
    dy = {x["code"]: (M.info.get(x["code"]) or {}).get("dy") or 0 for x in rk}
    order = sorted(dy, key=lambda c: -dy[c])
    pos = {c: i + 1 for i, c in enumerate(order)}
    out_ = sorted([c for c in w0 if pos.get(c, 999) > keep], key=lambda c: -pos.get(c, 999))[:max_chg]
    new = [c for c in order if c not in w0 and (M.adv20(c) or 0) >= floor][: len(out_)]
    out_ = out_[: len(new)]
    note = (f"코스피 시가총액 상위 200 중 현금배당수익률 순위 — {keep}위 밖 기존 종목을 최대 {max_chg}개(과거 정기변경 편입 수) 교체, "
            f"후보는 거래대금 {floor/1e8:,.0f}억원 이상. 실제 지수는 예상 배당수익률(컨센서스) 기준")
    return new, out_, note


def ksemi_sel(M: Market, w0, floor: float, asof: str, n: int = 20, add_rank: int = 15, keep_rank: int = 25):
    rk = M.rank["KOSPI"] + M.rank["KOSDAQ"]
    semis = [x["code"] for x in rk if (M.info.get(x["code"]) or {}).get("wics") == "반도체와반도체장비"]
    fm = {c: M.fmcap(c) for c in set(semis) | set(w0)}
    order = sorted([c for c in fm if fm[c]], key=lambda c: -fm[c])
    pos = {c: i + 1 for i, c in enumerate(order)}
    keepers = [c for c in w0 if pos.get(c, 999) <= keep_rank]
    adds = [c for c in order[:add_rank] if c not in w0 and (M.adv20(c) or 0) >= floor]
    sel = keepers + adds
    if len(sel) > n:
        sel = sorted(sel, key=lambda c: pos.get(c, 999))[:n]
    note = (f"WICS 반도체와반도체장비 종목 유동시총 순위 — {add_rank}위 안 비구성 종목 편입, 기존 종목은 {keep_rank}위 안이면 유지, {n}종목. "
            "기존 비반도체 종목(반도체 매출 10% 기준 편입)은 같은 유동시총 순위로 평가")
    return [c for c in sel if c not in w0], [c for c in w0 if c not in sel], note


# ---------------------------------------------------------------- 이벤트
def _row(M: Market, c: str, w0: float, w1: float, A: float, st_: str) -> dict[str, Any]:
    dw = w1 - w0
    flow = A * dw / 1e8
    a = M.adv20(c)
    adv = a / 1e8 if a else None
    f = M.fl(c)
    return {"name": M.name(c), "code": c, "w0": round(w0 * 100, 3), "w1": round(w1 * 100, 3), "dw": round(dw * 100, 3),
            "flow": round(flow, 1), "adv": round(adv, 1) if adv else None,
            "imp": round(abs(flow) / adv * 100, 1) if adv else None, "status": st_,
            "float": round(f * 100, 1) if f else None, "close": M.price(c)}


def range_event(u: dict[str, Any], A: float, members: list[str], asof: str) -> dict[str, Any]:
    t = u["range_turnovers"]
    lo, md, hi = t[0], st.median(t), t[-1]
    return {"gid": u["gid"], "short": u["short"], "date": u["date"], "label": u["label"], "aum_jo": round(A / 1e12, 2),
            "members": members, "pdf_date": asof.replace("-", ""), "scheme": "규칙 재현 불가 → 범위 추정",
            "fit_dist": u.get("fit_dist") or 0, "fit_date": "", "range": True,
            "sel_note": f"직전 6·12월 정기변경 {len(t)}회 회전율 {lo:.0f}~{hi:.0f}%(중앙 {md:.0f}%) × {asof} AUM",
            "target_note": "어느 후보 규칙과도 맞지 않음(테마 점수 가중 추정) — 종목별 생략",
            "n_add": 0, "n_del": 0, "adds": [], "dels": [], "turn": round(md, 1),
            "buy": round(A * md / 100 / 1e8), "sell": -round(A * md / 100 / 1e8),
            "buy_range": [round(A * lo / 100 / 1e8), round(A * hi / 100 / 1e8)],
            "n30": 0, "buys": [], "sells": [], "all": [], "conf_w": "범위", "conf_s": "미반영"}


def build_event(M: Market, u: dict[str, Any], aum: dict[str, tuple[str, float]], asof: str, k200: dict | None):
    members = [aum[c][0] for c in u["members"] if c in aum]
    A = sum(aum[c][1] for c in u["members"] if c in aum) * 1e8
    if u.get("range_turnovers"):
        return range_event(u, A, members, asof), [], []
    q, pdf_d = get_pdf(u["pdf"], M.day)
    if not q:
        raise RuntimeError(f"{u['gid']}: 운용사 PDF 없음")
    M.ensure(list(q))
    v = {c: q[c] * (M.price(c) or 0) for c in q}
    t = sum(v.values())
    w0 = {c: x / t for c, x in v.items() if x > 0}
    scheme = ["none"] if u["gid"] in FIXED else u["scheme"]
    floor = liq_floor(M, w0)
    adds, dels, sel_note = [], [], "종목 교체 미반영(규칙 비공개·재현 불가) — 비중 재설정만"
    if u["sel"] == "index":
        adds, dels, sel_note = sel_index(M, u, w0, floor, asof)
    elif u["sel"] == "msci":
        adds, dels, sel_note = msci_sel(M, w0, floor, asof)
    elif u["sel"] == "hdiv":
        adds, dels, sel_note = hdiv_sel(M, w0, floor, asof)
    elif u["sel"] == "ksemi":
        adds, dels, sel_note = ksemi_sel(M, w0, floor, asof)
    elif u["sel"] == "k200it" and k200:
        itset = {(M.info.get(c) or {}).get("wics") for c in w0} - {None}
        adds = [c for c in k200["adds"] if (M.info.get(c) or {}).get("wics") in itset]
        dels = [c for c in k200["dels"] if c in w0]
        sel_note = f"코스피200 예상 편출입 중 현재 IT 구성종목과 같은 WICS 업종({', '.join(sorted(itset))})만 반영"
    M.ensure(adds)
    keep = [c for c in w0 if c not in dels]
    if scheme[0] == "none":
        ratio = [w0[c] / M.fmcap(c) for c in keep if M.fmcap(c)]
        kf = st.median(ratio) if ratio else 0
        add_w = {c: kf * (M.fmcap(c) or 0) for c in adds}
        scale = (1 - sum(add_w.values())) / sum(w0[c] for c in keep)
        w1 = {**{c: w0[c] * scale for c in keep}, **add_w}
        target_note = "기존 종목 비중 유지, 신규 편입만 유동시총(PDF 내재 유동비율 보정)"
    else:
        newset = keep + adds
        fm = {c: M.fmcap(c) for c in newset}
        lack = [c for c, x in fm.items() if not x]
        fmv = {c: x for c, x in fm.items() if x}
        fixed = sum(w0.get(c, 0) for c in lack)
        w1 = {c: x * (1 - fixed) for c, x in apply(scheme, fmv).items()}
        for c in lack:                      # 유동비율 정보 없는 종목은 현재 비중 유지
            w1[c] = w0.get(c, 0)
        target_note = f"{label(scheme)} → {asof} 종가·유동비율로 재계산"
    rows = []
    for c in set(w0) | set(w1):
        st_ = "편입" if c not in w0 else ("편출" if c not in w1 or w1[c] == 0 else "유지")
        rows.append(_row(M, c, w0.get(c, 0), w1.get(c, 0), A, st_))
    rows = [r for r in rows if abs(r["flow"]) >= 0.05]
    buys = sorted([r for r in rows if r["flow"] > 0], key=lambda r: -(r["imp"] or 0))
    sells = sorted([r for r in rows if r["flow"] < 0], key=lambda r: -(r["imp"] or 0))
    ev = {"gid": u["gid"], "short": u["short"], "date": u["date"], "label": u["label"], "aum_jo": round(A / 1e12, 2),
          "members": members, "pdf_date": pdf_d, "scheme": label(scheme), "fit_dist": u["fit_dist"], "fit_date": u["fit_date"],
          "sel_note": sel_note, "target_note": target_note, "n_add": len(adds), "n_del": len(dels),
          "adds": [M.name(c) for c in adds], "dels": [M.name(c) for c in dels],
          "turn": round(0.5 * sum(abs(r["dw"]) for r in rows), 2),
          "buy": round(sum(r["flow"] for r in rows if r["flow"] > 0)), "sell": round(sum(r["flow"] for r in rows if r["flow"] < 0)),
          "n30": sum((r["imp"] or 0) >= 30 for r in rows), "buys": buys[:30], "sells": sells[:30],
          "all": sorted(rows, key=lambda r: -abs(r["flow"])),
          "conf_w": u["conf_w"],
          "conf_s": {"index": "근사(시총 순위)", "msci": "근사(유동시총 커버리지)", "hdiv": "근사(배당수익률 순위)",
                     "ksemi": "근사(유동시총 순위)", "k200it": "근사(KOSPI200 연동)"}.get(u["sel"] or "", "미반영")}
    return ev, adds, dels


def combined(evs: list[dict[str, Any]], window: list[str]) -> dict[str, list]:
    agg: dict[str, dict[str, Any]] = {}
    for e in evs:
        if not window[0] <= e["date"] <= window[1]:
            continue
        for r in e.get("all") or []:
            a = agg.setdefault(r["code"], {"name": r["name"], "code": r["code"], "flow": 0.0, "adv": r["adv"], "groups": []})
            a["flow"] += r["flow"]
            if abs(r["flow"]) >= 0.5:
                a["groups"].append(f"{e['short']} {r['flow']:+,.0f}")
    for a in agg.values():
        a["flow"] = round(a["flow"], 1)
        a["imp"] = round(abs(a["flow"]) / a["adv"] * 100, 1) if a["adv"] else None
    rows = [a for a in agg.values() if abs(a["flow"]) >= 0.5]
    return {"buys": sorted([a for a in rows if a["flow"] > 0], key=lambda a: -(a["imp"] or 0))[:30],
            "sells": sorted([a for a in rows if a["flow"] < 0], key=lambda a: -(a["imp"] or 0))[:30]}


def build(day: date | None = None, prev: dict[str, Any] | None = None) -> dict[str, Any]:
    """오늘 기준 국내 그룹 예상. ``prev`` = 직전 R2 결과(매매일이 지난 이벤트는 거기서 가져온다)."""
    day = day or datetime.now(KST).date()
    asof = day.isoformat()
    static = json.loads(STATIC.read_text(encoding="utf-8"))
    prev_ev = {(e["gid"], e["date"]): e for e in (prev or {}).get("events") or []}
    M = Market(static, day)
    aum = etf_aum_eok()
    evs, errors, k200 = [], [], None
    for u in static["events"]:
        if u["date"] < asof and (u["gid"], u["date"]) in prev_ev:
            evs.append({**prev_ev[(u["gid"], u["date"])], "frozen": True})
            continue
        try:
            ev, adds, dels = build_event(M, u, aum, asof, k200)
        except Exception as exc:  # noqa: BLE001 - 한 그룹 실패는 직전 값으로 대체
            errors.append(f"{u['gid']}: {exc}")
            old = prev_ev.get((u["gid"], u["date"]))
            if old:
                evs.append({**old, "stale": True})
            continue
        if u["gid"] == "K200":
            k200 = {"adds": adds, "dels": dels}
        evs.append(ev)
        print(f"  {u['gid']:8s} {u['date']} 회전율 {ev['turn']}% 매수 {ev['buy']:,}억 편입 {ev['n_add']} 편출 {ev['n_del']}")
    return {"as_of": asof, "generated_at": datetime.now(KST).isoformat(timespec="seconds"),
            "float_asof": static.get("float_asof"), "events": evs,
            "combined": combined(evs, static["combined_window"]), "combined_window": static["combined_window"],
            "errors": errors}


def publish(result: dict[str, Any]) -> bool:
    from r2_data import put_json

    # put_json_daily 는 키의 부모 폴더 snapshots/ 에 일자 사본을 쓴다.
    # 이 키의 부모는 rebalance 라서, 본 작업의 rebalance/snapshots/{날짜}.json 을 덮어쓴다.
    ok = put_json(R2_KEY, result)
    day = str(result.get("as_of") or "")[:10]
    if ok and len(day) == 10:
        put_json(f"rebalance/whitepaper_snapshots/{day}.json", result)
    return bool(ok)


def run(upload: bool = False) -> dict[str, Any]:
    prev = None
    try:
        from r2_data import get_json

        prev = get_json(R2_KEY)
    except Exception as exc:  # noqa: BLE001
        print(f"wp_forecast: 직전 R2 읽기 실패 ({exc})")
    if prev is None and LOCAL_OUT.exists():
        prev = json.loads(LOCAL_OUT.read_text(encoding="utf-8"))
    result = build(prev=prev)
    LOCAL_OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if upload:
        result["uploaded"] = publish(result)
    return result


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--upload", action="store_true", help="R2 rebalance/whitepaper_live.json 업로드")
    args = p.parse_args(argv)
    t = time.time()
    r = run(upload=args.upload)
    print(f"as_of={r['as_of']} events={len(r['events'])} errors={r['errors']} upload={r.get('uploaded')} {time.time()-t:.0f}s")


if __name__ == "__main__":
    main()

"""ETF Flow 주간 정기 업데이트 — 데이터 수집·집계.

요청 양식(`ETF Flow Data 요청_YYMM.xlsx`) 6개 섹션을 채우는 payload 를 만든다.

1. 자산군별 주간 순유입 (미국 상장, $B)        ← ETF CHECK 글로벌 일별 순유입(Morningstar)
2. 테마별 주간 순유입 4주                         ← 〃 + ETF CHECK 분류(ctgCode)
3. 미국 상장 ETF 주간 유출입 Top 10 (+국내 유사)  ← 〃 + Naver ETF 목록
4. 국내 상장 해외 ETF 투자자별 수급 (억원)        ← Naver 종목별 투자자 순매수(수량) × 종가
5. 국내 상장 해외 ETF 개인 순매수/순매도 Top 20   ← 〃
6. 차주 주요 이벤트                              ← TradingView 경제캘린더 + Nasdaq 실적캘린더

주(週) 정의: 시장별 최근 5거래일 = 이번주, 그 전 5거래일 = 지난주 (롤링). 실행 요일과
무관하게 같은 길이의 창을 비교하기 위함이며, 날짜 범위는 payload/엑셀에 표기한다.

    python 03_ETF/etf_flow_weekly.py            # 수집 → 00_exports/etf_flow_weekly/ 에 json+xlsx
    python 03_ETF/etf_flow_weekly.py --publish  # + R2 업로드 (웹 탭이 읽음)
"""

from __future__ import annotations

import path_setup  # noqa: F401  # numbered folders on sys.path

import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

from etfcheck_client import EtfCheckClient

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "00_exports" / "etf_flow_weekly"
CACHE_DIR = OUT_DIR / "cache"

R2_LATEST_JSON = "etf_flow_weekly/latest.json"
R2_LATEST_XLSX = "etf_flow_weekly/latest.xlsx"
R2_SNAP_PREFIX = "etf_flow_weekly/snapshots/"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
KST = timezone(timedelta(hours=9))
WEEK_DAYS = 5
HIST_GUBUN = "3M"  # ~65 거래일: 4주 + 여유

# ── 미국: 자산군 · 테마 정의 (ETF CHECK ctgCode) ───────────────────────────────
# 한 ETF 가 여러 대분류에 걸칠 수 있어 우선순위 순서로 1개 자산군만 부여한다.
ASSET_CLASSES = ["주식", "채권", "원자재", "디지털 자산"]
_ASSET_PRIORITY = [
    ("0109", "디지털 자산"),
    ("0105", "원자재"),
    ("0102", "채권"),
    ("0108", "채권"),  # 단기자금(T-bill·초단기채) → 채권
    ("0101", "주식"),
    ("0103", "주식"),  # 리츠·부동산 주식
]
PLAIN = "0301001"  # 레버리지/인버스 분류 중 '정방향'


def _theme_rules() -> list[dict[str, Any]]:
    """테마 = 정방향(비레버리지) ETF 중 아래 조건. any=OR, all=AND, none=제외."""
    return [
        {"name": "미국 대형주(S&P500)", "any": ["0501007"], "equity": True},
        {
            "name": "미국 국채 중장기",
            "all": ["0102001", "0201002"],
            "none": ["0102004", "0102007", "0102010", "0108001", "0108002", "0108003"],
            "no_muni": True,
        },
        {"name": "투자등급 회사채", "any": ["0102002"], "none": ["0102008", "0102011"]},
        {"name": "금", "any": ["0105006", "0105007"]},
        {
            "name": "미국 배당주",
            "all": ["0609001", "0201002"],
            "none": ["0609005", "0102001", "0102002", "0102003"],
            "equity": True,
        },
        {"name": "에너지", "any": ["0401005"], "equity": True},
        {"name": "디지털자산", "any": ["01090"], "prefix": True},
        {"name": "하이일드", "any": ["0102008"]},
        {"name": "중국 주식", "all": ["0201003"], "any": ["0101"], "prefix": True, "equity": True},
        {"name": "반도체", "any": ["0601007", "0601006"], "equity": True},
    ]


def _match(codes: set[str], keys: list[str], prefix: bool) -> list[bool]:
    if prefix:
        return [any(c.startswith(k) for c in codes) for k in keys]
    return [k in codes for k in keys]


_RE_MUNI = re.compile(r"muni|municipal|tax[- ]exempt|tax[- ]free", re.I)


def theme_of(codes: set[str], name: str = "") -> list[str]:
    if PLAIN not in codes:
        return []
    out = []
    equity = asset_class_of(codes) == "주식"
    for rule in _theme_rules():
        if rule.get("equity") and not equity:
            continue
        if rule.get("no_muni") and _RE_MUNI.search(name):
            continue
        pre = bool(rule.get("prefix"))
        if rule.get("all") and not all(_match(codes, rule["all"], False)):
            continue
        if rule.get("any") and not any(_match(codes, rule["any"], pre)):
            continue
        if rule.get("none") and any(_match(codes, rule["none"], False)):
            continue
        out.append(rule["name"])
    return out


def asset_class_of(codes: set[str]) -> str:
    larges = {c[:4] for c in codes}
    for large, label in _ASSET_PRIORITY:
        if large in larges:
            return label
    return "기타"


# ── 국내 유사 ETF 매핑 (미국 티커 → 국내 ETF 이름 키워드; TIGER 우선) ─────────
# 값은 '이름에 모두 포함돼야 하는 키워드' 후보 목록(앞에서부터 시도).
KR_SIMILAR: dict[str, list[list[str]]] = {
    **{t: [["미국S&P500"]] for t in ("SPY", "VOO", "IVV", "SPYM", "SPLG", "RSP")},
    **{t: [["미국나스닥100"]] for t in ("QQQ", "QQQM", "ONEQ")},
    **{t: [["미국필라델피아반도체"], ["미국반도체"]] for t in ("SOXX", "SMH", "SOXL", "SOXQ", "PSI")},
    **{t: [["미국배당다우존스"]] for t in ("SCHD",)},
    **{t: [["미국배당"], ["미국S&P500배당"]] for t in ("VIG", "VYM", "DGRO", "DVY", "SDY", "NOBL", "HDV")},
    **{t: [["미국테크TOP10"], ["미국빅테크"]] for t in ("XLK", "VGT", "IYW", "FTEC", "MAGS")},
    **{t: [["미국30년국채"], ["미국채30년"], ["미국장기국채"]] for t in ("TLT", "EDV", "VGLT", "SPTL", "ZROZ", "TMF", "GOVZ")},
    **{t: [["미국채10년"], ["미국10년국채"], ["미국채"]] for t in ("IEF", "GOVT", "VGIT", "SCHR", "IEI", "TLH")},
    **{t: [["미국달러단기채권"], ["미국초단기"], ["미국달러SOFR"], ["달러단기채"]] for t in ("SGOV", "BIL", "SHV", "USFR", "TFLO", "BILS", "SHY", "VGSH", "TBIL")},
    **{t: [["미국투자등급회사채"], ["투자등급회사채"], ["회사채"]] for t in ("LQD", "VCIT", "VCSH", "IGSB", "IGIB", "SPIB", "USIG", "VTC", "SPSB")},
    **{t: [["하이일드"]] for t in ("HYG", "JNK", "USHY", "SHYG", "SJNK", "HYLB")},
    **{t: [["미국종합채권"], ["종합채권"]] for t in ("AGG", "BND", "BNDX", "SCHZ", "IUSB", "FBND", "JAAA")},
    **{t: [["골드선물"], ["금현물"], ["금"]] for t in ("GLD", "IAU", "GLDM", "SGOL", "AAAU", "BAR", "UGL")},
    **{t: [["은선물"], ["은현물"]] for t in ("SLV", "SIVR", "AGQ")},
    **{t: [["원유선물"], ["WTI"]] for t in ("USO", "BNO", "UCO", "DBO")},
    **{t: [["구리"]] for t in ("CPER", "COPX")},
    **{t: [["금채굴"], ["골드마이너"]] for t in ("GDX", "GDXJ", "RING", "NUGT")},
    **{t: [["에너지"]] for t in ("XLE", "VDE", "XOP", "OIH", "IXC", "FENY")},
    **{t: [["미국러셀2000"], ["러셀2000"]] for t in ("IWM", "VTWO", "TNA")},
    **{t: [["미국다우존스30"], ["다우존스30"]] for t in ("DIA",)},
    **{t: [["미국S&P500"], ["미국대형"]] for t in ("VTI", "ITOT", "SCHB", "SCHX", "VV", "IWB", "SCHG", "VUG", "IWF", "MGK", "SCHV", "VTV", "IWD", "SPYG", "SPYV")},
    **{t: [["차이나항셍테크"], ["항셍테크"]] for t in ("KWEB", "CQQQ")},
    **{t: [["차이나"], ["중국"]] for t in ("FXI", "MCHI", "ASHR", "GXC", "YINN", "CNYA", "KBA")},
    **{t: [["일본니케이225"], ["일본TOPIX"], ["일본"]] for t in ("EWJ", "DXJ", "BBJP", "HEWJ")},
    **{t: [["인도니프티50"], ["인도"]] for t in ("INDA", "EPI", "INDY", "FLIN", "SMIN")},
    **{t: [["유로스탁스50"], ["유럽"]] for t in ("VGK", "IEUR", "EZU", "FEZ", "HEDJ")},
    **{t: [["대만"]] for t in ("EWT",)},
    **{t: [["브라질"], ["라틴"]] for t in ("EWZ", "ILF")},
    "CNEQ": [["차이나CSI300"], ["차이나A50"]],
    **{t: [["미국헬스케어"], ["헬스케어"]] for t in ("XLV", "VHT", "IBB", "XBI")},
    **{t: [["미국금융"], ["은행"]] for t in ("XLF", "VFH", "KRE", "KBE")},
    **{t: [["미국방산"], ["방산"]] for t in ("ITA", "XAR", "PPA", "SHLD")},
    **{t: [["미국원자력"], ["원자력"], ["우라늄"]] for t in ("URA", "URNM", "NLR", "NUKZ")},
    **{t: [["미국AI전력"], ["전력"], ["유틸리티"]] for t in ("XLU", "VPU", "GRID")},
    **{t: [["리츠"]] for t in ("VNQ", "XLRE", "SCHH", "IYR")},
    **{t: [["미국소프트웨어"], ["소프트웨어"]] for t in ("IGV",)},
    **{t: [["로봇"]] for t in ("BOTZ", "ROBO")},
    **{t: [["양자컴퓨팅"], ["양자"]] for t in ("QTUM",)},
    **{t: [["커버드콜"]] for t in ("JEPI", "JEPQ", "QYLD", "XYLD", "SPYI", "QQQI", "DIVO", "GPIX", "GPIQ")},
    **{t: [["테슬라"]] for t in ("TSLL", "TSLQ", "TSLY")},
    **{t: [["엔비디아"]] for t in ("NVDL", "NVDU", "NVDY")},
    **{t: [["선진국"], ["MSCI선진국"]] for t in ("VEA", "IEFA", "EFA", "SCHF", "SPDW", "VXUS", "IXUS", "VEU")},
    **{t: [["이머징"], ["신흥국"]] for t in ("VWO", "IEMG", "EEM", "SCHE", "SPEM")},
    **{t: [["미국"]] for t in ("TQQQ", "UPRO", "SSO", "QLD", "SQQQ", "SPXU", "SH", "PSQ")},
}
# 섹터·테마 폴백(테마 분류명 → 키워드)
KR_SIMILAR_BY_THEME: dict[str, list[list[str]]] = {
    "미국 대형주(S&P500)": [["미국S&P500"]],
    "미국 국채 중장기": [["미국30년국채"], ["미국채10년"], ["미국채"]],
    "투자등급 회사채": [["투자등급회사채"], ["회사채"]],
    "금": [["골드선물"], ["금현물"]],
    "미국 배당주": [["미국배당다우존스"], ["미국배당"]],
    "에너지": [["에너지"]],
    "하이일드": [["하이일드"]],
    "중국 주식": [["차이나"], ["중국"]],
    "반도체": [["미국필라델피아반도체"], ["반도체"]],
}
_KR_EXCLUDE_FOR_SIMILAR = re.compile(r"레버리지|인버스|2X|채권혼합|TR\)|\(H\)")
_BRAND_PREF = ["TIGER", "KODEX", "ACE", "RISE", "SOL", "PLUS", "KIWOOM", "HANARO"]


# ── 국내: 해외 ETF 분류 ──────────────────────────────────────────────────────
KR_GROUPS = ["해외주식", "해외채권", "원자재", "커버드콜&인컴"]
_RE_INCOME = re.compile(r"커버드콜|프리미엄|인컴|타겟데일리|위클리|옵션|버퍼")
_RE_OVERSEAS = re.compile(
    r"미국|해외|글로벌|선진국|신흥국|이머징|중국|차이나|일본|인도|유럽|베트남|대만|"
    r"달러|USD|S&P|나스닥|월드|아시아|멕시코|브라질|독일|호주|캐나다|홍콩|항셍|MSCI ACWI"
)


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "").replace("+", ""))
    except ValueError:
        return None


def _ymd_iso(s: str) -> str:
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


# ── 미국 수집 ────────────────────────────────────────────────────────────────
# ETF CHECK 는 병렬·연속 호출 시 IP 를 수십 분 차단한다(SYN 무응답). 단일 세션으로
# REQ_GAP 초 간격 순차 호출하고, 결과는 날짜별 캐시에 저장해 재실행 시 이어받는다.
REQ_GAP = 1.0
HIST_MAX = 300           # 일별 이력을 받는 최대 ETF 수 (|3M 순유입| 큰 순, 1초 간격 ≈ 6분)
HIST_COVERAGE = 0.97     # Σ|3M 순유입| 대비 누적 비중이 이 값을 넘으면 중단
_state: dict[str, Any] = {"client": None, "last": 0.0, "cached_only": False}


def _etfcheck(path: str, params: dict[str, Any]) -> dict[str, Any]:
    if _state["client"] is None:
        _state["client"] = EtfCheckClient(timeout=20)
        _state["client"].warmup()
    gap = REQ_GAP - (time.monotonic() - _state["last"])
    if gap > 0:
        time.sleep(gap)
    try:
        return _state["client"].get_json(path, params)
    finally:
        _state["last"] = time.monotonic()


def _cache_path(name: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / name


def _cached(name: str, fn):
    path = _cache_path(name)
    if path.exists():
        return json.loads(path.read_text())
    val = fn()
    path.write_text(json.dumps(val, ensure_ascii=False))
    return val


_RANK_BASE = dict(type="ETF", annuityCode="A", ctgLargeCode="A", orderBy="DESC",
                  leverage="", inverse="", invCode="", coveredCall="")
BULK_ORDERS = ["D", "W", "M", "3M"]


def fetch_us_universe(tag: str) -> dict[str, Any]:
    aum_rows = _cached(f"us_aum_{tag}.json", lambda: _etfcheck(
        "/user/etp/getGlobalEtfRankListMarketCap", {**_RANK_BASE, "order": "A", "limit": 9000}).get("results") or [])

    def _ctg() -> dict[str, Any]:
        cats = _etfcheck("/user/etp/getGlobalEtfInfoByCtg", {"etpType": "ETF", "notCtgCodeList": ""}).get("results") or []
        out = {}
        for cat in cats:
            res = _etfcheck("/user/etp/getGlobalEtfListByCtg",
                            {"ctgLargeCode": cat["ctgLargeCode"], "notCtgCodeList": "", "etpType": "ETF"}).get("results") or {}
            out[cat["ctgLargeCode"]] = {
                "name": cat["ctgLargeName"],
                "subs": {str(x.get("ctgCode")): x.get("ctgName") for x in res.get("ctgCodeList") or []},
                "members": [[r["MSTARID"], str(r["ctgCode"])] for r in res.get("etpList") or []],
            }
        return out

    ctg = _cached(f"us_ctg_{tag}.json", _ctg)
    bulk = {o: _cached(f"us_rank_{o}_{tag}.json", lambda o=o: _etfcheck(
        "/user/etp/getGlobalEtfRankListInflow", {**_RANK_BASE, "order": o, "limit": 9000}).get("results") or [])
        for o in BULK_ORDERS}

    codes: dict[str, set[str]] = {}
    for large in ctg.values():
        for mid, code in large["members"]:
            codes.setdefault(mid, set()).add(code)
    funds: dict[str, dict[str, Any]] = {}
    for r in aum_rows:
        mid = r.get("MSTARID")
        if mid:
            funds[mid] = {"mstar": mid, "symbol": str(r.get("SYMBOL") or "").strip(),
                          "name": str(r.get("FUNDNAME") or "").strip(),
                          "aum": _num(r.get("RANK_VALUE")) or 0.0, "aum_date": r.get("REF_DATE")}
    flow_date = None
    for o, rows in bulk.items():
        for r in rows:
            mid = r.get("MSTARID")
            if not mid:
                continue
            f = funds.setdefault(mid, {"mstar": mid, "symbol": str(r.get("SYMBOL") or "").strip(),
                                       "name": str(r.get("FUNDNAME") or "").strip(), "aum": 0.0, "aum_date": None})
            f.setdefault("bulk", {})[o] = _num(r.get("RANK_VALUE")) or 0.0
            flow_date = flow_date or r.get("W00060_date")
    for f in funds.values():
        cs = codes.get(f["mstar"], set())
        f.setdefault("bulk", {})
        f["codes"] = sorted(cs)
        f["asset_class"] = asset_class_of(cs)
        f["themes"] = theme_of(cs, f["name"])
        f["leveraged"] = PLAIN not in cs and bool(cs)
    return {"funds": funds, "flow_date": flow_date}


def _parse_hist(rows: list[dict[str, Any]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for r in rows:
        d, v = r.get("TRADEDATE"), _num(r.get("NETRPAMT"))
        if d and v is not None:
            out[str(d)] = v
    return out


def pick_history_funds(funds: dict[str, dict[str, Any]]) -> list[str]:
    """|3M|·|M| 순유입이 큰 ETF 부터, 누적 비중 HIST_COVERAGE 또는 HIST_MAX 까지 + 주간 상하위 30."""
    vals = sorted(funds.values(), key=lambda f: -(abs(f["bulk"].get("3M", 0)) + abs(f["bulk"].get("M", 0))))
    total = sum(abs(f["bulk"].get("3M", 0)) + abs(f["bulk"].get("M", 0)) for f in vals) or 1.0
    picked, acc = [], 0.0
    for f in vals:
        if len(picked) >= HIST_MAX or acc / total >= HIST_COVERAGE:
            break
        picked.append(f["mstar"])
        acc += abs(f["bulk"].get("3M", 0)) + abs(f["bulk"].get("M", 0))
    byw = sorted(funds.values(), key=lambda f: -f["bulk"].get("W", 0))
    extra = [f["mstar"] for f in byw[:30] + byw[-30:]]
    return list(dict.fromkeys(picked + extra))


def fetch_us_histories(mids: list[str], *, tag: str) -> dict[str, dict[str, float]]:
    path = _cache_path(f"us_hist_{tag}.json")
    hist: dict[str, dict[str, float]] = json.loads(path.read_text()) if path.exists() else {}
    todo = [] if _state["cached_only"] else [m for m in mids if m not in hist]
    fails = 0
    for i, mid in enumerate(todo, 1):
        try:
            rows = _etfcheck("/user/etp/getGlobalEtfInflowTermHist", {"code": mid, "gubun": HIST_GUBUN}).get("results") or []
            hist[mid] = _parse_hist(rows)
            fails = 0
        except Exception as exc:  # noqa: BLE001
            fails += 1
            print(f"  history {mid} failed ({fails}): {exc}", flush=True)
            _state["client"] = None
            if fails >= 3:
                print("  ETF CHECK 연속 실패 — 이력 수집 중단(받은 만큼 사용, 나머지는 구간 합계로 추정)", flush=True)
                break
            time.sleep(60 * fails)
        if i % 100 == 0:
            print(f"  US flow history {i}/{len(todo)}", flush=True)
            path.write_text(json.dumps(hist))
    path.write_text(json.dumps(hist))
    return hist


def week_windows(dates: list[str], n_weeks: int) -> list[list[str]]:
    """최근 → 과거 순으로 5거래일 블록."""
    ds = sorted(set(dates), reverse=True)
    out = []
    for i in range(n_weeks):
        block = ds[i * WEEK_DAYS:(i + 1) * WEEK_DAYS]
        if len(block) < WEEK_DAYS:
            break
        out.append(sorted(block))
    return out


def _label(block: list[str]) -> str:
    return f"{block[0][4:6]}/{block[0][6:]}~{block[-1][4:6]}/{block[-1][6:]}"


def _window_len(hist: dict[str, dict[str, float]], funds: dict[str, dict[str, Any]], order: str, dates: list[str]) -> int:
    """ETF CHECK 기간 합계(order)가 최근 몇 거래일 합인지 대형 ETF 로 역산."""
    votes: dict[int, int] = {}
    ds = sorted(dates, reverse=True)
    for f in sorted(funds.values(), key=lambda f: -abs(f["bulk"].get(order, 0)))[:20]:
        h = hist.get(f["mstar"])
        target = f["bulk"].get(order)
        if not h or not target:
            continue
        best = min(range(1, min(len(ds), 70) + 1),
                   key=lambda k: abs(sum(h.get(d, 0.0) for d in ds[:k]) - target))
        votes[best] = votes.get(best, 0) + 1
    return max(votes, key=votes.get) if votes else {"D": 1, "W": 5, "M": 21, "3M": 63}[order]


def build_us(kr_etfs: list[dict[str, Any]]) -> dict[str, Any]:
    tag = datetime.now(KST).strftime("%Y%m%d")
    uni = fetch_us_universe(tag)
    funds = uni["funds"]
    print(f"US universe: {len(funds)} ETFs (flow date {uni['flow_date']})", flush=True)
    picked = pick_history_funds(funds)
    print(f"US history targets: {len(picked)}", flush=True)
    hist = fetch_us_histories(picked, tag=tag)

    # 거래일 축: 대형 ETF 들의 날짜 합집합
    big = sorted((f for f in funds.values() if hist.get(f["mstar"])), key=lambda f: -f["aum"])[:50]
    dates = sorted({d for f in big for d in hist[f["mstar"]]})
    weeks = week_windows(dates, 4)  # [W0, W1, W2, W3]
    if len(weeks) < 2:
        raise RuntimeError("미국 ETF 일별 순유입 이력이 부족합니다")
    k_w = _window_len(hist, funds, "W", dates)
    k_m = _window_len(hist, funds, "M", dates)

    n_est = 0
    for f in funds.values():
        h = hist.get(f["mstar"])
        if h:
            f["weekly"] = [sum(h.get(d, 0.0) for d in b) for b in weeks]  # $, W0..W3
            f["estimated"] = False
        else:
            # 이력 미수집(소형·저유출입) ETF: ETF CHECK 기간 합계로 주간 배분
            bw, bm = f["bulk"].get("W", 0.0), f["bulk"].get("M", 0.0)
            w0 = bw * WEEK_DAYS / k_w
            rest = (bm - bw) * WEEK_DAYS / max(k_m - k_w, 1)
            f["weekly"] = [w0] + [rest] * (len(weeks) - 1)
            f["estimated"] = True
            n_est += 1
        f["w4"] = sum(f["weekly"])
    print(f"US weekly: history {len(funds) - n_est} / estimated {n_est} (W={k_w}d, M={k_m}d)", flush=True)

    # 1. 자산군
    asset = {"labels": ["전체", *ASSET_CLASSES], "this": [], "last": []}
    for lab in asset["labels"]:
        members = [f for f in funds.values() if lab == "전체" or f["asset_class"] == lab]
        asset["this"].append(sum(f["weekly"][0] for f in members) / 1e9)
        asset["last"].append(sum(f["weekly"][1] for f in members) / 1e9)

    # 2. 테마 (4주: 오래된 주 → 최근 주)
    theme_names = [r["name"] for r in _theme_rules()]
    order = list(range(len(weeks)))[::-1]
    themes = []
    for name in theme_names:
        members = [f for f in funds.values() if name in f["themes"]]
        vals = [sum(f["weekly"][i] for f in members) / 1e9 for i in order]
        top = sorted(members, key=lambda f: -f["aum"])[:5]
        themes.append({"name": name, "weekly": vals, "total": sum(vals), "count": len(members),
                       "top": [f["symbol"] for f in top]})

    # 3. Top 10
    def row(f: dict[str, Any]) -> dict[str, Any]:
        aum = f["aum"]
        return {
            "ticker": f["symbol"], "name": f["name"], "asset_class": f["asset_class"],
            "flow_w": f["weekly"][0] / 1e9,
            "flow_aum_pct": (f["weekly"][0] / aum * 100) if aum > 0 else None,
            "flow_4w": f["w4"] / 1e9, "aum_b": aum / 1e9,
            "kr_similar": kr_similar(f, kr_etfs),
        }

    ranked = sorted(funds.values(), key=lambda f: -f["weekly"][0])
    top_in = [row(f) for f in ranked[:10]]
    top_out = [row(f) for f in ranked[::-1][:10]]

    return {
        "weeks": [{"label": _label(b), "start": _ymd_iso(b[0]), "end": _ymd_iso(b[-1])} for b in weeks],
        "asset": asset,
        "themes": themes,
        "top_in": top_in,
        "top_out": top_out,
        "universe_count": len(funds),
        "history_count": len(funds) - n_est,
        "flow_date": uni["flow_date"],
        "funds": funds,
    }


def kr_similar(f: dict[str, Any], kr_etfs: list[dict[str, Any]]) -> str:
    cands = list(KR_SIMILAR.get(f["symbol"].upper(), []))
    for th in f.get("themes") or []:
        cands += KR_SIMILAR_BY_THEME.get(th, [])
    for keys in cands:
        hits = [e for e in kr_etfs
                if all(k in e["name"].replace(" ", "") for k in keys)
                and not _KR_EXCLUDE_FOR_SIMILAR.search(e["name"])]
        if not hits and f.get("leveraged"):
            hits = [e for e in kr_etfs if all(k in e["name"].replace(" ", "") for k in keys)]
        if hits:
            def rank(e: dict[str, Any]) -> tuple[int, float]:
                brand = e["name"].split()[0]
                pref = _BRAND_PREF.index(brand) if brand in _BRAND_PREF else len(_BRAND_PREF)
                return (0 if pref == 0 else 1, -e["aum_eok"])
            return sorted(hits, key=rank)[0]["name"]
    return ""


# ── 국내 수집 ────────────────────────────────────────────────────────────────
def fetch_kr_etf_list() -> list[dict[str, Any]]:
    res = requests.get("https://finance.naver.com/api/sise/etfItemList.nhn",
                       headers={"User-Agent": UA, "Referer": "https://finance.naver.com/"}, timeout=20)
    res.raise_for_status()
    items = res.json()["result"]["etfItemList"]
    out = []
    for it in items:
        out.append({
            "code": it["itemcode"], "name": it["itemname"], "tab": int(it["etfTabCode"]),
            "aum_eok": float(it.get("marketSum") or 0), "price": _num(it.get("nowVal")),
        })
    return out


_RE_BONDISH = re.compile(r"채권|국채|금리|SOFR|머니마켓|회사채|하이일드|단기채")


def kr_group_of(e: dict[str, Any]) -> str | None:
    """국내 상장 '해외' ETF 4분류. 국내 자산 혼합(채권혼합)·통화·멀티에셋은 제외."""
    tab, name = e["tab"], e["name"]
    if tab == 5:  # 원자재(금·원유 등)는 해외 가격 기반 → 포함
        return "커버드콜&인컴" if _RE_INCOME.search(name) else "원자재"
    if tab not in (4, 6, 7) or not (tab == 4 or _RE_OVERSEAS.search(name)):
        return None
    if _RE_INCOME.search(name):
        return "커버드콜&인컴"
    if "혼합" in name:
        return None
    if tab == 4:
        return "해외주식"
    if _RE_BONDISH.search(name):
        return "해외채권"
    return None


def _fetch_trend(code: str) -> tuple[str, list[dict[str, Any]]]:
    url = f"https://m.stock.naver.com/api/stock/{code}/trend?pageSize=12&page=1"
    for _ in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Referer": "https://m.stock.naver.com/"}, timeout=15)
            r.raise_for_status()
            rows = []
            for x in r.json() or []:
                close = _num(x.get("closePrice"))
                if not x.get("bizdate") or close is None:
                    continue
                rows.append({
                    "date": x["bizdate"],
                    "indiv": (_num(x.get("individualPureBuyQuant")) or 0) * close,
                    "inst": (_num(x.get("organPureBuyQuant")) or 0) * close,
                    "foreign": (_num(x.get("foreignerPureBuyQuant")) or 0) * close,
                })
            return code, rows
        except Exception:  # noqa: BLE001
            continue
    return code, []


def build_kr(kr_etfs: list[dict[str, Any]], us_week: dict[str, str] | None = None) -> dict[str, Any]:
    """us_week 가 있으면 미국 '이번주'와 같은 달력 구간의 국내 거래일만 합산(두 시장 같은 기간)."""
    targets = [dict(e, group=g) for e in kr_etfs if (g := kr_group_of(e))]
    print(f"KR overseas ETFs: {len(targets)}", flush=True)
    with ThreadPoolExecutor(max_workers=8) as ex:
        trends = dict(ex.map(_fetch_trend, [t["code"] for t in targets]))
    big = sorted(targets, key=lambda t: -t["aum_eok"])[:20]
    dates = sorted({r["date"] for t in big for r in trends.get(t["code"], [])})
    if us_week:
        lo, hi = us_week["start"].replace("-", ""), us_week["end"].replace("-", "")
        block = [d for d in dates if lo <= d <= hi]
    else:
        block = week_windows(dates, 1)[0]
    if not block:
        raise RuntimeError("국내 투자자별 수급 데이터가 해당 주에 없습니다")
    weeks = [block]
    w0 = set(block)
    groups = {g: {"indiv": 0.0, "inst": 0.0, "foreign": 0.0} for g in KR_GROUPS}
    rows = []
    for t in targets:
        tr = [r for r in trends.get(t["code"], []) if r["date"] in w0]
        s = {k: sum(r[k] for r in tr) / 1e8 for k in ("indiv", "inst", "foreign")}
        for k in s:
            groups[t["group"]][k] += s[k]
        rows.append({"code": t["code"], "name": t["name"], "group": t["group"], "aum_eok": t["aum_eok"], **s})
    by_indiv = sorted(rows, key=lambda r: -r["indiv"])
    return {
        "week": {"label": _label(weeks[0]), "start": _ymd_iso(weeks[0][0]), "end": _ymd_iso(weeks[0][-1]),
                 "days": len(weeks[0])},
        "groups": groups,
        "indiv_buy": by_indiv[:20],
        "indiv_sell": by_indiv[::-1][:20],
        "rows": rows,
        "universe_count": len(targets),
    }


# ── 차주 이벤트 ──────────────────────────────────────────────────────────────
_EV_KO = {
    "GDP Growth Rate YoY": "GDP 성장률(YoY)", "GDP Growth Rate QoQ Adv": "GDP 성장률 속보(QoQ)",
    "GDP Growth Rate QoQ": "GDP 성장률(QoQ)", "Retail Sales YoY": "소매판매(YoY)",
    "Retail Sales MoM": "소매판매(MoM)", "Industrial Production YoY": "산업생산(YoY)",
    "Inflation Rate YoY": "소비자물가(YoY)", "Core Inflation Rate YoY": "근원 소비자물가(YoY)",
    "Non Farm Payrolls": "비농업 고용", "Unemployment Rate": "실업률",
    "ISM Manufacturing PMI": "ISM 제조업 PMI", "ISM Services PMI": "ISM 서비스업 PMI",
    "S&P Global Manufacturing PMI Flash": "제조업 PMI 예비치", "S&P Global Services PMI Flash": "서비스업 PMI 예비치",
    "Fed Interest Rate Decision": "FOMC 금리 결정", "Interest Rate Decision": "기준금리 결정",
    "ECB Interest Rate Decision": "ECB 금리 결정", "BoJ Interest Rate Decision": "BOJ 금리 결정",
    "Housing Starts": "주택착공", "Building Permits Prel": "건축허가(예비)", "Existing Home Sales": "기존주택판매",
    "New Home Sales": "신규주택판매", "Durable Goods Orders MoM": "내구재 주문(MoM)",
    "Michigan Consumer Sentiment Final": "미시간대 소비자심리(확정)", "PCE Price Index YoY": "PCE 물가(YoY)",
    "Core PCE Price Index YoY": "근원 PCE 물가(YoY)", "Initial Jobless Claims": "신규 실업수당 청구",
    "ZEW Economic Sentiment Index": "ZEW 경기기대지수", "Balance of Trade": "무역수지",
    "Loan Prime Rate 1Y": "LPR 1년", "Loan Prime Rate 5Y": "LPR 5년", "CB Consumer Confidence": "컨퍼런스보드 소비자신뢰",
    "Ifo Business Climate": "Ifo 기업환경지수", "Exports YoY": "수출(YoY)",
}
_CTRY_KO = {"US": "미국", "CN": "중국", "KR": "한국", "JP": "일본", "EU": "유로존", "DE": "독일", "GB": "영국"}
_CTRY_PRI = {"US": 0, "CN": 1, "KR": 2, "EU": 3, "JP": 4, "DE": 5, "GB": 6}
_WD = "월화수목금토일"


def next_week_range(now: datetime) -> tuple[date, date]:
    d = now.date()
    monday = d + timedelta(days=(7 - d.weekday()) % 7 or 7)
    return monday, monday + timedelta(days=4)


def fetch_events(now: datetime) -> dict[str, Any]:
    start, end = next_week_range(now)
    macro: list[dict[str, Any]] = []
    try:
        frm = datetime(start.year, start.month, start.day, tzinfo=KST) - timedelta(hours=0)
        to = datetime(end.year, end.month, end.day, 23, 59, tzinfo=KST)
        r = requests.get(
            "https://economic-calendar.tradingview.com/events",
            params={"from": frm.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                    "to": to.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                    "countries": ",".join(_CTRY_KO)},
            headers={"User-Agent": UA, "Origin": "https://www.tradingview.com"}, timeout=20)
        r.raise_for_status()
        for e in r.json().get("result") or []:
            if (e.get("importance") or 0) < 1:
                continue
            dt = datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(KST)
            title = e.get("title") or ""
            macro.append({
                "date": dt.strftime("%Y-%m-%d"), "time_kst": dt.strftime("%H:%M"),
                "country": e.get("country"), "title": title,
                "label": f"{_CTRY_KO.get(e.get('country'), e.get('country'))} {_EV_KO.get(title, title)}",
                "forecast": e.get("forecast"), "previous": e.get("previous"),
                "pri": _CTRY_PRI.get(e.get("country"), 9),
            })
    except Exception as exc:  # noqa: BLE001
        print(f"  macro calendar failed: {exc}")
    earnings: list[dict[str, Any]] = []
    d = start
    while d <= end:
        try:
            r = requests.get("https://api.nasdaq.com/api/calendar/earnings", params={"date": d.isoformat()},
                             headers={"User-Agent": UA, "Accept": "application/json"}, timeout=20)
            for x in ((r.json().get("data") or {}).get("rows") or []):
                cap = _num(str(x.get("marketCap") or "").replace("$", ""))
                if cap:
                    earnings.append({"date": d.isoformat(), "symbol": x.get("symbol"), "name": x.get("name"),
                                     "cap": cap, "time": x.get("time")})
        except Exception as exc:  # noqa: BLE001
            print(f"  earnings {d} failed: {exc}")
        d += timedelta(days=1)
    earnings.sort(key=lambda x: -x["cap"])

    # 요약 이벤트(4~6개): 주요 매크로 → 대형 실적 묶음
    picks: list[dict[str, Any]] = []
    groups: dict[str, list[dict[str, Any]]] = {}
    for m in sorted(macro, key=lambda m: (m["pri"], m["date"], m["time_kst"])):
        if m["pri"] <= 3:
            groups.setdefault(f"{m['country']}:{m['date']}", []).append(m)
    for key, same in list(groups.items())[:4]:  # 같은 날 같은 국가 지표는 1줄로 묶음
        m = same[0]
        label = m["label"] if len(same) == 1 else \
            f"{_CTRY_KO.get(m['country'])} " + "·".join(_EV_KO.get(x["title"], x["title"]) for x in same[:3])
        details = []
        for x in same[:3]:
            name = _EV_KO.get(x["title"], x["title"])
            if x.get("forecast") is not None:
                details.append(f"{name} 예상 {x['forecast']} / 이전 {x['previous']}")
            elif x.get("previous") is not None:
                details.append(f"{name} 이전 {x['previous']}")
        picks.append({"date": m["date"], "category": "매크로", "event": label, "detail": " · ".join(details)})
    top_e = earnings[:10]
    if top_e:
        byday: dict[str, list[str]] = {}
        for x in top_e:
            byday.setdefault(x["date"], []).append(x["symbol"])
        for dday, syms in sorted(byday.items()):
            picks.append({"date": dday, "category": "기업", "event": f"美 3분기 실적: {', '.join(syms)}", "detail": ""})
    picks.sort(key=lambda p: p["date"])
    for p in picks:
        dd = date.fromisoformat(p["date"])
        p["day"] = f"{dd.month}/{dd.day}({_WD[dd.weekday()]})"
    return {"start": start.isoformat(), "end": end.isoformat(), "picks": picks,
            "macro": macro, "earnings": earnings[:30]}


# ── 오케스트레이션 ────────────────────────────────────────────────────────────
def build_payload() -> dict[str, Any]:
    now = datetime.now(KST)
    kr_etfs = fetch_kr_etf_list()
    us = build_us(kr_etfs)
    kr = build_kr(kr_etfs, us["weeks"][0])
    ev = fetch_events(now)
    funds = us.pop("funds")
    raw_us = sorted(
        ({"ticker": f["symbol"], "name": f["name"], "asset_class": f["asset_class"],
          "themes": ", ".join(f["themes"]), "leveraged": f["leveraged"], "aum_b": f["aum"] / 1e9,
          "weekly_b": [w / 1e9 for w in f["weekly"]], "flow_4w_b": f["w4"] / 1e9,
          "estimated": f["estimated"]}
         for f in funds.values()),
        key=lambda r: -r["weekly_b"][0])
    return {
        "ok": True,
        "generated_at": now.isoformat(),
        "generated_at_display": now.strftime("%Y-%m-%d %H:%M KST"),
        "title": f"ETF Flow Data_{now.strftime('%y%m%d')}",
        "us": us,
        "kr": kr,
        "events": ev,
        "raw_us": raw_us,
        "sources": [
            "미국: ETF CHECK(코스콤) 글로벌 ETF 일별 순유입(Morningstar 기반) · 분류 · AUM",
            "국내: 네이버 금융 ETF 목록 · 종목별 투자자 순매수 수량 × 종가(추정 금액)",
            "이벤트: TradingView 경제캘린더 · Nasdaq 실적캘린더",
        ],
        "method": [
            "주간 = 미국 최근 5거래일(이번주) / 직전 5거래일(지난주) 합계, 국내는 미국 이번주와 같은 날짜 구간의 거래일 합계",
            "자산군: ETF CHECK 대분류 기준(가상자산>원자재>채권·단기자금>주식·리츠), 전체=미국 상장 ETF 전체",
            "테마: 레버리지·인버스 제외 정방향 ETF, ETF CHECK 소분류 조합",
            "국내 해외ETF: 네이버 탭 해외주식·원자재 + 해외 키워드 채권, 커버드콜/프리미엄/인컴은 별도 그룹",
        ],
    }


def publish_weekly(*, publish: bool = True) -> dict[str, Any]:
    """수집 → 00_exports/etf_flow_weekly/ 에 json·xlsx 저장 → (publish) R2 업로드."""
    from etf_flow_weekly_excel import write_workbook

    payload = build_payload()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(KST).strftime("%y%m%d")
    jpath = OUT_DIR / f"etf_flow_weekly_{stamp}.json"
    jpath.write_text(json.dumps(payload, ensure_ascii=False, indent=1, default=str))
    xpath = OUT_DIR / f"ETF Flow Data_{stamp}.xlsx"
    write_workbook(payload, xpath)
    print(f"saved {jpath}\nsaved {xpath}")
    result: dict[str, Any] = {"json_path": str(jpath), "xlsx_path": str(xpath)}
    if publish:
        import r2_data

        slim = {k: v for k, v in payload.items() if k != "raw_us"}
        slim["raw_us_top"] = payload["raw_us"][:300]
        result["json"] = r2_data.put_json(R2_LATEST_JSON, slim)
        result["snapshot"] = r2_data.put_json(f"{R2_SNAP_PREFIX}{datetime.now(KST).date().isoformat()}.json", slim)
        result["xlsx"] = r2_data.put_bytes(
            R2_LATEST_XLSX, xpath.read_bytes(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        print(f"R2 publish {result}")
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true", help="R2 업로드")
    ap.add_argument("--cached-only", action="store_true", help="미국 일별 이력은 오늘 캐시만 사용(추가 호출 없음)")
    args = ap.parse_args()
    _state["cached_only"] = args.cached_only
    publish_weekly(publish=args.publish)


if __name__ == "__main__":
    main()

"""KRX 옵션 보드 — KRX Open API 일별 데이터로 옵션 트레이더용 지표를 만든다.

투자자별(수급 주체) 데이터는 Open API 에 없다. 대신 아래 8개 API 로
변동성·프리미엄·포지셔닝을 본다 (KRX_AUTH_KEY, 2026-11-05 승인 확인).

  idx/kospi_dd_trd      코스피 200 종가 → 실현변동성
  idx/drvprod_dd_trd    VKOSPI, 옵션 전략지수(커버드콜·양매도·풋매도…)
  drv/opt_bydd_trd      코스피200 옵션(월물·위클리) 체인 → OI 벽, max pain, GEX, 스큐, P/C
  drv/fut_bydd_trd      코스피200 선물 → 베이시스·미결제약정
  etp/etf_bydd_trd      코스피200·코스닥150 레버리지/인버스 ETF → 상장좌수 변화로 설정·환매 추정
  sto/stk_bydd_trd      주식옵션 기초자산 종가
  drv/eqsop_bydd_trd    주식옵션(유가) 체인
  drv/eqkop_bydd_trd    주식옵션(코스닥) 체인

산출 (ETF Flow 탭과 같은 경로):
  00_exports/krx_option_board/krx_option_board_YYMMDD.json · KRX 옵션보드_YYMMDD.xlsx
  --publish : 웹 수신 API(/api/krx-option-board, WEB_INGEST_SECRET) 우선, 없으면 R2 직접
  R2  krx_option_board/latest.json · latest.xlsx

일별 요약은 cache/YYYYMMDD.json 에 남겨 다음 실행 때 새 영업일만 받는다.
KRX Open API 는 D+1 오전에 전 영업일 데이터가 올라온다.

    python 04_국내시장/krx_option_board.py               # 수집 → 00_exports
    python 04_국내시장/krx_option_board.py --publish     # + 웹 반영
"""

from __future__ import annotations

import path_setup  # noqa: F401  # numbered folders on sys.path

import argparse
import json
import math
import os
import re
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "00_exports" / "krx_option_board"
CACHE_DIR = OUT_DIR / "cache"
CACHE_VERSION = 1

API_BASE = "https://data-dbg.krx.co.kr/svc/apis"
R2_LATEST_JSON = "krx_option_board/latest.json"
R2_LATEST_XLSX = "krx_option_board/latest.xlsx"
R2_SNAP_PREFIX = "krx_option_board/snapshots/"
UA = "SavvyETF/1.0 (+https://savvyetf.com)"

HIST_DAYS = 130          # 영업일 (RV20·백분위·3M 수익률에 충분)
K200_MULT = 250_000      # 코스피200 옵션 거래승수 (원)
STOCK_MULT = 10          # 주식옵션 거래승수 (주)
RISK_FREE = 0.03         # 패리티·감마용 단순 가정

K200_PRODUCTS = {
    "코스피200 옵션": "월물",
    "코스피200 위클리(목) 옵션": "위클리(목)",
    "코스피200 위클리(월) 옵션": "위클리(월)",
}

STRATEGY_INDICES = [
    ("코스피 200 커버드콜 ATM 지수", "커버드콜 ATM"),
    ("코스피 200 커버드콜 5% OTM 지수", "커버드콜 5% OTM"),
    ("코스피 200 위클리 커버드콜 ATM 지수", "위클리 커버드콜 ATM"),
    ("코스피 200 월별 양매도 ATM", "양매도 ATM"),
    ("코스피 200 월별 양매도 3% OTM", "양매도 3% OTM"),
    ("코스피 200 월별 양매도 5% OTM", "양매도 5% OTM"),
    ("코스피 풋매도 3% OTM지수", "풋매도 3% OTM"),
    ("KRX Cboe 코스피 200 풋매도 지수", "Cboe 풋매도"),
    ("코스피 200 프로텍티브풋 5% OTM지수", "프로텍티브풋 5% OTM"),
    ("코스피 200 인핸스드 콘도르 4/10% 지수", "콘도르 4/10%"),
]

_session: requests.Session | None = None


# ---------------------------------------------------------------- fetch

def _auth_key() -> str:
    key = os.environ.get("KRX_AUTH_KEY", "").strip()
    if not key:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("KRX_AUTH_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise RuntimeError("KRX_AUTH_KEY 가 없습니다 (.env 또는 환경변수)")
    return key


def fetch(api: str, day: str, *, retries: int = 3) -> list[dict[str, str]]:
    """하루치 OutBlock_1. 휴장일은 빈 리스트. 401(미승인)은 예외."""
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({"AUTH_KEY": _auth_key(), "User-Agent": UA})
    last: Exception | None = None
    for attempt in range(retries):
        try:
            res = _session.get(f"{API_BASE}/{api}", params={"basDd": day}, timeout=60)
            body = res.json()
            if str(body.get("respCode", "")) == "401":
                raise PermissionError(f"KRX Open API 401 {api}: 이용신청 승인 여부 확인")
            return body.get("OutBlock_1") or []
        except PermissionError:
            raise
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"KRX {api} {day} 실패: {last}")


def num(raw: Any) -> float | None:
    if raw is None:
        return None
    text = str(raw).replace(",", "").strip()
    if text in ("", "-"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def weekdays_back(end: date, n: int) -> list[str]:
    out: list[str] = []
    d = end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.strftime("%Y%m%d"))
        d -= timedelta(days=1)
    return sorted(out)


# ---------------------------------------------------------------- option math

def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_gamma(s: float, k: float, t: float, iv: float) -> float:
    if s <= 0 or k <= 0 or t <= 0 or iv <= 0:
        return 0.0
    d1 = (math.log(s / k) + (RISK_FREE + 0.5 * iv * iv) * t) / (iv * math.sqrt(t))
    return math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (s * iv * math.sqrt(t))


def nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


OPT_RE = re.compile(r"\s([CP])\s+(\d{4,6}(?:W\d)?)\s+([\d,.]+)")


def parse_option(name: str) -> tuple[str, str, float] | None:
    """'코스피200 C 202611   732.5 (정규)' → ('C', '202611', 732.5)."""
    m = OPT_RE.search(name)
    if not m:
        return None
    return m.group(1), m.group(2), float(m.group(3).replace(",", ""))


def expiry_date(code: str, product: str) -> date | None:
    """월물 202611 → 둘째 목요일, 위클리 2611W1 → n번째 목/월요일 (휴일 미반영 근사)."""
    try:
        if "W" in code:
            yymm, wk = code.split("W")
            y, m = 2000 + int(yymm[:2]), int(yymm[2:4])
            return nth_weekday(y, m, 0 if "(월)" in product else 3, int(wk))
        y, m = int(code[:4]), int(code[4:6])
        return nth_weekday(y, m, 3, 2)
    except (ValueError, IndexError):
        return None


def build_chain(rows: list[dict[str, str]], product: str) -> dict[str, dict[float, dict[str, dict]]]:
    """{만기코드: {행사가: {'C': row, 'P': row}}} — 정규장만."""
    chain: dict[str, dict[float, dict[str, dict]]] = {}
    for r in rows:
        if r.get("PROD_NM") != product or "야간" in r.get("ISU_NM", ""):
            continue
        p = parse_option(r["ISU_NM"])
        if not p:
            continue
        cp, code, k = p
        chain.setdefault(code, {}).setdefault(k, {})[cp] = r
    return chain


def parity_spot(strikes: dict[float, dict[str, dict]], t: float) -> float | None:
    """같은 행사가 콜·풋 정산가로 선도 → 현재가 근사 (중앙값)."""
    vals = []
    for k, pair in strikes.items():
        c, p = pair.get("C"), pair.get("P")
        if not (c and p):
            continue
        cv, pv = num(c.get("NXTDD_BAS_PRC")), num(p.get("NXTDD_BAS_PRC"))
        if cv is None or pv is None or (cv <= 0 and pv <= 0):
            continue
        vals.append(cv - pv + k * math.exp(-RISK_FREE * t))
    if not vals:
        return None
    vals.sort()
    return vals[len(vals) // 2]


def nearest(strikes: list[float], target: float) -> float:
    return min(strikes, key=lambda k: abs(k - target))


def iv_of(pair: dict[str, dict], cp: str) -> float | None:
    r = pair.get(cp)
    v = num(r.get("IMP_VOLT")) if r else None
    return v if v and v > 0 else None


def expiry_stats(strikes: dict[float, dict[str, dict]], spot: float, t: float, mult: float,
                 *, skew_pct: float) -> dict[str, Any]:
    ks = sorted(strikes)
    atm = nearest(ks, spot)
    lo = nearest(ks, spot * (1 - skew_pct))
    hi = nearest(ks, spot * (1 + skew_pct))
    atm_iv = [v for v in (iv_of(strikes[atm], "C"), iv_of(strikes[atm], "P")) if v]
    put_iv, call_iv = iv_of(strikes[lo], "P"), iv_of(strikes[hi], "C")
    c_oi = sum(num(strikes[k].get("C", {}).get("ACC_OPNINT_QTY")) or 0 for k in ks)
    p_oi = sum(num(strikes[k].get("P", {}).get("ACC_OPNINT_QTY")) or 0 for k in ks)
    c_vol = sum(num(strikes[k].get("C", {}).get("ACC_TRDVOL")) or 0 for k in ks)
    p_vol = sum(num(strikes[k].get("P", {}).get("ACC_TRDVOL")) or 0 for k in ks)
    return {
        "atm": atm,
        "atm_iv": round(sum(atm_iv) / len(atm_iv), 2) if atm_iv else None,
        "put_iv": put_iv,
        "call_iv": call_iv,
        "skew": round(put_iv - call_iv, 2) if put_iv and call_iv else None,
        "call_oi": int(c_oi),
        "put_oi": int(p_oi),
        "call_vol": int(c_vol),
        "put_vol": int(p_vol),
        "pc_oi": round(p_oi / c_oi, 3) if c_oi else None,
        "pc_vol": round(p_vol / c_vol, 3) if c_vol else None,
    }


def strike_table(strikes: dict[float, dict[str, dict]], spot: float, t: float, mult: float,
                 band: float) -> list[dict[str, Any]]:
    """spot ±band 안 행사가별 OI·거래량·IV·GEX(억원/1%)."""
    out = []
    for k in sorted(strikes):
        if abs(k / spot - 1) > band:
            continue
        pair = strikes[k]
        row: dict[str, Any] = {"strike": k}
        gex = 0.0
        for cp, sign in (("C", 1), ("P", -1)):
            r = pair.get(cp) or {}
            oi = num(r.get("ACC_OPNINT_QTY")) or 0
            vol = num(r.get("ACC_TRDVOL")) or 0
            iv = num(r.get("IMP_VOLT")) or 0
            row[f"{cp.lower()}_oi"] = int(oi)
            row[f"{cp.lower()}_vol"] = int(vol)
            row[f"{cp.lower()}_iv"] = iv or None
            row[f"{cp.lower()}_px"] = num(r.get("NXTDD_BAS_PRC"))
            gex += sign * bs_gamma(spot, k, t, iv / 100) * oi * mult * spot * spot * 0.01
        row["gex_eok"] = round(gex / 1e8, 2)
        out.append(row)
    return out


def max_pain(strikes: dict[float, dict[str, dict]]) -> float | None:
    ks = sorted(strikes)
    if not ks:
        return None
    oi = {k: (num(strikes[k].get("C", {}).get("ACC_OPNINT_QTY")) or 0,
              num(strikes[k].get("P", {}).get("ACC_OPNINT_QTY")) or 0) for k in ks}
    best, best_pay = None, None
    for s in ks:
        pay = sum(c * max(0.0, s - k) + p * max(0.0, k - s) for k, (c, p) in oi.items())
        if best_pay is None or pay < best_pay:
            best, best_pay = s, pay
    return best


# ---------------------------------------------------------------- daily summary (cached)

def _etf_kind(name: str, idx: str) -> tuple[str, str] | None:
    """(기초, 방향) — 코스피200/코스닥150 레버리지·인버스만."""
    base = None
    if "코스닥" in idx or "코스닥" in name:
        if "150" in idx or "150" in name:
            base = "코스닥150"
    elif "코스피 200" in idx and not any(s in idx for s in ("정보기술", "금융", "중공업", "헬스", "에너지", "경기", "생활", "건설", "산업재", "철강", "커뮤니케이션")):
        base = "코스피200"
    if not base:
        return None
    if "인버스" in name:
        return base, "인버스"
    if "레버리지" in name:
        return base, "레버리지"
    return None


def summarize_day(day: str) -> dict[str, Any] | None:
    """한 영업일 요약. 휴장일이면 None."""
    kospi = fetch("idx/kospi_dd_trd", day)
    if not kospi:
        return None
    k200 = next((r for r in kospi if r["IDX_NM"] == "코스피 200"), None)
    if not k200:
        return None
    drv = {r["IDX_NM"]: r for r in fetch("idx/drvprod_dd_trd", day)}
    fut = fetch("drv/fut_bydd_trd", day)
    opt = fetch("drv/opt_bydd_trd", day)
    etf = fetch("etp/etf_bydd_trd", day)

    out: dict[str, Any] = {"v": CACHE_VERSION, "date": f"{day[:4]}-{day[4:6]}-{day[6:]}"}
    out["k200"] = num(k200["CLSPRC_IDX"])
    out["k200_chg"] = num(k200["FLUC_RT"])
    out["vkospi"] = num((drv.get("코스피 200 변동성지수") or {}).get("CLSPRC_IDX"))
    out["strategy"] = {label: num((drv.get(name) or {}).get("CLSPRC_IDX")) for name, label in STRATEGY_INDICES}

    # 코스피200 선물 최근월(주간) — 미결제약정 최대 종목
    k200f = [r for r in fut if r["PROD_NM"] == "코스피200 선물" and "(주간)" in r["ISU_NM"] and " F " in r["ISU_NM"]]
    front = max(k200f, key=lambda r: num(r["ACC_OPNINT_QTY"]) or 0, default=None)
    if front:
        fpx = num(front["TDD_CLSPRC"]) or num(front.get("SETL_PRC"))
        spot = num(front["SPOT_PRC"])
        out["fut"] = {
            "name": front["ISU_NM"].replace("(주간)", "").strip(),
            "close": fpx,
            "spot": spot,
            "basis": round(fpx - spot, 2) if fpx and spot else None,
            "oi": int(num(front["ACC_OPNINT_QTY"]) or 0),
            "vol": int(num(front["ACC_TRDVOL"]) or 0),
            "oi_all": int(sum(num(r["ACC_OPNINT_QTY"]) or 0 for r in k200f)),
        }

    # 코스피200 옵션 상품별 콜/풋 합계 (정규)
    prod: dict[str, dict[str, float]] = {}
    for r in opt:
        label = K200_PRODUCTS.get(r["PROD_NM"])
        if not label or "야간" in r["ISU_NM"]:
            continue
        cp = "c" if r["RGHT_TP_NM"] == "CALL" else "p"
        d = prod.setdefault(label, {})
        for f, key in (("ACC_TRDVOL", "vol"), ("ACC_TRDVAL", "val"), ("ACC_OPNINT_QTY", "oi")):
            d[f"{cp}_{key}"] = d.get(f"{cp}_{key}", 0) + (num(r[f]) or 0)
    tot = {k: sum(p.get(k, 0) for p in prod.values()) for k in ("c_vol", "p_vol", "c_val", "p_val", "c_oi", "p_oi")}
    out["opt"] = {"by_product": prod, "total": tot}

    # 레버리지/인버스 ETF (기초·방향별 순자산, 상장좌수·NAV 는 종목별로 남겨 다음 날과 비교)
    etfs = {}
    for r in etf:
        kind = _etf_kind(r["ISU_NM"], r.get("IDX_IND_NM", ""))
        if not kind:
            continue
        etfs[r["ISU_CD"]] = {
            "name": r["ISU_NM"], "base": kind[0], "dir": kind[1],
            "nav": num(r["NAV"]), "shares": num(r["LIST_SHRS"]),
            "aum": num(r["INVSTASST_NETASST_TOTAMT"]), "chg": num(r["FLUC_RT"]),
            "val": num(r["ACC_TRDVAL"]),
        }
    out["etf"] = etfs
    return out


def load_history(end: date, n: int) -> list[dict[str, Any]]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    days = weekdays_back(end, int(n * 1.08) + 5)
    hist: list[dict[str, Any]] = []
    fetched = 0
    for day in days:
        path = CACHE_DIR / f"{day}.json"
        doc = None
        if path.exists():
            doc = json.loads(path.read_text(encoding="utf-8"))
            if doc.get("v") != CACHE_VERSION:
                doc = None
        if doc is None:
            summ = summarize_day(day)
            fetched += 1
            doc = summ or {"v": CACHE_VERSION, "holiday": True, "date": day}
            # 오늘·어제는 아직 게시 전일 수 있어 휴장 표시를 캐시하지 않는다
            if summ or (end - datetime.strptime(day, "%Y%m%d").date()).days > 3:
                path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        if not doc.get("holiday"):
            hist.append(doc)
    print(f"history: {len(hist)} trading days ({fetched} fetched)")
    return hist[-n:]


# ---------------------------------------------------------------- payload sections

def _pct(a: float | None, b: float | None) -> float | None:
    return round((a / b - 1) * 100, 2) if a and b else None


def vol_section(hist: list[dict[str, Any]]) -> dict[str, Any]:
    closes = [h["k200"] for h in hist]
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    series = []
    for i, h in enumerate(hist):
        rv = None
        if i >= 20:
            w = rets[i - 20:i]
            m = sum(w) / 20
            rv = round(math.sqrt(sum((x - m) ** 2 for x in w) / 19 * 252) * 100, 2)
        vk = h.get("vkospi")
        series.append({
            "date": h["date"], "k200": h["k200"], "vkospi": vk, "rv20": rv,
            "vrp": round(vk - rv, 2) if vk is not None and rv is not None else None,
        })
    vks = [s["vkospi"] for s in series if s["vkospi"] is not None]
    last = series[-1]
    return {
        "series": series,
        "vkospi": last["vkospi"],
        "vkospi_chg": round(last["vkospi"] - series[-2]["vkospi"], 2) if len(series) > 1 and series[-2]["vkospi"] else None,
        "vkospi_pctile": round(sum(v <= last["vkospi"] for v in vks) / len(vks) * 100) if vks and last["vkospi"] else None,
        "vkospi_min": min(vks) if vks else None,
        "vkospi_max": max(vks) if vks else None,
        "rv20": last["rv20"],
        "vrp": last["vrp"],
    }


def pc_section(hist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for h in hist:
        t = (h.get("opt") or {}).get("total") or {}
        if not t.get("c_vol"):
            continue
        out.append({
            "date": h["date"],
            "pc_vol": round(t["p_vol"] / t["c_vol"], 3) if t.get("c_vol") else None,
            "pc_oi": round(t["p_oi"] / t["c_oi"], 3) if t.get("c_oi") else None,
            "pc_val": round(t["p_val"] / t["c_val"], 3) if t.get("c_val") else None,
            "c_vol": int(t["c_vol"]), "p_vol": int(t["p_vol"]),
            "c_oi": int(t["c_oi"]), "p_oi": int(t["p_oi"]),
            "prem_eok": round((t["c_val"] + t["p_val"]) / 1e8, 1),
        })
    return out


def fut_section(hist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for h in hist:
        f = h.get("fut")
        if not f:
            continue
        out.append({"date": h["date"], **{k: f.get(k) for k in ("name", "close", "spot", "basis", "oi", "oi_all", "vol")}})
    for i in range(1, len(out)):
        out[i]["oi_chg"] = out[i]["oi_all"] - out[i - 1]["oi_all"]
    if out:
        out[0]["oi_chg"] = None
    return out


def strategy_section(hist: list[dict[str, Any]]) -> list[dict[str, Any]]:
    last = hist[-1]

    def back(n: int) -> dict[str, Any] | None:
        return hist[-1 - n] if len(hist) > n else None

    rows = []
    for _, label in [("", "코스피 200")] + STRATEGY_INDICES:
        def val(h: dict[str, Any] | None) -> float | None:
            if h is None:
                return None
            return h["k200"] if label == "코스피 200" else (h.get("strategy") or {}).get(label)
        cur = val(last)
        r1, r21, r63 = (_pct(cur, val(back(n))) for n in (1, 21, 63))
        rows.append({"name": label, "close": cur, "r1d": r1, "r1m": r21, "r3m": r63})
    k = rows[0]
    for r in rows[1:]:
        r["ex1m"] = round(r["r1m"] - k["r1m"], 2) if r["r1m"] is not None and k["r1m"] is not None else None
        r["ex3m"] = round(r["r3m"] - k["r3m"], 2) if r["r3m"] is not None and k["r3m"] is not None else None
    return rows


def etf_section(hist: list[dict[str, Any]]) -> dict[str, Any]:
    """설정·환매 추정 = Δ상장좌수 × 당일 NAV (억원). 기초·방향별 일별 합."""
    groups = [("코스피200", "레버리지"), ("코스피200", "인버스"), ("코스닥150", "레버리지"), ("코스닥150", "인버스")]
    series = []
    for prev, cur in zip(hist, hist[1:]):
        row: dict[str, Any] = {"date": cur["date"]}
        for base, d in groups:
            flow = 0.0
            for code, e in (cur.get("etf") or {}).items():
                p = (prev.get("etf") or {}).get(code)
                if e["base"] != base or e["dir"] != d or not p or not e["shares"] or not p["shares"] or not e["nav"]:
                    continue
                flow += (e["shares"] - p["shares"]) * e["nav"]
            row[f"{base}_{d}"] = round(flow / 1e8, 1)
        series.append(row)
    last = hist[-1].get("etf") or {}

    def window(n: int, code: str) -> float | None:
        if len(hist) <= n:
            return None
        flow = 0.0
        for prev, cur in zip(hist[-n - 1:], hist[-n:]):
            e, p = (cur.get("etf") or {}).get(code), (prev.get("etf") or {}).get(code)
            if e and p and e["shares"] and p["shares"] and e["nav"]:
                flow += (e["shares"] - p["shares"]) * e["nav"]
        return round(flow / 1e8, 1)

    table = []
    for code, e in sorted(last.items(), key=lambda kv: -(kv[1]["aum"] or 0)):
        if (e["aum"] or 0) < 300e8:
            continue
        table.append({
            "code": code, "name": e["name"], "base": e["base"], "dir": e["dir"],
            "aum_eok": round((e["aum"] or 0) / 1e8), "chg": e["chg"],
            "val_eok": round((e["val"] or 0) / 1e8, 1),
            "flow_1d": window(1, code), "flow_5d": window(5, code), "flow_20d": window(20, code),
        })
    totals = {}
    for base, d in groups:
        key = f"{base}_{d}"
        totals[key] = {
            "aum_eok": round(sum((e["aum"] or 0) for e in last.values() if e["base"] == base and e["dir"] == d) / 1e8),
            "flow_5d": round(sum(r[key] for r in series[-5:]), 1),
            "flow_20d": round(sum(r[key] for r in series[-20:]), 1),
        }
    return {"series": series, "table": table, "totals": totals}


def k200_chain_section(day: str, k200: float, as_of: date) -> dict[str, Any]:
    rows = fetch("drv/opt_bydd_trd", day)
    expiries = []
    front_detail = None
    for product, label in K200_PRODUCTS.items():
        chain = build_chain(rows, product)
        for code, strikes in sorted(chain.items()):
            exp = expiry_date(code, product)
            if not exp or exp < as_of:
                continue
            t = max((exp - as_of).days, 0.5) / 365
            spot = parity_spot(strikes, t) or k200
            st = expiry_stats(strikes, spot, t, K200_MULT, skew_pct=0.05)
            # 원월물 중 미결제약정이 거의 없는 만기는 P/C·벽이 왜곡돼 뺀다
            if st["call_oi"] + st["put_oi"] < 500:
                continue
            ks = sorted(strikes)
            cw = max(ks, key=lambda k: num(strikes[k].get("C", {}).get("ACC_OPNINT_QTY")) or 0)
            pw = max(ks, key=lambda k: num(strikes[k].get("P", {}).get("ACC_OPNINT_QTY")) or 0)
            table = strike_table(strikes, spot, t, K200_MULT, band=0.12)
            item = {
                "product": label, "code": code, "expiry": exp.isoformat(),
                "dte": (exp - as_of).days, "spot": round(spot, 2), **st,
                "call_wall": cw, "put_wall": pw, "max_pain": max_pain(strikes),
                "gex_eok": round(sum(r["gex_eok"] for r in table), 1),
            }
            expiries.append(item)
            if label == "월물" and front_detail is None:
                front_detail = {**item, "strikes": table}
    expiries.sort(key=lambda e: e["expiry"])
    # GEX 는 근월(월물)·위클리 전체 합산
    gex_total = round(sum(e["gex_eok"] for e in expiries if e["dte"] <= 45), 1)
    return {"expiries": expiries, "front": front_detail, "gex_total_eok": gex_total}


def stock_option_section(day: str, as_of: date, top_n: int = 20) -> list[dict[str, Any]]:
    rows = fetch("drv/eqsop_bydd_trd", day) + fetch("drv/eqkop_bydd_trd", day)
    try:
        stk = {r["ISU_NM"]: num(r["TDD_CLSPRC"]) for r in fetch("sto/stk_bydd_trd", day)}
    except PermissionError:
        stk = {}
    by_prod: dict[str, list[dict]] = {}
    for r in rows:
        by_prod.setdefault(r["PROD_NM"], []).append(r)
    out = []
    for prod, rs in by_prod.items():
        val_c = sum(num(r["ACC_TRDVAL"]) or 0 for r in rs if r["RGHT_TP_NM"] == "CALL")
        val_p = sum(num(r["ACC_TRDVAL"]) or 0 for r in rs if r["RGHT_TP_NM"] != "CALL")
        oi_c = sum(num(r["ACC_OPNINT_QTY"]) or 0 for r in rs if r["RGHT_TP_NM"] == "CALL")
        oi_p = sum(num(r["ACC_OPNINT_QTY"]) or 0 for r in rs if r["RGHT_TP_NM"] != "CALL")
        chain = build_chain(rs, prod)
        name = prod.replace(" 옵션", "")
        front = None
        for code in sorted(chain):
            exp = expiry_date(code, prod)
            if exp and exp >= as_of:
                front = (code, exp)
                break
        atm_iv = skew = spot = None
        if front:
            strikes = chain[front[0]]
            t = max((front[1] - as_of).days, 0.5) / 365
            spot = stk.get(name) or parity_spot(strikes, t)
            if spot:
                st = expiry_stats(strikes, spot, t, STOCK_MULT, skew_pct=0.10)
                atm_iv, skew = st["atm_iv"], st["skew"]
        out.append({
            "name": name, "spot": spot,
            "val_eok": round((val_c + val_p) / 1e8, 2),
            "pc_val": round(val_p / val_c, 2) if val_c else None,
            "call_oi": int(oi_c), "put_oi": int(oi_p),
            "pc_oi": round(oi_p / oi_c, 2) if oi_c else None,
            "atm_iv": atm_iv, "skew": skew,
        })
    out.sort(key=lambda r: -r["val_eok"])
    total = sum(r["val_eok"] for r in out) or 1
    for r in out:
        r["share"] = round(r["val_eok"] / total * 100, 1)
    return out[:top_n]


def build_payload(end: date | None = None) -> dict[str, Any]:
    now = datetime.now(KST)
    end = end or now.date()
    hist = load_history(end, HIST_DAYS)
    if len(hist) < 30:
        raise RuntimeError(f"이력이 부족합니다 ({len(hist)}일)")
    last = hist[-1]
    day = last["date"].replace("-", "")
    as_of = datetime.strptime(day, "%Y%m%d").date()

    vol = vol_section(hist)
    chain = k200_chain_section(day, last["k200"], as_of)
    pcs = pc_section(hist)
    futs = fut_section(hist)
    etf = etf_section(hist)
    strat = strategy_section(hist)
    stocks = stock_option_section(day, as_of)
    front = chain["front"] or {}

    summary = {
        "k200": last["k200"], "k200_chg": last["k200_chg"],
        "vkospi": vol["vkospi"], "vkospi_chg": vol["vkospi_chg"], "vkospi_pctile": vol["vkospi_pctile"],
        "rv20": vol["rv20"], "vrp": vol["vrp"],
        "atm_iv": front.get("atm_iv"), "skew": front.get("skew"),
        "pc_oi": pcs[-1]["pc_oi"] if pcs else None, "pc_vol": pcs[-1]["pc_vol"] if pcs else None,
        "basis": futs[-1]["basis"] if futs else None, "fut_oi_chg": futs[-1].get("oi_chg") if futs else None,
        "call_wall": front.get("call_wall"), "put_wall": front.get("put_wall"), "max_pain": front.get("max_pain"),
        "gex_eok": chain["gex_total_eok"],
    }
    return {
        "ok": True,
        "as_of": last["date"],
        "generated_at": now.isoformat(timespec="seconds"),
        "generated_at_display": now.strftime("%Y-%m-%d %H:%M KST"),
        "title": f"KRX 옵션보드_{as_of.strftime('%y%m%d')}",
        "summary": summary,
        "vol": vol,
        "chain": chain,
        "pc": pcs,
        "futures": futs,
        "strategy": strat,
        "etf": etf,
        "stocks": stocks,
        "sources": [
            "KRX Open API — 코스피 시리즈·파생상품지수·옵션·선물·ETF·유가증권·주식옵션 일별매매정보 (전 영업일 종가 기준, D+1 오전 게시)",
            "투자자별(외국인·개인·기관) 수급은 KRX Open API 에 없어 포함하지 않음",
        ],
        "method": [
            "RV20 = 코스피 200 일간 로그수익률 20일 표준편차 × √252. VRP = VKOSPI − RV20",
            "옵션 체인은 정규장만. 기초가격은 같은 행사가 콜·풋 정산가의 풋콜 패리티 중앙값(금리 3% 가정)",
            "스큐 = 지수 ±5%(주식 ±10%) 외가격 풋 IV − 콜 IV. 만기일은 둘째 목요일·위클리 n번째 목/월요일(휴일 미반영 근사)",
            "GEX = Σ(콜 +, 풋 −) Γ × 미결제약정 × 25만원 × S² × 1% (억원/1%) — 딜러 콜 롱·풋 숏 관례 가정, 실제 포지션 아님",
            "ETF 설정·환매 추정 = Δ상장좌수 × 당일 NAV (코스피200·코스닥150 레버리지/인버스, 섹터형 제외)",
        ],
    }


# ---------------------------------------------------------------- publish (ETF Flow 와 같은 경로)

def _webapp_base_url() -> str:
    raw = (
        os.environ.get("WEBAPP_PUBLIC_URL")
        or os.environ.get("WEB_PUBLISH_URL", "").replace("/api/ingest", "")
        or "https://savvyetf.com"
    ).strip()
    return raw.replace("://savvyetf.vercel.app", "://savvyetf.com").rstrip("/")


def push_to_webapp(payload: dict[str, Any], xlsx_bytes: bytes, *, base_url: str, secret: str) -> dict[str, Any]:
    import base64

    body = dict(payload)
    body["xlsx_base64"] = base64.b64encode(xlsx_bytes).decode("ascii")
    body["as_of_kst"] = payload["as_of"]
    res = requests.post(
        base_url.rstrip("/") + "/api/krx-option-board",
        data=json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {secret}",
            "User-Agent": UA,
        },
        timeout=60,
    )
    res.raise_for_status()
    return res.json()


def publish_board(*, publish: bool = False, push: bool = False) -> dict[str, Any]:
    from krx_option_board_excel import write_workbook

    payload = build_payload()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = payload["as_of"].replace("-", "")[2:]
    jpath = OUT_DIR / f"krx_option_board_{stamp}.json"
    jpath.write_text(json.dumps(payload, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    xpath = OUT_DIR / f"{payload['title']}.xlsx"
    write_workbook(payload, xpath)
    print(f"saved {jpath}\nsaved {xpath}")
    result: dict[str, Any] = {"json_path": str(jpath), "xlsx_path": str(xpath), "as_of": payload["as_of"]}
    if not (publish or push):
        return result

    xlsx_bytes = xpath.read_bytes()
    secret = (os.environ.get("WEB_INGEST_SECRET") or "").strip()
    if secret:
        pushed = push_to_webapp(payload, xlsx_bytes, base_url=_webapp_base_url(), secret=secret)
        result["push"] = pushed
        print(f"web push {pushed}")
        if pushed.get("ok"):
            return result
    if push and not secret:
        raise RuntimeError("WEB_INGEST_SECRET required for web push")

    import r2_data

    ok_json = r2_data.put_json(R2_LATEST_JSON, payload)
    ok_snap = r2_data.put_json(f"{R2_SNAP_PREFIX}{payload['as_of']}.json", payload)
    ok_xlsx = r2_data.put_bytes(
        R2_LATEST_XLSX, xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    result.update({"json": ok_json, "snapshot": ok_snap, "xlsx": ok_xlsx})
    print(f"R2 publish {result}")
    if not (ok_json and ok_xlsx):
        raise RuntimeError("R2 publish returned False")
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true", help="원격 반영(웹 push 우선, 없으면 R2)")
    ap.add_argument("--push", action="store_true", help="Vercel /api/krx-option-board 로 POST (WEB_INGEST_SECRET)")
    args = ap.parse_args()
    publish_board(publish=args.publish, push=args.push)


if __name__ == "__main__":
    main()

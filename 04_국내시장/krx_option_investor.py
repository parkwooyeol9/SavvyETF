"""KRX 옵션 모니터 — 투자자별(수급 주체) 코스피200 옵션·선물 순매수 분석.

원천: KRX 정보데이터시스템 [15007] 파생상품 › 투자자별 거래실적 (로그인 필요)
  일별추이  bld=dbms/MDC/STAT/standard/MDCSTAT13102  (inqTpCd=2)
            열 A07 기관 합계 · A08 기타법인 · A09 개인 · A12 외국인 합계
  기간합계  bld=dbms/MDC/STAT/standard/MDCSTAT13101  (inqTpCd=1) — 금융투자·투신·연기금 등 세부
  공통      isuCd  KR___OPK2I 코스피200 옵션 / KR___OPWKI 위클리(목) / KR___OPWKM 위클리(월) / KR___FUK2I 코스피200 선물
            isuOpt C·P(옵션) ALL(선물) · prtType AMT·QTY · prtCheck SUN(순매수) · aggBasTpCd 0(정규)

KRX Open API 에는 이 데이터가 없다. 그래서 두 경로로 쌓는다.
  1) 브라우저 수집본  00_exports/krx_option_board/investor/browser_daily_*.txt · browser_detail_*.txt
     (2026-11-05 Claude 가 로그인된 브라우저 세션으로 2026-05-04~11-04 수집)
  2) KRX_COOKIE 경로  환경변수 KRX_COOKIE(브라우저 로그인 후 Cookie 헤더 전체)가 있으면
     `update_from_cookie()` 가 최근 구간을 받아 investor_daily.json 에 합친다. 쿠키는 몇 시간이면 만료된다.

두 경로 모두 없으면 투자자 섹션은 마지막 적재분으로 표시된다(기준일을 함께 보여 준다).
"""

from __future__ import annotations

import path_setup  # noqa: F401  # numbered folders on sys.path

import json
import math
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
INV_DIR = ROOT / "00_exports" / "krx_option_board" / "investor"
DAILY_JSON = INV_DIR / "investor_daily.json"
DETAIL_JSON = INV_DIR / "investor_detail.json"

INVESTORS = ["기관", "기타법인", "개인", "외국인"]
SLOTS = ["ca", "cq", "pa", "pq", "fa", "fq"]   # 콜대금(억)·콜계약·풋대금·풋계약·선물대금·선물계약
DETAIL_NAMES = ["금융투자", "투신", "연기금 등", "보험", "은행", "기타금융", "기관합계", "기타법인", "개인", "외국인"]

JSON_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
REFERER = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201050302"
OPT_IDS = {"OPT": "KR___OPK2I", "WKI": "KR___OPWKI", "WKM": "KR___OPWKM"}
FUT_ID = "KR___FUK2I"


# ---------------------------------------------------------------- load

def _num(s: Any) -> float:
    try:
        return float(str(s).replace(",", ""))
    except ValueError:
        return 0.0


def _parse_browser_daily(path: Path) -> dict[str, dict[str, list[float]]]:
    out: dict[str, dict[str, list[float]]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        d = parts[0]
        iso = f"20{d[:2]}-{d[2:4]}-{d[4:6]}"
        out[iso] = {slot: [float(x) for x in parts[1 + i].split(",")] for i, slot in enumerate(SLOTS)}
    return out


def _parse_browser_detail(path: Path) -> dict[str, Any]:
    as_of = "20" + path.stem.split("_")[-1]
    as_of = f"{as_of[:4]}-{as_of[4:6]}-{as_of[6:]}"
    rows: dict[str, dict[str, list[float]]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        key, body = line.split("|", 1)
        rows[key] = {}
        for item in body.split(","):
            name, qty, amt = item.rsplit(":", 2)
            rows[key][name] = [float(qty), float(amt)]
    return {"as_of": as_of, "rows": rows}


R2_DAILY = "krx_option_board/investor/daily.json"
R2_DETAIL = "krx_option_board/investor/detail.json"
R2_CASH = "krx_option_board/investor/cash.json"


def _r2_get(key: str) -> Any:
    try:
        from r2_data import get_json

        return get_json(key)
    except Exception:  # noqa: BLE001 — R2 미설정 로컬
        return None


def sync_to_r2() -> bool:
    """적재분(브라우저 수집 + 쿠키 갱신)을 R2 에 올린다. Render 는 로컬 00_exports 가 없어 여기서 읽는다."""
    daily, detail = load_daily(), load_detail()
    if not daily:
        return False
    try:
        from r2_data import put_json

        ok = bool(put_json(R2_DAILY, daily))
        if detail:
            ok = bool(put_json(R2_DETAIL, detail)) and ok
        cash = load_cash()
        if cash:
            ok = bool(put_json(R2_CASH, cash)) and ok
        print(f"investor: R2 sync {'ok' if ok else 'failed'} ({len(daily)} days)")
        return ok
    except Exception as exc:  # noqa: BLE001
        print(f"investor: R2 sync skipped: {exc}")
        return False


def load_daily() -> dict[str, dict[str, list[float]]]:
    data: dict[str, dict[str, list[float]]] = {}
    remote = _r2_get(R2_DAILY)
    if isinstance(remote, dict):
        data.update(remote)
    for p in sorted(INV_DIR.glob("browser_daily_*.txt")):
        data.update(_parse_browser_daily(p))
    if DAILY_JSON.exists():
        data.update(json.loads(DAILY_JSON.read_text(encoding="utf-8")))
    return dict(sorted(data.items()))


def load_detail() -> dict[str, Any] | None:
    cands = []
    for p in INV_DIR.glob("browser_detail_*.txt"):
        cands.append(_parse_browser_detail(p))
    if DETAIL_JSON.exists():
        cands.append(json.loads(DETAIL_JSON.read_text(encoding="utf-8")))
    remote = _r2_get(R2_DETAIL)
    if isinstance(remote, dict) and remote.get("as_of"):
        cands.append(remote)
    return max(cands, key=lambda d: d["as_of"]) if cands else None


# ---------------------------------------------------------------- KRX_COOKIE 경로 (일별 갱신용)

def _post(session, form: dict[str, str]) -> list[dict[str, str]]:
    res = session.post(JSON_URL, data=form, timeout=60)
    if "LOGOUT" in res.text[:200]:
        raise PermissionError("KRX_COOKIE 만료 — 브라우저로 다시 로그인한 뒤 Cookie 를 갱신하세요")
    return res.json().get("output") or []


def update_from_cookie(days_back: int = 15) -> bool:
    """KRX_COOKIE 가 있으면 최근 구간 일별추이·기간합계를 받아 json 에 합친다. 성공 여부 반환."""
    cookie = os.environ.get("KRX_COOKIE", "").strip()
    if not cookie:
        return False
    import requests

    s = requests.Session()
    s.headers.update({
        "Cookie": cookie, "Referer": REFERER,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    })
    end = date.today()
    start = end - timedelta(days=days_back * 7 // 5 + 3)
    base = {"locale": "ko_KR", "isuCd2": "", "aggBasTpCd": "0", "share": "1", "money": "1",
            "csvxls_isNo": "false", "prtCheck": "SUN"}
    new: dict[str, dict[str, list[float]]] = {}

    def add(rows, slot, div):
        for r in rows:
            iso = r["TRD_DD"].replace("/", "-")
            rec = new.setdefault(iso, {k: [0.0] * 4 for k in SLOTS})
            for i, col in enumerate(("A07", "A08", "A09", "A12")):
                rec[slot][i] += _num(r.get(col)) / div

    daily = {**base, "bld": "dbms/MDC/STAT/standard/MDCSTAT13102", "inqTpCd": "2",
             "strtDd": start.strftime("%Y%m%d"), "endDd": end.strftime("%Y%m%d")}
    for pid in OPT_IDS.values():
        for side, (amt_slot, qty_slot) in (("C", ("ca", "cq")), ("P", ("pa", "pq"))):
            add(_post(s, {**daily, "isuCd": pid, "isuOpt": side, "prtType": "AMT"}), amt_slot, 1e8)
            add(_post(s, {**daily, "isuCd": pid, "isuOpt": side, "prtType": "QTY"}), qty_slot, 1)
            time.sleep(0.5)
    add(_post(s, {**daily, "isuCd": FUT_ID, "isuOpt": "ALL", "prtType": "AMT"}), "fa", 1e8)
    add(_post(s, {**daily, "isuCd": FUT_ID, "isuOpt": "ALL", "prtType": "QTY"}), "fq", 1)
    if not new:
        return False

    # 코스피 현물 [12008] (MDCSTAT02202, 주식만) — TRDVAL1 기관 · 2 기타법인 · 3 개인 · 4 외국인
    cash_rows = _post(s, {"bld": "dbms/MDC/STAT/standard/MDCSTAT02202", "locale": "ko_KR", "inqTpCd": "2",
                          "trdVolVal": "2", "askBid": "3", "mktId": "STK", "segTpCd": "ALL",
                          "strtDd": daily["strtDd"], "endDd": daily["endDd"], "detailView": "1",
                          "share": "1", "money": "1", "csvxls_isNo": "false"})
    if cash_rows:
        cash_path = INV_DIR / "investor_cash.json"
        cash_all = json.loads(cash_path.read_text(encoding="utf-8")) if cash_path.exists() else {}
        for r in cash_rows:
            cash_all[r["TRD_DD"].replace("/", "-")] = [
                round(_num(r.get(f"TRDVAL{i}")) / 1e8) for i in (1, 2, 3, 4)
            ]
        INV_DIR.mkdir(parents=True, exist_ok=True)
        cash_path.write_text(json.dumps(dict(sorted(cash_all.items())), ensure_ascii=False), encoding="utf-8")

    INV_DIR.mkdir(parents=True, exist_ok=True)
    merged = json.loads(DAILY_JSON.read_text(encoding="utf-8")) if DAILY_JSON.exists() else {}
    merged.update({k: {sl: [round(x, 1) for x in v] for sl, v in rec.items()} for k, rec in new.items()})
    DAILY_JSON.write_text(json.dumps(dict(sorted(merged.items())), ensure_ascii=False), encoding="utf-8")

    # 기간합계(기관 세부) — 최근 1·5·20영업일
    days = sorted(load_daily())
    as_of = days[-1]
    windows = {"d1": days[-1], "d5": days[-5], "d20": days[-20]}
    rows: dict[str, dict[str, list[float]]] = {}
    for w, st in windows.items():
        form = {**base, "bld": "dbms/MDC/STAT/standard/MDCSTAT13101", "inqTpCd": "1", "prtType": "QTY",
                "strtDd": st.replace("-", ""), "endDd": as_of.replace("-", "")}
        for key, pid, side in [("OPT", OPT_IDS["OPT"], "C"), ("OPT", OPT_IDS["OPT"], "P"),
                               ("WKI", OPT_IDS["WKI"], "C"), ("WKI", OPT_IDS["WKI"], "P"),
                               ("WKM", OPT_IDS["WKM"], "C"), ("WKM", OPT_IDS["WKM"], "P"),
                               ("FUT", FUT_ID, "ALL")]:
            out = _post(s, {**form, "isuCd": pid, "isuOpt": side})
            rows[f"{w}_{key}_{side}"] = {
                r["INVST_TP_NM"]: [_num(r["NETBID_TRDVOL"]), round(_num(r["NETBID_TRDVAL"]) / 1e8, 1)] for r in out
            }
            time.sleep(0.5)
    DETAIL_JSON.write_text(json.dumps({"as_of": as_of, "rows": rows}, ensure_ascii=False), encoding="utf-8")
    print(f"investor: cookie update {len(new)} days, detail as_of {as_of}")
    return True


# ---------------------------------------------------------------- analysis

def _corr(x: list[float], y: list[float]) -> float | None:
    pairs = [(a, b) for a, b in zip(x, y) if a is not None and b is not None]
    if len(pairs) < 20:
        return None
    xs, ys = zip(*pairs)
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    vx = sum((a - mx) ** 2 for a in xs)
    vy = sum((b - my) ** 2 for b in ys)
    if vx == 0 or vy == 0:
        return None
    return round(sum((a - mx) * (b - my) for a, b in pairs) / math.sqrt(vx * vy), 2)


def _detail_table(detail: dict[str, Any] | None) -> dict[str, Any] | None:
    if not detail:
        return None
    rows = detail["rows"]
    out = {"as_of": detail["as_of"], "windows": {}}
    for w in ("d1", "d5", "d20"):
        table = []
        for name in DETAIL_NAMES:
            def get(key: str, idx: int) -> float:
                return (rows.get(key) or {}).get(name, [0.0, 0.0])[idx]
            call_q = sum(get(f"{w}_{p}_C", 0) for p in ("OPT", "WKI", "WKM"))
            put_q = sum(get(f"{w}_{p}_P", 0) for p in ("OPT", "WKI", "WKM"))
            call_a = sum(get(f"{w}_{p}_C", 1) for p in ("OPT", "WKI", "WKM"))
            put_a = sum(get(f"{w}_{p}_P", 1) for p in ("OPT", "WKI", "WKM"))
            table.append({
                "name": name,
                "fut_qty": int(get(f"{w}_FUT_ALL", 0)), "fut_eok": round(get(f"{w}_FUT_ALL", 1), 1),
                "call_qty": int(call_q), "put_qty": int(put_q),
                "call_eok": round(call_a, 1), "put_eok": round(put_a, 1),
                "dir_eok": round(call_a - put_a, 1),
            })
        out["windows"][w] = table
    return out


def load_cash() -> dict[str, list[float]]:
    """코스피 현물 투자자별 순매수대금(억) {date: [기관, 기타법인, 개인, 외국인]}."""
    data: dict[str, list[float]] = {}
    remote = _r2_get(R2_CASH)
    if isinstance(remote, dict):
        data.update(remote)
    cash_json = INV_DIR / "investor_cash.json"
    for p in sorted(INV_DIR.glob("browser_cash_*.txt")):
        for line in p.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#"):
                continue
            d, vals = line.split("|", 1)
            data[f"20{d[:2]}-{d[2:4]}-{d[4:6]}"] = [float(x) for x in vals.split(",")]
    if cash_json.exists():
        data.update(json.loads(cash_json.read_text(encoding="utf-8")))
    return dict(sorted(data.items()))


def expiry_days(dates: list[str]) -> set[str]:
    """위클리(월·목)·월물(둘째 목) 만기일. 월·목이 휴장이면 다음 영업일로 민다(5/25 휴일 → 5/26)."""
    trade = sorted(dates)
    have = set(trade)
    out = {d for d in trade if date.fromisoformat(d).weekday() in (0, 3)}
    cur = date.fromisoformat(trade[0])
    end = date.fromisoformat(trade[-1])
    while cur <= end:
        iso = cur.isoformat()
        if cur.weekday() in (0, 3) and iso not in have:
            nxt = next((d for d in trade if d > iso), None)
            if nxt:
                out.add(nxt)
        cur += timedelta(days=1)
    return out


def _side(v: float, pos: str, neg: str, flat: str, th: float) -> str:
    if abs(v) < th:
        return flat
    return pos if v > 0 else neg


def _read(name: str, w5: dict[str, float], w20: dict[str, float], has_cash: bool) -> str:
    parts = []
    if has_cash:
        parts.append(f"현물 5일 {w5['cash_eok']:+,.0f}억(20일 {w20['cash_eok']:+,.0f})")
    parts.append(f"선물 5일 {w5['fut_qty']:+,.0f}계약(20일 {w20['fut_qty']:+,.0f})")
    parts.append(_side(w5["dir_eok"], f"비만기일 옵션은 콜 우위 {w5['dir_eok']:+,.0f}억",
                       f"비만기일 옵션은 풋 우위 {w5['dir_eok']:+,.0f}억", "비만기일 옵션은 중립", 20))
    return f"{name}: " + ", ".join(parts)


def investor_section(k200_by_date: dict[str, float]) -> dict[str, Any] | None:
    daily = load_daily()
    if not daily:
        return None
    cash = load_cash()
    has_cash = bool(cash)
    dates = sorted(daily)
    exp = expiry_days(dates)
    closes = [k200_by_date.get(d) for d in dates]
    rets: list[float | None] = [None]
    for i in range(1, len(dates)):
        a, b = closes[i - 1], closes[i]
        rets.append(round((b / a - 1) * 100, 3) if a and b else None)

    series = []
    keys = ("fut", "dir", "roll", "cash")
    cum = {f"{k}_{n}": 0.0 for k in keys for n in INVESTORS}
    last_k = None
    for i, d in enumerate(dates):
        rec = daily[d]
        is_exp = d in exp
        last_k = closes[i] or last_k
        row: dict[str, Any] = {"date": d, "k200": closes[i], "ret": rets[i], "exp": is_exp}
        for j, n in enumerate(INVESTORS):
            fut_q = rec["fq"][j]
            raw_dir = rec["ca"][j] - rec["pa"][j]
            dir_eok = 0.0 if is_exp else raw_dir          # 방향 판단은 비만기일만
            roll = rec["ca"][j] if is_exp else 0.0          # 만기일 콜 대금(커버드콜 롤 상대 거래 포함)
            cash_eok = (cash.get(d) or [None] * 4)[j]
            row[f"fut_{n}"] = round(fut_q)
            row[f"fut_eok_{n}"] = round(rec["fa"][j], 1)
            row[f"call_{n}"] = round(rec["cq"][j])
            row[f"put_{n}"] = round(rec["pq"][j])
            row[f"call_eok_{n}"] = round(rec["ca"][j], 1)
            row[f"put_eok_{n}"] = round(rec["pa"][j], 1)
            row[f"dir_raw_{n}"] = round(raw_dir, 1)
            row[f"dir_{n}"] = None if is_exp else round(dir_eok, 1)
            row[f"roll_{n}"] = round(roll, 1)
            row[f"cash_{n}"] = None if cash_eok is None else round(cash_eok, 1)
            cum[f"fut_{n}"] += fut_q
            cum[f"dir_{n}"] += dir_eok
            cum[f"roll_{n}"] += roll
            cum[f"cash_{n}"] += cash_eok or 0.0
            row[f"cum_fut_{n}"] = round(cum[f"fut_{n}"])
            row[f"cum_dir_{n}"] = round(cum[f"dir_{n}"], 1)
            row[f"cum_roll_{n}"] = round(cum[f"roll_{n}"], 1)
            if has_cash:
                row[f"cum_cash_{n}"] = round(cum[f"cash_{n}"], 1)
                # 현물 누적 순매수 + 선물 누적 계약의 명목금액(억) — 델타 1 노출 합
                fut_notional = cum[f"fut_{n}"] * (last_k or 0) * 250_000 / 1e8
                row[f"expo_{n}"] = round(cum[f"cash_{n}"] + fut_notional, 1)
        series.append(row)

    def window(n: int) -> dict[str, dict[str, float]]:
        rows = series[-n:]
        out = {}
        for name in INVESTORS:
            out[name] = {
                "cash_eok": round(sum(r[f"cash_{name}"] or 0 for r in rows), 1),
                "fut_qty": sum(r[f"fut_{name}"] for r in rows),
                "fut_eok": round(sum(r[f"fut_eok_{name}"] for r in rows), 1),
                "call_qty": sum(r[f"call_{name}"] for r in rows),
                "put_qty": sum(r[f"put_{name}"] for r in rows),
                "call_eok": round(sum(r[f"call_eok_{name}"] for r in rows), 1),
                "put_eok": round(sum(r[f"put_eok_{name}"] for r in rows), 1),
                "dir_eok": round(sum(r[f"dir_{name}"] or 0 for r in rows), 1),
                "roll_eok": round(sum(r[f"roll_{name}"] for r in rows), 1),
                "exp_days": sum(1 for r in rows if r["exp"]),
            }
        return out

    windows = {"d1": window(1), "d5": window(5), "d20": window(20)}
    ret_same = [r["ret"] for r in series]
    ret_next = [r["ret"] for r in series[1:]] + [None]
    corr = []
    for name in INVESTORS:
        fut = [r[f"fut_{name}"] for r in series]
        dirv = [r[f"dir_{name}"] for r in series]
        cashv = [r[f"cash_{name}"] for r in series]
        corr.append({
            "name": name,
            "cash_same": _corr(cashv, ret_same) if has_cash else None,
            "cash_next": _corr(cashv, ret_next) if has_cash else None,
            "fut_same": _corr(fut, ret_same), "fut_next": _corr(fut, ret_next),
            "dir_same": _corr(dirv, ret_same), "dir_next": _corr(dirv, ret_next),
        })

    # 해석 — 방향(현물·선물·비만기일 옵션)과 만기일 롤 상대 거래를 분리
    w5, w20 = windows["d5"], windows["d20"]
    reads = [_read(n, w5[n], w20[n], has_cash) for n in ("외국인", "기관", "개인")]
    detail = load_detail()
    roll_read = None
    if detail:
        rows = detail["rows"]

        def wk(inv: str) -> float:
            return sum((rows.get(f"d20_{p}_C") or {}).get(inv, [0, 0])[1] for p in ("WKI", "WKM"))
        if wk("투신") < -100 and wk("외국인") > 100:
            roll_read = (f"만기일 콜 수요: 20일간 위클리 콜을 투신 {wk('투신'):+,.0f}억 매도 ↔ 외국인 {wk('외국인'):+,.0f}억 매수. "
                         "커버드콜 ETF(코스피200 위클리 커버드콜 순자산 약 11조)의 롤 매도를 외국계가 받는 구조로, "
                         "방향 베팅이 아니라 변동성(감마) 매수다")
    if roll_read is None:
        roll_read = (f"만기일 콜 대금(20일): 외국인 {w20['외국인']['roll_eok']:+,.0f}억 · 기관 {w20['기관']['roll_eok']:+,.0f}억 — "
                     "위클리 만기일 롤 거래라 방향 판단에서 뺐다")
    reads.append(roll_read)
    fp = w20["외국인"]["put_qty"]
    reads.append(f"외국인 풋 20일 {fp:+,.0f}계약 · {w20['외국인']['put_eok']:+,.0f}억 — "
                 + ("싼 외가격 풋을 계약 수로 많이 사는 하방 헤지" if fp > 0 and w20['외국인']['put_eok'] < fp * 0.01
                    else "풋 포지션 변화"))
    if has_cash:
        e = series[-1].get("expo_외국인")
        e20 = series[-21].get("expo_외국인") if len(series) > 21 else None
        if e is not None and e20 is not None:
            fut_n = series[-1]["cum_fut_외국인"] * (series[-1]["k200"] or 0) * 250_000 / 1e12
            reads.append(f"외국인 현물+선물 누적 노출(적재 시작일 {dates[0]} 기준) {e / 1e4:+,.1f}조, 20일 변화 {(e - e20) / 1e4:+,.1f}조 "
                         f"— 선물 롱({fut_n:+,.1f}조)은 현물 매도의 일부만 상쇄")

    return {
        "as_of": dates[-1],
        "first": dates[0],
        "n_days": len(dates),
        "n_exp": len(exp),
        "has_cash": has_cash,
        "cash_as_of": max(cash) if cash else None,
        "investors": INVESTORS,
        "series": series,
        "windows": windows,
        "corr": corr,
        "detail": _detail_table(detail),
        "reads": reads,
        "source": "KRX 정보데이터시스템 [15007] 파생상품·[12008] 주식 투자자별 거래실적 (정규장, 순매수). 로그인 필요 — Open API 미제공",
        "method": [
            "옵션 = 코스피200 옵션(월물) + 위클리(목) + 위클리(월) 합산",
            "만기일 = 월·목(휴장이면 다음 영업일). 만기일 콜 대금은 커버드콜 ETF 롤·잔존 내가격 정리가 섞여 방향 판단에서 제외하고 따로 표시",
            "비만기일 옵션 방향 = 콜 순매수대금 − 풋 순매수대금(억원), 만기일 제외. 계약 수는 위클리·외가격이 섞여 방향 판단에 쓰지 않음",
            "현물 = 코스피 시장 투자자별 순매수대금(억원). 노출 = 현물 누적 + 선물 누적 계약 × 코스피 200 × 25만원",
            "상관 = 일별 순매수와 코스피 200 같은 날/다음 날 등락률의 피어슨 상관",
        ],
    }

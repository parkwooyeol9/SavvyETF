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


def _read(name: str, w5: dict[str, float], w20: dict[str, float]) -> str:
    fut5, fut20, dir5 = w5["fut_qty"], w20["fut_qty"], w5["dir_eok"]
    fut_txt = (f"선물 5일 {'순매수' if fut5 > 0 else '순매도'} {abs(fut5):,.0f}계약"
               f"(20일 {'+' if fut20 > 0 else ''}{fut20:,.0f})")
    if abs(dir5) < 20:
        opt_txt = "옵션 방향성은 중립"
    elif dir5 > 0:
        opt_txt = f"옵션은 콜 우위(콜−풋 순매수대금 +{dir5:,.0f}억) → 상방 베팅"
    else:
        opt_txt = f"옵션은 풋 우위(콜−풋 순매수대금 {dir5:,.0f}억) → 하방 대비"
    return f"{name}: {fut_txt}, {opt_txt}"


def investor_section(k200_by_date: dict[str, float]) -> dict[str, Any] | None:
    daily = load_daily()
    if not daily:
        return None
    dates = sorted(daily)
    closes = [k200_by_date.get(d) for d in dates]
    rets: list[float | None] = [None]
    for i in range(1, len(dates)):
        a, b = closes[i - 1], closes[i]
        rets.append(round((b / a - 1) * 100, 3) if a and b else None)

    series = []
    cum = {f"{k}_{n}": 0.0 for k in ("fut", "dir") for n in INVESTORS}
    for i, d in enumerate(dates):
        rec = daily[d]
        row: dict[str, Any] = {"date": d, "k200": closes[i], "ret": rets[i]}
        for j, n in enumerate(INVESTORS):
            fut_q = rec["fq"][j]
            dir_eok = rec["ca"][j] - rec["pa"][j]
            row[f"fut_{n}"] = round(fut_q)
            row[f"fut_eok_{n}"] = round(rec["fa"][j], 1)
            row[f"call_{n}"] = round(rec["cq"][j])
            row[f"put_{n}"] = round(rec["pq"][j])
            row[f"call_eok_{n}"] = round(rec["ca"][j], 1)
            row[f"put_eok_{n}"] = round(rec["pa"][j], 1)
            row[f"dir_{n}"] = round(dir_eok, 1)
            cum[f"fut_{n}"] += fut_q
            cum[f"dir_{n}"] += dir_eok
            row[f"cum_fut_{n}"] = round(cum[f"fut_{n}"])
            row[f"cum_dir_{n}"] = round(cum[f"dir_{n}"], 1)
        series.append(row)

    def window(n: int) -> dict[str, dict[str, float]]:
        rows = series[-n:]
        out = {}
        for name in INVESTORS:
            out[name] = {
                "fut_qty": sum(r[f"fut_{name}"] for r in rows),
                "fut_eok": round(sum(r[f"fut_eok_{name}"] for r in rows), 1),
                "call_qty": sum(r[f"call_{name}"] for r in rows),
                "put_qty": sum(r[f"put_{name}"] for r in rows),
                "call_eok": round(sum(r[f"call_eok_{name}"] for r in rows), 1),
                "put_eok": round(sum(r[f"put_eok_{name}"] for r in rows), 1),
                "dir_eok": round(sum(r[f"dir_{name}"] for r in rows), 1),
            }
        return out

    windows = {"d1": window(1), "d5": window(5), "d20": window(20)}
    ret_same = [r["ret"] for r in series]
    ret_next = [r["ret"] for r in series[1:]] + [None]
    corr = []
    for name in INVESTORS:
        fut = [r[f"fut_{name}"] for r in series]
        dirv = [r[f"dir_{name}"] for r in series]
        corr.append({
            "name": name,
            "fut_same": _corr(fut, ret_same), "fut_next": _corr(fut, ret_next),
            "dir_same": _corr(dirv, ret_same), "dir_next": _corr(dirv, ret_next),
        })
    reads = [_read(n, windows["d5"][n], windows["d20"][n]) for n in ("외국인", "개인", "기관")]
    best = max(corr, key=lambda c: abs(c["fut_same"] or 0))
    if best["fut_same"] is not None:
        reads.append(f"지수와 같은 날 가장 강하게 움직인 주체는 {best['name']} 선물(상관 {best['fut_same']:+.2f}). "
                     "다음 날 수익률과의 상관은 대부분 0 근처라 예측력보다는 동행 지표로 읽는다")

    return {
        "as_of": dates[-1],
        "first": dates[0],
        "n_days": len(dates),
        "investors": INVESTORS,
        "series": series,
        "windows": windows,
        "corr": corr,
        "detail": _detail_table(load_detail()),
        "reads": reads,
        "source": "KRX 정보데이터시스템 [15007] 파생상품 투자자별 거래실적 (정규장, 순매수). 로그인 필요 — Open API 미제공",
        "method": [
            "옵션 = 코스피200 옵션(월물) + 위클리(목) + 위클리(월) 합산",
            "옵션 방향 = 콜 순매수대금 − 풋 순매수대금(억원). +면 상방(콜 매수·풋 매도), −면 하방",
            "계약 수는 위클리가 월물보다 훨씬 많아(프리미엄이 작음) 방향 판단은 대금 기준",
            "상관 = 일별 순매수(선물 계약·옵션 방향 대금)와 코스피 200 같은 날/다음 날 등락률의 피어슨 상관",
        ],
    }

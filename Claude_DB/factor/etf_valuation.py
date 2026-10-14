"""ETF 밸류에이션 (웹앱 포트폴리오 › 밸류에이션) — 보유종목 룩스루 + ACWI 근사.

    python -m Claude_DB.factor.etf_valuation          # out/stocks.csv + 시계열 캐시 + data/etf_holdings/mapped (약 5초)
    (analyzer.build 끝에서도 자동 실행 — 보유종목은 etf_lookthrough --fetch 로 따로 갱신)

예전 밸류에이션 탭(엑셀 수기 계산 → savvyDB 업로드)을 대체한다. ETF 마다 두 가지 방법 중 하나:
  보유종목  iShares·SPDR 이 공개한 보유종목·비중을 ACWI 종목에 붙여 합산 (etf_lookthrough.py). 커버리지(ETF 주식 비중 중
           ACWI 로 덮은 비율)가 MIN_COVERAGE 미만이면 아래 근사로 바꾸거나 '제외'.
  ACWI 근사  보유종목을 스크립트로 받을 수 없는 운용사(Global X·VanEck·Invesco·First Trust 등)와 일본 TOPIX-17 업종 ETF 는
           같은 성격의 ACWI 종목 묶음(국가·GICS·테마 규칙, ACWI 유동시총 가중, 테마는 한 종목 8% 상한)으로 대신한다.
           실제 ETF 의 지수 규칙·비중과 다르다.
PER 은 지수 방식(Σ시총 ÷ Σ이익, 가중 조화평균). 예전 엑셀은 종목 PER 의 가중 산술평균이라 고PER 종목에 끌려 더 높게 나온다
(SOXX 보유종목 기준 산술 30.1 vs 조화 19.3, 2026-10).
합산식·지표는 groups.py 와 같다 (Σ유동시총 ÷ Σ선행 이익 …). 비교선은 대응하는 ACWI 그룹.

출력
  web/etf_valuation.js            window.ETFVAL — 공개 가능한 ETF 단위 집계 + 구성종목 이름·비중 (봉인 etf_valuation.bin)
  web/etf_valuation_stocks.js     window.ETFVAL_STOCKS — 구성종목별 지표 (관리자 전용, 봉인 etf_valuation_stocks.bin)
  out/groups/etf_latest.csv       ETF 별 현재값·10년 평균·위치·커버리지
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import etf_lookthrough as X
from . import groups as G
from . import themes as T

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
STOCKS_FULL = ROOT / "out" / "analyzer" / "stocks_full.csv"
MIN_COVERAGE = 40.0
CATEGORIES = ["국가", "지역", "섹터(미국)", "섹터(글로벌)", "섹터(일본)", "테마"]

# ── ACWI 근사 ETF: (티커, 운용사, 분류, 이름, 규칙, 비교 그룹) ──
# 규칙: {"groups": [그룹 id …]} 합집합, 또는 {"country", "sector_ko", "industry", "igroup", "exclude_industry"} 교집합.
JP = "일본"
PROXIES: list[tuple[str, str, str, str, dict, str | None]] = [
    # 국가 (Global X·VanEck 국가 ETF)
    ("NORW", "Global X", "국가", "MSCI 노르웨이", {"country": "노르웨이"}, None),
    ("PGAL", "Global X", "국가", "MSCI 포르투갈", {"country": "포르투갈"}, None),
    ("GREK", "Global X", "국가", "MSCI 그리스", {"country": "그리스"}, None),
    ("EGPT", "VanEck", "국가", "이집트", {"country": "이집트"}, None),
    ("COLOMBIA", "—", "국가", "콜롬비아 (상장 ETF 없음)", {"country": "콜롬비아"}, None),
    # 일본 업종 (TOPIX-17·닛케이 ETF → 일본 × GICS)
    ("1321.T", "Nomura", "섹터(일본)", "일본 대표 (닛케이225)", {"country": JP}, "region:ACWI"),
    ("1618.T", "Nomura", "섹터(일본)", "일본 에너지", {"country": JP, "sector_ko": "에너지"}, "sector:ACWI:에너지"),
    ("1620.T", "Nomura", "섹터(일본)", "일본 소재·화학", {"country": JP, "sector_ko": "소재", "exclude_industry": ["Metals & Mining"]}, "sector:ACWI:소재"),
    ("1625.T", "Nomura", "섹터(일본)", "일본 산업재", {"country": JP, "sector_ko": "산업재"}, "sector:ACWI:산업재"),
    ("1630.T", "Nomura", "섹터(일본)", "일본 경기소비", {"country": JP, "sector_ko": "경기소비재"}, "sector:ACWI:경기소비재"),
    ("1617.T", "Nomura", "섹터(일본)", "일본 필수소비", {"country": JP, "sector_ko": "필수소비재"}, "sector:ACWI:필수소비재"),
    ("2639.T", "Nomura", "섹터(일본)", "일본 헬스케어", {"country": JP, "sector_ko": "헬스케어"}, "sector:ACWI:헬스케어"),
    ("1632.T", "Nomura", "섹터(일본)", "일본 금융 (은행 제외)", {"country": JP, "sector_ko": "금융", "exclude_industry": ["Banks"]}, "sector:ACWI:금융"),
    ("1615.T", "Nomura", "섹터(일본)", "일본 은행", {"country": JP, "industry": ["Banks"]}, "industry:Banks"),
    ("1343.T", "Nomura", "섹터(일본)", "일본 부동산 (리츠 대신 개발사 위주)", {"country": JP, "sector_ko": "부동산"}, "sector:ACWI:부동산"),
    ("2854.T", "—", "섹터(일본)", "일본 IT", {"country": JP, "sector_ko": "IT"}, "sector:ACWI:IT"),
    ("2627.T", "—", "섹터(일본)", "일본 통신", {"country": JP, "sector_ko": "커뮤니케이션"}, "sector:ACWI:커뮤니케이션"),
    ("1627.T", "Nomura", "섹터(일본)", "일본 유틸리티", {"country": JP, "sector_ko": "유틸리티"}, "sector:ACWI:유틸리티"),
    ("1622.T", "Nomura", "섹터(일본)", "일본 자동차", {"country": JP, "igroup": ["자동차·부품"]}, "igroup:자동차·부품"),
    ("1621.T", "Nomura", "섹터(일본)", "일본 제약", {"country": JP, "industry": ["Pharmaceuticals"]}, "industry:Pharmaceuticals"),
    ("2644.T", "Global X", "섹터(일본)", "일본 반도체", {"country": JP, "industry": ["Semiconductors & Semiconductor Equipment"]}, "theme:semi_all"),
    # 테마 (보유종목을 받을 수 없는 운용사)
    ("SKYY", "First Trust", "테마", "클라우드", {"groups": ["theme:software", "theme:hyperscaler"]}, None),
    ("CIBR", "First Trust", "테마", "사이버보안", {"groups": ["theme:cyber"]}, None),
    ("GRID", "First Trust", "테마", "스마트그리드·전력 인프라", {"groups": ["theme:grid"]}, None),
    ("BOTZ", "Global X", "테마", "로봇·AI", {"groups": ["theme:robotics"]}, None),
    ("DRIV", "Global X", "테마", "자율주행·전기차", {"groups": ["theme:ev_battery"]}, None),
    ("SHLD", "Global X", "테마", "글로벌 방산", {"groups": ["theme:defense"]}, None),
    ("URA", "Global X", "테마", "우라늄·원자력", {"groups": ["theme:nuclear"]}, None),
    ("LIT", "Global X", "테마", "리튬·배터리", {"groups": ["theme:strategic_min", "theme:ev_battery"]}, None),
    ("ZAP", "Global X", "테마", "전력 인프라", {"groups": ["theme:grid"]}, None),
    ("PAVE", "Global X", "테마", "미국 인프라 건설", {"country": "미국", "industry": [
        "Construction & Engineering", "Construction Materials", "Electrical Equipment", "Machinery",
        "Trading Companies & Distributors"]}, None),
    ("KWEB", "KraneShares", "테마", "중국 인터넷", {"groups": ["theme:china_internet"]}, None),
    ("CQQQ", "Invesco", "테마", "중국 테크", {"groups": ["sector:중국:IT", "sector:중국:커뮤니케이션", "theme:china_internet"]}, None),
    ("TAN", "Invesco", "테마", "태양광", {"codes": T.SOLAR + ["300274.SZ"]}, None),
    ("UFO", "Procure", "테마", "우주 (민항·우주 근사)", {"groups": ["theme:aero"]}, None),
    ("JETS", "U.S. Global", "테마", "항공사", {"industry": ["Passenger Airlines"]}, None),
    ("GDX", "VanEck", "테마", "금광", {"groups": ["theme:gold"]}, None),
    ("REMX", "VanEck", "테마", "희토류·전략광물", {"groups": ["theme:strategic_min"]}, None),
]
# 보유종목 커버리지가 낮을 때 대신 쓸 근사 (없으면 제외)
LOW_COVERAGE_PROXY = {"IHAK": {"groups": ["theme:cyber"]}}
# 아예 만들 수 없는 것 (예전 탭에 있던 ETF)
UNAVAILABLE = [
    ("QTUM", "양자컴퓨팅", "양자컴퓨팅 테마가 ACWI 대형주로 근사되지 않음"),
    ("SIXG", "6G", "통신장비·반도체 혼합 — 근사 규칙 미정"),
    ("MOO", "농산물", "농업 밸류체인 근사 규칙 미정"),
    ("ARGT", "아르헨티나", "MSCI ACWI 미편입 국가"),
    ("VNM", "베트남", "MSCI ACWI 미편입 국가"),
    ("PAK", "파키스탄", "MSCI ACWI 미편입 국가"),
]
STOCK_KEYS = {"n": "name", "ct": "country", "s": "sector_ko", "w": "wgt", "pe": "pe", "pb": "pb", "dy": "dy", "roe": "roe",
              "eg": "eps_g", "sg": "sales_g", "er3": "eps_rev_3m", "r12m": "r_12m", "pep10": "pe_pct_10y"}


THEME_CAP = 8.0       # 테마 근사: 한 종목 비중 상한 % (테마 지수 대부분이 4~10% 상한 — 테슬라 하나가 DRIV·LIT 근사를 지배하지 않게)


def cap_weights(v: np.ndarray, cap: float) -> np.ndarray:
    """비중(합 100) 상한 cap 을 넘는 만큼 나머지에 비례 재분배 (반복)."""
    v = v / v.sum() * 100
    for _ in range(50):
        over = v > cap + 1e-9
        if not over.any():
            break
        extra = (v[over] - cap).sum()
        v[over] = cap
        free = (v > 0) & ~over & (v < cap)
        if not free.any():
            break
        v[free] += extra * v[free] / v[free].sum()
    return v


def _rule_mask(cl: pd.DataFrame, rule: dict, gmask: dict[str, np.ndarray]) -> np.ndarray:
    if "groups" in rule:
        m = np.zeros(len(cl), bool)
        for gid in rule["groups"]:
            m |= gmask[gid]
        return m
    if "codes" in rule:
        return cl["code"].isin(rule["codes"]).to_numpy()
    m = np.ones(len(cl), bool)
    if "country" in rule:
        m &= (cl["country"] == rule["country"]).to_numpy()
    if "sector_ko" in rule:
        m &= (cl["sector_ko"] == rule["sector_ko"]).to_numpy()
    for k in ("industry", "igroup"):
        if k in rule:
            m &= cl[k].isin(rule[k]).to_numpy()
    if "exclude_industry" in rule:
        m &= ~cl["industry"].isin(rule["exclude_industry"]).to_numpy()
    return m


def _entries(cl: pd.DataFrame, gmask: dict[str, np.ndarray]) -> tuple[list[dict], list[dict]]:
    """ETF 정의 → [{ticker, label, category, issuer, method, vec(비중 %), coverage, compare, …}], 제외 목록."""
    w = cl["wgt"].fillna(0).to_numpy()
    idx = {c: i for i, c in enumerate(cl["code"])}
    out, dropped = [], [{"ticker": t, "label": l, "reason": r} for t, l, r in UNAVAILABLE]

    def proxy(t, issuer, cat, label, rule, cmp_id, note=None):
        m = _rule_mask(cl, rule, gmask)
        vec = np.where(m, w, 0.0)
        if vec.sum() <= 0:
            dropped.append({"ticker": t, "label": label, "reason": "ACWI 에 해당 종목 없음"})
            return
        n = int((vec > 0).sum())
        vec = cap_weights(vec, max(THEME_CAP, 120 / n)) if cat == "테마" and n > 1 else vec / vec.sum() * 100   # 종목 적으면 균등의 1.2배
        out.append({"ticker": t, "label": label, "category": cat, "issuer": issuer, "method": "ACWI 근사",
                    "vec": vec, "coverage": None, "asof": None, "n_holdings": int(m.sum()),
                    "compare": cmp_id, "note": note})

    cat_map = {"산업·테마": "테마"}
    for e in X.load_mapped():
        t, cat = e["ticker"], cat_map.get(e["category"], e["category"])
        vec = np.zeros(len(cl))
        for c, wt in e["weights"].items():
            if c in idx and np.isfinite(wt) and wt > 0:
                vec[idx[c]] += wt
        mapped = sum(v for v in e["weights"].values() if np.isfinite(v))
        cov = e["coverage"] * vec.sum() / mapped if mapped else 0.0          # 팩터 제외 종목만큼 다시 깎는다
        if cov < MIN_COVERAGE or vec.sum() <= 0:
            if t in LOW_COVERAGE_PROXY:
                proxy(t, e["issuer"], cat, e["label"], LOW_COVERAGE_PROXY[t], e["compare"],
                      note=f"보유종목 커버리지 {cov:.0f}% → ACWI 근사")
            else:
                dropped.append({"ticker": t, "label": e["label"], "reason": f"ACWI 커버리지 {cov:.0f}% (소형주 위주)"})
            continue
        out.append({"ticker": t, "label": e["label"], "category": cat, "issuer": e["issuer"], "method": "보유종목",
                    "vec": vec, "coverage": cov, "asof": e["asof"], "n_holdings": e["n_holdings"], "compare": e["compare"],
                    "note": None})
    for t, issuer, cat, label, rule, cmp_id in PROXIES:
        proxy(t, issuer, cat, label, rule, cmp_id)
    order = {c: i for i, c in enumerate(CATEGORIES)}
    out.sort(key=lambda e: order.get(e["category"], 99))
    return out, dropped


def _series_payload(A: dict, j: int, keys: list[str]) -> dict:
    s = {k: [G._c(x) for x in A[k][:, j]] for k in keys + ["cov"]}
    s["n"] = [int(x) for x in A["n"][:, j]]
    return s


def build(d: pd.DataFrame, ts, as_of: str | None = None, source: str = "") -> dict:
    if ts is None or ts.ri_m is None or ts.ri_m.empty or ts.sal is None or ts.sal.empty:
        raise SystemExit("월간 10년 시트(Price_(Monthly_10Y)·EPS·BPS·DPS·SALE)가 필요합니다.")
    d = d[d["code"].notna()].drop_duplicates("code").reset_index(drop=True)
    cl = G.classify(d)
    d = d.set_index("code").loc[cl["code"]].reset_index()
    defs = G._group_defs(cl)
    gmask = {g["id"]: g["mask"] for g in defs}
    etfs, dropped = _entries(cl, gmask)
    keys = [m[0] for m in G.METRICS]

    # ETF: 비중 1 패널 × ETF 비중
    Pu, info = G._stock_panels(d.assign(wgt=1.0), ts)
    Me = np.stack([e["vec"] for e in etfs], axis=1)
    se = (Me > 0).sum(axis=0).astype(float)
    Ae, Ye = G.aggregate(Pu, Me, se), G.snapshot_cy(Pu, Me, se)
    # 비교 그룹: ACWI 비중 패널 × 0/1
    cmp_ids = sorted({e["compare"] for e in etfs if e["compare"] and e["compare"] in gmask} | {"region:ACWI"})
    Pa, _ = G._stock_panels(d, ts)
    Mc = np.stack([gmask[g] for g in cmp_ids], axis=1).astype(float)
    sc = Mc.sum(axis=0)
    Ac = G.aggregate(Pa, Mc, sc)
    months = info["months"]

    codes_all = cl["code"].to_numpy()
    groups, series, rows, used = [], {}, [], set()
    for j, e in enumerate(etfs):
        order = np.argsort(-e["vec"])
        order = order[e["vec"][order] > 0]
        codes = codes_all[order].tolist()
        used.update(codes)
        cy = {k: G._c(Ye[k][j], 4) for k in Ye}
        pe_now = Ae["pe"][-1, j]
        if cy.get("eg27") and cy["eg27"] > 0 and np.isfinite(pe_now):
            cy["peg"] = G._c(pe_now / cy["eg27"], 3)                   # PER ÷ EPS 성장률(CY27/CY26, %)
        gid = f"etf:{e['ticker']}"
        cov_txt = f"ACWI 커버리지 {e['coverage']:.0f}%" if e["coverage"] is not None else "ACWI 근사 (같은 성격 종목 묶음)"
        asof = f"보유종목 {e['asof'][:4]}-{e['asof'][4:6]}-{e['asof'][6:]} · " if e["asof"] else ""
        groups.append({
            "id": gid, "dim": "etf", "scope": e["category"], "key": e["ticker"],
            "label": f"{e['ticker']} · {e['label']}", "desc": f"{e['issuer']} · {asof}{cov_txt}" + (f" · {e['note']}" if e["note"] else ""),
            "n": int(se[j]), "w": None, "cy": {k: v for k, v in cy.items() if v is not None}, "codes": codes,
            "wts": [G._c(x, 4) for x in e["vec"][order]],
            "etf": {"ticker": e["ticker"], "issuer": e["issuer"], "asof": e["asof"], "coverage": G._c(e["coverage"], 3),
                    "n_holdings": e["n_holdings"], "compare": e["compare"], "method": e["method"]},
        })
        series[gid] = _series_payload(Ae, j, keys)
        row = {"ticker": e["ticker"], "label": e["label"], "category": e["category"], "issuer": e["issuer"],
               "method": e["method"], "coverage": G._c(e["coverage"], 3), "asof": e["asof"], "n": int(se[j]),
               **{f"cy_{k}": v for k, v in cy.items()}}
        for k in keys:
            s = Ae[k][:, j]
            row[k] = G._c(s[-1])
            if k != "tr":
                row.update({f"{k}_{sk}": G._c(sv) for sk, sv in G._hist_stats(s).items()})
        rows.append(row)
    glab = {g["id"]: g for g in defs}
    for j, gid in enumerate(cmp_ids):
        g = glab[gid]
        groups.append({"id": gid, "dim": "cmp", "scope": g["scope"], "key": g["key"], "label": g["label"],
                       "n": int(sc[j]), "w": None, "cy": {}, "codes": []})
        series[gid] = _series_payload(Ac, j, keys)

    G.OUT.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(G.OUT / "etf_latest.csv", index=False, encoding="utf-8-sig")
    names = dict(zip(cl["code"], zip(cl["name"].astype(str), cl["country"])))
    meta = {
        "built_at": dt.datetime.now().isoformat(timespec="seconds"), "as_of": as_of or months[-1], "source": source,
        "months": months, "n_stocks": int(len(cl)), "n_etfs": len(etfs),
        "metrics": [{"key": k, "label": l, "unit": u, "desc": de, "dir": di} for k, l, u, de, di in G.METRICS],
        "dims": [{"key": "etf", "label": "ETF"}], "sector_scopes": [],
        "etf_scopes": [c for c in CATEGORIES if any(e["category"] == c for e in etfs)],
        "themes": [{"key": k, "label": t["label"], "desc": t.get("desc", "")} for k, t in T.THEMES.items()],
        "quality": {"unavailable": dropped, "n_holdings_based": sum(e["method"] == "보유종목" for e in etfs),
                    "n_proxy": sum(e["method"] == "ACWI 근사" for e in etfs),
                    "drift_capped_stocks": info.get("drift_capped_stocks"),
                    **{k: v for k, v in info.items() if k.endswith("_breaks")}},
    }
    th: dict[str, list[str]] = {}
    for k, cs in cl.attrs["theme_members"].items():
        for c in cs:
            th.setdefault(c, []).append(k)
    # 공개분 종목 정보는 이름·국가·테마(분류)만 — 종목 단위 지표는 관리자 파일에
    web = {"meta": meta, "groups": groups, "series": series,
           "stocks": {c: {"n": names[c][0], "ct": names[c][1], "th": th.get(c, [])} for c in sorted(used)}}
    WEB.mkdir(parents=True, exist_ok=True)
    js = "window.ETFVAL = " + json.dumps(web, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (WEB / "etf_valuation.js").write_text(js, encoding="utf-8")

    # 관리자 전용: 구성종목 지표 (analyzer 의 stocks_full.csv)
    stk = {}
    if STOCKS_FULL.exists():
        sf = pd.read_csv(STOCKS_FULL, encoding="utf-8-sig").drop_duplicates("code").set_index("code")
        for c in sorted(used):
            if c in sf.index:
                r = sf.loc[c]
                stk[c] = {k: (G._c(r[v]) if isinstance(r[v], (int, float, np.floating)) else r[v])
                          for k, v in STOCK_KEYS.items() if v in sf.columns and pd.notna(r[v])}
    js2 = "window.ETFVAL_STOCKS = " + json.dumps(stk, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (WEB / "etf_valuation_stocks.js").write_text(js2, encoding="utf-8")
    meta["size_js_mb"] = round(len(js.encode()) / 1e6, 2)
    meta["size_stocks_mb"] = round(len(js2.encode()) / 1e6, 2)
    return meta


def main():
    ap = argparse.ArgumentParser(description="ETF 밸류에이션 (보유종목 룩스루 + ACWI 근사)")
    ap.add_argument("--stocks", default=str(ROOT / "out" / "stocks.csv"))
    ap.add_argument("--xlsx", default=str(ROOT / "data" / "ACWI_v3.xlsx"))
    ap.add_argument("--as-of", default=None)
    a = ap.parse_args()
    from .timeseries import load_timeseries
    meta = build(pd.read_csv(a.stocks, encoding="utf-8-sig"), load_timeseries(a.xlsx), a.as_of, Path(a.xlsx).name)
    q = meta["quality"]
    print(json.dumps({k: meta[k] for k in ("as_of", "n_etfs", "etf_scopes", "size_js_mb", "size_stocks_mb")} | {
        "보유종목": q["n_holdings_based"], "ACWI 근사": q["n_proxy"],
        "제외": [f"{u['ticker']}({u['reason']})" for u in q["unavailable"]]}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

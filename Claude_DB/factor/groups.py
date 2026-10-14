"""국가·지역·섹터·산업·테마별 10년 밸류에이션·성장 집계.

    python -m Claude_DB.factor.groups                     # out/stocks.csv + 시계열 캐시로 (약 10초)
    python -m Claude_DB.factor.groups --xlsx Claude_DB/data/ACWI_v3.xlsx   # 캐시가 없을 때 시트에서 읽기
    (analyzer.build 끝에서도 자동 실행)

출력
  web/groups_data.js          window.GROUPS (웹앱 봉인 파일 groups.bin 의 원본)
  out/groups/classification.csv   종목별 국가·지역·섹터·산업그룹·산업·테마
  out/groups/latest.csv           그룹별 현재값·10년 평균·10년 백분위
  out/groups/series_long.csv      그룹 × 월 × 지표 (엑셀 피벗용)

집계 방식 — MSCI 지수 방식(유동시총 가중 합산):
  w_i   = 현재 ACWI 비중 (유동시총 가중)
  W_i,t = w_i × P_i,t / P_i,now             과거 유동시총 (유동주식수 일정 가정, P 는 RI 에서 배당 재투자분 제거)
  E_i,t = w_i × (EPS_now/P_now)[USD] × EPS_i,t / EPS_i,now    과거 12M 선행 순이익 (같은 척도)
  B, D, S 도 같은 방식 (BPS·DPS·매출 NTM)
  그룹 PER_t = ΣW / ΣE  ·  PBR = ΣW / ΣB(B>0)  ·  PSR = ΣW / ΣS  ·  배당수익률 = ΣD / ΣW  ·  ROE = ΣE / ΣB
  EPS·매출 성장률(YoY) = 같은 종목 묶음의 ΣE_t / ΣE_t-12 − 1  (구성 변화 효과 제거, 현지통화 기준)
  수익률 지수 = W_t-1 가중 월간 RI 수익률 누적 (현지통화 총수익)

한계
  · 현재 구성종목 기준 (생존 편향, 과거 편출 종목 없음). 과거로 갈수록 상장 전 종목이 빠진다 → cov(현재 비중 대비 커버리지)
  · 과거 비중·이익의 통화 환산은 현재 환율 고정 → 국가 안 비율은 정확, 여러 나라 섞인 그룹은 비중이 근사
  · 가격(현지통화)과 추정치(보고통화)가 다른 종목은 종목 PER 경로에 환율 변동만큼 오차 (fundamentals_ts 와 같음)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from . import themes as T

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "groups"
WEB = ROOT / "web"

EUROPE_DM = ["영국", "독일", "프랑스", "스위스", "네덜란드", "스웨덴", "덴마크", "이탈리아", "스페인", "핀란드", "벨기에",
             "노르웨이", "아일랜드", "오스트리아", "포르투갈", "룩셈부르크"]
# 지역 묶음: 라벨 → 조건(stocks DataFrame → bool Series)
REGIONS = {
    "ACWI": lambda s: s["country"].notna(),
    "선진 전체": lambda s: s["region"].isin(["미국", "선진(미국 외)"]),
    "미국": lambda s: s["region"] == "미국",
    "선진(미국 외)": lambda s: s["region"] == "선진(미국 외)",
    "유럽 선진": lambda s: s["country"].isin(EUROPE_DM),
    "신흥": lambda s: s["region"] == "신흥",
}
# 섹터를 나라·지역 안에서 볼 범위
SECTOR_SCOPES = ["ACWI", "미국", "선진(미국 외)", "유럽 선진", "신흥", "일본", "중국", "인도", "대만", "한국"]

METRICS = [
    # key, 라벨, 단위, 설명, 높을수록 '비쌈/좋음' 방향(색칠용: +1 높을수록 비쌈, -1 높을수록 쌈, 0 중립)
    ("pe", "Fwd PER", "배", "12개월 선행 PER = Σ유동시총 / Σ선행 순이익", 1),
    ("pb", "Fwd PBR", "배", "12개월 선행 PBR = Σ유동시총 / Σ선행 자기자본 (자본잠식 종목 제외)", 1),
    ("ps", "Fwd PSR", "배", "12개월 선행 PSR = Σ유동시총 / Σ선행 매출", 1),
    ("dy", "배당수익률", "%", "12개월 선행 DPS 합 / 유동시총", -1),
    ("roe", "Fwd ROE", "%", "Σ선행 순이익 / Σ선행 자기자본", 0),
    ("eg", "EPS 성장률", "%", "12개월 선행 순이익 전년 대비 (같은 종목, 현지통화)", 0),
    ("sg", "매출 성장률", "%", "12개월 선행 매출 전년 대비 (같은 종목, 현지통화)", 0),
    ("er1", "EPS 리비전 1M", "%", "12개월 선행 순이익 1개월 변화", 0),
    ("er3", "EPS 리비전 3M", "%", "12개월 선행 순이익 3개월 변화", 0),
    ("tr", "총수익 지수", "pt", "유동시총 가중 월간 총수익(현지통화) 누적, 시작=100", 0),
]
MAX_PE = 150       # 그룹 PER 상한: 넘으면 결측 (이익수익률 0.67% 미만 — 적자·흑자가 상쇄된 테마 등)
MIN_N = 3          # 그룹 표본이 이보다 적으면 결측 (그룹 크기가 작으면 그 크기)
DRIFT_CAP = 15    # 과거 비중 확대 상한 (시장 중앙값 대비 가격 상대 배수)
BREAK = {"eps": math.log(10), "bps": math.log(4), "dps": math.log(10), "sal": math.log(4)}   # 월간 단절(통화·단위 변경) 기준


def _c(v, sig=4):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return float(f"{float(v):.{sig}g}")


def clean_breaks(df: pd.DataFrame, thr: float) -> tuple[pd.DataFrame, int]:
    """한 달에 thr(로그) 넘게 뛰는 지점 = 보고통화·단위 변경 의심. 마지막 단절 이전 값을 버린다."""
    x = df.where(df > 0)
    lr = np.log(x).diff().abs()
    out = df.copy()
    hit = lr.columns[(lr > thr).any()]
    for c in hit:
        last = lr.index[lr[c] > thr][-1]
        out.loc[out.index < last, c] = np.nan
    return out, len(hit)


def classify(stocks: pd.DataFrame) -> pd.DataFrame:
    """종목 분류표: 국가·지역(원자료/engine) + 섹터·산업그룹·산업(GICS) + 테마(다중)."""
    s = stocks[["code", "name", "country", "region", "sector", "sector_ko", "industry", "wgt"]].copy()
    s = s[s["country"].notna() & (s["country"] != "기타")]
    s["igroup"] = s["industry"].map(lambda x: T.INDUSTRY.get(x, ("기타", x))[0])
    s["industry_ko"] = s["industry"].map(lambda x: T.INDUSTRY.get(x, ("기타", x))[1])
    mem = T.theme_members(s)
    by_code: dict[str, list[str]] = {}
    for k, codes in mem.items():
        for c in codes:
            by_code.setdefault(c, []).append(k)
    s["themes"] = s["code"].map(lambda c: by_code.get(c, []))
    s.attrs["theme_members"] = mem
    s.attrs["theme_missing"] = {k: sorted(set(t.get("codes", [])) - set(s["code"])) for k, t in T.THEMES.items()
                                if set(t.get("codes", [])) - set(s["code"])}
    return s.reset_index(drop=True)


def _group_defs(cl: pd.DataFrame) -> list[dict]:
    """그룹 정의 목록: id, dim, scope, key, label, mask(bool 배열)."""
    defs = []

    def add(dim, key, label, mask, scope=None, desc=None):
        mask = np.asarray(mask, dtype=bool)
        if mask.sum() == 0:
            return
        gid = f"{dim}:{scope}:{key}" if scope else f"{dim}:{key}"
        defs.append({"id": gid, "dim": dim, "scope": scope, "key": key, "label": label, "mask": mask,
                     **({"desc": desc} if desc else {})})

    for lab, f in REGIONS.items():
        add("region", lab, lab, f(cl))
    for ct, n in cl["country"].value_counts().items():
        add("country", ct, ct, cl["country"] == ct)
    for scope in SECTOR_SCOPES:
        base = REGIONS[scope](cl) if scope in REGIONS else cl["country"] == scope
        for sec in C.SECTOR_KO.values():
            add("sector", sec, sec, base & (cl["sector_ko"] == sec), scope=scope)
    for ig in dict.fromkeys(g for g, _ in T.INDUSTRY.values()):
        add("igroup", ig, ig, cl["igroup"] == ig)
    for ind, (_, ko) in T.INDUSTRY.items():
        add("industry", ind, ko, cl["industry"] == ind)
    mem = cl.attrs["theme_members"]
    for k, t in T.THEMES.items():
        add("theme", k, t["label"], cl["code"].isin(mem[k]), desc=t.get("desc"))
    return defs


def _stock_panels(d: pd.DataFrame, ts) -> tuple[dict, dict]:
    """종목 × 월 패널: W(유동시총), E, B, D, S, R(월 수익률). d 는 engine 결과(현재 USD 스냅샷)."""
    codes = d["code"].tolist()
    months = ts.eps.index
    info = {}
    px = d["px_usd"].where(d["px_usd"] > 0)
    w = d["wgt"].where(d["wgt"] > 0)
    bad = d.get("data_flag", pd.Series("", index=d.index)).fillna("").astype(str) != ""   # 최근 급변 종목
    ey = (d["eps_ntm"] / px).where(~bad)
    by = (d["bps_ntm"] / px).where(~bad)
    dyl = (d["dps_ntm"] / px).where(~bad)
    sy = (d["sales_usd_mn"] / d["mcap_usd_mn"]).where(~bad & (d["mcap_usd_mn"] > 0))

    ri = ts.ri_m.reindex(columns=codes).ffill(limit=1).reindex(months, method="ffill")
    yrs = (months[-1] - months).days.to_numpy()[:, None] / 365.25
    dy_now = dyl.fillna(0).clip(0, 0.2).to_numpy()[None, :]
    prel = (ri / ri.iloc[-1]).to_numpy() * (1 + dy_now) ** yrs
    # 유상증자·감자로 주식수가 크게 바뀐 종목(BMPS 등)은 '현재 비중 × 가격 변화'가 과거 비중을 수십~수백 배 부풀린다.
    # 시장 중앙값 대비 DRIFT_CAP 배를 넘는 만큼 W·E·B·D·S 를 같은 비율로 줄인다 (종목 자체 배수는 그대로).
    with np.errstate(invalid="ignore", divide="ignore"):
        mkt = np.nanmedian(prel, axis=1)[:, None]
        f = np.where(np.isfinite(prel) & (prel > DRIFT_CAP * mkt), DRIFT_CAP * mkt / prel, 1.0)
    info["drift_capped_stocks"] = int((f < 1).any(axis=0).sum())
    W = prel * w.to_numpy()[None, :] * f

    def scaled(df: pd.DataFrame, key: str, yld: pd.Series, allow_zero=False):
        df = df.reindex(columns=codes).reindex(months)
        df, nb = clean_breaks(df, BREAK[key])
        info[f"{key}_breaks"] = nb
        x = df.to_numpy(dtype=float)
        last = x[-1][None, :]
        with np.errstate(divide="ignore", invalid="ignore"):
            rel = np.where(last != 0, x / last, np.nan)
        if allow_zero:                                   # 현재 무배당: 과거도 0 이면 0, 아니면 척도 불명 → 결측
            rel = np.where(last == 0, np.where(x == 0, 0.0, np.nan), rel)
        if key in ("bps", "sal"):
            rel = np.where(last > 0, rel, np.nan)
        return rel * (w * yld).to_numpy()[None, :] * f

    E = scaled(ts.eps, "eps", ey)
    B = scaled(ts.bps, "bps", by)
    D = scaled(ts.dps, "dps", dyl, allow_zero=True)
    S = scaled(ts.sal, "sal", sy)
    R = (ri / ri.shift(1) - 1).clip(-0.8, 2.0).to_numpy()

    # ── 컨센서스 연도별 (스냅샷): CY25·26·27 EPS·매출 → 같은 척도 ──
    # 연도 추정치는 월간 시트와 단위·통화가 다를 수 있어(한국 매출 등) 같은 열 안에서만 비율을 잡는다:
    # 현재 NTM ≈ (남은 CY26 개월 비중)×CY26 + 나머지×CY27 → 이 값에 현재 E(S) 를 맞춘다. 12월 결산 가정.
    f26 = (13 - months[-1].month) / 12
    cy = {}
    for k, col, yld in (("e", "eps_cy", ey), ("s", "rev_cy", sy)):
        v = {y: d[f"{col}{y}"].to_numpy(dtype=float) for y in (25, 26, 27)}
        ref = f26 * v[26] + (1 - f26) * v[27]
        for y in (25, 26, 27):
            with np.errstate(divide="ignore", invalid="ignore"):
                ratio = v[y] / ref
            ok = (ref > 0) & np.isfinite(ratio) & (np.abs(ratio) < 5)
            cy[f"{k}{y}"] = np.where(ok, (w * yld).to_numpy() * ratio, np.nan)
    info["months"] = [m.strftime("%Y-%m") for m in months]
    return {"W": W, "E": E, "B": B, "D": D, "S": S, "R": R, "cy": cy, "w": w.to_numpy()}, info


def _sum(x: np.ndarray, valid: np.ndarray, M: np.ndarray) -> np.ndarray:
    return np.where(valid, x, 0.0) @ M


def aggregate(P: dict, M: np.ndarray, sizes: np.ndarray) -> dict[str, np.ndarray]:
    """P: 종목 패널, M: 종목 × 그룹 가중치 (ACWI 그룹은 0/1 + P 의 ACWI 비중, ETF 는 ETF 비중 + 비중 1 패널).
    반환: 지표 → (월 × 그룹)."""
    W, E, B, D, S, R = (P[k] for k in ("W", "E", "B", "D", "S", "R"))
    fin = np.isfinite
    min_n = np.minimum(MIN_N, sizes)[None, :]
    Mb = (M > 0).astype(float)
    out = {}

    def ratio(num, den, valid, pos_den=True):
        a, b = _sum(num, valid, M), _sum(den, valid, M)
        n = valid.astype(float) @ Mb
        with np.errstate(divide="ignore", invalid="ignore"):
            r = a / b
        bad = (n < min_n) | (b <= 0 if pos_den else b == 0)
        return np.where(bad, np.nan, r), n

    vw = fin(W)
    out["pe"], n_pe = ratio(W, E, vw & fin(E))
    out["pe"] = np.where(out["pe"] > MAX_PE, np.nan, out["pe"])   # Σ이익 ≈ 0 (흑자·적자 상쇄) 이면 PER 이 수천으로 튐 → 의미 없음
    vb = vw & fin(B) & (B > 0)
    out["pb"], _ = ratio(W, B, vb)
    out["ps"], _ = ratio(W, S, vw & fin(S) & (S > 0))
    dy, _ = ratio(D, W, vw & fin(D))
    out["dy"] = dy * 100
    roe, _ = ratio(E, B, vb & fin(E))
    out["roe"] = roe * 100

    def growth(X, k):
        prev = np.full_like(X, np.nan)
        prev[k:] = X[:-k]
        v = fin(X) & fin(prev)
        g, _ = ratio(X, prev, v)
        return (g - 1) * 100

    out["eg"] = growth(E, 12)
    out["sg"] = growth(S, 12)
    out["er1"] = growth(E, 1)
    out["er3"] = growth(E, 3)

    Wp = np.full_like(W, np.nan)
    Wp[1:] = W[:-1]
    vr = fin(Wp) & fin(R)
    rr, _ = ratio(R * Wp, Wp, vr)
    rr = np.where(np.isnan(rr), 0.0, rr)
    rr[0] = 0.0
    out["tr"] = 100 * np.cumprod(1 + rr, axis=0)
    wn = np.nan_to_num(P["w"])
    tot = wn @ M
    with np.errstate(divide="ignore", invalid="ignore"):
        out["cov"] = (fin(E) * wn[None, :]) @ M / tot * 100
    out["n"] = n_pe
    return out


def snapshot_cy(P: dict, M: np.ndarray, sizes: np.ndarray) -> dict[str, np.ndarray]:
    """컨센서스 연도 성장률: 같은 종목 묶음의 ΣCY27/ΣCY26 − 1 등."""
    cy = P["cy"]
    min_n = np.minimum(MIN_N, sizes)
    out = {}
    for k in ("e", "s"):
        for a, b in ((26, 25), (27, 26)):
            x, y = cy[f"{k}{a}"], cy[f"{k}{b}"]
            v = np.isfinite(x) & np.isfinite(y)
            num, den = np.where(v, x, 0) @ M, np.where(v, y, 0) @ M
            n = v.astype(float) @ (M > 0)
            with np.errstate(divide="ignore", invalid="ignore"):
                g = (num / den - 1) * 100
            out[f"{k}g{a}"] = np.where((n < min_n) | (den <= 0), np.nan, g)
    return out


def _hist_stats(s: np.ndarray) -> dict:
    v = s[np.isfinite(s)]
    if len(v) < 24 or not np.isfinite(s[-1]):
        return {}
    last = s[-1]
    return {"avg10": float(v.mean()), "pct10": float((v <= last).sum() - 1) / (len(v) - 1) * 100,
            "z10": float((last - v.mean()) / v.std()) if v.std() > 0 else np.nan}


def build(d: pd.DataFrame, ts, as_of: str | None = None, source: str = "") -> dict:
    """d: engine.run 결과 (out/stocks.csv 와 같은 열), ts: TimeSeries (월간 10년 시트 포함)."""
    if ts is None or ts.ri_m is None or ts.ri_m.empty or ts.sal is None or ts.sal.empty:
        raise SystemExit("월간 10년 시트(Price_(Monthly_10Y)·EPS·BPS·DPS·SALE)가 필요합니다.")
    d = d[d["code"].notna()].drop_duplicates("code").reset_index(drop=True)
    cl = classify(d)
    d = d.set_index("code").loc[cl["code"]].reset_index()
    P, info = _stock_panels(d, ts)
    defs = _group_defs(cl)
    M = np.stack([g["mask"] for g in defs], axis=1).astype(float)
    sizes = M.sum(axis=0)
    A = aggregate(P, M, sizes)
    Y = snapshot_cy(P, M, sizes)
    wtot = np.nansum(P["w"])
    months = info["months"]
    keys = [m[0] for m in METRICS]

    groups, series, rows, long = [], {}, [], []
    for j, g in enumerate(defs):
        snap = {k: _c(Y[k][j], 4) for k in Y}
        codes = cl.loc[g["mask"], ["code", "wgt"]].sort_values("wgt", ascending=False)["code"].tolist()
        extra, w = {}, _c(np.nansum(P["w"][g["mask"]]) / wtot * 100, 4)
        groups.append({"id": g["id"], "dim": g["dim"], "scope": g["scope"], "key": g["key"], "label": g["label"],
                       **({"desc": g["desc"]} if "desc" in g else {}),
                       "n": int(sizes[j]), "w": w,
                       "cy": {k: v for k, v in snap.items() if v is not None}, "codes": codes, **extra})
        series[g["id"]] = {k: [_c(x) for x in A[k][:, j]] for k in keys + ["cov"]}
        series[g["id"]]["n"] = [int(x) for x in A["n"][:, j]]
        row = {"id": g["id"], "dim": g["dim"], "scope": g["scope"] or "", "label": g["label"], "n": int(sizes[j]),
               "acwi_w": groups[-1]["w"], **{f"cy_{k}": v for k, v in snap.items()}}
        for k in keys:
            s = A[k][:, j]
            row[k] = _c(s[-1])
            if k != "tr":
                for sk, sv in _hist_stats(s).items():
                    row[f"{k}_{sk}"] = _c(sv)
        rows.append(row)
        for i, m in enumerate(months):
            long.append([g["id"], g["label"], m, *[A[k][i, j] for k in keys], A["cov"][i, j]])

    OUT.mkdir(parents=True, exist_ok=True)
    out_cl = cl.drop(columns=["wgt"]).assign(themes=cl["themes"].map(
        lambda ks: " / ".join(T.THEMES[k]["label"] for k in ks)), acwi_w_pct=cl["wgt"] * 100)
    out_cl.to_csv(OUT / "classification.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(rows).to_csv(OUT / "latest.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(long, columns=["id", "label", "month", *keys, "cov"]).round(4).to_csv(
        OUT / "series_long.csv", index=False, encoding="utf-8-sig")

    meta = {
        "built_at": dt.datetime.now().isoformat(timespec="seconds"), "as_of": as_of or months[-1], "source": source,
        "months": months, "n_stocks": int(len(cl)),
        "metrics": [{"key": k, "label": l, "unit": u, "desc": de, "dir": di} for k, l, u, de, di in METRICS],
        "dims": [{"key": "region", "label": "지역"}, {"key": "country", "label": "국가"},
                 {"key": "sector", "label": "섹터"}, {"key": "igroup", "label": "산업그룹"},
                 {"key": "industry", "label": "산업"}, {"key": "theme", "label": "테마"}],
        "sector_scopes": SECTOR_SCOPES,
        "themes": [{"key": k, "label": t["label"], "desc": t.get("desc", "")} for k, t in T.THEMES.items()],
        "quality": {k: v for k, v in info.items() if k != "months"} | {
            "theme_missing_codes": cl.attrs["theme_missing"],
            "no_theme_share_pct": _c((cl["themes"].map(len) == 0).mean() * 100, 3)},
    }
    web = {"meta": meta, "groups": groups, "series": series,
           "stocks": {r.code: {"ig": r.igroup, "th": r.themes} for r in cl.itertuples() if r.themes or r.igroup}}
    js = "window.GROUPS = " + json.dumps(web, ensure_ascii=False, separators=(",", ":")) + ";\n"
    WEB.mkdir(parents=True, exist_ok=True)
    (WEB / "groups_data.js").write_text(js, encoding="utf-8")
    meta["size_js_mb"] = round(len(js.encode()) / 1e6, 2)
    meta["n_groups"] = len(groups)
    return meta


def main():
    ap = argparse.ArgumentParser(description="ACWI 국가·섹터·테마별 10년 밸류에이션 집계")
    ap.add_argument("--stocks", default=str(ROOT / "out" / "stocks.csv"), help="engine 결과 (build/analyzer 가 만든 것)")
    ap.add_argument("--xlsx", default=str(ROOT / "data" / "ACWI_v3.xlsx"), help="시계열 시트가 있는 원자료 (캐시 키)")
    ap.add_argument("--as-of", default=None)
    a = ap.parse_args()
    from .timeseries import load_timeseries
    d = pd.read_csv(a.stocks, encoding="utf-8-sig")
    ts = load_timeseries(a.xlsx)
    meta = build(d, ts, a.as_of, Path(a.xlsx).name)
    q = meta["quality"]
    print(json.dumps({k: meta[k] for k in ("as_of", "n_stocks", "n_groups", "size_js_mb")} | {
        "breaks": {k: v for k, v in q.items() if k.endswith("_breaks")},
        "no_theme_share_pct": q["no_theme_share_pct"], "theme_missing_codes": q["theme_missing_codes"]},
        ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

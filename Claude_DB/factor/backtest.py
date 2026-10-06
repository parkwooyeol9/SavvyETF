"""ACWI 10년 팩터 백테스트 — 월간 리밸런싱, MSCI 편출입 이력(PIT) 반영.

    python -m Claude_DB.factor.backtest --xlsx Claude_DB/data/ACWI_v3.xlsx
      → out/backtest/*.csv, web/backtest_data.js (window.BACKTEST)

입력
  - 월간 시계열 (timeseries.TimeSeries): ri_m(X(RI) 10년), eps/bps/dps/sal(12M 선행, 보고통화)
  - 현재 스냅샷 (engine.run): 섹터·지역·국가, USD 주가·시총·추정치 → 과거 수준을 '지금 값 × 상대변화'로 복원
  - 시점별 ACWI 구성 (index_monitor acwi_membership_intervals.csv, ISIN)

시점 t (매월 1일, Datastream 월간 날짜)의 신호는 t 까지의 값만 쓴다. 수익률은 RI_{t+1}/RI_t − 1 (현지통화, 배당 포함).

과거 주가 수준 복원 (`price_relative`)
  RI 는 배당 재투자라 주가와 다르다. P_t = P_{t+1} × RI_t/RI_{t+1} × (1 + dy_{t+1}/12) 로 거꾸로 쌓는다.
  dy_t = DPS_t × k / P_t, k 는 지금 배당수익률이 스냅샷과 같아지게 맞춘 상수. P_now = 1.
  과거 E/P = EPS_t × fx_k / (USD주가_now × P_t),  fx_k = (USD 추정치_now ÷ 보고통화 추정치_now) — 지금 환율로 고정.

신호 (원값 → 매월 1/99% 윈저 → 섹터×지역 중립 Z(±3) → 팩터 = 디스크립터 Z 평균 → 다시 중립 Z)
  가치   E/P, B/P                    (FCF 수익률은 과거 시계열 없음)
  사이즈 −ln(시총_t),  시총_t = 시총_now × P_t   (주식 수 불변 가정)
  배당   배당수익률, DPS 12M 변화
  성장   EPS NTM 12M 변화율, 매출 NTM 12M 변화율
  모멘텀 12-1M 총수익(국가 중앙값 대비), EPS 3M 리비전(ΔEPS/주가)
  퀄리티 ROE(=EPS/BPS, NTM), −변동성(월간수익률 24개월)   (D/E 과거 시계열 없음)
  종합   6개 팩터 동일가중 (현재 모델과 같은 구성, 위 대체 디스크립터 사용)

유니버스
  pit    : 그 달에 ACWI 구성이었던 종목만 (편입 전·편출 후 제외) ← 기본
  pit_large : pit 중 그 달 지역별 시총 상위 50% (편출 누락이 적은 대형·중형 — 생존 편향이 덜한 비교군)
  static : 지금 파일 종목 전부 (편입 시점 look-ahead 포함) — 차이를 보여주는 비교용
  두 경우 모두 2026-02 이전에 편출된 종목은 파일에 없어 빠진다(생존 편향 잔존). coverage 로 비율 표시.

결과 (모드 × 지역 × 신호): 5분위 동일가중 수익률, 롱숏(Q1−Q5), Q1 회전율, 월별 IC(스피어만), 종목 수.
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

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "backtest"
WEB = ROOT / "web"
REGIONS = ["전체", "미국", "선진(미국 외)", "신흥"]
NQ = 5

FACTORS = {   # 팩터 → [(디스크립터, 방향, 설명)]
    "value": ("가치", [("ep", 1, "Fwd E/P"), ("bp", 1, "Fwd B/P")]),
    "size": ("사이즈", [("neg_ln_mcap", 1, "−ln 시총")]),
    "dividend": ("배당", [("dy", 1, "Fwd 배당수익률"), ("dps_g12", 1, "DPS NTM 12M 변화")]),
    "growth": ("성장", [("eps_g12", 1, "EPS NTM 12M 변화"), ("sal_g12", 1, "매출 NTM 12M 변화")]),
    "momentum": ("모멘텀", [("mom_rel", 1, "12-1M 국가상대"), ("rev3_p", 1, "EPS 3M 리비전(ΔEPS/P)")]),
    "quality": ("퀄리티", [("roe", 1, "ROE (EPS/BPS)"), ("neg_vol24", 1, "−변동성 24M")]),
}
DESC_LABEL = {d: l for _, (_, ds) in FACTORS.items() for d, _, l in ds}
PRESETS = {   # 종합 조합 (팩터 가중치)
    "composite": ("종합 (6팩터 동일)", {k: 1 for k in FACTORS}),
    "comp_ex_size": ("종합 (사이즈 제외)", {k: (0 if k == "size" else 1) for k in FACTORS}),
    "value_mom": ("가치+모멘텀", {"value": 1, "momentum": 1}),
    "quality_mom": ("퀄리티+모멘텀", {"quality": 1, "momentum": 1}),
    "value_quality": ("가치+퀄리티", {"value": 1, "quality": 1}),
}


# ───────────────────────── 1. 과거 수준 복원 ─────────────────────────
def _last_valid(df: pd.DataFrame) -> pd.Series:
    return df.ffill().iloc[-1]


def price_relative(ri: pd.DataFrame, dps: pd.DataFrame, dy_now: pd.Series) -> pd.DataFrame:
    """P_t / P_now (현지통화, 배당 제외 주가 상대값). ri·dps 는 같은 월간 인덱스."""
    ri = ri.ffill(limit=1)
    dps = dps.reindex_like(ri).ffill(limit=2)
    T = len(ri)
    R = ri.to_numpy(dtype=float)
    D = dps.to_numpy(dtype=float)
    dyn = (dy_now.reindex(ri.columns).fillna(0).clip(0, 20) / 100).to_numpy()
    dps_now = _last_valid(dps).to_numpy(dtype=float)
    k = np.where((dps_now > 0) & np.isfinite(dps_now), dyn / np.where(dps_now > 0, dps_now, np.nan), 0.0)
    k = np.nan_to_num(k)
    P = np.full_like(R, np.nan)
    last = np.where(np.isfinite(R[-1]), 1.0, np.nan)
    P[-1] = last
    for t in range(T - 2, -1, -1):
        dy_next = np.clip(np.nan_to_num(D[t + 1] * k / P[t + 1]), 0, 0.3)
        P[t] = P[t + 1] * (R[t] / R[t + 1]) * (1 + dy_next / 12)
    return pd.DataFrame(P, index=ri.index, columns=ri.columns)


def fx_factor(snap: pd.DataFrame, ts) -> pd.Series:
    """보고통화 추정치 → USD 환산 계수 (지금 시점). EPS → BPS → 매출 → DPS 순으로 0 아닌 것."""
    out = pd.Series(np.nan, index=snap.index)
    for usd_col, df in (("eps_ntm", ts.eps), ("bps_ntm", ts.bps), ("sales_ntm", getattr(ts, "sal", None)),
                        ("dps_ntm", ts.dps)):
        if df is None or df.empty or usd_col not in snap:
            continue
        loc = _last_valid(df).reindex(snap.index)
        usd = snap[usd_col]
        if usd_col == "sales_ntm":   # 매출 USD 열은 단위가 시장마다 달라(백만/십억) EPS·BPS 가 없을 때만
            continue
        r = (usd / loc).where((loc.abs() > 0) & (usd.abs() > 0) & np.sign(usd).eq(np.sign(loc)))
        out = out.fillna(r)
    return out


# ───────────────────────── 2. 신호 패널 ─────────────────────────
def build_signals(ts, snap: pd.DataFrame) -> tuple[dict[str, pd.DataFrame], pd.DataFrame, dict]:
    """snap: index=code, 열 sector·region·country·px_usd·mcap_usd_mn·dy·eps_ntm·bps_ntm·dps_ntm.
    반환: (디스크립터 원값 dict, 월간 선행수익률 T×N, 진단)"""
    codes = [c for c in snap.index if c in ts.ri_m.columns]
    snap = snap.loc[codes]
    ri = ts.ri_m[codes].ffill(limit=1)
    idx = ri.index
    eps, bps, dps = (x.reindex(index=idx, columns=codes) for x in (ts.eps, ts.bps, ts.dps))
    sal = ts.sal.reindex(index=idx, columns=codes) if getattr(ts, "sal", None) is not None and not ts.sal.empty else None
    prel = price_relative(ri, dps, snap["dy"])
    fx = fx_factor(snap, ts)
    px_t = prel.mul(snap["px_usd"], axis=1)                       # 과거 USD 주가 (지금 환율 기준)
    sig: dict[str, pd.DataFrame] = {}
    sig["ep"] = eps.mul(fx, axis=1) / px_t
    sig["bp"] = (bps.mul(fx, axis=1) / px_t).where(bps > 0)
    sig["dy"] = (dps.mul(fx, axis=1) / px_t).where(dps >= 0)
    sig["neg_ln_mcap"] = -np.log(prel.mul(snap["mcap_usd_mn"], axis=1).where(lambda x: x > 0))
    sig["dps_g12"] = (dps / dps.shift(12) - 1).where((dps > 0) & (dps.shift(12) > 0))
    sig["eps_g12"] = (eps / eps.shift(12) - 1).where((eps > 0) & (eps.shift(12) > 0))
    if sal is not None:
        sig["sal_g12"] = (sal / sal.shift(12) - 1).where((sal > 0) & (sal.shift(12) > 0))
    mom = ri.shift(1) / ri.shift(12) - 1
    country = snap["country"].reindex(codes)
    region = snap["region"].reindex(codes)
    cnt = country.map(country.value_counts())
    grp = country.where(cnt >= 2, region)
    med = mom.T.groupby(grp).transform("median").T
    sig["mom_rel"] = (1 + mom) / (1 + med) - 1
    sig["rev3_p"] = (eps - eps.shift(3)).mul(fx, axis=1) / px_t
    sig["roe"] = (eps / bps).where(bps > 0)
    r = ri.pct_change(fill_method=None).clip(-0.8, 2)
    sig["neg_vol24"] = -r.rolling(24, min_periods=12).std() * np.sqrt(12)
    fwd = (ri.shift(-1) / ri - 1).clip(-0.95, 3.0)
    diag = {"fx_found": int(fx.notna().sum()), "n_codes": len(codes),
            "fx_eps_bps_consistency_med": float(((snap["eps_ntm"] / _last_valid(eps).reindex(codes)) /
                                                 (snap["bps_ntm"] / _last_valid(bps).reindex(codes))).median())}
    return sig, fwd, diag


# ───────────────────────── 3. 횡단면 표준화 ─────────────────────────
def _neutral_z(x: pd.Series, grp: pd.Series, sector: pd.Series) -> pd.Series:
    """한 달 횡단면: 1/99% 윈저 → 섹터×지역 Z (그룹<10 이면 섹터, 섹터<5 면 전체) → ±3."""
    v = x.dropna()
    if len(v) < 30:
        return pd.Series(np.nan, index=x.index)
    w = x.clip(v.quantile(C.WINSOR[0]), v.quantile(C.WINSOR[1]))
    g = w.groupby(grp)
    mu, sd, n = grp.map(g.mean()), grp.map(g.std()), grp.map(g.count()).fillna(0)
    gs = w.groupby(sector)
    small = n < C.MIN_GROUP_N
    mu = mu.where(~small, sector.map(gs.mean()))
    sd = sd.where(~small, sector.map(gs.std()))
    n = n.where(~small, sector.map(gs.count()).fillna(0))
    tiny = n < C.MIN_SECTOR_N
    mu = mu.where(~tiny, w.mean())
    sd = sd.where(~tiny, w.std()).replace(0, np.nan)
    return ((w - mu) / sd).clip(-C.Z_CLIP, C.Z_CLIP)


def factor_panels(sig: dict, univ: pd.DataFrame, snap: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """유니버스 마스크(T×N bool) 안에서 매월 디스크립터·팩터·종합 Z."""
    codes = univ.columns
    sector = snap["sector"].reindex(codes)
    grp = sector + "|" + snap["region"].reindex(codes)
    out = {k: pd.DataFrame(np.nan, index=univ.index, columns=codes) for k in list(FACTORS) + list(PRESETS)}
    desc_z = {d: pd.DataFrame(np.nan, index=univ.index, columns=codes) for d in DESC_LABEL if d in sig}
    for t in univ.index:
        m = univ.loc[t]
        if m.sum() < 50:
            continue
        cs = codes[m.to_numpy()]
        g, s = grp[cs], sector[cs]
        fz = {}
        for fk, (_, ds) in FACTORS.items():
            zs = []
            for d, sign, _ in ds:
                if d not in sig:
                    continue
                z = _neutral_z(sig[d].loc[t, cs] * sign, g, s)
                desc_z[d].loc[t, cs] = z
                zs.append(z)
            if not zs:
                continue
            raw = pd.concat(zs, axis=1).mean(axis=1, skipna=True)
            f = _neutral_z(raw, g, s)
            fz[fk] = f.fillna(0.0).where(raw.notna())      # 디스크립터 전부 결측이면 결측 (현재 모델은 0)
            out[fk].loc[t, cs] = fz[fk]
        for pk, (_, wts) in PRESETS.items():
            tw = sum(wts.values())
            comb = sum(fz[k].fillna(0) * w for k, w in wts.items() if w and k in fz) / tw
            avail = sum(fz[k].notna().astype(int) for k, w in wts.items() if w and k in fz)
            comb = comb.where(avail >= max(1, int(math.ceil(sum(1 for w in wts.values() if w) / 2))))
            out[pk].loc[t, cs] = (comb - comb.mean()) / comb.std()
    out.update({f"d_{k}": v for k, v in desc_z.items()})
    return out


# ───────────────────────── 4. 포트폴리오 ─────────────────────────
def _spearman(a: pd.Series, b: pd.Series) -> float:
    m = a.notna() & b.notna()
    if m.sum() < 30:
        return np.nan
    return float(a[m].rank().corr(b[m].rank()))


def quintile_backtest(score: pd.DataFrame, fwd: pd.DataFrame, univ: pd.DataFrame, nq: int = NQ) -> dict:
    """매월 score 상위→하위 nq 분위 동일가중. Q1 = 점수 최상위."""
    dates = score.index[:-1]
    q_ret = np.full((nq, len(dates)), np.nan)
    ic, n, turn = [], [], []
    prev_top: set = set()
    for i, t in enumerate(dates):
        s = score.loc[t].where(univ.loc[t])
        f = fwd.loc[t]
        m = s.notna() & f.notna()
        if m.sum() < nq * 10:
            ic.append(np.nan); n.append(int(m.sum())); turn.append(np.nan); prev_top = set()
            continue
        ss, ff = s[m], f[m]
        rk = ss.rank(ascending=False, method="first")
        bucket = np.ceil(rk / len(ss) * nq).clip(1, nq).astype(int)
        for q in range(1, nq + 1):
            q_ret[q - 1, i] = ff[bucket == q].mean()
        top = set(ss.index[bucket == 1])
        turn.append(len(top - prev_top) / len(top) if prev_top else np.nan)
        prev_top = top
        ic.append(_spearman(ss, ff))
        n.append(int(m.sum()))
    return {"q": q_ret, "ic": np.array(ic, dtype=float), "n": np.array(n), "to": np.array(turn, dtype=float)}


def bench_returns(fwd: pd.DataFrame, univ: pd.DataFrame, mcap_t: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    dates = fwd.index[:-1]
    ew, cw = [], []
    for t in dates:
        m = univ.loc[t] & fwd.loc[t].notna()
        f = fwd.loc[t][m]
        ew.append(f.mean() if len(f) else np.nan)
        w = mcap_t.loc[t][m].clip(lower=0).fillna(0)
        cw.append(float((f * w).sum() / w.sum()) if w.sum() > 0 else np.nan)
    return np.array(ew), np.array(cw)


def stats(r: np.ndarray, bench: np.ndarray | None = None) -> dict:
    r = np.asarray(r, dtype=float)
    ok = np.isfinite(r)
    if ok.sum() < 12:
        return {}
    rr = r[ok]
    lvl = np.cumprod(1 + rr)
    yrs = len(rr) / 12
    out = {"cagr": (lvl[-1] ** (1 / yrs) - 1) * 100, "vol": rr.std(ddof=1) * math.sqrt(12) * 100,
           "mdd": float(((lvl / np.maximum.accumulate(lvl)) - 1).min() * 100),
           "hit": float((rr > 0).mean() * 100), "best": float(rr.max() * 100), "worst": float(rr.min() * 100),
           "months": int(len(rr))}
    out["sharpe"] = out["cagr"] / out["vol"] if out["vol"] else np.nan
    if bench is not None:
        b = np.asarray(bench, dtype=float)
        m = ok & np.isfinite(b)
        ex = r[m] - b[m]
        te = ex.std(ddof=1) * math.sqrt(12) * 100
        out.update({"excess": ex.mean() * 12 * 100, "te": te, "ir": (ex.mean() * 12 * 100) / te if te else np.nan,
                    "hit_vs_bench": float((ex > 0).mean() * 100)})
    return out


def ic_stats(ic: np.ndarray) -> dict:
    v = ic[np.isfinite(ic)]
    if len(v) < 12:
        return {}
    sd = v.std(ddof=1)
    return {"ic_mean": float(v.mean()), "ic_sd": float(sd), "icir": float(v.mean() / sd * math.sqrt(12)) if sd else np.nan,
            "ic_t": float(v.mean() / sd * math.sqrt(len(v))) if sd else np.nan, "ic_hit": float((v > 0).mean() * 100)}


# ───────────────────────── 5. 유니버스 ─────────────────────────
def membership_mask(dates: pd.DatetimeIndex, snap: pd.DataFrame, iv: pd.DataFrame) -> pd.DataFrame:
    """ISIN 으로 매칭한 구성 구간 [start, end) 이 t 를 포함하면 True. ISIN 매칭 없는 종목은 False(보수적)."""
    codes = snap.index
    mask = pd.DataFrame(False, index=dates, columns=codes)
    iv = iv[iv["isin"].fillna("") != ""]
    by = {k: g for k, g in iv.groupby("isin")}
    for c, isin in snap["isin"].items():
        g = by.get(isin)
        if g is None:
            continue
        m = np.zeros(len(dates), dtype=bool)
        for s, e in zip(pd.to_datetime(g["start"]), pd.to_datetime(g["end"])):
            m |= ((pd.isna(s)) | (dates >= s)) & ((pd.isna(e)) | (dates < e))
        mask[c] = m
    return mask


# ───────────────────────── 6. 실행 ─────────────────────────
def _arr(a, sig=5):
    out = []
    for x in np.asarray(a, dtype=float):
        out.append(None if not np.isfinite(x) else float(f"{x:.{sig}g}"))
    return out


def _clean(o):
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if not math.isfinite(float(o)) else float(f"{float(o):.5g}")
    if isinstance(o, (np.integer,)):
        return int(o)
    return o


def run(xlsx: Path, start: str = "2017-10-01", lag: int = 0) -> dict:
    from . import engine as E
    from . import index_link as L
    d, _, excluded, raw = E.run(str(xlsx))
    ts = E.TS_EXTRAS.get("ts")
    if ts is None or ts.ri_m.empty:
        raise SystemExit("월간 10년 시계열(Price_(Monthly_10Y)) 시트가 없습니다.")
    snap = d.set_index("code")
    snap = snap[~snap.index.duplicated()]
    snap["isin"] = snap["isin"].fillna("")
    sig, fwd, diag = build_signals(ts, snap)
    codes = list(fwd.columns)
    snap = snap.loc[codes]
    if lag:
        sig = {k: v.shift(lag) for k, v in sig.items()}
    pit = L.rebuild(None)
    iv = pit["iv"]
    dates = fwd.index
    has_data = ts.ri_m[codes].reindex(dates).ffill(limit=1).notna()
    univ = {"pit": membership_mask(dates, snap, iv) & has_data, "static": has_data.copy()}
    t0 = pd.Timestamp(start)
    for k in univ:
        univ[k].loc[univ[k].index < t0] = False
    prel = price_relative(ts.ri_m[codes].reindex(dates), ts.dps.reindex(index=dates, columns=codes), snap["dy"])
    mcap_t = prel.mul(snap["mcap_usd_mn"], axis=1)
    # pit_large: PIT 구성 중 그 달 지역별 시총 상위 50% — 편출 종목 누락(생존 편향)은 주로 소형주에서 생기므로 덜 오염된 비교군
    reg_row = snap["region"].reindex(codes)
    big = pd.DataFrame(False, index=dates, columns=codes)
    for t in dates:
        m = univ["pit"].loc[t]
        if m.sum() == 0:
            continue
        mc = mcap_t.loc[t].where(m)
        pr = mc.groupby(reg_row).rank(pct=True)
        big.loc[t] = (pr > 0.5).to_numpy()
    univ = {"pit": univ["pit"], "pit_large": univ["pit"] & big, "static": univ["static"]}
    keep = dates[dates >= t0]
    signals = list(FACTORS) + list(PRESETS) + [f"d_{x}" for x in DESC_LABEL if x in sig]
    res: dict = {}
    corr_ls: dict = {}
    for mode, U in univ.items():
        panels = factor_panels(sig, U, snap)
        res[mode] = {}
        for reg in REGIONS:
            Ur = U if reg == "전체" else U & snap["region"].reindex(codes).eq(reg)
            ew, cw = bench_returns(fwd.loc[keep], Ur.loc[keep], mcap_t.loc[keep])
            entry = {"bench_ew": _arr(ew), "bench_cw": _arr(cw), "bench_ew_stats": stats(ew), "bench_cw_stats": stats(cw),
                     "n": [], "sig": {}}
            for sk in signals:
                if sk not in panels:
                    continue
                qb = quintile_backtest(panels[sk].loc[keep], fwd.loc[keep], Ur.loc[keep])
                ls = qb["q"][0] - qb["q"][-1]
                entry["sig"][sk] = {
                    "q": [_arr(x) for x in qb["q"]], "ls": _arr(ls), "ic": _arr(qb["ic"], 3), "to": _arr(qb["to"], 3),
                    "stats_q": [stats(x, ew) for x in qb["q"]], "stats_ls": stats(ls), "ic_stats": ic_stats(qb["ic"]),
                    "to_mean": float(np.nanmean(qb["to"])) if np.isfinite(qb["to"]).any() else None,
                    "spread_mono": float(np.mean([np.nanmean(qb["q"][i]) > np.nanmean(qb["q"][i + 1]) for i in range(NQ - 1)])),
                }
                if not entry["n"]:
                    entry["n"] = [int(x) for x in qb["n"]]
                if mode == "pit" and reg == "전체" and sk in FACTORS:
                    corr_ls[sk] = ls
            res[mode][reg] = entry
    # 팩터 롱숏 수익률 상관
    fk = list(corr_ls)
    cm = pd.DataFrame({k: corr_ls[k] for k in fk}).corr().round(2)
    # 커버리지: 파일 종목 중 PIT 구성 ÷ 재구성 구성종목 수(상한·확정)
    counts = pit["counts"].copy()
    counts["effective"] = pd.to_datetime(counts["effective"])
    cov = []
    for t in keep[:-1]:
        c = counts[counts["effective"] <= t].tail(1)
        cov.append({"date": str(t.date()), "n_pit": int(univ["pit"].loc[t].sum()), "n_static": int(univ["static"].loc[t].sum()),
                    "n_pit_large": int(univ["pit_large"].loc[t].sum()),
                    "members_upper": int(c["members_after"].iloc[0]) if len(c) else None,
                    "members_confirmed": int(c["confirmed_after"].iloc[0]) if len(c) else None})
    payload = {
        "meta": {"built_at": dt.datetime.now().isoformat(timespec="seconds"), "source": Path(xlsx).name,
                 "start": str(keep[0].date()), "end": str(keep[-1].date()), "n_months": int(len(keep) - 1),
                 "lag_months": lag, "nq": NQ, "currency": "현지통화 총수익(RI)", "rebalance": "월간 (매월 1일 기준)",
                 "diag": diag, "regions": REGIONS},
        "dates": [str(t.date()) for t in keep[:-1]],
        "signals": ([{"key": k, "label": v[0], "kind": "factor", "desc": [x[2] for x in v[1]]} for k, v in FACTORS.items()]
                    + [{"key": k, "label": v[0], "kind": "preset", "weights": v[1]} for k, v in PRESETS.items()]
                    + [{"key": f"d_{x}", "label": DESC_LABEL[x], "kind": "descriptor"} for x in DESC_LABEL if x in sig]),
        "results": res,
        "factor_corr": {"keys": fk, "labels": [FACTORS[k][0] for k in fk], "m": cm.values.tolist()},
        "coverage": cov,
    }
    return _clean(payload)


def summary_table(payload: dict) -> pd.DataFrame:
    rows = []
    for mode, regs in payload["results"].items():
        for reg, e in regs.items():
            for sk, r in e["sig"].items():
                st, ic = r["stats_ls"] or {}, r["ic_stats"] or {}
                q1 = (r["stats_q"] or [{}])[0] or {}
                rows.append({"mode": mode, "region": reg, "signal": sk, "ls_cagr": st.get("cagr"), "ls_vol": st.get("vol"),
                             "ls_sharpe": st.get("sharpe"), "ls_mdd": st.get("mdd"), "q1_cagr": q1.get("cagr"),
                             "q1_excess": q1.get("excess"), "q1_ir": q1.get("ir"), "ic_mean": ic.get("ic_mean"),
                             "icir": ic.get("icir"), "ic_t": ic.get("ic_t"), "turnover": r.get("to_mean"),
                             "monotonic": r.get("spread_mono")})
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description="ACWI 10년 팩터 백테스트")
    ap.add_argument("--xlsx", default=str(ROOT / "data" / "ACWI_v3.xlsx"))
    ap.add_argument("--start", default="2017-10-01")
    ap.add_argument("--lag", type=int, default=0, help="신호 지연(개월). 1 = 한 달 늦게 반영해 보수적으로")
    a = ap.parse_args()
    payload = run(Path(a.xlsx).expanduser(), a.start, a.lag)
    OUT.mkdir(parents=True, exist_ok=True)
    tab = summary_table(payload)
    tab.to_csv(OUT / "summary.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(payload["coverage"]).to_csv(OUT / "coverage.csv", index=False, encoding="utf-8-sig")
    js = "window.BACKTEST = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (WEB / "backtest_data.js").write_text(js, encoding="utf-8")
    (OUT / "backtest_payload.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    show = tab[(tab["region"] == "전체") & tab["signal"].isin(list(FACTORS) + list(PRESETS))]
    print(show.round(2).to_string(index=False))
    from .analyzer import write_standalone
    write_standalone()                      # 분석기 단일 파일에 백테스트 탭 데이터도 넣기
    print(f"→ web/backtest_data.js {len(js.encode()) / 1e6:.2f}MB, out/backtest/, out/analyzer_standalone.html")


if __name__ == "__main__":
    main()

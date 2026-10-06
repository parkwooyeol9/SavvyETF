"""EPS·BPS·DPS 12개월 선행 추정치 월간 시계열 분석 + 역사적 밸류에이션 위치(근사).

시계열 통화 = 보고통화(I/B/E/S, ~U$ 아님). 같은 종목 안의 '변화율'만 쓰므로 통화는 상쇄된다.

지표
  eps_rev_1m/3m/6m/12m : EPS NTM 변화율 (%). 직전·현재 모두 양수일 때만, 아니면 결측
  eps_rev_dir_3m       : 부호 기준 방향 (+1/0/-1) — 적자 종목 포함 브레드스용
  eps_chg_24m          : 24개월 변화율
  bps_g_12m, dps_g_12m : 12개월 변화율
  dps_cuts_36m         : 36개월 동안 DPS 가 5% 이상 줄어든 달 수 (배당 안정성)
  pe_hist, pb_hist, dy_hist : 월별 근사 P/E·P/B·배당수익률 (현재값 × 가격/추정치 상대변화)
  pe_pct_3y, pb_pct_3y, dy_pct_3y : 3년 분포 안에서 현재 위치 (0=최저, 100=최고)
  pe_z_3y              : (현재 - 3년 평균)/표준편차

근사 방식: P_t/P_now ≈ (RI_t/RI_now) × (1+dy)^(경과연수)  — RI 의 배당 재투자분을 현재 배당수익률로 되돌림.
가격(현지통화)과 추정치(보고통화)가 다른 종목은 환율 변동만큼 오차가 남는다(셸·HSBC 등).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _chg(df: pd.DataFrame, k: int) -> pd.Series:
    if len(df) <= k:
        return pd.Series(np.nan, index=df.columns)
    a, b = df.iloc[-1], df.iloc[-1 - k]
    return ((a / b - 1) * 100).where((a > 0) & (b > 0))


def _month_price(ri: pd.DataFrame, months: pd.DatetimeIndex) -> pd.DataFrame:
    """월 시계열 날짜(매월 1일)에 맞춰 직전 거래일 RI."""
    px = ri.ffill()
    pos = px.index.searchsorted(months, side="right") - 1
    pos = np.clip(pos, 0, len(px) - 1)
    out = px.iloc[pos].copy()
    out.index = months
    out[months < px.index[0]] = np.nan
    return out


def _pct_rank_last(hist: pd.DataFrame, min_n: int = 18) -> pd.Series:
    h = hist.replace([np.inf, -np.inf], np.nan)
    last = h.iloc[-1]
    rank = (h.le(last, axis=1).sum() - 1) / (h.notna().sum() - 1).replace(0, np.nan) * 100
    return rank.where(h.notna().sum() >= min_n)


def compute(ts, cur: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """cur: 현재 스냅샷 (index=code, 열 pe, pb, dy[%]). 반환: (지표, 차트용 월별 시계열 dict)."""
    eps, bps, dps = ts.eps, ts.bps, ts.dps
    codes = ts.ri.columns
    out = pd.DataFrame(index=codes)
    if eps.empty:
        return out, {}
    eps, bps, dps = (x.reindex(columns=codes) for x in (eps, bps, dps))
    for k in (1, 3, 6, 12):
        out[f"eps_rev_{k}m"] = _chg(eps, k)
    out["eps_rev_dir_3m"] = np.sign(eps.iloc[-1] - eps.iloc[-4]).where(eps.iloc[-1].notna() & eps.iloc[-4].notna())
    out["eps_rev_dir_1m"] = np.sign(eps.iloc[-1] - eps.iloc[-2]).where(eps.iloc[-1].notna() & eps.iloc[-2].notna())
    out["eps_chg_24m"] = _chg(eps, 24)
    out["bps_g_12m"] = _chg(bps, 12)
    out["dps_g_12m"] = _chg(dps, 12)
    d36 = dps.iloc[-37:]
    out["dps_cuts_36m"] = ((d36 / d36.shift(1) - 1) < -0.05).sum().where(d36.notna().sum() >= 24)
    out["eps_neg_now"] = (eps.iloc[-1] <= 0).where(eps.iloc[-1].notna())
    sal = getattr(ts, "sal", pd.DataFrame())
    if sal is not None and not sal.empty:
        sal = sal.reindex(columns=codes)
        for k in (1, 3, 12):
            out[f"sal_rev_{k}m"] = _chg(sal, k)
        out["sal_rev_dir_3m"] = np.sign(sal.iloc[-1] - sal.iloc[-4]).where(sal.iloc[-1].notna() & sal.iloc[-4].notna())
    if len(eps) >= 61:
        out["eps_cagr_5y"] = ((eps.iloc[-1] / eps.iloc[-61]) ** (1 / 5) - 1).where((eps.iloc[-1] > 0) & (eps.iloc[-61] > 0)) * 100

    # ── 역사적 밸류에이션 (근사) ──
    months = eps.index
    ri_m = getattr(ts, "ri_m", pd.DataFrame())
    if ri_m is not None and not ri_m.empty:          # 월간 10년 RI 가 있으면 그걸로 (일간 3년은 앞 7년이 비어 있음)
        pm = ri_m.reindex(columns=codes).ffill(limit=1)
        pm = pm.reindex(months, method="ffill")
    else:
        pm = _month_price(ts.ri, months)
    cur = cur.reindex(codes)
    yrs = (months[-1] - months).days.to_numpy()[:, None] / 365.25
    dy_now = (cur["dy"].fillna(0).clip(0, 20) / 100).to_numpy()[None, :]
    prel = (pm / pm.iloc[-1]) * (1 + dy_now) ** yrs              # P_t / P_now
    erel = eps / eps.iloc[-1]
    brel = bps / bps.iloc[-1]
    drel = dps / dps.iloc[-1]
    pe_h = (prel / erel).mul(cur["pe"], axis=1).where((eps > 0) & (eps.iloc[-1] > 0))
    pb_h = (prel / brel).mul(cur["pb"], axis=1).where((bps > 0) & (bps.iloc[-1] > 0))
    dy_h = (drel / prel).mul(cur["dy"], axis=1).where((dps >= 0) & (dps.iloc[-1] > 0))
    pe_h = pe_h.where((pe_h > 0) & (pe_h < 500))
    for name, h in (("pe", pe_h), ("pb", pb_h), ("dy", dy_h)):
        h3 = h.iloc[-37:]
        out[f"{name}_pct_3y"] = _pct_rank_last(h3)
        out[f"{name}_med_3y"] = h3.median()
        if len(h) >= 72:                                   # 10년 시계열(월간 121개)이 있을 때
            out[f"{name}_pct_10y"] = _pct_rank_last(h, min_n=60)
            out[f"{name}_med_10y"] = h.median().where(h.notna().sum() >= 60)
    p3 = pe_h.iloc[-37:]
    out["pe_z_3y"] = ((p3.iloc[-1] - p3.mean()) / p3.std()).where(p3.notna().sum() >= 18)
    charts = {"months": [d.strftime("%Y-%m") for d in months], "eps": eps, "bps": bps, "dps": dps,
              "pe": pe_h, "pb": pb_h, "dy": dy_h}
    if sal is not None and not sal.empty:
        charts["sal"] = sal
    if ri_m is not None and not ri_m.empty:
        charts["ri_m"] = ri_m.reindex(columns=codes).reindex(months, method="ffill")
    return out, charts


def breadth(df: pd.DataFrame, by: str) -> pd.DataFrame:
    """그룹별 EPS 리비전 브레드스(상향-하향 비율)와 기술적 지표 요약."""
    g = df.groupby(by)
    res = pd.DataFrame({
        "n": g.size(),
        "rev_breadth_1m": g["eps_rev_dir_1m"].apply(lambda s: s.dropna().mean() * 100),
        "rev_breadth_3m": g["eps_rev_dir_3m"].apply(lambda s: s.dropna().mean() * 100),
        "eps_rev_3m_med": g["eps_rev_3m"].median(),
        "above_ma200": g["px_ma200"].apply(lambda s: (s.dropna() > 0).mean() * 100),
        "above_ma50": g["px_ma50"].apply(lambda s: (s.dropna() > 0).mean() * 100),
        "golden": g["golden"].apply(lambda s: s.dropna().mean() * 100),
        "r_1m_med": g["r_1m"].median(), "r_3m_med": g["r_3m"].median(), "r_12m_med": g["r_12m"].median(),
        "rsi_med": g["rsi14"].median(),
        "pe_med": g["pe"].median(), "pe_pct_3y_med": g["pe_pct_3y"].median(),
        **({"pe_pct_10y_med": g["pe_pct_10y"].median()} if "pe_pct_10y" in df else {}),
        **({"sal_rev_3m_med": g["sal_rev_3m"].median()} if "sal_rev_3m" in df else {}),
        **({"vol_ratio_med": g["vol_ratio"].median()} if "vol_ratio" in df else {}),
        "dy_med": g["dy"].median(),
    })
    return res.sort_values("n", ascending=False)

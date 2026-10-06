"""종목별 기술적 지표 (일간 총수익지수 RI 기준, 현지통화).

RI 는 배당 재투자 지수라 주가 차트와 모양이 거의 같고(배당락 갭 없음), 수익률·추세 판단에 더 적합하다.
거래량·고가·저가가 없어서 거래량 지표·ATR·스토캐스틱은 계산하지 않는다.

지표 (모두 마지막 거래일 기준):
  수익률   r_1w r_1m r_3m r_6m r_12m r_ytd, mom_12_1(=t-21 ~ t-252, 복리)
  위험     vol_3m vol_1y (일간 로그수익률 SD×√252, %), mdd_1y, dd_52w(52주 고점 대비), up_52w_low
  추세     ma20/50/200 대비 괴리(%), ma50>ma200(골든), 최근 20일 내 골든/데드크로스
  오실레이터 rsi14(Wilder), macd_hist(12,26,9) 와 최근 10일 교차, bb_pctb(20,2σ)
  시장대비 beta_1y corr_1y (최근 104주 주간수익률, 벤치마크 = 유니버스 ACWI 비중가중 수익률, 현지통화 근사)
  suspended  최근 30거래일 중 20일 이상 가격 변화 없음 (거래정지 의심 → 기술적 지표 해석 주의)
  tech_score 0~6 = [종가>MA50, 종가>MA200, MA50>MA200, MACD>시그널, 40≤RSI≤70, 3M 수익률>0]
"""
from __future__ import annotations

import numpy as np
import pandas as pd

TD = {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "12m": 252}


def benchmark(ri: pd.DataFrame, weights: pd.Series) -> pd.Series:
    """비중가중 일간수익률 지수 (결측 종목은 그날 제외 후 재정규화)."""
    r = ri.pct_change(fill_method=None).clip(-0.5, 0.5)
    weights = weights[weights.index.notna() & ~weights.index.duplicated()]
    w = weights.reindex(ri.columns).fillna(0)
    m = r.notna().astype(float) * w
    br = (r.fillna(0) * w).sum(axis=1) / m.sum(axis=1).replace(0, np.nan)
    return (1 + br.fillna(0)).cumprod()


def _rsi(px: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    d = px.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)
    return rsi.where(dn != 0, 100.0)


def _last_cross_days(a: pd.DataFrame, b: pd.DataFrame, window: int) -> tuple[pd.Series, pd.Series]:
    """최근 window 일 안에 a 가 b 를 상향(+1)/하향(-1) 돌파했으면 그 방향과 경과일."""
    s = np.sign(a - b)
    ch = s.diff().iloc[-window:]
    direction = pd.Series(0, index=a.columns, dtype=int)
    ago = pd.Series(np.nan, index=a.columns)
    for k, (dt, row) in enumerate(ch.iterrows()):
        hit = row[row.abs() == 2]
        direction[hit.index] = np.sign(hit).astype(int)
        ago[hit.index] = window - 1 - k
    return direction, ago


def compute(ri: pd.DataFrame, weights: pd.Series | None = None) -> tuple[pd.DataFrame, pd.Series]:
    """반환: (종목별 지표 DataFrame index=code, 벤치마크 지수)."""
    px = ri.ffill(limit=5)                 # 휴장일 등 짧은 공백만 채움
    last = px.iloc[-1]
    out = pd.DataFrame(index=ri.columns)
    out["last_date"] = ri.apply(lambda s: s.last_valid_index())
    out["n_obs"] = ri.notna().sum()
    for k, n in TD.items():
        base = px.shift(n).iloc[-1]
        out[f"r_{k}"] = (last / base - 1) * 100
    ye = px[px.index <= pd.Timestamp(px.index[-1].year - 1, 12, 31)]
    out["r_ytd"] = (last / ye.iloc[-1] - 1) * 100 if len(ye) else np.nan
    out["mom_12_1"] = (px.shift(21).iloc[-1] / px.shift(252).iloc[-1] - 1) * 100

    lr = np.log(px / px.shift(1)).clip(-0.5, 0.5)
    lr = lr.where(lr != 0)                 # 변화 0 = 휴장 패딩으로 보고 제외 (정지 종목 변동성 과소 방지)
    out["vol_3m"] = lr.iloc[-63:].std() * np.sqrt(252) * 100
    out["vol_1y"] = lr.iloc[-252:].std() * np.sqrt(252) * 100
    out.loc[lr.iloc[-252:].count() < 120, "vol_1y"] = np.nan
    p1 = px.iloc[-252:]
    out["mdd_1y"] = ((p1 / p1.cummax()) - 1).min() * 100
    out["dd_52w"] = (last / p1.max() - 1) * 100
    out["up_52w_low"] = (last / p1.min() - 1) * 100
    out["stale_days"] = (px.iloc[-30:].diff().iloc[1:] == 0).sum()

    ma = {n: px.rolling(n, min_periods=int(n * 0.8)).mean() for n in (20, 50, 200)}
    for n, m in ma.items():
        out[f"px_ma{n}"] = (last / m.iloc[-1] - 1) * 100
    out["golden"] = (ma[50].iloc[-1] > ma[200].iloc[-1]).astype(float).where(ma[200].iloc[-1].notna())
    out["cross_dir"], out["cross_ago"] = _last_cross_days(ma[50], ma[200], 20)

    out["rsi14"] = _rsi(px).iloc[-1]
    ema12, ema26 = px.ewm(span=12, adjust=False).mean(), px.ewm(span=26, adjust=False).mean()
    macd = (ema12 - ema26) / px * 100                 # 가격 대비 % (종목 간 비교 가능)
    sig = macd.ewm(span=9, adjust=False).mean()
    out["macd"] = macd.iloc[-1]
    out["macd_hist"] = (macd - sig).iloc[-1]
    out["macd_cross_dir"], out["macd_cross_ago"] = _last_cross_days(macd, sig, 10)
    sd20 = px.rolling(20).std()
    sd20 = sd20.where(sd20 > ma[20] * 1e-6)          # 거래정지 등 가격 고정 → 계산 오차로 0/0≈50 이 나오지 않게 비움
    out["bb_pctb"] = ((last - (ma[20].iloc[-1] - 2 * sd20.iloc[-1])) / (4 * sd20.iloc[-1])) * 100

    bench = benchmark(ri, weights if weights is not None else pd.Series(1.0, index=ri.columns))
    # 베타·상관은 주간 수익률(최근 104주)로: 일간은 시장마다 마감 시각이 달라(아시아↔미국) 과소 추정된다
    wk_b = bench.resample("W-FRI").last().pct_change().iloc[-104:]
    wk_s = px.resample("W-FRI").last().pct_change(fill_method=None).iloc[-104:].clip(-0.6, 0.6)
    ok = wk_s.notna().sum() >= 52
    cov = wk_s.apply(lambda s: s.cov(wk_b))
    out["beta_1y"] = (cov / wk_b.var()).where(ok)          # 열 이름은 호환 위해 유지 (실제 2년 주간)
    out["corr_1y"] = wk_s.corrwith(wk_b).where(ok)
    out["rel_3m"] = out["r_3m"] - (bench.iloc[-1] / bench.iloc[-64] - 1) * 100
    out["rel_12m"] = out["r_12m"] - (bench.iloc[-1] / bench.iloc[-253] - 1) * 100

    conds = pd.concat([
        out["px_ma50"] > 0, out["px_ma200"] > 0, out["golden"] == 1, out["macd_hist"] > 0,
        out["rsi14"].between(40, 70), out["r_3m"] > 0], axis=1)
    out["suspended"] = out["stale_days"] >= 20
    r1 = px.pct_change(fill_method=None).iloc[-10:]
    out["jump_10d"] = r1.abs().max() >= 0.40          # 최근 10거래일 ±40% 급변 (스핀오프·분할 미조정 등)
    out["tech_score"] = conds.sum(axis=1).where((out["n_obs"] >= 200) & ~out["suspended"])
    out["trend"] = pd.cut(out["tech_score"], [-1, 1, 3, 4, 6], labels=["약세", "중립-", "중립+", "강세"]).astype(str)
    out.loc[out["tech_score"].isna(), "trend"] = ""
    return out, bench


def liquidity(vol: pd.DataFrame, ri: pd.DataFrame, px_usd: pd.Series | None = None) -> pd.DataFrame:
    """거래량(VO, 천 주) 기반 유동성·수급 지표. 마지막 거래일 기준.

    adv20/adv60     20·60일 평균 거래량 (천 주)
    vol_ratio       20일 평균 ÷ 120일 평균 (>1 = 최근 거래 증가)
    vol_z_5d        최근 5일 평균 거래량의 120일 분포 대비 Z (로그)
    adv20_usd_mn    20일 평균 거래대금 근사(백만$) = adv20 × 1,000 × 현재 USD 주가 (과거 주가 변동 무시)
    obv_slope_20    OBV(부호 거래량 누적)의 20일 기울기 ÷ adv60 — 가격 상승일 거래가 많으면 +
    """
    v = vol.reindex(index=ri.index, columns=ri.columns)
    v = v.where(v > 0)
    out = pd.DataFrame(index=ri.columns)
    out["adv20"] = v.iloc[-20:].mean()
    out["adv60"] = v.iloc[-60:].mean()
    a120 = v.iloc[-120:].mean()
    out["vol_ratio"] = out["adv20"] / a120
    lv = np.log(v.iloc[-120:])
    out["vol_z_5d"] = (np.log(v.iloc[-5:].mean()) - lv.mean()) / lv.std()
    if px_usd is not None:
        out["adv20_usd_mn"] = out["adv20"] * 1000 * px_usd.reindex(out.index) / 1e6
    sign = np.sign(ri.ffill(limit=5).diff())
    obv = (sign * v.fillna(0)).cumsum()
    out["obv_slope_20"] = (obv.iloc[-1] - obv.iloc[-21]) / (out["adv60"] * 20)
    out.loc[v.iloc[-60:].notna().sum() < 30, ["adv20", "adv60", "vol_ratio", "vol_z_5d", "obv_slope_20"]] = np.nan
    return out


def weekly(ri: pd.DataFrame) -> pd.DataFrame:
    """차트용 주간 종가 (금요일 기준, 마지막 주는 마지막 거래일 값)."""
    return ri.ffill(limit=5).resample("W-FRI").last()

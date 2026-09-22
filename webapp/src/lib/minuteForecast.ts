/**
 * Minute-bar (5m) distributional forecast for BTC / GLD / WTI.
 *
 * Pipeline (standard financial time-series ML):
 *  1. Fetch OHLCV 5m bars
 *  2. Build causal features + 1h/4h forward log-return labels
 *  3. Walk-forward train/val/test with purge + embargo
 *  4. Baseline: EWMA-vol Normal PDF
 *  5. Model: linear quantile regression (pinball SGD) → discrete PDF
 *  6. Path: quantile bridge over horizon steps
 *  7. Metrics: pinball, CRPS proxy, PI coverage, Brier, direction hit
 *
 * Live "업데이트" refits on the latest bars and emits current PDFs + paths.
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

export const MINUTE_FORECAST_R2_KEY = "minute_forecast/latest.json";

export type MinuteForecastAssetId = "btc" | "gld" | "wti";

export type OhlcvBar = {
  ts: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type HorizonId = "1h" | "4h";

export type QuantileLevel = 0.05 | 0.25 | 0.5 | 0.75 | 0.95;

export const QUANTILE_LEVELS: QuantileLevel[] = [0.05, 0.25, 0.5, 0.75, 0.95];

export type DensityPoint = { x_pct: number; density: number };

export type PathPoint = {
  step_min: number;
  median_pct: number;
  lo_pct: number;
  hi_pct: number;
};

export type HorizonForecast = {
  horizon: HorizonId;
  bars_ahead: number;
  quantiles_pct: Record<string, number>;
  p_up: number;
  expected_pct: number;
  crps_model: number | null;
  crps_baseline: number | null;
  crps_improvement_pct: number | null;
  pinball_model: number | null;
  pinball_baseline: number | null;
  coverage_90: number | null;
  brier: number | null;
  direction_hit: number | null;
  density: DensityPoint[];
  path: PathPoint[];
  signal: "buy" | "hold" | "sell";
  signal_ko: string;
  signal_note: string;
};

export type AssetForecast = {
  id: MinuteForecastAssetId;
  symbol: string;
  label: string;
  source: string;
  bar: "5m";
  bars_used: number;
  lookback_days: number | null;
  price: number | null;
  as_of: string | null;
  train_n: number;
  test_n: number;
  feature_names: string[];
  horizons: HorizonForecast[];
  fold_summary: Array<{
    fold: number;
    train_n: number;
    test_n: number;
    crps_1h_impr_pct: number | null;
    crps_4h_impr_pct: number | null;
  }>;
  methodology_note: string;
  error?: string;
};

export type MinuteForecastPayload = {
  ok: boolean;
  generated_at: string;
  as_of_note: string;
  bar: "5m";
  assets: AssetForecast[];
  methodology: string[];
  disclaimer: string;
  error?: string;
  cached?: boolean;
};

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const H1_BARS = 12; // 1h / 5m
const H4_BARS = 48; // 4h / 5m
const FEATURE_NAMES = [
  "ret_1",
  "ret_3",
  "ret_12",
  "ret_48",
  "rv_12",
  "rv_48",
  "range_pct",
  "vol_z",
  "mom_12",
  "hour_sin",
  "hour_cos",
] as const;

type Sample = {
  i: number;
  x: number[];
  y1: number;
  y4: number;
};

const ASSET_SPECS: Array<{
  id: MinuteForecastAssetId;
  symbol: string;
  label: string;
  kind: "okx" | "yahoo";
  yahoo?: string;
  okx?: string;
}> = [
  {
    id: "btc",
    symbol: "BTCUSDT.P",
    label: "Bitcoin",
    kind: "okx",
    okx: "BTC-USDT-SWAP",
  },
  {
    id: "gld",
    symbol: "GLD",
    label: "Gold ETF",
    kind: "yahoo",
    yahoo: "GLD",
  },
  {
    id: "wti",
    symbol: "CL=F",
    label: "WTI Crude",
    kind: "yahoo",
    yahoo: "CL=F",
  },
];

export const MINUTE_FORECAST_METHODOLOGY: string[] = [
  "입력: 5분 OHLCV (BTC=OKX 퍼프, GLD/WTI=Yahoo).",
  "라벨: t 종가 기준 다음 1시간(12봉)·4시간(48봉) 로그수익률.",
  "분할: walk-forward 3-fold + purge(horizon) + embargo(12봉).",
  "베이스라인: EWMA 변동성 조건부 정규분포 PDF.",
  "모델: 선형 분위수 회귀(pinball SGD) q05/25/50/75/95 → 이산 PDF.",
  "보정: OOS CRPS가 EWMA 베이스라인보다 나쁘면 예측을 베이스라인 쪽으로 수축.",
  "경로: 분위수 브리지(중앙·10–90% 밴드)로 분 단위 경로 근사.",
  "검증: pinball, CRPS 근사, 90% PI coverage, Brier, 방향 적중.",
  "시그널: P(r>0)·중앙값·밴드 폭으로 buy/hold/sell (교육용).",
];

export const MINUTE_FORECAST_DISCLAIMER =
  "교육·연구용 분포 추정입니다. 투자 자문·자동매매가 아니며, 실시간 체결을 보장하지 않습니다.";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(Math.max(v, 0));
}

function logRet(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0;
  return Math.log(b / a);
}

function pinball(y: number, q: number, tau: number): number {
  const e = y - q;
  return e >= 0 ? tau * e : (tau - 1) * e;
}

/** Approximate CRPS from discrete quantile forecasts (equal weight). */
function crpsFromQuantiles(
  y: number,
  qs: number[],
  taus: number[],
): number {
  if (!qs.length) return Number.NaN;
  let s = 0;
  for (let i = 0; i < qs.length; i++) {
    s += 2 * pinball(y, qs[i]!, taus[i]!);
  }
  return s / qs.length;
}

function pUpFromQuantiles(levels: number[], values: number[]): number {
  // P(r > 0) ≈ 1 - F(0)
  if (values[0]! >= 0) return 0.99;
  if (values[values.length - 1]! <= 0) return 0.01;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i]! <= 0 && values[i + 1]! >= 0) {
      const w =
        (0 - values[i]!) / Math.max(values[i + 1]! - values[i]!, 1e-12);
      const f0 = levels[i]! + w * (levels[i + 1]! - levels[i]!);
      return clamp(1 - f0, 0.01, 0.99);
    }
  }
  return 0.5;
}

function densityFromQuantiles(
  levels: number[],
  valuesPct: number[],
): DensityPoint[] {
  const xs: number[] = [];
  const lo = valuesPct[0]!;
  const hi = valuesPct[valuesPct.length - 1]!;
  const pad = Math.max((hi - lo) * 0.15, 0.05);
  const start = lo - pad;
  const end = hi + pad;
  const n = 41;
  for (let i = 0; i < n; i++) {
    xs.push(start + ((end - start) * i) / (n - 1));
  }
  // Histogram-like density from quantile spacings (Epanechnikov-ish smoothing)
  const dens = xs.map((x) => {
    let d = 0;
    for (let i = 0; i < valuesPct.length - 1; i++) {
      const a = valuesPct[i]!;
      const b = valuesPct[i + 1]!;
      const mass = levels[i + 1]! - levels[i]!;
      const width = Math.max(Math.abs(b - a), 1e-4);
      const mid = (a + b) / 2;
      const u = (x - mid) / (width * 0.75);
      if (Math.abs(u) < 1) {
        d += (mass / width) * 0.75 * (1 - u * u);
      }
    }
    return d;
  });
  const peak = Math.max(...dens, 1e-9);
  return xs.map((x, i) => ({
    x_pct: Number(x.toFixed(4)),
    density: Number((dens[i]! / peak).toFixed(4)),
  }));
}

function pathFromQuantiles(
  barsAhead: number,
  q10: number,
  q50: number,
  q90: number,
): PathPoint[] {
  const steps = Math.min(barsAhead, 24);
  const out: PathPoint[] = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / barsAhead;
    // square-root time for bands, linear for median (diffusion-like)
    const med = q50 * t;
    const lo = q10 * Math.sqrt(t);
    const hi = q90 * Math.sqrt(t);
    out.push({
      step_min: s * 5,
      median_pct: Number((med * 100).toFixed(4)),
      lo_pct: Number((lo * 100).toFixed(4)),
      hi_pct: Number((hi * 100).toFixed(4)),
    });
  }
  return out;
}

function signalFromDist(
  pUp: number,
  medianPct: number,
  bandWidthPct: number,
): { signal: "buy" | "hold" | "sell"; signal_ko: string; signal_note: string } {
  const edge = Math.abs(pUp - 0.5);
  if (bandWidthPct > 2.5 && edge < 0.12) {
    return {
      signal: "hold",
      signal_ko: "관망",
      signal_note: "예측 구간이 넓어 확신이 낮음",
    };
  }
  if (pUp >= 0.58 && medianPct > 0.05) {
    return {
      signal: "buy",
      signal_ko: "매수 우세",
      signal_note: `P(상승)=${(pUp * 100).toFixed(0)}% · 중앙 ${medianPct.toFixed(2)}%`,
    };
  }
  if (pUp <= 0.42 && medianPct < -0.05) {
    return {
      signal: "sell",
      signal_ko: "매도 우세",
      signal_note: `P(상승)=${(pUp * 100).toFixed(0)}% · 중앙 ${medianPct.toFixed(2)}%`,
    };
  }
  return {
    signal: "hold",
    signal_ko: "관망",
    signal_note: `P(상승)=${(pUp * 100).toFixed(0)}% · 중앙 ${medianPct.toFixed(2)}%`,
  };
}

/* ---------- data fetch ---------- */

async function fetchOkxBars5m(
  instId: string,
  targetBars = 4_000,
): Promise<OhlcvBar[]> {
  const out: OhlcvBar[] = [];
  let after: string | undefined;
  const maxPages = 20;
  for (let page = 0; page < maxPages && out.length < targetBars; page++) {
    const qs = new URLSearchParams({
      instId,
      bar: "5m",
      limit: "300",
    });
    if (after) qs.set("after", after);
    // history-candles covers deeper archive than /candles
    const path =
      page === 0 && !after
        ? "candles"
        : "history-candles";
    const res = await fetch(
      `https://www.okx.com/api/v5/market/${path}?${qs.toString()}`,
      { headers: { "User-Agent": UA }, cache: "no-store" },
    );
    if (!res.ok) {
      if (path === "history-candles") break;
      continue;
    }
    const json = (await res.json()) as { data?: string[][] };
    const rows = json.data || [];
    if (!rows.length) break;
    for (const row of rows) {
      const ts = Number(row[0]);
      const o = Number(row[1]);
      const h = Number(row[2]);
      const l = Number(row[3]);
      const c = Number(row[4]);
      const vol = Number(row[5]);
      if (![ts, o, h, l, c].every(Number.isFinite)) continue;
      out.push({ ts, open: o, high: h, low: l, close: c, volume: vol || 0 });
    }
    const oldest = rows[rows.length - 1];
    if (!oldest) break;
    after = String(oldest[0]);
    if (rows.length < 50) break;
  }
  out.sort((a, b) => a.ts - b.ts);
  const seen = new Set<number>();
  return out.filter((b) => {
    if (seen.has(b.ts)) return false;
    seen.add(b.ts);
    return true;
  });
}

async function fetchYahooBars5m(symbol: string): Promise<OhlcvBar[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=5m&range=60d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0];
  if (!ts.length || !q) return [];
  const out: OhlcvBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (
      o == null ||
      h == null ||
      l == null ||
      c == null ||
      ![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)
    ) {
      continue;
    }
    out.push({
      ts: ts[i]! * 1000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v != null && Number.isFinite(v) ? v : 0,
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

async function loadBars(
  spec: (typeof ASSET_SPECS)[number],
): Promise<{ bars: OhlcvBar[]; source: string }> {
  if (spec.kind === "okx" && spec.okx) {
    const bars = await fetchOkxBars5m(spec.okx);
    return { bars, source: `OKX ${spec.okx} 5m` };
  }
  const bars = await fetchYahooBars5m(spec.yahoo || spec.symbol);
  return { bars, source: `Yahoo ${spec.yahoo || spec.symbol} 5m` };
}

/* ---------- features / labels ---------- */

function buildSamples(bars: OhlcvBar[]): Sample[] {
  const n = bars.length;
  if (n < H4_BARS + 80) return [];
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);
  const samples: Sample[] = [];

  for (let i = 60; i < n - H4_BARS; i++) {
    const c = closes[i]!;
    const c1 = closes[i - 1]!;
    const c3 = closes[i - 3]!;
    const c12 = closes[i - 12]!;
    const c48 = closes[i - 48]!;
    if (!(c > 0 && c1 > 0 && c3 > 0 && c12 > 0 && c48 > 0)) continue;

    const rets: number[] = [];
    for (let k = i - 47; k <= i; k++) {
      rets.push(logRet(closes[k - 1]!, closes[k]!));
    }
    const rv12 = Math.sqrt(
      rets.slice(-12).reduce((a, r) => a + r * r, 0) / 12,
    );
    const rv48 = Math.sqrt(rets.reduce((a, r) => a + r * r, 0) / 48);

    const bar = bars[i]!;
    const rangePct =
      c > 0 ? (bar.high - bar.low) / c : 0;
    const volWindow = vols.slice(i - 47, i + 1);
    const vMean = mean(volWindow);
    const vStd = std(volWindow) || 1;
    const volZ = (bar.volume - vMean) / vStd;

    const d = new Date(bar.ts);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const hourSin = Math.sin((2 * Math.PI * hour) / 24);
    const hourCos = Math.cos((2 * Math.PI * hour) / 24);

    const y1 = logRet(c, closes[i + H1_BARS]!);
    const y4 = logRet(c, closes[i + H4_BARS]!);
    if (![y1, y4].every(Number.isFinite)) continue;

    samples.push({
      i,
      x: [
        logRet(c1, c),
        logRet(c3, c),
        logRet(c12, c),
        logRet(c48, c),
        rv12,
        rv48,
        rangePct,
        volZ,
        c12 > 0 ? c / c12 - 1 : 0,
        hourSin,
        hourCos,
      ],
      y1,
      y4,
    });
  }
  return samples;
}

function featuresAt(bars: OhlcvBar[], i: number): number[] | null {
  if (i < 60 || i >= bars.length) return null;
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);
  const c = closes[i]!;
  const c1 = closes[i - 1]!;
  const c3 = closes[i - 3]!;
  const c12 = closes[i - 12]!;
  const c48 = closes[i - 48]!;
  if (!(c > 0 && c1 > 0 && c3 > 0 && c12 > 0 && c48 > 0)) return null;
  const rets: number[] = [];
  for (let k = i - 47; k <= i; k++) {
    rets.push(logRet(closes[k - 1]!, closes[k]!));
  }
  const rv12 = Math.sqrt(rets.slice(-12).reduce((a, r) => a + r * r, 0) / 12);
  const rv48 = Math.sqrt(rets.reduce((a, r) => a + r * r, 0) / 48);
  const bar = bars[i]!;
  const rangePct = c > 0 ? (bar.high - bar.low) / c : 0;
  const volWindow = vols.slice(i - 47, i + 1);
  const vMean = mean(volWindow);
  const vStd = std(volWindow) || 1;
  const volZ = (bar.volume - vMean) / vStd;
  const d = new Date(bar.ts);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return [
    logRet(c1, c),
    logRet(c3, c),
    logRet(c12, c),
    logRet(c48, c),
    rv12,
    rv48,
    rangePct,
    volZ,
    c12 > 0 ? c / c12 - 1 : 0,
    Math.sin((2 * Math.PI * hour) / 24),
    Math.cos((2 * Math.PI * hour) / 24),
  ];
}

/* ---------- scaling + models ---------- */

type Scaler = { mean: number[]; std: number[] };

function fitScaler(X: number[][]): Scaler {
  const d = X[0]?.length || 0;
  const m = new Array(d).fill(0);
  const s = new Array(d).fill(1);
  if (!X.length) return { mean: m, std: s };
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]!);
    m[j] = mean(col);
    s[j] = std(col) || 1;
  }
  return { mean: m, std: s };
}

function transformRow(x: number[], sc: Scaler): number[] {
  return x.map((v, j) =>
    clamp((v - sc.mean[j]!) / (sc.std[j]! || 1), -4, 4),
  );
}

function empiricalQuantile(ys: number[], tau: number): number {
  if (!ys.length) return 0;
  const s = [...ys].sort((a, b) => a - b);
  const pos = clamp(tau, 0, 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  const w = pos - lo;
  return s[lo]! * (1 - w) + s[hi]! * w;
}

/** Linear quantile regression via pinball SGD (intercept + weights). */
function fitQuantileLinear(
  X: number[][],
  y: number[],
  tau: number,
  epochs = 30,
  lr = 0.01,
  l2 = 0.02,
): { w: number[]; b: number } {
  const d = X[0]?.length || 0;
  const w = new Array(d).fill(0);
  let b = empiricalQuantile(y, tau);
  if (!X.length) return { w, b };
  const n = X.length;
  // Mini-batch style: subsample each epoch for speed/stability
  const batch = Math.min(n, 800);
  for (let ep = 0; ep < epochs; ep++) {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const lrT = lr / Math.sqrt(1 + ep * 0.25);
    for (let k = 0; k < batch; k++) {
      const idx = order[k]!;
      const xi = X[idx]!;
      const yi = y[idx]!;
      let pred = b;
      for (let j = 0; j < d; j++) pred += w[j]! * xi[j]!;
      const err = yi - pred;
      const g = err >= 0 ? -tau : 1 - tau;
      b -= lrT * g;
      for (let j = 0; j < d; j++) {
        w[j] = clamp(w[j]! - lrT * (g * xi[j]! + l2 * w[j]!), -2, 2);
      }
    }
  }
  return { w, b };
}

function predictLinear(
  model: { w: number[]; b: number },
  x: number[],
): number {
  let p = model.b;
  for (let j = 0; j < model.w.length; j++) p += model.w[j]! * x[j]!;
  return p;
}

type QuantileModel = {
  scaler: Scaler;
  models: Array<{ tau: number; model: { w: number[]; b: number } }>;
  yLo: number;
  yHi: number;
  baselineSig: number;
  barsAhead: number;
  /** 1 = full model, 0 = full baseline (set from OOS CRPS). */
  modelWeight: number;
};

function fitQuantileModel(
  X: number[][],
  y: number[],
  barsAhead: number,
  baselineSig: number,
  modelWeight = 1,
): QuantileModel {
  const scaler = fitScaler(X);
  const Xs = X.map((r) => transformRow(r, scaler));
  const models = QUANTILE_LEVELS.map((tau) => ({
    tau,
    model: fitQuantileLinear(Xs, y, tau),
  }));
  const yLo = empiricalQuantile(y, 0.01);
  const yHi = empiricalQuantile(y, 0.99);
  const pad = Math.max(Math.abs(yHi - yLo) * 0.25, baselineSig * Math.sqrt(barsAhead) * 2);
  return {
    scaler,
    models,
    yLo: yLo - pad,
    yHi: yHi + pad,
    baselineSig,
    barsAhead,
    modelWeight: clamp(modelWeight, 0, 1),
  };
}

function predictQuantiles(qm: QuantileModel, x: number[]): number[] {
  const xs = transformRow(x, qm.scaler);
  const raw = qm.models.map((m) => predictLinear(m.model, xs));
  const base = baselineQuantiles(qm.baselineSig, qm.barsAhead);
  const w = qm.modelWeight;
  const blended = raw.map((q, i) => w * q + (1 - w) * base[i]!);
  for (let i = 0; i < blended.length; i++) {
    blended[i] = clamp(blended[i]!, qm.yLo, qm.yHi);
  }
  for (let i = 1; i < blended.length; i++) {
    if (blended[i]! < blended[i - 1]!) blended[i] = blended[i - 1]!;
  }
  return blended;
}

function ewmaSigma(returns: number[], lambda = 0.94): number {
  if (!returns.length) return 0.001;
  let v = returns[0]! * returns[0]!;
  for (let i = 1; i < returns.length; i++) {
    const r = returns[i]!;
    v = lambda * v + (1 - lambda) * r * r;
  }
  return Math.sqrt(Math.max(v, 1e-12));
}

function baselineQuantiles(
  sigma1bar: number,
  barsAhead: number,
  drift = 0,
): number[] {
  const sig = sigma1bar * Math.sqrt(barsAhead);
  const z = [-1.64485, -0.67449, 0, 0.67449, 1.64485];
  return z.map((zi) => drift * barsAhead + zi * sig);
}

/* ---------- walk-forward ---------- */

type Fold = { train: Sample[]; test: Sample[]; fold: number };

function makeFolds(samples: Sample[], nFolds = 3): Fold[] {
  if (samples.length < 200) return [];
  const folds: Fold[] = [];
  const n = samples.length;
  const emb = 12; // bars of samples ≈ embargo
  const purge1 = H1_BARS;
  const purge4 = H4_BARS;
  const purge = Math.max(purge1, purge4);

  for (let f = 0; f < nFolds; f++) {
    // expanding train, contiguous test slices in the last 45% of data
    const testStartFrac = 0.55 + (f * 0.12);
    const testEndFrac = Math.min(0.55 + (f + 1) * 0.12, 0.97);
    const t0 = Math.floor(n * testStartFrac);
    const t1 = Math.floor(n * testEndFrac);
    if (t1 - t0 < 40) continue;

    const trainEnd = t0 - emb;
    const train: Sample[] = [];
    for (let i = 0; i < trainEnd; i++) {
      const s = samples[i]!;
      // purge: drop train samples whose label window overlaps test start
      if (s.i + purge >= samples[t0]!.i) continue;
      train.push(s);
    }
    const test = samples.slice(t0, t1);
    if (train.length < 120 || test.length < 30) continue;
    folds.push({ train, test, fold: f + 1 });
  }
  return folds;
}

function evaluateHorizon(
  train: Sample[],
  test: Sample[],
  yKey: "y1" | "y4",
  barsAhead: number,
  bars: OhlcvBar[],
): {
  crps_model: number;
  crps_baseline: number;
  pinball_model: number;
  pinball_baseline: number;
  coverage_90: number;
  brier: number;
  direction_hit: number;
  qm: QuantileModel;
} {
  const Xtr = train.map((s) => s.x);
  const ytr = train.map((s) => s[yKey]);
  const trainRets = train.map((s) => s.x[0]!);
  const sig = ewmaSigma(trainRets);
  // Evaluate pure model (no baseline blend) against EWMA baseline
  const qm = fitQuantileModel(Xtr, ytr, barsAhead, sig, 1);

  let crpsM = 0;
  let crpsB = 0;
  let pinM = 0;
  let pinB = 0;
  let cover = 0;
  let brier = 0;
  let hit = 0;
  const taus = QUANTILE_LEVELS as number[];

  for (const s of test) {
    const y = s[yKey];
    const qM = predictQuantiles(qm, s.x);
    const qB = baselineQuantiles(sig, barsAhead);
    crpsM += crpsFromQuantiles(y, qM, taus);
    crpsB += crpsFromQuantiles(y, qB, taus);
    for (let i = 0; i < taus.length; i++) {
      pinM += pinball(y, qM[i]!, taus[i]!);
      pinB += pinball(y, qB[i]!, taus[i]!);
    }
    const lo = qM[0]!;
    const hi = qM[qM.length - 1]!;
    if (y >= lo && y <= hi) cover += 1;
    const pUp = pUpFromQuantiles(taus, qM);
    const yBin = y > 0 ? 1 : 0;
    brier += (pUp - yBin) ** 2;
    if ((pUp >= 0.5 && y > 0) || (pUp < 0.5 && y <= 0)) hit += 1;
  }

  const n = test.length || 1;
  const crps_model = crpsM / n;
  const crps_baseline = crpsB / n;
  // Shrink toward baseline when OOS CRPS does not improve
  qm.modelWeight =
    crps_baseline > 0 && crps_model < crps_baseline
      ? clamp(0.35 + 0.5 * (1 - crps_model / crps_baseline), 0.25, 0.8)
      : 0.12;
  void bars;
  return {
    crps_model,
    crps_baseline,
    pinball_model: pinM / (n * taus.length),
    pinball_baseline: pinB / (n * taus.length),
    coverage_90: cover / n,
    brier: brier / n,
    direction_hit: hit / n,
    qm,
  };
}

function buildHorizonForecast(
  horizon: HorizonId,
  barsAhead: number,
  liveX: number[],
  qm: QuantileModel,
  metrics: {
    crps_model: number | null;
    crps_baseline: number | null;
    pinball_model: number | null;
    pinball_baseline: number | null;
    coverage_90: number | null;
    brier: number | null;
    direction_hit: number | null;
  },
  baselineSig: number,
): HorizonForecast {
  const qLog = predictQuantiles(qm, liveX);
  const levels = QUANTILE_LEVELS as number[];
  const qPct = qLog.map((v) => v * 100);
  const quantiles_pct: Record<string, number> = {};
  for (let i = 0; i < levels.length; i++) {
    quantiles_pct[`q${Math.round(levels[i]! * 100)}`] = Number(
      qPct[i]!.toFixed(4),
    );
  }
  const pUp = pUpFromQuantiles(levels, qLog);
  const expected = mean(qLog) * 100;
  const medianPct = qPct[2]!;
  const band = qPct[4]! - qPct[0]!;
  const sig = signalFromDist(pUp, medianPct, band);

  const crpsImpr =
    metrics.crps_baseline != null &&
    metrics.crps_model != null &&
    metrics.crps_baseline > 0
      ? ((metrics.crps_baseline - metrics.crps_model) /
          metrics.crps_baseline) *
        100
      : null;

  // mild blend toward baseline if model is unstable
  void baselineSig;

  return {
    horizon,
    bars_ahead: barsAhead,
    quantiles_pct,
    p_up: Number(pUp.toFixed(4)),
    expected_pct: Number(expected.toFixed(4)),
    crps_model: metrics.crps_model,
    crps_baseline: metrics.crps_baseline,
    crps_improvement_pct:
      crpsImpr != null ? Number(crpsImpr.toFixed(2)) : null,
    pinball_model: metrics.pinball_model,
    pinball_baseline: metrics.pinball_baseline,
    coverage_90: metrics.coverage_90,
    brier: metrics.brier,
    direction_hit: metrics.direction_hit,
    density: densityFromQuantiles(levels, qPct),
    path: pathFromQuantiles(barsAhead, qLog[0]!, qLog[2]!, qLog[4]!),
    signal: sig.signal,
    signal_ko: sig.signal_ko,
    signal_note: sig.signal_note,
  };
}

async function forecastAsset(
  spec: (typeof ASSET_SPECS)[number],
): Promise<AssetForecast> {
  const base: AssetForecast = {
    id: spec.id,
    symbol: spec.symbol,
    label: spec.label,
    source: "",
    bar: "5m",
    bars_used: 0,
    lookback_days: null,
    price: null,
    as_of: null,
    train_n: 0,
    test_n: 0,
    feature_names: [...FEATURE_NAMES],
    horizons: [],
    fold_summary: [],
    methodology_note: "5m OHLCV → walk-forward quantile PDF + path",
  };

  try {
    const { bars, source } = await loadBars(spec);
    base.source = source;
    base.bars_used = bars.length;
    if (bars.length >= 2) {
      const span = bars[bars.length - 1]!.ts - bars[0]!.ts;
      base.lookback_days = Number((span / 86_400_000).toFixed(1));
    }
    if (!bars.length) {
      return { ...base, error: "분봉 데이터를 가져오지 못했습니다." };
    }
    const last = bars[bars.length - 1]!;
    base.price = last.close;
    base.as_of = new Date(last.ts).toISOString();

    const samples = buildSamples(bars);
    if (samples.length < 200) {
      return {
        ...base,
        error: `학습 샘플 부족 (${samples.length}). 분봉 이력이 더 필요합니다.`,
      };
    }

    const folds = makeFolds(samples, 3);
    if (!folds.length) {
      return { ...base, error: "walk-forward fold를 구성하지 못했습니다." };
    }

    // Aggregate metrics across folds; refit final model on all but last embargo
    const metrics1 = {
      crps_model: 0,
      crps_baseline: 0,
      pinball_model: 0,
      pinball_baseline: 0,
      coverage_90: 0,
      brier: 0,
      direction_hit: 0,
      n: 0,
    };
    const metrics4 = { ...metrics1 };
    const fold_summary: AssetForecast["fold_summary"] = [];

    for (const fold of folds) {
      const e1 = evaluateHorizon(fold.train, fold.test, "y1", H1_BARS, bars);
      const e4 = evaluateHorizon(fold.train, fold.test, "y4", H4_BARS, bars);
      const w = fold.test.length;
      metrics1.crps_model += e1.crps_model * w;
      metrics1.crps_baseline += e1.crps_baseline * w;
      metrics1.pinball_model += e1.pinball_model * w;
      metrics1.pinball_baseline += e1.pinball_baseline * w;
      metrics1.coverage_90 += e1.coverage_90 * w;
      metrics1.brier += e1.brier * w;
      metrics1.direction_hit += e1.direction_hit * w;
      metrics1.n += w;
      metrics4.crps_model += e4.crps_model * w;
      metrics4.crps_baseline += e4.crps_baseline * w;
      metrics4.pinball_model += e4.pinball_model * w;
      metrics4.pinball_baseline += e4.pinball_baseline * w;
      metrics4.coverage_90 += e4.coverage_90 * w;
      metrics4.brier += e4.brier * w;
      metrics4.direction_hit += e4.direction_hit * w;
      metrics4.n += w;

      const impr = (m: number, b: number) =>
        b > 0 ? Number((((b - m) / b) * 100).toFixed(2)) : null;
      fold_summary.push({
        fold: fold.fold,
        train_n: fold.train.length,
        test_n: fold.test.length,
        crps_1h_impr_pct: impr(e1.crps_model, e1.crps_baseline),
        crps_4h_impr_pct: impr(e4.crps_model, e4.crps_baseline),
      });
    }

    const avg = (m: typeof metrics1) => {
      const n = m.n || 1;
      return {
        crps_model: m.crps_model / n,
        crps_baseline: m.crps_baseline / n,
        pinball_model: m.pinball_model / n,
        pinball_baseline: m.pinball_baseline / n,
        coverage_90: m.coverage_90 / n,
        brier: m.brier / n,
        direction_hit: m.direction_hit / n,
      };
    };
    const a1 = avg(metrics1);
    const a4 = avg(metrics4);

    // Final fit: all samples except last purge window worth of labels
    const lastIdx = samples[samples.length - 1]!.i;
    const trainFinal = samples.filter((s) => s.i + H4_BARS < lastIdx - 12);
    const useTrain = trainFinal.length >= 120 ? trainFinal : samples;
    base.train_n = useTrain.length;
    base.test_n = metrics1.n;

    const sig = ewmaSigma(useTrain.map((s) => s.x[0]!));
    const weightFrom = (crpsM: number, crpsB: number) =>
      crpsB > 0 && crpsM < crpsB
        ? clamp(0.35 + 0.5 * (1 - crpsM / crpsB), 0.25, 0.8)
        : 0.12;
    const qm1 = fitQuantileModel(
      useTrain.map((s) => s.x),
      useTrain.map((s) => s.y1),
      H1_BARS,
      sig,
      weightFrom(a1.crps_model, a1.crps_baseline),
    );
    const qm4 = fitQuantileModel(
      useTrain.map((s) => s.x),
      useTrain.map((s) => s.y4),
      H4_BARS,
      sig,
      weightFrom(a4.crps_model, a4.crps_baseline),
    );

    const liveX = featuresAt(bars, bars.length - 1);
    if (!liveX) {
      return { ...base, fold_summary, error: "최신 feature를 만들지 못했습니다." };
    }

    const h1 = buildHorizonForecast("1h", H1_BARS, liveX, qm1, a1, sig);
    const h4 = buildHorizonForecast("4h", H4_BARS, liveX, qm4, a4, sig);

    return {
      ...base,
      fold_summary,
      horizons: [h1, h4],
    };
  } catch (exc) {
    return {
      ...base,
      error: exc instanceof Error ? exc.message : String(exc),
    };
  }
}

export function emptyMinuteForecastPayload(error?: string): MinuteForecastPayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    as_of_note: "업데이트 버튼을 눌러 현재 시점 기준으로 재계산하세요.",
    bar: "5m",
    assets: [],
    methodology: MINUTE_FORECAST_METHODOLOGY,
    disclaimer: MINUTE_FORECAST_DISCLAIMER,
    error,
  };
}

export async function computeMinuteForecast(): Promise<MinuteForecastPayload> {
  const asOf = new Date();
  const assets = await Promise.all(ASSET_SPECS.map((s) => forecastAsset(s)));
  const anyOk = assets.some((a) => a.horizons.length > 0 && !a.error);
  return {
    ok: anyOk,
    generated_at: asOf.toISOString(),
    as_of_note: `${asOf.toISOString()} 기준 5분봉으로 재적합·추론`,
    bar: "5m",
    assets,
    methodology: MINUTE_FORECAST_METHODOLOGY,
    disclaimer: MINUTE_FORECAST_DISCLAIMER,
    error: anyOk
      ? undefined
      : assets.map((a) => a.error).filter(Boolean).join(" · ") ||
        "계산 실패",
  };
}

export async function loadMinuteForecastFromR2(): Promise<MinuteForecastPayload | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(MINUTE_FORECAST_R2_KEY);
    if (!text) return null;
    const json = JSON.parse(text) as MinuteForecastPayload;
    if (!json || typeof json !== "object") return null;
    return { ...json, cached: true };
  } catch {
    return null;
  }
}

export async function saveMinuteForecastToR2(
  payload: MinuteForecastPayload,
): Promise<void> {
  if (!r2Configured()) return;
  await r2PutObject(
    MINUTE_FORECAST_R2_KEY,
    JSON.stringify(payload),
    "application/json; charset=utf-8",
    "private, max-age=60",
  );
}

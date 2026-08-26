/**
 * Public GS Quant timeseries formulas, reimplemented in TypeScript.
 *
 * Source (Apache-2.0): https://github.com/goldmansachs/gs-quant
 * Modules: gs_quant.timeseries.econometrics / statistics / technicals
 *
 * These are the documented public functions (not Marquee/GS login APIs).
 * Windows match GS examples: 22d vol/MA, 14d RSI, sample std (ddof=1), 252d annualization.
 */

export type GsPoint = { date: string; value: number };

const TRADING_DAYS = 252;

function lastFinite(xs: Array<number | null | undefined>): number | null {
  for (let i = xs.length - 1; i >= 0; i--) {
    const v = xs[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

export function gsSimpleReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    const px = prices[i]!;
    if (!(prev > 0) || !Number.isFinite(px)) continue;
    out.push(px / prev - 1);
  }
  return out;
}

/** Sample mean. */
function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : 0;
}

/** Unbiased sample std (ddof=1), matching GS `std`. */
export function gsStd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mu = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - mu) ** 2;
  return Math.sqrt(ss / (xs.length - 1));
}

export function gsMovingAverage(values: number[], w: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (w < 1) return out;
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i]!;
    if (i >= w) s -= values[i - w]!;
    if (i >= w - 1) out[i] = s / w;
  }
  return out;
}

/**
 * GS `volatility`: rolling annualized realized vol of simple returns, in percent.
 * Y_t = std(R, w) * sqrt(252) * 100
 */
export function gsVolatility(prices: number[], w = 22): Array<number | null> {
  const rets = gsSimpleReturns(prices);
  const out: Array<number | null> = new Array(prices.length).fill(null);
  if (rets.length < w) return out;
  for (let i = w - 1; i < rets.length; i++) {
    const slice = rets.slice(i - w + 1, i + 1);
    const sd = gsStd(slice);
    if (sd == null) continue;
    out[i + 1] = sd * Math.sqrt(TRADING_DAYS) * 100;
  }
  return out;
}

export function gsVolatilityLast(prices: number[], w = 22): number | null {
  return lastFinite(gsVolatility(prices, w));
}

/**
 * GS `max_drawdown`: peak-to-trough ratio (0.2 = −20%). Window None = full series.
 * Also expose the current drawdown from the running peak.
 */
export function gsDrawdownSeries(prices: number[]): number[] {
  const out: number[] = [];
  let peak = prices[0] || 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    out.push(peak > 0 ? 1 - p / peak : 0);
  }
  return out;
}

export function gsMaxDrawdown(prices: number[]): number | null {
  if (!prices.length) return null;
  let mx = 0;
  for (const d of gsDrawdownSeries(prices)) if (d > mx) mx = d;
  return mx;
}

export function gsCurrentDrawdown(prices: number[]): number | null {
  const dd = gsDrawdownSeries(prices);
  return dd.length ? dd[dd.length - 1]! : null;
}

/**
 * GS `sharpe_ratio` with rf = 0 (Marquee cash curves are not public).
 * Annualized mean simple return / annualized vol, trailing window.
 */
export function gsSharpe(prices: number[], w = 63): number | null {
  const rets = gsSimpleReturns(prices);
  if (rets.length < w) return null;
  const slice = rets.slice(-w);
  const sd = gsStd(slice);
  if (sd == null || sd === 0) return null;
  return (mean(slice) * TRADING_DAYS) / (sd * Math.sqrt(TRADING_DAYS));
}

function alignedReturns(
  a: GsPoint[],
  b: GsPoint[],
): { ra: number[]; rb: number[] } {
  const map = new Map<string, number>();
  for (const p of b) map.set(p.date, p.value);
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < a.length; i++) {
    const prev = a[i - 1]!;
    const cur = a[i]!;
    const bPrev = map.get(prev.date);
    const bCur = map.get(cur.date);
    if (bPrev == null || bCur == null || !(prev.value > 0) || !(bPrev > 0)) continue;
    ra.push(cur.value / prev.value - 1);
    rb.push(bCur / bPrev - 1);
  }
  return { ra, rb };
}

function cov(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i]! - mx) * (ys[i]! - my);
  return s / (n - 1);
}

/**
 * GS `beta`: Cov(R, S) / Var(S) on simple returns of prices vs benchmark.
 */
export function gsBeta(asset: GsPoint[], bench: GsPoint[], w = 63): number | null {
  const { ra, rb } = alignedReturns(asset, bench);
  if (ra.length < w) return null;
  const x = ra.slice(-w);
  const y = rb.slice(-w);
  const v = cov(y, y);
  const c = cov(x, y);
  if (v == null || c == null || v === 0) return null;
  return c / v;
}

/** GS `correlation` on simple returns. */
export function gsCorrelation(a: GsPoint[], b: GsPoint[], w = 63): number | null {
  const { ra, rb } = alignedReturns(a, b);
  if (ra.length < w) return null;
  const x = ra.slice(-w);
  const y = rb.slice(-w);
  const sx = gsStd(x);
  const sy = gsStd(y);
  const c = cov(x, y);
  if (sx == null || sy == null || c == null || sx === 0 || sy === 0) return null;
  return c / (sx * sy);
}

/** GS `zscores`: (x - μ) / σ over window; last value. */
export function gsZscoreLast(values: number[], w = 63): number | null {
  if (values.length < Math.max(3, w)) return null;
  const slice = values.slice(-w);
  const sd = gsStd(slice);
  if (sd == null || sd === 0) return null;
  return (slice[slice.length - 1]! - mean(slice)) / sd;
}

/** Percentile rank of the last value in the series, 0–100. */
export function gsPercentileLast(values: number[]): number | null {
  if (values.length < 8) return null;
  const last = values[values.length - 1]!;
  let below = 0;
  for (const v of values) if (v <= last) below += 1;
  return (below / values.length) * 100;
}

export function gsBollinger(
  values: number[],
  w = 22,
  k = 2,
): { ma: Array<number | null>; upper: Array<number | null>; lower: Array<number | null> } {
  const ma = gsMovingAverage(values, w);
  const upper: Array<number | null> = new Array(values.length).fill(null);
  const lower: Array<number | null> = new Array(values.length).fill(null);
  for (let i = w - 1; i < values.length; i++) {
    const slice = values.slice(i - w + 1, i + 1);
    const sd = gsStd(slice);
    const m = ma[i];
    if (sd == null || m == null) continue;
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { ma, upper, lower };
}

/** GS smoothed moving average (SMMA / RMA): seed with SMA(w), then Wilder update. */
function gsSmma(values: number[], w: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < w || w < 1) return out;
  let prev = 0;
  for (let i = 0; i < w; i++) prev += values[i]!;
  prev /= w;
  out[w - 1] = prev;
  for (let i = w; i < values.length; i++) {
    prev = ((w - 1) * prev + values[i]!) / w;
    out[i] = prev;
  }
  return out;
}

/**
 * GS `relative_strength_index`: SMMA of gains / losses, then 100 - 100/(1+RS).
 */
export function gsRsi(prices: number[], w = 14): Array<number | null> {
  const out: Array<number | null> = new Array(prices.length).fill(null);
  if (prices.length < w + 1) return out;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const chg = prices[i]! - prices[i - 1]!;
    gains.push(chg > 0 ? chg : 0);
    losses.push(chg < 0 ? -chg : 0);
  }
  const avgG = gsSmma(gains, w);
  const avgL = gsSmma(losses, w);
  for (let i = 0; i < avgG.length; i++) {
    const g = avgG[i];
    const l = avgL[i];
    if (g == null || l == null) continue;
    out[i + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function gsRsiLast(prices: number[], w = 14): number | null {
  return lastFinite(gsRsi(prices, w));
}

/** pandas-compatible EMA with span, matching GS `macd` (`ewm(span=…, adjust=False)`). */
export function gsEmaSpan(values: number[], span: number): number[] {
  const alpha = 2 / (span + 1);
  const out: number[] = [];
  if (!values.length) return out;
  let prev = values[0]!;
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i]! + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

/** GS `macd`: EMA(m) − EMA(n), optionally smoothed with span s. */
export function gsMacdLast(prices: number[], m = 12, n = 26, s = 9): number | null {
  if (prices.length < n + s) return null;
  const fast = gsEmaSpan(prices, m);
  const slow = gsEmaSpan(prices, n);
  const macd = fast.map((v, i) => v - slow[i]!);
  const signal = gsEmaSpan(macd, s);
  const last = macd[macd.length - 1]! - signal[signal.length - 1]!;
  return Number.isFinite(last) ? last : null;
}

export function gsIndex(prices: number[], initial = 100): Array<number | null> {
  const first = prices.find((p) => p > 0);
  if (first == null) return prices.map(() => null);
  return prices.map((p) => (p > 0 ? (initial * p) / first : null));
}

export function gsPctChange(prices: number[], obs: number): number | null {
  if (prices.length < obs + 1) return null;
  const a = prices[prices.length - 1 - obs]!;
  const b = prices[prices.length - 1]!;
  if (!(a > 0)) return null;
  return (b / a - 1) * 100;
}

export function downsampleGs<T>(rows: T[], maxPoints: number): T[] {
  if (rows.length <= maxPoints) return rows;
  const out: T[] = [];
  const step = (rows.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push(rows[Math.round(i * step)]!);
  }
  const last = rows[rows.length - 1]!;
  if (out[out.length - 1] !== last) out[out.length - 1] = last;
  return out;
}

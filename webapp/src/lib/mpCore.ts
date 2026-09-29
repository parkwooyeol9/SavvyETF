/**
 * Shared server helpers for the MP analysis tabs: Yahoo daily closes (A-share split repair,
 * US close fallback), Yahoo quoteSummary with a crumb jar, regression / style fits and
 * fund performance metrics.
 */

import { withServerCache } from "@/lib/apiCache";
import { MP_SECTORS, type MpSectorKey } from "@/lib/mpPortfolio";
import { fillUsSessionCloseIfNeeded } from "@/lib/usDailyCloseFallback";
import { unixToEtYmd } from "@/lib/usEquitySession";

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
export const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export type MpMetricSet = {
  total_return_pct: number;
  ann_return_pct: number | null;
  vol_pct: number | null;
  sharpe: number | null;
  sortino: number | null;
  mdd_pct: number;
  mdd_peak: string | null;
  mdd_trough: string | null;
  mdd_recovery: string | null;
  current_dd_pct: number;
  calmar: number | null;
  var95_pct: number | null;
  cvar95_pct: number | null;
  skew: number | null;
  kurtosis: number | null;
  best_day_pct: number | null;
  best_day: string | null;
  worst_day_pct: number | null;
  worst_day: string | null;
  win_rate_pct: number | null;
};

export type MpRelativeMetrics = {
  excess_return_pct: number;
  beta: number | null;
  alpha_pct: number | null;
  correlation: number | null;
  r2: number | null;
  tracking_error_pct: number | null;
  information_ratio: number | null;
  treynor_pct: number | null;
  up_capture_pct: number | null;
  down_capture_pct: number | null;
  hit_ratio_pct: number | null;
};

export type MpRegression = {
  n: number;
  freq: "daily" | "weekly";
  r2: number;
  adj_r2: number;
  alpha_ann_pct: number;
  alpha_t: number | null;
  resid_vol_pct: number;
  betas: Array<{
    key: string;
    label: string;
    beta: number;
    t: number | null;
    return_contrib_pct: number;
    risk_share_pct: number;
  }>;
  specific_risk_share_pct: number;
};

export type MpStyleRegression = {
  n: number;
  freq: "daily" | "weekly";
  r2: number;
  weights: Array<{ key: string; label: string; weight_pct: number }>;
};

export type MpWeeklyMover = { key: string; label: string; contribution_pct: number; return_pct: number | null };

/* ------------------------------------------------------------------ */
/* Data fetch                                                          */
/* ------------------------------------------------------------------ */

export type Daily = {
  symbol: string;
  currency: string;
  name: string;
  dates: string[];
  close: number[];
  splits: Array<{ date: string; ratio: number }>;
};

/**
 * Yahoo omits split events for many A-share ETFs (份额拆分). Daily limits are ±10% / ±20%,
 * so any Shanghai/Shenzhen close-to-close jump beyond ±25% is back-adjusted as a split.
 * The split factor snaps to the unique integer 1:N (or N:1) whose implied same-day
 * return stays within ±20%; otherwise the raw price ratio is used (0% that day).
 */
export function adjustChinaSplits(d: Daily): Daily {
  if (!/\.(SS|SZ)$/i.test(d.symbol)) return d;
  const close = [...d.close];
  const splits: Daily["splits"] = [];
  for (let i = close.length - 1; i > 0; i--) {
    const observed = close[i - 1]! / close[i]!;
    if (observed > 0.75 && observed < 1.3334) continue;
    const candidates = Array.from({ length: 49 }, (_, k) => (observed > 1 ? k + 2 : 1 / (k + 2)));
    const fits = candidates.filter((n) => Math.abs(n / observed - 1) <= 0.2);
    const factor = fits.length === 1 ? fits[0]! : observed;
    for (let j = 0; j < i; j++) close[j]! /= factor;
    splits.push({ date: d.dates[i]!, ratio: factor });
  }
  return { ...d, close, splits };
}

/** `adjusted` uses Yahoo adjclose (dividends reinvested) — needed for bond / REIT total return. */
export async function fetchDaily(symbol: string, startIso: string, opts: { adjusted?: boolean } = {}): Promise<Daily> {
  const p1 = Math.floor(Date.parse(`${startIso}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86_400;
  const url =
    `${YAHOO_CHART}/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&includePrePost=false` +
    (opts.adjusted ? "&events=div%2Csplit" : "");
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = (await res.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          currency?: string;
          longName?: string;
          shortName?: string;
          regularMarketPrice?: number;
          regularMarketTime?: number;
        };
        timestamp?: number[];
        indicators?: {
          quote?: Array<{ close?: Array<number | null> }>;
          adjclose?: Array<{ adjclose?: Array<number | null> }>;
        };
      }>;
    };
  };
  const r = payload.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const adj = opts.adjusted ? r?.indicators?.adjclose?.[0]?.adjclose : undefined;
  const closes = adj?.length ? adj : r?.indicators?.quote?.[0]?.close || [];
  const map = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    map.set(new Date(ts[i]! * 1000).toISOString().slice(0, 10), c);
  }
  if (isUsSymbol(symbol)) {
    const px = r?.meta?.regularMarketPrice;
    const t = r?.meta?.regularMarketTime;
    const sessionQuote =
      typeof px === "number" && px > 0 && typeof t === "number" && t > 0 ? { date: unixToEtYmd(t), close: px } : null;
    try {
      const filled = await fillUsSessionCloseIfNeeded(
        symbol,
        [...map.entries()].map(([date, close]) => ({ date, close })),
        { sessionQuote },
      );
      if (filled.filled) for (const p of filled.points) map.set(p.date, p.close);
    } catch {
      /* Yahoo bars are still usable */
    }
  }
  const dates = [...map.keys()].sort();
  return adjustChinaSplits({
    symbol,
    currency: (r?.meta?.currency || "USD").toUpperCase(),
    name: r?.meta?.longName || r?.meta?.shortName || symbol,
    dates,
    close: dates.map((d) => map.get(d)!),
    splits: [],
  });
}

export function isUsSymbol(symbol: string): boolean {
  return /^\^?[A-Z][A-Z0-9-]*$/.test(symbol);
}

export function zoneClock(timeZone: string, at = new Date()): { ymd: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Yahoo's daily series carries the in-progress session as today's bar. */
export function isIntradayBar(symbol: string, lastDate: string | undefined): boolean {
  if (!lastDate) return false;
  if (/\.(SS|SZ)$/i.test(symbol)) {
    const c = zoneClock("Asia/Shanghai");
    return c.ymd === lastDate && c.minutes < 15 * 60 + 5;
  }
  if (isUsSymbol(symbol)) {
    const c = zoneClock("America/New_York");
    return c.ymd === lastDate && c.minutes < 16 * 60 + 5;
  }
  return false;
}

export async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export type YahooJar = { cookie: string; crumb: string; expires: number };
let jar: YahooJar | null = null;

export async function yahooCrumb(): Promise<YahooJar> {
  const now = Date.now();
  if (jar && jar.expires > now) return jar;
  const warm = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
  const h = warm.headers as Headers & { getSetCookie?: () => string[] };
  const raw = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  let cookie = raw.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) {
    cookie = (warm.headers.get("set-cookie") || "")
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0]!.trim())
      .filter((c) => c.includes("="))
      .join("; ");
  }
  const res = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
  });
  if (!res.ok) throw new Error(`Yahoo crumb HTTP ${res.status}`);
  const crumb = (await res.text()).trim();
  if (!crumb || crumb.length > 40 || crumb.includes("<")) throw new Error("Yahoo crumb invalid");
  jar = { cookie, crumb, expires: now + 25 * 60_000 };
  return jar;
}

export function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Misses throw inside the cache callback so a transient Yahoo failure is retried instead of cached. */
export async function cachedLookup<T>(
  key: string,
  ttlMs: number,
  staleMs: number,
  fn: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return await withServerCache(key, ttlMs, staleMs, async () => {
      const v = await fn();
      if (v == null) throw new Error(`${key}: no data`);
      return v;
    });
  } catch {
    return null;
  }
}

export async function quoteSummary<T>(symbol: string, modules: string): Promise<T | null> {
  const j = await yahooCrumb();
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=${modules}&crumb=${encodeURIComponent(j.crumb)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: j.cookie, Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { quoteSummary?: { result?: T[] } };
  return json.quoteSummary?.result?.[0] ?? null;
}

export type EtfProfile = { sectors: Partial<Record<MpSectorKey, number>>; pe: number | null; pb: number | null };

export async function fetchEtfProfile(symbol: string): Promise<EtfProfile | null> {
  return cachedLookup(`mp:etfprof:${symbol}`, 6 * 3_600_000, 24 * 3_600_000, async () => {
    const r = await quoteSummary<{
      topHoldings?: {
        sectorWeightings?: Array<Record<string, { raw?: number }>>;
        equityHoldings?: Record<string, { raw?: number }>;
      };
    }>(symbol, "topHoldings");
    const th = r?.topHoldings;
    if (!th?.sectorWeightings?.length) return null;
    const sectors: Partial<Record<MpSectorKey, number>> = {};
    for (const row of th.sectorWeightings) {
      for (const [k, v] of Object.entries(row)) {
        const key = k as MpSectorKey;
        if (MP_SECTORS.some((s) => s.key === key) && v?.raw != null) sectors[key] = v.raw * 100;
      }
    }
    const pe = th.equityHoldings?.priceToEarnings?.raw;
    const pb = th.equityHoldings?.priceToBook?.raw;
    return {
      sectors,
      pe: pe && pe > 0 ? 1 / pe : null,
      pb: pb && pb > 0 ? 1 / pb : null,
    };
  });
}

export const isNum = (x: number) => Number.isFinite(x);

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function std(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function cov(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i]! - mx) * (ys[i]! - my);
  return s / (n - 1);
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export function toReturns(levels: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1]!;
    const b = levels[i]!;
    out.push(isNum(a) && isNum(b) && a > 0 ? b / a - 1 : NaN);
  }
  return out;
}

export function drawdowns(levels: number[]): number[] {
  let peak = -Infinity;
  return levels.map((v) => {
    if (v > peak) peak = v;
    return peak > 0 ? (v / peak - 1) * 100 : 0;
  });
}

/** Solve A x = b (Gauss-Jordan with partial pivoting); returns inverse too. */
export function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-14) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    const pv = m[c]![c]!;
    for (let j = 0; j < 2 * n; j++) m[c]![j]! /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row) => row.slice(n));
}

export type Ols = { coef: number[]; t: Array<number | null>; r2: number; adjR2: number; resid: number[]; n: number };

/** OLS with intercept (coef[0]); rows with any NaN are dropped. */
export function ols(y: number[], xs: number[][]): Ols | null {
  const k = xs.length;
  const rows: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (!isNum(y[i]!)) continue;
    if (xs.some((x) => !isNum(x[i]!))) continue;
    rows.push(i);
  }
  const n = rows.length;
  if (n < k + 8) return null;
  const X = rows.map((i) => [1, ...xs.map((x) => x[i]!)]);
  const Y = rows.map((i) => y[i]!);
  const p = k + 1;
  const xtx = Array.from({ length: p }, (_, a) =>
    Array.from({ length: p }, (_, b) => X.reduce((s, r) => s + r[a]! * r[b]!, 0)),
  );
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = Array.from({ length: p }, (_, a) => X.reduce((s, r, i) => s + r[a]! * Y[i]!, 0));
  const coef = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j]!, 0));
  const resid = X.map((r, i) => Y[i]! - r.reduce((s, v, j) => s + v * coef[j]!, 0));
  const ssr = resid.reduce((s, e) => s + e * e, 0);
  const my = mean(Y);
  const sst = Y.reduce((s, v) => s + (v - my) ** 2, 0);
  const r2 = sst > 0 ? 1 - ssr / sst : 0;
  const s2 = ssr / Math.max(1, n - p);
  const t = coef.map((c, j) => {
    const se = Math.sqrt(s2 * inv[j]![j]!);
    return se > 0 ? c / se : null;
  });
  return { coef, t, r2, adjR2: 1 - ((1 - r2) * (n - 1)) / Math.max(1, n - p), resid, n };
}

/** Euclidean projection onto the probability simplex. */
export function projectSimplex(v: number[]): number[] {
  const u = [...v].sort((a, b) => b - a);
  let css = 0;
  let theta = 0;
  for (let i = 0; i < u.length; i++) {
    css += u[i]!;
    const t = (css - 1) / (i + 1);
    if (u[i]! - t > 0) theta = t;
  }
  return v.map((x) => Math.max(0, x - theta));
}

/** Sharpe returns-based style: min ||y − Xw||², w ≥ 0, Σw = 1. */
export function styleRegression(y: number[], xs: number[][]): { w: number[]; r2: number; n: number } | null {
  const k = xs.length;
  const rows: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (isNum(y[i]!) && xs.every((x) => isNum(x[i]!))) rows.push(i);
  }
  const n = rows.length;
  if (n < k + 5) return null;
  const X = rows.map((i) => xs.map((x) => x[i]!));
  const Y = rows.map((i) => y[i]!);
  const G = Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => X.reduce((s, r) => s + r[a]! * r[b]!, 0)),
  );
  const c = Array.from({ length: k }, (_, a) => X.reduce((s, r, i) => s + r[a]! * Y[i]!, 0));
  const L = Math.max(1e-12, G.reduce((s, row) => s + row.reduce((a, v) => a + Math.abs(v), 0), 0));
  let w = Array.from({ length: k }, () => 1 / k);
  for (let it = 0; it < 4000; it++) {
    const grad = G.map((row, a) => row.reduce((s, v, b) => s + v * w[b]!, 0) - c[a]!);
    const next = projectSimplex(w.map((x, a) => x - grad[a]! / L));
    const delta = next.reduce((s, x, a) => s + Math.abs(x - w[a]!), 0);
    w = next;
    if (delta < 1e-10) break;
  }
  const fitted = X.map((r) => r.reduce((s, v, a) => s + v * w[a]!, 0));
  const resid = Y.map((v, i) => v - fitted[i]!);
  const vy = std(Y);
  const ve = std(resid);
  const r2 = vy && vy > 0 && ve != null ? 1 - (ve * ve) / (vy * vy) : 0;
  return { w, r2, n };
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

export function metricSet(
  dates: string[],
  levels: number[],
  rets: number[],
  rf: number[],
  annF: number,
  spanDays: number,
): MpMetricSet {
  const total = levels.length ? (levels[levels.length - 1]! / levels[0]! - 1) * 100 : 0;
  const ann =
    spanDays >= 30 && levels.length > 1
      ? (Math.pow(levels[levels.length - 1]! / levels[0]!, 365.25 / spanDays) - 1) * 100
      : null;
  const valid = rets.map((r, i) => ({ r, rf: rf[i] || 0, d: dates[i + 1]! })).filter((x) => isNum(x.r));
  const rs = valid.map((x) => x.r);
  const ex = valid.map((x) => x.r - x.rf);
  const sd = std(rs);
  const vol = sd != null ? sd * Math.sqrt(annF) * 100 : null;
  const sharpe = sd && sd > 0 ? (mean(ex) * annF) / (sd * Math.sqrt(annF)) : null;
  const downside = Math.sqrt(mean(ex.map((e) => Math.min(0, e) ** 2)));
  const sortino = downside > 0 ? (mean(ex) * annF) / (downside * Math.sqrt(annF)) : null;

  const dd = drawdowns(levels);
  let mddIdx = 0;
  for (let i = 0; i < dd.length; i++) if (dd[i]! < dd[mddIdx]!) mddIdx = i;
  let peakIdx = 0;
  for (let i = 0; i <= mddIdx; i++) if (levels[i]! >= levels[peakIdx]!) peakIdx = i;
  let recIdx: number | null = null;
  for (let i = mddIdx + 1; i < levels.length; i++) {
    if (levels[i]! >= levels[peakIdx]!) {
      recIdx = i;
      break;
    }
  }
  const mdd = dd.length ? dd[mddIdx]! : 0;
  const v5 = quantile(rs, 0.05);
  const tail = v5 != null ? rs.filter((r) => r <= v5) : [];
  const m = mean(rs);
  const m2 = mean(rs.map((r) => (r - m) ** 2));
  const skew = rs.length > 2 && m2 > 0 ? mean(rs.map((r) => (r - m) ** 3)) / m2 ** 1.5 : null;
  const kurt = rs.length > 3 && m2 > 0 ? mean(rs.map((r) => (r - m) ** 4)) / m2 ** 2 - 3 : null;
  let best: (typeof valid)[number] | null = null;
  let worst: (typeof valid)[number] | null = null;
  for (const x of valid) {
    if (!best || x.r > best.r) best = x;
    if (!worst || x.r < worst.r) worst = x;
  }
  return {
    total_return_pct: total,
    ann_return_pct: ann,
    vol_pct: vol,
    sharpe,
    sortino,
    mdd_pct: mdd,
    mdd_peak: mdd < 0 ? dates[peakIdx] || null : null,
    mdd_trough: mdd < 0 ? dates[mddIdx] || null : null,
    mdd_recovery: mdd < 0 && recIdx != null ? dates[recIdx] || null : null,
    current_dd_pct: dd.length ? dd[dd.length - 1]! : 0,
    calmar: ann != null && mdd < 0 ? ann / Math.abs(mdd) : null,
    var95_pct: v5 != null ? -v5 * 100 : null,
    cvar95_pct: tail.length ? -mean(tail) * 100 : null,
    skew,
    kurtosis: kurt,
    best_day_pct: best ? best.r * 100 : null,
    best_day: best?.d || null,
    worst_day_pct: worst ? worst.r * 100 : null,
    worst_day: worst?.d || null,
    win_rate_pct: rs.length ? (rs.filter((r) => r > 0).length / rs.length) * 100 : null,
  };
}

export function relativeMetrics(
  rp: number[],
  rb: number[],
  rf: number[],
  annF: number,
  totalP: number,
  totalB: number,
): MpRelativeMetrics {
  const idx = rp.map((_, i) => i).filter((i) => isNum(rp[i]!) && isNum(rb[i]!));
  const p = idx.map((i) => rp[i]!);
  const b = idx.map((i) => rb[i]!);
  const f = idx.map((i) => rf[i] || 0);
  const pe = p.map((x, i) => x - f[i]!);
  const be = b.map((x, i) => x - f[i]!);
  const c = cov(pe, be);
  const sb = std(be);
  const sp = std(pe);
  const beta = c != null && sb && sb > 0 ? c / (sb * sb) : null;
  const corr = c != null && sb && sp && sb > 0 && sp > 0 ? c / (sb * sp) : null;
  const active = p.map((x, i) => x - b[i]!);
  const te = std(active);
  const up = idx.map((_, i) => i).filter((i) => b[i]! > 0);
  const dn = idx.map((_, i) => i).filter((i) => b[i]! < 0);
  const upB = mean(up.map((i) => b[i]!));
  const dnB = mean(dn.map((i) => b[i]!));
  return {
    excess_return_pct: totalP - totalB,
    beta,
    alpha_pct: beta != null ? (mean(pe) - beta * mean(be)) * annF * 100 : null,
    correlation: corr,
    r2: corr != null ? corr * corr : null,
    tracking_error_pct: te != null ? te * Math.sqrt(annF) * 100 : null,
    information_ratio: te && te > 0 ? (mean(active) * annF) / (te * Math.sqrt(annF)) : null,
    treynor_pct: beta && Math.abs(beta) > 1e-6 ? ((mean(pe) * annF) / beta) * 100 : null,
    up_capture_pct: up.length && upB !== 0 ? (mean(up.map((i) => p[i]!)) / upB) * 100 : null,
    down_capture_pct: dn.length && dnB !== 0 ? (mean(dn.map((i) => p[i]!)) / dnB) * 100 : null,
    hit_ratio_pct: active.length ? (active.filter((a) => a > 0).length / active.length) * 100 : null,
  };
}

export function weekKey(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Index 0 (base) plus the last observation of each ISO week. */
export function weeklyIndex(dates: string[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < dates.length; i++) {
    if (i === dates.length - 1 || weekKey(dates[i + 1]!) !== weekKey(dates[i]!)) out.push(i);
  }
  return out;
}

export function pick(levels: number[], idx: number[]): number[] {
  return idx.map((i) => levels[i]!);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function sgn(n: number, digits = 2): string {
  const v = Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
}

export function monthDay(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

/* ------------------------------------------------------------------ */
/* Shared analysis blocks                                              */
/* ------------------------------------------------------------------ */

/** Forward-filled closes on `cal` (NaN before the first observation). */
export function alignTo(cal: string[], d: Daily | undefined): number[] {
  const out = new Array<number>(cal.length).fill(NaN);
  if (!d) return out;
  let j = 0;
  let last = NaN;
  for (let i = 0; i < cal.length; i++) {
    while (j < d.dates.length && d.dates[j]! <= cal[i]!) {
      last = d.close[j]!;
      j++;
    }
    out[i] = last;
  }
  return out;
}

/** Daily T-bill accrual from ^IRX (percent, previous close) over calendar days. */
export function rfDailyFrom(cal: string[], irx: number[]): number[] {
  return cal.map((d, i) => {
    if (i === 0) return 0;
    const y = isNum(irx[i - 1]!) ? irx[i - 1]! : isNum(irx[i]!) ? irx[i]! : 0;
    const days = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${cal[i - 1]}T00:00:00Z`)) / 86_400_000;
    return (y / 100) * (days / 365);
  });
}

/** GRAP factor per period ×100: Π_{s<t}(1+Rp_s) × Π_{s>t}(1+Rb_s), so linked effects sum to cumulative Rp − Rb. */
export function grapLinks(rPort: number[], rBm: number[]): number[] {
  const T = rBm.length;
  const growP = new Array<number>(T).fill(1);
  const growB = new Array<number>(T).fill(1);
  for (let t = 1; t < T; t++) growP[t] = growP[t - 1]! * (1 + (isNum(rPort[t - 1]!) ? rPort[t - 1]! : 0));
  for (let t = T - 2; t >= 0; t--) growB[t] = growB[t + 1]! * (1 + (isNum(rBm[t + 1]!) ? rBm[t + 1]! : 0));
  return growP.map((g, t) => g * growB[t]! * 100);
}

export type MpPeriodReturn = {
  key: string;
  label: string;
  port_pct: number | null;
  bm_pct: number | null;
  excess_pct: number | null;
  /** Base date falls before `estimatedBefore` (pre-inception pro-forma levels). */
  estimated?: boolean;
};

export function periodReturns(
  cal: string[],
  nav: number[],
  bmLv: number[],
  allLabel: string,
  opts: { allFrom?: string; estimatedBefore?: string } = {},
): MpPeriodReturn[] {
  const N = cal.length;
  const lastD = cal[N - 1]!;
  const idxAtOrBefore = (date: string): number => {
    let k = -1;
    for (let i = 0; i < N; i++) {
      if (cal[i]! <= date) k = i;
      else break;
    }
    return k;
  };
  const levelAtOrBefore = (lv: number[], date: string): number | null => {
    const k = idxAtOrBefore(date);
    return k >= 0 ? lv[k]! : null;
  };
  const periods: Array<{ key: string; label: string; from: string | null }> = [
    { key: "1d", label: "1일", from: N >= 2 ? cal[N - 2]! : null },
    { key: "1w", label: "1주", from: addDays(lastD, -7) },
    { key: "1m", label: "1개월", from: addDays(lastD, -30) },
    { key: "3m", label: "3개월", from: addDays(lastD, -91) },
    { key: "6m", label: "6개월", from: addDays(lastD, -182) },
    { key: "ytd", label: "YTD", from: `${Number(lastD.slice(0, 4)) - 1}-12-31` },
    { key: "all", label: allLabel, from: opts.allFrom || cal[0]! },
  ];
  return periods.map((p) => {
    if (!p.from || p.from < cal[0]!) return { key: p.key, label: p.label, port_pct: null, bm_pct: null, excess_pct: null };
    const p0 = levelAtOrBefore(nav, p.from);
    const b0 = levelAtOrBefore(bmLv, p.from);
    const pr = p0 ? (nav[N - 1]! / p0 - 1) * 100 : null;
    const br = b0 ? (bmLv[N - 1]! / b0 - 1) * 100 : null;
    const baseDate = cal[idxAtOrBefore(p.from)];
    const estimated = !!opts.estimatedBefore && !!baseDate && baseDate < opts.estimatedBefore;
    return {
      key: p.key,
      label: p.label,
      port_pct: pr,
      bm_pct: br,
      excess_pct: pr != null && br != null ? pr - br : null,
      ...(estimated ? { estimated } : {}),
    };
  });
}

/** Earliest base the period / monthly tables need: prior year-end or the month-end ~6 months back. */
export function periodTableStart(today: string): string {
  const sixMonths = addDays(today, -183);
  const sixMonthEnd = addDays(`${sixMonths.slice(0, 7)}-01`, -1);
  const priorYearEnd = `${Number(today.slice(0, 4)) - 1}-12-31`;
  return priorYearEnd < sixMonthEnd ? priorYearEnd : sixMonthEnd;
}

export type MpMonthlyReturn = { month: string; port_pct: number; bm_pct: number; excess_pct: number; estimated?: boolean };

/** Month-end to month-end returns; a series starting on a month's last day skips that empty month. */
export function monthlyReturns(cal: string[], nav: number[], bmLv: number[], estimatedBefore?: string): MpMonthlyReturn[] {
  const out: MpMonthlyReturn[] = [];
  let prevP = nav[0]!;
  let prevB = bmLv[0]!;
  let prevD = cal[0]!;
  for (let i = 0; i < cal.length; i++) {
    const m = cal[i]!.slice(0, 7);
    if (i === cal.length - 1 || cal[i + 1]!.slice(0, 7) !== m) {
      if (i > 0) {
        const pp = (nav[i]! / prevP - 1) * 100;
        const bb = (bmLv[i]! / prevB - 1) * 100;
        const estimated = !!estimatedBefore && prevD < estimatedBefore;
        out.push({ month: m, port_pct: pp, bm_pct: bb, excess_pct: pp - bb, ...(estimated ? { estimated } : {}) });
      }
      prevP = nav[i]!;
      prevB = bmLv[i]!;
      prevD = cal[i]!;
    }
  }
  return out;
}

/** OLS of excess return on factor returns with return / risk decomposition. */
export function factorRegression(
  y: number[],
  X: number[][],
  factors: ReadonlyArray<{ key: string; label: string }>,
  freq: "daily" | "weekly",
  perYear: number,
): MpRegression | null {
  const fit = ols(y, X);
  if (!fit) return null;
  const rows = y.map((_, i) => i).filter((i) => isNum(y[i]!) && X.every((x) => isNum(x[i]!)));
  const fitted = rows.map((i) => factors.reduce((s, _, j) => s + fit.coef[j + 1]! * X[j]![i]!, 0));
  const varY = std(rows.map((i) => y[i]!)) ?? 0;
  const totalVar = varY * varY;
  const riskShare = factors.map((_, j) => {
    const fj = rows.map((i) => X[j]![i]!);
    const c = cov(fj, fitted) ?? 0;
    return totalVar > 0 ? ((fit.coef[j + 1]! * c) / totalVar) * 100 : 0;
  });
  const residVar = (std(fit.resid) ?? 0) ** 2;
  return {
    n: fit.n,
    freq,
    r2: fit.r2,
    adj_r2: fit.adjR2,
    alpha_ann_pct: fit.coef[0]! * perYear * 100,
    alpha_t: fit.t[0] ?? null,
    resid_vol_pct: (std(fit.resid) ?? 0) * Math.sqrt(perYear) * 100,
    betas: factors.map((f, j) => ({
      key: f.key,
      label: f.label,
      beta: fit.coef[j + 1]!,
      t: fit.t[j + 1] ?? null,
      return_contrib_pct: rows.reduce((s, i) => s + fit.coef[j + 1]! * X[j]![i]!, 0) * 100,
      risk_share_pct: riskShare[j]!,
    })),
    specific_risk_share_pct: totalVar > 0 ? (residVar / totalVar) * 100 : 0,
  };
}

export function styleFit(
  rp: number[],
  styleX: number[][],
  indices: ReadonlyArray<{ key: string; label: string }>,
  freq: "daily" | "weekly",
): MpStyleRegression | null {
  const sfit = styleRegression(rp, styleX);
  return sfit
    ? {
        n: sfit.n,
        freq,
        r2: sfit.r2,
        weights: indices.map((s, j) => ({ key: s.key, label: s.label, weight_pct: sfit.w[j]! * 100 })),
      }
    : null;
}

/** Rolling RBSA on daily returns (`rp[k]` is the return into `cal[k + 1]`). */
export function rollingStyle(
  cal: string[],
  rp: number[],
  styleX: number[][],
  indices: ReadonlyArray<{ key: string }>,
  win = 63,
  step = 5,
): Array<{ date: string } & Record<string, number | string>> {
  const out: Array<{ date: string } & Record<string, number | string>> = [];
  if (rp.length < win + 20) return out;
  for (let end = win; end <= rp.length; end += step) {
    const fit = styleRegression(
      rp.slice(end - win, end),
      styleX.map((x) => x.slice(end - win, end)),
    );
    if (!fit) continue;
    const row: { date: string } & Record<string, number | string> = { date: cal[end]! };
    indices.forEach((s, j) => {
      row[s.key] = Math.round(fit.w[j]! * 1000) / 10;
    });
    out.push(row);
  }
  return out;
}

export function splitNotes(bySym: Map<string, Daily>): string[] {
  const notes: string[] = [];
  for (const [sym, d] of bySym) {
    for (const s of d.splits) {
      const label =
        s.ratio >= 1
          ? `분할 추정 1:${Number.isInteger(s.ratio) ? s.ratio : s.ratio.toFixed(2)}`
          : `병합 추정 ${(1 / s.ratio).toFixed(Number.isInteger(Math.round((1 / s.ratio) * 100) / 100) ? 0 : 2)}:1`;
      notes.push(`${sym}: ${s.date} 가격 불연속(${label}) — 이전 가격을 보정`);
    }
  }
  return notes;
}

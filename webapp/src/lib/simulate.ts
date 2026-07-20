/** Yahoo Finance chart client + portfolio simulation for the dashboard. */

import { resolveMethodWeights } from "@/lib/allocation";
import type { VolDiag } from "@/lib/allocation";
import {
  ETF_CATALOG,
  type AllocMethod,
  type AssetClass,
} from "@/lib/etfCatalog";
import type { RegionBucket } from "@/lib/allocation";

export type PricePoint = { date: string; close: number };

export type LegInput = { symbol: string; weight: number };

export type SimMetrics = {
  annual_return_pct: number;
  annual_vol_pct: number;
  sharpe: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  final_value: number;
};

export type SimulateResult = {
  ok: boolean;
  error?: string;
  start_date?: string;
  end_date?: string;
  trading_days?: number;
  initial_capital?: number;
  benchmark?: string;
  tickers?: string[];
  weights?: number[];
  method?: AllocMethod;
  method_note?: string;
  asset_targets?: Record<string, number>;
  region_targets?: Record<string, number>;
  vol_diagnostics?: VolDiag[];
  metrics?: {
    portfolio: SimMetrics;
    benchmark: SimMetrics;
    equal_weight: SimMetrics;
    allocation_effect_pct: number;
    excess_vs_benchmark_pct: number;
  };
  contributions?: Array<{
    ticker: string;
    weight_pct: number;
    standalone_return_pct: number;
    weighted_contribution_pct: number;
    annual_vol_pct?: number;
  }>;
  series?: {
    date: string[];
    portfolio: number[];
    benchmark: number[];
    equal_weight: number[];
    [ticker: string]: string[] | number[];
  };
};

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

/** @deprecated use etfCatalog — kept for older imports */
export { ETF_CATALOG };
function toYahooSymbol(ticker: string): string {
  const symbol = ticker.trim().toUpperCase();
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) return symbol;
  return symbol.replace(/\./g, "-");
}

function rangeForDays(days: number): string {
  if (days <= 30) return "1mo";
  if (days <= 100) return "3mo";
  if (days <= 200) return "6mo";
  if (days <= 400) return "1y";
  if (days <= 800) return "2y";
  if (days <= 2000) return "5y";
  return "max";
}

export async function fetchDailyCloses(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<PricePoint[]> {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T23:59:59Z`).getTime();
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  const yahooSym = toYahooSymbol(symbol);
  const url = `${YAHOO_CHART}/${encodeURIComponent(yahooSym)}?range=${rangeForDays(days)}&interval=1d&includePrePost=false`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  }
  const payload = (await res.json()) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
  };
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out: PricePoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    const ms = timestamps[i] * 1000;
    if (ms < start || ms > end) continue;
    const d = new Date(ms);
    const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, close });
  }
  // Deduplicate by date (keep last)
  const map = new Map<string, number>();
  for (const p of out) map.set(p.date, p.close);
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
}

function alignCloses(
  seriesMap: Record<string, PricePoint[]>,
): { dates: string[]; values: Record<string, number[]> } {
  const keys = Object.keys(seriesMap);
  const dateSets = keys.map((k) => new Set(seriesMap[k].map((p) => p.date)));
  const dates = [...dateSets[0]].filter((d) => dateSets.every((s) => s.has(d))).sort();
  const lookup: Record<string, Map<string, number>> = {};
  for (const k of keys) {
    lookup[k] = new Map(seriesMap[k].map((p) => [p.date, p.close]));
  }
  const values: Record<string, number[]> = {};
  for (const k of keys) {
    values[k] = dates.map((d) => lookup[k].get(d) as number);
  }
  return { dates, values };
}

function pctChange(closes: number[]): number[] {
  const out = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    out[i] = closes[i - 1] ? closes[i] / closes[i - 1] - 1 : 0;
  }
  return out;
}

function cumprod(returns: number[]): number[] {
  const out = new Array(returns.length);
  let v = 1;
  for (let i = 0; i < returns.length; i++) {
    if (i === 0) {
      out[i] = 1;
      continue;
    }
    v *= 1 + returns[i];
    out[i] = v;
  }
  return out;
}

function maxDrawdown(cum: number[]): number {
  let peak = cum[0] || 1;
  let worst = 0;
  for (const v of cum) {
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst * 100;
}

function annStats(returns: number[], finalCum: number): Omit<SimMetrics, "max_drawdown_pct" | "final_value"> & { total_return_pct: number } {
  const sample = returns.slice(1);
  const n = sample.length || 1;
  const mean = sample.reduce((a, b) => a + b, 0) / n;
  const variance = sample.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const vol = Math.sqrt(variance);
  const annualReturn = mean * 252;
  const annualVol = vol * Math.sqrt(252);
  const sharpe = annualVol ? annualReturn / annualVol : 0;
  return {
    annual_return_pct: round(annualReturn * 100, 2),
    annual_vol_pct: round(annualVol * 100, 2),
    sharpe: round(sharpe, 3),
    total_return_pct: round((finalCum - 1) * 100, 2),
  };
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function downsample<T>(arr: T[], maxPoints = 400): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

export async function simulateAllocation(input: {
  tickers: string[];
  weights?: number[];
  method?: AllocMethod | "asset_631";
  asset_targets?: Record<AssetClass, number>;
  region_targets?: Record<RegionBucket, number>;
  start_date?: string;
  end_date?: string;
  initial_capital?: number;
  benchmark?: string;
}): Promise<SimulateResult> {
  const tickers = [...new Set(input.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (!tickers.length) return { ok: false, error: "Provide at least one ETF ticker" };
  if (tickers.length > 20) return { ok: false, error: "Select at most 20 ETFs" };

  const end = input.end_date || new Date().toISOString().slice(0, 10);
  const start =
    input.start_date ||
    new Date(Date.now() - 365 * 3 * 86_400_000).toISOString().slice(0, 10);
  const capital = input.initial_capital && input.initial_capital > 0 ? input.initial_capital : 10_000;
  const benchmark = (input.benchmark || "SPY").trim().toUpperCase();
  const needed = [...new Set([...tickers, benchmark])];
  const rawMethod = input.method || "equal";
  const method: AllocMethod = rawMethod === "asset_631" ? "asset" : rawMethod;

  const seriesMap: Record<string, PricePoint[]> = {};
  const missing: string[] = [];
  await Promise.all(
    needed.map(async (sym) => {
      try {
        const pts = await fetchDailyCloses(sym, start, end);
        if (pts.length < 5) missing.push(sym);
        else seriesMap[sym] = pts;
      } catch {
        missing.push(sym);
      }
    }),
  );
  if (missing.length) {
    return { ok: false, error: `No price history for: ${missing.join(", ")}` };
  }

  const { dates, values } = alignCloses(seriesMap);
  if (dates.length < 5) {
    return { ok: false, error: "Not enough overlapping history for these ETFs" };
  }

  const legRets: Record<string, number[]> = {};
  for (const t of tickers) legRets[t] = pctChange(values[t]);
  const benchRet = pctChange(values[benchmark]);

  let weights: number[];
  let methodNote: string | undefined;
  let usedMethod: AllocMethod = method;
  let volDiagnostics: VolDiag[] | undefined;

  if (input.weights && input.weights.length === tickers.length && !input.method) {
    const sum = input.weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) return { ok: false, error: "Weights must sum to a positive number" };
    weights = input.weights.map((w) => w / sum);
  } else {
    const resolved = resolveMethodWeights({
      method,
      tickers,
      legReturns: legRets,
      assetTargets: input.asset_targets,
      regionTargets: input.region_targets,
    });
    if (resolved.error) {
      return { ok: false, error: resolved.error, method };
    }
    weights = resolved.weights;
    methodNote = resolved.note;
    usedMethod = resolved.method;
    volDiagnostics = resolved.volDiagnostics;
  }

  // Keep zero-weight legs out of the contribution narrative only.
  const portRet = new Array(dates.length).fill(0);
  const eqRet = new Array(dates.length).fill(0);

  for (let i = 0; i < dates.length; i++) {
    let p = 0;
    let e = 0;
    for (let j = 0; j < tickers.length; j++) {
      const r = legRets[tickers[j]][i];
      p += r * weights[j];
      e += r * (1 / tickers.length);
    }
    portRet[i] = p;
    eqRet[i] = e;
  }

  const portCum = cumprod(portRet);
  const benchCum = cumprod(benchRet);
  const eqCum = cumprod(eqRet);
  const legCums: Record<string, number[]> = {};
  for (const t of tickers) legCums[t] = cumprod(legRets[t]);

  const portStats = annStats(portRet, portCum[portCum.length - 1]);
  const benchStats = annStats(benchRet, benchCum[benchCum.length - 1]);
  const eqStats = annStats(eqRet, eqCum[eqCum.length - 1]);

  const idx = downsample(dates.map((_, i) => i));
  const series: SimulateResult["series"] = {
    date: idx.map((i) => dates[i]),
    portfolio: idx.map((i) => round(portCum[i] * capital, 2)),
    benchmark: idx.map((i) => round(benchCum[i] * capital, 2)),
    equal_weight: idx.map((i) => round(eqCum[i] * capital, 2)),
  };
  for (const t of tickers) {
    series[t] = idx.map((i) => round(legCums[t][i] * capital, 2));
  }

  const volByTicker = new Map(
    (volDiagnostics || []).map((d) => [d.ticker, d.annual_vol_pct]),
  );

  const contributions = tickers.map((t, j) => {
    const standalone = legCums[t][legCums[t].length - 1] - 1;
    return {
      ticker: t,
      weight_pct: round(weights[j] * 100, 2),
      standalone_return_pct: round(standalone * 100, 2),
      weighted_contribution_pct: round(weights[j] * standalone * 100, 2),
      annual_vol_pct: volByTicker.has(t)
        ? round(volByTicker.get(t) as number, 2)
        : undefined,
    };
  });

  return {
    ok: true,
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    trading_days: dates.length,
    initial_capital: capital,
    benchmark,
    tickers,
    weights: weights.map((w) => round(w, 6)),
    method: usedMethod,
    method_note: methodNote,
    asset_targets: input.asset_targets,
    region_targets: input.region_targets,
    vol_diagnostics: volDiagnostics?.map((d) => ({
      ...d,
      daily_vol: round(d.daily_vol, 6),
      annual_vol_pct: round(d.annual_vol_pct, 2),
      inv_vol_weight: round(d.inv_vol_weight, 6),
    })),
    metrics: {
      portfolio: {
        ...portStats,
        max_drawdown_pct: round(maxDrawdown(portCum), 2),
        final_value: round(portCum[portCum.length - 1] * capital, 2),
      },
      benchmark: {
        ...benchStats,
        max_drawdown_pct: round(maxDrawdown(benchCum), 2),
        final_value: round(benchCum[benchCum.length - 1] * capital, 2),
      },
      equal_weight: {
        ...eqStats,
        max_drawdown_pct: round(maxDrawdown(eqCum), 2),
        final_value: round(eqCum[eqCum.length - 1] * capital, 2),
      },
      allocation_effect_pct: round(portStats.total_return_pct - eqStats.total_return_pct, 2),
      excess_vs_benchmark_pct: round(portStats.total_return_pct - benchStats.total_return_pct, 2),
    },
    contributions,
    series,
  };
}
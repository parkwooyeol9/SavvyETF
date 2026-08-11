/**
 * Reconstruct ~1y US ETF AUM / NAV / units histories from Yahoo daily closes.
 *
 * Method (same spirit as KR etfAumHistory):
 *   aum_i,t ≈ aum_i,today × (P_i,t / P_i,today)
 *   nav_i,t ≈ P_i,t  (ETF close as NAV proxy; scaled to live NAV at end)
 *   units_i,t ≈ aum_i,t / nav_i,t   (≈ constant under price scaling;
 *                real Δunits appear once daily R2 snapshots accumulate)
 */

import type {
  EtfDbUsAggregate,
  EtfDbUsDimension,
  EtfDbUsHistory,
  EtfDbUsRow,
} from "@/lib/etfDbUs";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const LOOKBACK_DAYS = 400;
const TOP_PER_LABEL = 10;
const TOP_FOR_TOTAL = 40;
const MAX_LABELS = 18;
const FETCH_CONCURRENCY = 10;
const CACHE_TTL_MS = 30 * 60_000;

export type UsTickerSeries = {
  symbol: string;
  name: string;
  dates: string[];
  nav: Array<number | null>;
  units: Array<number | null>;
  aum_mn: Array<number | null>;
};

export type UsHistoryBundle = {
  aum_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  nav_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  units_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  ticker_series: Record<string, UsTickerSeries>;
  method_note: string;
};

type PriceMap = Map<string, number>;

const memCache = new Map<string, { expires: number; value: UsHistoryBundle }>();

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker()),
  );
  return out;
}

async function fetchYahooDailyCloses(symbol: string): Promise<PriceMap> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - LOOKBACK_DAYS * 86400;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return new Map();
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out: PriceMap = new Map();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !(c > 0)) continue;
    const d = new Date(ts[i]! * 1000);
    const ymd = d.toISOString().slice(0, 10);
    out.set(ymd, c);
  }
  return out;
}

function pickSample(
  rows: EtfDbUsRow[],
  dimension: EtfDbUsDimension,
  label: string,
): EtfDbUsRow[] {
  const pool =
    label === "전체" ? rows : rows.filter((r) => r[dimension] === label);
  return [...pool]
    .sort((a, b) => (b.aum_mn || 0) - (a.aum_mn || 0))
    .slice(0, label === "전체" ? TOP_FOR_TOTAL : TOP_PER_LABEL)
    .filter((r) => r.symbol && (r.aum_mn || 0) > 0);
}

function unionSortedDates(prices: Map<string, PriceMap>): string[] {
  const set = new Set<string>();
  for (const map of prices.values()) {
    for (const d of map.keys()) set.add(d);
  }
  return [...set].sort();
}

function reconstructAumSeries(
  sample: EtfDbUsRow[],
  prices: Map<string, PriceMap>,
  categoryAumToday: number,
  dates: string[],
): Array<number | null> {
  if (!sample.length || categoryAumToday <= 0) return dates.map(() => null);

  const anchors = sample.map((row) => {
    const map = prices.get(row.symbol);
    if (!map?.size) return null;
    let todayPx: number | null = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      const px = map.get(dates[i]!);
      if (px && px > 0) {
        todayPx = px;
        break;
      }
    }
    if (!todayPx) {
      const last = [...map.values()].at(-1);
      todayPx = last && last > 0 ? last : null;
    }
    if (!todayPx) return null;
    return { aum: row.aum_mn || 0, todayPx, map };
  });

  const usable = anchors.filter(Boolean) as Array<{
    aum: number;
    todayPx: number;
    map: PriceMap;
  }>;
  if (!usable.length) return dates.map(() => null);
  const sampleToday = usable.reduce((s, a) => s + a.aum, 0);
  if (sampleToday <= 0) return dates.map(() => null);
  const scale = categoryAumToday / sampleToday;

  return dates.map((date) => {
    let sum = 0;
    let hit = 0;
    for (const a of usable) {
      const px = a.map.get(date);
      if (!px || px <= 0) continue;
      sum += a.aum * (px / a.todayPx);
      hit += 1;
    }
    if (hit < Math.max(1, Math.ceil(usable.length * 0.4))) return null;
    return sum * scale;
  });
}

/** AUM-weighted NAV index, rebased to 100 at first valid point. */
function reconstructNavIndex(
  sample: EtfDbUsRow[],
  prices: Map<string, PriceMap>,
  dates: string[],
): Array<number | null> {
  if (!sample.length) return dates.map(() => null);
  const raw = dates.map((date) => {
    let wSum = 0;
    let vSum = 0;
    for (const row of sample) {
      const map = prices.get(row.symbol);
      const px = map?.get(date);
      const aum = row.aum_mn || 0;
      if (!px || !(px > 0) || !(aum > 0)) continue;
      // Use live NAV scale: nav_t ≈ liveNav * (px_t / px_today)
      let todayPx: number | null = null;
      for (let i = dates.length - 1; i >= 0; i--) {
        const p = map!.get(dates[i]!);
        if (p && p > 0) {
          todayPx = p;
          break;
        }
      }
      if (!todayPx) continue;
      const liveNav = row.nav && row.nav > 0 ? row.nav : todayPx;
      const navT = liveNav * (px / todayPx);
      wSum += aum;
      vSum += aum * navT;
    }
    if (wSum <= 0) return null;
    return vSum / wSum;
  });

  let base: number | null = null;
  for (const v of raw) {
    if (v != null && v > 0) {
      base = v;
      break;
    }
  }
  if (!base) return dates.map(() => null);
  return raw.map((v) => (v == null ? null : (100 * v) / base));
}

/** Sum of member units (≈ flat under price-only backfill). */
function reconstructUnitsSum(
  sample: EtfDbUsRow[],
  dates: string[],
): Array<number | null> {
  const total = sample.reduce((s, r) => s + (r.units || 0), 0);
  if (!(total > 0)) return dates.map(() => null);
  return dates.map(() => total);
}

function buildDimHistories(
  rows: EtfDbUsRow[],
  dimension: EtfDbUsDimension,
  aggregates: EtfDbUsAggregate[],
  prices: Map<string, PriceMap>,
  dates: string[],
): { aum: EtfDbUsHistory; nav: EtfDbUsHistory; units: EtfDbUsHistory } {
  const labels = [
    "전체",
    ...aggregates.slice(0, MAX_LABELS - 1).map((a) => a.label),
  ];
  const aumToday: Record<string, number> = {
    전체: rows.reduce((s, r) => s + (r.aum_mn || 0), 0),
  };
  for (const a of aggregates) aumToday[a.label] = a.aum_mn || 0;

  const aumSeries: Record<string, Array<number | null>> = {};
  const navSeries: Record<string, Array<number | null>> = {};
  const unitsSeries: Record<string, Array<number | null>> = {};

  for (const label of labels) {
    const sample = pickSample(rows, dimension, label);
    const aumVals = reconstructAumSeries(
      sample,
      prices,
      aumToday[label] || 0,
      dates,
    );
    // Pin latest trading day to live AUM (chart last bar = dashboard total).
    if (dates.length && aumToday[label] != null) {
      aumVals[dates.length - 1] = aumToday[label]!;
    }
    aumSeries[label] = aumVals;
    navSeries[label] = reconstructNavIndex(sample, prices, dates);
    unitsSeries[label] = reconstructUnitsSum(sample, dates);
  }

  return {
    aum: { dates, series: aumSeries },
    nav: { dates, series: navSeries },
    units: { dates, series: unitsSeries },
  };
}

function buildTickerSeries(
  rows: EtfDbUsRow[],
  prices: Map<string, PriceMap>,
  dates: string[],
): Record<string, UsTickerSeries> {
  const out: Record<string, UsTickerSeries> = {};
  for (const row of rows) {
    const map = prices.get(row.symbol);
    if (!map?.size) continue;
    let todayPx: number | null = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      const px = map.get(dates[i]!);
      if (px && px > 0) {
        todayPx = px;
        break;
      }
    }
    if (!todayPx) continue;
    const liveNav = row.nav && row.nav > 0 ? row.nav : todayPx;
    const liveUnits =
      row.units && row.units > 0
        ? row.units
        : row.aum_mn > 0 && liveNav > 0
          ? (row.aum_mn * 1_000_000) / liveNav
          : null;
    const liveAum = row.aum_mn || 0;

    const nav: Array<number | null> = [];
    const units: Array<number | null> = [];
    const aum_mn: Array<number | null> = [];
    for (const d of dates) {
      const px = map.get(d);
      if (!px || !(px > 0)) {
        nav.push(null);
        units.push(null);
        aum_mn.push(null);
        continue;
      }
      const navT = liveNav * (px / todayPx);
      nav.push(navT);
      units.push(liveUnits);
      // Price-scaled AUM; pin end to live AUM via scale on last day handled below
      aum_mn.push(liveAum > 0 ? liveAum * (px / todayPx) : null);
    }
    if (dates.length && liveAum > 0) {
      aum_mn[dates.length - 1] = liveAum;
    }
    if (dates.length) {
      nav[dates.length - 1] = liveNav;
      if (liveUnits != null) units[dates.length - 1] = liveUnits;
    }

    out[row.symbol] = {
      symbol: row.symbol,
      name: row.name,
      dates,
      nav,
      units,
      aum_mn,
    };
  }
  return out;
}

export async function reconstructUsHistories(opts: {
  rows: EtfDbUsRow[];
  aggregates: Record<EtfDbUsDimension, EtfDbUsAggregate[]>;
  liveDay: string;
  equityOnly: boolean;
  watchOnly: boolean;
}): Promise<UsHistoryBundle> {
  const cacheKey = `${opts.equityOnly ? "eq" : "all"}|${opts.watchOnly ? "w" : "u"}|${opts.liveDay}|${opts.rows.length}`;
  const hit = memCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const dims: EtfDbUsDimension[] = ["type", "region", "sector", "theme"];
  const codeSet = new Set<string>();
  for (const dim of dims) {
    for (const label of [
      "전체",
      ...opts.aggregates[dim].slice(0, MAX_LABELS - 1).map((a) => a.label),
    ]) {
      for (const row of pickSample(opts.rows, dim, label)) {
        codeSet.add(row.symbol);
      }
    }
  }
  // Always include watchlist / top names for ticker charts
  for (const row of opts.rows) {
    if (row.watch || (row.aum_mn || 0) > 5_000) codeSet.add(row.symbol);
  }

  const codes = [...codeSet];
  const fetched = await mapPool(codes, FETCH_CONCURRENCY, async (sym) => {
    try {
      return [sym, await fetchYahooDailyCloses(sym)] as const;
    } catch {
      return [sym, new Map() as PriceMap] as const;
    }
  });
  const prices = new Map(fetched);
  // Use Yahoo trading calendar only (do not append empty "today" UTC day).
  const dates = unionSortedDates(prices).slice(-260); // ~1y trading days

  const aum_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
  const nav_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
  const units_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;

  for (const dim of dims) {
    const built = buildDimHistories(
      opts.rows,
      dim,
      opts.aggregates[dim],
      prices,
      dates,
    );
    aum_history[dim] = built.aum;
    nav_history[dim] = built.nav;
    units_history[dim] = built.units;
  }

  const tickerRows = opts.rows.filter(
    (r) => r.watch || codeSet.has(r.symbol),
  );
  const ticker_series = buildTickerSeries(tickerRows, prices, dates);

  const value: UsHistoryBundle = {
    aum_history,
    nav_history,
    units_history,
    ticker_series,
    method_note:
      "과거 1년 AUM·NAV는 Yahoo 일별 종가×당일 설정좌수로 복원(ETF 종가≈NAV, AUM_t≈AUM_today×P_t/P_today). " +
      "설정좌수 시계열은 복원 시 거의 일정하며, 실제 설정·환매(Δ좌수)는 일별 스냅샷이 쌓이면 반영됩니다.",
  };
  memCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

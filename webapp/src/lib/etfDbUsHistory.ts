/**
 * Reconstruct ~1y US ETF AUM / NAV / ETF-수급 histories.
 *
 * AUM / NAV (price proxy):
 *   aum_i,t ≈ aum_i,today × (P_i,t / P_i,today)
 *   nav_i,t ≈ liveNav × (P_i,t / P_i,today)
 *
 * ETF 수급 계정 (stitched):
 *   flow_daily_t = NAV_t × (units_t − units_{t−1}) / 1e6   ($M)
 *   flow_cum_t   = Σ flow_daily   ← the continuous "ETF 수급" account
 *
 * Units: start from live shares (price-scaled backfill ⇒ Δunits≈0 historically).
 * When dated R2 snapshots exist, overlay real units by as_of date so Δunits
 * (and therefore 수급) become non-zero going forward.
 */

import type {
  EtfDbUsAggregate,
  EtfDbUsDimension,
  EtfDbUsHistory,
  EtfDbUsRow,
  EtfDbUsTickerSeries,
} from "@/lib/etfDbUs";
import { ETF_DB_US_SNAP_PREFIX } from "@/lib/etfDbUs";
import { r2Configured, r2GetObjectText, r2ListKeys } from "@/lib/r2";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const LOOKBACK_DAYS = 400;
const TOP_PER_LABEL = 12;
const TOP_FOR_TOTAL = 50;
const MAX_LABELS = 18;
const FETCH_CONCURRENCY = 10;
const CACHE_TTL_MS = 30 * 60_000;
const MAX_SNAP_OVERLAY = 60;

export type UsHistoryBundle = {
  aum_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  nav_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  flow_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  flow_daily_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  ticker_series: Record<string, EtfDbUsTickerSeries>;
  method_note: string;
};

type PriceMap = Map<string, number>;
/** symbol → date → units */
type UnitsOverlay = Map<string, Map<string, number>>;

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

/** Load recent dated R2 snapshots → units by symbol/date. */
async function loadUnitsOverlay(): Promise<UnitsOverlay> {
  const out: UnitsOverlay = new Map();
  if (!r2Configured()) return out;
  try {
    const keys = (await r2ListKeys(ETF_DB_US_SNAP_PREFIX))
      .filter((k) => k.endsWith(".json"))
      .sort()
      .slice(-MAX_SNAP_OVERLAY);
    for (const key of keys) {
      const m = key.match(/(\d{4}-\d{2}-\d{2})\.json$/);
      if (!m) continue;
      const day = m[1]!;
      const text = await r2GetObjectText(key);
      if (!text) continue;
      const data = JSON.parse(text) as {
        rows?: Array<{ symbol?: string; units?: number | null }>;
      };
      for (const r of data.rows || []) {
        if (!r.symbol || r.units == null || !(r.units > 0)) continue;
        const sym = r.symbol.toUpperCase();
        if (!out.has(sym)) out.set(sym, new Map());
        out.get(sym)!.set(day, r.units);
      }
    }
  } catch {
    /* ignore overlay failures */
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

/** Daily flow → cumulative 수급 account. */
function toCumFlow(daily: Array<number | null>): Array<number | null> {
  const out: Array<number | null> = [];
  let cum = 0;
  let started = false;
  for (const v of daily) {
    if (v == null) {
      out.push(started ? cum : null);
      continue;
    }
    started = true;
    cum += v;
    out.push(cum);
  }
  return out;
}

function buildTickerSeries(
  rows: EtfDbUsRow[],
  prices: Map<string, PriceMap>,
  dates: string[],
  overlay: UnitsOverlay,
): Record<string, EtfDbUsTickerSeries> {
  const out: Record<string, EtfDbUsTickerSeries> = {};
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
    const snapUnits = overlay.get(row.symbol);

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
      const u = snapUnits?.get(d) ?? liveUnits;
      units.push(u);
      aum_mn.push(liveAum > 0 ? liveAum * (px / todayPx) : null);
    }
    if (dates.length && liveAum > 0) {
      aum_mn[dates.length - 1] = liveAum;
    }
    if (dates.length) {
      nav[dates.length - 1] = liveNav;
      if (liveUnits != null) units[dates.length - 1] = liveUnits;
    }

    // ETF 수급: each day NAV × Δunits, then stitch (cumsum)
    const flow_daily_mn: Array<number | null> = dates.map((_, i) => {
      if (i === 0) return 0;
      const n = nav[i];
      const u = units[i];
      const pu = units[i - 1];
      if (n == null || !(n > 0) || u == null || pu == null) return null;
      return (n * (u - pu)) / 1_000_000;
    });
    // Pin latest daily flow to live row.flow_mn when available (R2 prev snap).
    if (dates.length && row.flow_mn != null && Number.isFinite(row.flow_mn)) {
      flow_daily_mn[dates.length - 1] = row.flow_mn;
    }
    const flow_cum_mn = toCumFlow(flow_daily_mn);

    out[row.symbol] = {
      symbol: row.symbol,
      name: row.name,
      dates,
      nav,
      units,
      aum_mn,
      flow_daily_mn,
      flow_cum_mn,
    };
  }
  return out;
}

function sumMemberFlows(
  memberSymbols: string[],
  ticker_series: Record<string, EtfDbUsTickerSeries>,
  dates: string[],
  kind: "daily" | "cum",
): Array<number | null> {
  const series = memberSymbols
    .map((s) => ticker_series[s])
    .filter(Boolean) as EtfDbUsTickerSeries[];
  if (!series.length) return dates.map(() => null);

  if (kind === "daily") {
    return dates.map((_, i) => {
      let sum = 0;
      let hit = 0;
      for (const ts of series) {
        const v = ts.flow_daily_mn[i];
        if (v == null || !Number.isFinite(v)) continue;
        sum += v;
        hit += 1;
      }
      return hit ? sum : null;
    });
  }

  // Cumulative account = stitch of summed daily flows (not sum of cum series)
  const daily = dates.map((_, i) => {
    let sum = 0;
    let hit = 0;
    for (const ts of series) {
      const v = ts.flow_daily_mn[i];
      if (v == null || !Number.isFinite(v)) continue;
      sum += v;
      hit += 1;
    }
    return hit ? sum : null;
  });
  return toCumFlow(daily);
}

function buildDimHistories(
  rows: EtfDbUsRow[],
  dimension: EtfDbUsDimension,
  aggregates: EtfDbUsAggregate[],
  prices: Map<string, PriceMap>,
  dates: string[],
  ticker_series: Record<string, EtfDbUsTickerSeries>,
): {
  aum: EtfDbUsHistory;
  nav: EtfDbUsHistory;
  flow: EtfDbUsHistory;
  flowDaily: EtfDbUsHistory;
} {
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
  const flowSeries: Record<string, Array<number | null>> = {};
  const flowDailySeries: Record<string, Array<number | null>> = {};

  for (const label of labels) {
    const sample = pickSample(rows, dimension, label);
    const aumVals = reconstructAumSeries(
      sample,
      prices,
      aumToday[label] || 0,
      dates,
    );
    if (dates.length && aumToday[label] != null) {
      aumVals[dates.length - 1] = aumToday[label]!;
    }
    aumSeries[label] = aumVals;
    navSeries[label] = reconstructNavIndex(sample, prices, dates);

    const members =
      label === "전체"
        ? rows.map((r) => r.symbol)
        : rows.filter((r) => r[dimension] === label).map((r) => r.symbol);
    // Prefer sample symbols that actually have series; fall back to all members
    const withSeries = members.filter((s) => ticker_series[s]);
    const use =
      withSeries.length > 0
        ? withSeries
        : sample.map((r) => r.symbol).filter((s) => ticker_series[s]);
    flowDailySeries[label] = sumMemberFlows(use, ticker_series, dates, "daily");
    flowSeries[label] = sumMemberFlows(use, ticker_series, dates, "cum");
  }

  return {
    aum: { dates, series: aumSeries },
    nav: { dates, series: navSeries },
    flow: { dates, series: flowSeries },
    flowDaily: { dates, series: flowDailySeries },
  };
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
  for (const row of opts.rows) {
    if (row.watch || (row.aum_mn || 0) > 3_000) codeSet.add(row.symbol);
  }

  const codes = [...codeSet];
  const [fetched, overlay] = await Promise.all([
    mapPool(codes, FETCH_CONCURRENCY, async (sym) => {
      try {
        return [sym, await fetchYahooDailyCloses(sym)] as const;
      } catch {
        return [sym, new Map() as PriceMap] as const;
      }
    }),
    loadUnitsOverlay(),
  ]);
  const prices = new Map(fetched);
  const dates = unionSortedDates(prices).slice(-260);

  const tickerRows = opts.rows.filter(
    (r) => r.watch || codeSet.has(r.symbol),
  );
  const ticker_series = buildTickerSeries(tickerRows, prices, dates, overlay);

  const aum_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
  const nav_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
  const flow_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
  const flow_daily_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;

  for (const dim of dims) {
    const built = buildDimHistories(
      opts.rows,
      dim,
      opts.aggregates[dim],
      prices,
      dates,
      ticker_series,
    );
    aum_history[dim] = built.aum;
    nav_history[dim] = built.nav;
    flow_history[dim] = built.flow;
    flow_daily_history[dim] = built.flowDaily;
  }

  const snapDays = new Set<string>();
  for (const m of overlay.values()) for (const d of m.keys()) snapDays.add(d);

  const value: UsHistoryBundle = {
    aum_history,
    nav_history,
    flow_history,
    flow_daily_history,
    ticker_series,
    method_note:
      "ETF 수급 계정 = 각 시점 NAV×Δ설정좌수($M)를 일별로 산출한 뒤 누적(이어붙임). " +
      "AUM·NAV 1년은 Yahoo 종가 비율로 복원(AUM_t≈AUM_today×P_t/P_today). " +
      (snapDays.size
        ? `설정좌수는 R2 일별 스냅샷 ${snapDays.size}일로 Δ좌수(수급)를 보정합니다.`
        : "설정좌수 과거분은 당일 좌수로 고정되어 역사 수급≈0이며, 일별 스냅샷이 쌓이면 수급 계정이 채워집니다."),
  };
  memCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

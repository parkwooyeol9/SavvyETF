/**
 * Reconstruct ~1y US ETF AUM / 거래대금 / ETF-수급 histories.
 *
 * 거래대금 (primary):
 *   turnover_daily_t = close_t × volume_t / 1e6   ($M)
 *   turnover_cum_t   = Σ turnover_daily
 *   Category series = sum of member turnovers (then cum for cumulative view)
 *
 * AUM / NAV (price proxy):
 *   aum_i,t ≈ aum_i,today × (P_i,t / P_i,today)
 *
 * ETF 수급 (side / experimental until R2 units accumulate):
 *   flow_daily_t = NAV_t × (units_t − units_{t−1}) / 1e6
 *   flow_cum_t   = Σ flow_daily
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
const FETCH_CONCURRENCY = 12;
const CACHE_TTL_MS = 30 * 60_000;
const MAX_SNAP_OVERLAY = 60;
/** Cap Yahoo history fetches — full 1000-ticker charts would time out. */
const HISTORY_SYMBOL_CAP = 160;

export type UsHistoryBundle = {
  aum_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  nav_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  turnover_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  turnover_daily_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  flow_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  flow_daily_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  ticker_series: Record<string, EtfDbUsTickerSeries>;
  method_note: string;
};

type DayBar = { close: number; volume: number };
type BarMap = Map<string, DayBar>;
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

async function fetchYahooDailyBars(symbol: string): Promise<BarMap> {
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
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const volumes = result?.indicators?.quote?.[0]?.volume || [];
  const out: BarMap = new Map();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    const v = volumes[i];
    if (c == null || !(c > 0)) continue;
    const d = new Date(ts[i]! * 1000);
    const ymd = d.toISOString().slice(0, 10);
    out.set(ymd, { close: c, volume: v != null && v > 0 ? v : 0 });
  }
  return out;
}

/** Close-only view for AUM/NAV helpers. */
function toPriceMap(bars: Map<string, BarMap>): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [sym, map] of bars) {
    const pm = new Map<string, number>();
    for (const [d, bar] of map) pm.set(d, bar.close);
    out.set(sym, pm);
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

function unionSortedDates(bars: Map<string, BarMap>): string[] {
  const set = new Set<string>();
  for (const map of bars.values()) {
    for (const d of map.keys()) set.add(d);
  }
  return [...set].sort();
}

type PriceMap = Map<string, number>;

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

/** Daily series → cumulative account. */
function toCum(daily: Array<number | null>): Array<number | null> {
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
  bars: Map<string, BarMap>,
  dates: string[],
  overlay: UnitsOverlay,
): Record<string, EtfDbUsTickerSeries> {
  const out: Record<string, EtfDbUsTickerSeries> = {};
  for (const row of rows) {
    const map = bars.get(row.symbol);
    if (!map?.size) continue;
    let todayPx: number | null = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      const bar = map.get(dates[i]!);
      if (bar && bar.close > 0) {
        todayPx = bar.close;
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
    const turnover_daily_mn: Array<number | null> = [];
    for (const d of dates) {
      const bar = map.get(d);
      if (!bar || !(bar.close > 0)) {
        nav.push(null);
        units.push(null);
        aum_mn.push(null);
        turnover_daily_mn.push(null);
        continue;
      }
      const navT = liveNav * (bar.close / todayPx);
      nav.push(navT);
      const u = snapUnits?.get(d) ?? liveUnits;
      units.push(u);
      aum_mn.push(liveAum > 0 ? liveAum * (bar.close / todayPx) : null);
      turnover_daily_mn.push((bar.close * bar.volume) / 1_000_000);
    }
    if (dates.length && liveAum > 0) {
      aum_mn[dates.length - 1] = liveAum;
    }
    if (dates.length) {
      nav[dates.length - 1] = liveNav;
      if (liveUnits != null) units[dates.length - 1] = liveUnits;
      if (row.turnover_mn != null && Number.isFinite(row.turnover_mn)) {
        turnover_daily_mn[dates.length - 1] = row.turnover_mn;
      }
    }

    const flow_daily_mn: Array<number | null> = dates.map((_, i) => {
      if (i === 0) return 0;
      const n = nav[i];
      const u = units[i];
      const pu = units[i - 1];
      if (n == null || !(n > 0) || u == null || pu == null) return null;
      return (n * (u - pu)) / 1_000_000;
    });
    if (dates.length && row.flow_mn != null && Number.isFinite(row.flow_mn)) {
      flow_daily_mn[dates.length - 1] = row.flow_mn;
    }

    out[row.symbol] = {
      symbol: row.symbol,
      name: row.name,
      dates,
      nav,
      units,
      aum_mn,
      turnover_daily_mn,
      turnover_cum_mn: toCum(turnover_daily_mn),
      flow_daily_mn,
      flow_cum_mn: toCum(flow_daily_mn),
    };
  }
  return out;
}

function sumMemberSeries(
  memberSymbols: string[],
  ticker_series: Record<string, EtfDbUsTickerSeries>,
  dates: string[],
  field: "flow_daily_mn" | "turnover_daily_mn",
): Array<number | null> {
  const series = memberSymbols
    .map((s) => ticker_series[s] || ticker_series[s.toUpperCase()])
    .filter(Boolean) as EtfDbUsTickerSeries[];
  if (!series.length) return dates.map(() => null);

  return dates.map((_, i) => {
    let sum = 0;
    let hit = 0;
    for (const ts of series) {
      const v = ts[field][i];
      if (v == null || !Number.isFinite(v)) continue;
      sum += v;
      hit += 1;
    }
    return hit ? sum : null;
  });
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
  turnover: EtfDbUsHistory;
  turnoverDaily: EtfDbUsHistory;
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
  const turnoverSeries: Record<string, Array<number | null>> = {};
  const turnoverDailySeries: Record<string, Array<number | null>> = {};
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
    const use = members.filter((s) => ticker_series[s]);
    const liveMembers =
      label === "전체" ? rows : rows.filter((r) => r[dimension] === label);

    const turnDaily = sumMemberSeries(use, ticker_series, dates, "turnover_daily_mn");
    if (dates.length) {
      const liveTurns = liveMembers
        .map((r) => r.turnover_mn)
        .filter((v): v is number => v != null && Number.isFinite(v));
      if (liveTurns.length) {
        turnDaily[dates.length - 1] = liveTurns.reduce((s, v) => s + v, 0);
      }
    }
    turnoverDailySeries[label] = turnDaily;
    turnoverSeries[label] = toCum(turnDaily);

    const flowDaily = sumMemberSeries(use, ticker_series, dates, "flow_daily_mn");
    if (dates.length) {
      const liveFlows = liveMembers
        .map((r) => r.flow_mn)
        .filter((v): v is number => v != null && Number.isFinite(v));
      if (liveFlows.length) {
        flowDaily[dates.length - 1] = liveFlows.reduce((s, v) => s + v, 0);
      } else if (use.length && flowDaily[dates.length - 1] == null) {
        flowDaily[dates.length - 1] = 0;
      }
    }
    flowDailySeries[label] = flowDaily;
    flowSeries[label] = toCum(flowDaily);
  }

  return {
    aum: { dates, series: aumSeries },
    nav: { dates, series: navSeries },
    turnover: { dates, series: turnoverSeries },
    turnoverDaily: { dates, series: turnoverDailySeries },
    flow: { dates, series: flowSeries },
    flowDaily: { dates, series: flowDailySeries },
  };
}

function pickHistorySymbols(rows: EtfDbUsRow[]): string[] {
  const dims: EtfDbUsDimension[] = ["type", "region", "sector", "theme"];
  const picked: string[] = [];
  const push = (sym: string | undefined) => {
    if (!sym) return;
    picked.push(sym.toUpperCase());
  };

  for (const r of rows) {
    if (r.watch) push(r.symbol);
  }
  for (const r of [...rows].sort((a, b) => (b.aum_mn || 0) - (a.aum_mn || 0)).slice(0, 80)) {
    push(r.symbol);
  }
  for (const r of [...rows]
    .sort((a, b) => (b.turnover_mn || 0) - (a.turnover_mn || 0))
    .slice(0, 40)) {
    push(r.symbol);
  }
  for (const dim of dims) {
    const labels = [
      ...new Set(rows.map((r) => String(r[dim] || "기타"))),
    ].slice(0, MAX_LABELS);
    for (const label of labels) {
      for (const r of pickSample(rows, dim, label)) push(r.symbol);
    }
    for (const r of pickSample(rows, dim, "전체")) push(r.symbol);
  }

  const unique = [...new Set(picked)];
  return unique.slice(0, HISTORY_SYMBOL_CAP);
}

export async function reconstructUsHistories(opts: {
  rows: EtfDbUsRow[];
  aggregates: Record<EtfDbUsDimension, EtfDbUsAggregate[]>;
  liveDay: string;
  equityOnly: boolean;
  watchOnly: boolean;
}): Promise<UsHistoryBundle> {
  const cacheKey = `v4turn|${opts.equityOnly ? "eq" : "all"}|${opts.watchOnly ? "w" : "u"}|${opts.liveDay}|${opts.rows.length}`;
  const hit = memCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const dims: EtfDbUsDimension[] = ["type", "region", "sector", "theme"];
  const codes = pickHistorySymbols(opts.rows);
  const [fetched, overlay] = await Promise.all([
    mapPool(codes, FETCH_CONCURRENCY, async (sym) => {
      try {
        return [sym, await fetchYahooDailyBars(sym)] as const;
      } catch {
        return [sym, new Map() as BarMap] as const;
      }
    }),
    loadUnitsOverlay(),
  ]);
  const bars = new Map(fetched);
  const prices = toPriceMap(bars);
  const dates = unionSortedDates(bars).slice(-260);

  // Ticker series only for symbols we actually charted (UI clicks those rows).
  const seriesRows = opts.rows.filter((r) => bars.has(r.symbol.toUpperCase()));
  const ticker_series = buildTickerSeries(seriesRows, bars, dates, overlay);

  const aum_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
  const nav_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
  const turnover_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
  const turnover_daily_history = {} as Record<EtfDbUsDimension, EtfDbUsHistory>;
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
    turnover_history[dim] = built.turnover;
    turnover_daily_history[dim] = built.turnoverDaily;
    flow_history[dim] = built.flow;
    flow_daily_history[dim] = built.flowDaily;
  }

  const snapDays = new Set<string>();
  for (const m of overlay.values()) for (const d of m.keys()) snapDays.add(d);

  const value: UsHistoryBundle = {
    aum_history,
    nav_history,
    turnover_history,
    turnover_daily_history,
    flow_history,
    flow_daily_history,
    ticker_series,
    method_note:
      `거래대금 = 종가×거래량($M). 섹터/테마별 일별 합산 후 누적. ` +
      `히스토리 차트는 AUM·거래대금 상위 및 워치 테마 중심 ${codes.length}종 샘플. ` +
      "AUM은 Yahoo 종가 비율 복원. ETF 수급(NAV×Δ좌수)은 사이드에 유지하며, " +
      (snapDays.size
        ? `R2 스냅샷 ${snapDays.size}일로 Δ좌수를 보정합니다.`
        : "일별 스냅샷이 쌓이기 전에는 역사 수급≈0일 수 있습니다."),
  };
  memCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

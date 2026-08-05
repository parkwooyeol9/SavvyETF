/**
 * Reconstruct multi-day category AUM from constituent ETF price history.
 *
 * Bot snapshots are often too short (or skipped for equity-only). Approximate:
 *   aum_i,t ≈ aum_i,today × (P_i,t / P_i,today)
 * then scale the sample sum to the live category total.
 */

import type {
  EtfDbAggregate,
  EtfDbDimension,
  EtfDbHistory,
  EtfDbRow,
} from "@/lib/etfDb";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const TOP_PER_LABEL = 8;
const TOP_FOR_TOTAL = 36;
const LOOKBACK_DAYS = 90;
const MAX_LABELS = 16; // 전체 + top categories
const FETCH_CONCURRENCY = 10;

type PriceMap = Map<string, number>; // YYYY-MM-DD → close

const cache = new Map<string, { expires: number; value: Record<EtfDbDimension, EtfDbHistory> }>();

function ymdDash(ymd: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  if (/^\d{8}$/.test(ymd)) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  }
  return ymd;
}

function startYmd(daysBack: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function todayYmdCompact(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, "");
}

async function fetchDailyCloses(code: string): Promise<PriceMap> {
  const start = startYmd(LOOKBACK_DAYS + 40);
  const end = todayYmdCompact();
  const url =
    `https://fchart.stock.naver.com/siseJson.naver?symbol=${encodeURIComponent(code)}` +
    `&requestType=1&startTime=${start}&endTime=${end}&timeframe=day`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: "https://finance.naver.com/",
      Accept: "*/*",
    },
    cache: "no-store",
  });
  if (!res.ok) return new Map();
  const text = await res.text();
  const out: PriceMap = new Map();
  for (const m of text.matchAll(
    /\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g,
  )) {
    const close = Number(m[5]);
    if (!Number.isFinite(close) || close <= 0) continue;
    out.set(ymdDash(m[1]), close);
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function pickSampleCodes(
  rows: EtfDbRow[],
  dimension: EtfDbDimension,
  label: string,
): EtfDbRow[] {
  const pool =
    label === "전체" ? rows : rows.filter((r) => r[dimension] === label);
  return [...pool]
    .sort((a, b) => (b.aum_eok || 0) - (a.aum_eok || 0))
    .slice(0, label === "전체" ? TOP_FOR_TOTAL : TOP_PER_LABEL)
    .filter((r) => r.code && (r.aum_eok || 0) > 0);
}

function reconstructSeries(
  sample: EtfDbRow[],
  prices: Map<string, PriceMap>,
  categoryAumToday: number,
  dates: string[],
): Array<number | null> {
  if (!sample.length || categoryAumToday <= 0) {
    return dates.map(() => null);
  }

  const anchors = sample.map((row) => {
    const map = prices.get(row.code);
    if (!map || !map.size) return null;
    // Prefer latest available close as today anchor.
    let todayPx: number | null = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      const px = map.get(dates[i]);
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
    return { aum: row.aum_eok || 0, todayPx, map };
  });

  const usable = anchors.filter(Boolean) as Array<{
    aum: number;
    todayPx: number;
    map: PriceMap;
  }>;
  if (!usable.length) return dates.map(() => null);

  const sampleToday = usable.reduce(
    (s, a) => s + a.aum,
    0,
  );
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

function buildDimHistory(
  rows: EtfDbRow[],
  dimension: EtfDbDimension,
  aggregates: EtfDbAggregate[],
  prices: Map<string, PriceMap>,
  dates: string[],
  liveDay: string,
): EtfDbHistory {
  const labels = [
    "전체",
    ...aggregates.slice(0, MAX_LABELS - 1).map((a) => a.label),
  ];
  const aumToday: Record<string, number> = {
    전체: rows.reduce((s, r) => s + (r.aum_eok || 0), 0),
  };
  for (const a of aggregates) aumToday[a.label] = a.aum_eok || 0;

  const series: Record<string, Array<number | null>> = {};
  for (const label of labels) {
    const sample = pickSampleCodes(rows, dimension, label);
    const vals = reconstructSeries(
      sample,
      prices,
      aumToday[label] || 0,
      dates,
    );
    // Force live total on the last date when it matches today.
    if (dates.length && dates[dates.length - 1] === liveDay) {
      vals[vals.length - 1] = aumToday[label] ?? null;
    }
    series[label] = vals;
  }

  return { dates, series };
}

function unionSortedDates(prices: Map<string, PriceMap>, liveDay: string): string[] {
  const set = new Set<string>();
  for (const map of prices.values()) {
    for (const d of map.keys()) set.add(d);
  }
  set.add(liveDay);
  return [...set].sort();
}

export async function reconstructAumHistories(opts: {
  rows: EtfDbRow[];
  aggregates: Record<EtfDbDimension, EtfDbAggregate[]>;
  liveDay: string;
  equityOnly: boolean;
}): Promise<Record<EtfDbDimension, EtfDbHistory>> {
  const cacheKey = `${opts.equityOnly ? "eq" : "all"}|${opts.liveDay}|${opts.rows.length}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const dims: EtfDbDimension[] = ["type", "country", "sector", "index"];
  const codeSet = new Set<string>();
  for (const dim of dims) {
    for (const label of [
      "전체",
      ...opts.aggregates[dim].slice(0, MAX_LABELS - 1).map((a) => a.label),
    ]) {
      for (const row of pickSampleCodes(opts.rows, dim, label)) {
        codeSet.add(row.code);
      }
    }
  }
  const codes = [...codeSet];
  const fetched = await mapPool(codes, FETCH_CONCURRENCY, async (code) => {
    try {
      return [code, await fetchDailyCloses(code)] as const;
    } catch {
      return [code, new Map() as PriceMap] as const;
    }
  });
  const prices = new Map(fetched);
  const dates = unionSortedDates(prices, opts.liveDay).slice(-LOOKBACK_DAYS);

  const value = {
    type: buildDimHistory(
      opts.rows,
      "type",
      opts.aggregates.type,
      prices,
      dates,
      opts.liveDay,
    ),
    country: buildDimHistory(
      opts.rows,
      "country",
      opts.aggregates.country,
      prices,
      dates,
      opts.liveDay,
    ),
    sector: buildDimHistory(
      opts.rows,
      "sector",
      opts.aggregates.sector,
      prices,
      dates,
      opts.liveDay,
    ),
    index: buildDimHistory(
      opts.rows,
      "index",
      opts.aggregates.index,
      prices,
      dates,
      opts.liveDay,
    ),
  };

  cache.set(cacheKey, { expires: Date.now() + 15 * 60_000, value });
  return value;
}

/** Prefer longer history (reconstructed vs snapshot). */
export function pickRicherHistory(
  a: EtfDbHistory | undefined,
  b: EtfDbHistory | undefined,
): EtfDbHistory {
  const score = (h?: EtfDbHistory) => {
    if (!h?.dates?.length) return 0;
    const vals = h.series?.["전체"] || [];
    return vals.filter((v) => v != null).length;
  };
  return (score(b) > score(a) ? b : a) || { dates: [], series: {} };
}

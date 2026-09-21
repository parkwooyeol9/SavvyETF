import { withServerCache } from "@/lib/apiCache";
import {
  aggregateRows,
  type EtfDbDimension,
  type EtfDbHistory,
  type EtfDbRow,
} from "@/lib/etfDb";
import { r2Configured, r2GetObjectText, r2ListObjects } from "@/lib/r2";
import { ymdFromKey } from "@/lib/dataCatalog";

const SNAP_PREFIX = "etf_db/snapshots/";
const ARCH_PREFIX = "etf_db/archive/";
const MAX_DAYS = 400;
const FETCH_CONCURRENCY = 10;
const DIMS: EtfDbDimension[] = ["type", "country", "sector", "index"];

type CompactRow = {
  code?: string;
  nav?: number | null;
  units?: number | null;
  aum_eok?: number | null;
  type?: string;
  country?: string;
  sector?: string;
  index?: string;
};

type CompactSnap = {
  date?: string;
  rows?: CompactRow[];
};

function isEquityCompact(row: CompactRow): boolean {
  if (row.type === "채권" || row.type === "원자재" || row.type === "기타") return false;
  if (row.sector === "채권") return false;
  return true;
}

function asRow(row: CompactRow): EtfDbRow | null {
  const code = String(row.code || "").trim();
  if (!code) return null;
  return {
    code,
    name: "",
    tab_code: 0,
    type: String(row.type || "기타"),
    country: String(row.country || "기타"),
    sector: String(row.sector || "기타"),
    index: String(row.index || "기타"),
    index_style: "일반",
    benchmark: null,
    price: null,
    nav: row.nav ?? null,
    change_rate: null,
    return_3m: null,
    aum_eok: Number(row.aum_eok) || 0,
    units: row.units ?? null,
    flow_eok: null,
  };
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
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
      worker(),
    ),
  );
  return results;
}

function emptyHist(): EtfDbHistory {
  return { dates: [], series: {} };
}

function padSeries(
  series: Record<string, Array<number | null>>,
  seen: Set<string>,
  valueFor: (label: string) => number | null,
) {
  const len = (Object.values(series)[0]?.length || 0) + 1;
  for (const label of seen) {
    if (!series[label]) series[label] = Array.from({ length: len - 1 }, () => null);
    series[label].push(valueFor(label));
  }
  for (const label of Object.keys(series)) {
    if (!seen.has(label)) series[label].push(null);
  }
}

function keepSeries(
  series: Record<string, Array<number | null>>,
  extra: string[],
  abs = false,
): Record<string, Array<number | null>> {
  const ranked = Object.keys(series)
    .filter((k) => k !== "전체")
    .sort((a, b) => {
      const score = (lab: string) => {
        const vals = series[lab] || [];
        let sum = 0;
        for (const v of vals.slice(-10)) {
          if (v == null) continue;
          sum += abs ? Math.abs(v) : v;
        }
        return sum;
      };
      return score(b) - score(a);
    });
  const keep = Array.from(
    new Set(["전체", ...ranked.slice(0, 12), ...extra].filter((k) => series[k])),
  );
  return Object.fromEntries(keep.map((k) => [k, series[k]]));
}

async function listDayKeys(): Promise<Array<{ date: string; key: string }>> {
  const [hot, arch] = await Promise.all([
    r2ListObjects(SNAP_PREFIX),
    r2ListObjects(ARCH_PREFIX),
  ]);
  const byDate = new Map<string, string>();
  for (const item of [...arch, ...hot]) {
    if (!item.key.endsWith(".json")) continue;
    const date = ymdFromKey(item.key);
    if (!date) continue;
    const preferHot = item.key.startsWith(SNAP_PREFIX);
    const prev = byDate.get(date);
    if (!prev || preferHot) byDate.set(date, item.key);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-MAX_DAYS)
    .map(([date, key]) => ({ date, key }));
}

async function loadCompact(key: string): Promise<CompactSnap | null> {
  const text = await r2GetObjectText(key);
  if (!text) return null;
  try {
    return JSON.parse(text) as CompactSnap;
  } catch {
    return null;
  }
}

function buildAum(
  days: Array<{ date: string; rows: EtfDbRow[] }>,
  dim: EtfDbDimension,
): EtfDbHistory {
  const dates: string[] = [];
  const series: Record<string, Array<number | null>> = { 전체: [] };
  for (const day of days) {
    const aggs = aggregateRows(day.rows, dim);
    dates.push(day.date);
    const seen = new Set<string>(["전체"]);
    const total = aggs.reduce((s, a) => s + (a.aum_eok || 0), 0);
    const byLabel = Object.fromEntries(aggs.map((a) => [a.label, a.aum_eok]));
    byLabel["전체"] = total;
    for (const label of Object.keys(byLabel)) seen.add(label);
    padSeries(series, seen, (label) => byLabel[label] ?? null);
  }
  return { dates, series: keepSeries(series, []) };
}

function buildFlow(
  days: Array<{ date: string; rows: EtfDbRow[] }>,
  dim: EtfDbDimension,
): EtfDbHistory {
  if (days.length < 2) return emptyHist();
  const dates: string[] = [];
  const series: Record<string, Array<number | null>> = { 전체: [] };
  for (let i = 1; i < days.length; i++) {
    const prevMap = new Map(days[i - 1].rows.map((r) => [r.code, r]));
    const rows = days[i].rows.map((row) => {
      const prev = prevMap.get(row.code);
      if (!prev || row.units == null || prev.units == null || row.nav == null) {
        return { ...row, flow_eok: null };
      }
      const flowWon = row.nav * (row.units - prev.units);
      return { ...row, flow_eok: flowWon / 1e8 };
    });
    const aggs = aggregateRows(rows, dim);
    dates.push(days[i].date);
    const seen = new Set<string>(["전체"]);
    const total = aggs.reduce(
      (s, a) => s + (a.flow_available ? a.flow_eok || 0 : 0),
      0,
    );
    const byLabel: Record<string, number | null> = { 전체: total };
    for (const a of aggs) {
      seen.add(a.label);
      byLabel[a.label] = a.flow_available ? a.flow_eok : null;
    }
    padSeries(series, seen, (label) => byLabel[label] ?? null);
  }
  return { dates, series: keepSeries(series, [], true) };
}

export type EtfSnapHistory = {
  days: number;
  aum: Record<EtfDbDimension, EtfDbHistory>;
  flow: Record<EtfDbDimension, EtfDbHistory>;
};

async function assemble(equityOnly: boolean): Promise<EtfSnapHistory | null> {
  if (!r2Configured()) return null;
  const keys = await listDayKeys();
  if (!keys.length) return null;
  const loaded = await mapPool(keys, FETCH_CONCURRENCY, async (item) => {
    const snap = await loadCompact(item.key);
    const raw = (snap?.rows || [])
      .map(asRow)
      .filter((r): r is EtfDbRow => !!r);
    const rows = equityOnly ? raw.filter(isEquityCompact) : raw;
    return { date: item.date, rows };
  });
  const days = loaded.filter((d) => d.rows.length);
  if (!days.length) return null;
  const aum = {} as Record<EtfDbDimension, EtfDbHistory>;
  const flow = {} as Record<EtfDbDimension, EtfDbHistory>;
  for (const dim of DIMS) {
    aum[dim] = buildAum(days, dim);
    flow[dim] = buildFlow(days, dim);
  }
  return { days: days.length, aum, flow };
}

export async function loadEtfDbHistoryFromR2(opts: {
  equityOnly: boolean;
}): Promise<EtfSnapHistory | null> {
  const suffix = opts.equityOnly ? "eq" : "all";
  return withServerCache(
    `etf-db-snap-hist:v1:${suffix}`,
    30 * 60_000,
    2 * 60 * 60_000,
    () => assemble(opts.equityOnly),
  );
}

/** Fill nulls on primary dates from `fill`. Does not add reconstructed extra dates. */
export function fillHistoryGaps(
  primary: EtfDbHistory | undefined,
  fill: EtfDbHistory | undefined,
): EtfDbHistory {
  if (!primary?.dates?.length) return fill || emptyHist();
  if (!fill?.dates?.length) return primary;
  const fillAt = new Map<string, number>();
  fill.dates.forEach((d, i) => fillAt.set(d, i));
  const labels = new Set([
    ...Object.keys(primary.series || {}),
    ...Object.keys(fill.series || {}),
  ]);
  const series: Record<string, Array<number | null>> = {};
  for (const label of labels) {
    const p = primary.series[label] || primary.dates.map(() => null);
    const f = fill.series[label];
    series[label] = primary.dates.map((date, i) => {
      const pv = p[i];
      if (pv != null) return pv;
      const fi = fillAt.get(date);
      if (fi == null) return null;
      return f?.[fi] ?? null;
    });
  }
  return { dates: primary.dates, series };
}

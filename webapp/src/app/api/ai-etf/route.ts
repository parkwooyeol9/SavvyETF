import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import {
  AI_ETF_LENSES,
  AI_ETF_NOTE,
  AI_ETF_PROCESS,
  AI_ETF_TAKEAWAYS,
  AI_ETF_THEME,
  emptyAiEtfPayload,
  type AiEtfPayload,
  type AiEtfPoint,
  type AiEtfQuote,
  type AiEtfSpec,
} from "@/lib/aiEtf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type ChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }>;
      };
    }>;
  };
};

function downsample(points: AiEtfPoint[], maxPoints: number): AiEtfPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

function pctChange(last: number, prev: number | undefined): number | null {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  return Math.round((last / prev - 1) * 10000) / 100;
}

function formatPoint(tsSec: number): { date: string; label: string } {
  const d = new Date(tsSec * 1000);
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return { date: d.toISOString().slice(0, 10), label: `${mm}-${dd}` };
}

async function fetchCloses(symbol: string): Promise<{
  price: number | null;
  volume: number | null;
  change_1d_pct: number | null;
  change_1y_pct: number | null;
  series: AiEtfPoint[];
  error?: string;
}> {
  const empty = {
    price: null as number | null,
    volume: null as number | null,
    change_1d_pct: null as number | null,
    change_1y_pct: null as number | null,
    series: [] as AiEtfPoint[],
  };
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=1y&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ...empty, error: `HTTP ${res.status}` };
    const payload = (await res.json()) as ChartPayload;
    const result = payload.chart?.result?.[0];
    if (!result) return { ...empty, error: "no data" };
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0];
    const rawCloses = quote?.close || [];
    const rawVol = quote?.volume || [];
    const points: AiEtfPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = rawCloses[i];
      if (close == null || !Number.isFinite(close)) continue;
      const stamp = formatPoint(timestamps[i]!);
      points.push({
        date: stamp.date,
        label: stamp.label,
        close: Math.round(close * 1000) / 1000,
        indexed: 100,
      });
    }
    if (points.length < 2) return { ...empty, error: "no closes" };
    const first = points[0]!.close;
    for (const p of points) {
      p.indexed = Math.round((p.close / first) * 10000) / 100;
    }
    const last = points[points.length - 1]!;
    const prev = points[points.length - 2]?.close;
    const lastVol = rawVol[rawVol.length - 1];
    return {
      price: last.close,
      volume: lastVol != null && Number.isFinite(lastVol) ? lastVol : null,
      change_1d_pct: pctChange(last.close, prev),
      change_1y_pct: pctChange(last.close, first),
      series: downsample(points, 260),
    };
  } catch (exc) {
    return { ...empty, error: exc instanceof Error ? exc.message : "yahoo fail" };
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx] as T);
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length || 1);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function quoteSpec(
  spec: AiEtfSpec,
  benches: Map<string, Awaited<ReturnType<typeof fetchCloses>>>,
): Promise<AiEtfQuote> {
  const chart = await fetchCloses(spec.yahoo);
  const bench = benches.get(spec.bench_yahoo);
  const excess =
    chart.change_1y_pct != null && bench?.change_1y_pct != null
      ? Math.round((chart.change_1y_pct - bench.change_1y_pct) * 100) / 100
      : null;
  return {
    ...spec,
    price: chart.price,
    volume: chart.volume,
    change_1d_pct: chart.change_1d_pct,
    change_1y_pct: chart.change_1y_pct,
    bench_1y_pct: bench?.change_1y_pct ?? null,
    excess_1y_pct: excess,
    series: chart.series,
    bench_series: bench?.series || [],
    error: chart.error,
  };
}

function rankFunds(a: AiEtfQuote, b: AiEtfQuote): number {
  if (b.aum_usd_mn !== a.aum_usd_mn) return b.aum_usd_mn - a.aum_usd_mn;
  return (b.volume || 0) - (a.volume || 0);
}

async function buildPayload(): Promise<AiEtfPayload> {
  const benchSyms = [...new Set([...AI_ETF_PROCESS, ...AI_ETF_THEME].map((s) => s.bench_yahoo))];
  const benchCharts = await mapPool(benchSyms, 4, async (sym) => {
    const chart = await fetchCloses(sym);
    return [sym, chart] as const;
  });
  const benches = new Map(benchCharts.map(([sym, c]) => [sym, c]));
  const [process, theme] = await Promise.all([
    mapPool(AI_ETF_PROCESS, 6, (s) => quoteSpec(s, benches)),
    mapPool(AI_ETF_THEME, 4, (s) => quoteSpec(s, benches)),
  ]);
  const byAum = rankFunds;
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    note: AI_ETF_NOTE,
    process: process.sort(byAum),
    theme: theme.sort(byAum),
    lenses: AI_ETF_LENSES,
    takeaways: AI_ETF_TAKEAWAYS,
  };
}

export async function GET() {
  try {
    const payload = await withServerCache("ai-etf:v2", 180_000, 600_000, () => buildPayload());
    return jsonWithCdnCache(payload, "yahoo");
  } catch (exc) {
    return jsonWithCdnCache(
      emptyAiEtfPayload(exc instanceof Error ? exc.message : "AI ETF 로드 실패"),
      "yahoo",
      200,
    );
  }
}

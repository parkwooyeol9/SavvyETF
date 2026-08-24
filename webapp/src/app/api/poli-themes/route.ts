import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import {
  POLI_BASKET_SPECS,
  POLI_PIPELINE_SPECS,
  POLI_SECTOR_SPECS,
  POLI_THEMES_NOTE,
  type PoliEtfQuote,
  type PoliEtfSpec,
  type PoliPipelineFund,
  type PoliQuotePoint,
  type PoliThemesPayload,
} from "@/lib/poliThemes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type ChartPayload = {
  chart?: {
    result?: Array<{
      meta?: { symbol?: string; shortName?: string; longName?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

function downsample(points: PoliQuotePoint[], maxPoints: number): PoliQuotePoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

function pctChange(last: number, prev: number | undefined): number | null {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  return Math.round(((last / prev - 1) * 100) * 100) / 100;
}

async function fetchChart(symbol: string): Promise<{
  price: number | null;
  change_1d_pct: number | null;
  change_1m_pct: number | null;
  series: PoliQuotePoint[];
  name?: string;
  error?: string;
}> {
  const empty = {
    price: null,
    change_1d_pct: null,
    change_1m_pct: null,
    series: [] as PoliQuotePoint[],
  };
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=3mo&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ...empty, error: `HTTP ${res.status}` };
    const payload = (await res.json()) as ChartPayload;
    const result = payload.chart?.result?.[0];
    if (!result) return { ...empty, error: "no data" };

    const timestamps = result.timestamp || [];
    const rawCloses = result.indicators?.quote?.[0]?.close || [];
    const points: PoliQuotePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = rawCloses[i];
      if (close == null || !Number.isFinite(close)) continue;
      points.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close: Math.round(close * 1000) / 1000,
      });
    }
    if (points.length < 2) return { ...empty, error: "no closes" };

    const last = points[points.length - 1].close;
    const prev = points[points.length - 2]?.close;
    const monthAgo =
      points.length >= 22 ? points[points.length - 22].close : points[0].close;
    const name = `${result.meta?.shortName || ""} ${result.meta?.longName || ""}`.trim();
    return {
      price: last,
      change_1d_pct: pctChange(last, prev),
      change_1m_pct: pctChange(last, monthAgo),
      series: downsample(points, 60),
      name,
    };
  } catch (exc) {
    return {
      ...empty,
      error: exc instanceof Error ? exc.message : "yahoo fail",
    };
  }
}

function isPredictionEtfQuote(name?: string): boolean {
  if (!name) return false;
  return /roundhill|prediction|democratic president|republican president|democratic senate|republican senate|democratic house|republican house/i.test(
    name,
  );
}

async function quoteSpec(
  spec: PoliEtfSpec,
  spy1m: number | null,
): Promise<PoliEtfQuote> {
  const chart = await fetchChart(spec.symbol);
  const vs =
    chart.change_1m_pct != null && spy1m != null
      ? Math.round((chart.change_1m_pct - spy1m) * 100) / 100
      : null;
  return {
    ...spec,
    price: chart.price,
    change_1d_pct: chart.change_1d_pct,
    change_1m_pct: chart.change_1m_pct,
    vs_spy_1m_pct: vs,
    series: chart.series,
    error: chart.error,
  };
}

function spread(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null || b == null) return null;
  return Math.round((a - b) * 100) / 100;
}

async function buildPayload(): Promise<PoliThemesPayload> {
  const warnings: string[] = [];
  const spy = await fetchChart("SPY");
  if (spy.error) warnings.push(`SPY 벤치마크: ${spy.error}`);

  const [baskets, sectors] = await Promise.all([
    Promise.all(POLI_BASKET_SPECS.map((s) => quoteSpec(s, spy.change_1m_pct))),
    Promise.all(POLI_SECTOR_SPECS.map((s) => quoteSpec(s, spy.change_1m_pct))),
  ]);

  const tickers = POLI_PIPELINE_SPECS.map((p) => p.ticker).filter(
    (t): t is string => Boolean(t),
  );
  const pipelineQuotes = new Map<string, Awaited<ReturnType<typeof fetchChart>>>();
  await Promise.all(
    tickers.map(async (ticker) => {
      const q = await fetchChart(ticker);
      pipelineQuotes.set(ticker, q);
    }),
  );

  const pipeline: PoliPipelineFund[] = POLI_PIPELINE_SPECS.map((spec) => {
    const q = spec.ticker ? pipelineQuotes.get(spec.ticker) : undefined;
    const listed = Boolean(
      q?.price != null && !q.error && isPredictionEtfQuote(q.name),
    );
    return {
      ...spec,
      listed,
      status: listed ? "listed" : spec.status,
      status_ko: listed ? "상장됨" : spec.status_ko,
      price: listed ? q?.price ?? null : null,
      change_1d_pct: listed ? q?.change_1d_pct ?? null : null,
    };
  });

  const nanc = baskets.find((b) => b.id === "nanc");
  const kruz = baskets.find((b) => b.id === "kruz");
  const demz = baskets.find((b) => b.id === "demz");
  const maga = baskets.find((b) => b.id === "maga");

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    note: POLI_THEMES_NOTE,
    spy_change_1m_pct: spy.change_1m_pct,
    nanc_kruz_1m_spread: spread(nanc?.change_1m_pct, kruz?.change_1m_pct),
    demz_maga_1m_spread: spread(demz?.change_1m_pct, maga?.change_1m_pct),
    baskets,
    sectors_d: sectors.filter((s) => s.party === "D"),
    sectors_r: sectors.filter((s) => s.party === "R"),
    pipeline,
    warnings,
  };
}

export async function GET() {
  try {
    const payload = await withServerCache(
      "poli-themes-v1",
      180_000,
      600_000,
      buildPayload,
    );
    return jsonWithCdnCache(payload, "yahoo");
  } catch (exc) {
    const fallback: PoliThemesPayload = {
      ok: false,
      generated_at: new Date().toISOString(),
      note: POLI_THEMES_NOTE,
      spy_change_1m_pct: null,
      nanc_kruz_1m_spread: null,
      demz_maga_1m_spread: null,
      baskets: [],
      sectors_d: [],
      sectors_r: [],
      pipeline: POLI_PIPELINE_SPECS.map((s) => ({
        ...s,
        listed: false,
        price: null,
        change_1d_pct: null,
      })),
      warnings: [],
      error: exc instanceof Error ? exc.message : "정치테마 로드 실패",
    };
    return jsonWithCdnCache(fallback, "yahoo", 200);
  }
}

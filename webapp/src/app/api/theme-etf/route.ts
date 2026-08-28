import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import {
  OVERLAY_ISSUERS,
  OVERLAY_MATCHUPS,
  OVERLAY_PRODUCTS,
  type OverlayProductQuote,
} from "@/lib/derivOverlay";
import {
  THEME_ISSUERS,
  THEME_NOTE,
  THEME_PIPELINE,
  THEME_PRODUCTS,
  THEME_RIVALS,
  type ThemePayload,
  type ThemeProductQuote,
  type ThemeQuotePoint,
} from "@/lib/themeEtf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type ChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

function downsample(points: ThemeQuotePoint[], maxPoints: number): ThemeQuotePoint[] {
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

async function fetchChart(symbol: string): Promise<{
  price: number | null;
  change_1d_pct: number | null;
  change_3m_pct: number | null;
  series: ThemeQuotePoint[];
  error?: string;
}> {
  const empty = {
    price: null,
    change_1d_pct: null,
    change_3m_pct: null,
    series: [] as ThemeQuotePoint[],
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
    const points: ThemeQuotePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = rawCloses[i];
      if (close == null || !Number.isFinite(close)) continue;
      const stamp = formatPoint(timestamps[i]);
      points.push({
        date: stamp.date,
        label: stamp.label,
        close: Math.round(close * 1000) / 1000,
      });
    }
    if (points.length < 2) return { ...empty, error: "no closes" };

    const last = points[points.length - 1].close;
    const prev = points[points.length - 2]?.close;
    const first = points[0].close;
    return {
      price: last,
      change_1d_pct: pctChange(last, prev),
      change_3m_pct: pctChange(last, first),
      series: downsample(points, 80),
    };
  } catch (exc) {
    return {
      ...empty,
      error: exc instanceof Error ? exc.message : "yahoo fail",
    };
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

async function quoteTheme(
  spec: (typeof THEME_PRODUCTS)[number],
): Promise<ThemeProductQuote> {
  const chart = await fetchChart(spec.symbol);
  return {
    ...spec,
    price: chart.price,
    change_1d_pct: chart.change_1d_pct,
    change_3m_pct: chart.change_3m_pct,
    series: chart.series,
    error: chart.error,
  };
}

async function quoteOverlay(
  spec: (typeof OVERLAY_PRODUCTS)[number],
): Promise<OverlayProductQuote> {
  const chart = await fetchChart(spec.symbol);
  return {
    ...spec,
    price: chart.price,
    change_1d_pct: chart.change_1d_pct,
    change_3m_pct: chart.change_3m_pct,
    series: chart.series,
    error: chart.error,
  };
}

async function buildPayload(): Promise<ThemePayload> {
  const [products, overlay_products] = await Promise.all([
    mapPool(THEME_PRODUCTS, 8, quoteTheme),
    mapPool(OVERLAY_PRODUCTS, 8, quoteOverlay),
  ]);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    note: THEME_NOTE,
    issuers: THEME_ISSUERS,
    products,
    pipeline: THEME_PIPELINE,
    rivals: THEME_RIVALS,
    overlay_issuers: OVERLAY_ISSUERS,
    overlay_products,
    overlay_matchups: OVERLAY_MATCHUPS,
  };
}

function emptyPayload(error?: string): ThemePayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    note: THEME_NOTE,
    issuers: THEME_ISSUERS,
    products: THEME_PRODUCTS.map((spec) => ({
      ...spec,
      price: null,
      change_1d_pct: null,
      change_3m_pct: null,
      series: [],
    })),
    pipeline: THEME_PIPELINE,
    rivals: THEME_RIVALS,
    overlay_issuers: OVERLAY_ISSUERS,
    overlay_products: OVERLAY_PRODUCTS.map((spec) => ({
      ...spec,
      price: null,
      change_1d_pct: null,
      change_3m_pct: null,
      series: [],
    })),
    overlay_matchups: OVERLAY_MATCHUPS,
    error,
  };
}

export async function GET() {
  try {
    const payload = await withServerCache(
      "theme-etf:v2",
      180_000,
      600_000,
      () => buildPayload(),
    );
    return jsonWithCdnCache(payload, "yahoo");
  } catch (exc) {
    return jsonWithCdnCache(
      emptyPayload(exc instanceof Error ? exc.message : "테마 ETF 로드 실패"),
      "yahoo",
      200,
    );
  }
}

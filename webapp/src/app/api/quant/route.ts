import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  QUANT_ASSETS,
  QUANT_METHODOLOGY,
  buildHeatmap,
  buildQuantSnapshot,
  parseQuantRange,
  quantDeskComment,
  type QuantPayload,
  type QuantRange,
} from "@/lib/quantDesk";
import type { GsPoint } from "@/lib/gsQuant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

const RANGE_TO_YAHOO: Record<QuantRange, string> = {
  "6mo": "6mo",
  "1y": "1y",
  "2y": "2y",
};

async function fetchYahooCloses(
  symbol: string,
  range: string,
): Promise<{ price: number | null; series: GsPoint[] }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return { price: null, series: [] };
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result) return { price: null, series: [] };
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series: GsPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || !(close > 0)) continue;
    series.push({
      date: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
      value: close,
    });
  }
  const price =
    result.meta?.regularMarketPrice ??
    (series.length ? series[series.length - 1]!.value : null);
  return { price, series };
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
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function buildPayload(range: QuantRange): Promise<QuantPayload> {
  const yahooRange = RANGE_TO_YAHOO[range];
  const errors: string[] = [];
  const fetched = await mapPool(QUANT_ASSETS, 5, async (spec) => {
    try {
      const { price, series } = await fetchYahooCloses(spec.yahoo, yahooRange);
      if (!series.length) errors.push(`${spec.short}: no yahoo data`);
      return { spec, price, series };
    } catch (exc) {
      errors.push(`${spec.short}: ${exc instanceof Error ? exc.message : String(exc)}`);
      return { spec, price: null as number | null, series: [] as GsPoint[] };
    }
  });

  const seriesById = new Map<string, GsPoint[]>();
  for (const row of fetched) {
    if (row.series.length) seriesById.set(row.spec.id, row.series);
  }
  const spy = seriesById.get("spy") || null;
  const snapshots = fetched.map((row) =>
    buildQuantSnapshot(row.spec, row.series, row.price, spy),
  );
  const withData = snapshots.filter((s) => s.chart.length > 0);
  return {
    ok: withData.length > 0,
    generated_at: new Date().toISOString(),
    range,
    note: QUANT_METHODOLOGY[0] || "",
    comment: quantDeskComment(snapshots),
    snapshots,
    heatmap: buildHeatmap(seriesById),
    ids: QUANT_ASSETS.map((s) => s.id),
    errors,
    error: withData.length ? undefined : "Quant 시세 없음",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = parseQuantRange(searchParams.get("range"));
  try {
    const payload = await withServerCache(
      `quant:v2:${range}`,
      180_000,
      540_000,
      () => buildPayload(range),
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        range,
        note: "",
        comment: "",
        snapshots: [],
        heatmap: [],
        ids: [],
        errors: [message],
        error: message,
      } satisfies QuantPayload,
      { status: 502 },
    );
  }
}

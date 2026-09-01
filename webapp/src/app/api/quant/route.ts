import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  QUANT_ASSETS,
  QUANT_METHODOLOGY,
  buildQuantSnapshot,
  findQuantAsset,
  lookupQuantSpec,
  parseQuantRange,
  parseQuantTicker,
  quantDeskComment,
  type QuantAssetSpec,
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
      meta?: {
        regularMarketPrice?: number;
        shortName?: string;
        longName?: string;
        symbol?: string;
      };
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
): Promise<{ price: number | null; series: GsPoint[]; name: string | null }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return { price: null, series: [], name: null };
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result) return { price: null, series: [], name: null };
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
  const name = result.meta?.shortName || result.meta?.longName || result.meta?.symbol || null;
  return { price, series, name };
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

async function fetchSpec(
  spec: QuantAssetSpec,
  yahooRange: string,
): Promise<{ spec: QuantAssetSpec; price: number | null; series: GsPoint[]; error?: string }> {
  try {
    const { price, series, name } = await fetchYahooCloses(spec.yahoo, yahooRange);
    const nextSpec =
      spec.group === "조회" && name
        ? { ...spec, label: `${name} (${spec.short})` }
        : spec;
    return {
      spec: nextSpec,
      price,
      series,
      error: series.length ? undefined : `${spec.short}: no yahoo data`,
    };
  } catch (exc) {
    return {
      spec,
      price: null,
      series: [],
      error: `${spec.short}: ${exc instanceof Error ? exc.message : String(exc)}`,
    };
  }
}

async function buildPayload(range: QuantRange): Promise<QuantPayload> {
  const yahooRange = RANGE_TO_YAHOO[range];
  const fetched = await mapPool(QUANT_ASSETS, 6, (spec) => fetchSpec(spec, yahooRange));
  const errors = fetched.map((row) => row.error).filter((e): e is string => Boolean(e));
  const spyRow = fetched.find((row) => row.spec.id === "spy");
  const spy = spyRow?.series.length ? spyRow.series : null;
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
    ids: QUANT_ASSETS.map((s) => s.id),
    errors,
    error: withData.length ? undefined : "Quant 시세 없음",
  };
}

async function buildTickerPayload(range: QuantRange, ticker: string): Promise<QuantPayload> {
  const yahooRange = RANGE_TO_YAHOO[range];
  const known = findQuantAsset(ticker);
  const spec = known || lookupQuantSpec(ticker);
  const [row, spyFetch] = await Promise.all([
    fetchSpec(spec, yahooRange),
    spec.yahoo === "SPY"
      ? Promise.resolve(null)
      : fetchYahooCloses("SPY", yahooRange),
  ]);
  const spy =
    spec.yahoo === "SPY"
      ? row.series
      : spyFetch?.series.length
        ? spyFetch.series
        : null;
  const snapshot = buildQuantSnapshot(row.spec, row.series, row.price, spy);
  const ok = snapshot.chart.length > 0;
  return {
    ok,
    generated_at: new Date().toISOString(),
    range,
    note: QUANT_METHODOLOGY[0] || "",
    comment: ok ? snapshot.timing_comment : "",
    snapshots: ok ? [snapshot] : [],
    ids: ok ? [snapshot.id] : [],
    errors: row.error ? [row.error] : [],
    lookup: true,
    error: ok ? undefined : `${ticker} 시세를 찾지 못했습니다.`,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = parseQuantRange(searchParams.get("range"));
  const tickerRaw = searchParams.get("ticker");
  const ticker = tickerRaw ? parseQuantTicker(tickerRaw) : null;
  if (tickerRaw && !ticker) {
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        range,
        note: "",
        comment: "",
        snapshots: [],
        ids: [],
        errors: ["invalid ticker"],
        lookup: true,
        error: "티커 형식을 확인해 주세요. 예: XLK, SMH, 069500",
      } satisfies QuantPayload,
      { status: 400 },
    );
  }
  try {
    const payload = ticker
      ? await withServerCache(
          `quant:v3:t:${range}:${ticker}`,
          90_000,
          180_000,
          () => buildTickerPayload(range, ticker),
        )
      : await withServerCache(
          `quant:v3:${range}`,
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
        ids: [],
        errors: [message],
        lookup: Boolean(ticker),
        error: message,
      } satisfies QuantPayload,
      { status: 502 },
    );
  }
}

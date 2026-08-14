import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  VOL_ASSET_SPECS,
  VOL_MONITOR_SCHEDULE_NOTE,
  downsample,
  parseVolRange,
  pctChange,
  realizedVol,
  realizedVolSeries,
  type VolAssetSeries,
  type VolMonitorPayload,
  type VolMonitorRange,
  type VolPoint,
} from "@/lib/volatilityMonitor";

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

const RANGE_TO_YAHOO: Record<VolMonitorRange, string> = {
  "6mo": "6mo",
  "1y": "1y",
  "2y": "2y",
  "5y": "5y",
};

/** Keep enough bars for 60d vol, then downsample for payload size. */
const RANGE_MAX_POINTS: Record<VolMonitorRange, number> = {
  "6mo": 160,
  "1y": 280,
  "2y": 400,
  "5y": 520,
};

async function fetchYahooCloses(
  symbol: string,
  range: string,
): Promise<{ price: number | null; series: VolPoint[] }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 180 },
  });
  if (!res.ok) return { price: null, series: [] };
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result) return { price: null, series: [] };
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series: VolPoint[] = [];
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

async function buildPayload(range: VolMonitorRange): Promise<VolMonitorPayload> {
  const yahooRange = RANGE_TO_YAHOO[range];
  const maxPoints = RANGE_MAX_POINTS[range];
  const errors: string[] = [];

  const assets = await mapPool(VOL_ASSET_SPECS, 5, async (spec) => {
    try {
      const { price, series } = await fetchYahooCloses(spec.yahoo, yahooRange);
      if (!series.length) {
        errors.push(`${spec.id}: no yahoo data`);
        const empty: VolAssetSeries = {
          id: spec.id,
          label: spec.label,
          short: spec.short,
          group: spec.group,
          yahoo: spec.yahoo,
          color: spec.color,
          price: null,
          change_pct: null,
          vol20: null,
          vol60: null,
          closes: [],
          vol20_series: [],
          vol60_series: [],
        };
        return empty;
      }
      const vol20Series = realizedVolSeries(series, 20);
      const vol60Series = realizedVolSeries(series, 60);
      const asset: VolAssetSeries = {
        id: spec.id,
        label: spec.label,
        short: spec.short,
        group: spec.group,
        yahoo: spec.yahoo,
        color: spec.color,
        price,
        change_pct: pctChange(series, 1),
        vol20: realizedVol(series, 20),
        vol60: realizedVol(series, 60),
        closes: downsample(series, maxPoints),
        vol20_series: downsample(vol20Series, maxPoints),
        vol60_series: downsample(vol60Series, maxPoints),
      };
      return asset;
    } catch (exc) {
      errors.push(
        `${spec.id}: ${exc instanceof Error ? exc.message : String(exc)}`,
      );
      return {
        id: spec.id,
        label: spec.label,
        short: spec.short,
        group: spec.group,
        yahoo: spec.yahoo,
        color: spec.color,
        price: null,
        change_pct: null,
        vol20: null,
        vol60: null,
        closes: [],
        vol20_series: [],
        vol60_series: [],
      } satisfies VolAssetSeries;
    }
  });

  const withData = assets.filter((a) => a.closes.length > 0);
  return {
    ok: withData.length > 0,
    generated_at: new Date().toISOString(),
    range,
    schedule_note: VOL_MONITOR_SCHEDULE_NOTE,
    assets,
    errors,
    error: withData.length ? undefined : "변동성 데이터 없음",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = parseVolRange(searchParams.get("range"));

  try {
    const payload = await withServerCache(
      `volatility-monitor:${range}`,
      180_000,
      420_000,
      () => buildPayload(range),
    );
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 502,
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        range,
        schedule_note: VOL_MONITOR_SCHEDULE_NOTE,
        assets: [],
        errors: [exc instanceof Error ? exc.message : String(exc)],
        error: exc instanceof Error ? exc.message : String(exc),
      } satisfies VolMonitorPayload,
      { status: 500 },
    );
  }
}

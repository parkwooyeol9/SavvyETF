import { NextRequest, NextResponse } from "next/server";

import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import {
  DERIV_CONTRACT_SPECS,
  buildDerivSpreads,
  buildVolCurve,
  computeDerivPulse,
  parseDerivRange,
  pctChange,
  type DerivContract,
  type DerivPayload,
  type DerivPoint,
  type DerivRange,
} from "@/lib/derivatives";

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
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
};

function downsample(points: DerivPoint[], maxPoints: number): DerivPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

async function fetchYahooContract(
  spec: (typeof DERIV_CONTRACT_SPECS)[number],
  range: DerivRange,
): Promise<DerivContract> {
  const base: DerivContract = {
    id: spec.id,
    symbol: spec.symbol,
    label: spec.label,
    label_ko: spec.label_ko,
    group: spec.group,
    venue: spec.venue,
    thesis: spec.thesis,
    unit: spec.unit,
    featured: spec.featured,
    price: null,
    change_1d_pct: null,
    change_5d_pct: null,
    change_range_pct: null,
    volume: null,
  };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.symbol)}?range=${range}&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 120 },
    });
    if (!res.ok) return { ...base, error: `HTTP ${res.status}` };
    const payload = (await res.json()) as YahooChart;
    const result = payload.chart?.result?.[0];
    if (!result) return { ...base, error: "no data" };

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const volumes = result.indicators?.quote?.[0]?.volume || [];
    const series: DerivPoint[] = [];
    let lastVolume: number | null = null;
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || !Number.isFinite(close)) continue;
      series.push({
        date: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
        value: close,
      });
      const vol = volumes[i];
      if (vol != null && Number.isFinite(vol) && vol > 0) lastVolume = vol;
    }
    if (!series.length) return { ...base, error: "no closes" };

    const price =
      result.meta?.regularMarketPrice ?? series[series.length - 1]!.value;
    return {
      ...base,
      price,
      change_1d_pct: pctChange(series, 1),
      change_5d_pct: pctChange(series, 5),
      change_range_pct: pctChange(series, series.length - 1),
      volume: lastVolume,
      series: downsample(series, 90),
    };
  } catch (exc) {
    return {
      ...base,
      error: exc instanceof Error ? exc.message : "fetch failed",
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
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function buildPayload(range: DerivRange): Promise<DerivPayload> {
  const contracts = await mapPool(DERIV_CONTRACT_SPECS, 6, (spec) =>
    fetchYahooContract(spec, range),
  );
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const failed = contracts.filter((c) => c.error).length;
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    note: "Yahoo 연속선물(근월물) · CBOE 변동성 기간구조·SKEW · 투자 조언이 아닙니다.",
    range,
    pulse: computeDerivPulse(byId),
    vol_curve: buildVolCurve(byId),
    contracts,
    spreads: buildDerivSpreads(byId),
    error: failed
      ? `${failed}개 심볼을 가져오지 못했습니다 (심볼별 표시).`
      : undefined,
  };
}

export async function GET(req: NextRequest) {
  const range = parseDerivRange(req.nextUrl.searchParams.get("range"));
  try {
    const payload = await withServerCache(
      `derivatives:${range}`,
      90_000,
      180_000,
      () => buildPayload(range),
    );
    return jsonWithCdnCache(payload, "yahoo");
  } catch (exc) {
    const payload: DerivPayload = {
      ok: false,
      generated_at: new Date().toISOString(),
      note: "",
      range,
      pulse: {
        score: 0,
        regime: "n/a",
        regime_ko: "n/a",
        drivers: [],
        components: { equity_vol: 0, vol_term: 0, options: 0, rates_vol: 0 },
      },
      vol_curve: [],
      contracts: [],
      spreads: [],
      error: exc instanceof Error ? exc.message : "derivatives fetch failed",
    };
    return NextResponse.json(payload, { status: 502 });
  }
}

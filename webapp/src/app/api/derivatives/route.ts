import { NextRequest, NextResponse } from "next/server";

import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import {
  DERIV_CONTRACT_SPECS,
  DERIV_YAHOO_QUERY,
  buildDerivSpreads,
  buildVolCurve,
  closesFromOhlc,
  computeDerivPulse,
  derivIntervalLabel,
  downsampleOhlc,
  hasOhlcBars,
  isValidOhlc,
  parseDerivRange,
  pctChange,
  type DerivBar,
  type DerivContract,
  type DerivPayload,
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
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
};

function isIntraday(interval: string): boolean {
  return interval.endsWith("m") || interval === "60m" || interval === "1h";
}

function formatBarStamp(tsSec: number, interval: string): { date: string; label: string } {
  const d = new Date(tsSec * 1000);
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mi = String(kst.getUTCMinutes()).padStart(2, "0");
  if (isIntraday(interval)) {
    return {
      date: d.toISOString(),
      label: `${mm}-${dd} ${hh}:${mi}`,
    };
  }
  return {
    date: d.toISOString().slice(0, 10),
    label: `${mm}-${dd}`,
  };
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
    const q = DERIV_YAHOO_QUERY[range];
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/` +
      `${encodeURIComponent(spec.symbol)}?range=${q.range}&interval=${q.interval}` +
      `&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: range === "1d" || range === "5d" ? 60 : 120 },
    });
    if (!res.ok) return { ...base, error: `HTTP ${res.status}` };
    const payload = (await res.json()) as YahooChart;
    const result = payload.chart?.result?.[0];
    if (!result) return { ...base, error: "no data" };

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0];
    const opens = quote?.open || [];
    const highs = quote?.high || [];
    const lows = quote?.low || [];
    const closes = quote?.close || [];
    const volumes = quote?.volume || [];
    const bars: DerivBar[] = [];
    let lastVolume: number | null = null;
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || !Number.isFinite(close)) continue;
      const stamp = formatBarStamp(timestamps[i]!, q.interval);
      const open = opens[i];
      const high = highs[i];
      const low = lows[i];
      const hasOhlc =
        open != null &&
        high != null &&
        low != null &&
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        isValidOhlc(open, high, low, close);
      bars.push({
        date: stamp.date,
        label: stamp.label,
        open: hasOhlc ? open : close,
        high: hasOhlc ? high : close,
        low: hasOhlc ? low : close,
        close,
        volume: volumes[i] != null && Number.isFinite(volumes[i]) ? volumes[i] : null,
      });
      const vol = volumes[i];
      if (vol != null && Number.isFinite(vol) && vol > 0) lastVolume = vol;
    }
    if (!bars.length) return { ...base, error: "no closes" };

    const ohlc = downsampleOhlc(bars, q.maxBars);
    const series = closesFromOhlc(ohlc);
    const price =
      result.meta?.regularMarketPrice ?? ohlc[ohlc.length - 1]!.close;
    const prev =
      result.meta?.previousClose ?? result.meta?.chartPreviousClose ?? null;
    const change1d =
      prev != null && prev !== 0 ? ((price / prev - 1) * 100) : pctChange(series, 1);
    return {
      ...base,
      price,
      change_1d_pct: change1d,
      change_5d_pct: pctChange(series, 5),
      change_range_pct: pctChange(series, 3650),
      volume: lastVolume,
      series,
      ohlc,
      chart_kind: hasOhlcBars(ohlc) ? "candle" : "line",
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
    interval: DERIV_YAHOO_QUERY[range].interval,
    interval_label: derivIntervalLabel(range),
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
      `derivatives:v3:${range}`,
      range === "1d" || range === "5d" ? 45_000 : 90_000,
      range === "1d" || range === "5d" ? 90_000 : 180_000,
      () => buildPayload(range),
    );
    return jsonWithCdnCache(payload, "yahoo");
  } catch (exc) {
    const payload: DerivPayload = {
      ok: false,
      generated_at: new Date().toISOString(),
      note: "",
      range,
      interval: DERIV_YAHOO_QUERY[range].interval,
      interval_label: derivIntervalLabel(range),
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

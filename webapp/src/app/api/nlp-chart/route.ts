import { NextRequest, NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  NLP_CHART_QUERY,
  downsampleNlpBars,
  nlpChartIntervalLabel,
  parseNlpChartRange,
  toYahooChartSymbol,
  type NlpChartBar,
  type NlpChartPayload,
} from "@/lib/nlpChart";
import { NLP_UNIVERSE } from "@/lib/nlpPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const ALLOWED = new Map(
  NLP_UNIVERSE.flatMap((n) => {
    const keys = [n.id.toUpperCase(), n.ticker.toUpperCase(), toYahooChartSymbol(n.ticker)];
    if (n.stock_code) keys.push(n.stock_code);
    return keys.map((k) => [k, n] as const);
  }),
);

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        currency?: string;
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
  const yy = String(kst.getUTCFullYear()).slice(2);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mi = String(kst.getUTCMinutes()).padStart(2, "0");
  if (isIntraday(interval)) {
    return { date: d.toISOString(), label: `${mm}-${dd} ${hh}:${mi}` };
  }
  if (interval === "1wk") {
    return { date: d.toISOString().slice(0, 10), label: `${yy}.${mm}` };
  }
  return { date: d.toISOString().slice(0, 10), label: `${mm}-${dd}` };
}

function emptyPayload(
  symbol: string,
  range: ReturnType<typeof parseNlpChartRange>,
  error?: string,
): NlpChartPayload {
  return {
    ok: false,
    symbol,
    yahoo_symbol: toYahooChartSymbol(symbol),
    currency: symbol.includes(".KS") || symbol.includes(".KQ") ? "KRW" : "USD",
    range,
    interval_label: nlpChartIntervalLabel(range),
    price: null,
    change_pct: null,
    range_pct: null,
    volume: null,
    bars: [],
    error,
  };
}

async function fetchChart(symbol: string, range: ReturnType<typeof parseNlpChartRange>): Promise<NlpChartPayload> {
  const spec = ALLOWED.get(symbol.toUpperCase()) || ALLOWED.get(toYahooChartSymbol(symbol));
  if (!spec) {
    return emptyPayload(symbol, range, "유니버스 외 종목입니다");
  }
  const yahooSym = toYahooChartSymbol(spec.ticker);
  const q = NLP_CHART_QUERY[range];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}` +
    `?range=${q.range}&interval=${q.interval}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    return emptyPayload(spec.ticker, range, `Yahoo HTTP ${res.status}`);
  }
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  if (!result || !timestamps.length || !quote) {
    return emptyPayload(spec.ticker, range, "시세 없음");
  }
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  const bars: NlpChartBar[] = [];
  let lastVolume: number | null = null;
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    const hasOhlc =
      open != null &&
      high != null &&
      low != null &&
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low);
    const stamp = formatBarStamp(timestamps[i]!, q.interval);
    const vol = volumes[i];
    const volume = vol != null && Number.isFinite(vol) ? vol : null;
    if (volume != null && volume > 0) lastVolume = volume;
    bars.push({
      date: stamp.date,
      label: stamp.label,
      open: hasOhlc ? open : close,
      high: hasOhlc ? high : close,
      low: hasOhlc ? low : close,
      close,
      volume,
    });
  }
  if (!bars.length) return emptyPayload(spec.ticker, range, "봉 데이터 없음");
  const ohlc = downsampleNlpBars(bars, q.maxBars);
  const sessionVolume = bars.reduce((sum, b) => sum + (b.volume || 0), 0);
  const price = result.meta?.regularMarketPrice ?? ohlc[ohlc.length - 1]!.close;
  const sessionPrev =
    result.meta?.previousClose ??
    (ohlc.length > 1 ? ohlc[ohlc.length - 2]!.close : null);
  const first = ohlc[0]!.close;
  const change_pct =
    sessionPrev != null && sessionPrev !== 0 ? ((price / sessionPrev - 1) * 100) : null;
  const range_pct = first ? ((price / first - 1) * 100) : null;
  const kr = spec.market === "kospi200";
  return {
    ok: true,
    symbol: spec.ticker,
    yahoo_symbol: yahooSym,
    name: spec.name,
    currency: kr ? "KRW" : "USD",
    range,
    interval_label: nlpChartIntervalLabel(range),
    price,
    change_pct,
    range_pct,
    volume: isIntraday(q.interval) ? sessionVolume : lastVolume,
    bars: ohlc,
  };
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") || "").trim();
  const range = parseNlpChartRange(req.nextUrl.searchParams.get("range"));
  if (!symbol) {
    return NextResponse.json(emptyPayload("", range, "symbol required"), { status: 400 });
  }
  const ttl = range === "1d" || range === "5d" ? 45_000 : 120_000;
  try {
    const payload = await withServerCache(
      `nlp-chart:${symbol}:${range}`,
      ttl,
      ttl * 3,
      () => fetchChart(symbol, range),
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader(range === "1d" || range === "5d" ? "live" : "yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(emptyPayload(symbol, range, message), { status: 502 });
  }
}

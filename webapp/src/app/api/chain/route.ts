import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  CHAIN_DISCLAIMER,
  CHAIN_EDGES,
  CHAIN_CLUSTERS,
  CHAIN_METHODOLOGY,
  CHAIN_NODES,
  chainComment,
  emptyChainPayload,
  type ChainPayload,
  type ChainQuote,
} from "@/lib/chainGraph";
import { toYahooChartSymbol } from "@/lib/nlpChart";

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
        chartPreviousClose?: number;
        previousClose?: number;
      };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

async function fetchQuote(ticker: string): Promise<ChainQuote> {
  const symbol = toYahooChartSymbol(ticker);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return { price: null, ret1d: null, ret5d: null };
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result) return { price: null, ret1d: null, ret5d: null };
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(
    (v): v is number => v != null && Number.isFinite(v) && v > 0,
  );
  const price =
    result.meta?.regularMarketPrice ?? (closes.length ? closes[closes.length - 1]! : null);
  const prev =
    result.meta?.chartPreviousClose ??
    result.meta?.previousClose ??
    (closes.length >= 2 ? closes[closes.length - 2]! : null);
  const first = closes.length ? closes[0]! : null;
  const ret1d =
    price != null && prev != null && prev > 0 ? ((price - prev) / prev) * 100 : null;
  const ret5d =
    price != null && first != null && first > 0 && closes.length >= 3
      ? ((price - first) / first) * 100
      : null;
  return { price, ret1d, ret5d };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function buildPayload(): Promise<ChainPayload> {
  const errors: string[] = [];
  const quotes = await mapPool(CHAIN_NODES, 5, async (node) => {
    try {
      const q = await fetchQuote(node.ticker);
      if (q.price == null) errors.push(`${node.short}: no yahoo`);
      return { id: node.id, ...q };
    } catch (exc) {
      errors.push(`${node.short}: ${exc instanceof Error ? exc.message : String(exc)}`);
      return { id: node.id, price: null, ret1d: null, ret5d: null };
    }
  });
  const byId = new Map(quotes.map((q) => [q.id, q]));
  const nodes = CHAIN_NODES.map((n) => {
    const q = byId.get(n.id);
    return {
      ...n,
      price: q?.price ?? null,
      ret1d: q?.ret1d ?? null,
      ret5d: q?.ret5d ?? null,
    };
  });
  const withPx = nodes.filter((n) => n.price != null).length;
  return {
    ok: withPx > 0 || CHAIN_EDGES.length > 0,
    generated_at: new Date().toISOString(),
    comment: chainComment(nodes),
    methodology: CHAIN_METHODOLOGY,
    disclaimer: CHAIN_DISCLAIMER,
    clusters: CHAIN_CLUSTERS,
    nodes,
    edges: CHAIN_EDGES,
    errors,
    error: withPx ? undefined : "Yahoo 시세 없음 — 관계 지도만 표시",
  };
}

export async function GET() {
  try {
    const payload = await withServerCache("chain:v1", 180_000, 540_000, buildPayload);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(emptyChainPayload(message), { status: 502 });
  }
}

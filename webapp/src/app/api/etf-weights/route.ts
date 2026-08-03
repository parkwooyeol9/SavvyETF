import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";
import { r2Configured, r2GetObjectText, r2ListKeys } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Holding = {
  ticker?: string;
  name?: string;
  cusip?: string;
  weight_pct?: number | null;
  shares?: number | null;
  market_value?: number | null;
};

type Economic = {
  id: string;
  label: string;
  weight_pct: number;
  market_value?: number | null;
  legs?: Holding[];
};

type History = {
  ticker?: string;
  dates: string[];
  labels: Record<string, string>;
  series: Record<string, Array<number | null>>;
  snapshot_count?: number;
  latest_as_of?: string | null;
};

type UniverseEntry = {
  ticker: string;
  name?: string;
  issuer?: string;
  as_of?: string | null;
  aum_usd?: number | null;
  holdings?: number | null;
};

export type EtfWeightsPayload = {
  ok: boolean;
  ticker?: string;
  name?: string;
  issuer?: string;
  as_of?: string | null;
  aum_usd?: number | null;
  generated_at?: string;
  generated_at_display?: string;
  source?: string;
  source_url?: string;
  source_note?: string;
  holdings?: Holding[];
  economic?: Economic[];
  top10?: Holding[];
  history?: History;
  universe?: { updated_at?: string | null; count?: number; tickers?: UniverseEntry[] };
  notes?: string[];
  error?: string;
};

async function loadUniverseFromR2() {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText("etf_weights/universe.json");
    if (!text) return null;
    return JSON.parse(text) as EtfWeightsPayload["universe"];
  } catch {
    return null;
  }
}

async function loadFromR2(ticker: string): Promise<EtfWeightsPayload | null> {
  if (!r2Configured()) return null;
  try {
    const latestText = await r2GetObjectText(`etf_weights/${ticker}/latest.json`);
    if (!latestText) return null;
    const latest = JSON.parse(latestText) as EtfWeightsPayload;
    const keys = (await r2ListKeys(`etf_weights/${ticker}/snapshots/`))
      .filter((k) => k.endsWith(".json"))
      .sort();
    const dates: string[] = [];
    const seriesById: Record<string, Record<string, number | null>> = {};
    const labels: Record<string, string> = {};
    for (const key of keys) {
      const dayIso = key.split("/").pop()?.replace(/\.json$/, "") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) continue;
      const text = await r2GetObjectText(key);
      if (!text) continue;
      const snap = JSON.parse(text) as EtfWeightsPayload;
      dates.push(dayIso);
      for (const item of snap.economic || []) {
        if (!item?.id) continue;
        labels[item.id] = item.label || item.id;
        seriesById[item.id] ||= {};
        seriesById[item.id][dayIso] = item.weight_pct ?? null;
      }
    }
    const order = Object.keys(seriesById);
    latest.history = {
      ticker,
      dates,
      labels,
      series: Object.fromEntries(
        order.map((id) => [id, dates.map((d) => seriesById[id][d] ?? null)]),
      ),
      snapshot_count: dates.length,
      latest_as_of: latest.as_of ?? null,
    };
    latest.universe = (await loadUniverseFromR2()) || undefined;
    latest.ok = true;
    return latest;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const universeOnly = url.searchParams.get("universe") === "1";
  const ticker = (url.searchParams.get("ticker") || "DRAM").trim().toUpperCase();
  const cacheKey = universeOnly
    ? "etf-weights:v2:universe"
    : `etf-weights:v2:${ticker}`;

  try {
    const payload = await withServerCache(cacheKey, 120_000, 600_000, async () => {
      if (universeOnly) {
        const r2u = await loadUniverseFromR2();
        if (r2u?.tickers?.length) {
          return { ok: true, universe: r2u } satisfies EtfWeightsPayload;
        }
        try {
          return await fetchBotJson<EtfWeightsPayload>(
            "/api/web/etf-weights?universe=1",
            { timeoutMs: 30_000 },
          );
        } catch {
          return {
            ok: false,
            error: "Universe not ready",
          } satisfies EtfWeightsPayload;
        }
      }

      const r2 = await loadFromR2(ticker);
      if (r2?.ok && (r2.history?.snapshot_count || 0) >= 1) {
        return r2;
      }
      try {
        const bot = await fetchBotJson<EtfWeightsPayload>(
          `/api/web/etf-weights?ticker=${encodeURIComponent(ticker)}`,
          { timeoutMs: 55_000 },
        );
        if (bot?.ok) return bot;
      } catch (exc) {
        if (r2?.ok) return r2;
        throw exc;
      }
      if (r2?.ok) return r2;
      return {
        ok: false,
        ticker,
        error: "No weight monitor data yet",
      } satisfies EtfWeightsPayload;
    });

    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("heavy") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      { ok: false, ticker, error: message } satisfies EtfWeightsPayload,
      { status: 502 },
    );
  }
}

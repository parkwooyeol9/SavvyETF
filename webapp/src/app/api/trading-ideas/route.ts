import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  buildTradingIdeasFromSignals,
  IDEAS_DISCLAIMER,
  IDEAS_METHODOLOGY,
  IDEAS_SCHEDULE_NOTE,
  type TradingIdeasPayload,
} from "@/lib/tradingIdeas";
import type { TradingSignalsPayload } from "@/lib/tradingSignals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function fetchSignals(req: Request): Promise<TradingSignalsPayload> {
  const url = new URL("/api/trading-signals", req.url);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return (await res.json()) as TradingSignalsPayload;
}

export async function GET(req: Request) {
  try {
    const payload = await withServerCache(
      "trading-ideas:v1",
      120_000,
      600_000,
      async () => {
        const signals = await fetchSignals(req);
        return buildTradingIdeasFromSignals(signals);
      },
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
        as_of: null,
        risk: null,
        cash_pct: 100,
        invested_pct: 0,
        ideas: [],
        buys: [],
        sells: [],
        summary: [],
        methodology: IDEAS_METHODOLOGY,
        disclaimer: IDEAS_DISCLAIMER,
        schedule_note: IDEAS_SCHEDULE_NOTE,
        target_weights: [],
        error: message,
      } satisfies TradingIdeasPayload,
      { status: 502 },
    );
  }
}

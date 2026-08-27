import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import type { ChainPayload } from "@/lib/chainGraph";
import type { NlpPulsePayload } from "@/lib/nlpPulse";
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

async function fetchJson<T>(req: Request, path: string, timeoutMs: number): Promise<T | null> {
  try {
    const url = new URL(path, req.url);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function emptyPayload(error: string, comment = ""): TradingIdeasPayload {
  return {
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
    comment,
    target_weights: [],
    error,
  };
}

export async function GET(req: Request) {
  try {
    const payload = await withServerCache(
      "trading-ideas:v3",
      120_000,
      600_000,
      async () => {
        const [signals, nlp, chain] = await Promise.all([
          fetchJson<TradingSignalsPayload>(req, "/api/trading-signals", 28_000),
          fetchJson<NlpPulsePayload>(req, "/api/nlp-pulse", 28_000),
          fetchJson<ChainPayload>(req, "/api/chain", 28_000),
        ]);
        if (!signals) {
          return emptyPayload("시그널을 불러오지 못했습니다.");
        }
        return buildTradingIdeasFromSignals(signals, { nlp, chain });
      },
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(emptyPayload(message), { status: 502 });
  }
}

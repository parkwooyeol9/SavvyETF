import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import type { ChainPayload } from "@/lib/chainGraph";
import type { MoneyFlowPayload } from "@/lib/moneyFlow";
import type { NlpPulsePayload } from "@/lib/nlpPulse";
import type { TradingSignalsPayload } from "@/lib/tradingSignals";
import {
  buildWeightOptimize,
  WEIGHTOPT_DISCLAIMER,
  WEIGHTOPT_METHODOLOGY,
  WEIGHTOPT_SCHEDULE_NOTE,
  type WeightOptimizePayload,
} from "@/lib/weightOptimize";

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

function emptyPayload(error: string): WeightOptimizePayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    as_of: null,
    lambda: 3.6,
    regime_ko: null,
    cash_pct: 100,
    invested_pct: 0,
    pick_cash_pct: 100,
    turnover_vs_pick_pct: 0,
    expected_excess_pct: null,
    port_vol_pct: null,
    pick_vol_pct: null,
    flow_regime_ko: null,
    comment: "",
    summary: [],
    methodology: WEIGHTOPT_METHODOLOGY,
    disclaimer: WEIGHTOPT_DISCLAIMER,
    schedule_note: WEIGHTOPT_SCHEDULE_NOTE,
    sleeves: [],
    sells: [],
    error,
  };
}

export async function GET(req: Request) {
  try {
    const payload = await withServerCache(
      "weight-optimize:v1",
      120_000,
      600_000,
      async () => {
        const [signals, nlp, chain, flow] = await Promise.all([
          fetchJson<TradingSignalsPayload>(req, "/api/trading-signals", 28_000),
          fetchJson<NlpPulsePayload>(req, "/api/nlp-pulse", 28_000),
          fetchJson<ChainPayload>(req, "/api/chain", 28_000),
          fetchJson<MoneyFlowPayload>(req, "/api/money-flow?period=1m", 8_000),
        ]);
        if (!signals) {
          return emptyPayload("시그널을 불러오지 못했습니다.");
        }
        return buildWeightOptimize({
          signals,
          nlp,
          chain,
          flow: flow?.ok ? flow : null,
        });
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

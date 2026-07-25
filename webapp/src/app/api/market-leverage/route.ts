import { NextResponse } from "next/server";

import type { MarketLeveragePayload } from "@/lib/marketLeverage";
import { buildMarketLeveragePayload } from "@/lib/marketLeverageServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CacheEntry = { at: number; payload: MarketLeveragePayload };
let cache: CacheEntry | null = null;
const CACHE_MS = 3 * 60_000;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("refresh") === "1";
    if (!force && cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json(cache.payload);
    }
    const payload = await buildMarketLeveragePayload();
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error:
          exc instanceof Error ? exc.message : "market-leverage fetch failed",
      } satisfies MarketLeveragePayload,
      { status: 500 },
    );
  }
}

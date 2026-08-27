import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  collectEtfMarketStructure,
  type EtfMarketStructurePayload,
} from "@/lib/etfMarketStructure";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await withServerCache(
      "etf-market-structure:v3",
      1_800_000,
      3_600_000,
      collectEtfMarketStructure,
    );
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 502,
      headers: { "Cache-Control": cdnCacheHeader("etfSlow") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        fx: { usdkrw: null, usdjpy: null, usdcny: null, eurusd: null },
        regions: [],
        extras: [],
        methodology: [],
        error: message,
      } satisfies EtfMarketStructurePayload,
      { status: 500 },
    );
  }
}

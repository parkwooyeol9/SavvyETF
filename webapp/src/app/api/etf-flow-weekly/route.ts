import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { emptyEtfFlowWeekly, loadEtfFlowWeekly } from "@/lib/etfFlowWeekly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const payload = await withServerCache("etf-flow-weekly:v1", 300_000, 900_000, loadEtfFlowWeekly);
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 503,
      headers: { "Cache-Control": cdnCacheHeader("etfSlow") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(emptyEtfFlowWeekly(message), { status: 500 });
  }
}

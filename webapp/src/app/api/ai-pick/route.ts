import { NextResponse } from "next/server";

import type { AiPickPayload } from "@/lib/aiPick";
import { buildAiPick } from "@/lib/aiPickData";
import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Inputs refresh at most a few times a day (20:10 ETF returns, 06:30 ACWI closes, weekly Flow). */
export async function GET() {
  try {
    const payload = await withServerCache("ai-pick:v3", 10 * 60_000, 60 * 60_000, buildAiPick);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("etfSlow") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    const body: Partial<AiPickPayload> = { ok: false, generated_at: new Date().toISOString(), error: message };
    return NextResponse.json(body, { status: 502 });
  }
}

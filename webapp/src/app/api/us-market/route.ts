import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { buildUsMarketPayload, type UsMarketPayload } from "@/lib/usMarket";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const payload = await withServerCache(
      "us-market:v2",
      90_000,
      300_000,
      () => buildUsMarketPayload(),
    );
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 502,
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    const body: UsMarketPayload = {
      ok: false,
      generated_at: new Date().toISOString(),
      as_of: null,
      note: "",
      interpretation: [],
      disclaimer: "투자 권유가 아닙니다.",
      boards: [],
      snaps: [],
      error: message,
    };
    return NextResponse.json(body, { status: 502 });
  }
}

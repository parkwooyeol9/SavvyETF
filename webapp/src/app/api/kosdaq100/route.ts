import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  buildKosdaq100Payload,
  type Kosdaq100Payload,
} from "@/lib/kosdaq100";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh =
    url.searchParams.get("refresh") === "1" ||
    url.searchParams.get("refresh") === "true";
  const cacheKey = refresh
    ? `kosdaq100:refresh:${Date.now()}`
    : "kosdaq100:v1";

  try {
    const payload = await withServerCache(cacheKey, 90_000, 300_000, () =>
      buildKosdaq100Payload({ refreshFundamentals: refresh }),
    );
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 502,
      headers: { "Cache-Control": cdnCacheHeader("market") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        as_of: null,
        universe_as_of: null,
        universe_count: 0,
        universe_source: "",
        weight_note: "",
        disclaimer: "투자 권유가 아닙니다.",
        summary: {
          total_mcap: null,
          advancers: 0,
          decliners: 0,
          unchanged: 0,
          high_quality: 0,
          median_per: null,
          median_roe: null,
          top_weight: [],
        },
        rows: [],
        error: message,
      } satisfies Kosdaq100Payload,
      { status: 502 },
    );
  }
}

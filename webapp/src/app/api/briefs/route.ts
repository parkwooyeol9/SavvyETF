import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { loadAllBriefs, remoteStoreConfigured } from "@/lib/briefs";
import { emptyAllBriefs } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await withServerCache(
      "briefs:v1",
      45_000,
      180_000,
      loadAllBriefs,
    );
    return NextResponse.json(
      {
        ok: true,
        configured: remoteStoreConfigured(),
        source: result.source,
        warning: result.warning,
        briefs: result.briefs,
      },
      { headers: { "Cache-Control": cdnCacheHeader("briefs") } },
    );
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Failed to load briefs";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        briefs: emptyAllBriefs(),
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  buildEtfDbUsPayload,
  persistUsSnapshot,
  type EtfDbUsPayload,
} from "@/lib/etfDbUs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request): Promise<EtfDbUsPayload> {
  const url = new URL(req.url);
  const equityOnly = url.searchParams.get("equity") === "1";
  const watchOnly = url.searchParams.get("watch") === "1";
  const payload = await buildEtfDbUsPayload({ equityOnly, watchOnly });
  // Persist for next-day flow (NAV × Δshares). Fire-and-forget style.
  void persistUsSnapshot(payload);
  return payload;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cacheKey = `etf-db-us:${url.searchParams.get("equity") || "0"}:${url.searchParams.get("watch") || "0"}`;
    // History rebuild is heavier — keep warm for 10 minutes.
    const payload = await withServerCache(cacheKey, 600_000, 900_000, () =>
      handle(req),
    );
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 400,
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : String(exc),
      },
      { status: 502 },
    );
  }
}

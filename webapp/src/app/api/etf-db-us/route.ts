import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  buildEtfDbUsPayload,
  loadLatestUsPayload,
  persistUsSnapshot,
  type EtfDbUsPayload,
} from "@/lib/etfDbUs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FRESH_MS = 10 * 60_000;

async function handle(req: Request): Promise<EtfDbUsPayload> {
  const url = new URL(req.url);
  const equityOnly = url.searchParams.get("equity") === "1";
  const watchOnly = url.searchParams.get("watch") === "1";
  const snap = await loadLatestUsPayload();
  const age = snap?.generated_at ? Date.now() - Date.parse(snap.generated_at) : Number.POSITIVE_INFINITY;
  const snapFits =
    snap?.ok &&
    Number.isFinite(age) &&
    age < FRESH_MS &&
    !!snap.equity_only === equityOnly &&
    !watchOnly;
  if (snapFits && snap) {
    return { ...snap, source: `${snap.source} · r2` };
  }
  try {
    const payload = await buildEtfDbUsPayload({ equityOnly, watchOnly });
    void persistUsSnapshot(payload);
    return payload;
  } catch (exc) {
    if (snap?.ok) {
      return {
        ...snap,
        source: `${snap.source} · r2-stale`,
        note: `${snap.note} 실시간 갱신 실패로 스냅샷을 표시합니다.`,
        error: exc instanceof Error ? exc.message : String(exc),
      };
    }
    throw exc;
  }
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

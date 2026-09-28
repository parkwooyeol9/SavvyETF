import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { loadMpTrackRecord, type MpTrackId } from "@/lib/mpTrackRecord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("series");
  if (id !== "MP1" && id !== "MP2") {
    return NextResponse.json({ ok: false, error: "series=MP1|MP2" }, { status: 400 });
  }
  try {
    const data = await withServerCache(`mp:track:v1:${id}`, 30 * 60_000, 6 * 3600_000, () => loadMpTrackRecord(id as MpTrackId));
    return NextResponse.json(data, { headers: { "Cache-Control": cdnCacheHeader("yahooSlow") } });
  } catch (exc) {
    return NextResponse.json({ ok: false, error: exc instanceof Error ? exc.message : "track record failed" }, { status: 502 });
  }
}

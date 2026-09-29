import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { loadMpTrackRecord, type MpTrackId } from "@/lib/mpTrackRecord";
import { siteAdminAuthorized } from "@/lib/siteAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("series");
  if (id !== "MP1" && id !== "MP2") {
    return NextResponse.json({ ok: false, error: "series=MP1|MP2" }, { status: 400 });
  }
  const wantFull = url.searchParams.get("full") === "1";
  try {
    const data = await withServerCache(`mp:track:v2:${id}`, 30 * 60_000, 6 * 3600_000, () => loadMpTrackRecord(id as MpTrackId));
    if (wantFull) {
      const full = siteAdminAuthorized(request);
      return NextResponse.json(full ? data : { ...data, monthly: [], years: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ ...data, monthly: [], years: [] }, { headers: { "Cache-Control": cdnCacheHeader("yahooSlow") } });
  } catch (exc) {
    return NextResponse.json({ ok: false, error: exc instanceof Error ? exc.message : "track record failed" }, { status: 502 });
  }
}

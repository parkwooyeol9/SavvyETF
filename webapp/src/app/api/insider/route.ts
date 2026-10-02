import { NextResponse } from "next/server";

import { getInsiderSpotlight } from "@/lib/insiderNews";
import { getInsiderSummary, lookupInsiderTicker } from "@/lib/insiderServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = (params.get("ticker") || "").trim().slice(0, 12);
  try {
    if (params.has("spotlight")) {
      const data = await getInsiderSpotlight();
      return NextResponse.json(data, {
        headers: data.items.length
          ? { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" }
          : {},
      });
    }
    if (ticker) {
      const data = await lookupInsiderTicker(ticker);
      return NextResponse.json(data, {
        status: data.ok ? 200 : 404,
        headers: data.ok
          ? { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" }
          : {},
      });
    }
    return NextResponse.json(await getInsiderSummary(), {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" },
    });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : String(exc) },
      { status: 502 },
    );
  }
}

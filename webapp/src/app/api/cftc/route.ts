import { NextResponse } from "next/server";

import { getCftcPayload } from "@/lib/cftc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";
    const payload = await getCftcPayload({ force });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "CFTC load failed",
        markets: [],
        generated_at: new Date().toISOString(),
        generated_at_display: "",
        as_of: null,
        source: "",
        schedule_note: "",
        note: "",
        from_cache: false,
      },
      { status: 500 },
    );
  }
}

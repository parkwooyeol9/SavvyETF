import { NextResponse } from "next/server";

import { loadKimchiStudy, tickKimchiStudy } from "@/lib/kimchiPremiumStudy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";
  try {
    const report = force ? await tickKimchiStudy() : (await loadKimchiStudy()) || (await tickKimchiStudy());
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "kimchi study failed",
      },
      { status: 500 },
    );
  }
}

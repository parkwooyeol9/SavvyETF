import { NextResponse } from "next/server";

import { buildBinancePaperPayload } from "@/lib/binancePaperTrading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";
  try {
    const payload = await buildBinancePaperPayload({ forceTick: force });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        engine: "binance",
        error: exc instanceof Error ? exc.message : "binance paper load failed",
      },
      { status: 500 },
    );
  }
}

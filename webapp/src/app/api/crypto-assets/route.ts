import { NextResponse } from "next/server";

import { buildCryptoAssetsPayload } from "@/lib/cryptoAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const payload = await buildCryptoAssetsPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "crypto assets load failed",
        generated_at: new Date().toISOString(),
        generated_at_display: "",
        source: "",
        schedule_note: "",
        note: "",
        usdkrw: null,
        assets: [],
        kimchi: [],
        indicators: [],
        fear_greed: [],
        interpretations: [],
      },
      { status: 500 },
    );
  }
}

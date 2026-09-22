import { NextResponse } from "next/server";

import { withServerCache } from "@/lib/apiCache";
import { computeCryptoRegimeStudy } from "@/lib/cryptoRegimeStudy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await withServerCache(
      "crypto-regime-study",
      10 * 60_000,
      30 * 60_000,
      () => computeCryptoRegimeStudy(),
    );
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        bar: "5m",
        assets: [],
        methodology: [],
        headline_ko: "",
        error: exc instanceof Error ? exc.message : "레짐 분석 실패",
      },
      { status: 500 },
    );
  }
}

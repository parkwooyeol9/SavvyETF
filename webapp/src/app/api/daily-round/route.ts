import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { buildDailyRound } from "@/lib/dailyRound";
import { isoTodayKst } from "@/lib/laborRisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const date = isoTodayKst();
    const payload = await withServerCache(
      `daily-round:v1:${date}`,
      110_000,
      300_000,
      buildDailyRound,
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        date: isoTodayKst(),
        generated_at: new Date().toISOString(),
        questions: [],
        error: exc instanceof Error ? exc.message : "라운드를 만들지 못했습니다.",
      },
      { status: 502 },
    );
  }
}

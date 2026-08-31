import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { buildChartTrade, isoTodayKst } from "@/lib/chartTrade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const date = isoTodayKst();
  const payload = await withServerCache(
    `chart-trade:v1:${date}`,
    110_000,
    300_000,
    () => buildChartTrade(date),
  );
  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 502,
    headers: { "Cache-Control": cdnCacheHeader("yahoo") },
  });
}

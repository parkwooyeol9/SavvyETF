import { NextResponse } from "next/server";

import { cdnCacheHeader } from "@/lib/apiCache";
import { getChartTrade, isoTodayKst } from "@/lib/chartTrade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const date = isoTodayKst();
  const payload = await getChartTrade(date);
  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 502,
    headers: { "Cache-Control": cdnCacheHeader("yahoo") },
  });
}

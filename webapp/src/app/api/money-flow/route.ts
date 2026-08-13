import { NextResponse } from "next/server";

import { cdnCacheHeader } from "@/lib/apiCache";
import {
  getMoneyFlowPayload,
  type MoneyFlowPeriod,
} from "@/lib/moneyFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parsePeriod(raw: string | null): MoneyFlowPeriod {
  if (raw === "1w" || raw === "3m" || raw === "1m") return raw;
  return "1m";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get("period"));
  try {
    const payload = await getMoneyFlowPayload(period);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("market") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        period,
        error: exc instanceof Error ? exc.message : "money flow failed",
      },
      { status: 500 },
    );
  }
}

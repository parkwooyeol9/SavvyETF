import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
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

// Admin-only tab (글로벌 자금 흐름). weight-optimize forwards the admin header.
export async function GET(request: Request) {
  const denied = requireSiteAdmin(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get("period"));
  try {
    const payload = await getMoneyFlowPayload(period);
    return NextResponse.json(payload, {
      headers: PRIVATE_NO_STORE,
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        period,
        error: exc instanceof Error ? exc.message : "money flow failed",
      },
      { status: 500, headers: PRIVATE_NO_STORE },
    );
  }
}

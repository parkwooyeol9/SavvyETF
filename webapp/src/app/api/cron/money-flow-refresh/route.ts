import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { buildMoneyFlowPayload } from "@/lib/moneyFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(token && secretsEqual(token, secret));
}

/** Optional scheduled refresh → R2. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const payload = await buildMoneyFlowPayload("1m");
    return NextResponse.json({
      ok: payload.ok,
      as_of_kst: payload.as_of_kst,
      rows: payload.rows.length,
      errors: payload.errors,
      regime: payload.risk_summary.regime,
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "money-flow refresh failed",
      },
      { status: 500 },
    );
  }
}

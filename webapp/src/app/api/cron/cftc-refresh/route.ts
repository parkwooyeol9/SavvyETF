import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { buildCftcPayload, persistCftcPayload } from "@/lib/cftc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily 09:00 KST (= 00:00 UTC) CFTC snapshot refresh → R2.
 * Schedule: vercel.json cron `0 0 * * *`
 */
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

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await buildCftcPayload();
    if (payload.ok) await persistCftcPayload(payload);
    return NextResponse.json({
      ok: payload.ok,
      as_of: payload.as_of,
      markets: payload.markets.filter((m) => m.latest).length,
      generated_at: payload.generated_at,
      error: payload.error,
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "cftc refresh failed",
      },
      { status: 500 },
    );
  }
}

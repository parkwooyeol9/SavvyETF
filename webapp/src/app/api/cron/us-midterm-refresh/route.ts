import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily 07:00 KST (= 22:00 UTC) midterm snapshot.
 * Hits /api/us-midterm?refresh=1 with the cron secret so the panel
 * rebuilds Polymarket / Yahoo / RSS and writes R2.
 * Schedule: vercel.json cron `0 22 * * *`
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

function origin(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod}`;
  const host = process.env.VERCEL_URL?.trim();
  if (host) return `https://${host}`;
  return "http://localhost:3000";
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.CRON_SECRET!.trim();
  const started = Date.now();
  try {
    const res = await fetch(`${origin()}/api/us-midterm?refresh=1`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
      },
      signal: AbortSignal.timeout(55_000),
      cache: "no-store",
    });
    const data = (await res.json()) as {
      ok?: boolean;
      generated_at?: string;
      snapshot_kst?: string;
      races?: unknown[];
      error?: string;
    };
    return NextResponse.json({
      ok: res.ok && data.ok !== false,
      status: res.status,
      ms: Date.now() - started,
      generated_at: data.generated_at,
      snapshot_kst: data.snapshot_kst,
      races: Array.isArray(data.races) ? data.races.length : 0,
      error: data.error,
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "us-midterm refresh failed",
        ms: Date.now() - started,
      },
      { status: 500 },
    );
  }
}

import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Prefetch high-traffic panels so the first 100 visitors hit memory/CDN/R2
 * instead of Yahoo / the Render bot.
 */
const WARM_PATHS = [
  "/api/briefs",
  "/api/heatmap?universe=etf&top_n=30",
  "/api/why-etf",
  "/api/etf-kor15",
  "/api/etf-new?kr=10&us=10",
  "/api/kr-market",
  "/api/etf-db-us",
  "/api/ai-etf",
  "/api/nlp-pulse",
] as const;

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

  const base = origin();
  const results = await Promise.all(
    WARM_PATHS.map(async (path) => {
      const started = Date.now();
      try {
        const res = await fetch(`${base}${path}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(55_000),
        });
        return { path, status: res.status, ms: Date.now() - started };
      } catch {
        return { path, status: 0, ms: Date.now() - started };
      }
    }),
  );

  const failed = results.filter((r) => r.status < 200 || r.status >= 300).length;
  return NextResponse.json({
    ok: failed === 0,
    warmed: results.length,
    failed,
    results,
  });
}

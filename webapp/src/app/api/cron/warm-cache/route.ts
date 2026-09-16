import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/secretsEqual";
import { isUsDbWarmWindow } from "@/lib/usEquitySession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Staggered prefetch so the first visitors hit memory/CDN/R2 instead of Yahoo
 * / the Render bot — without self-DDoS'ing Yahoo 144×/day.
 *
 * Vercel still ticks every 10 minutes. Heavy origin work is skipped by bucket:
 *   always     briefs + kr-market
 *   :10/:40    heatmap (etf/sp/nas) + NLP + AI ETF + ETF 시황
 *   :00        why-etf (hourly)
 *   :00/:30    US DB, only 08:00–17:00 ET on NYSE days, after the other paths
 */
const LIGHT_PATHS = ["/api/briefs", "/api/kr-market"] as const;

const MEDIUM_PATHS = [
  "/api/heatmap?universe=etf&top_n=30",
  "/api/heatmap?universe=sp&top_n=30",
  "/api/heatmap?universe=nas&top_n=30",
  "/api/ai-etf",
  "/api/nlp-pulse",
  "/api/etf-kor15",
  "/api/etf-new?kr=10&us=10",
] as const;

const HOURLY_PATHS = ["/api/why-etf"] as const;

const US_DB_PATH = "/api/etf-db-us?equity=1";

function origin(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod}`;
  const host = process.env.VERCEL_URL?.trim();
  if (host) return `https://${host}`;
  return "http://localhost:3000";
}

function cronBucket(now = new Date()): number {
  return Math.floor(now.getUTCMinutes() / 10) * 10;
}

async function warmOne(
  base: string,
  path: string,
  timeoutMs: number,
): Promise<{ path: string; status: number; ms: number }> {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { path, status: res.status, ms: Date.now() - started };
  } catch {
    return { path, status: 0, ms: Date.now() - started };
  }
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const base = origin();
  const bucket = cronBucket();
  const usWindow = isUsDbWarmWindow();
  const paths: string[] = [...LIGHT_PATHS];
  if (bucket === 10 || bucket === 40) paths.push(...MEDIUM_PATHS);
  if (bucket === 0) paths.push(...HOURLY_PATHS);
  const warmUsDb = usWindow && (bucket === 0 || bucket === 30);

  const results = await Promise.all(
    paths.map((path) => warmOne(base, path, 55_000)),
  );
  if (warmUsDb) {
    results.push(await warmOne(base, US_DB_PATH, 110_000));
  }

  const failed = results.filter((r) => r.status < 200 || r.status >= 300).length;
  return NextResponse.json({
    ok: failed === 0,
    bucket,
    us_window: usWindow,
    warmed: results.length,
    skipped_us_db: !warmUsDb,
    failed,
    results,
  });
}

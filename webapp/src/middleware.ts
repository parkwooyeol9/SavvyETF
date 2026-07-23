import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { clientIp, rateLimit } from "@/lib/rateLimit";

const HEAVY_PATHS: Record<string, { limit: number; windowMs: number }> = {
  "/api/simulate": { limit: 12, windowMs: 60_000 },
  "/api/why-etf": { limit: 20, windowMs: 60_000 },
  "/api/heatmap": { limit: 20, windowMs: 60_000 },
  "/api/kr-market": { limit: 20, windowMs: 60_000 },
  "/api/esg-carbon": { limit: 20, windowMs: 60_000 },
  "/api/fx": { limit: 40, windowMs: 60_000 },
  "/api/ingest": { limit: 60, windowMs: 60_000 },
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rule = HEAVY_PATHS[pathname];
  const responseHeaders = new Headers();
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  responseHeaders.set("X-Frame-Options", "SAMEORIGIN");
  responseHeaders.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://*.vercel-storage.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self' blob:",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  if (rule) {
    const ip = clientIp(request);
    const result = rateLimit(`${pathname}:${ip}`, rule);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(result.retryAfterSec),
            ...Object.fromEntries(responseHeaders.entries()),
          },
        },
      );
    }
  }

  const res = NextResponse.next();
  responseHeaders.forEach((value, key) => res.headers.set(key, value));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

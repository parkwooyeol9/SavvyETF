import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { clientIp, rateLimit } from "@/lib/rateLimit";
import { updateSession } from "@/lib/supabase/middleware";

const HEAVY_PATHS: Record<string, { limit: number; windowMs: number }> = {
  "/api/simulate": { limit: 12, windowMs: 60_000 },
  "/api/why-etf": { limit: 20, windowMs: 60_000 },
  "/api/heatmap": { limit: 20, windowMs: 60_000 },
  "/api/kr-market": { limit: 20, windowMs: 60_000 },
  "/api/esg-carbon": { limit: 20, windowMs: 60_000 },
  "/api/esg-themes": { limit: 30, windowMs: 60_000 },
  "/api/fx": { limit: 40, windowMs: 60_000 },
  "/api/geo": { limit: 30, windowMs: 60_000 },
  "/api/ingest": { limit: 60, windowMs: 60_000 },
  "/api/community/posts": { limit: 30, windowMs: 60_000 },
};

export async function middleware(request: NextRequest) {
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://*.vercel-storage.com https://*.onrender.com https://*.r2.dev https://*.cloudflarestorage.com https://*.googleusercontent.com https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.onrender.com https://*.supabase.co wss://*.supabase.co https://accounts.google.com",
      "frame-src 'self' blob: https://accounts.google.com https://*.supabase.co",
      "base-uri 'self'",
      "form-action 'self' https://accounts.google.com https://*.supabase.co",
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

  let res = NextResponse.next({
    request: { headers: request.headers },
  });
  responseHeaders.forEach((value, key) => res.headers.set(key, value));
  res = await updateSession(request, res);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

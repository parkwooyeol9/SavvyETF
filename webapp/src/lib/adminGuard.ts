import { NextResponse } from "next/server";

import { siteAdminAuthorized, siteAdminConfigured } from "@/lib/siteAdmin";

/**
 * Responses that depend on who is asking must never be stored by the CDN:
 * Vercel's edge cache does not key on `Authorization`, so a `public, s-maxage`
 * admin response would be replayed to anonymous visitors.
 */
export const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Server-side gate for admin-only API routes. Returns a ready 401/503 response
 * when the caller is not the site admin, or `null` when the request may proceed.
 * Hiding a tab in the UI is not access control — every admin-only tab's API
 * must call this.
 */
export function requireSiteAdmin(request: Request): NextResponse | null {
  if (!siteAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "관리자 비밀번호가 설정되지 않았습니다." },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
  if (!siteAdminAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "관리자 전용입니다." },
      { status: 401, headers: PRIVATE_NO_STORE },
    );
  }
  return null;
}

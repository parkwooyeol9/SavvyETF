import { NextResponse } from "next/server";

import { siteAdminAuthorized } from "@/lib/siteAdmin";
import { revokeToken } from "@/lib/tvMcp/oauth";
import { TV_SESSION_COOKIE, clearCookie, readSession } from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!siteAdminAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "운영자 로그인이 필요합니다." }, { status: 401 });
  }
  const session = readSession(request);
  if (session) {
    await revokeToken(session.clientId, session.refreshToken || session.accessToken);
  }
  const res = NextResponse.json({ ok: true, connected: false });
  clearCookie(res, request, TV_SESSION_COOKIE);
  return res;
}

import { NextResponse } from "next/server";

import { siteAdminAuthorized } from "@/lib/siteAdmin";
import {
  buildAuthorizeUrl,
  createPkce,
  randomState,
  registerClient,
} from "@/lib/tvMcp/oauth";
import { callbackUrl, readSession, setPendingCookie } from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!siteAdminAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "운영자 로그인이 필요합니다." }, { status: 401 });
  }
  try {
    const redirectUri = callbackUrl(request);
    const previous = readSession(request);
    const clientId =
      previous && previous.redirectUri === redirectUri
        ? previous.clientId
        : await registerClient(redirectUri);
    const { verifier, challenge } = createPkce();
    const state = randomState();
    const url = buildAuthorizeUrl({ clientId, redirectUri, state, challenge });
    const res = NextResponse.json({ ok: true, url });
    setPendingCookie(res, request, { state, verifier, clientId, redirectUri });
    return res;
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "연결 시작 실패" },
      { status: 502 },
    );
  }
}

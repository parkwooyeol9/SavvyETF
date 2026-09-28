import { NextResponse } from "next/server";

import { exchangeCode } from "@/lib/tvMcp/oauth";
import {
  TV_PENDING_COOKIE,
  clearCookie,
  readPending,
  setSessionCookie,
} from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backToMain(request: Request, params: Record<string, string>) {
  const url = new URL("/", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url, { status: 302 });
  clearCookie(res, request, TV_PENDING_COOKIE);
  return res;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pending = readPending(request);
  const oauthError = params.get("error");
  if (oauthError) {
    return backToMain(request, { tv_error: params.get("error_description") || oauthError });
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!pending || !code || !state || state !== pending.state) {
    return backToMain(request, { tv_error: "연결 요청이 만료되었거나 일치하지 않습니다. 다시 시도하세요." });
  }
  try {
    const tokens = await exchangeCode({
      code,
      verifier: pending.verifier,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
    });
    const res = backToMain(request, { tv: "connected" });
    setSessionCookie(res, request, {
      ...tokens,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
    });
    return res;
  } catch (exc) {
    return backToMain(request, {
      tv_error: exc instanceof Error ? exc.message : "토큰 교환 실패",
    });
  }
}

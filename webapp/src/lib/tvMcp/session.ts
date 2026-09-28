import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { primarySiteAdminSecret, siteAdminAuthorized } from "@/lib/siteAdmin";
import { TvAuthError, TvMcpSession, TvToolError } from "@/lib/tvMcp/client";
import { refreshTokens, type TvTokens } from "@/lib/tvMcp/oauth";

export const TV_SESSION_COOKIE = "tv_session";
export const TV_PENDING_COOKIE = "tv_oauth_pending";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;
const PENDING_MAX_AGE_SEC = 60 * 10;
const MAX_COOKIE_CHARS = 3900;

export type TvSessionCookie = TvTokens & { clientId: string; redirectUri: string };

export type TvPendingCookie = {
  state: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
};

function cookieKey(): Buffer {
  const material = process.env.TV_MCP_COOKIE_SECRET?.trim() || primarySiteAdminSecret();
  if (!material) throw new Error("TV_MCP_COOKIE_SECRET 또는 관리자 비밀번호가 설정되지 않았습니다.");
  return createHash("sha256").update(`savvyetf-tv-mcp:${material}`).digest();
}

export function sealCookie(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  if (sealed.length > MAX_COOKIE_CHARS) {
    throw new Error("TradingView 토큰이 쿠키 크기 한도를 넘습니다.");
  }
  return sealed;
}

export function unsealCookie<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", cookieKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const text = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return undefined;
}

function cookieBase(request: Request) {
  return {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax" as const,
    path: "/api/tv",
  };
}

export function readSession(request: Request): TvSessionCookie | null {
  return unsealCookie<TvSessionCookie>(readCookie(request, TV_SESSION_COOKIE));
}

export function readPending(request: Request): TvPendingCookie | null {
  return unsealCookie<TvPendingCookie>(readCookie(request, TV_PENDING_COOKIE));
}

export function setSessionCookie(res: NextResponse, request: Request, session: TvSessionCookie) {
  res.cookies.set(TV_SESSION_COOKIE, sealCookie(session), {
    ...cookieBase(request),
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export function setPendingCookie(res: NextResponse, request: Request, pending: TvPendingCookie) {
  res.cookies.set(TV_PENDING_COOKIE, sealCookie(pending), {
    ...cookieBase(request),
    maxAge: PENDING_MAX_AGE_SEC,
  });
}

export function clearCookie(res: NextResponse, request: Request, name: string) {
  res.cookies.set(name, "", { ...cookieBase(request), maxAge: 0 });
}

export function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/api/tv/oauth/callback`;
}

type Handler = (tv: TvMcpSession, request: Request) => Promise<Record<string, unknown>>;

/**
 * Operator-only TradingView call: requires the site admin bearer plus the
 * operator's own OAuth cookie. Refreshes the access token when near expiry.
 */
export async function withTvSession(request: Request, handler: Handler): Promise<NextResponse> {
  if (!siteAdminAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "운영자 로그인이 필요합니다." }, { status: 401 });
  }
  let session = readSession(request);
  if (!session) {
    return NextResponse.json({ ok: true, connected: false });
  }

  let refreshed = false;
  const refresh = async () => {
    if (!session?.refreshToken) throw new TvAuthError("TradingView 재연결이 필요합니다.");
    session = { ...session, ...(await refreshTokens(session.clientId, session.refreshToken)) };
    refreshed = true;
  };

  try {
    if (session.expiresAt - Date.now() < 60_000) await refresh();
    let payload: Record<string, unknown>;
    const run = async () => {
      const tv = new TvMcpSession(session!.accessToken);
      try {
        return await handler(tv, request);
      } finally {
        await tv.close();
      }
    };
    try {
      payload = await run();
    } catch (exc) {
      if (!(exc instanceof TvAuthError) || refreshed) throw exc;
      await refresh();
      payload = await run();
    }
    const res = NextResponse.json({ ok: true, connected: true, ...payload });
    if (refreshed && session) setSessionCookie(res, request, session);
    return res;
  } catch (exc) {
    if (exc instanceof TvAuthError) {
      const res = NextResponse.json({ ok: false, connected: false, error: exc.message }, { status: 200 });
      clearCookie(res, request, TV_SESSION_COOKIE);
      return res;
    }
    const status = exc instanceof TvToolError ? (exc.rateLimited ? 429 : 502) : 400;
    const message = exc instanceof Error ? exc.message : "TradingView 호출 실패";
    return NextResponse.json({ ok: false, connected: true, error: message }, { status });
  }
}

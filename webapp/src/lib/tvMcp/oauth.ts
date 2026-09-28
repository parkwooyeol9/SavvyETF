import { createHash, randomBytes } from "crypto";

export const TV_MCP_URL = "https://mcp.tradingview.com/mcp";
const AUTHORIZE_URL = "https://www.tradingview.com/mcp/oauth/authorize";
const TOKEN_URL = "https://www.tradingview.com/mcp/oauth/token";
const REGISTER_URL = "https://www.tradingview.com/mcp/oauth/register";
const REVOKE_URL = "https://www.tradingview.com/mcp/oauth/revoke";
const SCOPE = "mcp:read mcp:tools";

export type TvTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(randomBytes(24));
}

export async function registerClient(redirectUri: string): Promise<string> {
  const fixed = process.env.TV_MCP_CLIENT_ID?.trim();
  if (fixed) return fixed;
  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "SavvyETF Operator",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { client_id?: string; error?: string };
  if (!res.ok || !json.client_id) {
    throw new Error(`TradingView 클라이언트 등록 실패 (${res.status}${json.error ? `: ${json.error}` : ""})`);
  }
  return json.client_id;
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: SCOPE,
    resource: TV_MCP_URL,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<TvTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...body, resource: TV_MCP_URL }).toString(),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const reason = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`TradingView 토큰 발급 실패: ${reason}`);
  }
  const ttlSec = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresAt: Date.now() + ttlSec * 1000,
  };
}

export function exchangeCode(opts: {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<TvTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    code: opts.code,
    code_verifier: opts.verifier,
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
  });
}

export async function refreshTokens(clientId: string, refreshToken: string): Promise<TvTokens> {
  const next = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  return { ...next, refreshToken: next.refreshToken || refreshToken };
}

export async function revokeToken(clientId: string, token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: clientId }).toString(),
      cache: "no-store",
    });
  } catch {
    // Revocation is best-effort; the cookie is cleared regardless.
  }
}

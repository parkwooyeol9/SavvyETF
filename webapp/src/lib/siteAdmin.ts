import { clientIp, rateLimit, rateLimitBlocked } from "@/lib/rateLimit";
import { bearerToken, secretsEqual } from "@/lib/secretsEqual";

const ADMIN_FAIL_LIMIT = 10;
const ADMIN_FAIL_WINDOW_MS = 15 * 60_000;

function siteAdminSecrets(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [
    process.env.CARDNEWS_ADMIN_SECRET,
    process.env.RESEARCH_ADMIN_SECRET,
    process.env.COMMUNITY_ADMIN_SECRET,
  ]) {
    const secret = raw?.trim() || "";
    if (!secret || seen.has(secret)) continue;
    seen.add(secret);
    out.push(secret);
  }
  return out;
}

export function primarySiteAdminSecret(): string {
  return siteAdminSecrets()[0] || "";
}

export function siteAdminConfigured(): boolean {
  return siteAdminSecrets().length > 0;
}

function adminFailKey(request: Request): string {
  return `admin-fail:${clientIp(request)}`;
}

/**
 * Wrong admin passwords share one counter per IP. After 10 failures the IP
 * stays locked for 15 minutes, including a later correct password.
 * Callers with no credential (empty candidate, or no Bearer) are not counted.
 */
export function siteAdminSecretMatches(candidate: string, request?: Request): boolean {
  const secret = candidate.trim();
  if (!secret) return false;
  if (request && rateLimitBlocked(adminFailKey(request))) return false;
  const matched = siteAdminSecrets().some((value) => secretsEqual(secret, value));
  if (request && !matched) {
    rateLimit(adminFailKey(request), {
      limit: ADMIN_FAIL_LIMIT,
      windowMs: ADMIN_FAIL_WINDOW_MS,
    });
  }
  return matched;
}

export function siteAdminAuthorized(request: Request): boolean {
  const token = bearerToken(request);
  if (!token) return false;
  return siteAdminSecretMatches(token, request);
}

import { bearerToken, secretsEqual } from "@/lib/secretsEqual";

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

export function siteAdminConfigured(): boolean {
  return siteAdminSecrets().length > 0;
}

export function siteAdminSecretMatches(candidate: string): boolean {
  const secret = candidate.trim();
  if (!secret) return false;
  return siteAdminSecrets().some((value) => secretsEqual(secret, value));
}

export function siteAdminAuthorized(request: Request): boolean {
  const token = bearerToken(request);
  return Boolean(token && siteAdminSecretMatches(token));
}

import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import { r2Configured, r2PresignPut } from "@/lib/r2";
import { bearerToken, secretsEqual } from "@/lib/secretsEqual";
import { PRIVATE_PREFIXES } from "@/lib/sealedData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_RE = /^private\/[a-z_]+\/[A-Za-z0-9_./-]+\.bin$/;

/** Upload-only credential: can presign PUTs under PRIVATE_PREFIXES and nothing else. */
function uploadTokenAuthorized(request: Request): boolean {
  const expected = process.env.PRIVATE_UPLOAD_TOKEN?.trim() || "";
  const token = bearerToken(request);
  return expected.length >= 32 && token !== "" && secretsEqual(token, expected);
}

/**
 * Presigned PUT URLs for sealed datasets (Claude_DB/sealed_r2.py upload), so the
 * Mac pipeline needs only the admin password or PRIVATE_UPLOAD_TOKEN, never the R2 credentials.
 */
export async function POST(request: Request) {
  if (!uploadTokenAuthorized(request)) {
    const denied = requireSiteAdmin(request);
    if (denied) return denied;
  }
  if (!r2Configured()) {
    return NextResponse.json({ ok: false, error: "R2 미설정" }, { status: 503, headers: PRIVATE_NO_STORE });
  }
  const body = (await request.json().catch(() => null)) as { keys?: unknown } | null;
  const keys = Array.isArray(body?.keys) ? body.keys.filter((k): k is string => typeof k === "string") : [];
  const ok = keys.length > 0 && keys.length <= 50 && keys.every(
    (k) => KEY_RE.test(k) && !k.includes("..") && PRIVATE_PREFIXES.some((p) => k.startsWith(p)),
  );
  if (!ok) {
    return NextResponse.json({ ok: false, error: "허용되지 않은 키" }, { status: 400, headers: PRIVATE_NO_STORE });
  }
  const urls: Record<string, string> = {};
  for (const key of keys) {
    urls[key] = await r2PresignPut(key, "application/octet-stream", 900, "private, no-store");
  }
  return NextResponse.json({ ok: true, urls }, { headers: PRIVATE_NO_STORE });
}

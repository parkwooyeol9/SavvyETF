import { NextResponse } from "next/server";

import { siteAdminConfigured, siteAdminSecretMatches } from "@/lib/siteAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!siteAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "관리자 비밀번호가 아직 설정되지 않았습니다." },
      { status: 503 },
    );
  }
  let body: { secret?: string } = {};
  try {
    body = (await request.json()) as { secret?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (!siteAdminSecretMatches(secret)) {
    return NextResponse.json(
      { ok: false, error: "비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }
  return NextResponse.json({ ok: true });
}

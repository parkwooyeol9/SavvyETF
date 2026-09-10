import { NextResponse } from "next/server";

import {
  completeResearchUpload,
  researchAdminConfigured,
  researchAuthorized,
} from "@/lib/researchPapers";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "관리자만 올리거나 지울 수 있습니다." },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  if (!r2Configured()) {
    return NextResponse.json(
      { ok: false, error: "저장소(R2)가 설정되지 않았습니다." },
      { status: 503 },
    );
  }
  if (!researchAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "관리자 비밀번호가 아직 설정되지 않았습니다." },
      { status: 503 },
    );
  }
  if (!researchAuthorized(request)) return unauthorized();

  let body: {
    id?: string;
    key?: string;
    token?: string;
    title?: string;
    published_at?: string;
    filename?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const item = await completeResearchUpload({
      id: String(body.id || ""),
      key: String(body.key || ""),
      token: String(body.token || ""),
      title: String(body.title || ""),
      published_at: String(body.published_at || ""),
      filename: String(body.filename || ""),
    });
    return NextResponse.json({ ok: true, item });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "complete failed" },
      { status: 400 },
    );
  }
}

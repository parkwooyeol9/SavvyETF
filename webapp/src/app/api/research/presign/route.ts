import { NextResponse } from "next/server";

import { RESEARCH_MAX_PDF_BYTES } from "@/lib/researchMeta";
import {
  createResearchUpload,
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
    title?: string;
    published_at?: string;
    filename?: string;
    size?: number;
    chunked?: boolean;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const slot = await createResearchUpload({
      title: String(body.title || ""),
      published_at: String(body.published_at || ""),
      filename: String(body.filename || ""),
      size: Number(body.size || 0),
      chunked: Boolean(body.chunked),
    });
    return NextResponse.json({
      ok: true,
      ...slot,
      max_bytes: RESEARCH_MAX_PDF_BYTES,
    });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "presign failed" },
      { status: 400 },
    );
  }
}

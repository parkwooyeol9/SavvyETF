import { NextResponse } from "next/server";

import { RESEARCH_PROXY_PDF_BYTES } from "@/lib/researchMeta";
import {
  putResearchChunk,
  researchAdminConfigured,
  researchAuthorized,
} from "@/lib/researchPapers";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "업로드 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "조각 파일이 없습니다." },
      { status: 400 },
    );
  }
  if (file.size > RESEARCH_PROXY_PDF_BYTES) {
    return NextResponse.json(
      { ok: false, error: "조각이 너무 큽니다. 다시 올려 주세요." },
      { status: 400 },
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    await putResearchChunk({
      id: String(form.get("id") || ""),
      key: String(form.get("key") || ""),
      token: String(form.get("token") || ""),
      published_at: String(form.get("published_at") || ""),
      filename: String(form.get("filename") || ""),
      part: Number(form.get("part")),
      total: Number(form.get("total")),
      bytes,
    });
    return NextResponse.json({ ok: true });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "chunk failed" },
      { status: 400 },
    );
  }
}

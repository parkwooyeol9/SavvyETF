import { NextResponse } from "next/server";

import {
  addResearchPaper,
  deleteResearchPaper,
  loadResearch,
  publicResearchPapers,
  researchAdminConfigured,
  researchAuthorized,
} from "@/lib/researchPapers";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PDF_BYTES = 4_000_000;

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "관리자만 올리거나 지울 수 있습니다." },
    { status: 401 },
  );
}

export async function GET() {
  if (!r2Configured()) {
    return NextResponse.json({
      ok: true,
      updated_at: null,
      items: [],
    });
  }
  const store = await loadResearch();
  return NextResponse.json({
    ok: true,
    updated_at: store.updated_at,
    items: publicResearchPapers(store.items),
  });
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
  const title = String(form.get("title") || "").trim();
  const category = String(form.get("category") || "").trim();
  const publishedAt = String(form.get("published_at") || "").trim();
  const summary = String(form.get("summary") || "").trim();
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json(
      { ok: false, error: "PDF 파일이 필요합니다." },
      { status: 400 },
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { ok: false, error: "파일이 너무 큽니다. 4MB 이하 PDF로 올려 주세요." },
      { status: 413 },
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const item = await addResearchPaper({
      title,
      category,
      published_at: publishedAt,
      summary,
      filename: file.name,
      bytes,
    });
    return NextResponse.json({ ok: true, item });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "upload failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "삭제할 리서치가 없습니다." },
      { status: 400 },
    );
  }
  try {
    await deleteResearchPaper(id);
    return NextResponse.json({ ok: true });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "delete failed" },
      { status: 400 },
    );
  }
}

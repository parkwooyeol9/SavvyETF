import { NextResponse } from "next/server";

import {
  addResearchPaper,
  deleteResearchPapers,
  loadResearch,
  publicResearchPapers,
  researchAdminConfigured,
  researchAuthorized,
  researchStorageStats,
  updateResearchCategories,
} from "@/lib/researchPapers";
import { RESEARCH_PROXY_PDF_BYTES } from "@/lib/researchMeta";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PDF_BYTES = RESEARCH_PROXY_PDF_BYTES;

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "관리자만 올리거나 지울 수 있습니다." },
    { status: 401 },
  );
}

export async function GET(request: Request) {
  if (!r2Configured()) {
    return NextResponse.json({
      ok: true,
      updated_at: null,
      items: [],
    });
  }
  const store = await loadResearch();
  const { searchParams } = new URL(request.url);
  const usage =
    searchParams.get("usage") === "1" && researchAuthorized(request)
      ? await researchStorageStats()
      : undefined;
  return NextResponse.json({
    ok: true,
    updated_at: store.updated_at,
    items: publicResearchPapers(store.items),
    usage,
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
  const originalName = String(form.get("filename") || "").trim();
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json(
      { ok: false, error: "PDF 파일이 필요합니다." },
      { status: 400 },
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "파일이 커서 직접 업로드가 필요합니다. 관리자 화면에서 다시 올려 주세요.",
      },
      { status: 413 },
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const item = await addResearchPaper({
      title,
      category: category || "pending",
      published_at: publishedAt,
      summary,
      filename: originalName || file.name,
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
  const ids: string[] = [];
  const one = (searchParams.get("id") || "").trim();
  if (one) ids.push(one);
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as { ids?: string[]; id?: string };
      if (Array.isArray(body.ids)) ids.push(...body.ids.map(String));
      if (body.id) ids.push(String(body.id));
    } catch {
      /* query id only */
    }
  }
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) {
    return NextResponse.json(
      { ok: false, error: "삭제할 리서치가 없습니다." },
      { status: 400 },
    );
  }
  try {
    const deleted = await deleteResearchPapers(unique);
    return NextResponse.json({ ok: true, deleted });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "delete failed" },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
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

  let body: { ids?: string[]; category?: string } = {};
  try {
    body = (await request.json()) as { ids?: string[]; category?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  try {
    const changed = await updateResearchCategories(
      ids,
      String(body.category || ""),
    );
    return NextResponse.json({ ok: true, changed });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "update failed" },
      { status: 400 },
    );
  }
}

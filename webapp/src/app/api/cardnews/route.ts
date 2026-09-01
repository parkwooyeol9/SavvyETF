import { NextResponse } from "next/server";

import {
  addCardNewsImage,
  cardNewsAdminConfigured,
  cardNewsAuthorized,
  deleteCardNewsImage,
  groupCardNewsDays,
  loadCardNews,
} from "@/lib/cardNews";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 3_500_000;

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
      days: [],
    });
  }
  const store = await loadCardNews();
  return NextResponse.json({
    ok: true,
    updated_at: store.updated_at,
    days: groupCardNewsDays(store.items),
  });
}

export async function POST(request: Request) {
  if (!r2Configured()) {
    return NextResponse.json(
      { ok: false, error: "저장소(R2)가 설정되지 않았습니다." },
      { status: 503 },
    );
  }
  if (!cardNewsAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "관리자 비밀번호가 아직 설정되지 않았습니다." },
      { status: 503 },
    );
  }
  if (!cardNewsAuthorized(request)) return unauthorized();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "업로드 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const date = String(form.get("date") || "").trim();
  const caption = String(form.get("caption") || "").trim();
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json(
      { ok: false, error: "이미지 파일이 필요합니다." },
      { status: 400 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { ok: false, error: "파일이 너무 큽니다. 3.5MB 이하로 올려 주세요." },
      { status: 413 },
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const item = await addCardNewsImage({ date, caption, bytes });
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
  if (!cardNewsAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "관리자 비밀번호가 아직 설정되지 않았습니다." },
      { status: 503 },
    );
  }
  if (!cardNewsAuthorized(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "삭제할 카드가 없습니다." },
      { status: 400 },
    );
  }
  try {
    await deleteCardNewsImage(id);
    return NextResponse.json({ ok: true });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "delete failed" },
      { status: 400 },
    );
  }
}

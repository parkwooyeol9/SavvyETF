import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import {
  createVaultPost,
  deleteVaultPost,
  listVaultPosts,
  updateVaultPost,
  type VaultUpload,
} from "@/lib/adminVault";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: PRIVATE_NO_STORE });
}

function guard(request: Request): NextResponse | null {
  const denied = requireSiteAdmin(request);
  if (denied) return denied;
  if (!r2Configured()) return fail("저장소(R2)가 설정되지 않았습니다.", 503);
  return null;
}

function uploadsFrom(raw: unknown): VaultUpload[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = (row || {}) as Record<string, unknown>;
    return {
      upload_id: String(r.upload_id || ""),
      filename: String(r.filename || ""),
      parts: Number(r.parts || 0),
    };
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function errorMessage(exc: unknown, fallback: string): string {
  return exc instanceof Error ? exc.message : fallback;
}

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const data = await listVaultPosts();
    return NextResponse.json({ ok: true, ...data }, { headers: PRIVATE_NO_STORE });
  } catch (exc) {
    return fail(errorMessage(exc, "목록을 불러오지 못했습니다."), 500);
  }
}

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return fail("Invalid JSON", 400);
  try {
    const item = await createVaultPost({
      title: String(body.title || ""),
      memo: String(body.memo || ""),
      uploads: uploadsFrom(body.uploads),
    });
    return NextResponse.json({ ok: true, item }, { headers: PRIVATE_NO_STORE });
  } catch (exc) {
    return fail(errorMessage(exc, "저장 실패"), 400);
  }
}

export async function PATCH(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return fail("Invalid JSON", 400);
  try {
    const item = await updateVaultPost({
      id: String(body.id || ""),
      title: typeof body.title === "string" ? body.title : undefined,
      memo: typeof body.memo === "string" ? body.memo : undefined,
      add: uploadsFrom(body.add),
      remove: Array.isArray(body.remove) ? body.remove.map(String) : [],
    });
    return NextResponse.json({ ok: true, item }, { headers: PRIVATE_NO_STORE });
  } catch (exc) {
    return fail(errorMessage(exc, "수정 실패"), 400);
  }
}

export async function DELETE(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return fail("삭제할 글이 없습니다.", 400);
  try {
    await deleteVaultPost(id);
    return NextResponse.json({ ok: true }, { headers: PRIVATE_NO_STORE });
  } catch (exc) {
    return fail(errorMessage(exc, "삭제 실패"), 400);
  }
}

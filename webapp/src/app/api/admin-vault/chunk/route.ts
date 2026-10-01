import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import { putVaultChunk } from "@/lib/adminVault";
import { VAULT_CHUNK_BYTES } from "@/lib/adminVaultMeta";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: PRIVATE_NO_STORE });
}

export async function POST(request: Request) {
  const denied = requireSiteAdmin(request);
  if (denied) return denied;
  if (!r2Configured()) return fail("저장소(R2)가 설정되지 않았습니다.", 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("업로드 형식이 올바르지 않습니다.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail("조각 파일이 없습니다.", 400);
  if (file.size > VAULT_CHUNK_BYTES) return fail("조각이 너무 큽니다. 다시 올려 주세요.", 400);
  try {
    await putVaultChunk({
      upload_id: String(form.get("upload_id") || ""),
      part: Number(form.get("part")),
      total: Number(form.get("total")),
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ ok: true }, { headers: PRIVATE_NO_STORE });
  } catch (exc) {
    return fail(exc instanceof Error ? exc.message : "chunk failed", 400);
  }
}

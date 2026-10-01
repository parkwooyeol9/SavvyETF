import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { siteAdminAuthorized } from "@/lib/siteAdmin";
import { r2Configured, r2ListKeys, r2DeleteKeys } from "@/lib/r2";
import { MAX_NOTE_BYTES, NOTES_PREFIX, noteKey, notesEncryptionKey, readNote, writeNote, noteView, type NoteFile } from "@/lib/operationsNotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization", "X-Content-Type-Options": "nosniff" };
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }); }
function guard(request: Request) {
  if (!siteAdminAuthorized(request)) return json({ error: "관리자 로그인이 필요합니다." }, 401);
  if (!r2Configured()) return json({ error: "R2 저장소가 설정되지 않았습니다." }, 503);
  try { notesEncryptionKey(); } catch { return json({ error: "Vercel에 OPERATIONS_NOTES_ENCRYPTION_KEY(64자리 hex)를 설정해 주세요." }, 503); }
  return null;
}
export async function GET(request: Request) {
  const denied = guard(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) {
      try { noteKey(id); } catch { return json({ error: "잘못된 ID입니다." }, 400); }
      const note = await readNote(id);
      if (!note) return json({ error: "노트를 찾을 수 없습니다." }, 404);
      const fileIndex = params.get("file");
      if (fileIndex !== null) {
        if (!/^\d+$/.test(fileIndex)) return json({ error: "잘못된 첨부파일입니다." }, 400);
        const file = note.files[Number(fileIndex)];
        if (!file) return json({ error: "첨부파일이 없습니다." }, 404);
        return new NextResponse(Buffer.from(file.data, "base64"), { headers: {
          ...headers, "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`,
        }});
      }
      return json({ item: noteView(note) });
    }
    const keys = await r2ListKeys(NOTES_PREFIX);
    const items = [];
    // Read in bounded batches; never return attachment data in the listing.
    for (let i = 0; i < keys.length; i += 8) {
      const batch = await Promise.all(keys.slice(i, i + 8).filter(k => k.endsWith(".bin")).map(k => readNote(k.slice(NOTES_PREFIX.length, -4))));
      for (const note of batch) if (note) items.push(noteView(note));
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return json({ items });
  } catch { return json({ error: "노트를 읽지 못했습니다. 저장소 또는 암호화 키를 확인해 주세요." }, 500); }
}
export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  if (Number(request.headers.get("content-length")) > MAX_NOTE_BYTES + 256000) return json({ error: "첨부파일 합계는 3 MiB 이하여야 합니다." }, 413);
  try {
    const form = await request.formData();
    const id = String(form.get("id") || "");
    if (id) { try { noteKey(id); } catch { return json({ error: "잘못된 ID입니다." }, 400); } }
    const existing = id ? await readNote(id) : null;
    if (id && !existing) return json({ error: "노트를 찾을 수 없습니다." }, 404);
    const title = String(form.get("title") || "").trim();
    const body = String(form.get("body") || "");
    const category = String(form.get("category") || "기타").trim();
    if (!title || title.length > 200 || body.length > 50000 || category.length > 50) return json({ error: "제목 1~200자, 본문 50,000자, 분류 50자 이내로 입력해 주세요." }, 400);
    const uploads = form.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
    const retained: NoteFile[] = form.get("removeFiles") === "1" ? [] : existing?.files || [];
    const size = retained.reduce((n, f) => n + Buffer.byteLength(f.data, "base64"), 0) + uploads.reduce((n, f) => n + f.size, 0);
    if (size > MAX_NOTE_BYTES || retained.length + uploads.length > 10) return json({ error: "첨부파일은 게시글당 최대 10개, 합계 3 MiB입니다." }, 413);
    const files = [...retained];
    for (const file of uploads) {
      const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) || "attachment";
      files.push({ name, type: file.type || "application/octet-stream", data: Buffer.from(await file.arrayBuffer()).toString("base64") });
    }
    const now = new Date().toISOString();
    const note = { id: existing?.id || randomUUID(), title, body, category, files, createdAt: existing?.createdAt || now, updatedAt: now };
    await writeNote(note);
    return json({ item: noteView(note) }, existing ? 200 : 201);
  } catch { return json({ error: "저장하지 못했습니다. 입력 내용과 저장소 설정을 확인해 주세요." }, 500); }
}
export async function DELETE(request: Request) {
  const denied = guard(request); if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") || "";
  try { noteKey(id); } catch { return json({ error: "잘못된 ID입니다." }, 400); }
  try {
    await r2DeleteKeys([noteKey(id)]);
    return json({ ok: true });
  } catch { return json({ error: "삭제하지 못했습니다." }, 500); }
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { r2GetObjectBytes, r2PutObject } from "@/lib/r2";

export const NOTES_PREFIX = "private-operations-notes/";
export const MAX_NOTE_BYTES = 3 * 1024 * 1024;
export type NoteFile = { name: string; type: string; data: string };
export type OperationsNote = {
  id: string; title: string; body: string; category: string;
  createdAt: string; updatedAt: string; files: NoteFile[];
};

export function notesEncryptionKey(): Buffer {
  const hex = process.env.OPERATIONS_NOTES_ENCRYPTION_KEY?.trim() || "";
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("운영 노트 암호화 키가 설정되지 않았습니다. 관리자 설정을 확인해 주세요.");
  return Buffer.from(hex, "hex");
}
export function noteKey(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("잘못된 노트 ID입니다.");
  return `${NOTES_PREFIX}${id}.bin`;
}
export function encryptNote(note: OperationsNote): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", notesEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(noteKey(note.id)));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(note), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("SON1"), iv, cipher.getAuthTag(), encrypted]);
}
export function decryptNote(id: string, bytes: Uint8Array): OperationsNote {
  const data = Buffer.from(bytes);
  if (data.length < 32 || data.subarray(0, 4).toString() !== "SON1") throw new Error("잘못된 노트 형식입니다.");
  const decipher = createDecipheriv("aes-256-gcm", notesEncryptionKey(), data.subarray(4, 16));
  decipher.setAAD(Buffer.from(noteKey(id)));
  decipher.setAuthTag(data.subarray(16, 32));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]).toString("utf8"));
}
export async function readNote(id: string): Promise<OperationsNote | null> {
  const obj = await r2GetObjectBytes(noteKey(id));
  return obj ? decryptNote(id, obj.body) : null;
}
export async function writeNote(note: OperationsNote) {
  await r2PutObject(noteKey(note.id), encryptNote(note), "application/octet-stream", "private, no-store");
}
export function noteView(note: OperationsNote) {
  return { ...note, files: note.files.map(({ name, type, data }, index) => ({
    name, type, index, size: Buffer.byteLength(data, "base64"),
  })) };
}

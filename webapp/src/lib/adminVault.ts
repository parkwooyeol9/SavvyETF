import { randomUUID } from "node:crypto";

import {
  UUID_RE,
  VAULT_CHUNK_BYTES,
  VAULT_MAX_FILE_BYTES,
  VAULT_MAX_FILES_PER_POST,
  VAULT_MAX_MEMO,
  VAULT_MAX_TITLE,
  type VaultFile,
  type VaultPost,
  type VaultPostView,
} from "@/lib/adminVaultMeta";
import {
  r2DeleteKeys,
  r2GetObjectBytes,
  r2GetObjectRange,
  r2GetObjectText,
  r2ListKeys,
  r2PresignGet,
  r2PutObject,
} from "@/lib/r2";

/**
 * The bucket may be exposed through an r2.dev public URL, so nothing here may
 * live at a guessable key: the index name carries a random suffix discovered by
 * (credentialed) listing, and files sit under random UUID paths.
 */
const VAULT_PREFIX = "admin_vault/";
const INDEX_PREFIX = `${VAULT_PREFIX}index-`;
const FILE_PREFIX = `${VAULT_PREFIX}files/`;
const TMP_PREFIX = `${VAULT_PREFIX}tmp/`;
const PRIVATE_CACHE = "private, no-store";

type VaultStore = { updated_at: string | null; items: VaultPost[] };

export type VaultUpload = { upload_id: string; filename: string; parts: number };

let cachedIndexKey: string | null = null;

async function existingIndexKey(): Promise<string | null> {
  if (cachedIndexKey) return cachedIndexKey;
  const keys = (await r2ListKeys(INDEX_PREFIX)).filter((k) => k.endsWith(".json"));
  keys.sort();
  cachedIndexKey = keys[0] || null;
  return cachedIndexKey;
}

async function loadStore(): Promise<VaultStore> {
  const key = await existingIndexKey();
  const raw = key ? await r2GetObjectText(key) : null;
  if (!raw) return { updated_at: null, items: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<VaultStore>;
    return {
      updated_at: parsed.updated_at || null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    throw new Error("게시판 목록 파일이 손상되었습니다.");
  }
}

async function saveStore(store: VaultStore): Promise<void> {
  store.updated_at = new Date().toISOString();
  const key = (await existingIndexKey()) || `${INDEX_PREFIX}${randomUUID()}.json`;
  await r2PutObject(key, JSON.stringify(store), "application/json; charset=utf-8", PRIVATE_CACHE);
  cachedIndexKey = key;
}

function toView(post: VaultPost): VaultPostView {
  return {
    ...post,
    files: post.files.map(({ id, filename, size, contentType }) => ({
      id,
      filename,
      size,
      contentType,
    })),
  };
}

const CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  csv: "text/csv; charset=utf-8",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pdf: "application/pdf",
  hwp: "application/x-hwp",
  hwpx: "application/hwp+zip",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function extOf(filename: string): string {
  const m = filename.match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1]!.toLowerCase() : "";
}

function sanitizeFilename(raw: string): string {
  const base = (raw.replace(/\\/g, "/").split("/").pop() || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim();
  return (base || "file").slice(0, 180);
}

function cleanTitle(raw: string, fallback: string): string {
  return (raw.trim() || fallback).slice(0, VAULT_MAX_TITLE);
}

function cleanMemo(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim().slice(0, VAULT_MAX_MEMO);
}

const MAX_PARTS = Math.ceil(VAULT_MAX_FILE_BYTES / VAULT_CHUNK_BYTES);

function partKey(uploadId: string, part: number): string {
  return `${TMP_PREFIX}${uploadId}/${String(part).padStart(4, "0")}`;
}

export async function putVaultChunk(input: {
  upload_id: string;
  part: number;
  total: number;
  bytes: Buffer;
}): Promise<void> {
  const { upload_id: uploadId, part, total, bytes } = input;
  if (!UUID_RE.test(uploadId)) throw new Error("업로드 정보가 올바르지 않습니다.");
  if (
    !Number.isInteger(part) ||
    !Number.isInteger(total) ||
    part < 0 ||
    total < 1 ||
    part >= total ||
    total > MAX_PARTS
  ) {
    throw new Error("업로드 조각 정보가 올바르지 않습니다.");
  }
  if (!bytes.length || bytes.length > VAULT_CHUNK_BYTES) {
    throw new Error("조각이 너무 큽니다. 다시 올려 주세요.");
  }
  await r2PutObject(partKey(uploadId, part), bytes, "application/octet-stream", PRIVATE_CACHE);
}

async function assembleUpload(postId: string, upload: VaultUpload): Promise<VaultFile> {
  const uploadId = String(upload.upload_id || "");
  const parts = Number(upload.parts);
  if (!UUID_RE.test(uploadId) || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) {
    throw new Error("업로드 정보가 올바르지 않습니다.");
  }
  const filename = sanitizeFilename(String(upload.filename || ""));
  const partKeys = Array.from({ length: parts }, (_, i) => partKey(uploadId, i));
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for (const key of partKeys) {
      const obj = await r2GetObjectBytes(key);
      if (!obj?.body.length) {
        throw new Error(`${filename} 조각이 없습니다. 다시 올려 주세요.`);
      }
      size += obj.body.length;
      if (size > VAULT_MAX_FILE_BYTES) {
        throw new Error(`${filename}이(가) 30MB를 넘습니다.`);
      }
      chunks.push(Buffer.from(obj.body));
    }
    const ext = extOf(filename);
    const fileId = randomUUID();
    const key = `${FILE_PREFIX}${postId}/${fileId}${ext ? `.${ext}` : ""}`;
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    await r2PutObject(key, Buffer.concat(chunks), contentType, PRIVATE_CACHE);
    return { id: fileId, filename, size, contentType, key };
  } finally {
    await r2DeleteKeys(partKeys).catch(() => 0);
  }
}

async function assembleAll(postId: string, uploads: VaultUpload[]): Promise<VaultFile[]> {
  const done: VaultFile[] = [];
  try {
    for (const upload of uploads) done.push(await assembleUpload(postId, upload));
    return done;
  } catch (exc) {
    await r2DeleteKeys(done.map((f) => f.key)).catch(() => 0);
    throw exc;
  }
}

export async function listVaultPosts(): Promise<{
  updated_at: string | null;
  items: VaultPostView[];
}> {
  const store = await loadStore();
  return { updated_at: store.updated_at, items: store.items.map(toView) };
}

export async function createVaultPost(input: {
  title: string;
  memo: string;
  uploads: VaultUpload[];
}): Promise<VaultPostView> {
  const uploads = input.uploads || [];
  const memo = cleanMemo(input.memo);
  if (uploads.length > VAULT_MAX_FILES_PER_POST) {
    throw new Error(`파일은 글 하나에 ${VAULT_MAX_FILES_PER_POST}개까지 올릴 수 있습니다.`);
  }
  if (!uploads.length && !memo && !input.title.trim()) {
    throw new Error("제목·메모·파일 중 하나는 있어야 합니다.");
  }
  const id = randomUUID();
  const files = await assembleAll(id, uploads);
  const now = new Date().toISOString();
  const post: VaultPost = {
    id,
    title: cleanTitle(input.title, files[0]?.filename || "제목 없음"),
    memo,
    files,
    created_at: now,
    updated_at: now,
  };
  try {
    const store = await loadStore();
    store.items.unshift(post);
    await saveStore(store);
  } catch (exc) {
    await r2DeleteKeys(files.map((f) => f.key)).catch(() => 0);
    throw exc;
  }
  return toView(post);
}

export async function updateVaultPost(input: {
  id: string;
  title?: string;
  memo?: string;
  add?: VaultUpload[];
  remove?: string[];
}): Promise<VaultPostView> {
  const store = await loadStore();
  const post = store.items.find((p) => p.id === input.id);
  if (!post) throw new Error("글을 찾을 수 없습니다.");
  const remove = new Set(input.remove || []);
  const kept = post.files.filter((f) => !remove.has(f.id));
  const add = input.add || [];
  if (kept.length + add.length > VAULT_MAX_FILES_PER_POST) {
    throw new Error(`파일은 글 하나에 ${VAULT_MAX_FILES_PER_POST}개까지 올릴 수 있습니다.`);
  }
  const added = await assembleAll(post.id, add);
  const dropped = post.files.filter((f) => remove.has(f.id));
  post.files = [...kept, ...added];
  if (input.title !== undefined) {
    post.title = cleanTitle(input.title, post.files[0]?.filename || "제목 없음");
  }
  if (input.memo !== undefined) post.memo = cleanMemo(input.memo);
  post.updated_at = new Date().toISOString();
  try {
    await saveStore(store);
  } catch (exc) {
    await r2DeleteKeys(added.map((f) => f.key)).catch(() => 0);
    throw exc;
  }
  await r2DeleteKeys(dropped.map((f) => f.key)).catch(() => 0);
  return toView(post);
}

export async function deleteVaultPost(id: string): Promise<void> {
  const store = await loadStore();
  const post = store.items.find((p) => p.id === id);
  if (!post) throw new Error("글을 찾을 수 없습니다.");
  store.items = store.items.filter((p) => p.id !== id);
  await saveStore(store);
  const keys = new Set(post.files.map((f) => f.key));
  for (const key of await r2ListKeys(`${FILE_PREFIX}${post.id}/`)) keys.add(key);
  await r2DeleteKeys([...keys]).catch(() => 0);
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/[\\;]/g, "_");
  return `attachment; filename="${ascii || "file"}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function vaultDownloadUrl(postId: string, fileId: string): Promise<string> {
  const store = await loadStore();
  const file = store.items
    .find((p) => p.id === postId)
    ?.files.find((f) => f.id === fileId);
  if (!file) throw new Error("파일을 찾을 수 없습니다.");
  return r2PresignGet(file.key, {
    contentDisposition: contentDisposition(file.filename),
    expiresIn: 300,
  });
}

/**
 * One VAULT_CHUNK_BYTES slice of a stored file, streamed through the function
 * (kept under the response cap) so the in-page viewer needs no bucket CORS.
 */
export async function vaultFileChunk(
  postId: string,
  fileId: string,
  part: number,
): Promise<{ body: Uint8Array; size: number; parts: number }> {
  const store = await loadStore();
  const file = store.items
    .find((p) => p.id === postId)
    ?.files.find((f) => f.id === fileId);
  if (!file) throw new Error("파일을 찾을 수 없습니다.");
  const parts = Math.max(1, Math.ceil(file.size / VAULT_CHUNK_BYTES));
  if (!Number.isInteger(part) || part < 0 || part >= parts) {
    throw new Error("잘못된 범위입니다.");
  }
  const start = part * VAULT_CHUNK_BYTES;
  const end = Math.min(file.size, start + VAULT_CHUNK_BYTES) - 1;
  const body = await r2GetObjectRange(file.key, start, end);
  if (!body) throw new Error("파일을 찾을 수 없습니다.");
  return { body, size: file.size, parts };
}

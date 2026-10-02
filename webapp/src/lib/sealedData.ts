import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { r2Configured, r2GetObjectBytes } from "@/lib/r2";

/**
 * Licensed datasets (Datastream, MSCI lists) live in the public R2 bucket only as
 * sealed blobs: gzip → AES-256-GCM, `SVD1 | nonce(12) | ciphertext | tag(16)`,
 * AAD "SVD1". Written by Claude_DB/sealed_r2.py; the key never leaves the server.
 */
const MAGIC = Buffer.from("SVD1");
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

export const PRIVATE_PREFIXES = ["private/acwi/", "private/index_monitor/"] as const;

function sealedKey(): Buffer | null {
  const raw = process.env.SEALED_DATA_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function sealedDataConfigured(): boolean {
  return sealedKey() !== null;
}

export function openSealed(blob: Uint8Array): unknown {
  const key = sealedKey();
  if (!key) throw new Error("SEALED_DATA_KEY is not configured");
  const buf = Buffer.from(blob);
  if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error("not a sealed blob");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(4, 16));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  const plain = Buffer.concat([decipher.update(buf.subarray(16, buf.length - 16)), decipher.final()]);
  return JSON.parse(gunzipSync(plain).toString("utf8"));
}

/** Local QA only: a directory laid out like the bucket (Claude_DB export output). Unset on Vercel. */
const localDir = () => process.env.SEALED_DATA_LOCAL_DIR?.trim() || "";

export function sealedSourceConfigured(): boolean {
  return sealedDataConfigured() && (Boolean(localDir()) || r2Configured());
}

async function readBytes(key: string): Promise<Uint8Array | null> {
  const dir = localDir();
  if (!dir) return (await r2GetObjectBytes(key))?.body ?? null;
  try {
    return await readFile(join(dir, key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Reads and opens a sealed R2 object; `null` when the object does not exist. */
export async function readSealedJson<T>(key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const body = await readBytes(key);
  if (!body) return null;
  const value = openSealed(body);
  cache.set(key, { at: Date.now(), value });
  return value as T;
}

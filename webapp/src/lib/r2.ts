/**
 * Cloudflare R2 (S3-compatible) helpers for brief JSON + chart PNGs.
 *
 * Env (Vercel + optional local):
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME
 *   R2_PUBLIC_BASE_URL  — public r2.dev / custom domain (no trailing slash)
 *                         If unset, image URLs use /api/briefs/media/... on this app.
 */

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string | null;
};

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || "";
  const bucket = process.env.R2_BUCKET_NAME?.trim() || "";
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }
  const publicBaseUrl =
    process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export function r2Configured(): boolean {
  return getR2Config() !== null;
}

let cachedClient: S3Client | null = null;
let cachedKey = "";

function clientFor(cfg: R2Config): S3Client {
  const key = `${cfg.accountId}:${cfg.accessKeyId}:${cfg.bucket}`;
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  cachedKey = key;
  return cachedClient;
}

export function publicUrlForKey(key: string, version?: number | string): string {
  const cfg = getR2Config();
  const v = version != null ? String(version) : String(Date.now());
  if (cfg?.publicBaseUrl) {
    return `${cfg.publicBaseUrl}/${key}?v=${encodeURIComponent(v)}`;
  }
  const mediaBase = process.env.BRIEF_MEDIA_BASE_URL?.trim().replace(/\/$/, "");
  if (mediaBase) {
    return `${mediaBase}/${key}?v=${encodeURIComponent(v)}`;
  }
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prodHost) {
    return `https://${prodHost}/api/briefs/media/${key}?v=${encodeURIComponent(v)}`;
  }
  const vercelHost = process.env.VERCEL_URL?.trim();
  if (vercelHost) {
    return `https://${vercelHost}/api/briefs/media/${key}?v=${encodeURIComponent(v)}`;
  }
  return `/api/briefs/media/${key}?v=${encodeURIComponent(v)}`;
}

export async function r2PutObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  cacheControl = "public, max-age=60",
): Promise<void> {
  const cfg = getR2Config();
  if (!cfg) throw new Error("R2 is not configured");
  const client = clientFor(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

export async function r2GetObjectText(key: string): Promise<string | null> {
  const cfg = getR2Config();
  if (!cfg) return null;
  const client = clientFor(cfg);
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    if (!res.Body) return null;
    return await res.Body.transformToString();
  } catch (exc) {
    const name = exc instanceof Error ? exc.name : "";
    if (name === "NoSuchKey" || name === "NotFound") return null;
    const msg = exc instanceof Error ? exc.message : String(exc);
    if (/NoSuchKey|NotFound|404/i.test(msg)) return null;
    throw exc;
  }
}

export async function r2GetObjectBytes(
  key: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const cfg = getR2Config();
  if (!cfg) return null;
  const client = clientFor(cfg);
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    if (!res.Body) return null;
    const body = await res.Body.transformToByteArray();
    return {
      body,
      contentType: res.ContentType || "application/octet-stream",
    };
  } catch (exc) {
    const name = exc instanceof Error ? exc.name : "";
    if (name === "NoSuchKey" || name === "NotFound") return null;
    const msg = exc instanceof Error ? exc.message : String(exc);
    if (/NoSuchKey|NotFound|404/i.test(msg)) return null;
    throw exc;
  }
}

export async function r2ListKeys(prefix: string): Promise<string[]> {
  const cfg = getR2Config();
  if (!cfg) return [];
  const client = clientFor(cfg);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function r2DeleteKeys(keys: string[]): Promise<number> {
  if (!keys.length) return 0;
  const cfg = getR2Config();
  if (!cfg) return 0;
  const client = clientFor(cfg);
  let deleted = 0;
  // DeleteObjects accepts up to 1000 keys
  for (let i = 0; i < keys.length; i += 900) {
    const chunk = keys.slice(i, i + 900);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: cfg.bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
    deleted += chunk.length;
  }
  return deleted;
}

/**
 * Keep only stable `{id}.png` files under a slot prefix; delete versioned orphans
 * like `{id}-{timestamp}.png` and any other unexpected objects.
 */
export async function gcSlotImageOrphans(
  prefix: string,
  keepNames: Set<string>,
): Promise<number> {
  const keys = await r2ListKeys(prefix.endsWith("/") ? prefix : `${prefix}/`);
  const doomed = keys.filter((key) => {
    const name = key.split("/").pop() || "";
    return !keepNames.has(name);
  });
  return r2DeleteKeys(doomed);
}

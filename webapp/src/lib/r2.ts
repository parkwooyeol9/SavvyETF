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
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

export async function r2GetObjectTextWithMeta(
  key: string,
): Promise<{ text: string | null; etag: string | null }> {
  const cfg = getR2Config();
  if (!cfg) return { text: null, etag: null };
  const client = clientFor(cfg);
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    if (!res.Body) return { text: null, etag: null };
    const text = await res.Body.transformToString();
    const etag = res.ETag ? res.ETag.replaceAll('"', "") : null;
    return { text, etag };
  } catch (exc) {
    const name = exc instanceof Error ? exc.name : "";
    if (name === "NoSuchKey" || name === "NotFound") return { text: null, etag: null };
    const msg = exc instanceof Error ? exc.message : String(exc);
    if (/NoSuchKey|NotFound|404/i.test(msg)) return { text: null, etag: null };
    throw exc;
  }
}

export async function r2PutObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  cacheControl = "public, max-age=60",
  opts?: { ifMatch?: string; ifNoneMatch?: string },
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
      ...(opts?.ifMatch ? { IfMatch: opts.ifMatch } : {}),
      ...(opts?.ifNoneMatch ? { IfNoneMatch: opts.ifNoneMatch } : {}),
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

export async function r2ListObjects(
  prefix = "",
): Promise<Array<{ key: string; size: number }>> {
  const cfg = getR2Config();
  if (!cfg) return [];
  const client = clientFor(cfg);
  const items: Array<{ key: string; size: number }> = [];
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
      if (obj.Key) items.push({ key: obj.Key, size: obj.Size || 0 });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return items;
}

export async function r2HeadObject(
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  const cfg = getR2Config();
  if (!cfg) return null;
  const client = clientFor(cfg);
  try {
    const res = await client.send(
      new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    return {
      size: res.ContentLength || 0,
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

export async function r2GetObjectPrefix(
  key: string,
  bytes = 8,
): Promise<Buffer | null> {
  const cfg = getR2Config();
  if (!cfg) return null;
  const client = clientFor(cfg);
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Range: `bytes=0-${Math.max(0, bytes - 1)}`,
      }),
    );
    if (!res.Body) return null;
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (exc) {
    const name = exc instanceof Error ? exc.name : "";
    if (name === "NoSuchKey" || name === "NotFound") return null;
    const msg = exc instanceof Error ? exc.message : String(exc);
    if (/NoSuchKey|NotFound|404/i.test(msg)) return null;
    throw exc;
  }
}

export async function r2PresignPut(
  key: string,
  contentType: string,
  expiresIn = 900,
): Promise<string> {
  const cfg = getR2Config();
  if (!cfg) throw new Error("R2 is not configured");
  const client = clientFor(cfg);
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000",
    }),
    { expiresIn },
  );
}

export async function ensureR2UploadCors(): Promise<void> {
  const cfg = getR2Config();
  if (!cfg) return;
  const client = clientFor(cfg);
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: cfg.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [
                "https://savvyetf.com",
                "https://www.savvyetf.com",
                "https://savvyetf.vercel.app",
                "http://localhost:3000",
                "http://localhost:3001",
              ],
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag", "Location"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  } catch {
    /* Token may be object-only; browser PUT then needs dashboard CORS. */
  }
}

export async function r2ListKeys(prefix: string): Promise<string[]> {
  const items = await r2ListObjects(prefix);
  return items.map((item) => item.key);
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

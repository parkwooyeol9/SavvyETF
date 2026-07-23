import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { remoteStoreConfigured, upsertBriefSlot, type IngestBody } from "@/lib/briefs";
import { sanitizeBriefHtml, sanitizeDocumentHtml } from "@/lib/sanitizeHtml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// US/KR full HTML briefs + chart PNGs routinely exceed 1.5MB as JSON.
const MAX_BODY_BYTES = 12_000_000;
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 2_500_000;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const secret = process.env.WEB_INGEST_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !secretsEqual(token, secret)) {
    return unauthorized();
  }

  if (!remoteStoreConfigured()) {
    return NextResponse.json(
      { error: "Service unavailable (configure R2_* or BLOB_READ_WRITE_TOKEN)" },
      { status: 503 },
    );
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: IngestBody;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8")) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.images && body.images.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `Too many images (max ${MAX_IMAGES})` },
      { status: 400 },
    );
  }
  // Drop oversized images instead of rejecting the whole brief
  if (body.images?.length) {
    body.images = body.images.filter((image) => {
      const approx = Math.ceil((image.png_base64?.length || 0) * 0.75);
      return approx > 0 && approx <= MAX_IMAGE_BYTES;
    });
    if (!body.images.length) body.images = undefined;
  }

  // Full documents (US/KR summary pages) keep structure for iframe srcDoc.
  if (body.html) {
    body.html = sanitizeDocumentHtml(body.html);
  }
  // Telegram fragments only
  if (body.sections?.length) {
    body.sections = body.sections.map((section) => ({
      ...section,
      html_or_text: sanitizeBriefHtml(section.html_or_text || ""),
    }));
  }

  try {
    const tab = await upsertBriefSlot(body);
    return NextResponse.json({ ok: true, tab });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import { upsertBriefSlot, type IngestBody } from "@/lib/briefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const secret = process.env.WEB_INGEST_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "WEB_INGEST_SECRET is not configured" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token !== secret) {
    return unauthorized();
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not configured" },
      { status: 503 },
    );
  }

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const tab = await upsertBriefSlot(body);
    return NextResponse.json({ ok: true, tab });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

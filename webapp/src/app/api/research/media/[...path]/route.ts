import { NextResponse } from "next/server";

import { r2Configured, r2GetObjectBytes } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

function safeKey(parts: string[] | undefined): string | null {
  if (!parts?.length) return null;
  const joined = parts.join("/");
  if (joined.includes("..") || joined.startsWith("/")) return null;
  if (!joined.startsWith("research/files/")) return null;
  if (!/^research\/files\/[a-z0-9_./-]+$/i.test(joined)) return null;
  return joined;
}

function asciiFilename(name: string): string {
  const trimmed = name.replace(/["\\\r\n]/g, "_").trim() || "paper.pdf";
  return /^[\x20-\x7e]+$/.test(trimmed) ? trimmed : "paper.pdf";
}

export async function GET(request: Request, context: Ctx) {
  if (!r2Configured()) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 503 });
  }
  const { path } = await context.params;
  const key = safeKey(path);
  if (!key) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  try {
    const obj = await r2GetObjectBytes(key);
    if (!obj) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const download = searchParams.get("download") === "1";
    const rawName = searchParams.get("filename") || "paper.pdf";
    const filename = asciiFilename(rawName);
    return new NextResponse(Buffer.from(obj.body), {
      status: 200,
      headers: {
        "Content-Type": obj.contentType || "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Media fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

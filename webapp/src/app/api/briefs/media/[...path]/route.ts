import { NextResponse } from "next/server";

import { r2Configured, r2GetObjectBytes } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

function safeKey(parts: string[] | undefined): string | null {
  if (!parts?.length) return null;
  const joined = parts.join("/");
  if (joined.includes("..") || joined.startsWith("/")) return null;
  if (!joined.startsWith("briefs/")) return null;
  if (!/^briefs\/[a-z0-9_./-]+$/i.test(joined)) return null;
  return joined;
}

export async function GET(_request: Request, context: Ctx) {
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
    return new NextResponse(Buffer.from(obj.body), {
      status: 200,
      headers: {
        "Content-Type": obj.contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Media fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { loadAllBriefs } from "@/lib/briefs";
import { emptyAllBriefs } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      // Still try Render — local bot cache does not need Blob.
      const result = await loadAllBriefs();
      return NextResponse.json({
        ok: true,
        configured: false,
        source: result.source,
        warning:
          result.warning ||
          "BLOB_READ_WRITE_TOKEN unset — using Render fallback when available",
        briefs: result.briefs,
      });
    }
    const result = await loadAllBriefs();
    return NextResponse.json({
      ok: true,
      configured: true,
      source: result.source,
      warning: result.warning,
      briefs: result.briefs,
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Failed to load briefs";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        briefs: emptyAllBriefs(),
      },
      { status: 500 },
    );
  }
}

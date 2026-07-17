import { NextResponse } from "next/server";

import { loadAllBriefs } from "@/lib/briefs";
import { emptyAllBriefs } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({
        ok: true,
        configured: false,
        briefs: emptyAllBriefs(),
      });
    }
    const briefs = await loadAllBriefs();
    return NextResponse.json({ ok: true, configured: true, briefs });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Failed to load briefs";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

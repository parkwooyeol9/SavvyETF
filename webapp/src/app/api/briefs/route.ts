import { NextResponse } from "next/server";

import { loadAllBriefs, remoteStoreConfigured } from "@/lib/briefs";
import { emptyAllBriefs } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await loadAllBriefs();
    return NextResponse.json({
      ok: true,
      configured: remoteStoreConfigured(),
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

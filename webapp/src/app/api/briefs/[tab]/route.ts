import { NextResponse } from "next/server";

import { loadTabBriefs, remoteStoreConfigured } from "@/lib/briefs";
import { isTabId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tab: string }> },
) {
  const { tab } = await context.params;
  if (!isTabId(tab)) {
    return NextResponse.json({ error: `Unknown tab: ${tab}` }, { status: 404 });
  }

  try {
    const brief = await loadTabBriefs(tab);
    return NextResponse.json({
      ok: true,
      configured: remoteStoreConfigured(),
      brief,
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "Failed to load brief";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

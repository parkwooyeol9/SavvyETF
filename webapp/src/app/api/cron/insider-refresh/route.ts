import { NextResponse } from "next/server";

import { runInsiderIngest } from "@/lib/insiderServer";
import { cronAuthorized } from "@/lib/secretsEqual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** SEC Form 4 → R2 (live feed + resumable backfill) and summary rebuild. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runInsiderIngest());
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "insider refresh failed" },
      { status: 500 },
    );
  }
}

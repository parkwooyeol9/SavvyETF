import { NextResponse } from "next/server";

import { cdnCacheHeader } from "@/lib/apiCache";
import { emptyMidtermStudyPayload } from "@/lib/midtermStudy";
import { loadMidtermStudyPayload } from "@/lib/midtermStudyLoad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await loadMidtermStudyPayload();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "midterm study failed";
    return NextResponse.json(emptyMidtermStudyPayload(message), { status: 500 });
  }
}

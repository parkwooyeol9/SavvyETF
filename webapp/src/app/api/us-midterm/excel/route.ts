import { NextResponse } from "next/server";

import {
  MIDTERM_SCHEDULE_NOTE,
  MIDTERM_SOURCES,
  emptyMidtermPayload,
  hydrateRacePolicy,
  loadCachedMidterm,
  type MidtermPayload,
} from "@/lib/usMidterm";
import { buildUsMidtermExcel, usMidtermExcelFilename } from "@/lib/usMidtermExcel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function loadPayload(): Promise<MidtermPayload> {
  const cached = await loadCachedMidterm();
  if (cached?.ok) {
    return {
      ...cached,
      races: hydrateRacePolicy(cached.races || []),
      schedule_note: MIDTERM_SCHEDULE_NOTE,
      sources: MIDTERM_SOURCES,
      note:
        cached.note?.replace(/\s*예측시장은 Polymarket,\s*/i, "") || cached.note,
    };
  }
  const fallback = emptyMidtermPayload();
  fallback.warnings = [
    ...(fallback.warnings || []),
    "최신 스냅샷이 없어 큐레이션 데이터로 엑셀을 만들었습니다.",
  ];
  return fallback;
}

export async function GET() {
  try {
    const payload = await loadPayload();
    const buf = buildUsMidtermExcel(payload);
    const filename = usMidtermExcelFilename(payload.generated_at || payload.snapshot_kst);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "us midterm excel failed";
    return NextResponse.json(emptyMidtermPayload(message), { status: 500 });
  }
}

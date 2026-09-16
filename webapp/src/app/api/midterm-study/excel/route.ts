import { NextResponse } from "next/server";

import { DEFAULT_SCENARIO, emptyMidtermStudyPayload, scenariosForGrouping } from "@/lib/midtermStudy";
import { buildMidtermStudyExcel, midtermStudyExcelFilename } from "@/lib/midtermStudyExcel";
import { loadMidtermStudyPayload } from "@/lib/midtermStudyLoad";
import { groupingForScenario, parseGroupingId, parseScenarioId } from "@/lib/midtermTape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scenario = parseScenarioId(url.searchParams.get("scenario")) ?? DEFAULT_SCENARIO;
    const requestedGrouping = parseGroupingId(url.searchParams.get("grouping"));
    const grouping =
      requestedGrouping && scenariosForGrouping(requestedGrouping).some((s) => s.id === scenario)
        ? requestedGrouping
        : groupingForScenario(scenario);

    const payload = await loadMidtermStudyPayload();
    if (!payload.ok) {
      return NextResponse.json(payload, { status: 503 });
    }

    const buf = buildMidtermStudyExcel(payload, { scenario, grouping });
    const filename = midtermStudyExcelFilename(scenario);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "midterm study excel failed";
    return NextResponse.json(emptyMidtermStudyPayload(message), { status: 500 });
  }
}

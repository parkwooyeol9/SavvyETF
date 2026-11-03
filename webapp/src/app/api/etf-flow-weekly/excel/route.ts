import { NextResponse } from "next/server";

import {
  etfFlowWeeklyFilename,
  loadEtfFlowWeekly,
  loadEtfFlowWeeklyXlsx,
} from "@/lib/etfFlowWeekly";
import { stripMiraeAssetLabels } from "@/lib/etfFlowWorkbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** R2의 요청 양식 엑셀을 내려준다. 이미 올라간 파일의 운용사 표기는 여기서 지운다. */
export async function GET() {
  try {
    const [buf, payload] = await Promise.all([loadEtfFlowWeeklyXlsx(), loadEtfFlowWeekly()]);
    if (!buf) {
      return NextResponse.json({ ok: false, error: "주간 Flow 엑셀이 아직 없습니다" }, { status: 404 });
    }
    const filename = etfFlowWeeklyFilename(payload);
    const cleaned = stripMiraeAssetLabels(buf);
    return new NextResponse(new Uint8Array(cleaned), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="etf_flow_weekly.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "etf flow excel failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

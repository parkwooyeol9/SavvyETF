import { NextResponse } from "next/server";

import {
  etfFlowWeeklyFilename,
  loadEtfFlowWeekly,
  loadEtfFlowWeeklyXlsx,
} from "@/lib/etfFlowWeekly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Python 배치가 R2 에 올린 요청 양식 엑셀(정리 + Raw Data, 네이티브 차트)을 그대로 내려준다. */
export async function GET() {
  try {
    const [buf, payload] = await Promise.all([loadEtfFlowWeeklyXlsx(), loadEtfFlowWeekly()]);
    if (!buf) {
      return NextResponse.json({ ok: false, error: "주간 Flow 엑셀이 아직 없습니다" }, { status: 404 });
    }
    const filename = etfFlowWeeklyFilename(payload);
    return new NextResponse(new Uint8Array(buf), {
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

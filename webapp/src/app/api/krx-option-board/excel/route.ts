import { NextResponse } from "next/server";

import { krxOptionBoardFilename, loadKrxOptionBoard, loadKrxOptionBoardXlsx } from "@/lib/krxOptionBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 배치가 R2 에 올린 옵션 보드 엑셀(정리 + 시계열 시트)을 내려준다. */
export async function GET() {
  try {
    const [buf, payload] = await Promise.all([loadKrxOptionBoardXlsx(), loadKrxOptionBoard()]);
    if (!buf) {
      return NextResponse.json({ ok: false, error: "옵션 보드 엑셀이 아직 없습니다" }, { status: 404 });
    }
    const filename = krxOptionBoardFilename(payload);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="krx_option_board.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "option board excel failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

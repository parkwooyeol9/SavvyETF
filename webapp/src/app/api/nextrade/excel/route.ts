import {
  buildNextradeExcel,
  computeNextradeBoard,
  emptyNextradeBoard,
  nextradeExcelFilename,
} from "@/lib/nextradeBoard";
import { withServerCache } from "@/lib/apiCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET() {
  try {
    const payload = await withServerCache(
      "nextrade-board-v2",
      3 * 60_000,
      10 * 60_000,
      () => computeNextradeBoard(),
    );
    if (!payload.ok) {
      return Response.json(
        emptyNextradeBoard(payload.error || "데이터 없음"),
        { status: 503 },
      );
    }
    const buf = buildNextradeExcel(payload);
    const name = nextradeExcelFilename(payload.session_day);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (exc) {
    return Response.json(
      emptyNextradeBoard(
        exc instanceof Error ? exc.message : "엑셀 생성 실패",
      ),
      { status: 500 },
    );
  }
}

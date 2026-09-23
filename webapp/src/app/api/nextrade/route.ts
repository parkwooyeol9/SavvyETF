import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import {
  computeNextradeBoard,
  emptyNextradeBoard,
} from "@/lib/nextradeBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await withServerCache(
      "nextrade-board-v2",
      3 * 60_000,
      10 * 60_000,
      () => computeNextradeBoard(),
    );
    return jsonWithCdnCache(payload, "market");
  } catch (exc) {
    return jsonWithCdnCache(
      emptyNextradeBoard(
        exc instanceof Error ? exc.message : "넥스트레이드 로드 실패",
      ),
      "market",
      500,
    );
  }
}

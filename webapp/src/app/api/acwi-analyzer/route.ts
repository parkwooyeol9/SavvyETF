import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import { seriesBucket, type AcwiSeries, type AcwiSummary } from "@/lib/acwiAnalyzer";
import { readSealedJson, sealedSourceConfigured } from "@/lib/sealedData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "private/acwi/latest";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: PRIVATE_NO_STORE });
}

/**
 * Datastream/Refinitiv + MSCI-derived analytics: admin only, never CDN-cached.
 * `?part=summary` → screener/breadth/events; `?part=series&code=XXX` → one stock's charts.
 */
export async function GET(request: Request) {
  const denied = requireSiteAdmin(request);
  if (denied) return denied;
  if (!sealedSourceConfigured()) return fail(503, "R2 또는 SEALED_DATA_KEY 미설정");

  const params = new URL(request.url).searchParams;
  const part = params.get("part") ?? "summary";
  try {
    if (part === "summary") {
      const data = await readSealedJson<AcwiSummary>(`${PREFIX}/summary.bin`);
      if (!data) return fail(503, "ACWI 데이터가 아직 업로드되지 않았습니다.");
      return NextResponse.json({ ok: true, data }, { headers: PRIVATE_NO_STORE });
    }
    if (part === "series") {
      const code = params.get("code")?.trim() ?? "";
      if (!code || code.length > 40) return fail(400, "code 가 필요합니다.");
      const bucket = String(seriesBucket(code)).padStart(2, "0");
      const all = await readSealedJson<Record<string, AcwiSeries>>(`${PREFIX}/series/${bucket}.bin`);
      if (!all) return fail(503, "ACWI 시계열이 아직 업로드되지 않았습니다.");
      return NextResponse.json({ ok: true, data: all[code] ?? {} }, { headers: PRIVATE_NO_STORE });
    }
    return fail(400, "part 는 summary 또는 series 입니다.");
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "읽기 실패");
  }
}

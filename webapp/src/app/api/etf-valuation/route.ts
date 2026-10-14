import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import type { EtfValuation, EtfValuationStocks } from "@/lib/acwiAnalyzer";
import { readSealedJson, sealedSourceConfigured } from "@/lib/sealedData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "private/acwi/latest";
const PUBLIC_CACHE = { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
const PUBLIC_SOURCE = "LSEG Datastream·I/B/E/S 기반 자체 계산 · 보유종목 iShares·SPDR 공시";

function fail(status: number, error: string, headers: HeadersInit = PRIVATE_NO_STORE) {
  return NextResponse.json({ ok: false, error }, { status, headers });
}

/**
 * 포트폴리오 › 밸류에이션 (Claude_DB/factor/etf_valuation.py → export_webapp 봉인).
 * `?part=public` (기본) → ETF 단위 집계·구성종목 이름/비중만, 비로그인 공개 (CDN 캐시).
 * `?part=stocks` → 구성종목별 지표 (관리자 전용, no-store).
 */
export async function GET(request: Request) {
  const part = new URL(request.url).searchParams.get("part") ?? "public";
  if (part !== "public") {
    const denied = requireSiteAdmin(request);
    if (denied) return denied;
  }
  if (!sealedSourceConfigured()) return fail(503, "R2 또는 SEALED_DATA_KEY 미설정");
  try {
    if (part === "public") {
      const data = await readSealedJson<EtfValuation>(`${PREFIX}/etf_valuation.bin`);
      if (!data) return fail(503, "ETF 밸류에이션 데이터가 아직 업로드되지 않았습니다.");
      return NextResponse.json({ ok: true, data: { ...data, meta: { ...data.meta, source: PUBLIC_SOURCE } } }, { headers: PUBLIC_CACHE });
    }
    if (part === "stocks") {
      const data = await readSealedJson<EtfValuationStocks>(`${PREFIX}/etf_valuation_stocks.bin`);
      if (!data) return fail(503, "구성종목 지표가 아직 업로드되지 않았습니다.");
      return NextResponse.json({ ok: true, data }, { headers: PRIVATE_NO_STORE });
    }
    return fail(400, "part 는 public · stocks 입니다.");
  } catch (e) {
    return fail(500, part === "public" ? "읽기 실패" : e instanceof Error ? e.message : "읽기 실패");
  }
}

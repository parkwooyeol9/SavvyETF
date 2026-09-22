import { NextResponse } from "next/server";

import {
  computeMinuteForecast,
  emptyMinuteForecastPayload,
  loadMinuteForecastFromR2,
  saveMinuteForecastToR2,
  type MinuteForecastPayload,
} from "@/lib/minuteForecast";
import { siteAdminAuthorized } from "@/lib/siteAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

let memCache: MinuteForecastPayload | null = null;
let inflight: Promise<MinuteForecastPayload> | null = null;

async function runCompute(): Promise<MinuteForecastPayload> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const payload = await computeMinuteForecast();
      memCache = payload;
      try {
        await saveMinuteForecastToR2(payload);
      } catch {
        // R2 optional
      }
      return payload;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function GET(request: Request) {
  if (!siteAdminAuthorized(request)) {
    return NextResponse.json(
      emptyMinuteForecastPayload("관리자 인증이 필요합니다."),
      { status: 401 },
    );
  }
  if (memCache?.ok) {
    return NextResponse.json({ ...memCache, cached: true });
  }
  const fromR2 = await loadMinuteForecastFromR2();
  if (fromR2?.ok) {
    memCache = fromR2;
    return NextResponse.json(fromR2);
  }
  return NextResponse.json(
    emptyMinuteForecastPayload(
      "저장된 결과가 없습니다. 업데이트를 눌러 계산하세요.",
    ),
  );
}

export async function POST(request: Request) {
  if (!siteAdminAuthorized(request)) {
    return NextResponse.json(
      emptyMinuteForecastPayload("관리자 인증이 필요합니다."),
      { status: 401 },
    );
  }
  try {
    const payload = await runCompute();
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      emptyMinuteForecastPayload(
        exc instanceof Error ? exc.message : "계산 실패",
      ),
      { status: 500 },
    );
  }
}

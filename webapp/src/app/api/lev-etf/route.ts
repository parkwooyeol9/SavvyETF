import { NextResponse } from "next/server";

import type { LevEtfPayload } from "@/lib/levEtf";
import {
  levEtfStoreConfigured,
  loadLatestLevEtf,
  type StoredLevEtfPayload,
} from "@/lib/levEtfStore";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type CacheEntry = { at: number; payload: StoredLevEtfPayload };
let cache: CacheEntry | null = null;
const CACHE_MS = 60_000;

/**
 * Serve the latest R2 snapshot. Does not scrape Naver on page load.
 * Refresh button should call this without ?refresh live scrape.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bypassCache = searchParams.get("refresh") === "1";

    if (!bypassCache && cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json(cache.payload);
    }

    if (!levEtfStoreConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "R2 미설정 — 레버리지ETF 스냅샷 저장소를 사용할 수 없습니다. R2_* 환경변수를 확인하세요.",
        } satisfies LevEtfPayload,
        { status: 503 },
      );
    }

    const stored = await loadLatestLevEtf();
    if (!stored?.ok || !stored.items?.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "저장된 스냅샷이 없습니다. KRX 거래일 16:00 스케줄 후 채워지거나, 관리자 스냅샷을 실행하세요.",
          note: "거래원·수급은 매일 장 마감 후 16:00에 한 번 수집·적재됩니다.",
        } satisfies LevEtfPayload,
        { status: 404 },
      );
    }

    const payload: StoredLevEtfPayload = {
      ...stored,
      from_store: true,
    };
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "lev-etf load failed",
      } satisfies LevEtfPayload,
      { status: 500 },
    );
  }
}

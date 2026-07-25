import { NextResponse } from "next/server";

import type { MarketLeveragePayload } from "@/lib/marketLeverage";
import {
  levEtfStoreConfigured,
  loadLatestMarketLeverage,
  type StoredMarketLeveragePayload,
} from "@/lib/levEtfStore";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type CacheEntry = { at: number; payload: StoredMarketLeveragePayload };
let cache: CacheEntry | null = null;
const CACHE_MS = 60_000;

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
          error: "R2 미설정 — 시장 레버리지 스냅샷 저장소를 사용할 수 없습니다.",
        } satisfies MarketLeveragePayload,
        { status: 503 },
      );
    }

    const stored = await loadLatestMarketLeverage();
    if (!stored?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "저장된 스냅샷이 없습니다. KRX 거래일 16:00 스케줄 후 채워집니다.",
        } satisfies MarketLeveragePayload,
        { status: 404 },
      );
    }

    const payload: StoredMarketLeveragePayload = {
      ...stored,
      from_store: true,
    };
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error:
          exc instanceof Error ? exc.message : "market-leverage load failed",
      } satisfies MarketLeveragePayload,
      { status: 500 },
    );
  }
}

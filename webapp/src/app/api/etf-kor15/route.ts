import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";
import {
  ETF_KOR15_R2_KEY,
  readEtfWebSnapshot,
  writeEtfWebSnapshot,
} from "@/lib/etfWebSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_MS = 25 * 60_000;
const STALE_MS = 24 * 60 * 60_000;

type EtfKor15Payload = {
  ok: boolean;
  error?: string;
  stale?: boolean;
  warning?: string;
  [key: string]: unknown;
};

async function loadKor15(): Promise<EtfKor15Payload> {
  const fresh = await readEtfWebSnapshot<EtfKor15Payload>(ETF_KOR15_R2_KEY, FRESH_MS);
  if (fresh && fresh.data.ok && !fresh.stale) {
    return { ...fresh.data, source_tier: "r2" };
  }

  try {
    const live = await fetchBotJson<EtfKor15Payload>("/api/web/etf-kor15", {
      timeoutMs: 20_000,
    });
    if (live.ok) void writeEtfWebSnapshot(ETF_KOR15_R2_KEY, live);
    return live;
  } catch (exc) {
    const stale = await readEtfWebSnapshot<EtfKor15Payload>(ETF_KOR15_R2_KEY, STALE_MS);
    if (stale?.data.ok) {
      return {
        ...stale.data,
        stale: true,
        source_tier: "r2-stale",
        warning: "봇이 바빠 직전 스냅샷을 보여줍니다.",
        stale_reason: "봇이 바빠 직전 스냅샷을 보여줍니다.",
      };
    }
    throw exc;
  }
}

export async function GET() {
  try {
    const data = await withServerCache("etf-kor15:v2", 280_000, 600_000, loadKor15);
    return NextResponse.json(data, {
      status: data.ok ? 200 : 503,
      headers: { "Cache-Control": cdnCacheHeader("etfSlow") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error:
          exc instanceof Error
            ? exc.message
            : "Render /api/web/etf-kor15 unreachable",
      },
      { status: 502 },
    );
  }
}

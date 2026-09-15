import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";
import {
  ETF_NEW_R2_KEY,
  readEtfWebSnapshot,
  writeEtfWebSnapshot,
} from "@/lib/etfWebSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_MS = 12 * 60_000;
const STALE_MS = 24 * 60 * 60_000;

type EtfNewPayload = {
  ok: boolean;
  error?: string;
  stale?: boolean;
  [key: string]: unknown;
};

async function fetchWithRetry(path: string): Promise<EtfNewPayload> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchBotJson<EtfNewPayload>(path, { timeoutMs: 20_000 });
    } catch (exc) {
      lastErr = exc;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Render /api/web/etf-new unreachable");
}

async function loadEtfNew(qs: URLSearchParams): Promise<EtfNewPayload> {
  const fresh = await readEtfWebSnapshot<EtfNewPayload>(ETF_NEW_R2_KEY, FRESH_MS);
  if (fresh && fresh.data.ok && !fresh.stale) {
    return { ...fresh.data, source_tier: "r2" };
  }

  try {
    const live = await fetchWithRetry(`/api/web/etf-new?${qs}`);
    if (live.ok) void writeEtfWebSnapshot(ETF_NEW_R2_KEY, live);
    return live;
  } catch (exc) {
    const stale = await readEtfWebSnapshot<EtfNewPayload>(ETF_NEW_R2_KEY, STALE_MS);
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams({
    kr: searchParams.get("kr") || "15",
    us: searchParams.get("us") || "15",
    analyze_kr: searchParams.get("analyze_kr") || "3",
    analyze_us: searchParams.get("analyze_us") || "1",
  });
  const cacheKey = `etf-new:v2:${qs.toString()}`;

  try {
    const data = await withServerCache(cacheKey, 110_000, 300_000, () => loadEtfNew(qs));
    return NextResponse.json(data, {
      status: data.ok ? 200 : 503,
      headers: { "Cache-Control": cdnCacheHeader("etfNew") },
    });
  } catch (exc) {
    const message =
      exc instanceof Error ? exc.message : "Render /api/web/etf-new unreachable";
    const friendly =
      /remotedisconnected|connection aborted|html instead of json/i.test(message)
        ? "신규 상장 ETF 업스트림 연결이 불안정합니다. 잠시 후 다시 시도해 주세요."
        : message;
    return NextResponse.json(
      {
        ok: false,
        error: friendly,
        detail: message,
      },
      { status: 502 },
    );
  }
}

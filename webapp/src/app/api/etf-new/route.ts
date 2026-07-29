import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
      return await fetchBotJson<EtfNewPayload>(path, { timeoutMs: 55_000 });
    } catch (exc) {
      lastErr = exc;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Render /api/web/etf-new unreachable");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams({
    kr: searchParams.get("kr") || "15",
    us: searchParams.get("us") || "15",
    analyze_kr: searchParams.get("analyze_kr") || "3",
    analyze_us: searchParams.get("analyze_us") || "1",
  });
  const cacheKey = `etf-new:v1:${qs.toString()}`;

  try {
    const data = await withServerCache(
      cacheKey,
      110_000,
      300_000,
      () => fetchWithRetry(`/api/web/etf-new?${qs}`),
    );
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

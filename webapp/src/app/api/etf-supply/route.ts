import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { collectEtfSupply, type EtfSupplyPayload } from "@/lib/etfSupply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await withServerCache(
      "etf-supply:v4",
      180_000,
      420_000,
      async () => {
        const data = await collectEtfSupply();
        if (!data.ok) {
          throw new Error(data.error || "ETF 수급 조회 실패");
        }
        return data;
      },
    );
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 502,
      headers: { "Cache-Control": cdnCacheHeader("etfSlow") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        generated_at_display: "",
        source: "etfcheck",
        volume: {
          period: "BD",
          period_label: "전일",
          as_of: null,
          rows: [],
        },
        turnover: {
          period: "BD",
          period_label: "전일",
          as_of: null,
          rows: [],
        },
        inflow: {
          W: { period: "W", period_label: "1주", as_of: null, rows: [] },
          M: { period: "M", period_label: "1개월", as_of: null, rows: [] },
          "3M": { period: "3M", period_label: "3개월", as_of: null, rows: [] },
        },
        notes: [],
        error: message,
      } satisfies EtfSupplyPayload,
      { status: 500 },
    );
  }
}

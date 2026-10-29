import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { collectEtfSupply, type EtfSupplyPayload } from "@/lib/etfSupply";
import { withR2Snapshot } from "@/lib/r2Snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ETF CHECK inflow boards move once a day; a 30-minute-old copy is as good as a fresh crawl. */
const SNAPSHOT_KEY = "etf_supply/latest.json";
const SNAPSHOT_FRESH_MS = 30 * 60_000;

export async function GET() {
  try {
    const payload = await withServerCache(
      "etf-supply:v6",
      180_000,
      420_000,
      async () => {
        const snap = await withR2Snapshot({
          key: SNAPSHOT_KEY,
          freshMs: SNAPSHOT_FRESH_MS,
          build: async () => {
            const data = await collectEtfSupply();
            if (!data.ok) {
              throw new Error(data.error || "ETF 수급 조회 실패");
            }
            return data;
          },
        });
        return snap.data;
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
        us_inflow: {
          W: { period: "W", period_label: "1주", as_of: null, rows: [] },
          M: { period: "M", period_label: "1개월", as_of: null, rows: [] },
          "3M": { period: "3M", period_label: "3개월", as_of: null, rows: [] },
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

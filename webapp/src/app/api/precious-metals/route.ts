import { NextResponse } from "next/server";

import { buildPreciousMetalsPayload } from "@/lib/preciousMetals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await buildPreciousMetalsPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error:
          exc instanceof Error
            ? exc.message
            : "precious metals load failed",
        generated_at: new Date().toISOString(),
        generated_at_display: "",
        source: "",
        schedule_note: "",
        note: "",
        feasibility: {
          verdict: "",
          ready: [],
          deferred: [],
          rejected: [],
        },
        macro: {
          real_yield: null,
          real_yield_as_of: null,
          real_yield_chg_5d: null,
          real_yield_chg_10d: null,
          real_yield_source: "",
          dxy: null,
          dxy_sma20: null,
          dxy_as_of: null,
          dxy_chg_5d: null,
          usdkrw: null,
          usdkrw_as_of: null,
          usdkrw_chg_5d_pct: null,
          gold_silver_ratio: null,
        },
        metals: [],
        focus_default: "gold",
        krw_framing: {
          usdkrw: null,
          gold_usd: null,
          silver_usd: null,
          gold_krw_oz: null,
          silver_krw_oz: null,
          note: "",
        },
        event_risk: { is_friday: false, note: "" },
        leverage_policy: {
          max_long: 10,
          max_short: -10,
          note: "",
        },
      },
      { status: 500 },
    );
  }
}

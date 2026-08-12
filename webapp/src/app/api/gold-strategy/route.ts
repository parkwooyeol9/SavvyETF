import { NextResponse } from "next/server";

import { buildGoldStrategyPayload } from "@/lib/goldStrategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET() {
  try {
    const payload = await buildGoldStrategyPayload();
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
          exc instanceof Error ? exc.message : "gold strategy load failed",
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
          gc: null,
          gc_as_of: null,
          sma20: null,
          sma50: null,
          atr14: null,
          swing_low: null,
          swing_high: null,
          prior_20d_high: null,
          real_yield: null,
          real_yield_as_of: null,
          real_yield_chg_5d: null,
          real_yield_chg_10d: null,
          real_yield_source: "",
          dxy: null,
          dxy_sma20: null,
          dxy_as_of: null,
          usdkrw: null,
          usdkrw_as_of: null,
          usdkrw_chg_5d_pct: null,
          mm_net: null,
          mm_chg: null,
          mm_as_of: null,
        },
        buy_rules: [],
        sell_rules: [],
        tactics: [],
        playbook: {
          action: "hold",
          action_ko: "관망",
          score: 0,
          buy_hits: 0,
          buy_needed: 3,
          title: "",
          summary: "",
          entry: "",
          stop: "",
          targets: [],
          invalidation: "",
          risk_notes: [],
          suggested_stop: null,
          suggested_target: null,
          risk_per_unit: null,
          reward_per_unit: null,
          rr: null,
        },
        chart: [],
        position_presets: [],
        krw_framing: {
          usd_gold: null,
          usdkrw: null,
          implied_krw_per_oz: null,
          note: "",
        },
        event_risk: { is_friday: false, note: "" },
      },
      { status: 500 },
    );
  }
}

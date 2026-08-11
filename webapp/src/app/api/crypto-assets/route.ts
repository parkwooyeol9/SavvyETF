import { NextResponse } from "next/server";

import { buildCryptoAssetsPayload } from "@/lib/cryptoAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const payload = await buildCryptoAssetsPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "crypto assets load failed",
        generated_at: new Date().toISOString(),
        generated_at_display: "",
        source: "",
        schedule_note: "",
        note: "",
        usdkrw: null,
        assets: [],
        kimchi: [],
        indicators: [],
        fear_greed: [],
        interpretations: [],
        futures: {
          mark: null,
          chg24_pct: null,
          oi_usd: null,
          oi_chg_24h_pct: null,
          ls_ratio: null,
          long_pct: null,
          funding_pct: null,
          taker_imbalance: null,
          book_imbalance: null,
          vol_btc_24h: null,
          oi_series: [],
          ls_series: [],
          funding_series: [],
          indicators: [],
        },
        btc_chart: [],
        btc_chart_interval: "1H",
        strategy: null,
      },
      { status: 500 },
    );
  }
}

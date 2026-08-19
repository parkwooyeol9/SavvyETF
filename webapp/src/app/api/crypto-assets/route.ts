import { NextResponse } from "next/server";

import {
  buildCryptoAssetsPayload,
  parseBtcChartBar,
  parseCoinId,
} from "@/lib/cryptoAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bar = parseBtcChartBar(url.searchParams.get("bar"));
  const coin = parseCoinId(url.searchParams.get("coin"));
  try {
    const payload = await buildCryptoAssetsPayload({ bar, coin });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=45, stale-while-revalidate=90",
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
        watchlist: [],
        selected_coin: {
          id: coin,
          symbol: "BTC",
          name: "Bitcoin",
          inst_id: null,
          chart_source: "coingecko",
        },
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
        btc_chart_interval: bar,
        btc_chart_intervals: [],
        money_flow: {
          volume_leaders: [],
          total_volume_tracked: null,
          market: {
            total_mcap_usd: null,
            total_volume_24h_usd: null,
            btc_dominance_pct: null,
            eth_dominance_pct: null,
          },
          stables: {
            total_usd: null,
            chg_1d_pct: null,
            chg_7d_pct: null,
            chg_1d_usd: null,
            chg_7d_usd: null,
            usdt_usd: null,
            usdt_chg_1d_pct: null,
            usdt_chg_7d_pct: null,
            usdt_chg_1d_usd: null,
            usdt_chg_7d_usd: null,
            as_of: null,
            source: "",
          },
          etf: { rows: [], note: "" },
          headlines: [],
        },
        strategy: null,
      },
      { status: 500 },
    );
  }
}

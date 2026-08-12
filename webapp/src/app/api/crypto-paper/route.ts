import { NextResponse } from "next/server";

import { buildCryptoPaperPayload } from "@/lib/cryptoPaperTrading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";
  try {
    const payload = await buildCryptoPaperPayload({ forceTick: force });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error:
          exc instanceof Error ? exc.message : "crypto paper load failed",
        generated_at: new Date().toISOString(),
        generated_at_display: "",
        note: "",
        schedule_note: "",
        from_cache: false,
        initial_krw: 0,
        equity_krw: 0,
        cash_krw: 0,
        return_pct: 0,
        btc_benchmark_return_pct: 0,
        excess_vs_btc_pct: 0,
        max_drawdown_pct: 0,
        trade_count: 0,
        positions: [],
        recent_trades: [],
        equity_curve: [],
        signals: [],
        strategies_summary: [],
      },
      { status: 500 },
    );
  }
}

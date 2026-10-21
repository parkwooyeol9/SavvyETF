import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import { loadTradingSignals } from "@/lib/tradingSignalsBuild";
import {
  SIGNAL_DISCLAIMER,
  SIGNAL_METHODOLOGY,
  SIGNAL_SCHEDULE_NOTE,
  type TradingSignalsPayload,
} from "@/lib/tradingSignals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = requireSiteAdmin(request);
  if (denied) return denied;
  try {
    const payload = await loadTradingSignals();
    return NextResponse.json(payload, { headers: PRIVATE_NO_STORE });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        as_of: null,
        note: "",
        schedule_note: SIGNAL_SCHEDULE_NOTE,
        disclaimer: SIGNAL_DISCLAIMER,
        methodology: SIGNAL_METHODOLOGY,
        risk: {
          score: 0,
          regime: "Calm",
          regime_ko: "안정",
          drivers: [message],
          vix: null,
          hy_oas: null,
          spy_20d_pct: null,
          breadth_above_sma20: null,
        },
        summary: [],
        core: [],
        sectors: [],
        themes: [],
        crypto: null,
        error: message,
      } satisfies TradingSignalsPayload,
      { status: 502, headers: PRIVATE_NO_STORE },
    );
  }
}

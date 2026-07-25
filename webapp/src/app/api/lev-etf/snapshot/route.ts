import { NextResponse } from "next/server";

import { authorizeIngest } from "@/lib/ingestAuth";
import { buildLevEtfPayload } from "@/lib/levEtfScrape";
import {
  levEtfStoreConfigured,
  saveLevEtfSnapshot,
  saveMarketLeverageSnapshot,
  summarizeItems,
  todayAsOfKst,
} from "@/lib/levEtfStore";
import { buildMarketLeveragePayload } from "@/lib/marketLeverageServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/lev-etf/snapshot
 * Auth: Authorization: Bearer $WEB_INGEST_SECRET
 * Scrapes Naver once and writes latest + daily trader archive to R2.
 * Body optional: { "as_of": "YYYY-MM-DD" }
 */
export async function POST(request: Request) {
  if (!authorizeIngest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!levEtfStoreConfigured()) {
    return NextResponse.json(
      { ok: false, error: "R2 is not configured (set R2_* on Vercel)" },
      { status: 503 },
    );
  }

  let asOf = todayAsOfKst();
  try {
    const body = (await request.json()) as { as_of?: string };
    if (body?.as_of && /^\d{4}-\d{2}-\d{2}$/.test(body.as_of)) {
      asOf = body.as_of;
    }
  } catch {
    // empty body ok
  }

  try {
    const [lev, market] = await Promise.all([
      buildLevEtfPayload(),
      buildMarketLeveragePayload(),
    ]);

    const [levKeys, marketKey] = await Promise.all([
      saveLevEtfSnapshot(lev, asOf),
      saveMarketLeverageSnapshot(market, asOf),
    ]);

    const summary = summarizeItems(lev.items);
    return NextResponse.json({
      ok: true,
      as_of: asOf,
      generated_at: lev.generated_at,
      items: summary.n,
      item_errors: summary.errors,
      keys: {
        lev_latest: "lev-etf/latest.json",
        lev_daily: levKeys.daily_key,
        traders_day: levKeys.traders_key,
        market_latest: "market-leverage/latest.json",
        market_daily: marketKey,
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "snapshot failed",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  collectCountryEtfPayload,
  COUNTRY_ETF_UNIVERSE,
  type CountryEtfPayload,
} from "@/lib/countryEtf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();
    const refresh = searchParams.get("refresh") === "1";
    const tickers = ticker
      ? [ticker]
      : COUNTRY_ETF_UNIVERSE.map((u) => u.ticker);

    const cacheKey = `country-etf:${ticker || "all"}`;
    const build = () => collectCountryEtfPayload(tickers);

    const payload: CountryEtfPayload = refresh
      ? await build()
      : await withServerCache(cacheKey, 300_000, 600_000, build);

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
        source: "",
        universe_count: 0,
        funds: [],
        error: message,
      } satisfies CountryEtfPayload,
      { status: 500 },
    );
  }
}

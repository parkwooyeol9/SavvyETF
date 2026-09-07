import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  lookupEtfHoldings,
  suggestEtfHoldings,
  type EtfHoldingsLookupPayload,
  type EtfHoldingsMarket,
} from "@/lib/etfHoldingsLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseMarket(raw: string | null): EtfHoldingsMarket | undefined {
  const v = (raw || "").trim().toUpperCase();
  if (v === "KR" || v === "US") return v;
  return undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const ticker = (url.searchParams.get("ticker") || "").trim();
  const market = parseMarket(url.searchParams.get("market"));
  const limitRaw = Number(url.searchParams.get("limit") || "80");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 80;
  const suggestOnly = url.searchParams.get("suggest") === "1" || (!ticker && !!q);

  try {
    if (suggestOnly) {
      const payload = await withServerCache(
        `etf-holdings:suggest:v1:${q.toLowerCase()}`,
        60_000,
        180_000,
        () => suggestEtfHoldings(q || ticker),
      );
      return NextResponse.json(payload, {
        headers: { "Cache-Control": cdnCacheHeader("live") },
      });
    }

    const payload = await lookupEtfHoldings(ticker || q, { market, limit });
    const status = payload.ok ? 200 : payload.suggestions?.length ? 200 : 404;
    return NextResponse.json(payload, {
      status,
      headers: { "Cache-Control": cdnCacheHeader("etfNew") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        ticker: ticker || undefined,
        error: message,
      } satisfies EtfHoldingsLookupPayload,
      { status: 502 },
    );
  }
}

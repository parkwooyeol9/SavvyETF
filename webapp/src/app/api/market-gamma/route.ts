import { NextRequest, NextResponse } from "next/server";

import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import {
  GAMMA_CATALOG,
  catalogById,
  computeGammaSnapshot,
  parseGammaMarket,
  type CboeChain,
  type GammaPayload,
} from "@/lib/marketGamma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const CBOE_BASE = "https://cdn.cboe.com/api/global/delayed_quotes/options";

async function fetchCboeChain(path: string): Promise<CboeChain> {
  const res = await fetch(`${CBOE_BASE}/${encodeURIComponent(path)}.json`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(28_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`CBOE ${path} HTTP ${res.status}`);
  }
  return (await res.json()) as CboeChain;
}

async function buildPayload(marketId: ReturnType<typeof parseGammaMarket>): Promise<GammaPayload> {
  const meta = catalogById(marketId);
  const note =
    "CBOE 지연 옵션 체인(약 15분) · GEX = Γ×OI×100×S²×0.01 · 콜 +, 풋 − (딜러 롱콜/숏풋 가정) · 투자 조언이 아닙니다.";

  const chain = await fetchCboeChain(meta.cboe_path);
  const snapshot = computeGammaSnapshot(meta, chain);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    note,
    market: snapshot,
    catalog: GAMMA_CATALOG,
  };
}

export async function GET(req: NextRequest) {
  const market = parseGammaMarket(req.nextUrl.searchParams.get("market"));
  try {
    const payload = await withServerCache(
      `market-gamma:v2:${market}`,
      180_000,
      300_000,
      () => buildPayload(market),
    );
    return jsonWithCdnCache(payload, "yahoo");
  } catch (exc) {
    const payload: GammaPayload = {
      ok: false,
      generated_at: new Date().toISOString(),
      note: "",
      market: null,
      catalog: GAMMA_CATALOG,
      error: exc instanceof Error ? exc.message : "market gamma fetch failed",
    };
    return NextResponse.json(payload, { status: 502 });
  }
}

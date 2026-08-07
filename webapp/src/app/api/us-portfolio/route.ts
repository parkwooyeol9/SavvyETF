import { NextResponse } from "next/server";

import { cdnCacheHeader } from "@/lib/apiCache";
import {
  simulateUsPortfolio,
  type PortfolioTrade,
} from "@/lib/usPortfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  portfolio_id?: string;
  name?: string;
  initial_cash?: number;
  trades?: PortfolioTrade[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const trades = Array.isArray(body.trades) ? body.trades : [];
    const result = await simulateUsPortfolio({
      portfolio_id: body.portfolio_id || `pf_${Date.now()}`,
      name: body.name || "내 미국 주식 포트폴리오",
      initial_cash: Number(body.initial_cash) || 100_000,
      trades,
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

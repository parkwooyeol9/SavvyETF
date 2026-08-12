import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import {
  buildCryptoPaperPayload,
  defaultCryptoPaperState,
  loadCryptoPaperState,
  persistCryptoPaperState,
  tickCryptoPaperPortfolio,
} from "@/lib/cryptoPaperTrading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(token && secretsEqual(token, secret));
}

/** Hourly paper portfolio tick → R2. Schedule: vercel.json `15 * * * *` */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    let state = (await loadCryptoPaperState()) || defaultCryptoPaperState();
    state = await tickCryptoPaperPortfolio(state);
    const saved = await persistCryptoPaperState(state);
    const equity =
      state.equity_curve[state.equity_curve.length - 1]?.equity_krw ?? state.cash_krw;
    return NextResponse.json({
      ok: true,
      saved,
      tick_count: state.tick_count,
      equity_krw: equity,
      trades: state.trades.length,
      signals: state.signals.map((s) => ({
        id: s.id,
        action: s.action,
        market: s.market,
      })),
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "crypto paper tick failed",
      },
      { status: 500 },
    );
  }
}

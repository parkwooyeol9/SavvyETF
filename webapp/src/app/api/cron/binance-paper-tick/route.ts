import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import {
  defaultBinancePaperState,
  loadBinancePaperState,
  persistBinancePaperState,
  tickBinancePaperPortfolio,
} from "@/lib/binancePaperTrading";
import { tickKimchiArb } from "@/lib/kimchiArbEngine";
import { tickKimchiStudy } from "@/lib/kimchiPremiumStudy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

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

/** Hourly 바이낸스엔진 tick + 김프차익 시그널. Schedule: vercel.json `20 * * * *` */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    let state = (await loadBinancePaperState()) || defaultBinancePaperState();
    state = await tickBinancePaperPortfolio(state);
    const saved = await persistBinancePaperState(state);
    const [kimchi, study] = await Promise.all([tickKimchiArb(), tickKimchiStudy()]);
    const equity =
      state.equity_curve[state.equity_curve.length - 1]?.equity_usdt ?? state.cash_usdt;
    return NextResponse.json({
      ok: true,
      engine: "binance",
      saved,
      tick_count: state.tick_count,
      equity_usdt: equity,
      trades: state.trades.length,
      kimchi_pct: kimchi.kimchi_pct,
      kimchi_arb: kimchi.arb_action,
      kimchi_inventory: kimchi.inventory,
      kimchi_study: study.recommended,
      signals: state.signals.map((s) => ({
        id: s.id,
        action: s.action,
        symbol: s.symbol,
      })),
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "binance paper tick failed",
      },
      { status: 500 },
    );
  }
}

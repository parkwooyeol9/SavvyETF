import { NextResponse } from "next/server";

import type { AllocMethod } from "@/lib/etfCatalog";
import { simulateAllocation } from "@/lib/simulate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tickers?: string[];
      weights?: number[];
      method?: AllocMethod;
      start_date?: string;
      end_date?: string;
      initial_capital?: number;
      benchmark?: string;
    };
    const result = await simulateAllocation({
      tickers: body.tickers || [],
      weights: body.weights,
      method: body.method || "equal",
      start_date: body.start_date,
      end_date: body.end_date,
      initial_capital: body.initial_capital,
      benchmark: body.benchmark,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "Simulation failed",
      },
      { status: 500 },
    );
  }
}

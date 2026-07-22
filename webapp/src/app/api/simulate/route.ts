import { NextResponse } from "next/server";

import type { RegionBucket } from "@/lib/allocation";
import type { AllocMethod, AssetClass, DividendStyle } from "@/lib/etfCatalog";
import { simulateAllocation } from "@/lib/simulate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tickers?: string[];
      weights?: number[];
      method?: AllocMethod | "asset_631";
      asset_targets?: Record<AssetClass, number>;
      region_targets?: Record<RegionBucket, number>;
      dividend_targets?: Record<DividendStyle, number>;
      start_date?: string;
      end_date?: string;
      initial_capital?: number;
      benchmark?: string;
    };
    const result = await simulateAllocation({
      tickers: body.tickers || [],
      weights: body.weights,
      method: body.method || "equal",
      asset_targets: body.asset_targets,
      region_targets: body.region_targets,
      dividend_targets: body.dividend_targets,
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

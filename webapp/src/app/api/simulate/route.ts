import { NextResponse } from "next/server";

import type { RegionBucket } from "@/lib/allocation";
import { ETF_CATALOG, type AllocMethod, type AssetClass, type DividendStyle } from "@/lib/etfCatalog";
import { simulateAllocation } from "@/lib/simulate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_TICKERS = new Set(
  ETF_CATALOG.map((e) => e.symbol.toUpperCase()).concat([
    "SPY",
    "QQQ",
    "ACWI",
    "^GSPC",
    "^KS11",
  ]),
);

const ALLOWED_BENCHMARKS = new Set([
  "SPY",
  "QQQ",
  "ACWI",
  "^GSPC",
  "^KS11",
  "VOO",
  "IVV",
]);

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

    const tickers = (body.tickers || [])
      .map((t) => String(t || "").trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 20);
    if (!tickers.length) {
      return NextResponse.json(
        { ok: false, error: "tickers required" },
        { status: 400 },
      );
    }
    const rejected = tickers.filter((t) => !ALLOWED_TICKERS.has(t));
    if (rejected.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported tickers: ${rejected.join(", ")}`,
        },
        { status: 400 },
      );
    }
    const benchmark = (body.benchmark || "SPY").trim().toUpperCase();
    if (!ALLOWED_BENCHMARKS.has(benchmark)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported benchmark: ${benchmark}` },
        { status: 400 },
      );
    }

    // Clamp date window to ~5y for abuse control
    let start_date = body.start_date;
    if (start_date) {
      const min = new Date();
      min.setUTCFullYear(min.getUTCFullYear() - 5);
      const start = new Date(start_date);
      if (!Number.isNaN(start.getTime()) && start < min) {
        start_date = min.toISOString().slice(0, 10);
      }
    }

    const result = await simulateAllocation({
      tickers,
      weights: body.weights,
      method: body.method || "equal",
      asset_targets: body.asset_targets,
      region_targets: body.region_targets,
      dividend_targets: body.dividend_targets,
      start_date,
      end_date: body.end_date,
      initial_capital: body.initial_capital,
      benchmark,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "simulate failed",
      },
      { status: 500 },
    );
  }
}

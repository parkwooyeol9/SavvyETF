import { NextResponse } from "next/server";

import { botBaseUrl } from "@/lib/bot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const universe = searchParams.get("universe") || "etf";
  const topN = searchParams.get("top_n") || "30";
  const image = searchParams.get("image") || "1";
  const qs = new URLSearchParams({ universe, top_n: topN, image });

  try {
    const res = await fetch(`${botBaseUrl()}/api/web/heatmap?${qs}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(55_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error:
          exc instanceof Error
            ? `Heatmap upstream unavailable: ${exc.message}`
            : "Heatmap upstream unavailable",
      },
      { status: 502 },
    );
  }
}

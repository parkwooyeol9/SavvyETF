import { NextResponse } from "next/server";

import { botBaseUrl } from "@/lib/bot";
import { buildLocalHeatmap, isHeatmapUniverse } from "@/lib/heatmap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const universeRaw = searchParams.get("universe") || "etf";
  const topN = Number(searchParams.get("top_n") || "30");
  const prefer = searchParams.get("prefer") || "local"; // local | render

  const universe = isHeatmapUniverse(universeRaw) ? universeRaw : "etf";

  // Prefer local Yahoo heatmap so the Main tab never depends on Render deploy state.
  if (prefer !== "render") {
    const local = await buildLocalHeatmap(universe, topN);
    if (local.ok) {
      return NextResponse.json(local);
    }
    // Fall through to Render if local Yahoo fails.
  }

  try {
    const qs = new URLSearchParams({
      universe,
      top_n: String(topN),
      image: "0",
    });
    const res = await fetch(`${botBaseUrl()}/api/web/heatmap?${qs}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      const data = JSON.parse(text) as { ok?: boolean };
      if (data?.ok) {
        return NextResponse.json({ ...data, source: "render" });
      }
    } catch {
      // ignore non-JSON
    }
  } catch {
    // ignore upstream errors; return local error below
  }

  if (prefer === "render") {
    const local = await buildLocalHeatmap(universe, topN);
    return NextResponse.json(local, { status: local.ok ? 200 : 502 });
  }

  const local = await buildLocalHeatmap(universe, topN);
  return NextResponse.json(local, { status: local.ok ? 200 : 502 });
}

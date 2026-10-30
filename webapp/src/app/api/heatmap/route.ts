import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";
import { buildLocalHeatmap, isHeatmapPeriod, isHeatmapUniverse, isKrHeatmapUniverse } from "@/lib/heatmap";
import { loadKrHeatmapMembers } from "@/lib/heatmapKr";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const universeRaw = searchParams.get("universe") || "etf";
  const periodRaw = searchParams.get("period") || "1D";
  const topN = Number(searchParams.get("top_n") || "30");
  const prefer = searchParams.get("prefer") || "local";
  const universe = isHeatmapUniverse(universeRaw) ? universeRaw : "etf";
  const period = isHeatmapPeriod(periodRaw) ? periodRaw : "1D";
  const cacheKey = `heatmap:v4:${universe}:${topN}:${period}:${prefer}`;

  const payload = await withServerCache(
    cacheKey,
    1_080_000,
    2_700_000,
    async () => {
      // The Render heatmap is the US one-day map. Korean universes and longer windows stay local.
      if (period !== "1D" || isKrHeatmapUniverse(universe)) {
        const preset = isKrHeatmapUniverse(universe) ? await loadKrHeatmapMembers(universe) : undefined;
        return buildLocalHeatmap(universe, topN, period, preset);
      }
      if (prefer !== "render") {
        const local = await buildLocalHeatmap(universe, topN, period);
        if (local.ok) return local;
      }

      try {
        const qs = new URLSearchParams({
          universe,
          top_n: String(topN),
          image: "0",
        });
        const data = await fetchBotJson<{ ok?: boolean }>(
          `/api/web/heatmap?${qs}`,
          { timeoutMs: 20_000 },
        );
        if (data?.ok) {
          return { ...data, source: "render" };
        }
      } catch {
        // ignore upstream errors
      }

      const local = await buildLocalHeatmap(universe, topN, period);
      return local;
    },
  );

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 502,
    headers: { "Cache-Control": cdnCacheHeader("yahooSlow") },
  });
}

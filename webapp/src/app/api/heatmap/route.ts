import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { botBaseUrl } from "@/lib/bot";
import { buildLocalHeatmap, isHeatmapUniverse } from "@/lib/heatmap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const universeRaw = searchParams.get("universe") || "etf";
  const topN = Number(searchParams.get("top_n") || "30");
  const prefer = searchParams.get("prefer") || "local";
  const universe = isHeatmapUniverse(universeRaw) ? universeRaw : "etf";
  const cacheKey = `heatmap:v1:${universe}:${topN}:${prefer}`;

  const payload = await withServerCache(
    cacheKey,
    110_000,
    300_000,
    async () => {
      if (prefer !== "render") {
        const local = await buildLocalHeatmap(universe, topN);
        if (local.ok) return local;
      }

      try {
        const qs = new URLSearchParams({
          universe,
          top_n: String(topN),
          image: "0",
        });
        const res = await fetch(`${botBaseUrl()}/api/web/heatmap?${qs}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        try {
          const data = JSON.parse(text) as { ok?: boolean };
          if (data?.ok) {
            return { ...data, source: "render" };
          }
        } catch {
          // ignore non-JSON
        }
      } catch {
        // ignore upstream errors
      }

      const local = await buildLocalHeatmap(universe, topN);
      return local;
    },
  );

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 502,
    headers: { "Cache-Control": cdnCacheHeader("yahoo") },
  });
}

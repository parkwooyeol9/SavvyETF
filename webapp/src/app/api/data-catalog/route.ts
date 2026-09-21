import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  DATA_CATALOG,
  emptyLiveStats,
  ymdFromKey,
  type CatalogDatasetRow,
  type DataCatalogPayload,
  type DatasetLiveStats,
} from "@/lib/dataCatalog";
import { getR2Config, r2Configured, r2ListObjects } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SAMPLE_CAP = 8;

function summarize(objects: Array<{ key: string; size: number }>): DatasetLiveStats {
  if (!objects.length) return emptyLiveStats();
  const keys = objects.map((o) => o.key).sort();
  const days = keys.map(ymdFromKey).filter((d): d is string => !!d).sort();
  return {
    objects: objects.length,
    bytes: objects.reduce((s, o) => s + (o.size || 0), 0),
    firstKey: keys[0] || null,
    lastKey: keys[keys.length - 1] || null,
    firstDay: days[0] || null,
    lastDay: days[days.length - 1] || null,
    samples: keys.slice(-SAMPLE_CAP),
  };
}

function mergeStats(parts: DatasetLiveStats[]): DatasetLiveStats {
  const objects = parts.reduce((s, p) => s + p.objects, 0);
  if (!objects) return emptyLiveStats();
  const keys = parts.flatMap((p) => [p.firstKey, p.lastKey, ...p.samples]).filter(
    (k): k is string => !!k,
  );
  const days = parts.flatMap((p) => [p.firstDay, p.lastDay]).filter((d): d is string => !!d);
  keys.sort();
  days.sort();
  const samples = [...new Set(parts.flatMap((p) => p.samples))].sort().slice(-SAMPLE_CAP);
  return {
    objects,
    bytes: parts.reduce((s, p) => s + p.bytes, 0),
    firstKey: keys[0] || null,
    lastKey: keys[keys.length - 1] || null,
    firstDay: days[0] || null,
    lastDay: days[days.length - 1] || null,
    samples,
  };
}

async function buildPayload(): Promise<DataCatalogPayload> {
  const cfg = getR2Config();
  const r2 = r2Configured();
  const datasets: CatalogDatasetRow[] = [];

  for (const spec of DATA_CATALOG) {
    if (!r2) {
      datasets.push({ ...spec, live: emptyLiveStats() });
      continue;
    }
    const parts: DatasetLiveStats[] = [];
    for (const prefix of spec.prefixes) {
      try {
        const listed = await r2ListObjects(prefix);
        parts.push(summarize(listed));
      } catch (exc) {
        console.warn(`data-catalog list failed (${prefix}):`, exc);
        parts.push(emptyLiveStats());
      }
    }
    datasets.push({ ...spec, live: mergeStats(parts) });
  }

  const totals = {
    objects: datasets.reduce((s, d) => s + d.live.objects, 0),
    bytes: datasets.reduce((s, d) => s + d.live.bytes, 0),
    volatile: datasets.filter((d) => d.volatile).length,
  };

  return {
    ok: true,
    r2,
    generated_at: new Date().toISOString(),
    bucket: cfg?.bucket || null,
    totals,
    datasets,
    error: r2 ? undefined : "R2 is not configured",
  };
}

export async function GET() {
  try {
    const payload = await withServerCache("data-catalog:v1", 120_000, 600_000, buildPayload);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahooSlow") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        r2: r2Configured(),
        generated_at: new Date().toISOString(),
        bucket: getR2Config()?.bucket || null,
        totals: { objects: 0, bytes: 0, volatile: 0 },
        datasets: DATA_CATALOG.map((spec) => ({ ...spec, live: emptyLiveStats() })),
        error: exc instanceof Error ? exc.message : "catalog failed",
      } satisfies DataCatalogPayload,
      { status: 500 },
    );
  }
}

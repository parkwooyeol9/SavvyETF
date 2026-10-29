import { withServerCache } from "@/lib/apiCache";
import type { GsPoint } from "@/lib/gsQuant";
import { r2GetObjectText } from "@/lib/r2";

/** ACWI daily closes stored by `10_공통/acwi_px.py` (06:30 KST). Shared by `/api/acwi-tech` and `/api/ai-pick`. */
const R2_KEY = "acwi_px/latest.json";

export type StoredSeries = Record<string, Array<[string, number]>>;

export type Stored = { as_of: string | null; series: StoredSeries };

/** 저장본은 수 MB 라 표·티커 조회마다 R2 에서 다시 받지 않는다. 하루 한 번 갱신된다. */
export function loadAcwiStored(): Promise<Stored | null> {
  return withServerCache("acwi-tech:stored", 10 * 60_000, 60 * 60_000, readStored);
}

async function readStored(): Promise<Stored | null> {
  const text = await r2GetObjectText(R2_KEY);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { as_of?: string | null; series?: StoredSeries };
    if (!parsed.series || typeof parsed.series !== "object") return null;
    return { as_of: parsed.as_of ?? null, series: parsed.series };
  } catch {
    return null;
  }
}

export function storedPoints(series: StoredSeries, yahoo: string): GsPoint[] | null {
  const rows = series[yahoo];
  if (!rows?.length) return null;
  const points: GsPoint[] = [];
  for (const row of rows) {
    const date = row?.[0];
    const value = row?.[1];
    if (!date || !(value > 0)) continue;
    points.push({ date, value });
  }
  return points.length ? points : null;
}


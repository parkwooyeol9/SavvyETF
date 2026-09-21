import {
  DATA_CATALOG,
  fmtBytes,
  ymdFromKey,
  type DatasetSpec,
  type SeriesDay,
  type SeriesIndex,
  type SeriesKey,
  type SeriesObject,
} from "@/lib/dataCatalog";
import { r2Configured, r2GetObjectText, r2ListObjects } from "@/lib/r2";

export const SERIES_PREVIEW_CHARS = 250_000;
const MAX_DAYS = 800;
const MAX_KEYS_PER_DAY = 12;

export function catalogSpec(id: string): DatasetSpec | undefined {
  return DATA_CATALOG.find((row) => row.id === id);
}

export function keyBelongsToSpec(key: string, spec: DatasetSpec): boolean {
  return spec.prefixes.some((prefix) => key === prefix || key.startsWith(prefix));
}

function preferKey(a: SeriesKey, b: SeriesKey): SeriesKey {
  const score = (k: string) => {
    if (k.includes("/snapshots/")) return 3;
    if (k.includes("/archive/")) return 2;
    if (/latest/i.test(k)) return 1;
    return 0;
  };
  return score(b.key) > score(a.key) ? b : a;
}

export async function listSeriesIndex(
  spec: DatasetSpec,
  opts?: { from?: string; to?: string },
): Promise<SeriesIndex> {
  const r2 = r2Configured();
  if (!r2) {
    return {
      ok: true,
      r2: false,
      dataset: spec.id,
      label: spec.label,
      days: [],
      undated: [],
      error: "R2 is not configured",
    };
  }

  const seen = new Set<string>();
  const objects: SeriesKey[] = [];
  for (const prefix of spec.prefixes) {
    const listed = await r2ListObjects(prefix);
    for (const item of listed) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      objects.push(item);
    }
  }

  const byDate = new Map<string, SeriesKey[]>();
  const undated: SeriesKey[] = [];
  for (const item of objects) {
    const date = ymdFromKey(item.key);
    if (!date) {
      undated.push(item);
      continue;
    }
    if (opts?.from && date < opts.from) continue;
    if (opts?.to && date > opts.to) continue;
    const bucket = byDate.get(date) || [];
    bucket.push(item);
    byDate.set(date, bucket);
  }

  const days: SeriesDay[] = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, MAX_DAYS)
    .map(([date, keys]) => ({
      date,
      keys: [...keys]
        .sort((a, b) => (preferKey(a, b) === a ? -1 : 1))
        .slice(0, MAX_KEYS_PER_DAY),
    }));

  undated.sort((a, b) => a.key.localeCompare(b.key));

  return {
    ok: true,
    r2: true,
    dataset: spec.id,
    label: spec.label,
    days,
    undated: undated.slice(0, 40),
  };
}

export function pickSeriesKey(
  index: SeriesIndex,
  opts: { date?: string; key?: string },
): SeriesKey | null {
  if (opts.key) {
    for (const day of index.days) {
      const hit = day.keys.find((k) => k.key === opts.key);
      if (hit) return hit;
    }
    const undated = index.undated.find((k) => k.key === opts.key);
    if (undated) return undated;
    return { key: opts.key, size: 0 };
  }
  if (opts.date) {
    const day = index.days.find((d) => d.date === opts.date);
    return day?.keys[0] || null;
  }
  return index.days[0]?.keys[0] || index.undated[0] || null;
}

export async function loadSeriesObject(
  spec: DatasetSpec,
  key: string,
  date: string | null,
): Promise<SeriesObject> {
  const r2 = r2Configured();
  if (!r2) {
    return {
      ok: false,
      r2: false,
      dataset: spec.id,
      date,
      key,
      size: 0,
      truncated: false,
      json: null,
      error: "R2 is not configured",
    };
  }
  if (!keyBelongsToSpec(key, spec)) {
    return {
      ok: false,
      r2: true,
      dataset: spec.id,
      date,
      key,
      size: 0,
      truncated: false,
      json: null,
      error: "key is outside this dataset",
    };
  }

  const text = await r2GetObjectText(key);
  if (text == null) {
    return {
      ok: false,
      r2: true,
      dataset: spec.id,
      date,
      key,
      size: 0,
      truncated: false,
      json: null,
      error: "object not found",
    };
  }

  const truncated = text.length > SERIES_PREVIEW_CHARS;
  let json: unknown;
  if (truncated) {
    json = {
      truncated: true,
      note: `미리보기는 앞 ${fmtBytes(SERIES_PREVIEW_CHARS)}만`,
      preview: text.slice(0, SERIES_PREVIEW_CHARS),
    };
  } else {
    try {
      json = JSON.parse(text);
    } catch {
      json = { preview: text, parse: "raw" };
    }
  }

  return {
    ok: true,
    r2: true,
    dataset: spec.id,
    date,
    key,
    size: text.length,
    truncated,
    json,
  };
}

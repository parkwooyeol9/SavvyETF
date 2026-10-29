import { withServerCache } from "@/lib/apiCache";
import { r2Configured, r2GetObjectText } from "@/lib/r2";
import type { EtfUniverseFile, EtfUniverseMarket, EtfUniverseRow } from "@/lib/etfUniverse";

/**
 * Server-only loader for the bundled ETF universe snapshots plus the R2 return overlay
 * (`etf_universe_px/latest.json`, 20:10 KST job). Shared by `/api/etf-universe` and `/api/ai-pick`.
 */

const RETURN_KEYS = ["r1w", "r1m", "r3m", "r1y"] as const;
const PX_KEY = "etf_universe_px/latest.json";

export const LOADERS: Record<EtfUniverseMarket, () => Promise<{ default: unknown }>> = {
  kr: () => import("@/data/etfUniverse/kr.json"),
  us: () => import("@/data/etfUniverse/us.json"),
  eu: () => import("@/data/etfUniverse/eu.json"),
  jp: () => import("@/data/etfUniverse/jp.json"),
  hk: () => import("@/data/etfUniverse/hk.json"),
  cn: () => import("@/data/etfUniverse/cn.json"),
};

type PxMarket = {
  as_of?: string | null;
  source?: string | null;
  rows?: unknown[][];
};

export type PxFile = {
  markets?: Partial<Record<EtfUniverseMarket, PxMarket>>;
};

export async function loadReturnOverlay(): Promise<PxFile | null> {
  return withServerCache("etf-universe-px", 10 * 60_000, 60 * 60_000, async () => {
    if (!r2Configured()) return null;
    try {
      const text = await r2GetObjectText(PX_KEY);
      if (!text) return null;
      const data = JSON.parse(text) as PxFile;
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  });
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Copy rows, then replace only the return cells the daily job actually has. */
export function applyReturns(file: EtfUniverseFile, px: PxMarket | null | undefined): EtfUniverseFile {
  if (!px?.rows?.length) return file;
  const byTicker = new Map<string, unknown[]>();
  for (const row of px.rows) {
    if (Array.isArray(row) && row[0] != null) byTicker.set(String(row[0]), row);
  }
  if (!byTicker.size) return file;
  const extra = RETURN_KEYS.filter((key) => !file.cols.includes(key));
  const cols = (extra.length ? [...file.cols, ...extra] : file.cols) as Array<keyof EtfUniverseRow>;
  const index = Object.fromEntries(cols.map((col, i) => [col, i]));
  const rows = file.rows.map((src) => {
    const next = cols.map((_, i) => (i < src.length ? src[i] : null));
    const hit = byTicker.get(String(next[index.t] ?? ""));
    if (!hit) return next;
    RETURN_KEYS.forEach((key, j) => {
      const value = finite(hit[j + 1]);
      if (value != null) next[index[key]] = value;
    });
    return next;
  });
  return {
    ...file,
    cols,
    rows,
    returns_as_of: px.as_of ?? null,
    returns_source: px.source ?? null,
  };
}

/** One market's universe file with the latest returns overlaid. */
export async function loadEtfUniverse(market: EtfUniverseMarket): Promise<EtfUniverseFile> {
  const mod = await LOADERS[market]();
  const overlay = await loadReturnOverlay();
  return applyReturns(mod.default as EtfUniverseFile, overlay?.markets?.[market]);
}

import { promises as fs } from "fs";
import path from "path";

import { withServerCache } from "@/lib/apiCache";
import { r2Configured, r2GetObjectText } from "@/lib/r2";
import type { EtfUniverseFile, EtfUniverseMarket, EtfUniverseRow } from "@/lib/etfUniverse";

/**
 * Server-only loader for the bundled ETF universe snapshots plus the R2 return overlay
 * (`etf_universe_px/latest.json`, 20:10 KST job). Shared by `/api/etf-universe` and `/api/ai-pick`.
 */

const RETURN_KEYS = ["r1w", "r1m", "r3m", "r1y"] as const;
/** 1-session return and volume ratios, appended after the returns once the job stores volume. */
const SIGNAL_KEYS = ["r1d", "vr1", "vr5"] as const;
const OVERLAY_KEYS = [...RETURN_KEYS, ...SIGNAL_KEYS];
/** Row layout of files written before `cols` was published. */
const LEGACY_COLS = ["t", ...RETURN_KEYS];
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
  /** Column names of `rows`; absent on older files (LEGACY_COLS). */
  cols?: string[];
  rows?: unknown[][];
};

export type PxFile = {
  markets?: Partial<Record<EtfUniverseMarket, PxMarket>>;
};

/** 로컬 개발(R2 미설정): 20:10 작업을 직접 돌리면 남는 `data/etf_universe_px/latest.json`. 운영에서는 쓰지 않는다. */
async function localOverlay(): Promise<PxFile | null> {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const text = await fs.readFile(path.resolve(process.cwd(), "..", "data", "etf_universe_px", "latest.json"), "utf8");
    return JSON.parse(text) as PxFile;
  } catch {
    return null;
  }
}

export async function loadReturnOverlay(): Promise<PxFile | null> {
  return withServerCache("etf-universe-px", 10 * 60_000, 60 * 60_000, async () => {
    if (!r2Configured()) return localOverlay();
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

/** Copy rows, then replace only the return / volume cells the daily job actually has. */
export function applyReturns(file: EtfUniverseFile, px: PxMarket | null | undefined): EtfUniverseFile {
  if (!px?.rows?.length) return file;
  const byTicker = new Map<string, unknown[]>();
  for (const row of px.rows) {
    if (Array.isArray(row) && row[0] != null) byTicker.set(String(row[0]), row);
  }
  if (!byTicker.size) return file;
  const pxCols = Array.isArray(px.cols) && px.cols.length ? px.cols : LEGACY_COLS;
  const keys = OVERLAY_KEYS.filter((key) => pxCols.includes(key));
  const extra = keys.filter((key) => !file.cols.includes(key));
  const cols = (extra.length ? [...file.cols, ...extra] : file.cols) as Array<keyof EtfUniverseRow>;
  const index = Object.fromEntries(cols.map((col, i) => [col, i]));
  const rows = file.rows.map((src) => {
    const next = cols.map((_, i) => (i < src.length ? src[i] : null));
    const hit = byTicker.get(String(next[index.t] ?? ""));
    if (!hit) return next;
    for (const key of keys) {
      const value = finite(hit[pxCols.indexOf(key)]);
      if (value != null) next[index[key]] = value;
    }
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

/**
 * US equity ETF universe — AUM top ~1000 (NASDAQ directory + Yahoo totalAssets).
 * Classification: curated overrides + keyword taxonomy (etfDbUsClassify).
 * Rebuild: `npx tsx scripts/build-etfdb-us-top1000.ts`
 */

import top1000 from "./etfDbUsUniverseTop1000.json";

export type UsUniverseMeta = {
  symbol: string;
  name: string;
  type: string;
  region: string;
  sector: string;
  theme: string;
  watch?: boolean;
  /** Snapshot AUM ($M) from universe build — used until live/R2 AUM available */
  aum_seed_mn?: number;
};

type JsonRow = {
  symbol: string;
  name: string;
  type: string;
  region: string;
  sector: string;
  theme: string;
  watch?: boolean;
  aum_seed_mn?: number;
};

/** Deduplicate by symbol (first wins). */
export function uniqueUsUniverse(): UsUniverseMeta[] {
  const seen = new Set<string>();
  const out: UsUniverseMeta[] = [];
  const rows = (top1000 as { rows?: JsonRow[] }).rows || [];
  for (const row of rows) {
    const sym = String(row.symbol || "").toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push({
      symbol: sym,
      name: row.name,
      type: row.type,
      region: row.region || "미국",
      sector: row.sector,
      theme: row.theme,
      ...(row.watch ? { watch: true } : {}),
      ...(row.aum_seed_mn != null && row.aum_seed_mn > 0
        ? { aum_seed_mn: row.aum_seed_mn }
        : {}),
    });
  }
  return out;
}

export const US_ETF_UNIVERSE_META = {
  source: (top1000 as { source?: string }).source || "",
  generated_at: (top1000 as { generated_at?: string }).generated_at || "",
  count: 0,
};

US_ETF_UNIVERSE_META.count = uniqueUsUniverse().length;

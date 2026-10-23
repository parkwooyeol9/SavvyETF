import type { QuantRange, QuantSnapshot } from "@/lib/quantDesk";

/** Public ACWI identifiers only. No estimates, ISIN, or factor scores. */
export type AcwiUniverseRow = {
  ric: string;
  yahoo: string;
  name: string;
  country: string;
  sector: string;
  weight: number;
};

/** Snapshot ratios safe to show. No estimates, factor scores, ISIN, or MSCI status. */
export type AcwiTechFacts = Partial<{
  pe: number;
  pb: number;
  dy: number;
  roe: number;
  pep: number;
  pep10: number;
  r12m: number;
  dd52: number;
  vol: number;
  ts: number;
}>;

export type AcwiTechRow = {
  ric: string;
  yahoo: string;
  name: string;
  country: string;
  sector: string;
  weight: number;
  snapshot: QuantSnapshot | null;
  facts: AcwiTechFacts | null;
};

export type AcwiTechBoard = {
  ok: true;
  source: string;
  as_of: string | null;
  country: string;
  sector: string;
  range: QuantRange;
  countries: string[];
  country_chips: string[];
  sectors: string[];
  rows: AcwiTechRow[];
  facts_as_of: string | null;
  note: string;
};

export type AcwiTechLookup = {
  ok: true;
  snapshot: QuantSnapshot | null;
  facts: AcwiTechFacts | null;
  facts_as_of: string | null;
  error?: string;
};

const SECTOR_ORDER = [
  "IT",
  "금융",
  "산업재",
  "경기소비재",
  "필수소비재",
  "헬스케어",
  "소재",
  "에너지",
  "유틸리티",
  "커뮤니케이션",
  "부동산",
  "기타",
];

export function acwiSectors(rows: AcwiUniverseRow[]): string[] {
  const have = new Set(rows.map((r) => r.sector || "기타"));
  const ordered = SECTOR_ORDER.filter((s) => have.has(s));
  for (const s of have) {
    if (!ordered.includes(s)) ordered.push(s);
  }
  return ordered;
}

export function acwiCountries(rows: AcwiUniverseRow[]): string[] {
  const weight = new Map<string, number>();
  for (const row of rows) {
    const key = row.country || "기타";
    weight.set(key, (weight.get(key) || 0) + (row.weight || 0));
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** Country × sector majors. Both filters open → global top 20 by weight. */
export function pickAcwiMajors(
  rows: AcwiUniverseRow[],
  country: string,
  sector: string,
): AcwiUniverseRow[] {
  const allCountries = !country || country === "전체";
  const allSectors = !sector || sector === "전체";
  let list = rows;
  if (!allCountries) list = list.filter((r) => r.country === country);
  if (!allSectors) list = list.filter((r) => r.sector === sector);
  list = [...list].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const cap = allCountries && allSectors ? 20 : allCountries || allSectors ? 15 : 12;
  return list.slice(0, cap);
}

export function findAcwiRow(rows: AcwiUniverseRow[], raw: string): AcwiUniverseRow | undefined {
  const key = raw.trim().toUpperCase();
  if (!key) return undefined;
  const exact = rows.find((r) => r.yahoo.toUpperCase() === key || r.ric.toUpperCase() === key);
  if (exact) return exact;
  const bare = rows.filter((r) => {
    const yahooBare = r.yahoo.toUpperCase().replace(/\.[A-Z]{1,4}$/, "");
    const ricBare = r.ric.toUpperCase().split(".")[0] || "";
    return yahooBare === key || ricBare === key;
  });
  return bare.length === 1 ? bare[0] : undefined;
}

export function sliceAcwiSeries<T>(points: T[], range: QuantRange): T[] {
  const bars = range === "6mo" ? 140 : range === "1y" ? 270 : points.length;
  return points.length > bars ? points.slice(-bars) : points;
}

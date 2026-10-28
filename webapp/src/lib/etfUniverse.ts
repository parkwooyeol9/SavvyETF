/**
 * ETF universe snapshots per listing market (한국·미국·유럽·일본·홍콩·중국).
 *
 * Built offline by `03_ETF/etf_universe.py` from the SavvyDB Refinitiv masters into
 * `src/data/etfUniverse/<market>.json` (columnar: `cols` + `rows`). The ETF·DB tab reads
 * them through `/api/etf-universe` instead of crawling Naver/Yahoo on every visit.
 */

export const ETF_UNIVERSE_MARKETS = ["kr", "us", "eu", "jp", "hk", "cn"] as const;
export type EtfUniverseMarket = (typeof ETF_UNIVERSE_MARKETS)[number];

export const MARKET_LABEL: Record<EtfUniverseMarket, string> = {
  kr: "한국",
  us: "미국",
  eu: "유럽",
  jp: "일본",
  hk: "홍콩",
  cn: "중국",
};

export function isEtfUniverseMarket(v: unknown): v is EtfUniverseMarket {
  return typeof v === "string" && (ETF_UNIVERSE_MARKETS as readonly string[]).includes(v);
}

export type EtfUniverseRow = {
  t: string;
  n: string;
  iss?: string | null;
  ex?: string | null;
  dom?: string | null;
  scope?: string | null;
  reg?: string | null;
  ac?: string | null;
  sec?: string | null;
  st?: string | null;
  lev?: string | null;
  act?: number | null;
  hd?: number | null;
  bm?: string | null;
  ccy?: string | null;
  ld?: string | null;
  ter?: number | null;
  aum?: number | null;
  adv?: number | null;
  r1w?: number | null;
  r1m?: number | null;
  r3m?: number | null;
  r6m?: number | null;
  r1y?: number | null;
  vol?: number | null;
  shp?: number | null;
  gap?: number | null;
  te?: number | null;
  mdd?: number | null;
  dv?: number | null;
};

export type EtfUniverseFile = {
  ok: boolean;
  market: EtfUniverseMarket;
  label: string;
  as_of: string;
  unit: string;
  adv_unit: string;
  count: number;
  total_aum: number;
  source: string;
  dropped: Record<string, number>;
  notes: string[];
  cols: Array<keyof EtfUniverseRow>;
  rows: unknown[][];
  error?: string;
};

export type EtfUniverseIndexEntry = {
  market: EtfUniverseMarket;
  label: string;
  as_of: string;
  unit: string;
  count: number;
  total_aum: number;
  passive_count: number;
  passive_aum: number;
  top: string[];
};

export function decodeRows(file: EtfUniverseFile): EtfUniverseRow[] {
  return file.rows.map((r) => {
    const o: Record<string, unknown> = {};
    file.cols.forEach((c, i) => {
      if (r[i] != null) o[c] = r[i];
    });
    return o as EtfUniverseRow;
  });
}

export type UniverseDim = "ac" | "reg" | "sec" | "st" | "iss" | "lev" | "act" | "scope" | "ex" | "dom";

export const DIM_LABEL: Record<UniverseDim, string> = {
  scope: "국내/해외",
  ac: "자산군",
  reg: "투자지역",
  sec: "업종(GICS)",
  st: "전략/테마",
  iss: "운용사",
  lev: "레버리지",
  act: "운용방식",
  ex: "거래소",
  dom: "설정국",
};

export function dimValue(row: EtfUniverseRow, dim: UniverseDim): string {
  if (dim === "act") return row.act ? "액티브" : "패시브";
  const v = row[dim];
  return v == null || v === "" ? "—" : String(v);
}

export type UniverseGroup = {
  label: string;
  count: number;
  aum: number;
  share: number;
  ter: number | null;
  r1y: number | null;
};

/** AUM-weighted group stats for the category rail. */
export function groupRows(rows: EtfUniverseRow[], dim: UniverseDim): UniverseGroup[] {
  const acc = new Map<string, { count: number; aum: number; ter: number[]; r1yW: number; r1yA: number }>();
  let total = 0;
  for (const r of rows) {
    const key = dimValue(r, dim);
    const g = acc.get(key) || { count: 0, aum: 0, ter: [], r1yW: 0, r1yA: 0 };
    const aum = r.aum || 0;
    g.count += 1;
    g.aum += aum;
    if (r.ter != null) g.ter.push(r.ter);
    if (r.r1y != null && aum > 0) {
      g.r1yW += r.r1y * aum;
      g.r1yA += aum;
    }
    acc.set(key, g);
    total += aum;
  }
  return Array.from(acc.entries())
    .map(([label, g]) => ({
      label,
      count: g.count,
      aum: g.aum,
      share: total ? (100 * g.aum) / total : 0,
      ter: g.ter.length ? g.ter.reduce((s, x) => s + x, 0) / g.ter.length : null,
      r1y: g.r1yA ? g.r1yW / g.r1yA : null,
    }))
    .sort((a, b) => b.aum - a.aum);
}

/** 억원 → "12.3조" / "4,560억"; $M → "$1.23T" / "$45.6B" / "$780M". */
export function fmtAum(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "억원") {
    if (Math.abs(v) >= 10_000) return `${(v / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조`;
    return `${Math.round(v).toLocaleString("ko-KR")}억`;
  }
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}T`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}B`;
  return `$${v.toFixed(v >= 100 ? 0 : 1)}M`;
}

export function fmtPct(v: number | null | undefined, digits = 1, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return signed && v > 0 ? `+${s}%` : `${s}%`;
}

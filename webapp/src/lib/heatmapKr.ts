/**
 * Korean heatmap universes for the main tab.
 * Stocks: top names by Naver market cap inside the bundled KOSPI200 / KOSDAQ100 lists.
 * ETFs: one product per Korean equity or theme benchmark, largest AUM
 * (억원, 2026-10-28 universe). US benchmarks, bonds, and cash/rate funds
 * are left out — the US map already covers those markets, and daily moves
 * on bonds and cash are too small to read. Leverage and inverse too.
 */

import kosdaqFile from "@/data/kosdaq100Universe.json";
import kospiFile from "@/data/kospi200Universe.json";

export type KrHeatmapMember = {
  ticker: string;
  name: string;
  label: string;
  size: number;
  yahoo: string;
};

type Constituent = { code: string; name: string; yahoo?: string };

const NAVER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * AUM in 억원. Same benchmark keeps only the largest fund
 * (KODEX 200 over TIGER 200). US-listed benchmarks, bonds, and cash
 * (머니마켓, CD금리) are omitted.
 */
const KR_ETF: KrHeatmapMember[] = [
  { ticker: "069500", yahoo: "069500.KS", name: "KODEX 200", label: "코스피200", size: 221302 },
  { ticker: "396500", yahoo: "396500.KS", name: "TIGER 반도체TOP10", label: "반도체", size: 76979 },
  { ticker: "0167A0", yahoo: "0167A0.KS", name: "SOL AI반도체TOP2플러스", label: "AI반도체", size: 45050 },
  { ticker: "229200", yahoo: "229200.KS", name: "KODEX 코스닥150", label: "코스닥150", size: 42739 },
  { ticker: "411060", yahoo: "411060.KS", name: "ACE KRX금현물", label: "금", size: 35605 },
  { ticker: "102780", yahoo: "102780.KS", name: "KODEX 삼성그룹", label: "삼성그룹", size: 29265 },
  { ticker: "487240", yahoo: "487240.KS", name: "KODEX AI전력핵심설비", label: "AI전력", size: 23813 },
  { ticker: "161510", yahoo: "161510.KS", name: "PLUS 고배당주", label: "고배당", size: 21395 },
  { ticker: "139260", yahoo: "139260.KS", name: "TIGER 200 IT", label: "200 IT", size: 19977 },
  { ticker: "305720", yahoo: "305720.KS", name: "KODEX 2차전지산업", label: "2차전지", size: 18328 },
  { ticker: "329200", yahoo: "329200.KS", name: "TIGER 리츠부동산인프라", label: "리츠", size: 15876 },
  { ticker: "466920", yahoo: "466920.KS", name: "SOL 조선TOP3플러스", label: "조선", size: 9882 },
  { ticker: "445290", yahoo: "445290.KS", name: "KODEX 로봇액티브", label: "로봇", size: 9025 },
  { ticker: "449450", yahoo: "449450.KS", name: "PLUS K방산", label: "방산", size: 7044 },
];

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function fetchMarketCaps(codes: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < codes.length; i += 40) {
    const chunk = codes.slice(i, i + 40);
    try {
      const res = await fetch(
        `https://polling.finance.naver.com/api/realtime/domestic/stock/${chunk.join(",")}`,
        {
          headers: { "User-Agent": NAVER_UA, Referer: "https://finance.naver.com/" },
          cache: "no-store",
        },
      );
      if (!res.ok) continue;
      const payload = (await res.json()) as { datas?: Array<Record<string, unknown>> };
      for (const row of payload.datas || []) {
        const code = String(row.itemCode || "");
        const cap = num(row.marketValueFullRaw);
        if (code && cap && cap > 0) out.set(code, cap);
      }
    } catch {
      // A failed chunk falls through to the file-order backup.
    }
  }
  return out;
}

function stockMembers(list: Constituent[], caps: Map<string, number>, suffix: "KS" | "KQ"): KrHeatmapMember[] {
  const ranked = list
    .filter((c) => c.code && c.name)
    .map((c) => ({
      ticker: c.code,
      name: c.name,
      label: c.name,
      yahoo: c.yahoo || `${c.code}.${suffix}`,
      size: caps.get(c.code) || 0,
    }))
    .sort((a, b) => b.size - a.size);
  const sized = ranked.filter((r) => r.size > 0);
  if (sized.length >= 8) return sized.slice(0, 30);
  return list.slice(0, 30).map((c, i) => ({
    ticker: c.code,
    name: c.name,
    label: c.name,
    yahoo: c.yahoo || `${c.code}.${suffix}`,
    size: caps.get(c.code) || 30 - i,
  }));
}

export async function loadKrHeatmapMembers(
  universe: "kretf" | "k200" | "kq100",
): Promise<KrHeatmapMember[]> {
  if (universe === "kretf") return KR_ETF;
  if (universe === "k200") {
    const caps = await fetchMarketCaps(kospiFile.constituents.map((c) => c.code));
    return stockMembers(kospiFile.constituents, caps, "KS");
  }
  const caps = await fetchMarketCaps(kosdaqFile.constituents.map((c) => c.code));
  return stockMembers(kosdaqFile.constituents, caps, "KQ");
}

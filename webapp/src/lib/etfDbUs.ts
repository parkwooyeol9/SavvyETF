/**
 * US-listed ETF DB — curated classified universe + Yahoo metrics + NAV×Δshares flow.
 * Mirrors Korean ETF DB dimensions (type / region / sector / theme).
 */

import { reconstructUsHistories } from "@/lib/etfDbUsHistory";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

export type EtfDbUsDimension = "type" | "region" | "sector" | "theme";

export type EtfDbUsMeta = {
  symbol: string;
  name: string;
  type: string;
  region: string;
  sector: string;
  theme: string;
  /** Force-include in priority theme monitoring */
  watch?: boolean;
};

export type EtfDbUsRow = EtfDbUsMeta & {
  price: number | null;
  nav: number | null;
  change_rate: number | null;
  /** AUM in $ millions */
  aum_mn: number;
  units: number | null;
  /** Estimated creation/redemption flow in $ millions: NAV × Δshares / 1e6 */
  flow_mn: number | null;
};

export type EtfDbUsAggregate = {
  label: string;
  count: number;
  aum_mn: number;
  aum_share_pct: number;
  flow_mn: number | null;
  flow_available: boolean;
};

export type EtfDbUsHistory = {
  dates: string[];
  series: Record<string, Array<number | null>>;
};

export type EtfDbUsTickerSeries = {
  symbol: string;
  name: string;
  dates: string[];
  nav: Array<number | null>;
  units: Array<number | null>;
  aum_mn: Array<number | null>;
};

export type EtfDbUsPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  count: number;
  total_aum_mn: number;
  prev_as_of: string | null;
  as_of?: string | null;
  equity_only?: boolean;
  aggregates: Record<EtfDbUsDimension, EtfDbUsAggregate[]>;
  aum_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** AUM-weighted NAV index (100 = period start) */
  nav_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** Sum of member units (≈ flat under price backfill) */
  units_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** Per-ticker ~1y NAV / units / AUM for charts */
  ticker_series: Record<string, EtfDbUsTickerSeries>;
  history_note: string;
  rows: EtfDbUsRow[];
  note: string;
  error?: string;
};

export const ETF_DB_US_LATEST_KEY = "etf_db_us/latest.json";
export const ETF_DB_US_SNAP_PREFIX = "etf_db_us/snapshots/";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

/**
 * Tracked US ETF universe.
 * Themes of interest (watch): precious metals, defense, nuclear, rare earths,
 * oil, tanker/war shipping (BWET), uranium, etc.
 */
export const US_ETF_UNIVERSE: EtfDbUsMeta[] = [
  // —— Broad equity / index ——
  { symbol: "SPY", name: "SPDR S&P 500", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "IVV", name: "iShares Core S&P 500", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "VOO", name: "Vanguard S&P 500", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "QQQ", name: "Invesco QQQ", type: "미국 시장지수", region: "미국", sector: "IT", theme: "나스닥100" },
  { symbol: "VTI", name: "Vanguard Total Stock", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "전체시장" },
  { symbol: "IWM", name: "iShares Russell 2000", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "소형주" },
  { symbol: "DIA", name: "SPDR Dow Jones", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "MDY", name: "SPDR S&P MidCap 400", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "중형주" },

  // —— International equity ——
  { symbol: "EFA", name: "iShares MSCI EAFE", type: "해외 주식", region: "글로벌", sector: "시장지수", theme: "선진국" },
  { symbol: "VEA", name: "Vanguard FTSE Developed", type: "해외 주식", region: "글로벌", sector: "시장지수", theme: "선진국" },
  { symbol: "EEM", name: "iShares MSCI Emerging", type: "해외 주식", region: "신흥", sector: "시장지수", theme: "신흥국" },
  { symbol: "VWO", name: "Vanguard FTSE EM", type: "해외 주식", region: "신흥", sector: "시장지수", theme: "신흥국" },
  { symbol: "EWJ", name: "iShares MSCI Japan", type: "해외 주식", region: "일본", sector: "시장지수", theme: "국가" },
  { symbol: "EWY", name: "iShares MSCI South Korea", type: "해외 주식", region: "한국", sector: "시장지수", theme: "국가" },
  { symbol: "MCHI", name: "iShares MSCI China", type: "해외 주식", region: "중국", sector: "시장지수", theme: "국가" },
  { symbol: "FXI", name: "iShares China Large-Cap", type: "해외 주식", region: "중국", sector: "시장지수", theme: "국가" },
  { symbol: "INDA", name: "iShares MSCI India", type: "해외 주식", region: "인도", sector: "시장지수", theme: "국가" },
  { symbol: "VGK", name: "Vanguard FTSE Europe", type: "해외 주식", region: "유럽", sector: "시장지수", theme: "국가" },
  { symbol: "EWZ", name: "iShares MSCI Brazil", type: "해외 주식", region: "브라질", sector: "시장지수", theme: "국가" },

  // —— Sectors ——
  { symbol: "XLK", name: "Technology Select", type: "업종/테마", region: "미국", sector: "IT", theme: "섹터" },
  { symbol: "XLF", name: "Financial Select", type: "업종/테마", region: "미국", sector: "금융", theme: "섹터" },
  { symbol: "XLE", name: "Energy Select", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "XLV", name: "Health Care Select", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "섹터" },
  { symbol: "XLI", name: "Industrial Select", type: "업종/테마", region: "미국", sector: "산업재", theme: "섹터" },
  { symbol: "XLY", name: "Consumer Discretionary", type: "업종/테마", region: "미국", sector: "경기소비재", theme: "섹터" },
  { symbol: "XLP", name: "Consumer Staples", type: "업종/테마", region: "미국", sector: "필수소비재", theme: "섹터" },
  { symbol: "XLU", name: "Utilities Select", type: "업종/테마", region: "미국", sector: "유틸리티", theme: "섹터" },
  { symbol: "XLB", name: "Materials Select", type: "업종/테마", region: "미국", sector: "소재", theme: "섹터" },
  { symbol: "XLRE", name: "Real Estate Select", type: "업종/테마", region: "미국", sector: "부동산", theme: "섹터" },
  { symbol: "XLC", name: "Communication Services", type: "업종/테마", region: "미국", sector: "커뮤니케이션", theme: "섹터" },
  { symbol: "SMH", name: "VanEck Semiconductor", type: "업종/테마", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "SOXX", name: "iShares Semiconductor", type: "업종/테마", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "XBI", name: "SPDR S&P Biotech", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "바이오" },
  { symbol: "IBB", name: "iShares Biotechnology", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "바이오" },
  { symbol: "XOP", name: "SPDR Oil & Gas Exploration", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "OIH", name: "VanEck Oil Services", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },

  // —— Precious metals (귀금속) ——
  { symbol: "GLD", name: "SPDR Gold Shares", type: "원자재", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "IAU", name: "iShares Gold Trust", type: "원자재", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "GLDM", name: "SPDR Gold MiniShares", type: "원자재", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "SGOL", name: "abrdn Physical Gold", type: "원자재", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "SLV", name: "iShares Silver Trust", type: "원자재", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "SIVR", name: "abrdn Physical Silver", type: "원자재", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "PPLT", name: "abrdn Physical Platinum", type: "원자재", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "PALL", name: "abrdn Physical Palladium", type: "원자재", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "GDX", name: "VanEck Gold Miners", type: "업종/테마", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "GDXJ", name: "VanEck Junior Gold Miners", type: "업종/테마", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "SIL", name: "Global X Silver Miners", type: "업종/테마", region: "글로벌", sector: "소재", theme: "귀금속", watch: true },

  // —— Defense / aerospace (방산) ——
  { symbol: "ITA", name: "iShares U.S. Aerospace & Defense", type: "업종/테마", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "PPA", name: "Invesco Aerospace & Defense", type: "업종/테마", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "XAR", name: "SPDR S&P Aerospace & Defense", type: "업종/테마", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "DFEN", name: "Direxion Daily Aerospace & Defense Bull 3X", type: "파생", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "SHLD", name: "Global X Defense Tech", type: "업종/테마", region: "글로벌", sector: "산업재", theme: "방산", watch: true },
  { symbol: "NATO", name: "Themes Transatlantic Defense", type: "업종/테마", region: "글로벌", sector: "산업재", theme: "방산", watch: true },

  // —— Nuclear / uranium (원전) ——
  { symbol: "NLR", name: "VanEck Uranium & Nuclear", type: "업종/테마", region: "글로벌", sector: "유틸리티", theme: "원전·우라늄", watch: true },
  { symbol: "URA", name: "Global X Uranium", type: "업종/테마", region: "글로벌", sector: "에너지", theme: "원전·우라늄", watch: true },
  { symbol: "URNM", name: "Sprott Uranium Miners", type: "업종/테마", region: "글로벌", sector: "에너지", theme: "원전·우라늄", watch: true },
  { symbol: "URAN", name: "Themes Uranium & Nuclear", type: "업종/테마", region: "글로벌", sector: "에너지", theme: "원전·우라늄", watch: true },

  // —— Rare earth / strategic minerals (희토류·전략자원) ——
  { symbol: "REMX", name: "VanEck Rare Earth/Strategic Metals", type: "업종/테마", region: "글로벌", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "LIT", name: "Global X Lithium & Battery Tech", type: "업종/테마", region: "글로벌", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "SETM", name: "Sprott Critical Materials", type: "업종/테마", region: "글로벌", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "COPX", name: "Global X Copper Miners", type: "업종/테마", region: "글로벌", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "PICK", name: "iShares MSCI Global Metals & Mining", type: "업종/테마", region: "글로벌", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "XME", name: "SPDR S&P Metals & Mining", type: "업종/테마", region: "미국", sector: "소재", theme: "희토류·전략금속", watch: true },

  // —— Oil / energy commodities ——
  { symbol: "USO", name: "United States Oil Fund", type: "원자재", region: "글로벌", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "BNO", name: "United States Brent Oil", type: "원자재", region: "글로벌", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "DBO", name: "Invesco DB Oil", type: "원자재", region: "글로벌", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "UNG", name: "United States Natural Gas", type: "원자재", region: "글로벌", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "DBC", name: "Invesco DB Commodity", type: "원자재", region: "글로벌", sector: "소재", theme: "원자재바스켓" },
  { symbol: "PDBC", name: "Invesco Optimum Yield Commodity", type: "원자재", region: "글로벌", sector: "소재", theme: "원자재바스켓" },

  // —— War / shipping / geopolitics (전쟁·해운) ——
  { symbol: "BWET", name: "Breakwave Tanker Shipping", type: "업종/테마", region: "글로벌", sector: "산업재", theme: "전쟁·해운", watch: true },
  { symbol: "BDRY", name: "Breakwave Dry Bulk Shipping", type: "업종/테마", region: "글로벌", sector: "산업재", theme: "전쟁·해운", watch: true },
  { symbol: "SEA", name: "US Global Sea to Sky Cargo", type: "업종/테마", region: "글로벌", sector: "산업재", theme: "전쟁·해운", watch: true },
  { symbol: "BOAT", name: "SonicShares Global Shipping", type: "업종/테마", region: "글로벌", sector: "산업재", theme: "전쟁·해운", watch: true },

  // —— Bonds ——
  { symbol: "BND", name: "Vanguard Total Bond", type: "채권", region: "미국", sector: "채권", theme: "채권" },
  { symbol: "AGG", name: "iShares Core US Aggregate Bond", type: "채권", region: "미국", sector: "채권", theme: "채권" },
  { symbol: "TLT", name: "iShares 20+ Year Treasury", type: "채권", region: "미국", sector: "채권", theme: "장기국채" },
  { symbol: "IEF", name: "iShares 7-10 Year Treasury", type: "채권", region: "미국", sector: "채권", theme: "중기국채" },
  { symbol: "SHY", name: "iShares 1-3 Year Treasury", type: "채권", region: "미국", sector: "채권", theme: "단기국채" },
  { symbol: "TIP", name: "iShares TIPS Bond", type: "채권", region: "미국", sector: "채권", theme: "물가연동" },
  { symbol: "LQD", name: "iShares IG Corporate Bond", type: "채권", region: "미국", sector: "채권", theme: "회사채" },
  { symbol: "HYG", name: "iShares High Yield Corporate", type: "채권", region: "미국", sector: "채권", theme: "하이일드" },
  { symbol: "JNK", name: "SPDR Bloomberg High Yield", type: "채권", region: "미국", sector: "채권", theme: "하이일드" },
  { symbol: "EMB", name: "iShares JP Morgan USD EM Bond", type: "채권", region: "신흥", sector: "채권", theme: "신흥국채" },

  // —— Dividend / income ——
  { symbol: "SCHD", name: "Schwab US Dividend Equity", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "VIG", name: "Vanguard Dividend Appreciation", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "VYM", name: "Vanguard High Dividend Yield", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "JEPI", name: "JPMorgan Equity Premium Income", type: "업종/테마", region: "미국", sector: "배당", theme: "커버드콜" },
  { symbol: "JEPQ", name: "JPMorgan Nasdaq Equity Premium", type: "업종/테마", region: "미국", sector: "배당", theme: "커버드콜" },

  // —— Alts ——
  { symbol: "VNQ", name: "Vanguard Real Estate", type: "기타", region: "미국", sector: "부동산", theme: "리츠" },
  { symbol: "BITO", name: "ProShares Bitcoin Strategy", type: "기타", region: "글로벌", sector: "기타", theme: "암호화폐" },
];

const EQUITY_TYPES = new Set(["미국 시장지수", "해외 주식", "업종/테마", "파생"]);

export function isEquityUsEtf(row: Pick<EtfDbUsRow, "type" | "sector">): boolean {
  if (!EQUITY_TYPES.has(row.type)) return false;
  if (row.sector === "채권") return false;
  return true;
}

export function aggregateUsRows(
  rows: EtfDbUsRow[],
  dimension: EtfDbUsDimension,
): EtfDbUsAggregate[] {
  const buckets = new Map<string, EtfDbUsAggregate>();
  for (const row of rows) {
    const key = String(row[dimension] || "기타");
    const bucket = buckets.get(key) || {
      label: key,
      count: 0,
      aum_mn: 0,
      aum_share_pct: 0,
      flow_mn: 0,
      flow_available: false,
    };
    bucket.count += 1;
    bucket.aum_mn += row.aum_mn || 0;
    if (row.flow_mn != null) {
      bucket.flow_mn = (bucket.flow_mn || 0) + row.flow_mn;
      bucket.flow_available = true;
    }
    buckets.set(key, bucket);
  }
  const total = [...buckets.values()].reduce((s, b) => s + b.aum_mn, 0) || 1;
  return [...buckets.values()]
    .map((b) => ({
      ...b,
      aum_share_pct: (100 * b.aum_mn) / total,
      flow_mn: b.flow_available ? b.flow_mn : null,
    }))
    .sort((a, b) => b.aum_mn - a.aum_mn);
}

/** Same formula as KR ETF DB: flow = NAV_t × (units_t − units_{t−1}). */
export function computeFlowMn(
  nav: number | null,
  units: number | null,
  prevUnits: number | null | undefined,
): number | null {
  if (nav == null || !(nav > 0) || units == null || prevUnits == null) return null;
  if (!Number.isFinite(units) || !Number.isFinite(prevUnits)) return null;
  return (nav * (units - prevUnits)) / 1_000_000;
}

type YahooQuote = {
  symbol: string;
  price: number | null;
  change_pct: number | null;
  nav: number | null;
  total_assets: number | null;
  shares: number | null;
};

type YahooCookieJar = { cookie: string; crumb: string; expires: number };
let yahooJar: YahooCookieJar | null = null;

async function getYahooCrumb(): Promise<YahooCookieJar> {
  const now = Date.now();
  if (yahooJar && yahooJar.expires > now) return yahooJar;

  const warm = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const headersAny = warm.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookies =
    typeof headersAny.getSetCookie === "function" ? headersAny.getSetCookie() : [];
  let cookie = rawCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) {
    const sc = warm.headers.get("set-cookie") || "";
    cookie = sc
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.includes("="))
      .join("; ");
  }

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
  });
  if (!crumbRes.ok) throw new Error(`Yahoo crumb HTTP ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 40 || crumb.includes("<")) {
    throw new Error("Yahoo crumb invalid");
  }
  yahooJar = { cookie, crumb, expires: now + 25 * 60_000 };
  return yahooJar;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker()),
  );
  return out;
}

async function fetchOneYahooQuote(symbol: string): Promise<YahooQuote | null> {
  try {
    const jar = await getYahooCrumb();
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=price,defaultKeyStatistics,summaryDetail&crumb=${encodeURIComponent(jar.crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Cookie: jar.cookie,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401) {
      yahooJar = null;
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as {
      quoteSummary?: {
        result?: Array<{
          price?: Record<string, { raw?: number } | undefined>;
          defaultKeyStatistics?: Record<string, { raw?: number } | undefined>;
          summaryDetail?: Record<string, { raw?: number } | undefined>;
        }>;
      };
    };
    const r = json.quoteSummary?.result?.[0];
    if (!r) return null;
    const price = r.price || {};
    const ks = r.defaultKeyStatistics || {};
    const sd = r.summaryDetail || {};
    const px = num(price.regularMarketPrice?.raw);
    const chgRaw = num(price.regularMarketChangePercent?.raw);
    const nav =
      num(price.navPrice?.raw) ??
      num(sd.navPrice?.raw) ??
      px;
    const total_assets =
      num(ks.totalAssets?.raw) ??
      num(sd.totalAssets?.raw) ??
      num(price.marketCap?.raw);
    const shares =
      num(ks.sharesOutstanding?.raw) ??
      (nav != null && total_assets != null && nav > 0
        ? total_assets / nav
        : null);
    return {
      symbol: symbol.toUpperCase(),
      price: px,
      change_pct: chgRaw != null ? chgRaw * 100 : null,
      nav,
      total_assets,
      shares,
    };
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Chart fallback when quoteSummary fails — price/change only. */
async function fetchChartFallback(symbol: string): Promise<YahooQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?range=5d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
          };
        }>;
      };
    };
    const meta = json.chart?.result?.[0]?.meta;
    const px = num(meta?.regularMarketPrice);
    const prev = num(meta?.chartPreviousClose) ?? num(meta?.previousClose);
    const change_pct =
      px != null && prev != null && prev > 0 ? ((px / prev - 1) * 100) : null;
    return {
      symbol: symbol.toUpperCase(),
      price: px,
      change_pct,
      nav: px,
      total_assets: null,
      shares: null,
    };
  } catch {
    return null;
  }
}

async function fetchYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const out = new Map<string, YahooQuote>();
  const results = await mapPool(symbols, 8, async (sym) => {
    const q = (await fetchOneYahooQuote(sym)) || (await fetchChartFallback(sym));
    return q;
  });
  for (const q of results) {
    if (q) out.set(q.symbol, q);
  }
  return out;
}

type PrevSnap = {
  as_of: string;
  by_code: Record<string, { units?: number | null; nav?: number | null; aum_mn?: number }>;
};

export async function loadPrevUsSnapshot(): Promise<PrevSnap | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(ETF_DB_US_LATEST_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as {
      as_of?: string;
      rows?: Array<{ symbol?: string; units?: number | null; nav?: number | null; aum_mn?: number }>;
    };
    const by_code: PrevSnap["by_code"] = {};
    for (const r of data.rows || []) {
      if (!r.symbol) continue;
      by_code[r.symbol.toUpperCase()] = {
        units: r.units ?? null,
        nav: r.nav ?? null,
        aum_mn: r.aum_mn,
      };
    }
    return { as_of: data.as_of || "", by_code };
  } catch {
    return null;
  }
}

export async function persistUsSnapshot(payload: EtfDbUsPayload): Promise<void> {
  if (!r2Configured() || !payload.ok) return;
  const asOf = payload.as_of || new Date().toISOString().slice(0, 10);
  const body = JSON.stringify({
    as_of: asOf,
    generated_at: payload.generated_at,
    rows: payload.rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      type: r.type,
      region: r.region,
      sector: r.sector,
      theme: r.theme,
      nav: r.nav,
      units: r.units,
      aum_mn: r.aum_mn,
      flow_mn: r.flow_mn,
      price: r.price,
      change_rate: r.change_rate,
    })),
    aggregates: payload.aggregates,
    aum_history: payload.aum_history,
    nav_history: payload.nav_history,
    units_history: payload.units_history,
    ticker_series: payload.ticker_series,
    history_note: payload.history_note,
  });
  const buf = Buffer.from(body, "utf8");
  try {
    await r2PutObject(
      ETF_DB_US_LATEST_KEY,
      buf,
      "application/json; charset=utf-8",
      "public, max-age=300",
    );
    await r2PutObject(
      `${ETF_DB_US_SNAP_PREFIX}${asOf}.json`,
      buf,
      "application/json; charset=utf-8",
      "public, max-age=86400",
    );
  } catch {
    /* ignore persist errors */
  }
}

function emptyHist(): EtfDbUsHistory {
  return { dates: [], series: {} };
}

function mergeLiveAumHistory(
  prev: EtfDbUsHistory | undefined,
  liveAggs: EtfDbUsAggregate[],
  day: string,
): EtfDbUsHistory {
  const dates = [...(prev?.dates || [])];
  const series: Record<string, Array<number | null>> = {};
  for (const [k, vals] of Object.entries(prev?.series || {})) {
    series[k] = [...vals];
  }
  const liveTotal = liveAggs.reduce((s, a) => s + a.aum_mn, 0);
  if (!series["전체"]) series["전체"] = dates.map(() => null);

  if (dates.length && dates[dates.length - 1] === day) {
    series["전체"][dates.length - 1] = liveTotal;
    for (const a of liveAggs) {
      if (!series[a.label]) series[a.label] = dates.map(() => null);
      series[a.label]![dates.length - 1] = a.aum_mn;
    }
  } else {
    dates.push(day);
    for (const key of Object.keys(series)) {
      series[key]!.push(null);
    }
    if (!series["전체"]) series["전체"] = dates.map(() => null);
    series["전체"][dates.length - 1] = liveTotal;
    for (const a of liveAggs) {
      if (!series[a.label]) series[a.label] = Array.from({ length: dates.length - 1 }, () => null);
      while (series[a.label]!.length < dates.length) series[a.label]!.push(null);
      series[a.label]![dates.length - 1] = a.aum_mn;
    }
  }

  const ranked = Object.keys(series)
    .filter((k) => k !== "전체")
    .sort((a, b) => {
      const sa = series[a]!.slice(-10).reduce<number>((s, v) => s + (v ?? 0), 0);
      const sb = series[b]!.slice(-10).reduce<number>((s, v) => s + (v ?? 0), 0);
      return sb - sa;
    });
  const liveLabels = liveAggs.map((a) => a.label);
  const keep = Array.from(new Set(["전체", ...ranked.slice(0, 14), ...liveLabels]));
  return {
    dates,
    series: Object.fromEntries(keep.filter((k) => series[k]).map((k) => [k, series[k]!])),
  };
}

export async function buildEtfDbUsPayload(opts?: {
  equityOnly?: boolean;
  watchOnly?: boolean;
}): Promise<EtfDbUsPayload> {
  let metas = [...US_ETF_UNIVERSE];
  if (opts?.watchOnly) metas = metas.filter((m) => m.watch);
  const quotes = await fetchYahooQuotes(metas.map((m) => m.symbol));
  const prev = await loadPrevUsSnapshot();
  const today = new Date().toISOString().slice(0, 10);

  let rows: EtfDbUsRow[] = metas.map((m) => {
    const q = quotes.get(m.symbol.toUpperCase());
    const price = q?.price ?? null;
    const nav = q?.nav ?? price;
    const change = q?.change_pct ?? null;
    const assets = q?.total_assets ?? null;
    const aum_mn = assets != null && assets > 0 ? assets / 1_000_000 : 0;
    let units = q?.shares ?? null;
    if ((units == null || !(units > 0)) && nav != null && nav > 0 && aum_mn > 0) {
      units = (aum_mn * 1_000_000) / nav;
    }
    const prevUnits = prev?.by_code[m.symbol.toUpperCase()]?.units;
    // Same calendar day → don't treat as a new flow day
    const flow_mn =
      prev?.as_of && prev.as_of !== today
        ? computeFlowMn(nav, units, prevUnits)
        : null;

    return {
      ...m,
      price,
      nav,
      change_rate: change,
      aum_mn,
      units,
      flow_mn,
    };
  });

  rows.sort((a, b) => (b.aum_mn || 0) - (a.aum_mn || 0));
  if (opts?.equityOnly) rows = rows.filter(isEquityUsEtf);

  const aggregates = {
    type: aggregateUsRows(rows, "type"),
    region: aggregateUsRows(rows, "region"),
    sector: aggregateUsRows(rows, "sector"),
    theme: aggregateUsRows(rows, "theme"),
  };

  const hist = await reconstructUsHistories({
    rows,
    aggregates,
    liveDay: today,
    equityOnly: !!opts?.equityOnly,
    watchOnly: !!opts?.watchOnly,
  });

  const now = new Date();
  const display = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const quoted = rows.filter((r) => r.price != null || r.aum_mn > 0).length;
  const histDays = hist.aum_history.theme?.dates?.length || 0;

  return {
    ok: true,
    generated_at: now.toISOString(),
    generated_at_display: display,
    source: `yahoo quote · tracked ${metas.length} · quoted ${quoted} · history ${histDays}d`,
    count: rows.length,
    total_aum_mn: rows.reduce((s, r) => s + (r.aum_mn || 0), 0),
    prev_as_of: prev?.as_of && prev.as_of !== today ? prev.as_of : null,
    as_of: today,
    equity_only: !!opts?.equityOnly,
    aggregates,
    aum_history: hist.aum_history,
    nav_history: hist.nav_history,
    units_history: hist.units_history,
    ticker_series: hist.ticker_series,
    history_note: hist.method_note,
    rows,
    note:
      "수급 = NAV×Δ설정좌수(백만달러). 귀금속·방산·원전·희토류(REMX)·원유·BWET 등 전쟁·전략자원 테마를 우선 포함. " +
      "유니버스는 미국 상장 ETF 핵심·테마 추적 세트이며 점진 확장합니다.",
  };
}

export function fmtUsdMn(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1000) {
    return `$${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  }
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
}

export function fmtSignedUsdMn(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtUsdMn(n)}`;
}

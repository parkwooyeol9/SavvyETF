/** Expanded ETF universe for allocation simulation (US + KR listings). */

export type ListingMarket = "us" | "kr";

export type AssetClass = "equity" | "bond" | "alt";
export type Region =
  | "us"
  | "europe"
  | "japan"
  | "china"
  | "korea"
  | "em"
  | "global"
  | "multi";

/** Dividend-style buckets used by the 배당투자 method. */
export type DividendStyle =
  | "quality_div"
  | "high_div"
  | "intl_div"
  | "monthly_income"
  | "bond_income";

export type EtfMeta = {
  symbol: string;
  name: string;
  group: string;
  assetClass: AssetClass;
  region: Region;
  listing: ListingMarket;
  /** Shown in the primary picker row. */
  featured?: boolean;
  /** Optional twin on the other listing market. */
  counterpart?: string;
  dividendStyle?: DividendStyle;
};

export const LISTING_MARKETS: Array<{
  id: ListingMarket;
  label: string;
  blurb: string;
}> = [
  {
    id: "us",
    label: "미국 상장",
    blurb: "NYSE·Nasdaq ETF (달러). SPY, QQQ, SCHD 등",
  },
  {
    id: "kr",
    label: "한국 상장",
    blurb: "국내 거래소 ETF (원). TIGER S&P500, KODEX 200 등",
  },
];

export const ETF_CATALOG: EtfMeta[] = [
  // ═══════════════════════════════════════════
  // US LISTED
  // ═══════════════════════════════════════════
  { symbol: "SPY", name: "S&P 500", group: "미국 주식", assetClass: "equity", region: "us", listing: "us", featured: true, counterpart: "360750.KS" },
  { symbol: "QQQ", name: "Nasdaq-100", group: "미국 주식", assetClass: "equity", region: "us", listing: "us", featured: true, counterpart: "133690.KS" },
  { symbol: "VTI", name: "Total US Stock", group: "미국 주식", assetClass: "equity", region: "us", listing: "us", featured: true, counterpart: "251350.KS" },
  { symbol: "IWM", name: "Russell 2000", group: "미국 주식", assetClass: "equity", region: "us", listing: "us", featured: true, counterpart: "229200.KS" },
  { symbol: "VGK", name: "Europe", group: "국가·지역", assetClass: "equity", region: "europe", listing: "us", featured: true, counterpart: "195970.KS" },
  { symbol: "EWJ", name: "Japan", group: "국가·지역", assetClass: "equity", region: "japan", listing: "us", featured: true, counterpart: "241180.KS" },
  { symbol: "MCHI", name: "China", group: "국가·지역", assetClass: "equity", region: "china", listing: "us", featured: true, counterpart: "283580.KS" },
  { symbol: "EWY", name: "South Korea", group: "국가·지역", assetClass: "equity", region: "korea", listing: "us", featured: true, counterpart: "069500.KS" },
  { symbol: "TLT", name: "20+ Year Treasury", group: "채권", assetClass: "bond", region: "us", listing: "us", featured: true, counterpart: "453850.KS", dividendStyle: "bond_income" },
  { symbol: "BND", name: "Total Bond Market", group: "채권", assetClass: "bond", region: "us", listing: "us", featured: true, counterpart: "114260.KS", dividendStyle: "bond_income" },
  { symbol: "GLD", name: "Gold", group: "대안", assetClass: "alt", region: "global", listing: "us", featured: true, counterpart: "411060.KS" },
  { symbol: "VNQ", name: "US Real Estate", group: "대안", assetClass: "alt", region: "us", listing: "us", featured: true },

  { symbol: "VOO", name: "S&P 500 (Vanguard)", group: "미국 주식", assetClass: "equity", region: "us", listing: "us", counterpart: "379800.KS" },
  { symbol: "IVV", name: "iShares Core S&P 500", group: "미국 주식", assetClass: "equity", region: "us", listing: "us", counterpart: "360750.KS" },
  { symbol: "DIA", name: "Dow Jones", group: "미국 주식", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "MDY", name: "S&P MidCap 400", group: "미국 주식", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "IJH", name: "Core S&P Mid-Cap", group: "미국 주식", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "IJR", name: "Core S&P Small-Cap", group: "미국 주식", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "VUG", name: "Growth", group: "미국 주식", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "VTV", name: "Value", group: "미국 주식", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "QUAL", name: "US Quality Factor", group: "미국 주식", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "MTUM", name: "US Momentum Factor", group: "미국 주식", assetClass: "equity", region: "us", listing: "us" },

  // US dividend-focused
  { symbol: "SCHD", name: "US Dividend Equity", group: "배당", assetClass: "equity", region: "us", listing: "us", featured: true, dividendStyle: "quality_div", counterpart: "458730.KS" },
  { symbol: "VIG", name: "Dividend Appreciation", group: "배당", assetClass: "equity", region: "us", listing: "us", dividendStyle: "quality_div", counterpart: "429000.KS" },
  { symbol: "DGRO", name: "Core Dividend Growth", group: "배당", assetClass: "equity", region: "us", listing: "us", dividendStyle: "quality_div" },
  { symbol: "VYM", name: "High Dividend Yield", group: "배당", assetClass: "equity", region: "us", listing: "us", dividendStyle: "high_div", counterpart: "402970.KS" },
  { symbol: "HDV", name: "Core High Dividend", group: "배당", assetClass: "equity", region: "us", listing: "us", dividendStyle: "high_div" },
  { symbol: "DVY", name: "Select Dividend", group: "배당", assetClass: "equity", region: "us", listing: "us", dividendStyle: "high_div" },
  { symbol: "VYMI", name: "Intl High Dividend", group: "배당", assetClass: "equity", region: "global", listing: "us", dividendStyle: "intl_div" },
  { symbol: "IDV", name: "Intl Select Dividend", group: "배당", assetClass: "equity", region: "global", listing: "us", dividendStyle: "intl_div" },
  { symbol: "JEPI", name: "Equity Premium Income", group: "배당", assetClass: "equity", region: "us", listing: "us", dividendStyle: "monthly_income", counterpart: "441640.KS" },
  { symbol: "JEPQ", name: "Nasdaq Equity Premium", group: "배당", assetClass: "equity", region: "us", listing: "us", dividendStyle: "monthly_income", counterpart: "441680.KS" },

  { symbol: "VXUS", name: "Total Intl Stock", group: "국가·지역", assetClass: "equity", region: "global", listing: "us", counterpart: "251350.KS" },
  { symbol: "EFA", name: "EAFE Developed", group: "국가·지역", assetClass: "equity", region: "global", listing: "us", counterpart: "195970.KS" },
  { symbol: "IEFA", name: "Core MSCI EAFE", group: "국가·지역", assetClass: "equity", region: "global", listing: "us" },
  { symbol: "VEA", name: "Developed Markets", group: "국가·지역", assetClass: "equity", region: "global", listing: "us" },
  { symbol: "IEUR", name: "Core MSCI Europe", group: "국가·지역", assetClass: "equity", region: "europe", listing: "us" },
  { symbol: "EZU", name: "Eurozone", group: "국가·지역", assetClass: "equity", region: "europe", listing: "us" },
  { symbol: "EWU", name: "United Kingdom", group: "국가·지역", assetClass: "equity", region: "europe", listing: "us" },
  { symbol: "DXJ", name: "Japan Hedged", group: "국가·지역", assetClass: "equity", region: "japan", listing: "us" },
  { symbol: "BBJP", name: "JPMorgan Japan", group: "국가·지역", assetClass: "equity", region: "japan", listing: "us" },
  { symbol: "FXI", name: "China Large-Cap", group: "국가·지역", assetClass: "equity", region: "china", listing: "us" },
  { symbol: "KWEB", name: "China Internet", group: "국가·지역", assetClass: "equity", region: "china", listing: "us" },
  { symbol: "ASHR", name: "China A-Shares", group: "국가·지역", assetClass: "equity", region: "china", listing: "us" },
  { symbol: "EEM", name: "Emerging Markets", group: "국가·지역", assetClass: "equity", region: "em", listing: "us", counterpart: "195980.KS" },
  { symbol: "IEMG", name: "Core MSCI EM", group: "국가·지역", assetClass: "equity", region: "em", listing: "us" },
  { symbol: "VWO", name: "FTSE EM", group: "국가·지역", assetClass: "equity", region: "em", listing: "us" },
  { symbol: "INDA", name: "India", group: "국가·지역", assetClass: "equity", region: "em", listing: "us" },
  { symbol: "EWZ", name: "Brazil", group: "국가·지역", assetClass: "equity", region: "em", listing: "us" },

  { symbol: "AGG", name: "US Aggregate Bond", group: "채권", assetClass: "bond", region: "us", listing: "us", dividendStyle: "bond_income" },
  { symbol: "IEF", name: "7-10 Year Treasury", group: "채권", assetClass: "bond", region: "us", listing: "us", counterpart: "305080.KS", dividendStyle: "bond_income" },
  { symbol: "SHY", name: "1-3 Year Treasury", group: "채권", assetClass: "bond", region: "us", listing: "us", dividendStyle: "bond_income" },
  { symbol: "TIP", name: "TIPS", group: "채권", assetClass: "bond", region: "us", listing: "us", dividendStyle: "bond_income" },
  { symbol: "LQD", name: "Investment Grade Corp", group: "채권", assetClass: "bond", region: "us", listing: "us", dividendStyle: "bond_income" },
  { symbol: "HYG", name: "High Yield Corp", group: "채권", assetClass: "bond", region: "us", listing: "us", dividendStyle: "bond_income" },
  { symbol: "JNK", name: "High Yield Bond", group: "채권", assetClass: "bond", region: "us", listing: "us", dividendStyle: "bond_income" },
  { symbol: "BNDX", name: "Intl Bond (USD Hedged)", group: "채권", assetClass: "bond", region: "global", listing: "us", dividendStyle: "bond_income" },
  { symbol: "EMB", name: "EM USD Bond", group: "채권", assetClass: "bond", region: "em", listing: "us", dividendStyle: "bond_income" },

  { symbol: "IAU", name: "Gold Trust", group: "대안", assetClass: "alt", region: "global", listing: "us", counterpart: "132030.KS" },
  { symbol: "SLV", name: "Silver", group: "대안", assetClass: "alt", region: "global", listing: "us" },
  { symbol: "DBC", name: "Commodities", group: "대안", assetClass: "alt", region: "global", listing: "us" },
  { symbol: "PDBC", name: "Optimum Yield Commodity", group: "대안", assetClass: "alt", region: "global", listing: "us" },
  { symbol: "USO", name: "Crude Oil", group: "대안", assetClass: "alt", region: "global", listing: "us", counterpart: "261220.KS" },
  { symbol: "IYR", name: "US Real Estate", group: "대안", assetClass: "alt", region: "us", listing: "us" },
  { symbol: "SCHH", name: "US REIT", group: "대안", assetClass: "alt", region: "us", listing: "us" },
  { symbol: "BITO", name: "Bitcoin Strategy", group: "대안", assetClass: "alt", region: "global", listing: "us" },

  { symbol: "XLK", name: "Technology", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLF", name: "Financials", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLE", name: "Energy", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLV", name: "Health Care", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLI", name: "Industrials", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLY", name: "Consumer Discretionary", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLP", name: "Consumer Staples", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLU", name: "Utilities", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLB", name: "Materials", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XLRE", name: "Real Estate Sector", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "SMH", name: "Semiconductors", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "SOXX", name: "Semiconductor", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "XBI", name: "Biotech", group: "섹터", assetClass: "equity", region: "us", listing: "us" },
  { symbol: "ARKK", name: "Innovation", group: "섹터", assetClass: "equity", region: "us", listing: "us" },

  // ═══════════════════════════════════════════
  // KR LISTED (domestic exchange, KRW)
  // ═══════════════════════════════════════════
  { symbol: "360750.KS", name: "TIGER 미국S&P500", group: "미국 주식", assetClass: "equity", region: "us", listing: "kr", featured: true, counterpart: "SPY" },
  { symbol: "379800.KS", name: "KODEX 미국S&P500", group: "미국 주식", assetClass: "equity", region: "us", listing: "kr", counterpart: "VOO" },
  { symbol: "133690.KS", name: "TIGER 미국나스닥100", group: "미국 주식", assetClass: "equity", region: "us", listing: "kr", featured: true, counterpart: "QQQ" },
  { symbol: "251350.KS", name: "KODEX MSCI World", group: "국가·지역", assetClass: "equity", region: "global", listing: "kr", featured: true, counterpart: "VTI" },
  { symbol: "069500.KS", name: "KODEX 200", group: "한국 주식", assetClass: "equity", region: "korea", listing: "kr", featured: true, counterpart: "EWY" },
  { symbol: "102110.KS", name: "TIGER 200", group: "한국 주식", assetClass: "equity", region: "korea", listing: "kr" },
  { symbol: "229200.KS", name: "KODEX 코스닥150", group: "한국 주식", assetClass: "equity", region: "korea", listing: "kr", featured: true, counterpart: "IWM" },
  { symbol: "195970.KS", name: "PLUS 선진국MSCI(H)", group: "국가·지역", assetClass: "equity", region: "europe", listing: "kr", featured: true, counterpart: "VGK" },
  { symbol: "241180.KS", name: "TIGER 일본니케이225", group: "국가·지역", assetClass: "equity", region: "japan", listing: "kr", featured: true, counterpart: "EWJ" },
  { symbol: "283580.KS", name: "KODEX 중국본토CSI300", group: "국가·지역", assetClass: "equity", region: "china", listing: "kr", featured: true, counterpart: "MCHI" },
  { symbol: "195980.KS", name: "PLUS 신흥국MSCI(H)", group: "국가·지역", assetClass: "equity", region: "em", listing: "kr", counterpart: "EEM" },
  { symbol: "305080.KS", name: "TIGER 미국채10년선물", group: "채권", assetClass: "bond", region: "us", listing: "kr", featured: true, counterpart: "IEF", dividendStyle: "bond_income" },
  { symbol: "453850.KS", name: "ACE 미국30년국채액티브", group: "채권", assetClass: "bond", region: "us", listing: "kr", featured: true, counterpart: "TLT", dividendStyle: "bond_income" },
  { symbol: "114260.KS", name: "KODEX 국고채", group: "채권", assetClass: "bond", region: "korea", listing: "kr", featured: true, counterpart: "BND", dividendStyle: "bond_income" },
  { symbol: "148070.KS", name: "KIWOOM 국고채10년", group: "채권", assetClass: "bond", region: "korea", listing: "kr", dividendStyle: "bond_income" },
  { symbol: "411060.KS", name: "ACE KRX금현물", group: "대안", assetClass: "alt", region: "global", listing: "kr", featured: true, counterpart: "GLD" },
  { symbol: "132030.KS", name: "KODEX 골드선물(H)", group: "대안", assetClass: "alt", region: "global", listing: "kr", counterpart: "IAU" },
  { symbol: "261220.KS", name: "KODEX WTI원유선물(H)", group: "대안", assetClass: "alt", region: "global", listing: "kr", counterpart: "USO" },

  // KR dividend-focused
  { symbol: "458730.KS", name: "TIGER 미국배당다우존스", group: "배당", assetClass: "equity", region: "us", listing: "kr", featured: true, dividendStyle: "quality_div", counterpart: "SCHD" },
  { symbol: "429000.KS", name: "TIGER 미국S&P500배당귀족", group: "배당", assetClass: "equity", region: "us", listing: "kr", dividendStyle: "quality_div", counterpart: "VIG" },
  { symbol: "446720.KS", name: "SOL 미국배당다우존스", group: "배당", assetClass: "equity", region: "us", listing: "kr", dividendStyle: "quality_div" },
  { symbol: "161510.KS", name: "PLUS 고배당주", group: "배당", assetClass: "equity", region: "korea", listing: "kr", featured: true, dividendStyle: "high_div" },
  { symbol: "279530.KS", name: "KODEX 고배당", group: "배당", assetClass: "equity", region: "korea", listing: "kr", dividendStyle: "high_div" },
  { symbol: "210780.KS", name: "TIGER 고배당", group: "배당", assetClass: "equity", region: "korea", listing: "kr", dividendStyle: "high_div" },
  { symbol: "251590.KS", name: "PLUS 고배당저변동", group: "배당", assetClass: "equity", region: "korea", listing: "kr", dividendStyle: "quality_div" },
  { symbol: "402970.KS", name: "ACE 미국고배당S&P", group: "배당", assetClass: "equity", region: "us", listing: "kr", featured: true, dividendStyle: "intl_div", counterpart: "VYM" },
  { symbol: "441640.KS", name: "KODEX 미국배당프리미엄액티브", group: "배당", assetClass: "equity", region: "us", listing: "kr", featured: true, dividendStyle: "monthly_income", counterpart: "JEPI" },
  { symbol: "441680.KS", name: "TIGER 미국나스닥100커버드콜", group: "배당", assetClass: "equity", region: "us", listing: "kr", dividendStyle: "monthly_income", counterpart: "JEPQ" },
  { symbol: "481060.KS", name: "KODEX 미국30년국채커버드콜", group: "배당", assetClass: "bond", region: "us", listing: "kr", dividendStyle: "monthly_income" },
];

export const CATALOG_BY_SYMBOL: Record<string, EtfMeta> = Object.fromEntries(
  ETF_CATALOG.map((e) => [e.symbol, e]),
);

export function catalogForListing(listing: ListingMarket): EtfMeta[] {
  return ETF_CATALOG.filter((e) => e.listing === listing);
}

export function featuredEtfs(listing: ListingMarket = "us"): EtfMeta[] {
  return catalogForListing(listing).filter((e) => e.featured);
}

/** Map a ticker to its counterpart on the other listing, if defined. */
export function mapToListing(symbol: string, listing: ListingMarket): string | null {
  const meta = CATALOG_BY_SYMBOL[symbol];
  if (!meta) return null;
  if (meta.listing === listing) return symbol;
  if (meta.counterpart && CATALOG_BY_SYMBOL[meta.counterpart]?.listing === listing) {
    return meta.counterpart;
  }
  // reverse lookup
  const twin = ETF_CATALOG.find(
    (e) => e.listing === listing && e.counterpart === symbol,
  );
  return twin?.symbol ?? null;
}

/** Default basket for asset-class mix (editable targets default 60/30/10). */
export const ASSET_631_BASKET: Record<ListingMarket, readonly string[]> = {
  us: ["VTI", "BND", "GLD"],
  kr: ["360750.KS", "114260.KS", "411060.KS"],
};

/** Default basket for country mix US60 / EU10 / JP10 / CN10 / KR10. */
export const REGION_BASKET: Record<ListingMarket, readonly string[]> = {
  us: ["SPY", "VGK", "EWJ", "MCHI", "EWY"],
  kr: ["360750.KS", "195970.KS", "241180.KS", "283580.KS", "069500.KS"],
};

export const DIVIDEND_BASKET: Record<ListingMarket, readonly string[]> = {
  us: ["SCHD", "VYM", "VYMI", "JEPI", "BND"],
  kr: ["458730.KS", "161510.KS", "402970.KS", "441640.KS", "114260.KS"],
};

/** Index benchmarks shared across US/KR listing portfolios. */
export const BENCHMARK_OPTIONS = [
  {
    id: "^GSPC",
    label: "S&P 500",
    blurb: "미국 대형주 지수 (^GSPC)",
  },
  {
    id: "^KS11",
    label: "코스피 지수",
    blurb: "한국 종합주가지수 (^KS11)",
  },
  {
    id: "ACWI",
    label: "MSCI ACWI",
    blurb: "전세계 주식 (iShares ACWI)",
  },
] as const;

export type BenchmarkId = (typeof BENCHMARK_OPTIONS)[number]["id"];

export function benchmarkLabel(id: string): string {
  const hit = BENCHMARK_OPTIONS.find((b) => b.id === id);
  return hit?.label || id;
}

/** @deprecated Prefer BENCHMARK_OPTIONS — kept for older imports */
export const BENCHMARKS: Record<ListingMarket, readonly string[]> = {
  us: ["^GSPC", "^KS11", "ACWI"],
  kr: ["^GSPC", "^KS11", "ACWI"],
};

export const DEFAULT_CAPITAL: Record<ListingMarket, number> = {
  us: 10_000,
  kr: 10_000_000,
};

export type AllocMethod = "equal" | "inv_vol" | "asset" | "region" | "dividend";

export const ALLOC_METHODS: Array<{
  id: AllocMethod;
  label: string;
  blurb: string;
}> = [
  {
    id: "equal",
    label: "동일가중",
    blurb: "선택한 ETF에 같은 비중을 둡니다. w_i = 1/N",
  },
  {
    id: "inv_vol",
    label: "변동성 배분",
    blurb: "구간 일수익률로 σ를 구한 뒤 w_i ∝ 1/σ_i (역변동성).",
  },
  {
    id: "asset",
    label: "자산군 배분",
    blurb: "주식·채권·대안 목표 비중을 맞춘 뒤, 군 안에서는 균등.",
  },
  {
    id: "region",
    label: "국가 배분",
    blurb: "미국·유럽·일본·중국·한국 목표 비중을 맞춘 뒤, 국가 안에서는 균등.",
  },
  {
    id: "dividend",
    label: "배당투자",
    blurb: "퀄리티·고배당·해외배당·월배당·채권 등 소득형 포트폴리오.",
  },
];

export const DIVIDEND_STYLE_LABELS: Record<DividendStyle, string> = {
  quality_div: "퀄리티 배당",
  high_div: "고배당",
  intl_div: "해외·국제 배당",
  monthly_income: "월배당·커버드콜",
  bond_income: "채권·인컴",
};

/** Display code (strip .KS) + catalog name for UI. */
export function etfDisplay(symbol: string): { code: string; name: string } {
  const key = symbol.trim();
  const meta = CATALOG_BY_SYMBOL[key] || CATALOG_BY_SYMBOL[key.toUpperCase()];
  const code = key.replace(/\.KS$/i, "");
  return { code, name: meta?.name || code };
}

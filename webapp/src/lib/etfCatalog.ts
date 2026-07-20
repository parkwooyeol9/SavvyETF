/** Expanded ETF universe for allocation simulation. */

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

export type EtfMeta = {
  symbol: string;
  name: string;
  group: string;
  assetClass: AssetClass;
  region: Region;
  /** Shown in the primary picker row. */
  featured?: boolean;
};

export const ETF_CATALOG: EtfMeta[] = [
  // —— Featured core ——
  { symbol: "SPY", name: "S&P 500", group: "미국 주식", assetClass: "equity", region: "us", featured: true },
  { symbol: "QQQ", name: "Nasdaq-100", group: "미국 주식", assetClass: "equity", region: "us", featured: true },
  { symbol: "VTI", name: "Total US Stock", group: "미국 주식", assetClass: "equity", region: "us", featured: true },
  { symbol: "IWM", name: "Russell 2000", group: "미국 주식", assetClass: "equity", region: "us", featured: true },
  { symbol: "VGK", name: "Europe", group: "국가·지역", assetClass: "equity", region: "europe", featured: true },
  { symbol: "EWJ", name: "Japan", group: "국가·지역", assetClass: "equity", region: "japan", featured: true },
  { symbol: "MCHI", name: "China", group: "국가·지역", assetClass: "equity", region: "china", featured: true },
  { symbol: "EWY", name: "South Korea", group: "국가·지역", assetClass: "equity", region: "korea", featured: true },
  { symbol: "TLT", name: "20+ Year Treasury", group: "채권", assetClass: "bond", region: "us", featured: true },
  { symbol: "BND", name: "Total Bond Market", group: "채권", assetClass: "bond", region: "us", featured: true },
  { symbol: "GLD", name: "Gold", group: "대안", assetClass: "alt", region: "global", featured: true },
  { symbol: "VNQ", name: "US Real Estate", group: "대안", assetClass: "alt", region: "us", featured: true },

  // —— US equity ——
  { symbol: "VOO", name: "S&P 500 (Vanguard)", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "IVV", name: "iShares Core S&P 500", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "DIA", name: "Dow Jones", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "MDY", name: "S&P MidCap 400", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "IJH", name: "Core S&P Mid-Cap", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "IJR", name: "Core S&P Small-Cap", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "VUG", name: "Growth", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "VTV", name: "Value", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "SCHD", name: "US Dividend Equity", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "QUAL", name: "US Quality Factor", group: "미국 주식", assetClass: "equity", region: "us" },
  { symbol: "MTUM", name: "US Momentum Factor", group: "미국 주식", assetClass: "equity", region: "us" },

  // —— Country / region ——
  { symbol: "VXUS", name: "Total Intl Stock", group: "국가·지역", assetClass: "equity", region: "global" },
  { symbol: "EFA", name: "EAFE Developed", group: "국가·지역", assetClass: "equity", region: "global" },
  { symbol: "IEFA", name: "Core MSCI EAFE", group: "국가·지역", assetClass: "equity", region: "global" },
  { symbol: "VEA", name: "Developed Markets", group: "국가·지역", assetClass: "equity", region: "global" },
  { symbol: "IEUR", name: "Core MSCI Europe", group: "국가·지역", assetClass: "equity", region: "europe" },
  { symbol: "EZU", name: "Eurozone", group: "국가·지역", assetClass: "equity", region: "europe" },
  { symbol: "EWU", name: "United Kingdom", group: "국가·지역", assetClass: "equity", region: "europe" },
  { symbol: "DXJ", name: "Japan Hedged", group: "국가·지역", assetClass: "equity", region: "japan" },
  { symbol: "BBJP", name: "JPMorgan Japan", group: "국가·지역", assetClass: "equity", region: "japan" },
  { symbol: "FXI", name: "China Large-Cap", group: "국가·지역", assetClass: "equity", region: "china" },
  { symbol: "KWEB", name: "China Internet", group: "국가·지역", assetClass: "equity", region: "china" },
  { symbol: "ASHR", name: "China A-Shares", group: "국가·지역", assetClass: "equity", region: "china" },
  { symbol: "EEM", name: "Emerging Markets", group: "국가·지역", assetClass: "equity", region: "em" },
  { symbol: "IEMG", name: "Core MSCI EM", group: "국가·지역", assetClass: "equity", region: "em" },
  { symbol: "VWO", name: "FTSE EM", group: "국가·지역", assetClass: "equity", region: "em" },
  { symbol: "INDA", name: "India", group: "국가·지역", assetClass: "equity", region: "em" },
  { symbol: "EWZ", name: "Brazil", group: "국가·지역", assetClass: "equity", region: "em" },
  { symbol: "069500.KS", name: "KODEX 200", group: "국가·지역", assetClass: "equity", region: "korea" },
  { symbol: "229200.KS", name: "KODEX KOSDAQ150", group: "국가·지역", assetClass: "equity", region: "korea" },

  // —— Bonds ——
  { symbol: "AGG", name: "US Aggregate Bond", group: "채권", assetClass: "bond", region: "us" },
  { symbol: "IEF", name: "7-10 Year Treasury", group: "채권", assetClass: "bond", region: "us" },
  { symbol: "SHY", name: "1-3 Year Treasury", group: "채권", assetClass: "bond", region: "us" },
  { symbol: "TIP", name: "TIPS", group: "채권", assetClass: "bond", region: "us" },
  { symbol: "LQD", name: "Investment Grade Corp", group: "채권", assetClass: "bond", region: "us" },
  { symbol: "HYG", name: "High Yield Corp", group: "채권", assetClass: "bond", region: "us" },
  { symbol: "JNK", name: "High Yield Bond", group: "채권", assetClass: "bond", region: "us" },
  { symbol: "BNDX", name: "Intl Bond (USD Hedged)", group: "채권", assetClass: "bond", region: "global" },
  { symbol: "EMB", name: "EM USD Bond", group: "채권", assetClass: "bond", region: "em" },

  // —— Alternatives ——
  { symbol: "IAU", name: "Gold Trust", group: "대안", assetClass: "alt", region: "global" },
  { symbol: "SLV", name: "Silver", group: "대안", assetClass: "alt", region: "global" },
  { symbol: "DBC", name: "Commodities", group: "대안", assetClass: "alt", region: "global" },
  { symbol: "PDBC", name: "Optimum Yield Commodity", group: "대안", assetClass: "alt", region: "global" },
  { symbol: "USO", name: "Crude Oil", group: "대안", assetClass: "alt", region: "global" },
  { symbol: "IYR", name: "US Real Estate", group: "대안", assetClass: "alt", region: "us" },
  { symbol: "SCHH", name: "US REIT", group: "대안", assetClass: "alt", region: "us" },
  { symbol: "BITO", name: "Bitcoin Strategy", group: "대안", assetClass: "alt", region: "global" },

  // —— Sectors ——
  { symbol: "XLK", name: "Technology", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLF", name: "Financials", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLE", name: "Energy", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLV", name: "Health Care", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLI", name: "Industrials", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLY", name: "Consumer Discretionary", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLP", name: "Consumer Staples", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLU", name: "Utilities", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLB", name: "Materials", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XLRE", name: "Real Estate Sector", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "SMH", name: "Semiconductors", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "SOXX", name: "Semiconductor", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "XBI", name: "Biotech", group: "섹터", assetClass: "equity", region: "us" },
  { symbol: "ARKK", name: "Innovation", group: "섹터", assetClass: "equity", region: "us" },
];

export const CATALOG_BY_SYMBOL: Record<string, EtfMeta> = Object.fromEntries(
  ETF_CATALOG.map((e) => [e.symbol, e]),
);

export function featuredEtfs(): EtfMeta[] {
  return ETF_CATALOG.filter((e) => e.featured);
}

/** Default basket for asset-class 60/30/10. */
export const ASSET_631_BASKET = ["VTI", "VXUS", "BND", "TLT", "GLD"] as const;

/** Default basket for country mix US60 / EU10 / JP10 / CN10 / KR10. */
export const REGION_BASKET = ["SPY", "VGK", "EWJ", "MCHI", "EWY"] as const;

export type AllocMethod = "equal" | "inv_vol" | "asset_631" | "region";

export const ALLOC_METHODS: Array<{
  id: AllocMethod;
  label: string;
  blurb: string;
}> = [
  {
    id: "equal",
    label: "동일가중",
    blurb: "선택한 ETF에 같은 비중을 둡니다.",
  },
  {
    id: "inv_vol",
    label: "변동성 배분",
    blurb: "과거 변동성이 낮은 ETF에 더 큰 비중(역변동성).",
  },
  {
    id: "asset_631",
    label: "자산군 6:3:1",
    blurb: "주식 60% · 채권 30% · 대안 10%. 클래스 안은 균등.",
  },
  {
    id: "region",
    label: "국가 배분",
    blurb: "미국 60 · 유럽 10 · 일본 10 · 중국 10 · 한국 10.",
  },
];

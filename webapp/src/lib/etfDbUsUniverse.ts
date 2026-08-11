/**
 * US equity sector/theme ETF universe (no bonds / EM country baskets).
 * Ordered roughly by typical AUM within each group; live sort is by Yahoo AUM.
 * Types live here to avoid a circular import with etfDbUs.ts.
 */

export type UsUniverseMeta = {
  symbol: string;
  name: string;
  type: string;
  region: string;
  sector: string;
  theme: string;
  watch?: boolean;
};

export const US_ETF_UNIVERSE_RAW: UsUniverseMeta[] = [
  // —— US market beta (largest) ——
  { symbol: "SPY", name: "SPDR S&P 500", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "IVV", name: "iShares Core S&P 500", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "VOO", name: "Vanguard S&P 500", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "VTI", name: "Vanguard Total Stock", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "전체시장" },
  { symbol: "QQQ", name: "Invesco QQQ", type: "미국 시장지수", region: "미국", sector: "IT", theme: "나스닥100" },
  { symbol: "IWM", name: "iShares Russell 2000", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "소형주" },
  { symbol: "DIA", name: "SPDR Dow Jones", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "IJH", name: "iShares Core S&P Mid-Cap", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "중형주" },
  { symbol: "IJR", name: "iShares Core S&P Small-Cap", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "소형주" },
  { symbol: "MDY", name: "SPDR S&P MidCap 400", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "중형주" },
  { symbol: "RSP", name: "Invesco S&P 500 Equal Weight", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "SPLG", name: "SPDR Portfolio S&P 500", type: "미국 시장지수", region: "미국", sector: "시장지수", theme: "대형주" },
  { symbol: "QQQM", name: "Invesco NASDAQ 100", type: "미국 시장지수", region: "미국", sector: "IT", theme: "나스닥100" },

  // —— Style / factor ——
  { symbol: "VUG", name: "Vanguard Growth", type: "업종/테마", region: "미국", sector: "IT", theme: "성장" },
  { symbol: "VTV", name: "Vanguard Value", type: "업종/테마", region: "미국", sector: "금융", theme: "가치" },
  { symbol: "IWF", name: "iShares Russell 1000 Growth", type: "업종/테마", region: "미국", sector: "IT", theme: "성장" },
  { symbol: "IWD", name: "iShares Russell 1000 Value", type: "업종/테마", region: "미국", sector: "금융", theme: "가치" },
  { symbol: "QUAL", name: "iShares MSCI USA Quality", type: "업종/테마", region: "미국", sector: "시장지수", theme: "퀄리티" },
  { symbol: "MTUM", name: "iShares MSCI USA Momentum", type: "업종/테마", region: "미국", sector: "시장지수", theme: "모멘텀" },
  { symbol: "VLUE", name: "iShares MSCI USA Value Factor", type: "업종/테마", region: "미국", sector: "시장지수", theme: "가치" },
  { symbol: "USMV", name: "iShares MSCI USA Min Vol", type: "업종/테마", region: "미국", sector: "시장지수", theme: "저변동" },

  // —— GICS sector SPDRs / Vanguard ——
  { symbol: "XLK", name: "Technology Select", type: "업종/테마", region: "미국", sector: "IT", theme: "섹터" },
  { symbol: "VGT", name: "Vanguard Information Technology", type: "업종/테마", region: "미국", sector: "IT", theme: "섹터" },
  { symbol: "XLF", name: "Financial Select", type: "업종/테마", region: "미국", sector: "금융", theme: "섹터" },
  { symbol: "VFH", name: "Vanguard Financials", type: "업종/테마", region: "미국", sector: "금융", theme: "섹터" },
  { symbol: "XLV", name: "Health Care Select", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "섹터" },
  { symbol: "VHT", name: "Vanguard Health Care", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "섹터" },
  { symbol: "XLE", name: "Energy Select", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "VDE", name: "Vanguard Energy", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "XLI", name: "Industrial Select", type: "업종/테마", region: "미국", sector: "산업재", theme: "섹터" },
  { symbol: "VIS", name: "Vanguard Industrials", type: "업종/테마", region: "미국", sector: "산업재", theme: "섹터" },
  { symbol: "XLY", name: "Consumer Discretionary Select", type: "업종/테마", region: "미국", sector: "경기소비재", theme: "섹터" },
  { symbol: "VCR", name: "Vanguard Consumer Discretionary", type: "업종/테마", region: "미국", sector: "경기소비재", theme: "섹터" },
  { symbol: "XLP", name: "Consumer Staples Select", type: "업종/테마", region: "미국", sector: "필수소비재", theme: "섹터" },
  { symbol: "VDC", name: "Vanguard Consumer Staples", type: "업종/테마", region: "미국", sector: "필수소비재", theme: "섹터" },
  { symbol: "XLU", name: "Utilities Select", type: "업종/테마", region: "미국", sector: "유틸리티", theme: "섹터" },
  { symbol: "VPU", name: "Vanguard Utilities", type: "업종/테마", region: "미국", sector: "유틸리티", theme: "섹터" },
  { symbol: "XLB", name: "Materials Select", type: "업종/테마", region: "미국", sector: "소재", theme: "섹터" },
  { symbol: "VAW", name: "Vanguard Materials", type: "업종/테마", region: "미국", sector: "소재", theme: "섹터" },
  { symbol: "XLC", name: "Communication Services Select", type: "업종/테마", region: "미국", sector: "커뮤니케이션", theme: "섹터" },
  { symbol: "VOX", name: "Vanguard Communication Services", type: "업종/테마", region: "미국", sector: "커뮤니케이션", theme: "섹터" },
  { symbol: "XLRE", name: "Real Estate Select", type: "업종/테마", region: "미국", sector: "부동산", theme: "리츠" },
  { symbol: "VNQ", name: "Vanguard Real Estate", type: "업종/테마", region: "미국", sector: "부동산", theme: "리츠" },
  { symbol: "IYR", name: "iShares U.S. Real Estate", type: "업종/테마", region: "미국", sector: "부동산", theme: "리츠" },

  // —— Semiconductors / tech themes ——
  { symbol: "SMH", name: "VanEck Semiconductor", type: "업종/테마", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "SOXX", name: "iShares Semiconductor", type: "업종/테마", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "SOXQ", name: "Invesco PHLX Semiconductor", type: "업종/테마", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "XSD", name: "SPDR S&P Semiconductor", type: "업종/테마", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "PSI", name: "Invesco Semiconductors", type: "업종/테마", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "SOXL", name: "Direxion Daily Semiconductors Bull 3X", type: "파생", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "NVDL", name: "GraniteShares 2x Long NVDA", type: "파생", region: "미국", sector: "IT", theme: "반도체" },
  { symbol: "TQQQ", name: "ProShares UltraPro QQQ", type: "파생", region: "미국", sector: "IT", theme: "나스닥100" },
  { symbol: "FTEC", name: "Fidelity MSCI Information Tech", type: "업종/테마", region: "미국", sector: "IT", theme: "섹터" },
  { symbol: "IYW", name: "iShares U.S. Technology", type: "업종/테마", region: "미국", sector: "IT", theme: "섹터" },
  { symbol: "IGV", name: "iShares Expanded Tech-Software", type: "업종/테마", region: "미국", sector: "IT", theme: "소프트웨어" },
  { symbol: "WCLD", name: "WisdomTree Cloud Computing", type: "업종/테마", region: "미국", sector: "IT", theme: "클라우드" },
  { symbol: "SKYY", name: "First Trust Cloud Computing", type: "업종/테마", region: "미국", sector: "IT", theme: "클라우드" },
  { symbol: "CLOU", name: "Global X Cloud Computing", type: "업종/테마", region: "미국", sector: "IT", theme: "클라우드" },
  { symbol: "HACK", name: "ETFMG Prime Cyber Security", type: "업종/테마", region: "미국", sector: "IT", theme: "사이버보안" },
  { symbol: "CIBR", name: "First Trust NASDAQ Cybersecurity", type: "업종/테마", region: "미국", sector: "IT", theme: "사이버보안" },
  { symbol: "BUG", name: "Global X Cybersecurity", type: "업종/테마", region: "미국", sector: "IT", theme: "사이버보안" },
  { symbol: "BOTZ", name: "Global X Robotics & AI", type: "업종/테마", region: "미국", sector: "IT", theme: "AI·로봇" },
  { symbol: "AIQ", name: "Global X Artificial Intelligence", type: "업종/테마", region: "미국", sector: "IT", theme: "AI·로봇" },
  { symbol: "ROBT", name: "First Trust Nasdaq AI & Robotics", type: "업종/테마", region: "미국", sector: "IT", theme: "AI·로봇" },
  { symbol: "IRBO", name: "iShares Robotics & AI", type: "업종/테마", region: "미국", sector: "IT", theme: "AI·로봇" },
  { symbol: "WTAI", name: "WisdomTree AI & Innovation", type: "업종/테마", region: "미국", sector: "IT", theme: "AI·로봇" },
  { symbol: "CHAT", name: "Roundhill Generative AI & Tech", type: "업종/테마", region: "미국", sector: "IT", theme: "AI·로봇" },
  { symbol: "MAGS", name: "Roundhill Magnificent Seven", type: "업종/테마", region: "미국", sector: "IT", theme: "메가캡" },
  { symbol: "ARKK", name: "ARK Innovation", type: "업종/테마", region: "미국", sector: "IT", theme: "혁신·액티브" },
  { symbol: "ARKQ", name: "ARK Autonomous Tech & Robotics", type: "업종/테마", region: "미국", sector: "IT", theme: "혁신·액티브" },
  { symbol: "ARKW", name: "ARK Next Generation Internet", type: "업종/테마", region: "미국", sector: "IT", theme: "혁신·액티브" },
  { symbol: "ARKG", name: "ARK Genomic Revolution", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "바이오" },
  { symbol: "ARKF", name: "ARK Fintech Innovation", type: "업종/테마", region: "미국", sector: "금융", theme: "핀테크" },
  { symbol: "FINX", name: "Global X FinTech", type: "업종/테마", region: "미국", sector: "금융", theme: "핀테크" },
  { symbol: "IPAY", name: "ETFMG Prime Mobile Payments", type: "업종/테마", region: "미국", sector: "금융", theme: "핀테크" },
  { symbol: "KBWB", name: "Invesco KBW Bank", type: "업종/테마", region: "미국", sector: "금융", theme: "은행" },

  // —— Biotech / healthcare themes ——
  { symbol: "XBI", name: "SPDR S&P Biotech", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "바이오" },
  { symbol: "IBB", name: "iShares Biotechnology", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "바이오" },
  { symbol: "LABU", name: "Direxion Daily S&P Biotech Bull 3X", type: "파생", region: "미국", sector: "헬스케어", theme: "바이오" },
  { symbol: "IHI", name: "iShares U.S. Medical Devices", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "의료기기" },
  { symbol: "XPH", name: "SPDR S&P Pharmaceuticals", type: "업종/테마", region: "미국", sector: "헬스케어", theme: "제약" },

  // —— Energy / oil ——
  { symbol: "XOP", name: "SPDR Oil & Gas Exploration", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "OIH", name: "VanEck Oil Services", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "USO", name: "United States Oil Fund", type: "원자재", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "BNO", name: "United States Brent Oil", type: "원자재", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "UNG", name: "United States Natural Gas", type: "원자재", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "FCG", name: "First Trust Natural Gas", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지", watch: true },
  { symbol: "AMLP", name: "Alerian MLP", type: "업종/테마", region: "미국", sector: "에너지", theme: "원유·에너지" },

  // —— Clean energy / nuclear ——
  { symbol: "ICLN", name: "iShares Global Clean Energy", type: "업종/테마", region: "미국", sector: "유틸리티", theme: "클린에너지" },
  { symbol: "TAN", name: "Invesco Solar", type: "업종/테마", region: "미국", sector: "유틸리티", theme: "클린에너지" },
  { symbol: "QCLN", name: "First Trust NASDAQ Clean Edge", type: "업종/테마", region: "미국", sector: "유틸리티", theme: "클린에너지" },
  { symbol: "NLR", name: "VanEck Uranium & Nuclear", type: "업종/테마", region: "미국", sector: "유틸리티", theme: "원전·우라늄", watch: true },
  { symbol: "URA", name: "Global X Uranium", type: "업종/테마", region: "미국", sector: "에너지", theme: "원전·우라늄", watch: true },
  { symbol: "URNM", name: "Sprott Uranium Miners", type: "업종/테마", region: "미국", sector: "에너지", theme: "원전·우라늄", watch: true },
  { symbol: "URAN", name: "Themes Uranium & Nuclear", type: "업종/테마", region: "미국", sector: "에너지", theme: "원전·우라늄", watch: true },

  // —— Precious metals / miners ——
  { symbol: "GLD", name: "SPDR Gold Shares", type: "원자재", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "IAU", name: "iShares Gold Trust", type: "원자재", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "GLDM", name: "SPDR Gold MiniShares", type: "원자재", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "SGOL", name: "abrdn Physical Gold", type: "원자재", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "SLV", name: "iShares Silver Trust", type: "원자재", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "SIVR", name: "abrdn Physical Silver", type: "원자재", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "GDX", name: "VanEck Gold Miners", type: "업종/테마", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "GDXJ", name: "VanEck Junior Gold Miners", type: "업종/테마", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "SIL", name: "Global X Silver Miners", type: "업종/테마", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "PPLT", name: "abrdn Physical Platinum", type: "원자재", region: "미국", sector: "소재", theme: "귀금속", watch: true },
  { symbol: "PALL", name: "abrdn Physical Palladium", type: "원자재", region: "미국", sector: "소재", theme: "귀금속", watch: true },

  // —— Strategic metals / rare earth ——
  { symbol: "REMX", name: "VanEck Rare Earth/Strategic Metals", type: "업종/테마", region: "미국", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "LIT", name: "Global X Lithium & Battery Tech", type: "업종/테마", region: "미국", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "SETM", name: "Sprott Critical Materials", type: "업종/테마", region: "미국", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "COPX", name: "Global X Copper Miners", type: "업종/테마", region: "미국", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "XME", name: "SPDR S&P Metals & Mining", type: "업종/테마", region: "미국", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "PICK", name: "iShares MSCI Global Metals & Mining", type: "업종/테마", region: "미국", sector: "소재", theme: "희토류·전략금속", watch: true },
  { symbol: "BATT", name: "Amplify Lithium & Battery Tech", type: "업종/테마", region: "미국", sector: "소재", theme: "희토류·전략금속", watch: true },

  // —— Defense / aerospace / shipping ——
  { symbol: "ITA", name: "iShares U.S. Aerospace & Defense", type: "업종/테마", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "PPA", name: "Invesco Aerospace & Defense", type: "업종/테마", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "XAR", name: "SPDR S&P Aerospace & Defense", type: "업종/테마", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "SHLD", name: "Global X Defense Tech", type: "업종/테마", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "NATO", name: "Themes Transatlantic Defense", type: "업종/테마", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "DFEN", name: "Direxion Daily Aerospace & Defense Bull 3X", type: "파생", region: "미국", sector: "산업재", theme: "방산", watch: true },
  { symbol: "JETS", name: "U.S. Global Jets", type: "업종/테마", region: "미국", sector: "산업재", theme: "항공·운송" },
  { symbol: "IYT", name: "iShares Transportation Average", type: "업종/테마", region: "미국", sector: "산업재", theme: "항공·운송" },
  { symbol: "BWET", name: "Breakwave Tanker Shipping", type: "업종/테마", region: "미국", sector: "산업재", theme: "전쟁·해운", watch: true },
  { symbol: "BDRY", name: "Breakwave Dry Bulk Shipping", type: "업종/테마", region: "미국", sector: "산업재", theme: "전쟁·해운", watch: true },
  { symbol: "BOAT", name: "SonicShares Global Shipping", type: "업종/테마", region: "미국", sector: "산업재", theme: "전쟁·해운", watch: true },
  { symbol: "SEA", name: "U.S. Global Sea to Sky Cargo", type: "업종/테마", region: "미국", sector: "산업재", theme: "전쟁·해운", watch: true },

  // —— Banks / regional / brokers ——
  { symbol: "KRE", name: "SPDR S&P Regional Banking", type: "업종/테마", region: "미국", sector: "금융", theme: "은행" },
  { symbol: "KBE", name: "SPDR S&P Bank", type: "업종/테마", region: "미국", sector: "금융", theme: "은행" },
  { symbol: "IAI", name: "iShares U.S. Broker-Dealers", type: "업종/테마", region: "미국", sector: "금융", theme: "증권" },

  // —— Homebuilders / retail / consumer ——
  { symbol: "XHB", name: "SPDR S&P Homebuilders", type: "업종/테마", region: "미국", sector: "경기소비재", theme: "주택" },
  { symbol: "ITB", name: "iShares U.S. Home Construction", type: "업종/테마", region: "미국", sector: "경기소비재", theme: "주택" },
  { symbol: "XRT", name: "SPDR S&P Retail", type: "업종/테마", region: "미국", sector: "경기소비재", theme: "리테일" },
  { symbol: "PEJ", name: "Invesco Dynamic Leisure & Ent", type: "업종/테마", region: "미국", sector: "경기소비재", theme: "레저" },

  // —— Dividend / income equities ——
  { symbol: "SCHD", name: "Schwab US Dividend Equity", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "VIG", name: "Vanguard Dividend Appreciation", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "VYM", name: "Vanguard High Dividend Yield", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "DGRO", name: "iShares Core Dividend Growth", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "DVY", name: "iShares Select Dividend", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "HDV", name: "iShares Core High Dividend", type: "업종/테마", region: "미국", sector: "배당", theme: "배당" },
  { symbol: "JEPI", name: "JPMorgan Equity Premium Income", type: "업종/테마", region: "미국", sector: "배당", theme: "커버드콜" },
  { symbol: "JEPQ", name: "JPMorgan Nasdaq Equity Premium", type: "업종/테마", region: "미국", sector: "배당", theme: "커버드콜" },
  { symbol: "QYLD", name: "Global X NASDAQ 100 Covered Call", type: "업종/테마", region: "미국", sector: "배당", theme: "커버드콜" },
  { symbol: "XYLD", name: "Global X S&P 500 Covered Call", type: "업종/테마", region: "미국", sector: "배당", theme: "커버드콜" },
];

/** Deduplicate by symbol (first wins). */
export function uniqueUsUniverse(): UsUniverseMeta[] {
  const seen = new Set<string>();
  const out: UsUniverseMeta[] = [];
  for (const row of US_ETF_UNIVERSE_RAW) {
    const sym = row.symbol.toUpperCase();
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push({ ...row, symbol: sym, region: "미국" });
  }
  return out;
}

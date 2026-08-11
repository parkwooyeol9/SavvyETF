/**
 * Classify US equity ETF names into type / region / sector / theme.
 * Keyword heuristics — good enough for monitoring taxonomy.
 */

export type UsEtfClass = {
  type: string;
  region: string;
  sector: string;
  theme: string;
  watch?: boolean;
};

const NON_EQUITY =
  /\b(bond|bonds|treasury|treasuries|fixed\s*income|municipal|muni\b|t-?bill|tbill|aggregate\s+bond|corp(?:orate)?\s+bond|ultrashort|ultra[\s-]*short|short[\s-]*term\s+inflation|short\s*duration|intermediate\s*duration|long\s*duration|\btips\b|inflation[\s-]*protected|high\s*yield\s*bond|junk\s*bond|preferred\s*stock|preferred\s*securities|convertible\s*bond|\bclo\s|\bloan\b|floating\s*rate|money\s*market|\bcash\b|currency|currencies|bitcoin|ether(?:eum)?|\bcrypto\b|blockchain\s*economy|digital\s*asset|physical\s*gold|physical\s*silver|physical\s*platinum|physical\s*palladium|gold\s*shares|silver\s*trust|oil\s*fund|brent\s*oil|natural\s*gas\s*fund|commodity\s*index|broad\s*commodit|agriculture\s*fund|wheat\s*fund|corn\s*fund|soybean|mortgage[\s-]*backed|\bmbs\b|enhanced\s*short\s*maturity|ultra[\s-]*short\s+income|flexible\s*income\s*active|1[\s-]*3\s*month\s*box|box\s*etf)\b/i;

const LEVERAGED =
  /\b(\d+x|ultra(?:pro)?|direxion|graniteshares\s+\d|tradr\s+\d|t-?rex|leverage\s*shares|bull\s+\d|bear\s+\d|daily\s+target|2x|3x|-1x|inverse|short\s+(?!vol))\b/i;

type Rule = { re: RegExp; sector: string; theme: string; type?: string; region?: string; watch?: boolean };

const RULES: Rule[] = [
  // Mega / indices
  { re: /\b(s&p\s*500|sp\s*500|sp500|s&p\s*100)\b/i, sector: "시장지수", theme: "대형주", type: "미국 시장지수" },
  { re: /\b(nasdaq[\s-]*100|ndx)\b/i, sector: "IT", theme: "나스닥100", type: "미국 시장지수" },
  { re: /\b(dow\s*jones|djia)\b/i, sector: "시장지수", theme: "대형주", type: "미국 시장지수" },
  { re: /\brussell\s*2000\b/i, sector: "시장지수", theme: "소형주", type: "미국 시장지수" },
  { re: /\brussell\s*1000\b/i, sector: "시장지수", theme: "대형주", type: "미국 시장지수" },
  { re: /\brussell\s*3000\b/i, sector: "시장지수", theme: "전체시장", type: "미국 시장지수" },
  { re: /\b(total\s*stock|total\s*market|wilshire|crsp\s*us\s*total|broad\s*market|extended\s*market|core\s*equity)\b/i, sector: "시장지수", theme: "전체시장", type: "미국 시장지수" },
  { re: /\b(mid[\s-]*cap|midcap|s&p\s*400)\b/i, sector: "시장지수", theme: "중형주", type: "미국 시장지수" },
  { re: /\b(small[\s-]*cap|smallcap|s&p\s*600)\b/i, sector: "시장지수", theme: "소형주", type: "미국 시장지수" },
  { re: /\b(large[\s-]*cap|large\s*company)\b/i, sector: "시장지수", theme: "대형주", type: "미국 시장지수" },
  { re: /\bequal\s*weight\b/i, sector: "시장지수", theme: "대형주", type: "미국 시장지수" },
  { re: /\b(esg|sustainable|socially\s*responsible)\b/i, sector: "시장지수", theme: "ESG" },
  { re: /\b(infrastructure|infrastruct)\b/i, sector: "산업재", theme: "인프라" },

  // Factors
  { re: /\bgrowth\b/i, sector: "IT", theme: "성장" },
  { re: /\bvalue\b/i, sector: "금융", theme: "가치" },
  { re: /\bmomentum\b/i, sector: "시장지수", theme: "모멘텀" },
  { re: /\bquality\b/i, sector: "시장지수", theme: "퀄리티" },
  { re: /\b(min(?:imum)?\s*vol|low\s*vol|low\s*volatility)\b/i, sector: "시장지수", theme: "저변동" },
  { re: /\b(dividend|high\s*dividend|dividend\s*aristocrat|dividend\s*growth)\b/i, sector: "배당", theme: "배당" },
  { re: /\b(covered\s*call|equity\s*premium|buywrite|option\s*income|income\s*strategy)\b/i, sector: "배당", theme: "커버드콜" },
  { re: /\b(buffer|defined\s*outcome|collar|protective)\b/i, sector: "시장지수", theme: "버퍼·프로텍트" },

  // Tech themes
  { re: /\b(semiconductor|semiconductors|chip|chips|phlx\s*semi)\b/i, sector: "IT", theme: "반도체" },
  { re: /\b(artificial\s*intelligence|\bai\b|robotics|robot|machine\s*learning)\b/i, sector: "IT", theme: "AI·로봇" },
  { re: /\b(cloud\s*comput|software|saas|cyber\s*secur|cybersecur)\b/i, sector: "IT", theme: "소프트웨어" },
  { re: /\b(cloud)\b/i, sector: "IT", theme: "클라우드" },
  { re: /\b(cyber)\b/i, sector: "IT", theme: "사이버보안" },
  { re: /\b(internet|next\s*gen(?:eration)?\s*internet|digital\s*transformation)\b/i, sector: "IT", theme: "인터넷" },
  { re: /\b(magnificent|mega[\s-]*cap\s*tech|fang|big\s*tech)\b/i, sector: "IT", theme: "메가캡" },
  { re: /\b(fintech|mobile\s*payment|payments)\b/i, sector: "금융", theme: "핀테크" },
  { re: /\b(innovation|disruptive|ark)\b/i, sector: "IT", theme: "혁신·액티브" },

  // Healthcare
  { re: /\b(biotech|genomic|genomics)\b/i, sector: "헬스케어", theme: "바이오" },
  { re: /\b(pharma|pharmaceutical)\b/i, sector: "헬스케어", theme: "제약" },
  { re: /\b(medical\s*device|health\s*care\s*equipment)\b/i, sector: "헬스케어", theme: "의료기기" },
  { re: /\b(health\s*care|healthcare|health)\b/i, sector: "헬스케어", theme: "업종대표" },

  // Energy / materials / defense
  { re: /\b(uranium|nuclear)\b/i, sector: "에너지", theme: "원전·우라늄", watch: true },
  { re: /\b(oil|gas|energy|mlp|exploration|oil\s*service)\b/i, sector: "에너지", theme: "원유·에너지", watch: true },
  { re: /\b(clean\s*energy|solar|wind|renewable)\b/i, sector: "유틸리티", theme: "클린에너지" },
  { re: /\b(rare\s*earth|lithium|copper\s*miner|critical\s*material|strategic\s*metal|battery\s*tech|metals?\s*&\s*mining)\b/i, sector: "소재", theme: "희토류·전략금속", watch: true },
  { re: /\b(gold\s*miner|silver\s*miner|junior\s*gold|precious\s*metal)\b/i, sector: "소재", theme: "귀금속", watch: true },
  { re: /\b(aerospace|defense|defence)\b/i, sector: "산업재", theme: "방산", watch: true },
  { re: /\b(tanker|shipping|dry\s*bulk|maritime|sea\s*to\s*sky)\b/i, sector: "산업재", theme: "전쟁·해운", watch: true },
  { re: /\b(airline|aviation|transport|jets)\b/i, sector: "산업재", theme: "항공·운송" },

  // GICS-ish
  { re: /\b(information\s*technology|technology|tech\b)\b/i, sector: "IT", theme: "업종대표" },
  { re: /\b(financials?|bank|broker|insurance|capital\s*markets)\b/i, sector: "금융", theme: "업종대표" },
  { re: /\b(regional\s*bank)\b/i, sector: "금융", theme: "은행" },
  { re: /\b(industrials?|manufactur)\b/i, sector: "산업재", theme: "업종대표" },
  { re: /\b(consumer\s*discretionary|retail|homebuilder|home\s*construction|leisure|restaurant)\b/i, sector: "경기소비재", theme: "업종대표" },
  { re: /\b(consumer\s*staples|consumer\s*defensive)\b/i, sector: "필수소비재", theme: "업종대표" },
  { re: /\b(utilit(?:y|ies))\b/i, sector: "유틸리티", theme: "업종대표" },
  { re: /\b(materials?|mining|steel|chemical)\b/i, sector: "소재", theme: "업종대표" },
  { re: /\b(communication\s*services?|media|telecom)\b/i, sector: "커뮤니케이션", theme: "업종대표" },
  { re: /\b(real\s*estate|reit)\b/i, sector: "부동산", theme: "리츠" },

  // International
  { re: /\b(emerging\s*market|emerging\s*index|em\s*ex|msci\s*em|ftse\s*emerging)\b/i, sector: "해외주식", theme: "신흥국", region: "해외" },
  { re: /\b(developed\s*market|eafe|europe|eurozone|euro\s*stoxx|ftse\s*developed|ftse\s*european|ftse\s*100|germany|uk\b|japan|china|india|korea|taiwan|brazil|mexico|canada|australia|asia\s*ex|pacific|international|world\s*ex|all[\s-]*w(?:orld|ld)|acwi|all\s*country)\b/i, sector: "해외주식", theme: "선진·글로벌", region: "해외" },
];

export function isLikelyEquityEtf(name: string, symbol?: string): boolean {
  const n = name || "";
  if (!n.trim()) return false;
  if (NON_EQUITY.test(n)) return false;
  const sym = (symbol || "").toUpperCase();
  // Common short-duration / MBS / TIPS tickers whose names sometimes omit keywords
  if (
    /^(BIL|SGOV|JPST|MINT|ICSH|NEAR|SHV|SHY|VGSH|SCHO|TBIL|CLIP|BOXX|VTIP|SCHR|VGIT|IEF|TLH|TLT|EDV|ZROZ|MBB|VMBS|SPMB|JPIE|BINC|PULS|FTSM|GSY)$/.test(
      sym,
    )
  ) {
    return false;
  }
  return true;
}

export function classifyUsEtf(name: string, symbol?: string): UsEtfClass {
  const n = name || "";
  const leveraged = LEVERAGED.test(n);
  let hit: Rule | undefined;
  for (const rule of RULES) {
    if (rule.re.test(n)) {
      hit = rule;
      break;
    }
  }

  // Memory / DRAM → semiconductor bucket
  if (!hit && /\b(memory|dram|hbm)\b/i.test(n)) {
    hit = {
      re: /.*/,
      sector: "IT",
      theme: "반도체",
    };
  }

  const sector = hit?.sector || "기타";
  const theme = hit?.theme || (leveraged ? "레버리지·인버스" : "기타");
  const region = hit?.region || "미국";
  let type = hit?.type || "업종/테마";
  if (leveraged) type = "파생";
  if (!hit && /total\s*world|global\s*equity|world\s*stock/i.test(n)) {
    return {
      type: "업종/테마",
      region: "해외",
      sector: "해외주식",
      theme: "선진·글로벌",
    };
  }

  // Broad US market without specific theme words
  if (
    !hit &&
    /\b(us\s*equity|u\.s\.\s*equity|american\s*equity|equity\s*etf|stock\s*market)\b/i.test(n)
  ) {
    return {
      type: leveraged ? "파생" : "미국 시장지수",
      region: "미국",
      sector: "시장지수",
      theme: leveraged ? "레버리지·인버스" : "전체시장",
    };
  }

  return {
    type,
    region,
    sector,
    theme,
    watch: hit?.watch,
  };
}

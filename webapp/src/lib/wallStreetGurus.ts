/**
 * Wall Street gurus — curated roster + public-headline ideas for the 월가 구루 tab.
 * Hedge-fund cards are ordered by approximate AUM (desc). Headlines come from
 * public Google News RSS (incl. MarketWatch / major wires when indexed).
 */

export type GuruCategory = "investor" | "hedge_fund" | "analyst";

export type GuruProfile = {
  id: string;
  name: string;
  name_ko: string;
  firm: string;
  category: GuruCategory;
  /** Approximate firm AUM in USD billions; used to sort hedge-fund section */
  aum_usd_bn: number | null;
  aum_note: string;
  style: string;
  style_ko: string;
  /** Terms that must appear for a headline to count for this guru */
  match_terms: string[];
  /** Google News query fragment */
  search_q: string;
  /** Analyst watchlist metadata */
  expertise?: string;
  expertise_ko?: string;
  why_follow?: string;
  why_follow_ko?: string;
  best_source?: string;
  frequency?: string;
  frequency_ko?: string;
  /** Short public-credential note after verification */
  verified_note?: string;
};

export type GuruHeadline = {
  id: string;
  guru_id: string;
  title: string;
  link?: string;
  source: string;
  published?: string;
  published_ms: number | null;
  attention_score: number;
  why: string;
};

export type GuruDesk = {
  guru: GuruProfile;
  ideas: GuruHeadline[];
};

export type WallStreetGurusPayload = {
  ok: boolean;
  generated_at: string;
  /** KST calendar date of the 07:00 briefing window */
  as_of_kst: string;
  schedule_note: string;
  disclaimer: string;
  methodology: string[];
  summary: string[];
  highlighted: GuruHeadline[];
  hedge_funds: GuruDesk[];
  investors: GuruDesk[];
  /** Non-PM finance voices (macro, valuation, markets commentary) */
  watchlist: GuruDesk[];
  roster: GuruProfile[];
  sources_note: string;
  error?: string;
};

export const GURU_SCHEDULE_NOTE =
  "한국시간 매일 07:00 브리핑 기준 · 공개 헤드라인(Google News / MarketWatch 등) 중 주목·트래픽성 기사 우선";

export const GURU_DISCLAIMER =
  "공개 발언·보도 요약이며 투자 권유·자문이 아닙니다. AUM은 공개 추정치이며 수시 변동합니다.";

export const GURU_METHODOLOGY: string[] = [
  "구루 명단: 버핏·그랜섬 등 유명 투자자 + 운용자산(AUM) 기준 주요 헷지펀드 매니저",
  "헷지펀드 섹션: 추정 AUM 내림차순 → 최근 공개 발언·보도 정리",
  "워치리스트: 펀드매니저가 아닌 매크로·밸류에이션·시장구조 공개 코멘테이터 (경력 검증 후 등재)",
  "수집: Google News RSS (when:7d) · MarketWatch/Bloomberg/CNBC/WSJ/FT 등 출처 가중",
  "스코어: 최신성 + 출처 권위 + 제목의 투자 키워드(매수·경고·포지션 등)",
];

/**
 * Curated roster. Hedge-fund AUM figures are approximate public estimates
 * (2025–2026 industry roundups) for relative ranking only.
 */
export const GURU_ROSTER: GuruProfile[] = [
  {
    id: "buffett",
    name: "Warren Buffett",
    name_ko: "워렌 버핏",
    firm: "Berkshire Hathaway",
    category: "investor",
    aum_usd_bn: null,
    aum_note: "버크셔 시총·현금 (헷지펀드 AUM 아님)",
    style: "Value / long-term compounder",
    style_ko: "가치투자 · 장기 복리",
    match_terms: [
      "buffett",
      "berkshire",
      "brk",
      "oracle of omaha",
      "버핏",
      "버크셔",
    ],
    search_q: '"Warren Buffett" OR "Berkshire Hathaway" OR Buffett',
  },
  {
    id: "grantham",
    name: "Jeremy Grantham",
    name_ko: "제레미 그랜섬",
    firm: "GMO",
    category: "investor",
    aum_usd_bn: null,
    aum_note: "GMO 운용 자산 (장기 자산운용사)",
    style: "Bubble watch / value",
    style_ko: "버블 경계 · 가치",
    match_terms: ["grantham", "gmo", "그랜섬"],
    search_q: '"Jeremy Grantham" OR "Grantham" GMO',
  },
  {
    id: "dalio",
    name: "Ray Dalio",
    name_ko: "레이 달리오",
    firm: "Bridgewater Associates",
    category: "hedge_fund",
    aum_usd_bn: 120,
    aum_note: "추정 ~$120B (Bridgewater)",
    style: "Global macro / risk parity",
    style_ko: "글로벌 매크로 · 리스크 패리티",
    match_terms: [
      "dalio",
      "bridgewater associates",
      "pure alpha",
      "all weather",
      "달리오",
      "브리지워터",
    ],
    search_q: '"Ray Dalio" OR "Bridgewater Associates" OR "Pure Alpha"',
  },
  {
    id: "englander",
    name: "Izzy Englander",
    name_ko: "이지 잉글랜더",
    firm: "Millennium Management",
    category: "hedge_fund",
    aum_usd_bn: 75,
    aum_note: "추정 ~$70–80B (Millennium)",
    style: "Multi-strategy platform",
    style_ko: "멀티스트래티지",
    match_terms: ["millennium management", "izzy englander", "englander"],
    search_q: '"Millennium Management" OR "Izzy Englander" hedge fund',
  },
  {
    id: "singer",
    name: "Paul Singer",
    name_ko: "폴 싱어",
    firm: "Elliott Investment Management",
    category: "hedge_fund",
    aum_usd_bn: 70,
    aum_note: "추정 ~$70B+ (Elliott)",
    style: "Activist / multi-strategy",
    style_ko: "액티비스트 · 멀티",
    match_terms: ["paul singer", "elliott investment", "elliott management", "싱어"],
    search_q: '"Paul Singer" OR "Elliott Investment" OR "Elliott Management"',
  },
  {
    id: "griffin",
    name: "Ken Griffin",
    name_ko: "켄 그리핀",
    firm: "Citadel",
    category: "hedge_fund",
    aum_usd_bn: 65,
    aum_note: "추정 ~$65B (Citadel)",
    style: "Multi-strategy / market making",
    style_ko: "멀티스트래티지 · 마켓메이킹",
    match_terms: ["ken griffin", "citadel", "griffin", "그리핀", "시타델"],
    search_q: '"Ken Griffin" OR Citadel LLC OR "Citadel" hedge',
  },
  {
    id: "cohen",
    name: "Steve Cohen",
    name_ko: "스티브 코헨",
    firm: "Point72",
    category: "hedge_fund",
    aum_usd_bn: 50,
    aum_note: "추정 ~$45–55B (Point72)",
    style: "Multi-manager / equity",
    style_ko: "멀티매니저 · 주식",
    match_terms: ["steve cohen", "point72", "sac capital", "코헨"],
    search_q: '"Steve Cohen" OR Point72 OR "Point 72"',
  },
  {
    id: "simons",
    name: "Jim Simons / Renaissance",
    name_ko: "짐 사이먼스 · 르네상스",
    firm: "Renaissance Technologies",
    category: "hedge_fund",
    aum_usd_bn: 46,
    aum_note: "추정 ~$45B+ (Renaissance; Medallion 별도)",
    style: "Quantitative / systematic",
    style_ko: "퀀트 · 시스템",
    match_terms: [
      "jim simons",
      "renaissance technologies",
      "medallion",
      "사이먼스",
      "르네상스",
    ],
    search_q: '"Renaissance Technologies" OR "Jim Simons" OR Medallion fund',
  },
  {
    id: "ackman",
    name: "Bill Ackman",
    name_ko: "빌 애크먼",
    firm: "Pershing Square",
    category: "hedge_fund",
    aum_usd_bn: 18,
    aum_note: "추정 ~$15–20B (Pershing Square)",
    style: "Activist / concentrated",
    style_ko: "액티비스트 · 집중",
    match_terms: ["bill ackman", "pershing square", "ackman", "애크먼", "퍼싱"],
    search_q: '"Bill Ackman" OR "Pershing Square"',
  },
  {
    id: "tepper",
    name: "David Tepper",
    name_ko: "데이비드 테퍼",
    firm: "Appaloosa Management",
    category: "hedge_fund",
    aum_usd_bn: 14,
    aum_note: "추정 ~$12–17B (Appaloosa)",
    style: "Distressed / opportunistic",
    style_ko: "부실채권 · 기회추구",
    match_terms: ["david tepper", "appaloosa", "tepper", "테퍼"],
    search_q: '"David Tepper" OR "Appaloosa Management"',
  },
  {
    id: "soros",
    name: "George Soros",
    name_ko: "조지 소로스",
    firm: "Soros Fund Management",
    category: "hedge_fund",
    aum_usd_bn: 8,
    aum_note: "추정 가족사무소 규모 (전성기 대비 축소)",
    style: "Macro / reflexive",
    style_ko: "매크로 · 반사성",
    match_terms: ["george soros", "soros fund", "소로스"],
    search_q: '"George Soros" OR "Soros Fund Management"',
  },
  {
    id: "druckenmiller",
    name: "Stanley Druckenmiller",
    name_ko: "스탠리 드러큰밀러",
    firm: "Duquesne Family Office",
    category: "investor",
    aum_usd_bn: null,
    aum_note: "패밀리오피스",
    style: "Macro / discretionary",
    style_ko: "매크로 · 재량",
    match_terms: ["druckenmiller", "duquesne", "드러큰밀러"],
    search_q: '"Stanley Druckenmiller" OR Druckenmiller',
  },
];

/**
 * Recommended core watchlist — finance careers verified via public bios
 * (Wharton/Allianz, NYU Stern, Oaktree, Bloomberg, FT, Carnegie, Schwab, Apollo, etc.).
 * Not ranked by AUM; commentary / research frequency oriented.
 */
export const FINANCE_WATCHLIST: GuruProfile[] = [
  {
    id: "galloway",
    name: "Scott Galloway",
    name_ko: "스콧 갤러웨이",
    firm: "NYU Stern · Pivot / Prof G",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Technology / consumer / business",
    style_ko: "테크·소비·비즈니스",
    expertise: "Technology, business, consumer trends",
    expertise_ko: "기술·비즈니스·소비 트렌드",
    why_follow: "Provocative interpretation of major business stories",
    why_follow_ko: "대형 비즈니스 이슈를 도발적으로 해석",
    best_source: "Pivot, Prof G Markets, Prof G Pod",
    frequency: "Several times weekly",
    frequency_ko: "주 수회",
    verified_note: "NYU Stern 마케팅 임상교수 · L2 창업자 · Pivot/Prof G 진행",
    match_terms: ["scott galloway", "prof g", "profg", "갤러웨이"],
    search_q: '"Scott Galloway" OR "Prof G" OR ProfG',
  },
  {
    id: "elerian",
    name: "Mohamed El-Erian",
    name_ko: "모하메드 엘에리언",
    firm: "Allianz · Wharton · Gramercy",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Macro / central banks / bonds",
    style_ko: "매크로·중앙은행·채권",
    expertise: "Macro, central banks, bonds",
    expertise_ko: "매크로·중앙은행·채권",
    why_follow:
      "Connects monetary policy, geopolitics and cross-asset markets exceptionally well",
    why_follow_ko: "통화정책·지정학·크로스에셋을 연결하는 해설",
    best_source: "FT, Bloomberg, LinkedIn, CNBC",
    frequency: "Almost daily",
    frequency_ko: "거의 매일",
    verified_note:
      "Wharton Practice Professor · Allianz Chief Economic Adviser · Gramercy Chair · 전 PIMCO CEO/co-CIO",
    match_terms: ["el-erian", "el erian", "elerian", "mohamed el", "엘에리언"],
    search_q: '"Mohamed El-Erian" OR "El-Erian" OR ElErian',
  },
  {
    id: "marks",
    name: "Howard Marks",
    name_ko: "하워드 막스",
    firm: "Oaktree Capital",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "Oaktree 공동창업 (워치리스트는 메모·코멘트 관점)",
    style: "Credit cycles / risk / psychology",
    style_ko: "신용사이클·리스크·심리",
    expertise: "Credit cycles, risk, investor psychology",
    expertise_ko: "신용 사이클·리스크·투자심리",
    why_follow:
      "One of the best sources on cycles and portfolio risk; fewer but highly valuable updates",
    why_follow_ko: "사이클·포트폴리오 리스크에 대한 고밀도 메모",
    best_source: 'Oaktree "Memos," The Insight podcast',
    frequency: "Monthly/irregular",
    frequency_ko: "월간·비정기",
    verified_note: "Oaktree Capital 공동창업자·공동회장 · 공개 Memo로 유명",
    match_terms: ["howard marks", "oaktree memo", "oaktree capital", "하워드 막스"],
    search_q: '"Howard Marks" OR "Oaktree" Marks memo',
  },
  {
    id: "damodaran",
    name: "Aswath Damodaran",
    name_ko: "아스와스 다모다란",
    firm: "NYU Stern",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Valuation / corporate finance",
    style_ko: "밸류에이션·기업금융",
    expertise: "Valuation, corporate finance",
    expertise_ko: "밸류에이션·기업금융",
    why_follow:
      "Best public voice for evaluating whether market narratives are reflected in valuation",
    why_follow_ko: "시장 내러티브를 밸류에이션으로 검증하는 공개 자료",
    best_source: "Musings on Markets, YouTube, X",
    frequency: "Weekly/irregular",
    frequency_ko: "주간·비정기",
    verified_note: "NYU Stern 재무학 교수 · 공개 밸류에이션 데이터·강의로 정평",
    match_terms: ["damodaran", "aswath", "다모다란"],
    search_q: '"Aswath Damodaran" OR Damodaran valuation',
  },
  {
    id: "levine",
    name: "Matt Levine",
    name_ko: "맷 레빈",
    firm: "Bloomberg Opinion",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Market structure / deals / regulation",
    style_ko: "시장구조·딜·규제",
    expertise: "Market structure, deals, regulation",
    expertise_ko: "시장 구조·딜·규제",
    why_follow: "Explains difficult financial mechanisms with unusual clarity",
    why_follow_ko: "복잡한 금융 메커니즘을 명료하게 설명",
    best_source: "Bloomberg Money Stuff",
    frequency: "Weekdays",
    frequency_ko: "평일",
    verified_note: "Bloomberg Opinion · 전 Goldman 은행가 · Wachtell M&A 변호사",
    match_terms: ["matt levine", "money stuff", "matthew levine", "맷 레빈"],
    search_q: '"Matt Levine" OR "Money Stuff" Bloomberg',
  },
  {
    id: "tooze",
    name: "Adam Tooze",
    name_ko: "아담 투즈",
    firm: "Columbia University",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Global political economy",
    style_ko: "글로벌 정치경제",
    expertise: "Global political economy",
    expertise_ko: "글로벌 정치경제",
    why_follow: "Strong synthesis of economics, history, geopolitics and financial systems",
    why_follow_ko: "경제·역사·지정학·금융을 종합",
    best_source: "Chartbook, Ones and Tooze",
    frequency: "Several times weekly",
    frequency_ko: "주 수회",
    verified_note: "Columbia Shelby Cullom Davis 석좌 · European Institute 소장",
    match_terms: ["adam tooze", "chartbook", "ones and tooze", "투즈"],
    search_q: '"Adam Tooze" OR Chartbook Tooze',
  },
  {
    id: "wolf",
    name: "Martin Wolf",
    name_ko: "마틴 울프",
    firm: "Financial Times",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Global economics and policy",
    style_ko: "글로벌 경제·정책",
    expertise: "Global economics and policy",
    expertise_ko: "글로벌 경제·정책",
    why_follow:
      "Institutional, long-term interpretation of trade, fiscal policy and democratic capitalism",
    why_follow_ko: "무역·재정·민주적 자본주의의 장기 해석",
    best_source: "Financial Times",
    frequency: "Weekly",
    frequency_ko: "주간",
    verified_note: "FT Chief Economics Commentator · CBE",
    match_terms: ["martin wolf", "마틴 울프"],
    search_q: '"Martin Wolf" "Financial Times" OR FT Wolf',
  },
  {
    id: "pettis",
    name: "Michael Pettis",
    name_ko: "마이클 페티스",
    firm: "Carnegie · Peking University",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "China / global imbalances",
    style_ko: "중국·글로벌 불균형",
    expertise: "China, global imbalances",
    expertise_ko: "중국·글로벌 불균형",
    why_follow:
      "Particularly valuable on Chinese debt, consumption, trade surpluses and capital flows",
    why_follow_ko: "중국 부채·소비·무역흑자·자본흐름",
    best_source: "X, Carnegie’s China Financial Markets",
    frequency: "Frequent",
    frequency_ko: "빈번",
    verified_note: "Carnegie China 비상주 선임연구원 · 베이징대 광화 재무 교수 · 전 Wall Street",
    match_terms: ["michael pettis", "pettis", "페티스"],
    search_q: '"Michael Pettis" OR Pettis China',
  },
  {
    id: "sharma",
    name: "Ruchir Sharma",
    name_ko: "루치르 샤르마",
    firm: "Rockefeller International",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Global / emerging markets",
    style_ko: "글로벌·신흥국",
    expertise: "Global markets, emerging markets",
    expertise_ko: "글로벌·신흥국 시장",
    why_follow:
      "Compares countries through growth, capital flows, valuations and political cycles",
    why_follow_ko: "성장·자본흐름·밸류·정치사이클로 국가 비교",
    best_source: "Financial Times, Rockefeller International",
    frequency: "Weekly",
    frequency_ko: "주간",
    verified_note: "Rockefeller International 회장 · 전 Morgan Stanley EM/글로벌 전략 헤드",
    match_terms: ["ruchir sharma", "rockefeller international", "샤르마"],
    search_q: '"Ruchir Sharma" OR "Rockefeller International" Sharma',
  },
  {
    id: "alden",
    name: "Lyn Alden",
    name_ko: "린 올든",
    firm: "Lyn Alden Investment Strategy",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Monetary systems / liquidity / crypto",
    style_ko: "통화·유동성·크립토",
    expertise: "Monetary systems, liquidity, crypto",
    expertise_ko: "통화제도·유동성·크립토",
    why_follow:
      "Detailed balance-sheet approach to liquidity, fiscal dominance, Bitcoin and energy",
    why_follow_ko: "유동성·재정우위·비트코인·에너지를 대차대조표로 분석",
    best_source: "Lyn Alden newsletter, X",
    frequency: "Frequent",
    frequency_ko: "빈번",
    verified_note: "독립 매크로·투자 애널리스트 · 공개 뉴스레터·리서치",
    match_terms: ["lyn alden", "린 올든"],
    search_q: '"Lyn Alden" OR "LynAlden"',
  },
  {
    id: "sonders",
    name: "Liz Ann Sonders",
    name_ko: "리즈 앤 손더스",
    firm: "Charles Schwab",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "US equities / economic data",
    style_ko: "미국 주식·경제지표",
    expertise: "US equities and economic data",
    expertise_ko: "미국 주식·경제 데이터",
    why_follow: "Data-rich, relatively measured market commentary",
    why_follow_ko: "데이터 중심의 절제된 시장 코멘트",
    best_source: "Charles Schwab, X, podcasts",
    frequency: "Almost daily",
    frequency_ko: "거의 매일",
    verified_note: "Charles Schwab Managing Director · Chief Investment Strategist",
    match_terms: ["liz ann sonders", "sonders", "손더스"],
    search_q: '"Liz Ann Sonders" OR Sonders Schwab',
  },
  {
    id: "bianco",
    name: "Jim Bianco",
    name_ko: "짐 비앙코",
    firm: "Bianco Research",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Bonds / inflation / market structure",
    style_ko: "채권·인플레·시장구조",
    expertise: "Bonds, inflation, market structure",
    expertise_ko: "채권·인플레이션·시장 구조",
    why_follow:
      "Useful real-time reading of Treasury yields, Fed expectations and financial plumbing",
    why_follow_ko: "국채·연준 기대·금융 배관의 실시간 해석",
    best_source: "Bianco Research, X, podcasts",
    frequency: "Daily",
    frequency_ko: "매일",
    verified_note: "Bianco Research 사장 · 매크로·채권 전략 애널리스트",
    match_terms: ["jim bianco", "bianco research", "비앙코"],
    search_q: '"Jim Bianco" OR "Bianco Research"',
  },
  {
    id: "slok",
    name: "Torsten Sløk",
    name_ko: "토르스텐 슬뢰크",
    firm: "Apollo Global Management",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Macro data and markets",
    style_ko: "매크로 데이터·시장",
    expertise: "Macro data and markets",
    expertise_ko: "매크로 데이터·시장",
    why_follow:
      "Produces concise institutional charts on rates, credit, consumers and equities",
    why_follow_ko: "금리·신용·소비·주식의 기관용 차트 요약",
    best_source: 'Apollo "Daily Spark"',
    frequency: "Weekdays",
    frequency_ko: "평일",
    verified_note: "Apollo Global Management Chief Economist and Partner",
    match_terms: ["torsten sløk", "torsten slok", "sløk", "slok", "슬뢰크"],
    search_q: '"Torsten Slok" OR "Torsten Sløk" OR Apollo "Daily Spark"',
  },
  {
    id: "sahm",
    name: "Claudia Sahm",
    name_ko: "클라우디아 삼",
    firm: "New Century Advisors · Sahm Consulting",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "Labour market / Fed policy",
    style_ko: "노동시장·연준",
    expertise: "Labour market and Fed policy",
    expertise_ko: "노동시장·연준 정책",
    why_follow: "Evidence-based interpretation of US employment and recession risk",
    why_follow_ko: "고용·경기침체 리스크의 근거 기반 해석 (Sahm rule)",
    best_source: "Stay-At-Home Economy, Bloomberg",
    frequency: "Several times weekly",
    frequency_ko: "주 수회",
    verified_note: "전 Fed 이코노미스트 · Sahm rule 고안 · New Century Advisors Chief Economist",
    match_terms: ["claudia sahm", "sahm rule", "삼 룰", "클라우디아 삼"],
    search_q: '"Claudia Sahm" OR "Sahm rule"',
  },
  {
    id: "brooks",
    name: "Robin Brooks",
    name_ko: "로빈 브룩스",
    firm: "Brookings Institution",
    category: "analyst",
    aum_usd_bn: null,
    aum_note: "—",
    style: "FX / global capital flows",
    style_ko: "환율·글로벌 자본흐름",
    expertise: "FX, global capital flows",
    expertise_ko: "환율·글로벌 자본흐름",
    why_follow:
      "Strong on currencies, balance-of-payments pressures and international flows",
    why_follow_ko: "통화·국제수지·국제자금흐름",
    best_source: "X, Brookings commentary",
    frequency: "Frequent",
    frequency_ko: "빈번",
    verified_note: "Brookings Senior Fellow · 전 IIF Chief Economist · 전 Goldman FX strategist",
    match_terms: ["robin brooks", "로빈 브룩스"],
    search_q: '"Robin Brooks" Brookings OR FX OR capital flows',
  },
];

export function allGuruProfiles(): GuruProfile[] {
  return [...GURU_ROSTER, ...FINANCE_WATCHLIST];
}

const PREMIUM_SOURCES: Array<{ re: RegExp; boost: number; label: string }> = [
  { re: /marketwatch/i, boost: 18, label: "MarketWatch" },
  { re: /bloomberg/i, boost: 20, label: "Bloomberg" },
  { re: /reuters/i, boost: 18, label: "Reuters" },
  { re: /\bft\b|financial times/i, boost: 18, label: "FT" },
  { re: /wall street journal|\bwsj\b/i, boost: 20, label: "WSJ" },
  { re: /cnbc/i, boost: 14, label: "CNBC" },
  { re: /barron/i, boost: 14, label: "Barron's" },
  { re: /financial times/i, boost: 18, label: "FT" },
  { re: /yahoo finance|yahoo! finance/i, boost: 10, label: "Yahoo Finance" },
  { re: /investopedia/i, boost: 6, label: "Investopedia" },
  { re: /business insider/i, boost: 8, label: "Business Insider" },
  { re: /forbes/i, boost: 8, label: "Forbes" },
];

const IDEA_KEYWORDS =
  /\b(buy|buys|bought|sell|sells|sold|short|long|bet|bets|warns?|warning|predicts?|forecast|portfolio|stake|activist|position|overweight|underweight|bubble|crash|rally|inflation|rates?|fed|treasury|stock|stocks|etf|equity|bond|macro|recession|bull|bear)\b|매수|매도|경고|전망|포지션|금리|인플레|주식|버블/i;

/** KST (UTC+9) briefing date: rolls at 07:00 KST. */
export function briefingAsOfKst(now = new Date()): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  let y = kst.getUTCFullYear();
  let m = kst.getUTCMonth();
  let d = kst.getUTCDate();
  const h = kst.getUTCHours();
  if (h < 7) {
    const prev = new Date(Date.UTC(y, m, d));
    prev.setUTCDate(prev.getUTCDate() - 1);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth();
    d = prev.getUTCDate();
  }
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function sortedHedgeFundRoster(
  roster: GuruProfile[] = GURU_ROSTER,
): GuruProfile[] {
  return roster
    .filter((g) => g.category === "hedge_fund")
    .sort((a, b) => (b.aum_usd_bn || 0) - (a.aum_usd_bn || 0));
}

export function investorRoster(roster: GuruProfile[] = GURU_ROSTER): GuruProfile[] {
  return roster.filter((g) => g.category === "investor");
}

export function analystWatchlist(
  roster: GuruProfile[] = FINANCE_WATCHLIST,
): GuruProfile[] {
  return roster.filter((g) => g.category === "analyst");
}

export function matchesGuru(title: string, guru: GuruProfile): boolean {
  const t = title.toLowerCase();
  return guru.match_terms.some((term) => t.includes(term.toLowerCase()));
}

export function parsePublishedMs(published?: string): number | null {
  if (!published) return null;
  const ms = Date.parse(published);
  return Number.isFinite(ms) ? ms : null;
}

export function attentionScore(input: {
  title: string;
  source: string;
  published_ms: number | null;
  now_ms?: number;
}): { score: number; why: string } {
  const now = input.now_ms ?? Date.now();
  const reasons: string[] = [];
  let score = 20;

  if (input.published_ms != null) {
    const ageH = Math.max(0, (now - input.published_ms) / 3_600_000);
    if (ageH <= 24) {
      score += 35;
      reasons.push("24h 이내");
    } else if (ageH <= 72) {
      score += 22;
      reasons.push("3일 이내");
    } else if (ageH <= 168) {
      score += 10;
      reasons.push("7일 이내");
    } else {
      score += 2;
    }
  }

  const src = `${input.source} ${input.title}`;
  for (const p of PREMIUM_SOURCES) {
    if (p.re.test(src)) {
      score += p.boost;
      reasons.push(p.label);
      break;
    }
  }

  if (IDEA_KEYWORDS.test(input.title)) {
    score += 16;
    reasons.push("투자 키워드");
  }

  // Mild boost for market-watch style phrasing
  if (/marketwatch/i.test(src)) {
    score += 4;
  }

  return {
    score: Math.round(score),
    why: reasons.slice(0, 3).join(" · ") || "일반 보도",
  };
}

export type RawGuruItem = {
  title: string;
  link?: string;
  source: string;
  published?: string;
  guru_id?: string;
};

export function buildWallStreetGurusPayload(
  rawItems: RawGuruItem[],
  opts?: { generated_at?: string; now?: Date },
): WallStreetGurusPayload {
  const now = opts?.now ?? new Date();
  const generated_at = opts?.generated_at ?? now.toISOString();
  const as_of_kst = briefingAsOfKst(now);
  const now_ms = now.getTime();
  const profiles = allGuruProfiles();

  const byGuru = new Map<string, GuruHeadline[]>();
  for (const g of profiles) byGuru.set(g.id, []);

  const seen = new Set<string>();
  for (const item of rawItems) {
    const title = item.title.trim();
    if (!title) continue;
    const key = title.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);

    const assigned =
      item.guru_id && profiles.find((g) => g.id === item.guru_id);
    const guru =
      (assigned && matchesGuru(title, assigned) ? assigned : null) ||
      profiles.find((g) => matchesGuru(title, g));
    if (!guru) continue;

    const published_ms = parsePublishedMs(item.published);
    const { score, why } = attentionScore({
      title,
      source: item.source,
      published_ms,
      now_ms,
    });

    const headline: GuruHeadline = {
      id: `${guru.id}-${published_ms || key.slice(0, 24)}`,
      guru_id: guru.id,
      title,
      link: item.link,
      source: item.source,
      published: item.published,
      published_ms,
      attention_score: score,
      why,
    };
    byGuru.get(guru.id)!.push(headline);
  }

  for (const list of byGuru.values()) {
    list.sort((a, b) => b.attention_score - a.attention_score);
  }

  const hedge_funds: GuruDesk[] = sortedHedgeFundRoster().map((guru) => ({
    guru,
    ideas: (byGuru.get(guru.id) || []).slice(0, 4),
  }));

  const investors: GuruDesk[] = investorRoster().map((guru) => ({
    guru,
    ideas: (byGuru.get(guru.id) || []).slice(0, 4),
  }));

  const watchlist: GuruDesk[] = analystWatchlist().map((guru) => ({
    guru,
    ideas: (byGuru.get(guru.id) || []).slice(0, 3),
  }));

  const allIdeas = [...byGuru.values()].flat();
  allIdeas.sort((a, b) => b.attention_score - a.attention_score);
  const highlighted = allIdeas.slice(0, 8);

  const withNews = [...hedge_funds, ...investors, ...watchlist].filter(
    (d) => d.ideas.length,
  );
  const summary = [
    `브리핑 기준(KST) ${as_of_kst} 07:00 · 구루 ${GURU_ROSTER.length}명 · 워치리스트 ${FINANCE_WATCHLIST.length}명`,
    `주목 헤드라인 ${highlighted.length}건 · 뉴스 있는 데스크 ${withNews.length}곳`,
    hedge_funds[0]
      ? `AUM 1위 데스크: ${hedge_funds[0].guru.firm} (${hedge_funds[0].guru.name_ko})`
      : "헷지펀드 명단 준비됨",
  ];

  return {
    ok: true,
    generated_at,
    as_of_kst,
    schedule_note: GURU_SCHEDULE_NOTE,
    disclaimer: GURU_DISCLAIMER,
    methodology: GURU_METHODOLOGY,
    summary,
    highlighted,
    hedge_funds,
    investors,
    watchlist,
    roster: [
      ...sortedHedgeFundRoster(),
      ...investorRoster(),
    ],
    sources_note:
      "Google News RSS · MarketWatch 등 메이저 매체 인덱싱 기사 우선 가중",
  };
}

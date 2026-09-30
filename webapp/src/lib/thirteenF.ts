/** SEC Form 13F (quarter-end US long equity holdings) — shared types & investor roster. */

export type ThirteenFInvestor = {
  id: string;
  cik: number;
  name_ko: string;
  name_en: string;
  manager: string;
  about: string;
  tags: string[];
  note?: string;
};

export type ThirteenFChange = "new" | "added" | "trimmed" | "held" | "exited";

export type ThirteenFHolding = {
  cusip: string;
  ticker: string | null;
  name: string;
  name_ko: string | null;
  cls: string;
  /** Principal-amount rows (convertible notes etc.) — `shares` is face value. */
  is_debt: boolean;
  value_usd: number;
  shares: number;
  weight_pct: number;
  prev_shares: number | null;
  prev_value_usd: number | null;
  prev_weight_pct: number | null;
  shares_chg_pct: number | null;
  change: ThirteenFChange;
};

export type ThirteenFOption = {
  cusip: string;
  ticker: string | null;
  name: string;
  put_call: "Put" | "Call";
  value_usd: number;
};

export type ThirteenFChangeCounts = Record<ThirteenFChange, number>;

export type ThirteenFFilingRef = {
  period: string;
  filed: string;
  accession: string;
  form: string;
  url: string;
};

export type ThirteenFFundSummary = {
  investor: ThirteenFInvestor;
  filing: ThirteenFFilingRef;
  prev_filing: ThirteenFFilingRef | null;
  stale: boolean;
  equity_value_usd: number;
  prev_equity_value_usd: number | null;
  positions: number;
  option_rows: number;
  sec_rows: number;
  top10_pct: number;
  style: "집중형" | "균형형" | "분산형";
  changes: ThirteenFChangeCounts;
  value_in_thousands_fixed: boolean;
  top: ThirteenFHolding[];
};

export type ThirteenFFundDetail = ThirteenFFundSummary & {
  holdings: ThirteenFHolding[];
  exited: ThirteenFHolding[];
  options: ThirteenFOption[];
};

export type ThirteenFConsensusRow = {
  key: string;
  ticker: string | null;
  name: string;
  name_ko: string | null;
  holders: number;
  value_usd: number;
  avg_weight_pct: number;
  investors: { id: string; name_ko: string; weight_pct: number; change: ThirteenFChange }[];
};

export type ThirteenFOverview = {
  generated_at: string;
  latest_period: string | null;
  funds: ThirteenFFundSummary[];
  failed: { id: string; name_ko: string; error: string }[];
  consensus: ThirteenFConsensusRow[];
  most_bought: ThirteenFConsensusRow[];
  most_sold: ThirteenFConsensusRow[];
};

export type ThirteenFLookup = {
  query: string;
  rows: {
    investor: ThirteenFInvestor;
    period: string;
    holding: ThirteenFHolding;
    rank: number;
  }[];
};

export const THIRTEENF_INVESTORS: ThirteenFInvestor[] = [
  {
    id: "berkshire-hathaway",
    cik: 1067983,
    name_ko: "버크셔 해서웨이",
    name_en: "Berkshire Hathaway",
    manager: "워런 버핏 · 그렉 에이블",
    about: "보험·산업 사업을 보유한 지주회사로, 보험 계정 자금으로 장기 주식 포트폴리오를 운용합니다.",
    tags: ["장기 보유", "집중 투자", "사업가치 중시"],
  },
  {
    id: "pershing-square",
    cik: 1336528,
    name_ko: "퍼싱 스퀘어",
    name_en: "Pershing Square Capital",
    manager: "빌 애크먼",
    about: "10개 안팎의 대형 우량주에 집중하는 행동주의 성향 헤지펀드입니다.",
    tags: ["행동주의", "초집중", "퀄리티"],
  },
  {
    id: "scion",
    cik: 1649339,
    name_ko: "사이언 애셋",
    name_en: "Scion Asset Management",
    manager: "마이클 버리",
    about: "영화 '빅쇼트'로 알려진 마이클 버리의 펀드입니다. 역발상·숏 포지션(풋옵션)을 자주 공시했습니다.",
    tags: ["역발상", "옵션 활용"],
    note: "2025년 말 등록 해지 후 신규 13F를 제출하지 않아 마지막 공시(2025 Q3) 기준입니다.",
  },
  {
    id: "bridgewater",
    cik: 1350694,
    name_ko: "브리지워터",
    name_en: "Bridgewater Associates",
    manager: "레이 달리오 창업",
    about: "매크로 전략 중심의 세계 최대급 헤지펀드입니다. 13F 주식은 전체 운용 중 일부(주로 지수·대형주 분산)입니다.",
    tags: ["글로벌 매크로", "분산"],
  },
  {
    id: "soros",
    cik: 1029160,
    name_ko: "소로스 펀드",
    name_en: "Soros Fund Management",
    manager: "조지 소로스 창업",
    about: "소로스 가문의 패밀리오피스로 매크로·이벤트 드리븐·주식을 폭넓게 운용합니다.",
    tags: ["매크로", "패밀리오피스"],
  },
  {
    id: "duquesne",
    cik: 1536411,
    name_ko: "듀케인 패밀리 오피스",
    name_en: "Duquesne Family Office",
    manager: "스탠리 드러켄밀러",
    about: "드러켄밀러 개인 자산을 운용하는 패밀리오피스로, 성장주·매크로 테마 전환이 빠릅니다.",
    tags: ["매크로", "성장주", "빠른 회전"],
  },
  {
    id: "appaloosa",
    cik: 1656456,
    name_ko: "애팔루사",
    name_en: "Appaloosa",
    manager: "데이비드 테퍼",
    about: "부실채권 투자로 명성을 쌓은 테퍼의 펀드로, 대형 기술주·중국 주식 비중 변화가 큽니다.",
    tags: ["역발상", "대형주"],
  },
  {
    id: "third-point",
    cik: 1040273,
    name_ko: "서드 포인트",
    name_en: "Third Point",
    manager: "댄 로브",
    about: "이벤트 드리븐·행동주의 헤지펀드로 경영 개선 요구 캠페인으로 유명합니다.",
    tags: ["행동주의", "이벤트 드리븐"],
  },
  {
    id: "baupost",
    cik: 1061768,
    name_ko: "바우포스트",
    name_en: "Baupost Group",
    manager: "세스 클라만",
    about: "'안전마진' 저자 클라만의 가치투자 펀드로, 현금 비중이 높고 저평가 소형주를 선호합니다.",
    tags: ["딥밸류", "안전마진"],
  },
  {
    id: "tiger-global",
    cik: 1167483,
    name_ko: "타이거 글로벌",
    name_en: "Tiger Global Management",
    manager: "체이스 콜먼",
    about: "줄리안 로버트슨의 '타이거 새끼' 펀드로 인터넷·소프트웨어 성장주에 집중합니다.",
    tags: ["타이거 계열", "기술 성장주"],
  },
  {
    id: "viking-global",
    cik: 1103804,
    name_ko: "바이킹 글로벌",
    name_en: "Viking Global Investors",
    manager: "안드레아스 할보르센",
    about: "롱숏 주식 헤지펀드로 금융·헬스케어·소비재 등 섹터를 고르게 담습니다.",
    tags: ["타이거 계열", "롱숏"],
  },
  {
    id: "lone-pine",
    cik: 1061165,
    name_ko: "론 파인",
    name_en: "Lone Pine Capital",
    manager: "스티븐 맨델",
    about: "타이거 계열 성장주 롱숏 펀드로 소비·기술 대형주에 집중합니다.",
    tags: ["타이거 계열", "성장주"],
  },
  {
    id: "coatue",
    cik: 1135730,
    name_ko: "코튜",
    name_en: "Coatue Management",
    manager: "필립 라퐁",
    about: "기술·AI 중심의 크로스오버(상장+비상장) 펀드입니다.",
    tags: ["타이거 계열", "기술·AI"],
  },
  {
    id: "himalaya",
    cik: 1709323,
    name_ko: "히말라야 캐피털",
    name_en: "Himalaya Capital",
    manager: "리루(李录)",
    about: "찰리 멍거가 자산을 맡겼던 가치투자자 리루의 펀드로, 극소수 종목에 장기 집중합니다.",
    tags: ["멍거 계열", "초집중"],
  },
  {
    id: "icahn",
    cik: 921669,
    name_ko: "칼 아이칸",
    name_en: "Carl Icahn",
    manager: "칼 아이칸",
    about: "대표적 행동주의 투자자로, 지분을 크게 확보해 경영 참여를 요구합니다. 아이칸 엔터프라이즈 보유분이 큽니다.",
    tags: ["행동주의", "초집중"],
  },
  {
    id: "oaktree",
    cik: 949509,
    name_ko: "오크트리",
    name_en: "Oaktree Capital",
    manager: "하워드 막스",
    about: "부실채권·크레딧 전문 운용사입니다. 13F 주식은 구조조정 후 받은 주식·신흥국 ADR 등이 섞여 있습니다.",
    tags: ["크레딧", "부실투자"],
  },
  {
    id: "renaissance",
    cik: 1037389,
    name_ko: "르네상스 테크놀로지",
    name_en: "Renaissance Technologies",
    manager: "짐 사이먼스 창업",
    about: "수학·통계 기반 퀀트 펀드입니다. 수천 종목을 담아 개별 종목 의미보다 팩터 노출을 보는 편이 맞습니다.",
    tags: ["퀀트", "초분산"],
  },
  {
    id: "gates-foundation",
    cik: 1166559,
    name_ko: "게이츠 재단 트러스트",
    name_en: "Gates Foundation Trust",
    manager: "빌 게이츠 재단",
    about: "게이츠 재단 기금을 운용하는 신탁으로, 마이크로소프트·버크셔 등 소수 종목을 장기 보유합니다.",
    tags: ["재단", "장기 보유"],
  },
  {
    id: "akre",
    cik: 1112520,
    name_ko: "아크레 캐피털",
    name_en: "Akre Capital Management",
    manager: "척 아크레 창업",
    about: "'세 발 의자'(우수 사업·유능한 경영진·재투자) 원칙으로 복리 성장주를 장기 보유합니다.",
    tags: ["퀄리티", "장기 보유"],
  },
  {
    id: "fundsmith",
    cik: 1569205,
    name_ko: "펀드스미스",
    name_en: "Fundsmith",
    manager: "테리 스미스",
    about: "'좋은 회사를 사서, 비싸게 사지 말고, 아무것도 하지 마라' 원칙의 영국 퀄리티 펀드입니다.",
    tags: ["퀄리티", "저회전"],
  },
  {
    id: "valueact",
    cik: 1418814,
    name_ko: "밸류액트",
    name_en: "ValueAct Capital",
    manager: "메이슨 모피트",
    about: "이사회 참여형 '협력적 행동주의' 펀드로 소수 종목에 집중합니다.",
    tags: ["행동주의", "집중"],
  },
  {
    id: "elliott",
    cik: 1791786,
    name_ko: "엘리엇",
    name_en: "Elliott Investment Management",
    manager: "폴 싱어",
    about: "세계 최대급 행동주의 헤지펀드로 지배구조·자본배분 개선 캠페인을 벌입니다.",
    tags: ["행동주의", "이벤트 드리븐"],
  },
  {
    id: "dodge-cox",
    cik: 200217,
    name_ko: "도지 앤 콕스",
    name_en: "Dodge & Cox",
    manager: "투자위원회",
    about: "1930년 설립된 전통 가치투자 운용사로 대형 가치주를 장기 보유합니다.",
    tags: ["가치주", "장기 보유"],
  },
  {
    id: "markel",
    cik: 1096343,
    name_ko: "마켈 그룹",
    name_en: "Markel Group",
    manager: "톰 게이너",
    about: "'작은 버크셔'로 불리는 보험 지주사로, 보험 플로트를 우량주에 장기 투자합니다.",
    tags: ["보험 플로트", "장기 보유"],
  },
  {
    id: "altimeter",
    cik: 1541617,
    name_ko: "알티미터",
    name_en: "Altimeter Capital",
    manager: "브래드 거스트너",
    about: "기술·AI 성장주에 집중하는 크로스오버 펀드입니다.",
    tags: ["기술·AI", "집중"],
  },
  {
    id: "d1-capital",
    cik: 1747057,
    name_ko: "D1 캐피털",
    name_en: "D1 Capital Partners",
    manager: "대니얼 선드하임",
    about: "바이킹 출신 선드하임의 롱숏 펀드로 소비·기술·금융 대형주를 담습니다.",
    tags: ["롱숏", "대형주"],
  },
  {
    id: "durable",
    cik: 1798849,
    name_ko: "듀러블 캐피털",
    name_en: "Durable Capital Partners",
    manager: "헨리 엘런보겐",
    about: "티로프라이스 출신 엘런보겐의 장기 성장주 펀드입니다.",
    tags: ["성장주", "장기 보유"],
  },
  {
    id: "whale-rock",
    cik: 1387322,
    name_ko: "웨일 록",
    name_en: "Whale Rock Capital",
    manager: "알렉스 사카키",
    about: "기술·인터넷 섹터 전문 롱숏 펀드입니다.",
    tags: ["기술 섹터", "롱숏"],
  },
  {
    id: "egerton",
    cik: 1581811,
    name_ko: "에저턴 캐피털",
    name_en: "Egerton Capital",
    manager: "존 암스트롱-존스",
    about: "런던 기반 글로벌 롱숏 펀드로 미국·유럽 대형 우량주를 집중 보유합니다.",
    tags: ["글로벌", "퀄리티"],
  },
  {
    id: "harris-associates",
    cik: 813917,
    name_ko: "해리스 어소시에이츠",
    name_en: "Harris Associates (Oakmark)",
    manager: "빌 나이그렌",
    about: "오크마크 펀드 운용사로 내재가치 대비 할인된 대형주를 삽니다.",
    tags: ["가치주", "오크마크"],
  },
  {
    id: "fairholme",
    cik: 1056831,
    name_ko: "페어홈",
    name_en: "Fairholme Capital",
    manager: "브루스 버코위츠",
    about: "극단적 집중 투자로 유명한 가치투자 펀드입니다.",
    tags: ["초집중", "딥밸류"],
  },
  {
    id: "polen",
    cik: 1034524,
    name_ko: "폴렌 캐피털",
    name_en: "Polen Capital",
    manager: "투자팀",
    about: "높은 이익률·재무건전성을 갖춘 퀄리티 성장주를 장기 보유합니다.",
    tags: ["퀄리티 성장"],
  },
  {
    id: "first-eagle",
    cik: 1325447,
    name_ko: "퍼스트 이글",
    name_en: "First Eagle Investment",
    manager: "투자팀",
    about: "금 관련주 비중이 높은 보수적 글로벌 가치투자 운용사입니다.",
    tags: ["가치주", "금"],
  },
  {
    id: "tweedy-browne",
    cik: 732905,
    name_ko: "트위디 브라운",
    name_en: "Tweedy, Browne",
    manager: "투자위원회",
    about: "벤저민 그레이엄의 브로커였던 역사를 가진 정통 가치투자 운용사입니다.",
    tags: ["그레이엄식 가치"],
  },
  {
    id: "ark",
    cik: 1697748,
    name_ko: "ARK 인베스트",
    name_en: "ARK Investment Management",
    manager: "캐시 우드",
    about: "파괴적 혁신(AI·로보틱스·유전체·핀테크) 테마 ETF 운용사입니다. 13F는 ETF 보유분의 합입니다.",
    tags: ["혁신 성장", "테마 ETF"],
  },
];

export function findInvestor(id: string): ThirteenFInvestor | undefined {
  return THIRTEENF_INVESTORS.find((x) => x.id === id);
}

/** Korean display names for widely held US tickers. */
export const TICKER_NAME_KO: Record<string, string> = {
  AAPL: "애플",
  MSFT: "마이크로소프트",
  NVDA: "엔비디아",
  AMZN: "아마존",
  GOOGL: "알파벳 A",
  GOOG: "알파벳 C",
  META: "메타",
  TSLA: "테슬라",
  AVGO: "브로드컴",
  TSM: "TSMC",
  "BRK.A": "버크셔 A",
  "BRK.B": "버크셔 B",
  JPM: "JP모건",
  BAC: "뱅크오브아메리카",
  WFC: "웰스파고",
  C: "씨티그룹",
  GS: "골드만삭스",
  MS: "모건스탠리",
  SCHW: "찰스슈왑",
  AXP: "아메리칸 익스프레스",
  COF: "캐피털 원",
  ALLY: "앨리 파이낸셜",
  V: "비자",
  MA: "마스터카드",
  PYPL: "페이팔",
  KO: "코카콜라",
  PEP: "펩시코",
  KHC: "크래프트 하인즈",
  MCD: "맥도날드",
  SBUX: "스타벅스",
  CMG: "치폴레",
  COST: "코스트코",
  WMT: "월마트",
  PG: "P&G",
  NKE: "나이키",
  CVX: "셰브론",
  XOM: "엑슨모빌",
  OXY: "옥시덴털 페트롤리엄",
  MCO: "무디스",
  SPGI: "S&P 글로벌",
  DVA: "다비타",
  UNH: "유나이티드헬스",
  LLY: "일라이 릴리",
  NVO: "노보 노디스크",
  JNJ: "존슨앤드존슨",
  PFE: "화이자",
  MRK: "머크",
  ABBV: "애브비",
  AMGN: "암젠",
  TMO: "써모피셔",
  ISRG: "인튜이티브 서지컬",
  NFLX: "넷플릭스",
  DIS: "디즈니",
  CRM: "세일즈포스",
  ORCL: "오라클",
  ADBE: "어도비",
  NOW: "서비스나우",
  INTU: "인튜이트",
  AMD: "AMD",
  INTC: "인텔",
  QCOM: "퀄컴",
  MU: "마이크론",
  AMAT: "어플라이드 머티어리얼즈",
  LRCX: "램리서치",
  KLAC: "KLA",
  ASML: "ASML",
  ARM: "ARM",
  MRVL: "마벨",
  PLTR: "팔란티어",
  SNOW: "스노우플레이크",
  CRWD: "크라우드스트라이크",
  PANW: "팔로알토",
  SHOP: "쇼피파이",
  UBER: "우버",
  ABNB: "에어비앤비",
  BKNG: "부킹홀딩스",
  SPOT: "스포티파이",
  COIN: "코인베이스",
  HOOD: "로빈후드",
  BABA: "알리바바",
  PDD: "핀둬둬",
  JD: "징둥닷컴",
  BIDU: "바이두",
  SE: "씨",
  MELI: "메르카도리브레",
  HD: "홈디포",
  LOW: "로우스",
  CAT: "캐터필러",
  DE: "디어",
  GE: "GE 에어로스페이스",
  GEV: "GE 버노바",
  BA: "보잉",
  HON: "허니웰",
  UNP: "유니온퍼시픽",
  DAL: "델타항공",
  CB: "처브",
  LEN: "레나",
  DHI: "DR 호튼",
  NVR: "NVR",
  VRSN: "베리사인",
  KR: "크로거",
  NYT: "뉴욕타임스",
  NUE: "뉴코어",
  SIRI: "시리우스XM",
  SPY: "SPDR S&P500 ETF",
  IVV: "iShares S&P500 ETF",
  VOO: "뱅가드 S&P500 ETF",
  QQQ: "인베스코 QQQ",
  IWM: "iShares 러셀2000 ETF",
  GLD: "SPDR 금 ETF",
  EEM: "iShares 신흥국 ETF",
  IEMG: "iShares 코어 신흥국 ETF",
  CPNG: "쿠팡",
  TEVA: "테바",
  CNQ: "캐나디안 내추럴",
  FNV: "프랑코네바다",
  NEM: "뉴몬트",
  GOLD: "배릭 골드",
  AEM: "애그니코 이글",
  HLT: "힐튼",
  QSR: "레스토랑 브랜즈",
  CP: "캐나디언 퍼시픽",
  WM: "웨이스트 매니지먼트",
  CNI: "캐나디언 내셔널",
  CVNA: "카바나",
  RDDT: "레딧",
  APP: "앱러빈",
  VST: "비스트라",
  CEG: "컨스텔레이션 에너지",
  TLN: "탈렌 에너지",
  STX: "씨게이트",
  WDC: "웨스턴디지털",
  SNDK: "샌디스크",
  DELL: "델",
  ANET: "아리스타",
  VRT: "버티브",
  ETN: "이튼",
  FI: "파이서브",
  FIS: "FIS",
  ICE: "ICE",
  CME: "CME 그룹",
  BX: "블랙스톤",
  KKR: "KKR",
  APO: "아폴로",
  BN: "브룩필드",
  IEP: "아이칸 엔터프라이즈",
  SPCX: "스페이스X",
  CBRS: "세레브라스",
  NBIS: "네비우스",
  ELV: "엘러번스 헬스",
  WBD: "워너브러더스 디스커버리",
  CRH: "CRH",
  PSX: "필립스66",
  SU: "선코어 에너지",
  HPE: "HPE",
  JCI: "존슨컨트롤즈",
  RTX: "RTX",
  CVS: "CVS 헬스",
  KDP: "큐리그 닥터페퍼",
  IQV: "아이큐비아",
  SYK: "스트라이커",
  MAR: "메리어트",
  WAT: "워터스",
  APD: "에어프로덕츠",
  SHW: "셔윈윌리엄스",
  NTRA: "나테라",
  TEM: "템퍼스 AI",
  CART: "인스타카트",
  NU: "누 홀딩스",
  DASH: "도어대시",
  RKT: "로켓 컴퍼니즈",
  BLK: "블랙록",
  ACN: "액센츄어",
  MDT: "메드트로닉",
  LIN: "린데",
  UTHR: "유나이티드 테라퓨틱스",
  STZ: "컨스텔레이션 브랜즈",
  LPX: "루이지애나 퍼시픽",
  M: "메이시스",
  JEF: "제프리스",
  TTMI: "TTM 테크놀로지스",
  APH: "암페놀",
  BDX: "벡톤 디킨슨",
  EPD: "엔터프라이즈 프로덕츠",
  FERG: "퍼거슨",
  RBC: "RBC 베어링스",
};

export function displayTicker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/\//g, ".").trim() || null;
}

export function fmtUsdKo(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e8) {
    const eok = (a / 1e8).toLocaleString("ko-KR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${sign}${eok}억 달러`;
  }
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString("ko-KR")}만 달러`;
  return `${sign}${Math.round(a).toLocaleString("ko-KR")} 달러`;
}

export function quarterLabel(period: string | null | undefined): string {
  if (!period) return "—";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return `${y} Q${Math.ceil(m / 3)}`;
}

export const CHANGE_LABEL: Record<ThirteenFChange, string> = {
  new: "신규",
  added: "확대",
  trimmed: "축소",
  held: "유지",
  exited: "전량 매도",
};

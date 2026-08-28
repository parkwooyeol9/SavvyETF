/**
 * US boutique / fun thematic ETF issuers — curated, not exhaustive.
 * Listed quotes come from Yahoo. Pipeline names come from SEC filings and
 * DTCC reserved symbols (status F = not yet trading).
 */

export type ThemeIssuerId =
  | "corgi"
  | "roundhill"
  | "defiance"
  | "tuttle"
  | "yieldmax"
  | "graniteshares"
  | "amplify"
  | "globalx"
  | "ark"
  | "procure"
  | "advisorshares"
  | "rex";

export type ThemeKind =
  | "slice"
  | "income"
  | "leverage"
  | "culture"
  | "active";

export type ThemeIssuer = {
  id: ThemeIssuerId;
  name: string;
  name_ko: string;
  founded: string;
  hq: string;
  products_note: string;
  fee_band: string;
  playbook: string;
  playbook_ko: string;
  signature: string;
  risk_ko: string;
  scores: {
    novelty: number;
    fee: number;
    breadth: number;
    income: number;
    leverage: number;
  };
};

export type ThemeProduct = {
  id: string;
  issuer: ThemeIssuerId;
  symbol: string;
  name: string;
  name_ko: string;
  kind: ThemeKind;
  theme: string;
  expense: string;
  blurb: string;
  featured?: boolean;
};

export type ThemePipelineStatus = "filed" | "reserved" | "s1";

export type ThemePipeline = {
  id: string;
  issuer: ThemeIssuerId;
  ticker: string | null;
  name: string;
  name_ko: string;
  theme: string;
  status: ThemePipelineStatus;
  status_ko: string;
  source: string;
  note: string;
};

export type ThemeQuotePoint = {
  date: string;
  label: string;
  close: number;
};

export type ThemeProductQuote = ThemeProduct & {
  price: number | null;
  change_1d_pct: number | null;
  change_3m_pct: number | null;
  series: ThemeQuotePoint[];
  error?: string;
};

export type ThemePayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  issuers: ThemeIssuer[];
  products: ThemeProductQuote[];
  pipeline: ThemePipeline[];
  rivals: ThemeRival[];
  error?: string;
};

export const THEME_ISSUERS: ThemeIssuer[] = [
  {
    id: "corgi",
    name: "Corgi",
    name_ko: "코기",
    founded: "2025",
    hq: "샌프란시스코",
    products_note: "197개+ (2026.8 기준, 계속 상장)",
    fee_band: "0.20–0.45%",
    playbook: "VC-funded spaghetti cannon",
    playbook_ko:
      "VC 자금으로 AI 서류 작업을 돌려 테마·버퍼·2x를 하루에 수십 개씩 상장. 보수를 기존 테마 운용사보다 낮춰 점유율을 노린다.",
    signature: "EUV · FDRS · CBOT",
    risk_ko: "상품 수는 많지만 AUM은 히트 1–2개에 편중. 브랜드 인지도는 아직 약함.",
    scores: { novelty: 4, fee: 5, breadth: 5, income: 2, leverage: 4 },
  },
  {
    id: "roundhill",
    name: "Roundhill",
    name_ko: "라운드힐",
    founded: "2018",
    hq: "뉴욕",
    products_note: "100개+ 론칭 경험 · 테마+주간 인컴",
    fee_band: "0.29–0.99%",
    playbook: "First-to-market slices",
    playbook_ko:
      "Mag7·메모리·네오클라우드처럼 ‘한 겹만’ 잘라 먼저 상장. DRAM처럼 맞으면 초대형 AUM이 된다. 커버드콜(MAGY)·주간분배도 합니다.",
    signature: "DRAM · MAGS · NCLD",
    risk_ko: "슬라이스가 좁아 테마가 식으면 낙폭이 큼. 인컴 상품은 상승 캡이 있음.",
    scores: { novelty: 5, fee: 3, breadth: 3, income: 4, leverage: 3 },
  },
  {
    id: "defiance",
    name: "Defiance",
    name_ko: "디파이언스",
    founded: "2018",
    hq: "마이애미",
    products_note: "93개 · AUM 약 $11B",
    fee_band: "0.30–1.3%",
    playbook: "Thematic + 0DTE income + 2x",
    playbook_ko:
      "양자·방산 같은 테마 선점 뒤, 0DTE 콜스프레드 주간분배와 단일종목 2x로 확장. 차세대 트레이더 타깃.",
    signature: "QTUM · QQQY · MSTX",
    risk_ko: "인컴 타깃은 보장 아님. 2x는 일간 리밸런싱 감쇠.",
    scores: { novelty: 4, fee: 2, breadth: 4, income: 5, leverage: 5 },
  },
  {
    id: "tuttle",
    name: "Tuttle Capital",
    name_ko: "터틀",
    founded: "2012",
    hq: "코네티컷",
    products_note: "액티브 테마 · 인버스/2x 실험",
    fee_band: "0.75–1.05%",
    playbook: "High-conviction active themes",
    playbook_ko:
      "포토닉스처럼 순수 노출(pure play) 액티브 바스켓. 동시에 TSLA·MSTR 인버스 등 공격적 트레이딩 상품.",
    signature: "FOTO · TSLZ · MSTZ",
    risk_ko: "액티브 테마는 운용사 선별 리스크. 인버스는 상승장에서 급락.",
    scores: { novelty: 4, fee: 2, breadth: 2, income: 1, leverage: 4 },
  },
  {
    id: "yieldmax",
    name: "YieldMax",
    name_ko: "일드맥스",
    founded: "2022",
    hq: "Tidal 플랫폼",
    products_note: "단일종목 커버드콜 공장",
    fee_band: "0.99%대",
    playbook: "Synthetic covered-call income",
    playbook_ko:
      "MSTR·TSLA·NVDA 등 한 종목에 콜을 팔아 높은 분배를 광고. 분배의 상당 부분은 자본 반환일 수 있음.",
    signature: "MSTY · TSLY · ULTY",
    risk_ko: "고배당처럼 보이지만 NAV 잠식이 흔함. 기초자산 급등 시 소외.",
    scores: { novelty: 3, fee: 1, breadth: 4, income: 5, leverage: 2 },
  },
  {
    id: "graniteshares",
    name: "GraniteShares",
    name_ko: "그래나이트셰어스",
    founded: "2016",
    hq: "뉴욕",
    products_note: "2x 단일종목 + YieldBOOST",
    fee_band: "1.15% 전후",
    playbook: "Retail leverage & yieldboost",
    playbook_ko:
      "NVDA·COIN 2x로 유명. 최근엔 레버리지 ETF에 풋을 팔아 주간 인컴을 만드는 YieldBOOST 시리즈.",
    signature: "NVDL · CONL · TSYY",
    risk_ko: "2x+옵션 중첩. 변동성 큰 단일 종목에 레버리지가 겹침.",
    scores: { novelty: 3, fee: 1, breadth: 3, income: 4, leverage: 5 },
  },
  {
    id: "amplify",
    name: "Amplify",
    name_ko: "앰플리파이",
    founded: "2015",
    hq: "텍사스",
    products_note: "블록체인·소비·우라늄 등 컬처 테마",
    fee_band: "0.47–0.75%",
    playbook: "Culture & alternative themes",
    playbook_ko:
      "BLOK처럼 스토리가 있는 테마를 일찍 상장. 대마·온라인쇼핑·보수 가치(YALL) 등 컬처 바스켓.",
    signature: "BLOK · IBUY · SURI",
    risk_ko: "내러티브 순환에 민감. 유동성이 얕은 상품이 섞여 있음.",
    scores: { novelty: 3, fee: 3, breadth: 3, income: 1, leverage: 1 },
  },
  {
    id: "globalx",
    name: "Global X",
    name_ko: "글로벌X",
    founded: "2008",
    hq: "뉴욕 (Mirae)",
    products_note: "테마 ETF의 원조 격 라인업",
    fee_band: "0.50–0.75%",
    playbook: "Index thematic catalog",
    playbook_ko:
      "로봇·리튬·우라늄·방산처럼 장기 메가트렌드를 지수로 패키징. 미레에셋 산하로 유통이 넓다.",
    signature: "BOTZ · URA · SHLD",
    risk_ko: "테마 지수 중복 편입이 많고, 히트 테마는 후발 저보수 상품과 경쟁.",
    scores: { novelty: 2, fee: 3, breadth: 4, income: 2, leverage: 1 },
  },
  {
    id: "ark",
    name: "ARK Invest",
    name_ko: "ARK",
    founded: "2014",
    hq: "플로리다/뉴욕",
    products_note: "액티브 파괴적 혁신",
    fee_band: "0.75%",
    playbook: "High-conviction active disruption",
    playbook_ko:
      "우드 스타일의 고확신 액티브. ETF를 ‘테마 바구니’가 아니라 매니저 베팅으로 판다.",
    signature: "ARKK · ARKQ · ARKX",
    risk_ko: "집중·고베타. 매니저 리스크가 테마 리스크와 겹침.",
    scores: { novelty: 3, fee: 2, breadth: 2, income: 1, leverage: 1 },
  },
  {
    id: "procure",
    name: "Procure",
    name_ko: "프로큐어",
    founded: "2017",
    hq: "뉴욕",
    products_note: "우주 ETF 원조 UFO",
    fee_band: "0.75%",
    playbook: "One iconic niche",
    playbook_ko:
      "상품 수는 적고, 우주·위성처럼 한 테마를 오래 붙잡는 부티크.",
    signature: "UFO",
    risk_ko: "라인업이 얇아 테마가 비면 운용사 전체가 흔들림.",
    scores: { novelty: 4, fee: 2, breadth: 1, income: 1, leverage: 1 },
  },
  {
    id: "advisorshares",
    name: "AdvisorShares",
    name_ko: "어드바이저셰어스",
    founded: "2009",
    hq: "메릴랜드",
    products_note: "액티브 니치 · 대마 대표",
    fee_band: "0.74–1.00%",
    playbook: "Active alternative sleeves",
    playbook_ko:
      "미국 상장 대마(MSOS)처럼 규제 테마를 액티브로 담는 하우스. 정치·대안 자산 실험도 많음.",
    signature: "MSOS",
    risk_ko: "규제·주법 리스크. 일부 상품은 거래량이 얇음.",
    scores: { novelty: 3, fee: 2, breadth: 2, income: 1, leverage: 1 },
  },
  {
    id: "rex",
    name: "REX Shares / T-Rex",
    name_ko: "렉스·티렉스",
    founded: "2015",
    hq: "뉴욕",
    products_note: "단일종목 2x + 테마 2x",
    fee_band: "0.95–1.50%",
    playbook: "Leverage on whatever is hot",
    playbook_ko:
      "NVDA 2x(NVDX)로 성장한 뒤, Roundhill DRAM의 2x(RAM)처럼 히트 테마 위에 레버리지를 얹는다.",
    signature: "NVDX · RAM",
    risk_ko: "기초 테마 ETF보다 변동성이 훨씬 큼. 일간 목표일 뿐 장기 2배가 아님.",
    scores: { novelty: 3, fee: 1, breadth: 3, income: 1, leverage: 5 },
  },
];

export const THEME_PRODUCTS: ThemeProduct[] = [
  // Corgi
  { id: "fdrs", issuer: "corgi", symbol: "FDRS", name: "Corgi Founder-Led ETF", name_ko: "창업자 경영", kind: "slice", theme: "거버넌스", expense: "저보수", blurb: "창업자가 아직 키를 잡고 있는 미국 상장사 50종목 지수.", featured: true },
  { id: "fdrx", issuer: "corgi", symbol: "FDRX", name: "Corgi Founder-Led 2x Daily", name_ko: "창업자 경영 2x", kind: "leverage", theme: "2x", expense: "0.45%대", blurb: "FDRS의 일간 2배. 코기의 초기 히트작 중 하나." },
  { id: "cbot", issuer: "corgi", symbol: "CBOT", name: "Corgi Robots & Humanoids", name_ko: "로봇·휴머노이드", kind: "slice", theme: "로봇", expense: "0.35%", blurb: "산업로봇부터 휴머노이드·수술로봇까지. BOTZ보다 보수를 낮춤.", featured: true },
  { id: "cmag", issuer: "corgi", symbol: "CMAG", name: "Corgi Magnificent Seven", name_ko: "매그7", kind: "slice", theme: "빅테크", expense: "0.20%", blurb: "MAGS를 0.10%p 언더컷한 매그7 액티브.", featured: true },
  { id: "euv", issuer: "corgi", symbol: "EUV", name: "Corgi Lithography & Semi Photonics", name_ko: "EUV·세미 포토닉스", kind: "slice", theme: "AI 인프라", expense: "저보수", blurb: "노광·광학·검사. 코기 라인에서 AUM이 가장 빨리 붙은 슬라이스.", featured: true },
  { id: "euvx", issuer: "corgi", symbol: "EUVX", name: "Corgi Lithography 2x Daily", name_ko: "EUV 2x", kind: "leverage", theme: "2x", expense: "0.45%", blurb: "EUV의 일간 2배 버전." },
  { id: "cqtm", issuer: "corgi", symbol: "CQTM", name: "Corgi Quantum Computing", name_ko: "양자컴퓨팅", kind: "slice", theme: "양자", expense: "저보수", blurb: "Defiance QTUM과 같은 테마를 더 싼 보수로 노림." },
  { id: "brew", issuer: "corgi", symbol: "BREW", name: "Corgi Coffee & Energy Drink", name_ko: "커피·에너지드링크", kind: "culture", theme: "소비", expense: "저보수", blurb: "카페인 소비 테마. 코기식 ‘재미있는 슬라이스’의 전형.", featured: true },
  { id: "bzz", issuer: "corgi", symbol: "BZZ", name: "Corgi Drones & Urban Air", name_ko: "드론·UAM", kind: "slice", theme: "항공", expense: "저보수", blurb: "드론·도심항공 모빌리티." },
  { id: "dipr", issuer: "corgi", symbol: "DIPR", name: "Corgi Space & Satellite", name_ko: "우주·위성", kind: "slice", theme: "우주", expense: "저보수", blurb: "UFO와 겹치는 우주 통신·위성." },
  { id: "own", issuer: "corgi", symbol: "OWN", name: "Corgi Inside Ownership 100", name_ko: "내부자 지분 100", kind: "slice", theme: "거버넌스", expense: "저보수", blurb: "내부자 지분이 두꺼운 기업 바스켓." },
  { id: "bay", issuer: "corgi", symbol: "BAY", name: "Corgi Bay Area Based", name_ko: "베이 에어리어", kind: "culture", theme: "지역", expense: "저보수", blurb: "본사가 샌프란시스코 베이에 있는 기업." },

  // Roundhill
  { id: "mags", issuer: "roundhill", symbol: "MAGS", name: "Roundhill Magnificent Seven", name_ko: "매그7", kind: "slice", theme: "빅테크", expense: "0.29%", blurb: "매그7을 ETF로 처음 패키징한 히트작.", featured: true },
  { id: "dram", issuer: "roundhill", symbol: "DRAM", name: "Roundhill Memory", name_ko: "메모리", kind: "slice", theme: "HBM·DRAM", expense: "0.65%", blurb: "HBM/DRAM 순수 노출. 2026.4 상장 후 초고속 AUM 성장.", featured: true },
  { id: "ncld", issuer: "roundhill", symbol: "NCLD", name: "Roundhill Neocloud", name_ko: "네오클라우드", kind: "slice", theme: "GPU 클라우드", expense: "테마 보수", blurb: "GPU 임대·AI 데이터센터 ‘네오클라우드’ 슬라이스. 2026.8 상장.", featured: true },
  { id: "lyte", issuer: "roundhill", symbol: "LYTE", name: "Roundhill Photonics & Optics", name_ko: "포토닉스·광학", kind: "slice", theme: "광통신", expense: "테마 보수", blurb: "AI 데이터센터 구리→빛 전환. FOTO·EUV와 경쟁.", featured: true },
  { id: "magy", issuer: "roundhill", symbol: "MAGY", name: "Roundhill Mag7 Covered Call", name_ko: "매그7 커버드콜", kind: "income", theme: "주간 인컴", expense: "0.99%", blurb: "MAGS 위에 콜을 팔아 주간 분배." },
  { id: "betz", issuer: "roundhill", symbol: "BETZ", name: "Roundhill Sports Betting & iGaming", name_ko: "스포츠베팅", kind: "culture", theme: "게이밍", expense: "0.75%", blurb: "합법 도박·iGaming. 컬처 테마의 대표." },
  { id: "nerd", issuer: "roundhill", symbol: "NERD", name: "Roundhill Video Games", name_ko: "비디오게임", kind: "culture", theme: "게임", expense: "0.50%", blurb: "게임 퍼블리셔·플랫폼." },
  { id: "chat", issuer: "roundhill", symbol: "CHAT", name: "Roundhill Generative AI", name_ko: "생성형 AI", kind: "slice", theme: "AI", expense: "0.75%", blurb: "생성형 AI 밸류체인 액티브." },
  { id: "qdte", issuer: "roundhill", symbol: "QDTE", name: "Roundhill N-100 0DTE Covered Call", name_ko: "나스닥 0DTE 콜", kind: "income", theme: "0DTE", expense: "0.95%", blurb: "나스닥100 0DTE 커버드콜. 디파이언스 주간분배와 같은 전장." },

  // Defiance
  { id: "qtum", issuer: "defiance", symbol: "QTUM", name: "Defiance Quantum", name_ko: "양자", kind: "slice", theme: "양자", expense: "0.40%", blurb: "양자컴퓨팅 테마의 사실상 벤치마크.", featured: true },
  { id: "qqqy", issuer: "defiance", symbol: "QQQY", name: "Defiance Nasdaq-100 Weekly Dist.", name_ko: "나스닥 주간분배", kind: "income", theme: "0DTE 인컴", expense: "옵션형", blurb: "나스닥100 콜스프레드로 연 30% 현금분배 타깃(보장 아님).", featured: true },
  { id: "mstx", issuer: "defiance", symbol: "MSTX", name: "Defiance 2x Long MSTR", name_ko: "MSTR 2x", kind: "leverage", theme: "2x", expense: "1.3%대", blurb: "마이크로스트래티지 일간 2배. 비트코인 베타의 레버리지.", featured: true },
  { id: "qqqt", issuer: "defiance", symbol: "QQQT", name: "Defiance Nasdaq-100 Income Target", name_ko: "나스닥 인컴 타깃", kind: "income", theme: "월간 인컴", expense: "옵션형", blurb: "연 20% 인컴 타깃의 나스닥 콜스프레드." },

  // Tuttle
  { id: "foto", issuer: "tuttle", symbol: "FOTO", name: "Tuttle Pure Play Photonics", name_ko: "퓨어플레이 포토닉스", kind: "slice", theme: "광통신", expense: "0.75%", blurb: "매출 50%+ 포토닉스 기업만. 대기업 광학 부문은 걸러낸다.", featured: true },
  { id: "tslz", issuer: "tuttle", symbol: "TSLZ", name: "Tuttle Inverse TSLA", name_ko: "TSLA 인버스", kind: "leverage", theme: "숏", expense: "1%대", blurb: "테슬라 역방향. 테마 하우스의 트레이딩 얼굴.", featured: true },
  { id: "mstz", issuer: "tuttle", symbol: "MSTZ", name: "Tuttle Inverse MSTR", name_ko: "MSTR 인버스", kind: "leverage", theme: "숏", expense: "1%대", blurb: "MSTR 숏. MSTX의 반대편." },

  // YieldMax
  { id: "msty", issuer: "yieldmax", symbol: "MSTY", name: "YieldMax MSTR Option Income", name_ko: "MSTR 옵션인컴", kind: "income", theme: "커버드콜", expense: "0.99%", blurb: "가장 유명한 단일종목 옵션인컴. 분배율과 NAV 훼손을 같이 봐야 함.", featured: true },
  { id: "tsly", issuer: "yieldmax", symbol: "TSLY", name: "YieldMax TSLA Option Income", name_ko: "TSLA 옵션인컴", kind: "income", theme: "커버드콜", expense: "0.99%", blurb: "테슬라 콜 매도.", featured: true },
  { id: "nvdy", issuer: "yieldmax", symbol: "NVDY", name: "YieldMax NVDA Option Income", name_ko: "NVDA 옵션인컴", kind: "income", theme: "커버드콜", expense: "0.99%", blurb: "엔비디아 콜 매도." },
  { id: "ulty", issuer: "yieldmax", symbol: "ULTY", name: "YieldMax Ultra Option Income", name_ko: "울트라 옵션인컴", kind: "income", theme: "멀티", expense: "1.3%대", blurb: "여러 고변동 종목에 옵션 오버레이.", featured: true },
  { id: "ymax", issuer: "yieldmax", symbol: "YMAX", name: "YieldMax Universe Fund of Funds", name_ko: "일드맥스 모음", kind: "income", theme: "FoF", expense: "중첩", blurb: "일드맥스 시리즈를 한 바구니에." },

  // GraniteShares
  { id: "nvdl", issuer: "graniteshares", symbol: "NVDL", name: "GraniteShares 2x Long NVDA", name_ko: "NVDA 2x", kind: "leverage", theme: "2x", expense: "1.15%", blurb: "개인 레버리지 ETF의 상징.", featured: true },
  { id: "conl", issuer: "graniteshares", symbol: "CONL", name: "GraniteShares 2x Long COIN", name_ko: "COIN 2x", kind: "leverage", theme: "2x", expense: "1.15%", blurb: "코인베이스 일간 2배.", featured: true },
  { id: "tsyy", issuer: "graniteshares", symbol: "TSYY", name: "GraniteShares YieldBOOST TSLA", name_ko: "TSLA 일드부스트", kind: "income", theme: "주간 인컴", expense: "옵션형", blurb: "TSLA 2x ETF에 풋을 팔아 인컴을 노림.", featured: true },
  { id: "amdl", issuer: "graniteshares", symbol: "AMDL", name: "GraniteShares 2x Long AMD", name_ko: "AMD 2x", kind: "leverage", theme: "2x", expense: "1.15%", blurb: "AMD 일간 2배." },

  // Amplify
  { id: "blok", issuer: "amplify", symbol: "BLOK", name: "Amplify Transformational Data Sharing", name_ko: "블록체인", kind: "slice", theme: "크립토 지분", expense: "0.73%", blurb: "코인 현물 대신 블록체인 관련 주식을 담은 초기 히트.", featured: true },
  { id: "ibuy", issuer: "amplify", symbol: "IBUY", name: "Amplify Online Retail", name_ko: "온라인 리테일", kind: "culture", theme: "소비", expense: "0.65%", blurb: "이커머스 순수 노출." },
  { id: "batt", issuer: "amplify", symbol: "BATT", name: "Amplify Lithium & Battery Technology", name_ko: "리튬·배터리", kind: "slice", theme: "배터리", expense: "0.59%", blurb: "리튬 채굴·배터리 셀. Global X LIT와 같은 전장." },
  { id: "cnbs", issuer: "amplify", symbol: "CNBS", name: "Amplify Seymour Cannabis", name_ko: "대마", kind: "culture", theme: "대마", expense: "0.75%", blurb: "대마 액티브. MSOS와 경쟁." },
  { id: "yall", issuer: "amplify", symbol: "YALL", name: "God Bless America ETF", name_ko: "보수 가치", kind: "culture", theme: "정치·가치", expense: "0.65%", blurb: "보수 스크리닝. 정치테마 탭과 겹침.", featured: true },

  // Global X
  { id: "botz", issuer: "globalx", symbol: "BOTZ", name: "Global X Robotics & AI", name_ko: "로봇·AI", kind: "slice", theme: "로봇", expense: "0.68%", blurb: "로봇 테마의 대형 벤치마크. CBOT가 보수로 도전.", featured: true },
  { id: "ura", issuer: "globalx", symbol: "URA", name: "Global X Uranium", name_ko: "우라늄", kind: "slice", theme: "원자력", expense: "0.69%", blurb: "우라늄 채굴·핵연료 체인.", featured: true },
  { id: "lit", issuer: "globalx", symbol: "LIT", name: "Global X Lithium & Battery Tech", name_ko: "리튬·배터리", kind: "slice", theme: "배터리", expense: "0.75%", blurb: "리튬 채굴+배터리." },
  { id: "shld", issuer: "globalx", symbol: "SHLD", name: "Global X Defense Tech", name_ko: "방산 테크", kind: "slice", theme: "방산", expense: "0.50%", blurb: "방산·방위 테크. 지정학 사이클 상품.", featured: true },
  { id: "pave", issuer: "globalx", symbol: "PAVE", name: "Global X U.S. Infrastructure", name_ko: "미국 인프라", kind: "slice", theme: "인프라", expense: "0.47%", blurb: "미국 인프라 법안 수혜 바스켓." },

  // ARK
  { id: "arkk", issuer: "ark", symbol: "ARKK", name: "ARK Innovation", name_ko: "혁신", kind: "active", theme: "파괴적 혁신", expense: "0.75%", blurb: "액티브 테마의 얼굴.", featured: true },
  { id: "arkq", issuer: "ark", symbol: "ARKQ", name: "ARK Autonomous Tech & Robotics", name_ko: "자율·로봇", kind: "active", theme: "로봇", expense: "0.75%", blurb: "자율주행·로봇 액티브.", featured: true },
  { id: "arkx", issuer: "ark", symbol: "ARKX", name: "ARK Space Exploration", name_ko: "우주", kind: "active", theme: "우주", expense: "0.75%", blurb: "우주 탐사 액티브. UFO와 비교 포인트.", featured: true },
  { id: "arkw", issuer: "ark", symbol: "ARKW", name: "ARK Next Gen Internet", name_ko: "넥스트 인터넷", kind: "active", theme: "플랫폼", expense: "0.75%", blurb: "핀테크·플랫폼." },

  // Procure
  { id: "ufo", issuer: "procure", symbol: "UFO", name: "Procure Space ETF", name_ko: "우주", kind: "slice", theme: "우주", expense: "0.75%", blurb: "상장 우주 ETF의 원조 티커. 위성·발사·지상국.", featured: true },

  // AdvisorShares
  { id: "msos", issuer: "advisorshares", symbol: "MSOS", name: "AdvisorShares Pure US Cannabis", name_ko: "미국 대마", kind: "culture", theme: "대마", expense: "0.74%", blurb: "미국 상장 대마 순수 노출의 벤치마크.", featured: true },

  // REX / T-Rex
  { id: "nvdx", issuer: "rex", symbol: "NVDX", name: "T-Rex 2x Long NVDA Daily", name_ko: "NVDA 2x", kind: "leverage", theme: "2x", expense: "1.05%", blurb: "NVDL의 경쟁 2x.", featured: true },
  { id: "ram", issuer: "rex", symbol: "RAM", name: "Roundhill T-REX 2x Long DRAM", name_ko: "DRAM 2x", kind: "leverage", theme: "2x", expense: "레버리지", blurb: "히트 테마 DRAM 위에 2x를 얹은 협업 상품.", featured: true },
];

export const THEME_PIPELINE: ThemePipeline[] = [
  { id: "p-aime", issuer: "corgi", ticker: "AIME", name: "Corgi AI Memory Buildout", name_ko: "AI 메모리 빌드아웃", theme: "HBM", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "Roundhill DRAM과 정면 승부할 슬라이스. 아직 미거래." },
  { id: "p-vram", issuer: "corgi", ticker: "VRAM", name: "Corgi Memory ETF", name_ko: "메모리", theme: "DRAM", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "메모리 순수 노출. DRAM 대항마." },
  { id: "p-hbmy", issuer: "corgi", ticker: "HBMY", name: "Corgi HBM ETF", name_ko: "HBM", theme: "HBM", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "고대역 메모리만 더 얇게 자른 버전." },
  { id: "p-vm", issuer: "corgi", ticker: "VM", name: "Corgi Neocloud ETF", name_ko: "네오클라우드", theme: "GPU 클라우드", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "NCLD보다 먼저 심볼을 잡아 둔 상태." },
  { id: "p-froz", issuer: "corgi", ticker: "FROZ", name: "Corgi AI Data Center Cooling", name_ko: "데이터센터 냉각", theme: "전력·냉각", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "액침·냉각. 아직 상장 안 된 초니치." },
  { id: "p-hvdc", issuer: "corgi", ticker: "HVDC", name: "Corgi 800VDC Power", name_ko: "800V DC 전력", theme: "전력", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "AI 랙 전원 아키텍처 테마." },
  { id: "p-krob", issuer: "corgi", ticker: "KROB", name: "Corgi Korean Robotics", name_ko: "한국 로봇", theme: "로봇", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "한국 로봇 순수 노출. 국내 투자자와 접점." },
  { id: "p-nlp", issuer: "corgi", ticker: "NLP", name: "Corgi Large Language Model", name_ko: "LLM", theme: "AI", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "LLM 밸류체인. 티커 NLP." },
  { id: "p-kink", issuer: "corgi", ticker: "KINK", name: "Corgi AI Bottlenecks", name_ko: "AI 병목", theme: "AI 인프라", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "메모리·전력·네트가 아니라 ‘병목’ 자체를 테마로." },
  { id: "p-co", issuer: "corgi", ticker: "CO", name: "Corgi Co-Packaged Optics", name_ko: "CPO 광학", theme: "포토닉스", status: "reserved", status_ko: "DTCC 예약", source: "DTCC F", note: "코패키지드 옵틱스 순수 플레이." },
  { id: "p-rh-humanoid", issuer: "roundhill", ticker: null, name: "Roundhill Humanoid Robotics ETF", name_ko: "휴머노이드 로봇", theme: "로봇", status: "s1", status_ko: "S-1/N-1A", source: "SEC 2025.6", note: "휴머노이드 전용. CBOT·BOTZ보다 더 얇은 슬라이스." },
  { id: "p-rh-qq", issuer: "roundhill", ticker: "QQ", name: "Roundhill Quantum Computing ETF", name_ko: "양자컴퓨팅", theme: "양자", status: "s1", status_ko: "예비 목적서", source: "SEC 2026.5", note: "티커 QQ로 제출. 상장 전. QTUM·CQTM과 겹침." },
  { id: "p-tuttle-agentic", issuer: "tuttle", ticker: null, name: "Tuttle Agentic AI ETF", name_ko: "에이전틱 AI", theme: "AI", status: "filed", status_ko: "제출", source: "SEC 2026", note: "에이전틱 AI 액티브. 상장 일정 미정." },
  { id: "p-tuttle-tail", issuer: "tuttle", ticker: null, name: "Tuttle Equity Plus Tail Risk", name_ko: "테일리스크 플러스", theme: "헤지", status: "filed", status_ko: "N-1A", source: "SEC 2026.7", note: "주식+테일헤지 실험 상품." },
  { id: "p-amp-nuclear", issuer: "amplify", ticker: null, name: "Amplify Top 10 Nuclear ETF", name_ko: "원자력 Top 10", theme: "원자력", status: "filed", status_ko: "상장 지연", source: "SEC 485BXT 2026.8", note: "티커 미배정. 효과일을 2026.9로 반복 연기 중." },
];

export const THEME_SCORE_AXES = [
  { key: "novelty", label: "참신함" },
  { key: "fee", label: "저보수" },
  { key: "breadth", label: "라인업 폭" },
  { key: "income", label: "인컴" },
  { key: "leverage", label: "레버리지" },
] as const;

export const THEME_KIND_KO: Record<ThemeKind, string> = {
  slice: "슬라이스",
  income: "인컴",
  leverage: "레버리지",
  culture: "컬처",
  active: "액티브",
};

export type ThemeRivalSeat = {
  issuer: ThemeIssuerId;
  symbol: string | null;
  listed: boolean;
  note: string;
};

export type ThemeRival = {
  id: string;
  theme: string;
  theme_ko: string;
  seats: ThemeRivalSeat[];
};

/** Same slice, different issuer — the actual competitive set. */
export const THEME_RIVALS: ThemeRival[] = [
  {
    id: "mag7",
    theme: "Magnificent Seven",
    theme_ko: "매그7",
    seats: [
      { issuer: "roundhill", symbol: "MAGS", listed: true, note: "원조 패키지 · 0.29%" },
      { issuer: "corgi", symbol: "CMAG", listed: true, note: "0.20%로 언더컷" },
    ],
  },
  {
    id: "robots",
    theme: "Robotics",
    theme_ko: "로봇",
    seats: [
      { issuer: "globalx", symbol: "BOTZ", listed: true, note: "대형 벤치마크 · 0.68%" },
      { issuer: "corgi", symbol: "CBOT", listed: true, note: "휴머노이드까지 · 0.35%" },
      { issuer: "ark", symbol: "ARKQ", listed: true, note: "액티브 자율·로봇" },
      { issuer: "roundhill", symbol: null, listed: false, note: "휴머노이드 S-1" },
    ],
  },
  {
    id: "quantum",
    theme: "Quantum",
    theme_ko: "양자",
    seats: [
      { issuer: "defiance", symbol: "QTUM", listed: true, note: "사실상 벤치마크" },
      { issuer: "corgi", symbol: "CQTM", listed: true, note: "저보수 대항마" },
      { issuer: "roundhill", symbol: "QQ", listed: false, note: "S-1 · 티커 QQ" },
    ],
  },
  {
    id: "memory",
    theme: "Memory / HBM",
    theme_ko: "메모리·HBM",
    seats: [
      { issuer: "roundhill", symbol: "DRAM", listed: true, note: "2026.4 히트 · 초대형 AUM" },
      { issuer: "rex", symbol: "RAM", listed: true, note: "DRAM 일간 2x" },
      { issuer: "corgi", symbol: "AIME", listed: false, note: "DTCC 예약 · 빌드아웃" },
      { issuer: "corgi", symbol: "VRAM", listed: false, note: "DTCC 예약 · 메모리" },
    ],
  },
  {
    id: "photonics",
    theme: "Photonics",
    theme_ko: "포토닉스",
    seats: [
      { issuer: "tuttle", symbol: "FOTO", listed: true, note: "매출 50%+ 순수 플레이" },
      { issuer: "roundhill", symbol: "LYTE", listed: true, note: "광학·광통신 슬라이스" },
      { issuer: "corgi", symbol: "EUV", listed: true, note: "노광·세미 광학" },
      { issuer: "corgi", symbol: "CO", listed: false, note: "CPO 예약 심볼" },
    ],
  },
  {
    id: "neocloud",
    theme: "Neocloud",
    theme_ko: "네오클라우드",
    seats: [
      { issuer: "roundhill", symbol: "NCLD", listed: true, note: "2026.8 상장" },
      { issuer: "corgi", symbol: "VM", listed: false, note: "DTCC 예약" },
    ],
  },
  {
    id: "space",
    theme: "Space",
    theme_ko: "우주",
    seats: [
      { issuer: "procure", symbol: "UFO", listed: true, note: "우주 ETF 원조 티커" },
      { issuer: "ark", symbol: "ARKX", listed: true, note: "액티브 우주" },
      { issuer: "corgi", symbol: "DIPR", listed: true, note: "위성·우주통신" },
    ],
  },
  {
    id: "cannabis",
    theme: "Cannabis",
    theme_ko: "대마",
    seats: [
      { issuer: "advisorshares", symbol: "MSOS", listed: true, note: "미국 상장 순수 노출" },
      { issuer: "amplify", symbol: "CNBS", listed: true, note: "액티브 대마" },
    ],
  },
  {
    id: "nvda2x",
    theme: "NVDA 2x",
    theme_ko: "엔비디아 2x",
    seats: [
      { issuer: "graniteshares", symbol: "NVDL", listed: true, note: "개인 2x의 얼굴" },
      { issuer: "rex", symbol: "NVDX", listed: true, note: "T-Rex 2x" },
    ],
  },
];

export const THEME_NOTE =
  "미국 부티크·테마 운용사 큐레이션. 시세는 Yahoo 지연. 파이프라인은 SEC 제출·DTCC 예약 심볼이라 상장 전·티커 변경·철회가 잦습니다. 투자 조언이 아닙니다.";

export function issuerById(id: ThemeIssuerId): ThemeIssuer {
  return THEME_ISSUERS.find((i) => i.id === id) || THEME_ISSUERS[0]!;
}

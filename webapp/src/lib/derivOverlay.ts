/**
 * US options-overlay ETFs: covered-call / derivative income vs buffer /
 * defined-outcome. Separate from the boutique thematic catalog.
 */

export type OverlayIssuerId =
  | "neos"
  | "innovator"
  | "ftvest"
  | "jpm"
  | "globalxcc"
  | "allianzim"
  | "calamos"
  | "amplifycc";

export type OverlayFamily = "income" | "buffer";

export type OverlayIssuer = {
  id: OverlayIssuerId;
  name: string;
  name_ko: string;
  family: OverlayFamily;
  founded: string;
  hq: string;
  fee_band: string;
  signature: string;
  playbook_ko: string;
  mechanic_ko: string;
  tax_ko: string;
  risk_ko: string;
  scores: {
    income: number;
    buffer: number;
    tax: number;
    upside: number;
    simplicity: number;
  };
};

export type OverlayProduct = {
  id: string;
  issuer: OverlayIssuerId;
  symbol: string;
  name: string;
  name_ko: string;
  family: OverlayFamily;
  sleeve: string;
  expense: string;
  blurb: string;
};

export type OverlayQuotePoint = {
  date: string;
  label: string;
  close: number;
};

export type OverlayProductQuote = OverlayProduct & {
  price: number | null;
  change_1d_pct: number | null;
  change_3m_pct: number | null;
  series: OverlayQuotePoint[];
  error?: string;
};

export type OverlaySeat = {
  issuer: OverlayIssuerId;
  symbol: string;
  note: string;
};

export type OverlayMatchup = {
  id: string;
  theme: string;
  theme_ko: string;
  alike: string;
  unlike: string;
  seats: OverlaySeat[];
};

export const OVERLAY_SCORE_AXES = [
  { key: "income", label: "인컴" },
  { key: "buffer", label: "버퍼" },
  { key: "tax", label: "절세" },
  { key: "upside", label: "상승 참여" },
  { key: "simplicity", label: "단순함" },
] as const;

export const OVERLAY_ISSUERS: OverlayIssuer[] = [
  {
    id: "neos",
    name: "NEOS",
    name_ko: "네오스",
    family: "income",
    founded: "2022",
    hq: "코네티컷",
    fee_band: "0.68%대",
    signature: "SPYI · QQQI",
    playbook_ko:
      "지수옵션으로 월분배를 뽑는 인컴 공장. 상품 수는 적고 펀드당 AUM이 두껍다. 2026년 골드만삭스가 인수해 이노베이터와 한 플랫폼으로 묶이는 중.",
    mechanic_ko:
      "S&P·나스닥 바스켓을 들고 SPX/NDX 콜스프레드를 판다. 가끔 콜을 되사 상승을 조금 연다.",
    tax_ko:
      "지수옵션이 섹션 1256(60/40)이라 과세계좌에서 JEPI보다 세후가 유리한 경우가 많다. 분배 일부는 자본반환(ROC)으로 잡히기도 함.",
    risk_ko: "분배율은 보장 아님. ROC는 과세 이연이지 공짜 수익이 아님.",
    scores: { income: 5, buffer: 1, tax: 5, upside: 3, simplicity: 4 },
  },
  {
    id: "jpm",
    name: "JPMorgan",
    name_ko: "JP모건",
    family: "income",
    founded: "2020",
    hq: "뉴욕",
    fee_band: "0.35%",
    signature: "JEPI · JEPQ",
    playbook_ko:
      "저변동 주식 + 은행 ELN으로 콜을 복제하는 대형 인컴. 유동성·트랙레코드가 카테고리 벤치마크.",
    mechanic_ko:
      "저변동 대형주를 액티브로 담고, ELN이 S&P/나스닥 OTM 콜 매도를 대신한다. 옵션을 펀드가 직접 쓰지 않음.",
    tax_ko:
      "ELN 프리미엄이 일반소득으로 넘어오는 비중이 큼. 과세계좌 최고세율에서는 SPYI보다 불리.",
    risk_ko: "상대방 은행 리스크(ELN). 강세장에선 콜 때문에 지수 대비 처짐이 큼.",
    scores: { income: 4, buffer: 1, tax: 2, upside: 3, simplicity: 5 },
  },
  {
    id: "globalxcc",
    name: "Global X",
    name_ko: "글로벌X",
    family: "income",
    founded: "2013",
    hq: "뉴욕",
    fee_band: "0.60%",
    signature: "QYLD · XYLD",
    playbook_ko:
      "Cboe 바이라이트 지수를 그대로 추종. ATM 콜을 매달 팔아 분배를 극대화하는 원조 커버드콜.",
    mechanic_ko:
      "나스닥100·S&P500 콜을 등가격(ATM)에 매도. 규칙이 단순해서 상승 캡이 사실상 매달 리셋됨.",
    tax_ko: "분배 성격이 혼재. 섹션 1256 설계는 아님.",
    risk_ko: "분배는 높아 보여도 NAV가 장기적으로 깎일 수 있음. 테크 강세장 소외가 큼.",
    scores: { income: 5, buffer: 1, tax: 2, upside: 1, simplicity: 5 },
  },
  {
    id: "amplifycc",
    name: "Amplify",
    name_ko: "앰플리파이",
    family: "income",
    founded: "2016",
    hq: "텍사스",
    fee_band: "0.55%",
    signature: "DIVO",
    playbook_ko:
      "퀄리티 배당주 바스켓에 콜을 선택적으로 얹어, 분배보다 토탈리턴에 가깝게 운용.",
    mechanic_ko:
      "전 종목에 콜을 깔지 않고 일부만. 커버드콜 중에서는 상승 참여가 가장 큰 편.",
    tax_ko: "배당+옵션 혼합. 네오스식 1256 구조는 아님.",
    risk_ko: "분배율이 낮아 ‘고배당’ 기대와 어긋날 수 있음.",
    scores: { income: 3, buffer: 1, tax: 2, upside: 4, simplicity: 4 },
  },
  {
    id: "innovator",
    name: "Innovator",
    name_ko: "이노베이터",
    family: "buffer",
    founded: "2014",
    hq: "시카고",
    fee_band: "0.79%",
    signature: "PJAN · BUFF",
    playbook_ko:
      "정의된 성과(defined outcome)의 원조. 월별 시리즈로 버퍼 9/15/30%를 찍어 171개까지 늘렸다. 골드만 인수(2026).",
    mechanic_ko:
      "FLEX 옵션으로 1년 성과 기간의 캡·버퍼를 고정. 콜을 팔아 받은 프리미엄으로 풋을 사 하락을 깎음.",
    tax_ko: "분배는 거의 없음. 성과는 주로 시세로. 인컴 상품이 아님.",
    risk_ko:
      "기간 중간에 사면 남은 버퍼·캡이 달라짐. 캡을 넘긴 강세장은 포기. 시리즈가 많아 고르기 어려움.",
    scores: { income: 2, buffer: 5, tax: 3, upside: 2, simplicity: 2 },
  },
  {
    id: "ftvest",
    name: "FT Vest",
    name_ko: "FT 베스트",
    family: "buffer",
    founded: "2020",
    hq: "일리노이 (First Trust)",
    fee_band: "0.85%대",
    signature: "FJAN · DJAN",
    playbook_ko:
      "퍼스트트러스트 × Cboe Vest. 이노베이터와 거의 같은 월별 버퍼 라인업으로 유통 네트워크를 씀.",
    mechanic_ko:
      "SPY FLEX 옵션으로 1년 버퍼(~10%) + 캡. 딥버퍼(5–30% 구간) 시리즈도 있음.",
    tax_ko: "이노베이터와 같이 분배보다 성과기간 페이오프.",
    risk_ko: "보수가 이노베이터보다 약간 높음. 구조는 사실상 동급이라 캡·스프레드로 갈림.",
    scores: { income: 1, buffer: 5, tax: 3, upside: 2, simplicity: 2 },
  },
  {
    id: "allianzim",
    name: "AllianzIM",
    name_ko: "알리안츠IM",
    family: "buffer",
    founded: "2020",
    hq: "미네소타",
    fee_band: "0.74%",
    signature: "AUGT",
    playbook_ko:
      "보험사 파생 데스크가 직접 FLEX를 짜는 버퍼10. 상품 수는 이노베이터보다 적고 기관 색깔.",
    mechanic_ko: "S&P500 1년 10% 버퍼 + 캡. 실행을 내부 데스크가 해서 캡이 1–2%p 다를 수 있음.",
    tax_ko: "정의된 성과. 월분배 상품 아님.",
    risk_ko: "일부 월 시리즈는 거래량이 얇음. 구조는 FT·이노베이터와 동일 카테고리.",
    scores: { income: 1, buffer: 4, tax: 3, upside: 2, simplicity: 3 },
  },
  {
    id: "calamos",
    name: "Calamos",
    name_ko: "칼라모스",
    family: "buffer",
    founded: "2023",
    hq: "일리노이",
    fee_band: "0.69%대",
    signature: "CPSM",
    playbook_ko:
      "‘알트 프로텍션’: 성과기간 동안 원금 0% 하단(시장이 아무리 빠져도 0%를 목표)과 타이트한 캡.",
    mechanic_ko:
      "버퍼 10–15%가 아니라 플로어 0%. 풋을 더 깊게 사서 상승 캡이 이노베이터 파워버퍼보다 낮아짐.",
    tax_ko: "정의된 성과. 분배 목적 아님.",
    risk_ko: "하락은 막아주지만 강세장 소외가 가장 큼. 기간 중 매수는 남은 플로어가 사라질 수 있음.",
    scores: { income: 1, buffer: 5, tax: 3, upside: 1, simplicity: 3 },
  },
];

export const OVERLAY_PRODUCTS: OverlayProduct[] = [
  { id: "spyi", issuer: "neos", symbol: "SPYI", name: "NEOS S&P 500 High Income", name_ko: "S&P 하이인컴", family: "income", sleeve: "S&P 인컴", expense: "0.68%", blurb: "SPX 콜스프레드 월분배. 과세계좌 커버드콜의 사실상 비교 기준." },
  { id: "qqqi", issuer: "neos", symbol: "QQQI", name: "NEOS Nasdaq-100 High Income", name_ko: "나스닥 하이인컴", family: "income", sleeve: "나스닥 인컴", expense: "0.68%", blurb: "QQQ 바스켓 + NDX 옵션. JEPQ·QYLD와 같은 전장." },
  { id: "jepi", issuer: "jpm", symbol: "JEPI", name: "JPMorgan Equity Premium Income", name_ko: "주식 프리미엄 인컴", family: "income", sleeve: "S&P 인컴", expense: "0.35%", blurb: "저변동 주식+ELN. 규모·유동성은 1위, 세금은 일반소득 비중이 큼." },
  { id: "jepq", issuer: "jpm", symbol: "JEPQ", name: "JPMorgan Nasdaq Equity Premium Income", name_ko: "나스닥 프리미엄 인컴", family: "income", sleeve: "나스닥 인컴", expense: "0.35%", blurb: "JEPI의 나스닥 버전. 보수 대비 분배가 두꺼움." },
  { id: "qyld", issuer: "globalxcc", symbol: "QYLD", name: "Global X Nasdaq-100 Covered Call", name_ko: "나스닥 커버드콜", family: "income", sleeve: "나스닥 인컴", expense: "0.60%", blurb: "ATM 바이라이트. 분배는 가장 높고 상승 캡은 가장 빡셈." },
  { id: "xyld", issuer: "globalxcc", symbol: "XYLD", name: "Global X S&P 500 Covered Call", name_ko: "S&P 커버드콜", family: "income", sleeve: "S&P 인컴", expense: "0.60%", blurb: "QYLD의 S&P 버전. ATM이라 JEPI·SPYI보다 상승 참여가 작음." },
  { id: "divo", issuer: "amplifycc", symbol: "DIVO", name: "Amplify CWP Enhanced Dividend Income", name_ko: "배당 강화 인컴", family: "income", sleeve: "S&P 인컴", expense: "0.55%", blurb: "퀄리티 배당 + 선택적 콜. 분배보다 토탈리턴형." },
  { id: "bjan", issuer: "innovator", symbol: "BJAN", name: "Innovator U.S. Equity Buffer January", name_ko: "버퍼 1월", family: "buffer", sleeve: "버퍼 10%", expense: "0.79%", blurb: "1년 성과기간, 첫 ~9–10% 하락을 깎고 캡을 게시." },
  { id: "pjan", issuer: "innovator", symbol: "PJAN", name: "Innovator U.S. Equity Power Buffer January", name_ko: "파워버퍼 1월", family: "buffer", sleeve: "버퍼 15%", expense: "0.79%", blurb: "버퍼 ~15%. 캡은 더 낮아짐. 대표 시리즈." },
  { id: "ujan", issuer: "innovator", symbol: "UJAN", name: "Innovator U.S. Equity Ultra Buffer January", name_ko: "울트라버퍼 1월", family: "buffer", sleeve: "버퍼 30%", expense: "0.79%", blurb: "보통 첫 5%는 노출, 그다음 ~30%를 버퍼. 하락 구간이 다름." },
  { id: "buff", issuer: "innovator", symbol: "BUFF", name: "Innovator Laddered Power Buffer", name_ko: "래더 파워버퍼", family: "buffer", sleeve: "래더", expense: "0.79%", blurb: "월별 파워버퍼를 한 티커에 나눠 담아 리셋 타이밍 리스크를 줄임." },
  { id: "fjan", issuer: "ftvest", symbol: "FJAN", name: "FT Vest U.S. Equity Buffer January", name_ko: "버퍼 1월", family: "buffer", sleeve: "버퍼 10%", expense: "0.85%", blurb: "이노베이터 BJAN과 같은 1월·10% 버퍼 전장. 캡·보수만 다름." },
  { id: "augt", issuer: "allianzim", symbol: "AUGT", name: "AllianzIM S&P 500 Buffer10 August", name_ko: "버퍼10 8월", family: "buffer", sleeve: "버퍼 10%", expense: "0.74%", blurb: "10% 버퍼의 알리안츠 버전. 월만 다르고 구조는 동일 카테고리." },
  { id: "cpsm", issuer: "calamos", symbol: "CPSM", name: "Calamos S&P 500 Structured Alt Protection May", name_ko: "알트 프로텍션 5월", family: "buffer", sleeve: "플로어 0%", expense: "0.69%", blurb: "성과기간 0% 하단 목표. 버퍼가 아니라 원금 플로어에 가깝다." },
];

export const OVERLAY_MATCHUPS: OverlayMatchup[] = [
  {
    id: "spx-income",
    theme: "S&P 500 income",
    theme_ko: "S&P 인컴",
    alike: "대형주 위에 콜을 팔아 현금흐름을 만든다. 강세장에선 지수보다 덜 오른다.",
    unlike: "JEPI는 ELN·저변동·싼 보수, SPYI는 지수옵션·절세, XYLD는 ATM 바이라이트, DIVO는 콜을 덜 판다.",
    seats: [
      { issuer: "jpm", symbol: "JEPI", note: "벤치마크 · 0.35% · 일반소득" },
      { issuer: "neos", symbol: "SPYI", note: "1256 옵션 · 월분배" },
      { issuer: "globalxcc", symbol: "XYLD", note: "ATM 규칙형" },
      { issuer: "amplifycc", symbol: "DIVO", note: "선택적 콜 · 토탈리턴" },
    ],
  },
  {
    id: "ndx-income",
    theme: "Nasdaq-100 income",
    theme_ko: "나스닥 인컴",
    alike: "나스닥100 베타 + 콜 매도. 테크 급등장에서 처지는 구조가 같다.",
    unlike: "JEPQ는 ELN, QQQI는 1256 스프레드, QYLD는 매달 ATM이라 캡이 가장 빡세다.",
    seats: [
      { issuer: "jpm", symbol: "JEPQ", note: "JEPI의 나스닥판" },
      { issuer: "neos", symbol: "QQQI", note: "SPYI의 나스닥판" },
      { issuer: "globalxcc", symbol: "QYLD", note: "ATM 바이라이트 원조" },
    ],
  },
  {
    id: "buffer-10",
    theme: "S&P ~10% buffer",
    theme_ko: "S&P 버퍼 10%",
    alike: "1년 성과기간, FLEX로 첫 ~10% 하락을 깎고 캡을 게시. 분배 목적 아님.",
    unlike: "차이점은 리셋 월, 게시 캡, 보수, 스프레드. 페이오프 식은 거의 같다.",
    seats: [
      { issuer: "innovator", symbol: "BJAN", note: "1월 시리즈 · 0.79%" },
      { issuer: "ftvest", symbol: "FJAN", note: "같은 1월 · 0.85%" },
      { issuer: "allianzim", symbol: "AUGT", note: "8월 시리즈 · 0.74%" },
    ],
  },
  {
    id: "protection-stack",
    theme: "How much downside you sell upside for",
    theme_ko: "보호 깊이",
    alike: "콜을 팔아 풋을 산다. 보호가 두꺼울수록 캡이 낮아진다.",
    unlike: "BJAN 10% → PJAN 15% → UJAN 30%(앞 5% 노출) → CPSM 0% 플로어. 인컴 ETF와는 다른 축.",
    seats: [
      { issuer: "innovator", symbol: "BJAN", note: "버퍼 ~10%" },
      { issuer: "innovator", symbol: "PJAN", note: "파워버퍼 ~15%" },
      { issuer: "innovator", symbol: "UJAN", note: "울트라 ~30%" },
      { issuer: "calamos", symbol: "CPSM", note: "플로어 0%" },
    ],
  },
];

export const OVERLAY_ALIKE = [
  "둘 다 콜을 팔아 ‘내일의 상승’을 담보로 잡는다. 강세장 소외는 구조적이다.",
  "기초는 거의 항상 S&P500 또는 나스닥100이다. 테마 주식 바스켓이 아니다.",
  "옵션 프리미엄은 변동성이 높을수록 두껍다. 2022 같은 해에 인컴·버퍼 모두 ‘달콤해’ 보인다.",
  "성과기간·월 리셋이 있는 상품은 중간에 사면 안내문에 적힌 버퍼/캡과 달라진다.",
];

export const OVERLAY_UNLIKE = [
  "커버드콜은 프리미엄을 현금으로 나눠 주고, 버퍼는 그 돈으로 풋을 사서 하락을 깎는다.",
  "NEOS·JPM·글로벌X는 월분배. 이노베이터·FT·알리안츠·칼라모스는 분배가 거의 없고 시세로 성과를 줌.",
  "세금: SPYI/QQQI는 지수옵션 1256, JEPI/JEPQ는 ELN 일반소득, 버퍼는 매매차익 중심.",
  "이노베이터·FT는 월별 시리즈가 수십 개(고르기 어려움). NEOS·JPM은 티커가 몇 개뿐.",
  "칼라모스 플로어 0%는 ‘버퍼 10%’가 아니다. 하락 전부 방어를 목표로 해서 캡이 더 낮다.",
  "글로벌X ATM은 분배율이 가장 높아 보이지만, OTM/스프레드(JEPI·SPYI)보다 상승을 더 많이 판다.",
];

export const OVERLAY_NOTE =
  "미국 옵션 오버레이 ETF. 버퍼는 정의된 성과(기간·캡·버퍼), 커버드콜은 월분배. 시세는 Yahoo 지연. 분배율·버퍼·캡은 보장되지 않습니다.";

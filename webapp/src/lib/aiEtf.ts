/**
 * AI-process ETFs: NLP / social sentiment / ML stock-picking.
 * Distinct from AI-theme ETFs that merely hold AI stocks (BOTZ, CHAT, AIQ).
 */

export type AiEtfKind = "nlp" | "factor_ml" | "value_ai" | "theme";
export type AiEtfListing = "us" | "kr";

export type AiEtfSpec = {
  id: string;
  symbol: string;
  yahoo: string;
  name: string;
  name_ko: string;
  issuer: string;
  listing: AiEtfListing;
  kind: AiEtfKind;
  expense: string;
  inception: string;
  aum_usd_mn: number;
  aum_as_of: string;
  holdings_n: string;
  bench: string;
  bench_yahoo: string;
  method_ko: string;
  tech_ko: string;
  read_ko: string;
  closed?: boolean;
  closed_note?: string;
};

export type AiEtfPoint = {
  date: string;
  label: string;
  close: number;
  indexed: number;
};

export type AiEtfQuote = AiEtfSpec & {
  price: number | null;
  volume: number | null;
  change_1d_pct: number | null;
  change_1y_pct: number | null;
  bench_1y_pct: number | null;
  excess_1y_pct: number | null;
  series: AiEtfPoint[];
  bench_series: AiEtfPoint[];
  error?: string;
};

export type AiEtfLens = {
  id: string;
  title: string;
  kind: AiEtfKind;
  summary: string;
  funds: string[];
  score_ko: string;
};

export type AiEtfPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  process: AiEtfQuote[];
  theme: AiEtfQuote[];
  lenses: AiEtfLens[];
  takeaways: string[];
  error?: string;
};

export const AI_ETF_KIND_KO: Record<AiEtfKind, string> = {
  nlp: "NLP·감성",
  factor_ml: "AI 종목피킹",
  value_ai: "AI 밸류",
  theme: "AI 테마",
};

export const AI_ETF_NOTE =
  "위 테이블은 ‘AI로 종목을 고른다’고 광고하는 프로세스형 ETF입니다. BOTZ·CHAT·AIQ처럼 AI 기업을 담는 테마 ETF와는 다릅니다. AUM은 공시 근사치, 수익률은 Yahoo 종가, 정렬은 AUM→거래량입니다.";

export const AI_ETF_PROCESS: AiEtfSpec[] = [
  {
    id: "aivl",
    symbol: "AIVL",
    yahoo: "AIVL",
    name: "WisdomTree U.S. AI Enhanced Value",
    name_ko: "위즈덤트리 AI 강화 밸류",
    issuer: "WisdomTree / Voya AI",
    listing: "us",
    kind: "value_ai",
    expense: "0.38%",
    inception: "2022 전환 (전신 DTN)",
    aum_usd_mn: 409,
    aum_as_of: "2026-06",
    holdings_n: "약 100",
    bench: "미국 밸류 (VTV)",
    bench_yahoo: "VTV",
    method_ko: "밸류 유니버스 안에서 Voya AI가 저평가·센티먼트·품질을 가려 중·대형주를 고릅니다.",
    tech_ko: "지도·비지도 학습 혼합의 팩터 스크리너. 뉴스 NLP가 핵심은 아님.",
    read_ko: "프로세스형 중 AUM이 가장 큼. 보수도 0.38%로 상대적으로 낮음. 순수 밸류 ETF(VTV 0.04%)보다는 비쌈.",
  },
  {
    id: "aieq",
    symbol: "AIEQ",
    yahoo: "AIEQ",
    name: "Amplify AI Powered Equity",
    name_ko: "앰플리파이 AI 파워드 에쿼티",
    issuer: "Amplify / EquBot",
    listing: "us",
    kind: "nlp",
    expense: "0.75%",
    inception: "2017-10",
    aum_usd_mn: 119,
    aum_as_of: "2026-09",
    holdings_n: "약 160",
    bench: "S&P 500 (SPY)",
    bench_yahoo: "SPY",
    method_ko: "EquBot 모델이 뉴스·소셜·공시·매크로를 읽어 미국 주식 유니버스에서 월간 리밸런싱합니다.",
    tech_ko: "IBM Watson 기반 NLP·감성분석 + 정량 피처. 섹터 비중은 바텀업으로 움직입니다.",
    read_ko: "가장 오래 된 ‘AI가 고른다’ 상품. 장기로는 SPY를 밑돈 구간이 길어 블랙박스 비판이 많음.",
  },
  {
    id: "buzz",
    symbol: "BUZZ",
    yahoo: "BUZZ",
    name: "VanEck Social Sentiment",
    name_ko: "반에크 소셜 센티먼트",
    issuer: "VanEck",
    listing: "us",
    kind: "nlp",
    expense: "0.75%",
    inception: "2021-03",
    aum_usd_mn: 87,
    aum_as_of: "2026-09",
    holdings_n: "75",
    bench: "S&P 500 (SPY)",
    bench_yahoo: "SPY",
    method_ko: "소셜·뉴스·블로그에서 긍정 언급이 지속된 미국 대형주 75종을 지수로 추적합니다.",
    tech_ko: "BUZZ NextGen AI US Sentiment Leaders. NLP로 온라인 텍스트를 집계, 단기 버스트가 아니라 지속 언급을 요구.",
    read_ko: "이름값·미디어 노출은 큼. 보유는 종종 고베타 테크·밈 쪽으로 기울어 SPY 대비 변동이 큼.",
  },
  {
    id: "amom",
    symbol: "AMOM",
    yahoo: "AMOM",
    name: "QRAFT AI-Enhanced U.S. Large Cap Momentum",
    name_ko: "크래프트 AI 대형주 모멘텀",
    issuer: "Qraft / Exchange Traded Concepts",
    listing: "us",
    kind: "factor_ml",
    expense: "0.75%",
    inception: "2019-05",
    aum_usd_mn: 22,
    aum_as_of: "2026-09",
    holdings_n: "약 50",
    bench: "모멘텀 (MTUM)",
    bench_yahoo: "MTUM",
    method_ko: "대형주 모멘텀 팩터를 딥러닝으로 종목·비중 최적화. 패시브 모멘텀(MTUM) 대비 초과를 표방.",
    tech_ko: "Qraft 딥뉴럴넷. 품질·사이즈·밸류·모멘텀·저변동 피처를 월간 재학습.",
    read_ko: "같은 하우스 QRFT보다 팩터가 분명함. AUM은 작고 스프레드·보수 부담이 큼.",
  },
  {
    id: "qrft",
    symbol: "QRFT",
    yahoo: "QRFT",
    name: "QRAFT AI-Enhanced U.S. Large Cap",
    name_ko: "크래프트 AI 미국 대형주",
    issuer: "Qraft / Exchange Traded Concepts",
    listing: "us",
    kind: "factor_ml",
    expense: "0.75%",
    inception: "2019-05",
    aum_usd_mn: 16,
    aum_as_of: "2026-07 청산",
    holdings_n: "최대 350",
    bench: "S&P 500 (SPY)",
    bench_yahoo: "SPY",
    method_ko: "미국 대형주를 가치·품질·모멘텀·사이즈·저변동 축에서 AI가 매달 고르고 비중을 바꿉니다.",
    tech_ko: "Qraft AI 엔진(딥러닝 팩터 배합). 액티브이지만 규칙 기반 월간 리밸런싱.",
    read_ko:
      "국내에 ‘AI 종목피킹 ETF’로 가장 자주 소개됐지만 AUM이 얇아 2026-07-24 청산됐습니다. 아래 1년 차트는 상장폐지 직전 구간입니다.",
    closed: true,
    closed_note: "2026-07-24 청산 (마지막 거래 2026-07-21)",
  },
  {
    id: "lqai",
    symbol: "LQAI",
    yahoo: "LQAI",
    name: "LG QRAFT AI-Powered U.S. Large Cap Core",
    name_ko: "LG 크래프트 AI 대형주 코어",
    issuer: "LG Qraft",
    listing: "us",
    kind: "factor_ml",
    expense: "0.75%",
    inception: "2023",
    aum_usd_mn: 2,
    aum_as_of: "2026-09",
    holdings_n: "100",
    bench: "S&P 500 (SPY)",
    bench_yahoo: "SPY",
    method_ko: "LG-Qraft DB가 대형주 100종을 골라 코어 노출. 최종 매매는 어드바이저 재량.",
    tech_ko: "QRFT와 같은 계열 AI 스크리너. 유니버스·종목 수는 코어 100으로 고정.",
    read_ko: "브랜드(LG)는 알려졌지만 규모는 실험 수준. 유동성·추종오차에 주의.",
  },
];

export const AI_ETF_THEME: AiEtfSpec[] = [
  {
    id: "aiq",
    symbol: "AIQ",
    yahoo: "AIQ",
    name: "Global X Artificial Intelligence & Technology",
    name_ko: "글로벌X 인공지능·테크",
    issuer: "Global X",
    listing: "us",
    kind: "theme",
    expense: "0.68%",
    inception: "2018-05",
    aum_usd_mn: 10120,
    aum_as_of: "2026-09",
    holdings_n: "약 80",
    bench: "Nasdaq-100 (QQQ)",
    bench_yahoo: "QQQ",
    method_ko: "AI·빅데이터 산업 분류 종목을 시총 가중. 알고리즘이 종목을 ‘골라’ 알파를 내는 구조가 아닙니다.",
    tech_ko: "Indxx/자체 테마 지수. 운용 AI 없음.",
    read_ko: "AI ETF 하면 규모·거래대금은 이쪽. 프로세스형(BUZZ·QRFT)과 비교 기준점.",
  },
  {
    id: "botz",
    symbol: "BOTZ",
    yahoo: "BOTZ",
    name: "Global X Robotics & Artificial Intelligence",
    name_ko: "글로벌X 로봇·인공지능",
    issuer: "Global X",
    listing: "us",
    kind: "theme",
    expense: "0.68%",
    inception: "2016-09",
    aum_usd_mn: 3310,
    aum_as_of: "2026-09",
    holdings_n: "약 50",
    bench: "Nasdaq-100 (QQQ)",
    bench_yahoo: "QQQ",
    method_ko: "로봇·자동화·AI 하드웨어 기업 바스켓.",
    tech_ko: "테마 지수. 종목선정 AI 없음.",
    read_ko: "가장 오래된 로봇/AI 테마. 산업 사이클에 민감.",
  },
  {
    id: "chat",
    symbol: "CHAT",
    yahoo: "CHAT",
    name: "Roundhill Generative AI & Technology",
    name_ko: "라운드힐 생성형 AI",
    issuer: "Roundhill",
    listing: "us",
    kind: "theme",
    expense: "0.75%",
    inception: "2023-05",
    aum_usd_mn: 1800,
    aum_as_of: "2026-09",
    holdings_n: "약 30",
    bench: "Nasdaq-100 (QQQ)",
    bench_yahoo: "QQQ",
    method_ko: "생성형 AI 밸류체인(모델·클라우드·반도체) 액티브/세미룰 바스켓.",
    tech_ko: "테마 선별. NLP로 포트폴리오를 돌리지는 않음.",
    read_ko: "ChatGPT 이후 유입. 프로세스형보다 인지도·거래가 큼.",
  },
  {
    id: "wtai",
    symbol: "WTAI",
    yahoo: "WTAI",
    name: "WisdomTree Artificial Intelligence & Innovation",
    name_ko: "위즈덤트리 AI·혁신",
    issuer: "WisdomTree",
    listing: "us",
    kind: "theme",
    expense: "0.45%",
    inception: "2021-12",
    aum_usd_mn: 250,
    aum_as_of: "2026-08",
    holdings_n: "약 70",
    bench: "Nasdaq-100 (QQQ)",
    bench_yahoo: "QQQ",
    method_ko: "AI·혁신 기업 지수. AIVL(같은 하우스의 AI 밸류 피킹)과 목적가 다름.",
    tech_ko: "테마 지수.",
    read_ko: "같은 WisdomTree라도 AIVL은 프로세스, WTAI는 테마.",
  },
];

export const AI_ETF_LENSES: AiEtfLens[] = [
  {
    id: "nlp",
    title: "NLP · 소셜 감성",
    kind: "nlp",
    summary:
      "뉴스·소셜 텍스트에서 긍정/부정 점수를 뽑아 종목 편입. BUZZ는 지수형(75종 지속 언급), AIEQ는 Watson NLP로 월간 액티브.",
    funds: ["BUZZ", "AIEQ"],
    score_ko:
      "아이디어는 직관적이나, 온라인 감성은 고베타·테크에 쏠리기 쉽고 보수 0.75%가 알파를 깎습니다. AIEQ는 5년 구간에서 SPY를 밑돈 기록이 있습니다.",
  },
  {
    id: "factor",
    title: "딥러닝 종목피킹",
    kind: "factor_ml",
    summary:
      "Qraft 계열(QRFT·AMOM·LQAI)은 전통 팩터를 신경망으로 배합해 매달 리밸런싱. ‘AI가 고른다’는 카피의 본진.",
    funds: ["QRFT", "AMOM", "LQAI"],
    score_ko:
      "QRFT는 2026-07 청산됐습니다. 남은 AMOM·LQAI는 일부 기간 벤치에 근접하지만 AUM이 수천만 달러 이하라 스프레드·상장폐지 리스크가 성과 이야기보다 먼저입니다.",
  },
  {
    id: "value",
    title: "AI 밸류 스크리너",
    kind: "value_ai",
    summary:
      "AIVL만 밸류 유니버스에 AI를 얹습니다. 테마 AI ETF나 소셜 감성과 달리 ‘싼 주식’ 안에서의 랭킹입니다.",
    funds: ["AIVL"],
    score_ko:
      "프로세스형 중 규모·보수 면에서 가장 현실적. 그래도 VTV 같은 초저보수 밸류 베타와 비교하면 AI 프리미엄(34bp+)을 회수해야 합니다.",
  },
  {
    id: "theme",
    title: "테마와 혼동하지 않기",
    kind: "theme",
    summary:
      "AIQ·BOTZ·CHAT은 AI 산업에 투자합니다. 운용 과정에 생성형 AI/NLP가 들어가 있지 않습니다. 거래대금·AUM은 프로세스형보다 한 자릿수 이상 큽니다.",
    funds: ["AIQ", "BOTZ", "CHAT", "WTAI"],
    score_ko:
      "‘AI ETF’ 검색 유입의 대부분은 여기로 갑니다. 벤치마크 초과는 반도체·빅테크 사이클 베타에 가깝습니다.",
  },
];

export const AI_ETF_TAKEAWAYS: string[] = [
  "프로세스형(BUZZ·AIEQ·AIVL) 합산 AUM도 대형 AI 테마 1종(AIQ, 약 $10B)에 한참 못 미칩니다. 인지도와 자금은 테마 쪽에 있습니다.",
  "QRFT는 국내에서 ‘AI 종목피킹’의 대표 사례로 자주 소개됐지만 2026-07-24 청산됐습니다. 스토리와 실제 자금 유입이 따로 움직인 증거입니다.",
  "보수 0.75%(AIVL만 0.38%)는 SPY(0.09%)·VTV(0.04%) 대비 두껍습니다. 장기 초과가 안 나면 AI 스토리만 남는 구조입니다.",
  "AIEQ는 가장 긴 트랙(2017~)이지만 다년 구간에서 SPY를 하회한 기록이 있어 ‘Watson = 알파’로 단정할 수 없습니다.",
  "국내 상장 ‘AI ETF’ 대부분은 반도체·빅테크 바스켓(테마)입니다. NLP·딥러닝으로 종목을 고르는 상장 상품은 사실상 미국 쪽에만 있습니다.",
  "성과 판정은 동일 벤치(대형=SPY, 밸류=VTV, 모멘텀=MTUM, 테마=QQQ) 대비 1년 초과로 이 탭에서 같이 봅니다.",
];

export function emptyAiEtfPayload(error?: string): AiEtfPayload {
  const blank = (spec: AiEtfSpec): AiEtfQuote => ({
    ...spec,
    price: null,
    volume: null,
    change_1d_pct: null,
    change_1y_pct: null,
    bench_1y_pct: null,
    excess_1y_pct: null,
    series: [],
    bench_series: [],
  });
  return {
    ok: !error,
    generated_at: new Date().toISOString(),
    note: AI_ETF_NOTE,
    process: AI_ETF_PROCESS.map(blank),
    theme: AI_ETF_THEME.map(blank),
    lenses: AI_ETF_LENSES,
    takeaways: AI_ETF_TAKEAWAYS,
    error,
  };
}

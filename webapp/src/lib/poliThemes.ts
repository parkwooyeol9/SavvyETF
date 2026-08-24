/**
 * US political-theme ETFs: partisan baskets, policy-sector proxies,
 * and filed-but-unlisted prediction-market (election betting) products.
 */

export type PartyLean = "D" | "R" | "bench";

export type PoliQuotePoint = {
  date: string;
  label: string;
  close: number;
};

export type PoliRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y";

export const POLI_RANGES: Array<{ id: PoliRange; label: string }> = [
  { id: "1d", label: "1일" },
  { id: "5d", label: "5일" },
  { id: "1mo", label: "1개월" },
  { id: "3mo", label: "3개월" },
  { id: "6mo", label: "6개월" },
  { id: "1y", label: "1년" },
];

export const POLI_YAHOO_QUERY: Record<
  PoliRange,
  { range: string; interval: string; maxBars: number }
> = {
  "1d": { range: "1d", interval: "5m", maxBars: 96 },
  "5d": { range: "5d", interval: "15m", maxBars: 120 },
  "1mo": { range: "1mo", interval: "60m", maxBars: 100 },
  "3mo": { range: "3mo", interval: "1d", maxBars: 80 },
  "6mo": { range: "6mo", interval: "1d", maxBars: 100 },
  "1y": { range: "1y", interval: "1d", maxBars: 120 },
};

export function parsePoliRange(raw: string | null | undefined): PoliRange {
  const v = (raw || "").trim();
  if ((POLI_RANGES as Array<{ id: string }>).some((r) => r.id === v)) {
    return v as PoliRange;
  }
  return "3mo";
}

export function poliIntervalLabel(range: PoliRange): string {
  switch (range) {
    case "1d":
      return "5분봉";
    case "5d":
      return "15분봉";
    case "1mo":
      return "1시간봉";
    default:
      return "일봉";
  }
}

export type PoliEtfQuote = {
  id: string;
  symbol: string;
  name: string;
  name_ko: string;
  party: PartyLean;
  group: "basket" | "sector";
  theme: string;
  thesis: string;
  issuer?: string;
  expense?: string;
  price: number | null;
  change_1d_pct: number | null;
  change_range_pct: number | null;
  vs_spy_range_pct: number | null;
  series?: PoliQuotePoint[];
  error?: string;
};

export type PipelineStatus = "sec-review" | "delayed" | "listed" | "reorg";

export type PoliPipelineFund = {
  id: string;
  issuer: string;
  ticker: string | null;
  name: string;
  name_ko: string;
  party: "D" | "R" | "both";
  race_ko: string;
  election_date: string;
  exchange: string;
  mechanic: string;
  status: PipelineStatus;
  status_ko: string;
  filed: string;
  target_launch?: string;
  note: string;
  listed: boolean;
  price: number | null;
  change_1d_pct: number | null;
};

export type PoliThemesPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  range: PoliRange;
  interval_label: string;
  spy_change_range_pct: number | null;
  nanc_kruz_spread: number | null;
  demz_maga_spread: number | null;
  baskets: PoliEtfQuote[];
  sectors_d: PoliEtfQuote[];
  sectors_r: PoliEtfQuote[];
  pipeline: PoliPipelineFund[];
  warnings: string[];
  error?: string;
};

export type PoliEtfSpec = {
  id: string;
  symbol: string;
  name: string;
  name_ko: string;
  party: PartyLean;
  group: "basket" | "sector";
  theme: string;
  thesis: string;
  issuer?: string;
  expense?: string;
};

export const POLI_BASKET_SPECS: PoliEtfSpec[] = [
  {
    id: "nanc",
    symbol: "NANC",
    name: "Unusual Whales Subversive Democratic Trading ETF",
    name_ko: "민주당 의원 매매 추종",
    party: "D",
    group: "basket",
    theme: "의회 공시",
    thesis: "STOCK Act 공시 기준, 현역 민주 의원·가족이 매수한 상장주를 액티브로 복제.",
    issuer: "Subversive / Unusual Whales",
    expense: "0.75%",
  },
  {
    id: "demz",
    symbol: "DEMZ",
    name: "Democratic Large Cap Core ETF",
    name_ko: "민주당 정치기부 대형주",
    party: "D",
    group: "basket",
    theme: "PAC 기부",
    thesis: "S&P 500 안에서 민주 후보·PAC 기부 비중이 높은 대형주를 지수 추종.",
    issuer: "Democracy Investment",
    expense: "0.45%",
  },
  {
    id: "kruz",
    symbol: "KRUZ",
    name: "Unusual Whales Subversive Republican Trading ETF",
    name_ko: "공화당 의원 매매 추종",
    party: "R",
    group: "basket",
    theme: "의회 공시",
    thesis: "STOCK Act 공시 기준, 현역 공화 의원·가족이 매수한 상장주를 액티브로 복제.",
    issuer: "Subversive / Unusual Whales",
    expense: "0.75%",
  },
  {
    id: "maga",
    symbol: "MAGA",
    name: "Point Bridge America First ETF",
    name_ko: "공화당 친화 America First",
    party: "R",
    group: "basket",
    theme: "PAC·임직원 기부",
    thesis: "임직원·PAC가 공화 후보를 더 지원하는 미국 기업. 2026.5 Truth Social America First로 재편 추진.",
    issuer: "Point Bridge",
    expense: "0.72%",
  },
  {
    id: "yall",
    symbol: "YALL",
    name: "God Bless America ETF",
    name_ko: "보수 가치 스크리닝",
    party: "R",
    group: "basket",
    theme: "가치 스크리닝",
    thesis: "Amplify 보수·미국 가치 스크린. 명시적 GOP 바스켓은 아니지만 공화 테마로 묶여 거래된다.",
    issuer: "Amplify",
    expense: "0.65%",
  },
];

export const POLI_SECTOR_SPECS: PoliEtfSpec[] = [
  {
    id: "icln",
    symbol: "ICLN",
    name: "iShares Global Clean Energy",
    name_ko: "글로벌 클린에너지",
    party: "D",
    group: "sector",
    theme: "에너지전환",
    thesis: "IRA·보조금·재생 의무화가 민주 의석·백악관에 민감.",
  },
  {
    id: "tan",
    symbol: "TAN",
    name: "Invesco Solar ETF",
    name_ko: "태양광",
    party: "D",
    group: "sector",
    theme: "에너지전환",
    thesis: "세액공제·관세 예외가 민주 에너지 정책의 핵심 수혜.",
  },
  {
    id: "grid",
    symbol: "GRID",
    name: "First Trust NASDAQ Clean Edge Smart Grid",
    name_ko: "스마트그리드",
    party: "D",
    group: "sector",
    theme: "전력망",
    thesis: "송전·그리드 캡엑스는 산업정책·IRA 연속성에 연동.",
  },
  {
    id: "idrv",
    symbol: "IDRV",
    name: "iShares Self-Driving EV and Tech",
    name_ko: "EV·자율주행",
    party: "D",
    group: "sector",
    theme: "모빌리티",
    thesis: "EV 세액공제·배출 규제. 공화 집권 시 보조금 삭감 리스크.",
  },
  {
    id: "xbi",
    symbol: "XBI",
    name: "SPDR S&P Biotech",
    name_ko: "바이오텍",
    party: "D",
    group: "sector",
    theme: "헬스케어",
    thesis: "FDA·NIH 예산, 약가 협상 범위가 민주 헬스케어 입법의 축.",
  },
  {
    id: "pbw",
    symbol: "PBW",
    name: "Invesco WilderHill Clean Energy",
    name_ko: "클린에너지 고베타",
    party: "D",
    group: "sector",
    theme: "에너지전환",
    thesis: "소형 클린에너지. 중간선거·보조금 뉴스에 탄력 큼.",
  },
  {
    id: "xle",
    symbol: "XLE",
    name: "Energy Select Sector SPDR",
    name_ko: "에너지 메이저",
    party: "R",
    group: "sector",
    theme: "화석연료",
    thesis: "시추 허가·환경 규제 롤백 기대가 공화 수혜의 대표 축.",
  },
  {
    id: "xop",
    symbol: "XOP",
    name: "SPDR S&P Oil & Gas Exploration",
    name_ko: "상류 석유가스",
    party: "R",
    group: "sector",
    theme: "화석연료",
    thesis: "E&P. 허가 속도와 메탄 규제에 민감.",
  },
  {
    id: "ita",
    symbol: "ITA",
    name: "iShares U.S. Aerospace & Defense",
    name_ko: "항공·방산",
    party: "R",
    group: "sector",
    theme: "국방",
    thesis: "국방수권법·인도태평양 예산. 양당 테마이나 공화 매파에 더 민감.",
  },
  {
    id: "xlf",
    symbol: "XLF",
    name: "Financial Select Sector SPDR",
    name_ko: "금융",
    party: "R",
    group: "sector",
    theme: "규제완화",
    thesis: "도드프랭크·자본규제 완화, 감세 연장 기대.",
  },
  {
    id: "kre",
    symbol: "KRE",
    name: "SPDR S&P Regional Banking",
    name_ko: "지방은행",
    party: "R",
    group: "sector",
    theme: "규제완화",
    thesis: "중형은행 규제 문턱. 공화 금융위원장 구도에 민감.",
  },
  {
    id: "ura",
    symbol: "URA",
    name: "Global X Uranium ETF",
    name_ko: "우라늄·원전",
    party: "R",
    group: "sector",
    theme: "에너지안보",
    thesis: "원전·우라늄은 에너지 독립 담론. 양당  overlap이지만 허가 속도는 공화에 우호적.",
  },
];

export const POLI_PIPELINE_SPECS: Array<
  Omit<PoliPipelineFund, "listed" | "price" | "change_1d_pct">
> = [
  {
    id: "blup",
    issuer: "Roundhill",
    ticker: "BLUP",
    name: "Roundhill Democratic President ETF",
    name_ko: "민주 대통령 2028",
    party: "D",
    race_ko: "2028 대선",
    election_date: "2028-11-07",
    exchange: "NYSE Arca",
    mechanic: "Kalshi 이벤트 계약 스왑. 패배 시 거의 전액 손실 후 다음 사이클로 롤.",
    status: "delayed",
    status_ko: "SEC 심사 지연",
    filed: "2026-02",
    target_launch: "2026-05-05 (예정 무산)",
    note: "당초 5/5 상장 목표. SEC가 밸류에이션·공시·결제 추가 자료를 요구하며 보류.",
  },
  {
    id: "redp",
    issuer: "Roundhill",
    ticker: "REDP",
    name: "Roundhill Republican President ETF",
    name_ko: "공화 대통령 2028",
    party: "R",
    race_ko: "2028 대선",
    election_date: "2028-11-07",
    exchange: "NYSE Arca",
    mechanic: "Kalshi 이벤트 계약 스왑. 패배 시 거의 전액 손실 후 다음 사이클로 롤.",
    status: "delayed",
    status_ko: "SEC 심사 지연",
    filed: "2026-02",
    target_launch: "2026-05-05 (예정 무산)",
    note: "BLUP의 반대 포지션. 바이너리 결제($1/$0).",
  },
  {
    id: "blus",
    issuer: "Roundhill",
    ticker: "BLUS",
    name: "Roundhill Democratic Senate ETF",
    name_ko: "민주 상원 2026",
    party: "D",
    race_ko: "2026 상원 지배권",
    election_date: "2026-11-03",
    exchange: "NYSE Arca",
    mechanic: "중간선거 상원 지배권 이벤트 계약. 패배 시 2028 상원으로 롤.",
    status: "delayed",
    status_ko: "SEC 심사 지연",
    filed: "2026-02",
    target_launch: "2026-05-05 (예정 무산)",
    note: "중간선거 상원 스윙과 직결. 상장되면 NANC·업종 프록시와 교차 모니터.",
  },
  {
    id: "reds",
    issuer: "Roundhill",
    ticker: "REDS",
    name: "Roundhill Republican Senate ETF",
    name_ko: "공화 상원 2026",
    party: "R",
    race_ko: "2026 상원 지배권",
    election_date: "2026-11-03",
    exchange: "NYSE Arca",
    mechanic: "중간선거 상원 지배권 이벤트 계약. 패배 시 2028 상원으로 롤.",
    status: "delayed",
    status_ko: "SEC 심사 지연",
    filed: "2026-02",
    target_launch: "2026-05-05 (예정 무산)",
    note: "KRUZ·XLE 등과 같은 방향 베팅이 될 수 있으나 구조는 주식 바스켓이 아님.",
  },
  {
    id: "bluh",
    issuer: "Roundhill",
    ticker: "BLUH",
    name: "Roundhill Democratic House ETF",
    name_ko: "민주 하원 2026",
    party: "D",
    race_ko: "2026 하원 지배권",
    election_date: "2026-11-03",
    exchange: "NYSE Arca",
    mechanic: "중간선거 하원 지배권 이벤트 계약.",
    status: "delayed",
    status_ko: "SEC 심사 지연",
    filed: "2026-02",
    target_launch: "2026-05-05 (예정 무산)",
    note: "역사적으로 대통령 정당이 하원을 잃는 사이클. 제네릭 발롯과 함께 볼 것.",
  },
  {
    id: "redh",
    issuer: "Roundhill",
    ticker: "REDH",
    name: "Roundhill Republican House ETF",
    name_ko: "공화 하원 2026",
    party: "R",
    race_ko: "2026 하원 지배권",
    election_date: "2026-11-03",
    exchange: "NYSE Arca",
    mechanic: "중간선거 하원 지배권 이벤트 계약.",
    status: "delayed",
    status_ko: "SEC 심사 지연",
    filed: "2026-02",
    target_launch: "2026-05-05 (예정 무산)",
    note: "공화 하원 방어 시나리오. 바이너리라 주식형 수혜 ETF와 손익 곡선이 다름.",
  },
  {
    id: "bitwise-slate",
    issuer: "Bitwise (PredictionShares)",
    ticker: null,
    name: "PredictionShares 6-fund slate",
    name_ko: "PredictionShares 6종 슬레이트",
    party: "both",
    race_ko: "대선·상원·하원 동일 6종",
    election_date: "2026-11-03",
    exchange: "NYSE Arca",
    mechanic: "동일 바이너리 구조. 결과 확정 후 펀드 종료(롤오버 없음).",
    status: "delayed",
    status_ko: "SEC 심사 지연",
    filed: "2026-02",
    target_launch: "2026-05 (75일 자동효력 무산)",
    note: "Roundhill과 같은 6개 선거 결과. 티커 미확정. 종료형이라 패배 시 잔여 롤이 없음.",
  },
  {
    id: "granite-slate",
    issuer: "GraniteShares",
    ticker: null,
    name: "GraniteShares election event ETFs",
    name_ko: "GraniteShares 선거 이벤트 6종",
    party: "both",
    race_ko: "대선·상원·하원 동일 6종",
    election_date: "2026-11-03",
    exchange: "NYSE Arca",
    mechanic: "Roundhill과 같이 다음 사이클로 롤오버.",
    status: "delayed",
    status_ko: "SEC 심사 지연",
    filed: "2026-02",
    target_launch: "2026-05 (75일 자동효력 무산)",
    note: "발행사 3곳이 24개 이상 예측시장 ETF를 동시에 제출. SEC가 일괄 보류.",
  },
];

export const POLI_THEMES_NOTE =
  "상장 상품은 Yahoo 일봉. 수혜 분류는 운용 문서·정책 민감도 기준의 모니터용 프레임이며 투자 조언이 아닙니다. 정치베팅 ETF는 패배 시 원금 거의 전액 손실 구조입니다.";

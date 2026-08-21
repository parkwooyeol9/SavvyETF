/**
 * 2026 US midterms dashboard — chamber control, race ratings, and market implications.
 *
 * Live odds: Polymarket.
 * National polls: Silver Bulletin / FLIPR (Nate Silver, 538 successor).
 * Race ratings: consensus of Cook / 270toWin / Decision Desk HQ as of the
 * curated snapshot date — overlaid with prediction-market prices.
 * Daily 07:00 KST snapshot persisted to R2.
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

export const MIDTERM_ELECTION_DATE = "2026-11-03";
export const MIDTERM_ELECTION_LABEL = "2026년 11월 3일 (화)";

export type Party = "D" | "R";

export type RaceRating =
  | "safe-d"
  | "likely-d"
  | "lean-d"
  | "toss-up"
  | "lean-r"
  | "likely-r"
  | "safe-r";

export type SeatBucket = {
  id: string;
  label: string;
  seats_low: number;
  seats_high: number;
  probability: number | null;
  change_1w: number | null;
};

export type ChamberMarket = {
  chamber: "senate" | "house";
  dem_prob: number | null;
  gop_prob: number | null;
  volume: number | null;
  change_1w_dem: number | null;
  change_1m_dem: number | null;
  updated_at?: string;
};

export type CandidateProfile = {
  name: string;
  party: Party;
  role: string;
  wiki: string;
  photo_url?: string | null;
  bio: string;
  values: string;
  slogan: string;
  market_if_wins: string;
};

export type PowerSplit = {
  id: string;
  label: string;
  label_ko: string;
  probability: number | null;
  change_1m: number | null;
};

export type SenateRace = {
  id: string;
  state: string;
  state_ko: string;
  rating: RaceRating;
  held_by: Party;
  special?: boolean;
  open?: boolean;
  incumbent?: string;
  dem: string;
  gop: string;
  note: string;
  /** Single biggest policy split between the two nominees. */
  policy_issue: string;
  policy_d: string;
  policy_r: string;
  market_implication: string;
  related_tickers: string[];
  dem_profile?: CandidateProfile;
  gop_profile?: CandidateProfile;
  slug?: string;
  dem_prob?: number | null;
  gop_prob?: number | null;
  volume?: number | null;
  change_1w_dem?: number | null;
};

export type RaceChip = {
  state: string;
  rating: RaceRating;
  special?: boolean;
};

export type MidtermEtf = {
  id: string;
  symbol: string;
  label: string;
  angle: string;
  price: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  error?: string;
};

export type MidtermHeadline = {
  title: string;
  link?: string;
  source: string;
  published?: string;
};

export type MidtermPayload = {
  ok: boolean;
  generated_at: string;
  election_date: string;
  days_to_election: number;
  note: string;
  composition: {
    senate_r: number;
    senate_d: number;
    senate_to_flip: number;
    house_r: number;
    house_d: number;
    house_ind: number;
    house_vacant: number;
    house_majority: number;
  };
  national: {
    generic_ballot_d: number;
    generic_ballot_r: number;
    generic_ballot_lv_d: number;
    generic_ballot_lv_r: number;
    trump_approve: number;
    trump_disapprove: number;
    as_of: string;
    source: string;
    source_url: string;
  };
  senate: ChamberMarket | null;
  house: ChamberMarket | null;
  power: PowerSplit[];
  seat_histogram: SeatBucket[];
  races: SenateRace[];
  map: RaceChip[];
  etfs: MidtermEtf[];
  headlines: MidtermHeadline[];
  history: Array<{
    year: number;
    president_party: Party;
    house_net: number;
    senate_net: number;
    note: string;
  }>;
  sources: Array<{ name: string; url: string; role: string }>;
  warnings: string[];
  schedule_note: string;
  snapshot_kst?: string;
  from_cache?: boolean;
  error?: string;
};

export const RATING_ORDER: RaceRating[] = [
  "safe-d",
  "likely-d",
  "lean-d",
  "toss-up",
  "lean-r",
  "likely-r",
  "safe-r",
];

export const RATING_LABEL: Record<RaceRating, string> = {
  "safe-d": "안전 민주",
  "likely-d": "유력 민주",
  "lean-d": "기울 민주",
  "toss-up": "경합",
  "lean-r": "기울 공화",
  "likely-r": "유력 공화",
  "safe-r": "안전 공화",
};

/** Daily 07:00 KST (= 22:00 UTC previous calendar day). */
export const MIDTERM_R2_LATEST_KEY = "us-midterm/latest.json";
export const MIDTERM_SCHEDULE_NOTE =
  "매일 07:00 KST 스냅샷. 예측시장·헤드라인·ETF 가격을 아침 한 번 고정합니다.";

export const POLYMARKET_EVENTS = {
  senate: "which-party-will-win-the-senate-in-2026",
  house: "which-party-will-win-the-house-in-2026",
  power: "balance-of-power-2026-midterms",
  seats: "republican-senate-seats-after-the-2026-midterm-elections-927",
} as const;

/** Competitive + watchlist Senate races. Ratings: Cook / 270toWin / DDHQ consensus, Aug 20 2026. */
export const SENATE_RACES: SenateRace[] = [
  {
    id: "me",
    state: "ME",
    state_ko: "메인",
    rating: "toss-up",
    held_by: "R",
    incumbent: "Susan Collins",
    dem: "Troy Jackson",
    gop: "Susan Collins",
    note: "6선 공화 현역. 예측시장은 민주 우세.",
    policy_issue: "노동권·최저임금 vs 규제완화 스윙보트",
    policy_d:
      "잭슨(전 AFL-CIO 메인 의장)은 단체교섭 강화, 연방 최저임금 인상, 메디케어 약가 협상을 전면에 둔다.",
    policy_r:
      "콜린스는 재계 친화적 규제 속도 조절과 필리버스터 유지에 가깝고, 대형 노동법 개편에는 제동을 거는 편이다.",
    market_implication:
      "잭슨 승리는 NLRB·노동비용 민감 소매·물류(IWM, XRT)에 부담, 약가 협상 강화는 대형 제약(XLV, XBI) 디스카운트. 콜린스 잔류는 상원 스윙보트·인준 일정 예측 가능성을 유지해 금융·헬스케어 규제 프리미엄을 낮춘다.",
    related_tickers: ["IWM", "XLV", "XBI"],
    slug: "maine-senate-election-winner",
  },
  {
    id: "tx",
    state: "TX",
    state_ko: "텍사스",
    rating: "toss-up",
    held_by: "R",
    open: true,
    incumbent: "John Cornyn (경선 패배)",
    dem: "James Talarico",
    gop: "Ken Paxton",
    note: "쿡 8/20 Lean R → Toss-up. 탤러리코 모금 우위.",
    policy_issue: "화석연료·ESG 소송 vs 에너지 전환·기후 적응",
    policy_d:
      "탤러리코는 텍사스 석유·가스 일자리를 인정하면서도 IRA형 보조금, 홍수·정전 대비, 재생·송전 투자를 병행한다.",
    policy_r:
      "팩스턴은 검찰총장으로서 EPA·ESG 공시를 소송으로 막아 온 화석연료 방어 노선이고, 연방 환경규제 롤백을 상원에서도 이어갈 가능성이 크다.",
    market_implication:
      "팩스턴 승리는 텍사스 상류·중류(XLE, XOP, KMI)와 반ESG 금융 소송 테마에 우호적. 탤러리코 승리는 송전·재생(ICLN, GRID)과 재해보험·유틸리티 캡엑스에 가산점, 반대로 공격적 시추 규제 완화 기대는 꺾인다.",
    related_tickers: ["XLE", "XOP", "ICLN", "GRID"],
    slug: "texas-senate-election-winner",
  },
  {
    id: "oh",
    state: "OH",
    state_ko: "오하이오",
    rating: "toss-up",
    held_by: "R",
    special: true,
    incumbent: "Jon Husted",
    dem: "Sherrod Brown",
    gop: "Jon Husted",
    note: "밴스 잔여임기 보궐. 브라운 전 상원의원 복귀.",
    policy_issue: "산업정책·노조 vs 법인세·규제 완화",
    policy_d:
      "브라운은 철강 관세, CHIPS, 노조 조직화(PRO Act 계열)로 제조 리쇼어링을 밀어온 포퓰리스트 민주 노선이다.",
    policy_r:
      "허스테드는 오하이오 상공회의소형 감세·규제완화, 에너지 증산 쪽에 가깝고 대규모 산업보조금에는 선택적이다.",
    market_implication:
      "브라운 복귀는 철강·자동차·방산 공급망(X, NUE, F, GM, XLI)과 노조 임금 인상에 민감한 제조 마진을 동시에 움직인다. 허스테드 잔류는 법인세·규제 완화 기대(IWM, XLF)를 유지하고 관세 확대 리스크를 줄인다.",
    related_tickers: ["XLI", "F", "GM", "IWM"],
    slug: "ohio-senate-election-winner",
  },
  {
    id: "ia",
    state: "IA",
    state_ko: "아이오와",
    rating: "toss-up",
    held_by: "R",
    open: true,
    incumbent: "Joni Ernst (불출마)",
    dem: "Josh Turek",
    gop: "Ashley Hinson",
    note: "쿡 8/20 Lean R → Toss-up.",
    policy_issue: "농업보조금·에탄올·IRA 농촌 에너지",
    policy_d:
      "투렉은 농가 소득 안정, 바이오연료 혼합 의무, IRA 농촌 재생·송전 자금을 지키는 쪽에 가깝다.",
    policy_r:
      "힌슨은 규제 축소와 대중국 농산물 수출·감세를 강조하고, 기후 보조금 규모에는 비판적이다.",
    market_implication:
      "에탄올·곡물 크러셔(ADM, BG), 농기계(DE), 바이오연료 크레딧이 민감하다. 민주 승리는 RIN·IRA 농촌 캡엑스 지속, 공화 승리는 보조금 삭감 리스크와 동시에 대중국 관세 협상 변수가 커진다.",
    related_tickers: ["DE", "ADM", "DBA"],
    slug: "iowa-senate-election-winner",
  },
  {
    id: "ak",
    state: "AK",
    state_ko: "알래스카",
    rating: "toss-up",
    held_by: "R",
    incumbent: "Dan Sullivan",
    dem: "Mary Peltola",
    gop: "Dan Sullivan",
    note: "펠톨라 전 하원의원. 순위선택투표.",
    policy_issue: "북극·ANWR 시추 vs 어업·원주민 자원 보전",
    policy_d:
      "펠톨라는 연어·저인망 어업과 원주민 생계를 우선하고, 대규모 북극 시추·광산에는 조건부·제한적이다.",
    policy_r:
      "설리번은 에너지 안보·북극 시추·군 주둔 확대를 묶어 석유·방산 예산을 밀어온 매파 노선이다.",
    market_implication:
      "설리번 잔류는 알래스카 상류·파이프라인(XOM, CVX, XLE)과 방산(ITA, RTX)에 우호적. 펠톨라 승리는 시추 허가 지연·환경심사 강화로 에너지 업사이드를 깎고, 어업·해운 규제와 희토·광산 인허가 속도를 재가격한다.",
    related_tickers: ["XLE", "XOM", "ITA"],
    slug: "alaska-senate-election-winner",
  },
  {
    id: "mi",
    state: "MI",
    state_ko: "미시간",
    rating: "lean-d",
    held_by: "D",
    open: true,
    incumbent: "Gary Peters (불출마)",
    dem: "Abdul El-Sayed",
    gop: "Mike Rogers",
    note: "진보 엘사이드 경선 승리. 민주 방어 부담.",
    policy_issue: "약가·공적 의료 vs 대중 견제·방산",
    policy_d:
      "엘사이드(전 보건국장)는 약가 직접 협상, 공적 옵션에 가깝고 자동차 노조·EV 전환 지원을 묶는다.",
    policy_r:
      "로저스는 전 하원 정보위원장으로 대중 반도체·방산 공급망을 강경하게 재편하고, 약가 통제에는 제약 친화적이다.",
    market_implication:
      "엘사이드 승리는 대형 제약·PBM(XLV, MCK, LLY) 규제 프리미엄과 UAW 임금 민감 완성차(GM, F) 마진을 동시에 흔든다. 로저스 승리는 방산·대중 디커플링(ITA, SMH, KWEB 역방향)에 가산점이다.",
    related_tickers: ["XLV", "GM", "ITA", "SMH"],
    slug: "michigan-senate-election-winner",
  },
  {
    id: "ga",
    state: "GA",
    state_ko: "조지아",
    rating: "lean-d",
    held_by: "D",
    incumbent: "Jon Ossoff",
    dem: "Jon Ossoff",
    gop: "Mike Collins",
    note: "쿡은 경합, 다른 전망은 민주 기울. 콜린스 경선 승리.",
    policy_issue: "연방 투자·물류 허브 vs 감세·반규제",
    policy_d:
      "오소프는 하츠필드·항구·반도체·IRA 제조 인센티브를 애틀랜타 물류 허브와 연결해 왔다.",
    policy_r:
      "콜린스는 트럼프 라인의 재정지출 삭감, 강경 이민·에너지 증산, 문화 이슈를 앞세운다.",
    market_implication:
      "오소프 잔류는 물류·항공·데이터센터 캡엑스(FDX, UPS, DLR)와 조지아 EV·배터리 공급망에 연속성. 콜린스 승리는 재정지출·이민 노동공급 리스크로 물류 비용과 소매 마진을 재평가하게 한다.",
    related_tickers: ["FDX", "UPS", "XLI"],
    slug: "georgia-senate-election-winner",
  },
  {
    id: "nc",
    state: "NC",
    state_ko: "노스캐롤라이나",
    rating: "lean-d",
    held_by: "R",
    open: true,
    incumbent: "Thom Tillis (불출마)",
    dem: "Roy Cooper",
    gop: "Michael Whatley",
    note: "쿠퍼 전 주지사. 민주 탈환 1순위.",
    policy_issue: "메디케이드 확대·생명과학 vs 감세·당 기구형 보수",
    policy_d:
      "쿠퍼 주지사 시절 메디케이드 확대와 RTP 생명과학·금융 유치를 병행한 중도 민주 노선이다.",
    policy_r:
      "와틀리(전 RNC 의장)는 전국 공화 메시지—감세 연장, 규제 완화, 문화 이슈—를 상원에 이식할 가능성이 크다.",
    market_implication:
      "쿠퍼 승리는 지역 은행·바이오(BAC, XLF, XBI, IQV)와 메디케이드 수혜 병원주 연속성. 와틀리 승리는 2025 이후 감세 일몰 연장 확률을 높여 금융·소형주에 우호적이고, 공공보험 확대 기대는 꺾인다.",
    related_tickers: ["XLF", "XBI", "IWM"],
    slug: "north-carolina-senate-election-winner",
  },
  {
    id: "nh",
    state: "NH",
    state_ko: "뉴햄프셔",
    rating: "likely-d",
    held_by: "D",
    open: true,
    incumbent: "Jeanne Shaheen (불출마)",
    dem: "Dem. nominee",
    gop: "GOP nominee",
    note: "샤힌 불출마. 동북부 블루 주 방어.",
    policy_issue: "ACA·클린에너지 vs 감세 연장",
    policy_d:
      "민주 공천은 ACA 보조금 연장, 뉴잉글랜드 송전·해상풍력을 지키는 쪽에 가깝다.",
    policy_r:
      "공화 공천은 연방 지출 삭감과 개인·법인세 감세 연장을 전면에 둘 가능성이 크다.",
    market_implication:
      "민주 수성은 관리형 케어·병원(XLV, UNH)과 해상풍력·송전(ICLN, AEP) 정책 연속성. 공화 업셋은 감세 연장 확률을 높이지만 ACA 보조금 일몰 리스크로 보험주 변동성을 키운다.",
    related_tickers: ["XLV", "ICLN"],
    slug: "new-hampshire-senate-election-winner",
  },
  {
    id: "ne",
    state: "NE",
    state_ko: "네브래스카",
    rating: "lean-r",
    held_by: "R",
    incumbent: "Pete Ricketts",
    dem: "Dan Osborn",
    gop: "Pete Ricketts",
    note: "오스본 무소속·노동 캠페인. 공화 기울.",
    policy_issue: "철도·노동 안전 vs 농식품 대기업 규제완화",
    policy_d:
      "오스본(철도 노조 출신, 사실상 반기업 노동 캠페인)은 철도 안전 규제, 독점 육가공 견제, 농가 교섭력을 내세운다.",
    policy_r:
      "리켓츠(콘아그라 가문)는 농식품 밸류체인·감세·규제 완화, 친기업 노선이다.",
    market_implication:
      "오스본 이변은 1급 철도(UNP, NSC, CSX) 인건비·안전 캡엑스와 육가공(TSN, HRL) 마진에 부담. 리켓츠 잔류는 농식품 대기업과 철도 규제 현상 유지에 가깝다.",
    related_tickers: ["UNP", "NSC", "TSN"],
    slug: "nebraska-senate-election-winner",
  },
];

/** All 35 seats (33 Class II + FL/OH specials) for the rating board. */
export const SENATE_MAP: RaceChip[] = [
  { state: "CO", rating: "safe-d" },
  { state: "DE", rating: "safe-d" },
  { state: "IL", rating: "safe-d" },
  { state: "MA", rating: "safe-d" },
  { state: "NJ", rating: "safe-d" },
  { state: "NM", rating: "safe-d" },
  { state: "OR", rating: "safe-d" },
  { state: "RI", rating: "safe-d" },
  { state: "VA", rating: "safe-d" },
  { state: "MN", rating: "likely-d" },
  { state: "NH", rating: "likely-d" },
  { state: "GA", rating: "lean-d" },
  { state: "MI", rating: "lean-d" },
  { state: "NC", rating: "lean-d" },
  { state: "AK", rating: "toss-up" },
  { state: "IA", rating: "toss-up" },
  { state: "ME", rating: "toss-up" },
  { state: "OH", rating: "toss-up", special: true },
  { state: "TX", rating: "toss-up" },
  { state: "NE", rating: "lean-r" },
  { state: "FL", rating: "likely-r", special: true },
  { state: "KS", rating: "likely-r" },
  { state: "LA", rating: "likely-r" },
  { state: "MS", rating: "likely-r" },
  { state: "MT", rating: "likely-r" },
  { state: "SC", rating: "likely-r" },
  { state: "AL", rating: "safe-r" },
  { state: "AR", rating: "safe-r" },
  { state: "ID", rating: "safe-r" },
  { state: "KY", rating: "safe-r" },
  { state: "OK", rating: "safe-r" },
  { state: "SD", rating: "safe-r" },
  { state: "TN", rating: "safe-r" },
  { state: "WV", rating: "safe-r" },
  { state: "WY", rating: "safe-r" },
];

export const MIDTERM_ETF_SPECS: Array<{
  id: string;
  symbol: string;
  label: string;
  angle: string;
}> = [
  { id: "spy", symbol: "SPY", label: "S&P 500", angle: "중간선거 전후 미국 주식" },
  { id: "xlf", symbol: "XLF", label: "금융", angle: "규제·금리·도드프랭크" },
  { id: "xle", symbol: "XLE", label: "에너지", angle: "시추·환경 규제 스윙" },
  { id: "xlv", symbol: "XLV", label: "헬스케어", angle: "메디케어·약가·ACA" },
  { id: "icln", symbol: "ICLN", label: "클린에너지", angle: "IRA·보조금 지속 여부" },
  { id: "ita", symbol: "ITA", label: "방산", angle: "예산·전쟁 권한 견제" },
  { id: "iwm", symbol: "IWM", label: "소형주", angle: "법인세·관세 민감" },
  { id: "kweb", symbol: "KWEB", label: "중국 인터넷", angle: "대중 관세·디커플링" },
];

export const NATIONAL_SNAPSHOT = {
  generic_ballot_d: 53.35,
  generic_ballot_r: 46.65,
  generic_ballot_lv_d: 54.05,
  generic_ballot_lv_r: 45.95,
  trump_approve: 38.1,
  trump_disapprove: 58.2,
  as_of: "2026-08-20",
  source: "Silver Bulletin (FLIPR)",
  source_url:
    "https://www.natesilver.net/p/nate-silver-2026-midterm-election-polls-model",
};

export const CURRENT_COMPOSITION = {
  senate_r: 53,
  senate_d: 47,
  senate_to_flip: 4,
  house_r: 218,
  house_d: 212,
  house_ind: 1,
  house_vacant: 4,
  house_majority: 218,
};

export const MIDTERM_HISTORY: MidtermPayload["history"] = [
  { year: 1994, president_party: "D", house_net: -54, senate_net: -8, note: "Gingrich 혁명" },
  { year: 1998, president_party: "D", house_net: 5, senate_net: 0, note: "탄핵 역풍" },
  { year: 2002, president_party: "R", house_net: 8, senate_net: 2, note: "9/11 이후" },
  { year: 2006, president_party: "R", house_net: -30, senate_net: -6, note: "이라크 전쟁" },
  { year: 2010, president_party: "D", house_net: -63, senate_net: -6, note: "티파티" },
  { year: 2014, president_party: "D", house_net: -13, senate_net: -9, note: "오바마 2기" },
  { year: 2018, president_party: "R", house_net: -40, senate_net: 2, note: "블루 웨이브" },
  { year: 2022, president_party: "D", house_net: -9, senate_net: 1, note: "예상보다 약한 레드 웨이브" },
];

export const MIDTERM_SOURCES: MidtermPayload["sources"] = [
  {
    name: "Silver Bulletin / FLIPR",
    url: "https://www.natesilver.net/p/nate-silver-2026-midterm-election-polls-model",
    role: "제네릭 발롯·대선 지지율",
  },
  {
    name: "Cook Political Report",
    url: "https://www.cookpolitical.com/",
    role: "상원 경합 등급 (8/20 TX·IA 경합 격상)",
  },
  {
    name: "270toWin",
    url: "https://www.270towin.com/2026-senate-election/consensus-2026-senate-forecast",
    role: "6개 전망 합의 지도",
  },
];

/** Named general-election matchups for the bottom dossier. NH omitted until nominees lock. */
export const CANDIDATE_DOSSIERS: Record<
  string,
  { dem: CandidateProfile; gop: CandidateProfile }
> = {
  me: {
    dem: {
      name: "Troy Jackson",
      party: "D",
      role: "전 메인 상원 의장 · 5대째 벌목꾼",
      wiki: "Troy_Jackson",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Troy_Jackson_in_the_Senate_Chamber_%28cropped%29.jpg/330px-Troy_Jackson_in_the_Senate_Chamber_%28cropped%29.jpg",
      bio: "1968년 포트켄트 출생. 북부 아루스툭 벌목 노동자로 일하다 주상원(2008–14, 2016–24)에 입성했고 2018–24 상원의장·원내대표를 지냈다. 2026 주지사 경선 패배 뒤, 플래트너 사퇴 공석을 메워 민주 상원 후보가 됐다.",
      values: "노동조합·최저임금·농촌 공공서비스. 진보 민주당이지만 공화 우세 북부 출신이라 ‘일하는 메인’ 정체성을 강조한다.",
      slogan: "Working people first — 벌목꾼이 워싱턴에 간다",
      market_if_wins:
        "상원 스윙보트가 노동 쪽으로 이동. NLRB·최저임금 기대에 IWM·소매 마진 부담, 약가 협상 강화로 XLV 변동. 콜린스 잔류 대비 인준·필리버스터 예측 가능성은 낮아진다.",
    },
    gop: {
      name: "Susan Collins",
      party: "R",
      role: "현 상원의원 (1997–) · 6선",
      wiki: "Susan_Collins",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Senator_Susan_Collins_2014_official_portrait.jpg/330px-Senator_Susan_Collins_2014_official_portrait.jpg",
      bio: "1952년 캐리부 출생. 메인 출신 온건 공화로 1996년 상원에 당선된 뒤 30년 가까이 재임. 대법관 인준·초당 예산에서 캐스팅보트 역할을 해 왔다. 2008·2020처럼 민주 우세 사이클에서도 생존한 기록이 있다.",
      values: "초당주의, 필리버스터 유지, 재계 친화 규제 속도 조절. ‘독립적 메인 목소리’를 브랜드로 쓴다.",
      slogan: "An independent voice for Maine",
      market_if_wins:
        "현상 유지. 금융·헬스케어 규제 급변 기대가 꺾이고, 인준 일정과 초당 지출법의 예측 가능성이 유지된다. XLF·XLV에 안정 프리미엄.",
    },
  },
  tx: {
    dem: {
      name: "James Talarico",
      party: "D",
      role: "텍사스 하원의원 · 신학생",
      wiki: "James_Talarico",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/James_Talarico_Press_Conference_%28cropped%29.jpg/330px-James_Talarico_Press_Conference_%28cropped%29.jpg",
      bio: "1990년대생 라운드록 출신. 전직 중등 교사로 2018년 주하원에 입성, 2026 상원 민주 후보. 기록적 모금으로 콘린을 꺾은 팩스턴을 일반선거에서 상대한다. 기독교 신앙을 내세우되 기독교 민족주의에는 반대한다.",
      values: "생활비·반부패, 재생산권, 기후 적응과 송전. 석유·가스 일자리는 인정하면서 IRA형 보조금을 병행한다.",
      slogan: "Not for sale — 텍사스 사람을 위해",
      market_if_wins:
        "텍사스 상원 민주 탈환은 에너지 규제·ESG 소송 환경이 바뀐다는 신호. ICLN·GRID·유틸 캡엑스에 가산점, XLE 시추 완화 기대는 후퇴. 헬스케어·IVF 관련주도 재평가.",
    },
    gop: {
      name: "Ken Paxton",
      party: "R",
      role: "텍사스 검찰총장 (2015–) · GOP 지명자",
      wiki: "Ken_Paxton",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/K_Paxton.jpg/330px-K_Paxton.jpg",
      bio: "콜린 카운티 출신 변호사. 2015년부터 검찰총장. EPA·ESG 공시·이민 정책을 소송으로 막아 온 강경 보수. 2023 탄핵 소추 후 주상원이 무죄, 2026 상원 경선에서 현역 콘린을 꺾었다.",
      values: "화석연료 방어, 반ESG, 강경 이민·낙태 제한, 트럼프 노선. ‘텍사스 주권’을 연방 규제에 대입한다.",
      slogan: "America First. Defend Texas.",
      market_if_wins:
        "상류·중류 에너지(XLE, XOP, KMI)와 반ESG 금융 소송 테마에 우호적. 연방 환경·공시 규제 롤백 기대로 에너지 밸류에이션 상방, 클린에너지 보조금 지속 기대는 할인.",
    },
  },
  oh: {
    dem: {
      name: "Sherrod Brown",
      party: "D",
      role: "전 오하이오 상원의원 (2007–25)",
      wiki: "Sherrod_Brown",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Sherrod_Brown_117th_Congress_%282%29.jpg/330px-Sherrod_Brown_117th_Congress_%282%29.jpg",
      bio: "1952년  Mansfield 출생. 하원·주 공직을 거쳐 2006년 상원 당선, 2024 낙선. 2026 밴스 잔여임기 보궐에 복귀. 철강 관세·CHIPS·노조를 묶어 온 산업 포퓰리스트.",
      values: "제조 리쇼어링, 노조 조직화, 약가·무역 보호. ‘월가가 아닌 노동자’ 프레임.",
      slogan: "Fighting for workers",
      market_if_wins:
        "철강·자동차·방산 공급망(XLI, F, GM)에 산업정책 프리미엄. 동시에 관세·노조 임금 기대로 제조 마진·수입 소매는 부담. IWM은 혼조.",
    },
    gop: {
      name: "Jon Husted",
      party: "R",
      role: "현 상원의원 (밴스 잔여임기) · 전 부지사",
      wiki: "Jon_Husted",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Sen._Jon_Husted_official_portrait%2C_119th_Congress.jpg/330px-Sen._Jon_Husted_official_portrait%2C_119th_Congress.jpg",
      bio: "오하이오 주하원 의장·국무장관·부지사를 지낸 주 공화 엘리트. 밴스 부통령 취임 후 임명·보선으로 상원에 올랐고 2026 잔여임기를 지킨다.",
      values: "감세·규제완화, 일자리 유치, 에너지 증산. 상공회의소형 성장 담론.",
      slogan: "Results for Ohio",
      market_if_wins:
        "법인세·규제 완화 기대 유지(IWM, XLF). 브라운 복귀 대비 관세 확대 리스크가 줄어 수입 공급망·자동차 부품에 상대적 안도.",
    },
  },
  ia: {
    dem: {
      name: "Josh Turek",
      party: "D",
      role: "아이오와 하원의원 · 휠체어 농구 국가대표 출신",
      wiki: "Josh_Turek",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/Joshua_Turek_%28cropped_2%29.jpg/330px-Joshua_Turek_%28cropped_2%29.jpg",
      bio: "1979년 카운슬블러프스 출생. 휠체어 농구 선수로 국제대회에 출전한 뒤 2022년 6표 차로 주하원에 당선된 첫 상임 장애인 의원. 2026 상원 민주 경선에서 자크 왈스를 꺾었다. 스스로를 프레리 포퓰리스트로 부른다.",
      values: "장애·메디케이드 근로 인센티브, 농가 소득, 바이오연료. 트럼프 우세 지구에서 이긴 중도 민주.",
      slogan: "Prairie populist — Work without Worry",
      market_if_wins:
        "에탄올·RIN·IRA 농촌 에너지 지속 기대로 ADM·DE·바이오연료 크레딧에 가산점. 농업보조금 개편 리스크는 낮아진다.",
    },
    gop: {
      name: "Ashley Hinson",
      party: "R",
      role: "연방 하원의원 (IA-2, 2021–)",
      wiki: "Ashley_Hinson",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Congresswoman_Ashley_Hinson_Official_portrait.jpg/330px-Congresswoman_Ashley_Hinson_Official_portrait.jpg",
      bio: "전 지역 앵커 출신. 2020년 하원 당선 후 농업·국경 이슈를 전면에 둔 트럼프 동맹 보수. 언스트 불출마로 열린 상원 공화 지명을 가져갔다.",
      values: "농가·소기업 감세, 규제 축소, 대중국 농산물 수출. 기후 보조금 규모에는 비판적.",
      slogan: "Iowa values. Farm families first.",
      market_if_wins:
        "보조금 삭감·규제 완화 기대로 농기계·곡물 메이저에 혼조. 대중국 관세 협상이 변수라 DBA·ADM 변동성이 커질 수 있다.",
    },
  },
  ak: {
    dem: {
      name: "Mary Peltola",
      party: "D",
      role: "전 하원의원 (2022–25) · 유픽",
      wiki: "Mary_Peltola",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Mary_Peltola_Congressional_Member_Portrait_%282%29.jpeg/330px-Mary_Peltola_Congressional_Member_Portrait_%282%29.jpeg",
      bio: "알래스카 원주민 유픽. 주하원을 거쳐 2022 보선에서 하원에 입성했으나 2024 낙선. 어업·원주민 생계를 전면에 두고 설리번을 상대한다. 순위선택투표 주.",
      values: "연어·저인망 어업, 원주민 자원, 조건부 개발. 초당적 실용 이미지.",
      slogan: "For all Alaskans",
      market_if_wins:
        "북극 시추·ANWR 허가 지연 기대로 XOM·CVX·XLE 알래스카 업사이드 할인. 어업·해운 규제와 광산 인허가 속도가 재가격된다.",
    },
    gop: {
      name: "Dan Sullivan",
      party: "R",
      role: "현 상원의원 (2015–) · 해병 예비역",
      wiki: "Dan_Sullivan_(U.S._senator)",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/Senator_Dan_Sullivan_official.jpg/330px-Senator_Dan_Sullivan_official.jpg",
      bio: "알래스카 법무장관·천연자원장관을 지낸 뒤 2014년 상원 당선. 에너지 안보와 인도-태평양 군 주둔을 묶어 온 매파.",
      values: "북극 시추, 자원 개발, 국방 예산. 중국·러시아 견제.",
      slogan: "Strong Alaska — energy and security",
      market_if_wins:
        "상류 에너지와 방산(ITA, RTX)에 우호적. 시추 허가·군 캡엑스 연속성으로 XLE 옵션 가치가 유지된다.",
    },
  },
  mi: {
    dem: {
      name: "Abdul El-Sayed",
      party: "D",
      role: "전염병학자 · 전 디트로이트 보건국장",
      wiki: "Abdul_El-Sayed",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Abdul_El-Sayed_meet-and-greet_by_Conlan_Houston_5_%28cropped%29.jpg/330px-Abdul_El-Sayed_meet-and-greet_by_Conlan_Houston_5_%28cropped%29.jpg",
      bio: "1984년생, 미시간대·옥스퍼드·컬럼비아 의대. 디트로이트 보건국장으로 플린트 수질 사태를 비판하며 2018 주지사 경선 2위. 피터스 은퇴 뒤 2026 상원 민주 지명.",
      values: "약가 직접 협상, 공적 의료, 노조·EV 전환. 진보 보건 포퓰리즘.",
      slogan: "Healthcare is a human right. Not for sale.",
      market_if_wins:
        "대형 제약·PBM(XLV, MCK) 규제 프리미엄 확대, UAW 임금 민감 완성차(GM, F) 마진 재평가. 메디케어 약가 협상 기대가 실적 할인으로 붙는다.",
    },
    gop: {
      name: "Mike Rogers",
      party: "R",
      role: "전 하원 정보위원장 · 2024 상원 후보",
      wiki: "Mike_Rogers_(Michigan_politician)",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Rogers_Mike_32711599270_%28cropped%29.jpg/330px-Rogers_Mike_32711599270_%28cropped%29.jpg",
      bio: "FBI 출신. 미시간 하원의원을 지냈고 정보위원장으로서 대중 견제·방산을 브랜드화. 2024 상원 낙선 뒤 2026에 재도전.",
      values: "중국 반도체 디커플링, 방산, 정보·국토안보. 약가 통제에는 제약 친화적.",
      slogan: "National security first",
      market_if_wins:
        "방산·대중 디커플링(ITA, SMH)에 가산점. KWEB 등 중국 익스포저는 상대 약세. 헬스케어 규제 충격은 엘사이드 대비 제한적.",
    },
  },
  ga: {
    dem: {
      name: "Jon Ossoff",
      party: "D",
      role: "현 상원의원 (2021–)",
      wiki: "Jon_Ossoff",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Jon_Ossoff_Senate_Portrait_2021.jpg/330px-Jon_Ossoff_Senate_Portrait_2021.jpg",
      bio: "1987년생 다큐멘터리 제작자 출신. 2021 결선에서 상원에 입성해 조지아 연방 투자를 물류·반도체·IRA 제조와 연결해 왔다. 2026 재선.",
      values: "인프라·첨단제조 인센티브, 거버넌스 감시, 중도 민주.",
      slogan: "A new generation of leadership",
      market_if_wins:
        "애틀랜타 물류·항공·데이터센터 캡엑스(FDX, UPS, DLR)와 EV 공급망 연속성. 연방 투자 회수 리스크가 낮아진다.",
    },
    gop: {
      name: "Mike Collins",
      party: "R",
      role: "하원의원 (GA-10, 2023–)",
      wiki: "Mike_Collins_(politician)",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Rep._Mike_Collins_official_photo%2C_118th_Congress.jpg/330px-Rep._Mike_Collins_official_photo%2C_118th_Congress.jpg",
      bio: "트럭 운송 사업가 출신. 2022년 하원 당선, 트럼프 지지로 2026 상원 공화 경선·결선에서 승리. 강경 이민·문화 이슈를 전면에 둔다.",
      values: "재정지출 삭감, 에너지 증산, 강경 이민. MAGA 보수.",
      slogan: "America First Georgia",
      market_if_wins:
        "재정지출·이민 노동공급 리스크로 물류 비용·소매 마진 재평가. 에너지 규제 완화 기대는 XLE에 부분 상쇄 요인.",
    },
  },
  nc: {
    dem: {
      name: "Roy Cooper",
      party: "D",
      role: "전 노스캐롤라이나 주지사 (2017–25)",
      wiki: "Roy_Cooper",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Roy_Cooper_in_November_2023_%28cropped2%29.jpg/330px-Roy_Cooper_in_November_2023_%28cropped2%29.jpg",
      bio: "주 법무장관을 거쳐 2016년 주지사 당선, 메디케이드 확대와 RTP 생명과학·금융 유치를 병행한 중도 민주. 틸리스 불출마 상원에 도전.",
      values: "실용 행정, 메디케이드, 기업 유치. 전국 이념전보다 주 성과.",
      slogan: "Get things done for North Carolina",
      market_if_wins:
        "지역 은행·바이오(XLF, XBI, IQV)와 병원주 연속성. 공공보험 확대 기대가 유지된다.",
    },
    gop: {
      name: "Michael Whatley",
      party: "R",
      role: "전 RNC 의장",
      wiki: "Michael_Whatley",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Michael_Whatley_%2854670563614%29_%28cropped%29.jpg/330px-Michael_Whatley_%2854670563614%29_%28cropped%29.jpg",
      bio: "노스캐롤라이나 출신 에너지 변호사. 주당 위원장을 거쳐 RNC 의장으로서 트럼프 재선 기구를 운영했다. 2026 상원 공화 지명.",
      values: "감세 연장, 규제 완화, 전국 공화 메시지. 에너지 로 출신 규제 회의론.",
      slogan: "America First — North Carolina",
      market_if_wins:
        "2025 이후 감세 일몰 연장 확률 상승 → IWM·XLF에 우호적. 메디케이드 확대 기대는 꺾인다.",
    },
  },
  ne: {
    dem: {
      name: "Dan Osborn",
      party: "D",
      role: "철도 기계공 · 노동 캠페인 (무소속 성향)",
      wiki: "Dan_Osborn",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Osborn_Headshot_2_%28cropped%29.jpg/330px-Osborn_Headshot_2_%28cropped%29.jpg",
      bio: "유니온 퍼시픽 기계공·파업 지도자 출신. 2024 상원에서 선전한 뒤 2026 재도전. 당적보다 ‘일하는 사람’ 정체성으로 농촌 공화 주를 흔든다.",
      values: "철도 안전, 독점 육가공 견제, 농가 교섭력. 반기득권 노동.",
      slogan: "I'm a working person, not a politician",
      market_if_wins:
        "1급 철도(UNP, NSC, CSX) 인건비·안전 캡엑스 부담, 육가공(TSN) 마진 압박. 노동 규제 재가격.",
    },
    gop: {
      name: "Pete Ricketts",
      party: "R",
      role: "현 상원의원 · 전 주지사 · 콘아그라 가문",
      wiki: "Pete_Ricketts",
      photo_url:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Sen._Pete_Ricketts_official_portrait%2C_118th_Congress.jpg/330px-Sen._Pete_Ricketts_official_portrait%2C_118th_Congress.jpg",
      bio: "콘아그라 창업 가문. TD 아메리트레이드 임원을 거쳐 주지사(2015–23), 2023 상원 임명·보선. 농식품 밸류체인과 친기업 보수를 대표한다.",
      values: "감세, 규제 완화, 농식품 수출. 대기업형 성장.",
      slogan: "Nebraska growth and conservative values",
      market_if_wins:
        "철도·농식품 대기업 규제 현상 유지. UNP·TSN에 안정, 노동 캠페인 리스크 제거.",
    },
  },
};

export function daysToElection(now = new Date()): number {
  const end = Date.UTC(2026, 10, 3);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function ratingTone(rating: RaceRating): "d" | "r" | "toss" {
  if (rating === "toss-up") return "toss";
  return rating.endsWith("-d") ? "d" : "r";
}

export function partyProbLabel(p: Party): string {
  return p === "D" ? "민주" : "공화";
}

export function fmtPctPoints(n?: number | null, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtSignedPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}pp`;
}

export function fmtUsdCompact(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function emptyMidtermPayload(error?: string): MidtermPayload {
  return {
    ok: !error,
    generated_at: new Date().toISOString(),
    election_date: MIDTERM_ELECTION_DATE,
    days_to_election: daysToElection(),
    note: "예측시장·폴링 평균·전문가 등급을 한 화면에 모았습니다. 투자·선거 조언이 아닙니다.",
    composition: { ...CURRENT_COMPOSITION },
    national: { ...NATIONAL_SNAPSHOT },
    senate: null,
    house: null,
    power: [],
    seat_histogram: [],
    races: SENATE_RACES.map((r) => ({ ...r })),
    map: SENATE_MAP,
    etfs: MIDTERM_ETF_SPECS.map((s) => ({
      ...s,
      price: null,
      change_1d_pct: null,
      change_5d_pct: null,
    })),
    headlines: [],
    history: MIDTERM_HISTORY,
    sources: MIDTERM_SOURCES,
    warnings: [],
    schedule_note: MIDTERM_SCHEDULE_NOTE,
    error,
  };
}

export function kstDateHour(now = new Date()): { ymd: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

export function formatKstStamp(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** True if snapshot already covers today's 07:00 KST window. */
export function isMidtermSnapshotCurrent(generatedAt: string, now = new Date()): boolean {
  const generated = new Date(generatedAt);
  const ageMs = now.getTime() - generated.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 26 * 3600_000) return false;
  const { ymd, hour } = kstDateHour(now);
  const snap = kstDateHour(generated).ymd;
  if (hour < 7) return true;
  return snap === ymd;
}

export async function loadCachedMidterm(): Promise<MidtermPayload | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(MIDTERM_R2_LATEST_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as MidtermPayload;
    if (!data?.ok) return null;
    return { ...data, from_cache: true };
  } catch {
    return null;
  }
}

export async function persistMidtermPayload(payload: MidtermPayload): Promise<MidtermPayload> {
  const stamped: MidtermPayload = {
    ...payload,
    schedule_note: MIDTERM_SCHEDULE_NOTE,
    snapshot_kst: kstDateHour().ymd,
    from_cache: false,
  };
  if (!r2Configured() || !stamped.ok) return stamped;
  try {
    const body = Buffer.from(JSON.stringify(stamped), "utf8");
    await r2PutObject(
      MIDTERM_R2_LATEST_KEY,
      body,
      "application/json; charset=utf-8",
      "public, max-age=300",
    );
    await r2PutObject(
      `us-midterm/snapshots/${stamped.snapshot_kst}.json`,
      body,
      "application/json; charset=utf-8",
      "public, max-age=86400",
    );
  } catch {
    /* ignore missing R2 */
  }
  return stamped;
}

function mergeProfile(
  live: CandidateProfile | undefined,
  curated: CandidateProfile | undefined,
): CandidateProfile | undefined {
  if (!curated) return live;
  return {
    ...curated,
    photo_url: curated.photo_url || live?.photo_url || null,
  };
}

/** Reattach curated policy copy and candidate dossiers if an older snapshot omitted them. */
export function hydrateRacePolicy(races: SenateRace[]): SenateRace[] {
  const byId = new Map(SENATE_RACES.map((r) => [r.id, r]));
  return races.map((race) => {
    const base = byId.get(race.id);
    const dossier = CANDIDATE_DOSSIERS[race.id];
    if (!base && !dossier) return race;
    return {
      ...race,
      policy_issue: race.policy_issue || base?.policy_issue || "",
      policy_d: race.policy_d || base?.policy_d || "",
      policy_r: race.policy_r || base?.policy_r || "",
      market_implication: race.market_implication || base?.market_implication || "",
      related_tickers: race.related_tickers?.length
        ? race.related_tickers
        : base?.related_tickers || [],
      dem_profile: mergeProfile(race.dem_profile, dossier?.dem),
      gop_profile: mergeProfile(race.gop_profile, dossier?.gop),
    };
  });
}

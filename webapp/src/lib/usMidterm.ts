/**
 * 2026 US midterms dashboard — FiveThirtyEight-style chamber control,
 * race ratings, and market implications.
 *
 * Live odds: Polymarket (538 also used betting markets as a cross-check).
 * National polls: Silver Bulletin / FLIPR (Nate Silver, 538 successor).
 * Race ratings: consensus of Cook / 270toWin / Decision Desk HQ as of the
 * curated snapshot date — overlaid with live prediction-market prices.
 */

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
  url: string;
  updated_at?: string;
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
  slug?: string;
  dem_prob?: number | null;
  gop_prob?: number | null;
  volume?: number | null;
  change_1w_dem?: number | null;
  url?: string;
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
    name: "Polymarket",
    url: "https://polymarket.com/event/which-party-will-win-the-senate-in-2026",
    role: "실시간 지배권·경합주 확률",
  },
  {
    name: "Silver Bulletin / FLIPR",
    url: "https://www.natesilver.net/p/nate-silver-2026-midterm-election-polls-model",
    role: "제네릭 발롯·대선 지지율 (538 후신)",
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
    error,
  };
}

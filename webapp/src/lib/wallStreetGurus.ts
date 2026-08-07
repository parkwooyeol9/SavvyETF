/**
 * Wall Street gurus — curated roster + public-headline ideas for the 월가 구루 tab.
 * Hedge-fund cards are ordered by approximate AUM (desc). Headlines come from
 * public Google News RSS (incl. MarketWatch / major wires when indexed).
 */

export type GuruCategory = "investor" | "hedge_fund";

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

  const byGuru = new Map<string, GuruHeadline[]>();
  for (const g of GURU_ROSTER) byGuru.set(g.id, []);

  const seen = new Set<string>();
  for (const item of rawItems) {
    const title = item.title.trim();
    if (!title) continue;
    const key = title.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);

    const assigned =
      item.guru_id && GURU_ROSTER.find((g) => g.id === item.guru_id);
    const guru =
      (assigned && matchesGuru(title, assigned) ? assigned : null) ||
      GURU_ROSTER.find((g) => matchesGuru(title, g));
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

  const allIdeas = [...byGuru.values()].flat();
  allIdeas.sort((a, b) => b.attention_score - a.attention_score);
  const highlighted = allIdeas.slice(0, 8);

  const withNews = [...hedge_funds, ...investors].filter((d) => d.ideas.length);
  const summary = [
    `브리핑 기준(KST) ${as_of_kst} 07:00 · 구루 ${GURU_ROSTER.length}명`,
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
    roster: [
      ...sortedHedgeFundRoster(),
      ...investorRoster(),
    ],
    sources_note:
      "Google News RSS · MarketWatch 등 메이저 매체 인덱싱 기사 우선 가중",
  };
}

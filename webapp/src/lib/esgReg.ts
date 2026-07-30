/**
 * ESG Regulation Monitor — curated events + optional public RSS.
 * No paid API keys required for the core panel.
 *
 * Status taxonomy and momentum scoring follow the product brief:
 * proposal / consultation / adopted / effective / amended / delayed /
 * withdrawn / court_challenged
 */

export type EsgRegStatus =
  | "proposal"
  | "consultation"
  | "adopted"
  | "effective"
  | "amended"
  | "delayed"
  | "withdrawn"
  | "court_challenged";

export type EsgRegJurisdiction =
  | "ISSB"
  | "EU"
  | "US"
  | "KR"
  | "JP"
  | "SG"
  | "HK"
  | "OTHER";

export type EsgRegFramework =
  | "ISSB"
  | "CSRD"
  | "ESRS"
  | "SFDR"
  | "Taxonomy"
  | "CBAM"
  | "CSDDD"
  | "ESMA"
  | "SEC"
  | "US_STATE"
  | "KR_DISCLOSURE"
  | "K_TAXONOMY"
  | "K_ETS"
  | "GREEN_BOND"
  | "ASIA_TAXONOMY"
  | "OTHER";

/** Momentum contribution for a single reviewed event. */
export type EsgRegMomentumDelta = -2 | -1 | 0 | 1 | 2;

export type EsgRegEvent = {
  id: string;
  date: string; // YYYY-MM-DD (event / milestone date)
  jurisdiction: EsgRegJurisdiction;
  framework: EsgRegFramework;
  status: EsgRegStatus;
  title_ko: string;
  title_en: string;
  summary_ko: string;
  source_name: string;
  source_url: string;
  /** Editor-assigned momentum contribution for this event. */
  momentum_delta: EsgRegMomentumDelta;
  momentum_rationale_ko: string;
  tags?: string[];
};

export type EsgRegHeadline = {
  headline: string;
  source: string;
  published?: string;
  url?: string;
  query?: string;
};

export type EsgRegJurisdictionScore = {
  jurisdiction: EsgRegJurisdiction;
  label_ko: string;
  label_en: string;
  score: number;
  event_count: number;
  evidence: Array<{
    event_id: string;
    date: string;
    title_ko: string;
    delta: EsgRegMomentumDelta;
    rationale_ko: string;
    status: EsgRegStatus;
  }>;
  note: string;
};

export type EsgRegProvenance = {
  cadence: "event";
  fetched_at: string;
  collected_today: boolean;
  newly_published_today: boolean;
  source_name: string;
  methodology: string;
};

export type EsgRegPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  timezone_display: "Asia/Seoul";
  statuses: EsgRegStatus[];
  events: EsgRegEvent[];
  scores: EsgRegJurisdictionScore[];
  headlines: EsgRegHeadline[];
  provenance: EsgRegProvenance;
  error?: string;
};

export const ESG_REG_STATUS_LABELS: Record<
  EsgRegStatus,
  { ko: string; en: string }
> = {
  proposal: { ko: "제안", en: "proposal" },
  consultation: { ko: "협의", en: "consultation" },
  adopted: { ko: "채택", en: "adopted" },
  effective: { ko: "시행", en: "effective" },
  amended: { ko: "개정", en: "amended" },
  delayed: { ko: "연기", en: "delayed" },
  withdrawn: { ko: "철회", en: "withdrawn" },
  court_challenged: { ko: "소송·다툼", en: "court_challenged" },
};

export const ESG_REG_JURISDICTION_LABELS: Record<
  EsgRegJurisdiction,
  { ko: string; en: string }
> = {
  ISSB: { ko: "ISSB·IFRS", en: "ISSB / IFRS Foundation" },
  EU: { ko: "유럽연합", en: "European Union" },
  US: { ko: "미국", en: "United States" },
  KR: { ko: "한국", en: "Korea" },
  JP: { ko: "일본", en: "Japan" },
  SG: { ko: "싱가포르", en: "Singapore" },
  HK: { ko: "홍콩", en: "Hong Kong" },
  OTHER: { ko: "기타", en: "Other" },
};

/**
 * Curated milestone set — editor-reviewed. Update periodically.
 * Scores are NOT a single global ranking; evidence stays attached.
 */
/** Last editorial review of curated regulation events (YYYY-MM-DD). */
export const ESG_REG_LAST_REVIEWED = "2026-07-30";

export const ESG_REG_CURATED_EVENTS: EsgRegEvent[] = [
  {
    id: "issb-s1-s2-effective-2024",
    date: "2024-01-01",
    jurisdiction: "ISSB",
    framework: "ISSB",
    status: "effective",
    title_ko: "IFRS S1/S2 적용 개시 (관할권별 채택은 별도)",
    title_en: "IFRS S1/S2 effective date (jurisdiction adoption separate)",
    summary_ko:
      "ISSB 일반 요구사항(S1)·기후(S2) 기준의 공식 적용 시작일. 국가·거래소 채택 일정은 별도 추적.",
    source_name: "IFRS Foundation",
    source_url: "https://www.ifrs.org/issued-standards/ifrs-sustainability-standards-navigator/",
    momentum_delta: 2,
    momentum_rationale_ko: "글로벌 기준선의 신규 의무·적용 개시(+2).",
    tags: ["S1", "S2", "nature", "human-capital-pipeline"],
  },
  {
    id: "issb-nature-human-capital-research",
    date: "2024-04-23",
    jurisdiction: "ISSB",
    framework: "ISSB",
    status: "consultation",
    title_ko: "자연·인적자본 관련 ISSB 연구·어젠다 논의",
    title_en: "ISSB research agenda on nature and human capital",
    summary_ko:
      "생물다양성·생태계·인적자본 공시 확대를 위한 연구·우선순위 논의. 아직 확정 기준이 아닌 협의·연구 단계.",
    source_name: "IFRS Foundation / ISSB",
    source_url: "https://www.ifrs.org/projects/work-plan/",
    momentum_delta: 1,
    momentum_rationale_ko: "범위 확대 방향의 협의·연구(+1).",
    tags: ["nature", "human-capital"],
  },
  {
    id: "eu-csrd-first-wave",
    date: "2024-01-01",
    jurisdiction: "EU",
    framework: "CSRD",
    status: "effective",
    title_ko: "CSRD 1차 적용 웨이브",
    title_en: "CSRD first application wave",
    summary_ko:
      "대규모 상장사 등 1차 대상의 지속가능성 보고 의무 적용. ESRS와 연계.",
    source_name: "European Commission",
    source_url: "https://finance.ec.europa.eu/capital-markets-union-and-financial-markets/company-reporting-and-auditing/company-reporting/corporate-sustainability-reporting_en",
    momentum_delta: 2,
    momentum_rationale_ko: "신규 의무 공시 체제 시행(+2).",
    tags: ["CSRD", "ESRS"],
  },
  {
    id: "eu-esrs-set1",
    date: "2023-07-31",
    jurisdiction: "EU",
    framework: "ESRS",
    status: "adopted",
    title_ko: "ESRS Set 1 채택",
    title_en: "ESRS Set 1 adopted",
    summary_ko: "유럽 지속가능성 보고기준 Set 1 채택. CSRD 이행의 핵심 기술 기준.",
    source_name: "European Commission / EFRAG",
    source_url: "https://www.efrag.org/lab6",
    momentum_delta: 2,
    momentum_rationale_ko: "의무 보고 기준 채택(+2).",
    tags: ["ESRS"],
  },
  {
    id: "eu-esrs-simplification-2026",
    date: "2026-07-03",
    jurisdiction: "EU",
    framework: "ESRS",
    status: "amended",
    title_ko: "개정 ESRS 채택 (부담 완화·datapoint 축소)",
    title_en: "Revised ESRS adopted (burden reduction)",
    summary_ko:
      "Omnibus 단순화 패키지 일환으로 개정 ESRS 채택. 의무 datapoint 대폭 축소·유연성 확대. 의무는 유지하되 범위·부담 조정.",
    source_name: "European Commission",
    source_url:
      "https://finance.ec.europa.eu/news/commission-adopts-revised-sustainability-reporting-standards-reduce-administrative-burdens-eu-2026-07-03_en",
    momentum_delta: -1,
    momentum_rationale_ko: "의무 체계는 유지되나 범위·부담 축소(-1).",
    tags: ["ESRS", "Omnibus"],
  },
  {
    id: "eu-cbam-transitional",
    date: "2023-10-01",
    jurisdiction: "EU",
    framework: "CBAM",
    status: "effective",
    title_ko: "CBAM 과도 보고 기간 개시",
    title_en: "CBAM transitional reporting started",
    summary_ko: "탄소국경조정메커니즘 과도 기간 보고 의무 시작. 본격 과금 단계는 별도 일정.",
    source_name: "European Commission",
    source_url: "https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en",
    momentum_delta: 2,
    momentum_rationale_ko: "신규 무역·탄소 규제 시행(+2).",
    tags: ["CBAM"],
  },
  {
    id: "eu-csddd",
    date: "2024-07-25",
    jurisdiction: "EU",
    framework: "CSDDD",
    status: "adopted",
    title_ko: "CSDDD(기업지속가능성실사지침) 채택",
    title_en: "CSDDD adopted",
    summary_ko: "공급망 실사·인권·환경 의무를 담은 지침 채택. 회원국 이행·적용 일정 추적 필요.",
    source_name: "European Commission / EUR-Lex",
    source_url: "https://eur-lex.europa.eu/",
    momentum_delta: 2,
    momentum_rationale_ko: "신규 실사 의무 체계 채택(+2).",
    tags: ["CSDDD", "due-diligence"],
  },
  {
    id: "eu-sfdr",
    date: "2021-03-10",
    jurisdiction: "EU",
    framework: "SFDR",
    status: "effective",
    title_ko: "SFDR 적용",
    title_en: "SFDR application",
    summary_ko: "금융상품 지속가능성 공시규정 적용. Level 2·개정 논의는 진행형.",
    source_name: "European Commission",
    source_url: "https://finance.ec.europa.eu/regulation-and-supervision/financial-services-legislation/implementing-and-delegated-acts/sustainable-finance-disclosure-regulation_en",
    momentum_delta: 0,
    momentum_rationale_ko: "장기 운영 중인 체제·기술/해석 업데이트 중심(0).",
    tags: ["SFDR"],
  },
  {
    id: "esma-fund-names",
    date: "2024-11-21",
    jurisdiction: "EU",
    framework: "ESMA",
    status: "effective",
    title_ko: "ESMA 펀드명 가이드라인 적용",
    title_en: "ESMA fund naming guidelines apply",
    summary_ko:
      "ESG·지속가능 관련 펀드 명칭 사용 시 투자 임계치·용어 가드레일. 그린워싱 억제 목적.",
    source_name: "ESMA",
    source_url: "https://www.esma.europa.eu/",
    momentum_delta: 1,
    momentum_rationale_ko: "상품 명명·마케팅 범위 강화(+1).",
    tags: ["fund-names", "greenwashing"],
  },
  {
    id: "us-sec-climate-rule",
    date: "2024-03-06",
    jurisdiction: "US",
    framework: "SEC",
    status: "adopted",
    title_ko: "SEC 기후공시 규칙 채택",
    title_en: "SEC climate disclosure rule adopted",
    summary_ko: "연방 기후 관련 공시 규칙 채택. 이후 소송·집행 일정 변동에 유의.",
    source_name: "U.S. SEC",
    source_url: "https://www.sec.gov/",
    momentum_delta: 2,
    momentum_rationale_ko: "연방 의무 공시 규칙 채택(+2).",
    tags: ["SEC", "climate"],
  },
  {
    id: "us-sec-climate-litigation",
    date: "2024-04-04",
    jurisdiction: "US",
    framework: "SEC",
    status: "court_challenged",
    title_ko: "SEC 기후규칙 소송·집행 유예 국면",
    title_en: "SEC climate rule litigation / stay dynamics",
    summary_ko:
      "채택 이후 법원 다툼·집행 일정 불확실성. 연방 모멘텀을 상쇄하는 핵심 이벤트.",
    source_name: "U.S. courts / SEC updates",
    source_url: "https://www.sec.gov/",
    momentum_delta: -2,
    momentum_rationale_ko: "법원 다툼으로 실질 집행·확실성 저하(-2).",
    tags: ["SEC", "litigation"],
  },
  {
    id: "us-state-climate",
    date: "2024-01-01",
    jurisdiction: "US",
    framework: "US_STATE",
    status: "effective",
    title_ko: "주 단위 기후공시(예: CA) 추진·시행 흐름",
    title_en: "U.S. state climate disclosure momentum (e.g. California)",
    summary_ko:
      "연방과 별도로 주법 기후·배출 공시 요구가 확대. 관할권 분화가 투자 실사 포인트.",
    source_name: "State regulators (e.g. California)",
    source_url: "https://www.gov.ca.gov/",
    momentum_delta: 1,
    momentum_rationale_ko: "주 단위 의무 확대(+1). 연방과 단일 점수로 합산하지 말 것.",
    tags: ["state", "California"],
  },
  {
    id: "kr-esg-disclosure-roadmap",
    date: "2024-04-30",
    jurisdiction: "KR",
    framework: "KR_DISCLOSURE",
    status: "proposal",
    title_ko: "한국 ESG 공시 로드맵·단계적 의무화 논의",
    title_en: "Korea ESG disclosure roadmap / phased mandate discussion",
    summary_ko:
      "금융위·거래소 중심의 지속가능경영보고서·ESG 공시 단계적 의무화 일정 논의. 확정 일정은 공시·보도 확인.",
    source_name: "금융위원회 / 한국거래소",
    source_url: "https://www.fsc.go.kr/",
    momentum_delta: 1,
    momentum_rationale_ko: "의무화 방향의 제안·로드맵(+1).",
    tags: ["KRX", "FSC"],
  },
  {
    id: "kr-k-taxonomy",
    date: "2021-12-30",
    jurisdiction: "KR",
    framework: "K_TAXONOMY",
    status: "adopted",
    title_ko: "K-Taxonomy(한국형 녹색분류체계) 도입",
    title_en: "K-Taxonomy introduced",
    summary_ko: "녹색경제활동 분류체계. 녹색채권·금융상품 적격성 판단의 기초.",
    source_name: "환경부 / 금융위원회",
    source_url: "https://www.me.go.kr/",
    momentum_delta: 1,
    momentum_rationale_ko: "분류체계 도입으로 지속가능금융 인프라 확대(+1).",
    tags: ["taxonomy"],
  },
  {
    id: "kr-k-ets",
    date: "2015-01-01",
    jurisdiction: "KR",
    framework: "K_ETS",
    status: "effective",
    title_ko: "K-ETS(배출권거래제) 운영",
    title_en: "Korea ETS in operation",
    summary_ko: "할당·거래·이행 제도 운영 중. 할당계획·시장안정화 조치는 수시 개정.",
    source_name: "환경부 / KRX ETS",
    source_url: "https://ets.krx.co.kr/",
    momentum_delta: 0,
    momentum_rationale_ko: "기존 제도 운영·기술 업데이트 성격(0). 가격은 ESG시황 탄소 섹션.",
    tags: ["ETS"],
  },
  {
    id: "kr-green-bond",
    date: "2022-01-01",
    jurisdiction: "KR",
    framework: "GREEN_BOND",
    status: "effective",
    title_ko: "한국 녹색채권 가이드라인·시장 인프라",
    title_en: "Korea green bond guidelines / market infrastructure",
    summary_ko: "녹색채권 발행·공시 관련 가이드와 시장 관행. K-Taxonomy와 연계 점검.",
    source_name: "금융위원회 / 환경부",
    source_url: "https://www.fsc.go.kr/",
    momentum_delta: 0,
    momentum_rationale_ko: "가이드·시장 인프라 성격의 운영 업데이트(0).",
    tags: ["green-bond"],
  },
  {
    id: "jp-ssbj",
    date: "2025-03-05",
    jurisdiction: "JP",
    framework: "ASIA_TAXONOMY",
    status: "adopted",
    title_ko: "일본 SSBJ 지속가능성 공시기준 확정 흐름",
    title_en: "Japan SSBJ sustainability disclosure standards",
    summary_ko: "ISSB 정합 공시기준 확정·적용 일정. FSA·거래소 요구와 함께 추적.",
    source_name: "Japan FSA / SSBJ",
    source_url: "https://www.fsa.go.jp/",
    momentum_delta: 2,
    momentum_rationale_ko: "국내 기준 채택으로 의무화 경로 강화(+2).",
    tags: ["SSBJ", "ISSB-alignment"],
  },
  {
    id: "sg-mas-taxonomy",
    date: "2023-12-01",
    jurisdiction: "SG",
    framework: "ASIA_TAXONOMY",
    status: "adopted",
    title_ko: "싱가포르 지속가능금융·분류체계 추진",
    title_en: "Singapore sustainable finance / taxonomy efforts",
    summary_ko: "MAS 중심의 녹색·전환 금융 분류·공시 정합 작업.",
    source_name: "Monetary Authority of Singapore",
    source_url: "https://www.mas.gov.sg/",
    momentum_delta: 1,
    momentum_rationale_ko: "분류·공시 인프라 확대(+1).",
    tags: ["MAS"],
  },
  {
    id: "hk-sfc-climate",
    date: "2021-11-01",
    jurisdiction: "HK",
    framework: "ASIA_TAXONOMY",
    status: "effective",
    title_ko: "홍콩 SFC 기후·ESG 펀드 공시 기대",
    title_en: "Hong Kong SFC climate / ESG fund expectations",
    summary_ko: "펀드 매니저 기후리스크 관리·공시 관련 서큘러·기대치.",
    source_name: "Hong Kong SFC",
    source_url: "https://www.sfc.hk/",
    momentum_delta: 1,
    momentum_rationale_ko: "펀드 공시·거버넌스 기대 강화(+1).",
    tags: ["SFC"],
  },
];

export const ESG_REG_STATUS_LIST: EsgRegStatus[] = [
  "proposal",
  "consultation",
  "adopted",
  "effective",
  "amended",
  "delayed",
  "withdrawn",
  "court_challenged",
];

export function computeJurisdictionScores(
  events: EsgRegEvent[],
  options?: { lookbackDays?: number },
): EsgRegJurisdictionScore[] {
  const lookbackDays = options?.lookbackDays ?? 900;
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const byJ = new Map<EsgRegJurisdiction, EsgRegEvent[]>();
  for (const ev of events) {
    if (ev.date < cutoffIso) continue;
    const list = byJ.get(ev.jurisdiction) || [];
    list.push(ev);
    byJ.set(ev.jurisdiction, list);
  }

  const jurisdictions = Object.keys(ESG_REG_JURISDICTION_LABELS) as EsgRegJurisdiction[];
  return jurisdictions
    .map((j) => {
      const list = (byJ.get(j) || []).sort((a, b) => b.date.localeCompare(a.date));
      const evidence = list.map((ev) => ({
        event_id: ev.id,
        date: ev.date,
        title_ko: ev.title_ko,
        delta: ev.momentum_delta,
        rationale_ko: ev.momentum_rationale_ko,
        status: ev.status,
      }));
      const score = evidence.reduce((sum, e) => sum + e.delta, 0);
      const labels = ESG_REG_JURISDICTION_LABELS[j];
      return {
        jurisdiction: j,
        label_ko: labels.ko,
        label_en: labels.en,
        score,
        event_count: evidence.length,
        evidence,
        note:
          evidence.length === 0
            ? "해당 기간 편집단 이벤트 없음 (N/A — 점수 해석 자제)."
            : "관할권별 합산. 국가 간 단일 랭킹으로 해석하지 말 것. 근거 이벤트 공개.",
      };
    })
    .filter((s) => s.jurisdiction !== "OTHER" || s.event_count > 0);
}

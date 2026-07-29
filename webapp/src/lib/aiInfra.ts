/**
 * AI Infrastructure tab — cadence-aware market + electricity transition signals.
 *
 * Design rules:
 * - Preserve real refresh cadence (daily / monthly / annual / event).
 * - Never rewrite period_end to "today" just because we fetched today.
 * - Prefer official/open sources; N/A when unavailable (no invented values).
 */

export type AiInfraCadence = "daily" | "monthly" | "quarterly" | "annual" | "event";

export type AiInfraProvenance = {
  cadence: AiInfraCadence;
  source_name: string;
  source_url?: string;
  unit?: string;
  methodology?: string;
  /** When SavvyETF fetched the series (UTC ISO). */
  fetched_at: string;
  /** Last observation / bar date (YYYY-MM-DD) when applicable. */
  observed_at?: string | null;
  /** Statistical period end (YYYY or YYYY-MM) — do not conflate with fetched_at. */
  period_end?: string | null;
  /** Publisher release date when known. */
  published_at?: string | null;
  /** fetched_at calendar day (KST) equals today. */
  collected_today: boolean;
  /** observed_at / published_at calendar day (KST) equals today. */
  newly_published_today: boolean;
  revision_status?: "final" | "preliminary" | "estimated" | "unknown";
};

export type AiInfraPoint = {
  date: string;
  close: number;
};

export type AiInfraSignal = {
  id: string;
  symbol: string;
  label: string;
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_1m_pct: number | null;
  series?: AiInfraPoint[];
  excess_1m_vs_spy?: number | null;
  error?: string;
  provenance?: AiInfraProvenance;
};

export type AiInfraBucket = {
  id: string;
  title: string;
  title_en: string;
  blurb: string;
  signals: AiInfraSignal[];
};

export type AiInfraCountryMetric = {
  entity: string;
  entity_ko: string;
  metric: string;
  metric_ko: string;
  value: number | null;
  previous: number | null;
  yoy_pct: number | null;
  unit: string;
  period_end: string | null;
  series?: Array<{ period: string; value: number }>;
  provenance: AiInfraProvenance;
  error?: string;
};

export type AiInfraRoadmapItem = {
  id: string;
  cadence: AiInfraCadence;
  title: string;
  title_en: string;
  status: "live" | "partial" | "planned";
  note: string;
  preferred_sources: string[];
};

export type AiInfraPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  timezone_display: "Asia/Seoul";
  daily: {
    buckets: AiInfraBucket[];
    power_stress_proxy: {
      value: number | null;
      label: string;
      note: string;
      provenance: AiInfraProvenance;
    };
    carbon_etf?: AiInfraSignal | null;
  };
  annual: {
    metrics: AiInfraCountryMetric[];
    note: string;
  };
  roadmap: AiInfraRoadmapItem[];
  error?: string;
};

export const AI_INFRA_DAILY_BUCKETS: Array<{
  id: string;
  title: string;
  title_en: string;
  blurb: string;
  signals: Array<{ id: string; symbol: string; label: string; thesis: string }>;
}> = [
  {
    id: "ai_stack",
    title: "AI·디지털 인프라",
    title_en: "AI & digital infrastructure",
    blurb: "AI 플랫폼·반도체·데이터센터 테마의 일간 시장 프록시입니다.",
    signals: [
      { id: "aiq", symbol: "AIQ", label: "AI·테크", thesis: "AI 응용·플랫폼" },
      { id: "smh", symbol: "SMH", label: "반도체", thesis: "가속기·팹 공급망" },
      { id: "dtcr", symbol: "DTCR", label: "데이터센터", thesis: "디지털 인프라·REIT" },
    ],
  },
  {
    id: "power_grid",
    title: "전력·그리드·유틸리티",
    title_en: "Power, grid & utilities",
    blurb: "AI 전력 병목을 가격으로 보는 그리드·유틸·원자력·인프라 프록시입니다.",
    signals: [
      { id: "grid", symbol: "GRID", label: "스마트그리드", thesis: "송배전·그리드" },
      { id: "xlu", symbol: "XLU", label: "유틸리티", thesis: "규제 전력·배당" },
      { id: "nlr", symbol: "NLR", label: "원자력", thesis: "기저부하·에너지 안보" },
      { id: "pave", symbol: "PAVE", label: "인프라", thesis: "건설·전력망 확장" },
    ],
  },
];

export const AI_INFRA_BENCHMARK = {
  id: "spy",
  symbol: "SPY",
  label: "S&P 500",
  thesis: "상대수익률 벤치마크",
};

/** Entities kept small for reliable OWID CSV parsing. */
export const AI_INFRA_OWID_ENTITIES: Array<{ entity: string; entity_ko: string }> = [
  { entity: "South Korea", entity_ko: "한국" },
  { entity: "United States", entity_ko: "미국" },
  { entity: "China", entity_ko: "중국" },
  { entity: "Japan", entity_ko: "일본" },
  { entity: "India", entity_ko: "인도" },
  { entity: "World", entity_ko: "글로벌" },
];

export const AI_INFRA_ROADMAP: AiInfraRoadmapItem[] = [
  {
    id: "daily_market",
    cadence: "daily",
    title: "시장 프록시·상대수익률",
    title_en: "Market proxies & relative returns",
    status: "live",
    note: "Yahoo 일봉. observed_at=마지막 거래일, fetched_at=수집 시각.",
    preferred_sources: ["Yahoo Finance chart API"],
  },
  {
    id: "daily_carbon",
    cadence: "daily",
    title: "탄소배출권 프록시 (KRBN)",
    title_en: "Carbon market proxy",
    status: "live",
    note: "글로벌 탄소 ETF. KAU 상세는 ESG시황 탄소 섹션 참고.",
    preferred_sources: ["Yahoo KRBN", "KRX ETS (ESG tab)"],
  },
  {
    id: "annual_ember",
    cadence: "annual",
    title: "전력 탄소집약도·재생비중·수요",
    title_en: "Power carbon intensity / renewables / demand",
    status: "live",
    note: "OWID Grapher CSV (Ember 기반). period_end=연도. 월간 Ember API는 키 설정 시 확장.",
    preferred_sources: ["Our World in Data", "Ember (CC-BY-4.0)"],
  },
  {
    id: "monthly_ember_api",
    cadence: "monthly",
    title: "월간 발전 믹스·배출 (Ember API)",
    title_en: "Monthly generation mix (Ember API)",
    status: "planned",
    note: "키 불필요 경로 우선(Yahoo·OWID). Ember 월간 API는 선택; 키 없이 70MB CSV 전량 다운로드는 하지 않음.",
    preferred_sources: ["Ember API"],
  },
  {
    id: "quarterly_capex",
    cadence: "quarterly",
    title: "하이퍼스케일러 CapEx·AI 투자",
    title_en: "Hyperscaler CapEx / AI investment",
    status: "planned",
    note: "분기 실적·공시 기준. 일간으로 재표기하지 않음. (경제 탭 하이퍼스케일러와 연계 예정)",
    preferred_sources: ["SEC filings", "company IR"],
  },
  {
    id: "annual_ngfs",
    cadence: "annual",
    title: "NGFS 시나리오 기준선",
    title_en: "NGFS scenario baselines",
    status: "planned",
    note: "버전 단위로 DB 저장. 일간 갱신 대상 아님.",
    preferred_sources: ["NGFS"],
  },
];

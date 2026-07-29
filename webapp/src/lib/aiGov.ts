/**
 * AI Governance tab — Yahoo ETF proxies + multi-source governance screen.
 * Brief TabId stays esg; new slots are append-only (esg_ai_gov / esg_ai_gov_brief).
 */

export type AiGovBucketId = "transform" | "trust";

export type AiGovPoint = {
  date: string;
  close: number;
};

export type AiGovSignal = {
  id: string;
  symbol: string;
  label: string;
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_1m_pct: number | null;
  series?: AiGovPoint[];
  error?: string;
};

export type AiGovBucket = {
  id: AiGovBucketId;
  rank: 1 | 2;
  title: string;
  title_en: string;
  blurb: string;
  signals: AiGovSignal[];
};

export type AiGovPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  buckets: AiGovBucket[];
  error?: string;
};

export type AiGovDartHit = {
  date?: string;
  corp_name?: string;
  stock_code?: string;
  report_nm?: string;
  rcept_no?: string;
  viewer?: string | null;
  matched?: string[];
};

export type AiGovSecFiling = {
  company?: string;
  form?: string;
  file_date?: string;
  items?: string;
  item_summary?: string;
  url?: string;
};

export type AiGovHeadline = {
  headline?: string;
  title?: string;
  source?: string;
  published?: string;
  date?: string;
  url?: string;
  query?: string;
  category?: string;
  summary?: string;
};

export type AiGovPolicyEvent = {
  date: string;
  region: string;
  title: string;
  note: string;
  days_from_today?: number;
  status?: "past" | "today" | "upcoming" | string;
};

export type AiGovScreenPayload = {
  ok: boolean;
  generated_at: string;
  note?: string;
  dart?: {
    ok?: boolean;
    source?: string;
    days?: number;
    keywords?: string[];
    hit_count?: number;
    hits?: AiGovDartHit[];
    error?: string;
  };
  sec?: {
    ok?: boolean;
    source?: string;
    window_days?: number;
    filing_count?: number;
    filings?: AiGovSecFiling[];
    error?: string;
  };
  finnhub?: {
    ok?: boolean;
    source?: string;
    headlines?: AiGovHeadline[];
    filtered?: boolean;
    error?: string;
  };
  naver?: {
    ok?: boolean;
    source?: string;
    headlines?: AiGovHeadline[];
    error?: string;
  };
  policy?: {
    ok?: boolean;
    events?: AiGovPolicyEvent[];
  };
  errors?: string[];
  error?: string;
};

/** Static fallback when bot/API omits policy block. */
export const AI_POLICY_CALENDAR: AiGovPolicyEvent[] = [
  {
    date: "2026-01-22",
    region: "KR",
    title: "AI기본법 전면 시행",
    note: "고영향 AI·생성형 표시·내부 거버넌스 의무 본격 적용",
  },
  {
    date: "2026-07-21",
    region: "KR",
    title: "AI기본법 후속 개정·시행령",
    note: "공공조달 우선·포용·창업 지원 조항 구체화",
  },
  {
    date: "2026-08-02",
    region: "EU",
    title: "EU AI Act — GPAI 의무 단계",
    note: "일반목적 AI(GPAI) 관련 의무 타임라인 (사업자 준수 점검)",
  },
  {
    date: "2027-08-02",
    region: "EU",
    title: "EU AI Act — 고위험 AI 전면",
    note: "고위험 시스템 요구사항 전면 적용 예정 구간",
  },
];

export const AI_GOV_BRIEF_SLOTS = ["esg_ai_gov", "esg_ai_gov_brief"] as const;

export const AI_GOV_BUCKET_SPECS: Array<{
  id: AiGovBucketId;
  rank: 1 | 2;
  title: string;
  title_en: string;
  blurb: string;
  signals: Array<{
    id: string;
    symbol: string;
    label: string;
    thesis: string;
  }>;
}> = [
  {
    id: "transform",
    rank: 1,
    title: "AI Transformation",
    title_en: "Platforms, chips and digital infrastructure",
    blurb:
      "AI 수요가 소프트웨어·반도체·데이터센터로 흘러가는지 시장 프록시로 봅니다. (투자 조언 아님)",
    signals: [
      {
        id: "aiq",
        symbol: "AIQ",
        label: "AI·테크",
        thesis: "AI 플랫폼·응용 테마",
      },
      {
        id: "smh",
        symbol: "SMH",
        label: "반도체",
        thesis: "가속기·팹 공급망",
      },
      {
        id: "dtcr",
        symbol: "DTCR",
        label: "데이터센터",
        thesis: "디지털 인프라·REIT",
      },
    ],
  },
  {
    id: "trust",
    rank: 2,
    title: "Trust · Cyber",
    title_en: "Security and software governance proxies",
    blurb:
      "사이버·기업 소프트웨어는 AI 도입 시대의 신뢰·통제 지출을 간접 반영합니다. 아래 공시·규제 스크린과 함께 보세요.",
    signals: [
      {
        id: "hack",
        symbol: "HACK",
        label: "사이버보안",
        thesis: "보안 지출·침해 대응",
      },
      {
        id: "cibr",
        symbol: "CIBR",
        label: "사이버 (CIBR)",
        thesis: "보안 소프트웨어",
      },
      {
        id: "igv",
        symbol: "IGV",
        label: "소프트웨어",
        thesis: "기업 IT·거버넌스 툴",
      },
    ],
  },
];

/**
 * AI Governance tab — Yahoo ETF proxies only (no brief TabId / R2 slots).
 * Keep symbol set small and liquid to reduce fetch failures.
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
      "사이버·기업 소프트웨어는 AI 도입 시대의 신뢰·통제 지출을 간접 반영합니다. 기업별 AI 공시 스크린은 추후 추가 예정입니다.",
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

/** Daily KR ESG event monitor (S/E/G filings + news). Snapshot from Render 09:00 KST. */

export const ESG_EVENTS_R2_KEY = "esg_events/latest.json";

export type EsgEventPillar = "E" | "S" | "G";

export type EsgEventHit = {
  id: string;
  date: string;
  corp_name?: string;
  stock_code?: string;
  title: string;
  source: string;
  source_url?: string;
  matched?: string[];
  fresh?: boolean;
  kind?: string;
};

export type EsgEventCategory = {
  id: string;
  pillar: EsgEventPillar;
  title: string;
  check: string;
  sources_note: string;
  importance: string;
  hits: EsgEventHit[];
  news: EsgEventHit[];
  error?: string | null;
};

export type EsgEventsPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display?: string;
  as_of?: string;
  lookback_days?: number;
  timezone?: string;
  note?: string;
  channel?: { name: string; handle: string; href: string };
  categories: EsgEventCategory[];
  summary?: {
    total: number;
    fresh: number;
    by_pillar: Partial<Record<EsgEventPillar, number>>;
  };
  errors?: string[];
  source?: string;
  error?: string;
};

export const ESG_EVENT_CATEGORY_META: Array<{
  id: string;
  pillar: EsgEventPillar;
  title: string;
  check: string;
  sources_note: string;
  importance: string;
  news_queries: string[];
  keywords: string[];
}> = [
  {
    id: "s_accident",
    pillar: "S",
    title: "중대재해 발생 공시",
    check: "중대재해 발생 공시",
    sources_note: "KRX KIND · Open DART",
    importance: "매우 높음",
    news_queries: ["중대재해 공시 상장", "중대재해 발생 기업"],
    keywords: ["중대재해", "산업재해", "산재사망", "사망사고"],
  },
  {
    id: "s_csa",
    pillar: "S",
    title: "중대재해처벌법 기소·판결",
    check: "중대재해처벌법 관련 기소·판결",
    sources_note: "KIND · 법원·고용노동부 보도",
    importance: "매우 높음",
    news_queries: ["중대재해처벌법 기소", "중대재해처벌법 판결", "중처법 유죄"],
    keywords: ["중대재해처벌", "중처법"],
  },
  {
    id: "e_env",
    pillar: "E",
    title: "대기·수질·폐기물 위반",
    check: "대기·수질·폐기물 위반, 조업정지, 과징금",
    sources_note: "환경부·지자체 · 회사 공시 (KIND/DART)",
    importance: "매우 높음",
    news_queries: ["조업정지 과징금 환경", "환경부 과징금 상장", "대기 배출 위반 기업"],
    keywords: ["조업정지", "과징금", "대기", "수질", "폐기물", "환경부", "배출"],
  },
  {
    id: "g_fraud",
    pillar: "G",
    title: "횡령·배임·회계·감사의견",
    check: "횡령·배임, 회계처리 위반, 감사의견 변경",
    sources_note: "DART · KIND · 증선위 보도",
    importance: "매우 높음",
    news_queries: ["횡령 배임 상장", "감사의견 거절", "회계처리 위반 증선위"],
    keywords: ["횡령", "배임", "회계처리", "감사의견", "의견거절", "증선위"],
  },
  {
    id: "g_control",
    pillar: "G",
    title: "최대주주·경영권·임원 해임",
    check: "최대주주 변경, 경영권 분쟁, 임원 해임",
    sources_note: "KIND · DART",
    importance: "높음",
    news_queries: ["최대주주 변경 공시", "경영권 분쟁 상장", "임원 해임 상장"],
    keywords: ["최대주주", "경영권", "임원 해임", "해임결정"],
  },
];

export function emptyEsgEventsPayload(error?: string): EsgEventsPayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    lookback_days: 14,
    timezone: "Asia/Seoul",
    note: "",
    categories: ESG_EVENT_CATEGORY_META.map((c) => ({
      id: c.id,
      pillar: c.pillar,
      title: c.title,
      check: c.check,
      sources_note: c.sources_note,
      importance: c.importance,
      hits: [],
      news: [],
    })),
    summary: { total: 0, fresh: 0, by_pillar: { E: 0, S: 0, G: 0 } },
    error,
  };
}

export function isEsgEventsPayload(value: unknown): value is EsgEventsPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<EsgEventsPayload>;
  return Array.isArray(v.categories);
}

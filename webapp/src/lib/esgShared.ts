import type { ShellTabId } from "@/lib/types";

/** Relevant R2 brief slots per ESG sub-tab (distributed briefs). */
export const ESG_TAB_BRIEF_SLOTS: Partial<Record<ShellTabId, string[]>> = {
  esg: [
    "esg_events",
    "esg_monitor",
    "esg_overview",
    "esg_accident",
    "esg_data_briefing",
    "esg_ai_gov",
    "esg_ai_gov_brief",
  ],
  geo: ["esg_monitor", "esg_data_briefing"],
  infra: ["esg_ai_gov", "esg_ai_gov_brief"],
  esgreg: ["esg_data_briefing", "esg_overview"],
  greenmin: ["esg_data_briefing", "esg_monitor"],
};

export const ESG_TAB_BRIEF_NOTES: Partial<Record<ShellTabId, string>> = {
  geo: "지정학 맥락: 기후 모니터 + Geo·ESG 통합 브리핑(텔레그램 /data_briefing esg).",
  infra: "전력·그리드 프록시와 AI 정책·공시 스크린. 주간 AI 브리프는 스케줄 또는 /esg aibrief.",
  esgreg: "규제 모멘텀은 데이터 브리핑·기업 거버넌스 개요와 연계됩니다.",
  greenmin: "공급망·지정학은 esg_data_briefing + 기후 모니터를 참고하세요.",
};

export type EsgEtfChip = {
  symbol: string;
  label: string;
  thesis: string;
};

export const ESG_TAB_ETF_CHIPS: Partial<Record<ShellTabId, EsgEtfChip[]>> = {
  esg: [
    { symbol: "GRID", label: "전력망", thesis: "미국 전력 인프라" },
    { symbol: "ICLN", label: "클린에너지", thesis: "재생·저탄소 테마" },
    { symbol: "HACK", label: "사이버", thesis: "거버넌스·보안" },
    { symbol: "KRBN", label: "탄소", thesis: "배출권 가격 프록시" },
  ],
  geo: [
    { symbol: "USO", label: "원유", thesis: "중동·에너지 쇼크" },
    { symbol: "GLD", label: "금", thesis: "안전자산" },
    { symbol: "ITA", label: "방산", thesis: "지정학 리스크 헤지" },
    { symbol: "REMX", label: "희토류", thesis: "공급망 병목" },
  ],
  infra: [
    { symbol: "GRID", label: "전력망", thesis: "AI 전력 수요" },
    { symbol: "SMH", label: "반도체", thesis: "AI 칩 공급" },
    { symbol: "HACK", label: "사이버", thesis: "AI·데이터 보안" },
    { symbol: "DTCR", label: "데이터센터", thesis: "디지털 인프라" },
  ],
  esgreg: [
    { symbol: "ESGU", label: "ESG 미국", thesis: "ESG 선별 주식" },
    { symbol: "KRBN", label: "탄소", thesis: "탄소가격·CBAM" },
    { symbol: "ICLN", label: "클린", thesis: "녹색 분류체계 수혜" },
    { symbol: "SUSA", label: "지속가능", thesis: "공시·규제 대응" },
  ],
  greenmin: [
    { symbol: "LIT", label: "리튬", thesis: "배터리 공급망" },
    { symbol: "REMX", label: "희토류", thesis: "희토·희귀금속" },
    { symbol: "COPX", label: "구리", thesis: "전력·그리드" },
    { symbol: "URA", label: "우라늄", thesis: "원자력 연료" },
  ],
};

export const ESG_SUB_TABS: ShellTabId[] = [
  "esg",
  "geo",
  "infra",
  "esgreg",
  "greenmin",
];

export function isEsgShellTab(tab: ShellTabId): boolean {
  return ESG_SUB_TABS.includes(tab);
}

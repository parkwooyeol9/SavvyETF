/**
 * ETF create/redeem flow proxies for the ETF시황 tab.
 *
 * True “수급 계정”은 공개되지 않으므로, 업계 표준 추정식을 사용합니다:
 *   flow_t ≈ NAV_{t-1} × Δshares_outstanding_t
 *
 * 국내 ETF는 Naver 외국인 보유주수/보유율로 상장좌수를 역산하고,
 * 종가를 NAV 대용으로 사용합니다(프리미엄·디스카운트는 통상 작음).
 * 미국 ETF는 일별 shares outstanding 히스토리가 무료로 안정 제공되지 않아
 * 1차 범위에서 제외합니다.
 */

export type EtfFlowBucket = "country" | "sector" | "theme";

export type EtfFlowMeta = {
  code: string;
  name: string;
  bucket: EtfFlowBucket;
  label: string;
  color: string;
};

export type EtfFlowDayPoint = {
  date: string; // YYYY-MM-DD
  flow_eok: number;
  flow_cum_eok: number;
  aum_eok: number;
};

export type EtfFlowGroupSeries = {
  key: string;
  label: string;
  bucket: EtfFlowBucket;
  color: string;
  members: Array<{ code: string; name: string }>;
  latest_flow_eok: number;
  latest_aum_eok: number;
  flow_cum_eok: number;
  series: EtfFlowDayPoint[];
};

export type EtfFlowPayload = {
  ok: boolean;
  error?: string;
  generated_at?: string;
  note?: string;
  source?: string;
  formula?: string;
  lookback_days?: number;
  groups?: EtfFlowGroupSeries[];
};

/** Curated KR-listed ETFs for country / sector / theme flow aggregation. */
export const ETF_FLOW_UNIVERSE: EtfFlowMeta[] = [
  // Country / region exposure
  { code: "069500", name: "KODEX 200", bucket: "country", label: "한국", color: "#3b82f6" },
  { code: "229200", name: "KODEX 코스닥150", bucket: "country", label: "한국", color: "#3b82f6" },
  { code: "360750", name: "TIGER 미국S&P500", bucket: "country", label: "미국", color: "#60a5fa" },
  { code: "133690", name: "TIGER 미국나스닥100", bucket: "country", label: "미국", color: "#60a5fa" },
  { code: "241180", name: "TIGER 일본니케이225", bucket: "country", label: "일본", color: "#f59e0b" },
  { code: "283580", name: "KODEX 차이나CSI300", bucket: "country", label: "중국", color: "#ef4444" },
  { code: "195980", name: "PLUS 신흥국MSCI", bucket: "country", label: "신흥국", color: "#a78bfa" },

  // Sector
  { code: "091160", name: "KODEX 반도체", bucket: "sector", label: "반도체", color: "#06b6d4" },
  { code: "396500", name: "TIGER 반도체TOP10", bucket: "sector", label: "반도체", color: "#06b6d4" },
  { code: "091170", name: "KODEX 은행", bucket: "sector", label: "금융", color: "#10b981" },
  { code: "102970", name: "KODEX 증권", bucket: "sector", label: "금융", color: "#10b981" },
  { code: "139260", name: "TIGER 200 IT", bucket: "sector", label: "IT", color: "#6366f1" },
  { code: "266370", name: "KODEX IT", bucket: "sector", label: "IT", color: "#6366f1" },
  { code: "227540", name: "TIGER 200 헬스케어", bucket: "sector", label: "헬스케어", color: "#ec4899" },
  { code: "244580", name: "KODEX 바이오", bucket: "sector", label: "헬스케어", color: "#ec4899" },
  { code: "117460", name: "KODEX 에너지화학", bucket: "sector", label: "에너지·소재", color: "#f97316" },

  // Theme
  { code: "305540", name: "TIGER 2차전지테마", bucket: "theme", label: "2차전지", color: "#14b8a6" },
  { code: "395160", name: "KODEX AI반도체TOP2+", bucket: "theme", label: "AI·반도체", color: "#8b5cf6" },
  { code: "469150", name: "ACE AI반도체TOP3+", bucket: "theme", label: "AI·반도체", color: "#8b5cf6" },
  { code: "471990", name: "KODEX AI반도체핵심장비", bucket: "theme", label: "AI·반도체", color: "#8b5cf6" },
  { code: "367770", name: "RISE 수소경제테마", bucket: "theme", label: "에너지전환", color: "#84cc16" },
  { code: "458730", name: "TIGER 미국배당다우존스", bucket: "theme", label: "배당", color: "#eab308" },
  { code: "161510", name: "PLUS 고배당주", bucket: "theme", label: "배당", color: "#eab308" },
];

export const ETF_FLOW_BUCKET_LABELS: Record<EtfFlowBucket, string> = {
  country: "국가·지역",
  sector: "업종",
  theme: "테마",
};

export function fmtFlowEok(n?: number | null, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  if (abs >= 10000) return `${sign}${(n / 10000).toFixed(2)}조`;
  return `${sign}${n.toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })}억`;
}

export function fmtAumEok(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}조`;
  return `${Math.round(n).toLocaleString("ko-KR")}억`;
}

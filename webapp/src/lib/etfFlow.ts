/**
 * ETF create/redeem flow proxies for the ETF시황 tab.
 *
 * True “수급 계정”은 공개되지 않으므로, 업계 표준 추정식을 사용합니다:
 *   flow_t ≈ NAV_{t-1} × Δshares_outstanding_t
 *
 * 국내: Naver 외국인 보유주수/보유율로 상장좌수 역산, 종가≈NAV 대용.
 * 미국: State Street (SSGA) 공개 navhist(xlsx)의 NAV·Shares Outstanding 사용.
 */

export type EtfFlowBucket = "country" | "sector" | "theme";
export type EtfFlowMarket = "kr" | "us";
export type EtfFlowUnit = "krw_eok" | "usd_mn";

export type EtfFlowMeta = {
  code: string;
  name: string;
  bucket: EtfFlowBucket;
  label: string;
  color: string;
};

export type EtfFlowDayPoint = {
  date: string; // YYYY-MM-DD
  /** Amount in payload.unit (KRW 억 or USD million). */
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
  market?: EtfFlowMarket;
  unit?: EtfFlowUnit;
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

/**
 * Curated US-listed SPDRs with public daily NAV + shares outstanding
 * from State Street navhist spreadsheets.
 */
export const ETF_FLOW_US_UNIVERSE: EtfFlowMeta[] = [
  // Country / region
  { code: "SPY", name: "SPDR S&P 500", bucket: "country", label: "미국", color: "#60a5fa" },
  { code: "MDY", name: "SPDR S&P MidCap 400", bucket: "country", label: "미국", color: "#60a5fa" },
  { code: "SPDW", name: "SPDR Portfolio Developed World ex-US", bucket: "country", label: "선진국", color: "#38bdf8" },
  { code: "FEZ", name: "SPDR EURO STOXX 50", bucket: "country", label: "선진국", color: "#38bdf8" },
  { code: "SPEM", name: "SPDR Portfolio Emerging Markets", bucket: "country", label: "신흥국", color: "#a78bfa" },
  { code: "EWX", name: "SPDR S&P Emerging Markets Small Cap", bucket: "country", label: "신흥국", color: "#a78bfa" },
  { code: "GXC", name: "SPDR S&P China", bucket: "country", label: "중국", color: "#ef4444" },

  // Sector (Select Sector SPDRs)
  { code: "XLK", name: "Technology Select Sector SPDR", bucket: "sector", label: "기술", color: "#6366f1" },
  { code: "XLF", name: "Financial Select Sector SPDR", bucket: "sector", label: "금융", color: "#10b981" },
  { code: "XLE", name: "Energy Select Sector SPDR", bucket: "sector", label: "에너지", color: "#f97316" },
  { code: "XLV", name: "Health Care Select Sector SPDR", bucket: "sector", label: "헬스케어", color: "#ec4899" },
  { code: "XLI", name: "Industrial Select Sector SPDR", bucket: "sector", label: "산업재", color: "#94a3b8" },
  { code: "XLC", name: "Communication Services Select Sector SPDR", bucket: "sector", label: "커뮤니케이션", color: "#22d3ee" },
  { code: "XLY", name: "Consumer Discretionary Select Sector SPDR", bucket: "sector", label: "임의소비", color: "#fb7185" },

  // Theme
  { code: "XSD", name: "SPDR S&P Semiconductor", bucket: "theme", label: "반도체", color: "#06b6d4" },
  { code: "XBI", name: "SPDR S&P Biotech", bucket: "theme", label: "바이오", color: "#d946ef" },
  { code: "XAR", name: "SPDR S&P Aerospace & Defense", bucket: "theme", label: "항공·방산", color: "#64748b" },
  { code: "GLD", name: "SPDR Gold Shares", bucket: "theme", label: "금", color: "#eab308" },
  { code: "XOP", name: "SPDR S&P Oil & Gas Exploration", bucket: "theme", label: "에너지탐험", color: "#ea580c" },
  { code: "XSW", name: "SPDR S&P Software & Services", bucket: "theme", label: "소프트웨어", color: "#8b5cf6" },
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

/** Format USD millions (payload unit usd_mn). */
export function fmtFlowUsdMn(n?: number | null, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}B`;
  return `${sign}$${abs.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })}M`;
}

export function fmtAumUsdMn(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return `$${(abs / 1000).toFixed(2)}B`;
  return `$${Math.round(abs).toLocaleString("en-US")}M`;
}

export function fmtFlowByUnit(
  unit: EtfFlowUnit | undefined,
  n?: number | null,
  digits = 0,
): string {
  return unit === "usd_mn" ? fmtFlowUsdMn(n, digits) : fmtFlowEok(n, digits);
}

export function fmtAumByUnit(unit: EtfFlowUnit | undefined, n?: number | null): string {
  return unit === "usd_mn" ? fmtAumUsdMn(n) : fmtAumEok(n);
}

export function unitAxisLabel(unit: EtfFlowUnit | undefined): string {
  return unit === "usd_mn" ? "USD mn" : "억 원";
}

export function formatAxisByUnit(unit: EtfFlowUnit | undefined, v: number): string {
  const abs = Math.abs(v);
  if (unit === "usd_mn") {
    if (abs >= 1000) return `${(v / 1000).toFixed(1)}B`;
    return `${Math.round(v)}`;
  }
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}조`;
  return `${v}`;
}

export type NavShareDay = {
  date: string;
  nav: number;
  shares: number;
  aum: number;
};

/** flow_t ≈ NAV_{t-1} × Δshares; values scaled into display unit. */
export function flowsFromNavShares(
  days: NavShareDay[],
  scale: number,
): EtfFlowDayPoint[] {
  const out: EtfFlowDayPoint[] = [];
  let cum = 0;
  for (let i = 0; i < days.length; i++) {
    const cur = days[i];
    let flow = 0;
    if (i > 0) {
      const prev = days[i - 1];
      flow = prev.nav * (cur.shares - prev.shares);
    }
    cum += flow;
    out.push({
      date: cur.date,
      flow_eok: flow / scale,
      flow_cum_eok: cum / scale,
      aum_eok: cur.aum / scale,
    });
  }
  return out;
}

export function aggregateEtfFlowGroups(
  perCode: Array<{
    meta: EtfFlowMeta;
    series: EtfFlowDayPoint[];
  }>,
): EtfFlowGroupSeries[] {
  const groupMap = new Map<
    string,
    {
      key: string;
      label: string;
      bucket: EtfFlowBucket;
      color: string;
      members: Array<{ code: string; name: string }>;
      byDate: Map<string, { flow: number; aum: number }>;
    }
  >();

  for (const item of perCode) {
    const gkey = `${item.meta.bucket}:${item.meta.label}`;
    let g = groupMap.get(gkey);
    if (!g) {
      g = {
        key: gkey,
        label: item.meta.label,
        bucket: item.meta.bucket,
        color: item.meta.color,
        members: [],
        byDate: new Map(),
      };
      groupMap.set(gkey, g);
    }
    g.members.push({ code: item.meta.code, name: item.meta.name });
    for (const pt of item.series) {
      const cur = g.byDate.get(pt.date) || { flow: 0, aum: 0 };
      cur.flow += pt.flow_eok;
      cur.aum += pt.aum_eok;
      g.byDate.set(pt.date, cur);
    }
  }

  const bucketOrder: EtfFlowBucket[] = ["country", "sector", "theme"];
  return [...groupMap.values()]
    .sort((a, b) => {
      const bi = bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket);
      if (bi !== 0) return bi;
      return a.label.localeCompare(b.label, "ko");
    })
    .map((g) => {
      const dates = [...g.byDate.keys()].sort();
      let cum = 0;
      const series: EtfFlowDayPoint[] = dates.map((date) => {
        const row = g.byDate.get(date)!;
        cum += row.flow;
        return {
          date,
          flow_eok: row.flow,
          flow_cum_eok: cum,
          aum_eok: row.aum,
        };
      });
      const latest = series[series.length - 1];
      return {
        key: g.key,
        label: `${ETF_FLOW_BUCKET_LABELS[g.bucket]} · ${g.label}`,
        bucket: g.bucket,
        color: g.color,
        members: g.members,
        latest_flow_eok: latest?.flow_eok ?? 0,
        latest_aum_eok: latest?.aum_eok ?? 0,
        flow_cum_eok: latest?.flow_cum_eok ?? 0,
        series,
      };
    });
}

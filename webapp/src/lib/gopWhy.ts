/**
 * Why GOP (ex-KRUZ) is beating NANC / SPY this window:
 * static-weight × holding return, rolled up by sector.
 * Approximate — ignores intra-period rebalance and cash.
 */

import type { PoliRange } from "@/lib/poliThemes";

export type GopWhyMode = "name" | "sector" | "mixed" | "unknown";

export type GopWhyDriver = {
  ticker: string;
  name: string;
  weight_pct: number | null;
  return_pct: number | null;
  contribution_pct: number | null;
  sector: string;
  sector_ko: string;
};

export type GopWhySector = {
  id: string;
  label: string;
  weight_pct: number;
  contrib_pct: number | null;
};

export type GopWhyPayload = {
  ok: boolean;
  generated_at: string;
  range: PoliRange;
  ticker: "GOP";
  former_ticker: "KRUZ";
  fund_return_pct: number | null;
  spy_return_pct: number | null;
  vs_spy_pct: number | null;
  xle_return_pct: number | null;
  xlf_return_pct: number | null;
  ita_return_pct: number | null;
  headline: string;
  mode: GopWhyMode;
  bullets: string[];
  drivers: GopWhyDriver[];
  sectors: GopWhySector[];
  coverage_weight_pct: number | null;
  explained_contrib_pct: number | null;
  as_of?: string | null;
  note: string;
  error?: string;
};

export const GOP_WHY_NOTE =
  "기여도는 최근 공시 비중 × 같은 기간 종목 수익률입니다. 리밸런싱·현금·비상장(예: SPCX)은 빠지므로 펀드 수익률과 합이 다를 수 있습니다. 2025.3.21 티커 KRUZ→GOP, 전략은 동일합니다.";

const SECTOR_KO: Record<string, string> = {
  semis: "반도체",
  tech: "기술·네트워크",
  energy: "에너지",
  financials: "금융",
  defense: "방산·우주",
  industrials: "산업·설비",
  crypto: "비트코인",
  health: "헬스케어",
  telecom: "통신",
  consumer: "소비재",
  other: "기타",
};

const TICKER_SECTOR: Record<string, string> = {
  FIX: "industrials",
  NVT: "industrials",
  CAT: "industrials",
  WWD: "industrials",
  ACN: "tech",
  ANET: "tech",
  PANW: "tech",
  INTC: "semis",
  NVDA: "semis",
  AMD: "semis",
  ASML: "semis",
  TXN: "semis",
  AVGO: "semis",
  JPM: "financials",
  ALL: "financials",
  GS: "financials",
  "BRK-B": "financials",
  BRK: "financials",
  PYPL: "financials",
  FIS: "financials",
  FCFS: "financials",
  AER: "financials",
  IBIT: "crypto",
  CVX: "energy",
  COP: "energy",
  SHEL: "energy",
  WMB: "energy",
  NFG: "energy",
  NGL: "energy",
  XOM: "energy",
  RTX: "defense",
  LHX: "defense",
  LMT: "defense",
  NOC: "defense",
  SPCX: "defense",
  UTHR: "health",
  JNJ: "health",
  T: "telecom",
  TMUS: "telecom",
  VZ: "telecom",
  TSLA: "consumer",
  TSN: "consumer",
  PM: "consumer",
  SPG: "other",
  LGIH: "consumer",
};

export function yahooHoldingSymbol(code: string): string | null {
  const t = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!t || t === "CASH" || t === "USD" || t === "-" || t.startsWith(".")) return null;
  if (t === "BRK/B" || t === "BRK.B" || t === "BRK-B") return "BRK-B";
  const normalized = t.includes("/") ? t.replace("/", "-") : t;
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(normalized)) return null;
  return normalized;
}

export function classifyGopSector(ticker: string, name?: string): { id: string; ko: string } {
  const id = TICKER_SECTOR[ticker] || guessSectorFromName(name || "");
  return { id, ko: SECTOR_KO[id] || SECTOR_KO.other };
}

function guessSectorFromName(name: string): string {
  const n = name.toLowerCase();
  if (/oil|petroleum|energy|fuel|gas|chevron|exxon|shell|conocophillips/.test(n)) return "energy";
  if (/semi|chip|intel|nvidia|amd|broadcom|asml|texas instruments/.test(n)) return "semis";
  if (/bitcoin|crypto|ishares bitcoin/.test(n)) return "crypto";
  if (/bank|jpmorgan|goldman|allstate|berkshire|insurance|paypal/.test(n)) return "financials";
  if (/defense|raytheon|l3harris|lockheed|rtx|space/.test(n)) return "defense";
  if (/pharma|therapeutics|johnson|health/.test(n)) return "health";
  if (/at&t|verizon|telecom/.test(n)) return "telecom";
  if (/comfort systems|caterpillar|nvent|industrial/.test(n)) return "industrials";
  if (/network|software|accenture|palo alto/.test(n)) return "tech";
  return "other";
}

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function interpretGopWhy(input: {
  rangeLabel: string;
  fundReturn: number | null;
  spyReturn: number | null;
  xleReturn: number | null;
  xlfReturn: number | null;
  itaReturn: number | null;
  drivers: GopWhyDriver[];
  sectors: GopWhySector[];
  coverage: number | null;
}): Pick<GopWhyPayload, "headline" | "mode" | "bullets"> {
  const vsSpy =
    input.fundReturn != null && input.spyReturn != null
      ? round2(input.fundReturn - input.spyReturn)
      : null;
  const topName = input.drivers.find((d) => d.contribution_pct != null) || input.drivers[0];
  const topSector = input.sectors[0];
  const explained = input.drivers.reduce((a, d) => a + (d.contribution_pct || 0), 0);
  const fund = input.fundReturn;
  const nameShare =
    topName?.contribution_pct != null && fund && Math.abs(fund) > 0.2
      ? topName.contribution_pct / fund
      : null;
  const sectorShare =
    topSector?.contrib_pct != null && fund && Math.abs(fund) > 0.2
      ? topSector.contrib_pct / fund
      : null;

  let mode: GopWhyMode = "unknown";
  let headline: string;

  if (fund == null) {
    headline = "GOP 시세를 아직 읽지 못했습니다. 티커는 2025.3 KRUZ에서 바뀌었습니다.";
  } else if (!input.drivers.length) {
    headline = `GOP ${input.rangeLabel} ${fmtPct(fund)} · 편입비를 못 읽어 업종 ETF와만 비교합니다.`;
    mode = "mixed";
  } else if (vsSpy != null && vsSpy <= 0.4 && vsSpy >= -0.4) {
    headline = `이 기간 GOP는 SPY와 거의 같습니다 (${fmtPct(vsSpy, 1)}p). 초과수익보다 구성이 포인트입니다.`;
    mode = "mixed";
  } else if (nameShare != null && nameShare >= 0.28 && (topName?.contribution_pct || 0) > 0) {
    headline = `GOP의 ${input.rangeLabel} 성과는 주로 ${topName!.name}(${topName!.ticker}) 한 종목에서 나옵니다. 비중 ${fmtPct(topName!.weight_pct, 1).replace("+", "")}가 기여 ${fmtPct(topName!.contribution_pct)}p.`;
    mode = "name";
  } else if (sectorShare != null && sectorShare >= 0.4 && (topSector?.contrib_pct || 0) > 0) {
    headline = `업종으로는 ${topSector!.label} 기여가 가장 큽니다 (비중 ${fmtPct(topSector!.weight_pct, 1).replace("+", "")}, 기여 ${fmtPct(topSector!.contrib_pct)}p). 에너지 한 방이 아닙니다.`;
    mode = "sector";
  } else if (topName) {
    headline = `특정 업종 한 방으로 보기 어렵습니다. 종목 1위는 ${topName.ticker}, 업종 1위는 ${topSector?.label || "—"}.`;
    mode = "mixed";
  } else {
    headline = `GOP ${input.rangeLabel} ${fmtPct(fund)} (vs SPY ${fmtPct(vsSpy, 1)}p).`;
  }

  const bullets: string[] = [];
  bullets.push(
    `GOP ${fmtPct(fund)} · SPY ${fmtPct(input.spyReturn)} · 초과 ${fmtPct(vsSpy, 1)}p`,
  );
  if (input.xleReturn != null && fund != null) {
    const vsXle = round2(fund - input.xleReturn);
    bullets.push(
      vsXle > 1.5
        ? `에너지 ETF(XLE) ${fmtPct(input.xleReturn)}보다 GOP가 ${fmtPct(vsXle, 1)}p 앞섭니다. 원유 베타만으로는 설명이 안 됩니다.`
        : `에너지 ETF(XLE) ${fmtPct(input.xleReturn)}와 비슷합니다. 에너지 비중이 성과에 섞여 있을 수 있습니다.`,
    );
  }
  if (input.xlfReturn != null) bullets.push(`금융 XLF ${fmtPct(input.xlfReturn)} · 방산 ITA ${fmtPct(input.itaReturn)}`);
  if (topName?.contribution_pct != null) {
    bullets.push(
      `최대 기여 종목 ${topName.ticker} ${fmtPct(topName.return_pct)} × 비중 ${fmtPct(topName.weight_pct, 1).replace("+", "")} → ${fmtPct(topName.contribution_pct)}p`,
    );
  }
  const top5 = input.drivers.slice(0, 5).reduce((a, d) => a + (d.contribution_pct || 0), 0);
  if (input.drivers.length >= 3) {
    bullets.push(`상위 5종목 기여 합 ${fmtPct(top5)}p · 읽어낸 비중 ${fmtPct(input.coverage, 0).replace("+", "")}`);
  }
  if (explained && fund && Math.abs(explained - fund) > 3) {
    bullets.push(
      `읽어낸 기여 합 ${fmtPct(explained)}p vs 펀드 ${fmtPct(fund)}. 나머지 종목·리밸런싱·비상장 몫입니다.`,
    );
  }

  return { headline, mode, bullets };
}

export function rollupGopSectors(drivers: GopWhyDriver[]): GopWhySector[] {
  const map = new Map<string, { label: string; weight: number; contrib: number }>();
  for (const d of drivers) {
    const cur = map.get(d.sector) || { label: d.sector_ko, weight: 0, contrib: 0 };
    cur.weight += d.weight_pct || 0;
    cur.contrib += d.contribution_pct || 0;
    map.set(d.sector, cur);
  }
  return [...map.entries()]
    .map(([id, v]) => ({
      id,
      label: v.label,
      weight_pct: round2(v.weight),
      contrib_pct: round2(v.contrib),
    }))
    .sort((a, b) => Math.abs(b.contrib_pct || 0) - Math.abs(a.contrib_pct || 0));
}

export function emptyGopWhy(range: PoliRange, error?: string): GopWhyPayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    range,
    ticker: "GOP",
    former_ticker: "KRUZ",
    fund_return_pct: null,
    spy_return_pct: null,
    vs_spy_pct: null,
    xle_return_pct: null,
    xlf_return_pct: null,
    ita_return_pct: null,
    headline: error || "GOP 성과 분해를 불러오지 못했습니다.",
    mode: "unknown",
    bullets: [],
    drivers: [],
    sectors: [],
    coverage_weight_pct: null,
    explained_contrib_pct: null,
    note: GOP_WHY_NOTE,
    error,
  };
}

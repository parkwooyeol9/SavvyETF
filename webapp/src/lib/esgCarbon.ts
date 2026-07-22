export type CarbonBar = {
  date: string;
  close: number;
  volume: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  value?: number | null;
};

export type CarbonQuote = {
  last: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
};

export type CarbonSeries = {
  symbol: string;
  name: string;
  market: "KR" | "US";
  currency: string;
  unit?: string;
  quote: CarbonQuote;
  daily: CarbonBar[];
  source: string;
};

export type EsgCarbonPayload = {
  ok: boolean;
  generated_at?: string;
  note?: string;
  domestic?: CarbonSeries | null;
  global?: CarbonSeries[];
  error?: string;
};

export function fmtCarbonPrice(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtCarbonVol(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("ko-KR");
}

export function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

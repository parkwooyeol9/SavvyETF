/** NLP live price chart — Yahoo OHLC + volume for a universe ticker. */

export type NlpChartRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "5y";

export type NlpChartBar = {
  date: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type NlpChartPayload = {
  ok: boolean;
  symbol: string;
  yahoo_symbol: string;
  name?: string;
  currency: "KRW" | "USD";
  range: NlpChartRange;
  interval_label: string;
  price: number | null;
  change_pct: number | null;
  range_pct: number | null;
  volume: number | null;
  bars: NlpChartBar[];
  error?: string;
};

export const NLP_CHART_RANGES: Array<{ id: NlpChartRange; label: string }> = [
  { id: "1d", label: "1일" },
  { id: "5d", label: "5일" },
  { id: "1mo", label: "1개월" },
  { id: "3mo", label: "3개월" },
  { id: "6mo", label: "6개월" },
  { id: "1y", label: "1년" },
  { id: "5y", label: "5년" },
];

export const NLP_CHART_QUERY: Record<
  NlpChartRange,
  { range: string; interval: string; maxBars: number }
> = {
  "1d": { range: "1d", interval: "5m", maxBars: 96 },
  "5d": { range: "5d", interval: "15m", maxBars: 130 },
  "1mo": { range: "1mo", interval: "1d", maxBars: 40 },
  "3mo": { range: "3mo", interval: "1d", maxBars: 80 },
  "6mo": { range: "6mo", interval: "1d", maxBars: 100 },
  "1y": { range: "1y", interval: "1d", maxBars: 160 },
  "5y": { range: "5y", interval: "1wk", maxBars: 160 },
};

export function parseNlpChartRange(value: string | null | undefined): NlpChartRange {
  if (
    value === "1d" ||
    value === "5d" ||
    value === "1mo" ||
    value === "3mo" ||
    value === "6mo" ||
    value === "1y" ||
    value === "5y"
  ) {
    return value;
  }
  return "3mo";
}

export function nlpChartIntervalLabel(range: NlpChartRange): string {
  switch (range) {
    case "1d":
      return "5분봉";
    case "5d":
      return "15분봉";
    case "5y":
      return "주봉";
    default:
      return "일봉";
  }
}

export function toYahooChartSymbol(ticker: string): string {
  const raw = ticker.trim();
  if (raw.startsWith("^")) return `^${raw.slice(1).toUpperCase()}`;
  const symbol = raw.toUpperCase();
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) return symbol;
  return symbol.replace(/\./g, "-");
}

export function downsampleNlpBars(bars: NlpChartBar[], maxBars: number): NlpChartBar[] {
  if (bars.length <= maxBars) return bars;
  const size = Math.ceil(bars.length / maxBars);
  const out: NlpChartBar[] = [];
  for (let i = 0; i < bars.length; i += size) {
    const chunk = bars.slice(i, i + size);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    let high = first.high;
    let low = first.low;
    let volume = 0;
    let hasVol = false;
    for (const b of chunk) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      if (b.volume != null && Number.isFinite(b.volume)) {
        volume += b.volume;
        hasVol = true;
      }
    }
    out.push({
      date: last.date,
      label: last.label,
      open: first.open,
      high,
      low,
      close: last.close,
      volume: hasVol ? volume : null,
    });
  }
  return out;
}

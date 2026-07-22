/** Korean market dashboard types + technical helpers (client/server shared). */

export type KrCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type KrIndexQuote = {
  code: string;
  name: string;
  last: number;
  change: number;
  change_pct: number;
  open?: number;
  high?: number;
  low?: number;
  prev_close?: number;
  market_status?: string;
};

export type KrFlowPoint = {
  time: string;
  individual: number;
  foreign: number;
  institution: number;
};

export type KrFlowDay = {
  date: string;
  individual: number;
  foreign: number;
  institution: number;
};

export type KrCreditRow = {
  date: string;
  customer_deposit: number;
  credit_balance: number;
  fund_stock: number;
  fund_mixed: number;
  fund_bond: number;
};

export type SingleStockLevMeta = {
  code: string;
  name: string;
  underlying: "samsung" | "hynix";
  direction: "lev" | "inv";
  structure: "spot" | "fut";
};

export type SingleStockLevRow = {
  code: string;
  name: string;
  underlying: "samsung" | "hynix";
  direction: "lev" | "inv";
  structure: "spot" | "fut";
  last: number;
  change: number;
  change_pct: number;
  volume: number;
  value: number; // KRW
  value_eok: number; // 억원
  foreign_net: number | null; // shares (latest session)
  institution_net: number | null;
  individual_net: number | null;
  trend_date?: string | null;
  market_status?: string;
};

/** 2026-05-27 listed Samsung/Hynix single-stock leverage·inverse ETFs (16). */
export const SINGLE_STOCK_LEV_ETFS: SingleStockLevMeta[] = [
  { code: "0193W0", name: "KODEX 삼성전자단일종목레버리지", underlying: "samsung", direction: "lev", structure: "spot" },
  { code: "0195R0", name: "TIGER 삼성전자단일종목레버리지", underlying: "samsung", direction: "lev", structure: "spot" },
  { code: "0194M0", name: "ACE 삼성전자단일종목레버리지", underlying: "samsung", direction: "lev", structure: "spot" },
  { code: "0192M0", name: "RISE 삼성전자단일종목레버리지", underlying: "samsung", direction: "lev", structure: "spot" },
  { code: "0193K0", name: "PLUS 삼성전자단일종목레버리지", underlying: "samsung", direction: "lev", structure: "spot" },
  { code: "0194N0", name: "KIWOOM 삼성전자선물단일종목레버리지", underlying: "samsung", direction: "lev", structure: "fut" },
  { code: "0198B0", name: "1Q 삼성전자선물단일종목레버리지", underlying: "samsung", direction: "lev", structure: "fut" },
  { code: "0193L0", name: "PLUS 삼성전자선물단일종목인버스2X", underlying: "samsung", direction: "inv", structure: "fut" },
  { code: "0193T0", name: "KODEX SK하이닉스단일종목레버리지", underlying: "hynix", direction: "lev", structure: "spot" },
  { code: "0195S0", name: "TIGER SK하이닉스단일종목레버리지", underlying: "hynix", direction: "lev", structure: "spot" },
  { code: "0194T0", name: "ACE SK하이닉스단일종목레버리지", underlying: "hynix", direction: "lev", structure: "spot" },
  { code: "0192L0", name: "RISE SK하이닉스단일종목레버리지", underlying: "hynix", direction: "lev", structure: "spot" },
  { code: "0197W0", name: "SOL SK하이닉스단일종목레버리지", underlying: "hynix", direction: "lev", structure: "spot" },
  { code: "0194R0", name: "KIWOOM SK하이닉스선물단일종목레버리지", underlying: "hynix", direction: "lev", structure: "fut" },
  { code: "0198D0", name: "1Q SK하이닉스선물단일종목레버리지", underlying: "hynix", direction: "lev", structure: "fut" },
  { code: "0197X0", name: "SOL SK하이닉스선물단일종목인버스2X", underlying: "hynix", direction: "inv", structure: "fut" },
];

export type KrTechnicals = {
  sma5?: number | null;
  sma20?: number | null;
  sma60?: number | null;
  rsi14?: number | null;
  macd?: number | null;
  macd_signal?: number | null;
  macd_hist?: number | null;
  regime?: string;
};

export type KrIndexBoard = {
  quote: KrIndexQuote;
  intraday: KrCandle[];
  daily: KrCandle[];
  technicals: KrTechnicals;
};

export type KrMarketPayload = {
  ok: boolean;
  error?: string;
  generated_at?: string;
  note?: string;
  kospi200?: KrIndexBoard;
  kosdaq?: KrIndexBoard;
  kosdaq150?: {
    quote: KrIndexQuote;
    daily: KrCandle[];
    technicals: KrTechnicals;
  };
  flows?: {
    kospi_intraday: KrFlowPoint[];
    kosdaq_intraday: KrFlowPoint[];
    kospi_daily: KrFlowDay[];
    kosdaq_daily: KrFlowDay[];
    as_of?: string;
  };
  credit?: {
    rows: KrCreditRow[];
    latest?: KrCreditRow | null;
    credit_ratio_proxy?: number | null;
  };
  single_stock_lev?: {
    rows: SingleStockLevRow[];
    total_value_eok: number;
    as_of?: string;
  };
};

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function macd(values: number[]): {
  macd: number | null;
  signal: number | null;
  hist: number | null;
} {
  if (values.length < 26) return { macd: null, signal: null, hist: null };
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine[signalLine.length - 1];
  return {
    macd: macdVal,
    signal: signalVal,
    hist: macdVal - signalVal,
  };
}

export function computeTechnicals(closes: number[]): KrTechnicals {
  const m = macd(closes);
  const s5 = sma(closes, 5);
  const s20 = sma(closes, 20);
  const s60 = sma(closes, 60);
  const last = closes[closes.length - 1];
  let regime = "중립";
  if (last != null && s20 != null && s60 != null) {
    if (last > s20 && s20 > s60) regime = "상승 추세";
    else if (last < s20 && s20 < s60) regime = "하락 추세";
    else if (last > s20) regime = "단기 반등";
    else regime = "단기 조정";
  }
  return {
    sma5: s5,
    sma20: s20,
    sma60: s60,
    rsi14: rsi(closes, 14),
    macd: m.macd,
    macd_signal: m.signal,
    macd_hist: m.hist,
    regime,
  };
}

export function fmtKrwEok(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}조`;
  return `${sign}${abs.toLocaleString("ko-KR")}억`;
}

export function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function fmtShares(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}만`;
  return `${sign}${abs.toLocaleString("ko-KR")}`;
}

export function fmtValueEok(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 100) return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`;
  if (n >= 10) return `${n.toFixed(1)}억`;
  return `${n.toFixed(2)}억`;
}

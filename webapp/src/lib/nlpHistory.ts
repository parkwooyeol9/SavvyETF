import seed from "@/data/nlpHistoryUniverse.json";

export type NlpHistoryMarket = "kospi" | "kosdaq";

export type NlpHistoryName = {
  code: string;
  name: string;
  market: NlpHistoryMarket;
  yahoo: string;
  n_days?: number;
  n_headlines?: number;
  last_score?: number | null;
  last_date?: string | null;
};

export type NlpHistoryHeadline = {
  title: string;
  source: string;
  url?: string;
  score: number;
  matched: string[];
};

export type NlpHistoryDay = {
  date: string;
  score: number;
  n: number;
  bull_n: number;
  bear_n: number;
  headlines: NlpHistoryHeadline[];
};

export type NlpHistoryIndex = {
  ok: boolean;
  generated_at?: string;
  lookback_days: number;
  max_headlines_per_day: number;
  methodology: string[];
  names: NlpHistoryName[];
  error?: string;
};

export type NlpHistorySeries = {
  ok: boolean;
  code: string;
  name: string;
  market: NlpHistoryMarket;
  yahoo: string;
  query?: string;
  updated_at?: string;
  n_days: number;
  n_headlines: number;
  last_score?: number | null;
  last_date?: string | null;
  days: NlpHistoryDay[];
  error?: string;
};

export const NLP_HISTORY_R2_PREFIX = "nlp_history";

export const NLP_HISTORY_SEED: NlpHistoryName[] = (seed.names as NlpHistoryName[]).map((row) => ({
  code: row.code,
  name: row.name,
  market: row.market === "kosdaq" ? "kosdaq" : "kospi",
  yahoo: row.yahoo,
}));

export function emptyNlpHistoryIndex(error?: string): NlpHistoryIndex {
  return {
    ok: false,
    lookback_days: 365,
    max_headlines_per_day: 8,
    methodology: [],
    names: NLP_HISTORY_SEED,
    error,
  };
}

export function emptyNlpHistorySeries(code: string, error?: string): NlpHistorySeries {
  const spec = NLP_HISTORY_SEED.find((n) => n.code === code);
  return {
    ok: false,
    code,
    name: spec?.name || code,
    market: spec?.market || "kospi",
    yahoo: spec?.yahoo || `${code}.KS`,
    n_days: 0,
    n_headlines: 0,
    days: [],
    error,
  };
}

export function nlpHistoryTone(score: number): "bull" | "bear" | "flat" {
  if (score >= 12) return "bull";
  if (score <= -12) return "bear";
  return "flat";
}

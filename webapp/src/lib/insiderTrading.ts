/**
 * US insider trading (SEC Form 4) — shared types, labels and formatters.
 * Server ingest lives in `insiderServer.ts`.
 */

export type InsiderTx = {
  /** `${accession}:${index}` — stable across re-ingest. */
  id: string;
  acc: string;
  /** Filing date (ET, YYYY-MM-DD) and, when known, time (HH:MM ET). */
  filed: string;
  filed_time: string | null;
  ticker: string;
  issuer: string;
  issuer_cik: string;
  owner: string;
  owner_cik: string;
  role: string;
  is_director: boolean;
  is_officer: boolean;
  is_ten_pct: boolean;
  c_suite: boolean;
  date: string;
  code: string;
  acquired: boolean;
  shares: number;
  price: number | null;
  value: number;
  owned_after: number | null;
  /** Shares traded relative to the holding before the trade (%). */
  own_chg_pct: number | null;
  direct: boolean;
  plan_10b5_1: boolean;
  url: string;
};

export type InsiderCluster = {
  ticker: string;
  issuer: string;
  insiders: Array<{ owner: string; role: string; value: number; date: string; c_suite: boolean }>;
  n_insiders: number;
  total_value: number;
  shares: number;
  avg_price: number | null;
  first_date: string;
  last_date: string;
  has_c_suite: boolean;
  last_price: number | null;
  ret_pct: number | null;
  /** Last close vs 52-week high (%, ≤ 0). Null when Yahoo history is short/unavailable. */
  dd_52w_pct: number | null;
};

export type InsiderNetRow = {
  ticker: string;
  issuer: string;
  buy_value: number;
  sell_value: number;
  sell_value_discretionary: number;
  net_value: number;
  buyers: number;
  sellers: number;
};

export type InsiderDay = {
  date: string;
  buyers: number;
  sellers: number;
  sellers_discretionary: number;
  buy_value: number;
  sell_value: number;
};

export type InsiderPriced = InsiderTx & {
  last_price: number | null;
  ret_pct: number | null;
  dd_52w_pct: number | null;
};

export type InsiderSummary = {
  ok: boolean;
  updated_at: string | null;
  coverage: { from: string | null; to: string | null; days: number; tx: number };
  backfill_pending: number;
  sentiment: {
    days: InsiderDay[];
    buyers_7d: number;
    sellers_7d: number;
    sellers_discretionary_7d: number;
    ratio_7d: number | null;
    ratio_30d: number | null;
  };
  clusters: InsiderCluster[];
  top_buys: InsiderPriced[];
  c_suite_buys: InsiderPriced[];
  net_buyers: InsiderNetRow[];
  net_sellers: InsiderNetRow[];
  latest_buys: InsiderTx[];
  latest_sells: InsiderTx[];
  note?: string;
};

export type InsiderLookup = {
  ok: boolean;
  ticker: string;
  issuer: string | null;
  cik: string | null;
  from: string;
  filings: number;
  /** Oldest filing date actually read (lookups stop at LOOKUP_MAX_FILINGS). */
  covered_from: string | null;
  truncated: boolean;
  failed: number;
  rows: InsiderTx[];
  totals: {
    buy_value: number;
    sell_value: number;
    sell_value_discretionary: number;
    buyers: number;
    sellers: number;
  };
  last_price: number | null;
  error?: string;
};

export type InsiderNewsItem = {
  title: string;
  source: string;
  url: string;
  published: string | null;
};

/** A ticker surfaced by recent insider-trading headlines, confirmed by SEC Form 4 filings. */
export type InsiderSpotlightItem = {
  ticker: string;
  issuer: string;
  side: "buy" | "sell" | "mixed";
  score: number;
  /** Largest dollar amount quoted in a headline. */
  max_amount: number | null;
  c_suite: boolean;
  multi_insider: boolean;
  form4_14d: number;
  last_form4: string | null;
  news_count: number;
  news: InsiderNewsItem[];
  /** From the ingested 30-day summary, when the ticker shows up there. */
  in_cluster: number | null;
  net_value: number | null;
};

export type InsiderSpotlight = {
  ok: boolean;
  updated_at: string;
  headlines: number;
  items: InsiderSpotlightItem[];
  error?: string;
};

export const TX_CODE_LABEL: Record<string, string> = {
  P: "장내 매수",
  S: "장내 매도",
  A: "주식 보상(부여)",
  M: "옵션·RSU 행사",
  X: "옵션 행사",
  C: "전환",
  F: "세금 납부용 처분",
  G: "증여",
  D: "회사에 반환",
  J: "기타",
  W: "상속",
  I: "재량 거래",
};

export function txLabel(code: string): string {
  return TX_CODE_LABEL[code] || code;
}

export function roleKo(t: Pick<InsiderTx, "role" | "is_director" | "is_officer" | "is_ten_pct">): string {
  if (t.is_officer && t.role) return t.role;
  if (t.is_director) return "이사";
  if (t.is_ten_pct) return "10% 대주주";
  return t.role || "기타";
}

export function fmtUsdShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

export function fmtShares(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  return `$${v >= 100 ? v.toFixed(1) : v.toFixed(2)}`;
}

export function fmtPct(v: number | null | undefined, digits = 1, sign = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

/** 13F holders per ticker (from `/api/13f?tickers=`), used for the cross-check badge. */
export type Insider13FHolder = { id: string; name_ko: string; weight_pct: number; change: string };
export type Insider13FMap = Record<string, Insider13FHolder[]>;

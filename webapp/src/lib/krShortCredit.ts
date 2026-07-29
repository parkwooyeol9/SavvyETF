/**
 * KR short-sale / credit leverage types (Naver market credit + KRX short).
 * Stock lending (대차잔고) has no confirmed key-free public API — omitted.
 */

export type KrShortTradePoint = {
  date: string; // YYYY-MM-DD
  short_volume: number;
  total_volume: number;
  /** Short volume / total volume (%) — KRX TRDVOL_WT */
  short_volume_wt_pct: number | null;
  short_value: number;
  total_value: number;
  short_value_wt_pct: number | null;
};

export type KrShortBalancePoint = {
  date: string;
  bal_qty: number;
  bal_amt: number;
  list_shares: number;
  /** Net short balance / listed shares (%) — KRX BAL_RTO */
  bal_rto_pct: number | null;
};

export type KrMarketShortSnapshot = {
  market: "KOSPI" | "KOSDAQ";
  as_of: string;
  stock_count: number;
  bal_qty: number;
  list_shares: number;
  bal_amt: number;
  /** Weighted: Σ bal_qty / Σ list_shares × 100 */
  bal_rto_pct: number | null;
};

export type KrStockShortBoard = {
  code: string;
  name: string;
  isin: string;
  trade: KrShortTradePoint[];
  balance: KrShortBalancePoint[];
  latest_trade?: KrShortTradePoint | null;
  latest_balance?: KrShortBalancePoint | null;
};

export type KrShortCreditBoard = {
  source_note: string;
  unavailable: string[];
  market_balance: KrMarketShortSnapshot[];
  market_balance_history?: Record<"KOSPI" | "KOSDAQ", KrMarketShortSnapshot[]>;
  stocks: KrStockShortBoard[];
};

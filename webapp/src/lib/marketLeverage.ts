/**
 * Market-wide leverage indicators for the 레버리지ETF tab.
 * Types shared by /api/market-leverage and the client UI.
 */

import type { KrCreditRow, SingleStockLevBoard } from "@/lib/krMarket";

export type KrCreditRowEx = KrCreditRow & {
  customer_deposit_delta?: number | null;
  credit_balance_delta?: number | null;
  /** 신용잔고 / 고객예탁금 × 100 */
  credit_ratio?: number | null;
};

export type ProgramDay = {
  date: string; // YYYY-MM-DD
  arb_net: number;
  nonarb_net: number;
  total_buy: number;
  total_sell: number;
  total_net: number;
};

export type MarketLeveragePayload = {
  ok: boolean;
  error?: string;
  generated_at?: string;
  source?: string;
  note?: string;
  as_of?: string;
  stored_at?: string;
  from_store?: boolean;
  credit?: {
    rows: KrCreditRowEx[];
    latest?: KrCreditRowEx | null;
    credit_ratio_proxy?: number | null;
  };
  single_stock_lev?: SingleStockLevBoard;
  /** KOSPI 프로그램매매 일별 (억원) */
  program_kospi?: {
    rows: ProgramDay[];
    latest?: ProgramDay | null;
  };
};

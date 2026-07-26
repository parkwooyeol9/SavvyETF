/**
 * Single-stock leverage ETF desk / investor flow dashboard.
 * Source: Naver Finance item/frgn (20분 지연 거래원 · 일별 투자자 순매매).
 */

import {
  SINGLE_STOCK_LEV_ETFS,
  levGroupKey,
  type LevGroupKey,
  type SingleStockLevMeta,
} from "@/lib/krMarket";

export type TraderWindow = 1 | 5 | 20 | 60;

export const TRADER_WINDOWS: TraderWindow[] = [1, 5, 20, 60];

export type BrokerVolume = {
  broker: string;
  volume: number;
};

export type TraderSnapshot = {
  window: TraderWindow;
  sell_top: BrokerVolume[];
  buy_top: BrokerVolume[];
  /** 외국인순매매량 or 외국계추정합 when present */
  foreign_net: number | null;
  foreign_label: string | null;
};

export type InvestorDay = {
  date: string; // YYYY-MM-DD
  close: number;
  change: number;
  change_pct: number;
  /** Total traded shares (개인+기관+외국인 등 전체 체결). */
  volume: number;
  institution_net: number;
  foreign_net: number;
  /**
   * 개인 순매매 추정: -(외국인+기관).
   * 네이버 표가 개인·기관·외국인 삼분법일 때 성립(기타법인이 분리되면 오차 가능).
   */
  individual_net: number;
  foreign_shares: number | null;
  foreign_ratio: number | null;
};

/** 개인 ≈ -(외국인 + 기관) under the portal's 3-way investor split. */
export function individualNetFrom(
  foreignNet: number,
  institutionNet: number,
): number {
  return -(foreignNet + institutionNet);
}

export type LevEtfItem = {
  code: string;
  name: string;
  underlying: "samsung" | "hynix";
  direction: "lev" | "inv";
  structure: "spot" | "fut";
  group: LevGroupKey;
  traders: TraderSnapshot[];
  investors: InvestorDay[];
  error?: string;
};

export type LevEtfPayload = {
  ok: boolean;
  error?: string;
  generated_at?: string;
  source?: string;
  note?: string;
  items?: LevEtfItem[];
  /** KST trading date of the R2 snapshot (YYYY-MM-DD). */
  as_of?: string;
  stored_at?: string;
  from_store?: boolean;
};

/** Compact daily archive of window=1 trader tops (R2 lev-etf/traders/YYYY-MM-DD). */
export type LevEtfTraderDayItem = {
  code: string;
  name: string;
  underlying: "samsung" | "hynix";
  direction: "lev" | "inv";
  structure: "spot" | "fut";
  group: LevGroupKey;
  trader: TraderSnapshot;
  investor: InvestorDay | null;
  error?: string;
};

export type LevEtfTraderDayArchive = {
  ok: boolean;
  error?: string;
  as_of: string;
  generated_at: string;
  source?: string;
  note?: string;
  items: LevEtfTraderDayItem[];
};

export const LEV_ETF_UNIVERSE: SingleStockLevMeta[] = SINGLE_STOCK_LEV_ETFS;

export function metaToGroup(meta: SingleStockLevMeta): LevGroupKey {
  return levGroupKey(meta.underlying, meta.direction);
}

export const LEV_ETF_GROUP_LABELS: Record<LevGroupKey, string> = {
  samsung_lev: "전자 2x",
  samsung_inv: "전자 -2x",
  hynix_inv: "닉스 -2x",
  hynix_lev: "닉스 2x",
};

export function fmtVol(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}억주`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}만주`;
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}주`;
}

export function fmtNet(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${Math.round(n).toLocaleString("ko-KR")}`;
}

export function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

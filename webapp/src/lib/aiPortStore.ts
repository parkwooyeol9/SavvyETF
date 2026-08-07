/**
 * AI포트 — follow daily trading ideas and track cumulative performance locally.
 */

import {
  newPortfolioId,
  newTradeId,
  type PortfolioTrade,
  type UsPortfolioResult,
} from "@/lib/usPortfolio";
import type { TradingIdeasPayload } from "@/lib/tradingIdeas";

const STORAGE_KEY = "savvyetf:ai-port:v1";

export type AiPortIdeaSnap = {
  as_of: string;
  cash_pct: number;
  targets: Array<{ symbol: string; weight_pct: number; name: string }>;
  summary: string[];
};

export type AiPortHistoryEntry = {
  as_of: string;
  cumulative_return_pct: number;
  excess_vs_spy_pct: number;
  week_return_pct: number | null;
  final_value: number;
  max_drawdown_pct: number;
  volatility_pct: number | null;
};

export type StoredAiPort = {
  portfolio_id: string;
  name: string;
  initial_cash: number;
  /** Chronological idea snapshots that have been applied */
  snapshots: AiPortIdeaSnap[];
  history: AiPortHistoryEntry[];
  updated_at: string;
};

export function defaultAiPort(): StoredAiPort {
  return {
    portfolio_id: newPortfolioId(),
    name: "AI포트",
    initial_cash: 100_000,
    snapshots: [],
    history: [],
    updated_at: new Date().toISOString(),
  };
}

export function loadAiPort(): StoredAiPort {
  if (typeof window === "undefined") return defaultAiPort();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAiPort();
    return JSON.parse(raw) as StoredAiPort;
  } catch {
    return defaultAiPort();
  }
}

export function saveAiPort(store: StoredAiPort): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Append today's ideas if as_of is new. */
export function applyIdeasToAiPort(
  store: StoredAiPort,
  ideas: TradingIdeasPayload,
): StoredAiPort {
  if (!ideas.ok || !ideas.as_of || !ideas.target_weights.length) return store;
  if (store.snapshots.some((s) => s.as_of === ideas.as_of)) return store;
  const snap: AiPortIdeaSnap = {
    as_of: ideas.as_of,
    cash_pct: ideas.cash_pct,
    targets: ideas.target_weights,
    summary: ideas.summary,
  };
  return {
    ...store,
    snapshots: [...store.snapshots, snap].sort((a, b) =>
      a.as_of.localeCompare(b.as_of),
    ),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Convert idea snapshots into open/close ledger trades for us-portfolio sim.
 * Each day: sell-all prior names, then buy new weights at close.
 */
export function tradesFromAiPortSnapshots(
  snapshots: AiPortIdeaSnap[],
): PortfolioTrade[] {
  const trades: PortfolioTrade[] = [];
  let prevSymbols: string[] = [];

  for (const snap of snapshots) {
    for (const sym of prevSymbols) {
      trades.push({
        id: newTradeId(),
        symbol: sym,
        side: "sell",
        date: snap.as_of,
        price_mode: "close",
        shares: null,
        notional_usd: null,
        weight_pct: null,
        note: "AI포트 리밸런싱 청산",
      });
    }
    for (const t of snap.targets) {
      if (!(t.weight_pct > 0)) continue;
      trades.push({
        id: newTradeId(),
        symbol: t.symbol,
        side: "buy",
        date: snap.as_of,
        price_mode: "close",
        shares: null,
        notional_usd: null,
        weight_pct: t.weight_pct,
        note: `AI포트 ${t.name}`,
      });
    }
    prevSymbols = snap.targets.filter((t) => t.weight_pct > 0).map((t) => t.symbol);
  }
  return trades;
}

export function appendAiPortHistory(
  store: StoredAiPort,
  result: UsPortfolioResult,
): StoredAiPort {
  if (!result.ok) return store;
  const as_of = result.end_date || new Date().toISOString().slice(0, 10);
  const entry: AiPortHistoryEntry = {
    as_of,
    cumulative_return_pct: result.cumulative_return_pct,
    excess_vs_spy_pct: result.excess_vs_spy_pct,
    week_return_pct: result.week_return_pct,
    final_value: result.final_value,
    max_drawdown_pct: result.max_drawdown_pct,
    volatility_pct: result.risk?.volatility_pct ?? null,
  };
  const history = [
    ...store.history.filter((h) => h.as_of !== entry.as_of),
    entry,
  ]
    .sort((a, b) => a.as_of.localeCompare(b.as_of))
    .slice(-120);
  return { ...store, history, updated_at: new Date().toISOString() };
}

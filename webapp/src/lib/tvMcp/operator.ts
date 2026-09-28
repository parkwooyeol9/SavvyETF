import type { TvMcpSession } from "@/lib/tvMcp/client";

export const MAX_SYNC_SYMBOLS = 30;
const US_PRIMARY_EXCHANGES = ["NASDAQ", "NYSE", "AMEX", "CBOE", "BATS"];

export type TvWatchlistSummary = {
  id: string;
  name: string;
  count: number;
  active: boolean;
  symbols: string[];
};

export type TvAlertSummary = {
  id: string;
  name: string;
  symbol: string;
  active: boolean;
  condition: string;
  threshold: number | null;
};

export type TvAlertFire = {
  symbol: string;
  name: string;
  firedAt: string;
  message: string;
};

type RawWatchlist = { id?: number | string; name?: string; symbols?: string[]; active?: boolean };
type RawSearch = { data?: { symbols?: Array<{ symbol?: string }> } };

function isSectionMarker(symbol: string): boolean {
  return symbol.startsWith("###");
}

export function normalizeListName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

function findList(lists: RawWatchlist[], opts: { id?: string; name?: string }): RawWatchlist | undefined {
  if (opts.id) return lists.find((w) => str(w.id) === opts.id);
  const target = normalizeListName(opts.name || "");
  return target ? lists.find((w) => normalizeListName(w.name || "") === target) : undefined;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === "object") as Array<Record<string, unknown>>) : [];
}

function firstArray(obj: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(obj)) return asRecordArray(obj);
  if (!obj || typeof obj !== "object") return [];
  const rec = obj as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(rec[key])) return asRecordArray(rec[key]);
  }
  if (rec.data && typeof rec.data === "object") return firstArray(rec.data, keys);
  return [];
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function timeText(value: unknown): string {
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return str(value);
}

async function rawWatchlists(tv: TvMcpSession): Promise<RawWatchlist[]> {
  const res = await tv.call<{ watchlists?: RawWatchlist[] }>("mcp-watchlist-list-watchlists");
  return res.watchlists || [];
}

export async function listWatchlists(tv: TvMcpSession): Promise<TvWatchlistSummary[]> {
  return (await rawWatchlists(tv)).map((w) => {
    const symbols = (w.symbols || []).filter((s) => !isSectionMarker(s));
    return {
      id: str(w.id),
      name: w.name || "(이름 없음)",
      count: symbols.length,
      active: Boolean(w.active),
      symbols,
    };
  });
}

export async function deleteWatchlist(tv: TvMcpSession, id: string): Promise<void> {
  await tv.call("mcp-watchlist-delete-watchlist", { watchlist_id: id });
}

export async function removeFromWatchlist(
  tv: TvMcpSession,
  opts: { id?: string; name?: string; symbols: string[] },
): Promise<{ watchlistId: string; removed: number }> {
  const target = findList(await rawWatchlists(tv), opts);
  if (!target) throw new Error(`워치리스트를 찾지 못했습니다: ${opts.name || opts.id}`);
  const present = new Set(target.symbols || []);
  const toRemove = opts.symbols.filter((s) => present.has(s));
  if (toRemove.length) {
    await tv.call("mcp-watchlist-remove-from-watchlist", {
      watchlist_id: str(target.id),
      symbols: toRemove,
    });
  }
  return { watchlistId: str(target.id), removed: toRemove.length };
}

export async function deleteAlerts(tv: TvMcpSession, ids: number[]): Promise<void> {
  await tv.call("mcp-tv-delete-alert", { alert_ids: ids });
}

export async function setAlertsActive(tv: TvMcpSession, ids: number[], active: boolean): Promise<void> {
  await tv.call(active ? "mcp-tv-restart-alerts" : "mcp-tv-stop-alerts", { alert_ids: ids });
}

export type TvQuote = { close: number; currency: string };

export async function getQuotes(
  tv: TvMcpSession,
  symbols: string[],
): Promise<{ quotes: Record<string, TvQuote>; missing: string[] }> {
  const res = await tv.call<{
    data?: Record<string, { close?: unknown; currency?: unknown }>;
    missing?: Array<{ symbol?: string }>;
  }>("mcp-tv-get-symbol-data-batch", { symbols, columns: ["close", "currency"] });
  const quotes: Record<string, TvQuote> = {};
  for (const [symbol, row] of Object.entries(res.data || {})) {
    const close = num(row?.close);
    if (close != null && close > 0) quotes[symbol] = { close, currency: str(row?.currency) };
  }
  const missing = symbols.filter((s) => !quotes[s]);
  return { quotes, missing };
}

/** KRW has no decimals; other markets keep up to 2 (or 4 below 1.0). */
export function roundAlertPrice(price: number, currency: string): number {
  if (currency === "KRW") return Math.round(price);
  const digits = price < 1 ? 4 : 2;
  return Number(price.toFixed(digits));
}

export async function listAlerts(tv: TvMcpSession): Promise<TvAlertSummary[]> {
  const res = await tv.call("mcp-tv-list-alerts");
  return firstArray(res, ["alerts"]).map((a) => ({
    id: str(a.alert_id ?? a.id),
    name: str(a.name),
    symbol: str(a.symbol),
    active: Boolean(a.active),
    condition: str(a.condition_type ?? a.condition),
    threshold: num(a.threshold),
  }));
}

export async function listAlertFires(tv: TvMcpSession, days = 7): Promise<TvAlertFire[]> {
  const res = await tv.call("mcp-tv-get-alerts-log", { days, limit: 30 });
  return firstArray(res, ["events", "log", "fires", "alerts", "items"]).map((e) => ({
    symbol: str(e.symbol),
    name: str(e.name ?? e.alert_name),
    firedAt: timeText(e.fired_at ?? e.fire_time ?? e.time ?? e.timestamp),
    message: str(e.message).slice(0, 200),
  }));
}

/** Map SavvyETF tickers (005930, 0238C0, 005930.KS, NVDA, BRK-B, NASDAQ:AAPL) to TradingView symbols. */
export async function resolveSymbols(
  tv: TvMcpSession,
  tokens: string[],
): Promise<{ resolved: string[]; unresolved: string[] }> {
  const resolved: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const push = (symbol: string) => {
    if (!seen.has(symbol)) {
      seen.add(symbol);
      resolved.push(symbol);
    }
  };

  for (const raw of tokens) {
    const token = raw.trim().toUpperCase();
    if (!token) continue;
    if (token.includes(":")) {
      push(token);
      continue;
    }
    const kr = token.match(/^(\d[0-9A-Z]{5})(?:\.(?:KS|KQ))?$/);
    if (kr) {
      push(`KRX:${kr[1]}`);
      continue;
    }
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(token)) {
      unresolved.push(raw);
      continue;
    }
    const ticker = token.replace(/-/g, ".");
    const res = await tv.call<RawSearch>("mcp-tv-search-symbols", { query: ticker });
    const candidates = (res.data?.symbols || [])
      .map((s) => str(s.symbol))
      .filter((s) => s.endsWith(`:${ticker}`));
    const primary = candidates.find((s) => US_PRIMARY_EXCHANGES.includes(s.split(":")[0]));
    if (primary) push(primary);
    else unresolved.push(raw);
  }
  return { resolved, unresolved };
}

export async function syncWatchlist(
  tv: TvMcpSession,
  opts: { id?: string; name: string; symbols: string[]; mode: "append" | "replace" },
): Promise<{ watchlistId: string; created: boolean; added: number; removed: number }> {
  const existing = findList(await rawWatchlists(tv), opts);
  if (opts.id && !existing) throw new Error("선택한 워치리스트를 찾지 못했습니다. 새로고침 후 다시 시도하세요.");

  if (!existing) {
    const res = await tv.call<{ watchlist?: RawWatchlist }>("mcp-watchlist-create-watchlist", {
      name: normalizeListName(opts.name),
      symbols: opts.symbols,
    });
    return {
      watchlistId: str(res.watchlist?.id),
      created: true,
      added: opts.symbols.length,
      removed: 0,
    };
  }

  const id = str(existing.id);
  const current = (existing.symbols || []).filter((s) => !isSectionMarker(s));
  const currentSet = new Set(current);
  const targetSet = new Set(opts.symbols);
  let removed = 0;
  if (opts.mode === "replace") {
    const stale = current.filter((s) => !targetSet.has(s));
    if (stale.length) {
      await tv.call("mcp-watchlist-remove-from-watchlist", { watchlist_id: id, symbols: stale });
      removed = stale.length;
    }
  }
  const toAdd = opts.symbols.filter((s) => !currentSet.has(s));
  if (toAdd.length) {
    await tv.call("mcp-watchlist-add-to-watchlist", { watchlist_id: id, symbols: toAdd });
  }
  return { watchlistId: id, created: false, added: toAdd.length, removed };
}

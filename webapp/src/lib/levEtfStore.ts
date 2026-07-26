/**
 * Persist lev-etf + market-leverage snapshots to Cloudflare R2.
 *
 * Keys:
 *   lev-etf/latest.json
 *   lev-etf/daily/YYYY-MM-DD.json          — full desk payload
 *   lev-etf/traders/YYYY-MM-DD.json        — window=1 daily archive
 *   lev-etf/traders/index.json             — available dates
 *   market-leverage/latest.json
 *   market-leverage/daily/YYYY-MM-DD.json
 */

import type {
  LevEtfItem,
  LevEtfPayload,
  LevEtfTraderDayArchive,
  LevEtfTraderDayItem,
  TraderSnapshot,
} from "@/lib/levEtf";
import type { MarketLeveragePayload } from "@/lib/marketLeverage";
import { r2Configured, r2GetObjectText, r2ListKeys, r2PutObject } from "@/lib/r2";

export type { LevEtfTraderDayArchive, LevEtfTraderDayItem };

export const LEV_ETF_LATEST_KEY = "lev-etf/latest.json";
export const MARKET_LEV_LATEST_KEY = "market-leverage/latest.json";
export const TRADERS_INDEX_KEY = "lev-etf/traders/index.json";

export type TradersIndex = {
  dates: string[];
  updated_at: string;
};

export type StoredLevEtfPayload = LevEtfPayload & {
  as_of?: string;
  stored_at?: string;
  from_store?: boolean;
};

export type StoredMarketLeveragePayload = MarketLeveragePayload & {
  as_of?: string;
  stored_at?: string;
  from_store?: boolean;
};

export function todayAsOfKst(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

export function dailyKey(prefix: "lev-etf" | "market-leverage", asOf: string) {
  return `${prefix}/daily/${asOf}.json`;
}

export function tradersDayKey(asOf: string) {
  return `lev-etf/traders/${asOf}.json`;
}

export function levEtfStoreConfigured(): boolean {
  return r2Configured();
}

async function putJson(key: string, value: unknown): Promise<void> {
  await r2PutObject(
    key,
    JSON.stringify(value),
    "application/json; charset=utf-8",
    "public, max-age=60",
  );
}

async function getJson<T>(key: string): Promise<T | null> {
  const text = await r2GetObjectText(key);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function buildTraderDayArchive(
  payload: LevEtfPayload,
  asOf: string,
): LevEtfTraderDayArchive {
  const items: LevEtfTraderDayItem[] = (payload.items || []).map((item) => {
    const trader =
      item.traders.find((t) => t.window === 1) ||
      ({
        window: 1 as const,
        sell_top: [],
        buy_top: [],
        foreign_net: null,
        foreign_label: null,
      } satisfies TraderSnapshot);
    const investor =
      item.investors.find((d) => d.date === asOf) ||
      item.investors[item.investors.length - 1] ||
      null;
    return {
      code: item.code,
      name: item.name,
      underlying: item.underlying,
      direction: item.direction,
      structure: item.structure,
      group: item.group,
      trader,
      investor,
      error: item.error,
    };
  });

  return {
    ok: true,
    as_of: asOf,
    generated_at: payload.generated_at || new Date().toISOString(),
    source: payload.source,
    note:
      "당일(window=1) 거래원 TOP5 일간 스냅샷. 네이버는 거래원 일별 시계열을 제공하지 않아 매일 16:00에 적재합니다.",
    items,
  };
}

export async function saveLevEtfSnapshot(
  payload: LevEtfPayload,
  asOf: string,
): Promise<{ traders_key: string; daily_key: string }> {
  if (!levEtfStoreConfigured()) throw new Error("R2 is not configured");
  const stored_at = new Date().toISOString();
  const stored: StoredLevEtfPayload = {
    ...payload,
    as_of: asOf,
    stored_at,
    from_store: true,
    note:
      (payload.note || "") +
      ` · R2 스냅샷 ${asOf} (KRX 거래일 16:00 갱신).`,
  };
  const archive = buildTraderDayArchive(payload, asOf);

  await putJson(LEV_ETF_LATEST_KEY, stored);
  await putJson(dailyKey("lev-etf", asOf), stored);
  await putJson(tradersDayKey(asOf), archive);

  const index = (await getJson<TradersIndex>(TRADERS_INDEX_KEY)) || {
    dates: [],
    updated_at: stored_at,
  };
  const dates = new Set(index.dates);
  dates.add(asOf);
  // Also discover from prefix in case index drifted
  const listed = await r2ListKeys("lev-etf/traders/");
  for (const key of listed) {
    const m = key.match(/lev-etf\/traders\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) dates.add(m[1]);
  }
  const sorted = [...dates].sort();
  await putJson(TRADERS_INDEX_KEY, {
    dates: sorted,
    updated_at: stored_at,
  } satisfies TradersIndex);

  return { traders_key: tradersDayKey(asOf), daily_key: dailyKey("lev-etf", asOf) };
}

export async function saveMarketLeverageSnapshot(
  payload: MarketLeveragePayload,
  asOf: string,
): Promise<string> {
  if (!levEtfStoreConfigured()) throw new Error("R2 is not configured");
  const stored_at = new Date().toISOString();
  const stored: StoredMarketLeveragePayload = {
    ...payload,
    as_of: asOf,
    stored_at,
    from_store: true,
    note:
      (payload.note || "") +
      ` · R2 스냅샷 ${asOf} (KRX 거래일 16:00 갱신).`,
  };
  await putJson(MARKET_LEV_LATEST_KEY, stored);
  const key = dailyKey("market-leverage", asOf);
  await putJson(key, stored);
  return key;
}

export async function loadLatestLevEtf(): Promise<StoredLevEtfPayload | null> {
  return getJson<StoredLevEtfPayload>(LEV_ETF_LATEST_KEY);
}

export async function loadLatestMarketLeverage(): Promise<StoredMarketLeveragePayload | null> {
  return getJson<StoredMarketLeveragePayload>(MARKET_LEV_LATEST_KEY);
}

export async function loadTraderDay(
  asOf: string,
): Promise<LevEtfTraderDayArchive | null> {
  return getJson<LevEtfTraderDayArchive>(tradersDayKey(asOf));
}

export async function listTraderDates(): Promise<string[]> {
  const index = await getJson<TradersIndex>(TRADERS_INDEX_KEY);
  if (index?.dates?.length) return [...index.dates].sort().reverse();
  const listed = await r2ListKeys("lev-etf/traders/");
  const dates: string[] = [];
  for (const key of listed) {
    const m = key.match(/lev-etf\/traders\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) dates.push(m[1]);
  }
  return [...new Set(dates)].sort().reverse();
}

/** Prefer investor row matching as_of for UI when serving stored payload. */
export function attachAsOfMeta(
  payload: LevEtfPayload,
  asOf: string,
): StoredLevEtfPayload {
  return {
    ...payload,
    as_of: asOf,
    from_store: true,
  };
}

export function summarizeItems(items: LevEtfItem[] | undefined): {
  n: number;
  errors: number;
} {
  const list = items || [];
  return { n: list.length, errors: list.filter((i) => i.error).length };
}

import { NextResponse } from "next/server";

/** CDN / edge cache tiers aligned with UI poll intervals. */
export const CACHE_TIER = {
  /** Intraday quotes, flows — KrMarketTab polls every 60s */
  live: { sMaxAge: 60, swr: 120 },
  /** KR market composite (indices + short/credit) */
  market: { sMaxAge: 60, swr: 180 },
  /** ETF KOR15 — 10 min UI poll */
  etfSlow: { sMaxAge: 300, swr: 600 },
  /** ETF new listings — 5 min UI poll */
  etfNew: { sMaxAge: 120, swr: 300 },
  /** R2 brief snapshots — slightly longer CDN TTL to cut origin hits from polling */
  briefs: { sMaxAge: 120, swr: 300 },
  /** Yahoo / RSS backed panels */
  yahoo: { sMaxAge: 180, swr: 600 },
  /** Heavy Naver + bot overlays (etf-db, kr-leverage) */
  heavy: { sMaxAge: 180, swr: 600 },
  /** KRX short balance — updates slowly intraday */
  krxShort: { sMaxAge: 600, swr: 900 },
} as const;

export type CacheTier = keyof typeof CACHE_TIER;

export function cdnCacheHeader(tier: CacheTier): string {
  const { sMaxAge, swr } = CACHE_TIER[tier];
  return `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
}

export function jsonWithCdnCache<T>(
  data: T,
  tier: CacheTier,
  status = 200,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": cdnCacheHeader(tier),
      ...extraHeaders,
    },
  });
}

type CacheEntry<T> = {
  data: T;
  freshUntil: number;
  staleUntil: number;
};

const mem = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Process-local single-flight cache with stale-while-revalidate.
 * Complements CDN `s-maxage` so concurrent misses on one instance coalesce.
 */
export async function withServerCache<T>(
  key: string,
  ttlMs: number,
  staleTtlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = mem.get(key) as CacheEntry<T> | undefined;

  if (hit && now < hit.freshUntil) {
    return hit.data;
  }

  if (hit && now < hit.staleUntil) {
    if (!inflight.has(key)) {
      const refresh = fn()
        .then((data) => {
          mem.set(key, {
            data,
            freshUntil: Date.now() + ttlMs,
            staleUntil: Date.now() + ttlMs + staleTtlMs,
          });
          return data;
        })
        .catch(() => {
          /* keep serving stale on refresh failure */
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, refresh);
    }
    return hit.data;
  }

  const pending = inflight.get(key);
  if (pending) return (await pending) as T;

  const run = fn()
    .then((data) => {
      mem.set(key, {
        data,
        freshUntil: Date.now() + ttlMs,
        staleUntil: Date.now() + ttlMs + staleTtlMs,
      });
      return data;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, run);
  return run;
}

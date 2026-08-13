/**
 * Money Flow — ETF basket Flow / AUM connectors.
 *
 * Method: Yahoo totalAssets + NAV → units = AUM/NAV.
 * Period flow (추정): AUM_t − AUM_{t−n} × (NAV_t / NAV_{t−n})
 *   (= NAV × Δunits when units are consistent). Never fabricates when lookback missing.
 *
 * Equity names can also seed from R2 `etf_db_us/latest.json` (same formula as US ETF DB).
 */

import { computeFlowMn, ETF_DB_US_LATEST_KEY } from "@/lib/etfDbUs";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import type { AssetId, MoneyFlowPeriod } from "@/lib/moneyFlow";

export const MONEY_FLOW_ETF_HIST_KEY = "money_flow/etf_basket_history.json";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export type EtfFundStats = {
  symbol: string;
  nav: number | null;
  aum_usd: number | null;
  units: number | null;
  price: number | null;
};

export type BasketFlowResult = {
  flow_usd: number | null;
  aum_usd: number | null;
  flow_aum_pct: number | null;
  symbols_used: string[];
  as_of: string | null;
  lookback_date: string | null;
  method: string;
  estimated: boolean;
  error?: string;
};

/** Non-overlapping representative baskets (no SPY∪VT double count). */
export const ETF_BASKETS: Record<
  AssetId,
  { symbols: string[]; label: string; note: string }
> = {
  us_equity: {
    symbols: ["SPY", "QQQ", "IWM"],
    label: "SPY+QQQ+IWM",
    note: "대형·나스닥·소형 대표 바스켓(메가캡 SPY∩QQQ 일부 중복 가능)",
  },
  global_equity: {
    symbols: ["VXUS"],
    label: "VXUS",
    note: "미국 제외 글로벌 — US 바스켓과 이중집계 방지(VT 미사용)",
  },
  treasury: {
    symbols: ["TLT", "IEF"],
    label: "TLT+IEF",
    note: "장기+중기 국채 ETF(만기 구간 분리)",
  },
  credit: {
    symbols: ["LQD", "HYG"],
    label: "LQD+HYG",
    note: "IG+HY 회사채 ETF",
  },
  gold: {
    symbols: ["GLD"],
    label: "GLD",
    note: "실물 금 ETF",
  },
  oil: {
    symbols: ["USO"],
    label: "USO",
    note: "WTI 선물 기반 원유 ETF(롤 비용 포함)",
  },
  dollar_cash: {
    symbols: ["BIL", "SGOV"],
    label: "BIL+SGOV",
    note: "초단기 국채·현금성 ETF(MMF FRED와 별도)",
  },
  btc: {
    symbols: ["IBIT"],
    label: "IBIT",
    note: "BTC 현물 ETF creations(스테이블 발행과 합산하지 않음)",
  },
  eth_alts: {
    symbols: ["ETHA"],
    label: "ETHA",
    note: "ETH 현물 ETF creations",
  },
};

type HistPoint = {
  date: string;
  symbols: Record<
    string,
    { aum_usd: number; nav: number; units: number }
  >;
};

type YahooJar = { cookie: string; crumb: string; expires: number };
let yahooJar: YahooJar | null = null;

function periodDays(p: MoneyFlowPeriod): number {
  if (p === "1w") return 7;
  if (p === "3m") return 91;
  return 30;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getYahooCrumb(): Promise<YahooJar> {
  const now = Date.now();
  if (yahooJar && yahooJar.expires > now) return yahooJar;
  const warm = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const headersAny = warm.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookies =
    typeof headersAny.getSetCookie === "function" ? headersAny.getSetCookie() : [];
  let cookie = rawCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) {
    const sc = warm.headers.get("set-cookie") || "";
    cookie = sc
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0]!.trim())
      .filter((c) => c.includes("="))
      .join("; ");
  }
  const crumbRes = await fetch(
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
    {
      headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
    },
  );
  if (!crumbRes.ok) throw new Error(`Yahoo crumb HTTP ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 40 || crumb.includes("<")) {
    throw new Error("Yahoo crumb invalid");
  }
  yahooJar = { cookie, crumb, expires: now + 25 * 60_000 };
  return yahooJar;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      worker(),
    ),
  );
  return out;
}

export async function fetchYahooFundStats(
  symbols: string[],
): Promise<Map<string, EtfFundStats>> {
  const out = new Map<string, EtfFundStats>();
  if (!symbols.length) return out;
  let jar: YahooJar;
  try {
    jar = await getYahooCrumb();
  } catch {
    return out;
  }
  const rows = await mapPool(symbols, 4, async (symbol) => {
    try {
      const url =
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=price,defaultKeyStatistics,summaryDetail&crumb=${encodeURIComponent(jar.crumb)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Cookie: jar.cookie,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        quoteSummary?: {
          result?: Array<{
            price?: Record<string, { raw?: number }>;
            defaultKeyStatistics?: Record<string, { raw?: number }>;
            summaryDetail?: Record<string, { raw?: number }>;
          }>;
        };
      };
      const r = json.quoteSummary?.result?.[0];
      if (!r) return null;
      const ks = r.defaultKeyStatistics || {};
      const sd = r.summaryDetail || {};
      const pr = r.price || {};
      const price = num(pr.regularMarketPrice?.raw);
      const nav =
        num(pr.navPrice?.raw) ?? num(sd.navPrice?.raw) ?? price;
      const aum =
        num(ks.totalAssets?.raw) ?? num(sd.totalAssets?.raw);
      let units = num(ks.sharesOutstanding?.raw);
      if ((units == null || !(units > 0)) && nav != null && nav > 0 && aum != null) {
        units = aum / nav;
      }
      return {
        symbol: symbol.toUpperCase(),
        nav,
        aum_usd: aum,
        units,
        price,
      } satisfies EtfFundStats;
    } catch {
      return null;
    }
  });
  for (const row of rows) {
    if (row) out.set(row.symbol, row);
  }
  return out;
}

async function loadBasketHistory(): Promise<HistPoint[]> {
  if (!r2Configured()) return [];
  try {
    const text = await r2GetObjectText(MONEY_FLOW_ETF_HIST_KEY);
    if (!text) return [];
    const data = JSON.parse(text) as { points?: HistPoint[] };
    return Array.isArray(data.points) ? data.points : [];
  } catch {
    return [];
  }
}

async function persistBasketHistory(points: HistPoint[]): Promise<void> {
  if (!r2Configured()) return;
  const trimmed = points.slice(-180);
  try {
    await r2PutObject(
      MONEY_FLOW_ETF_HIST_KEY,
      JSON.stringify({ points: trimmed, updated_at: new Date().toISOString() }),
      "application/json",
    );
  } catch {
    /* ignore */
  }
}

/** Seed history from US ETF DB latest snapshot when available. */
async function seedFromEtfDbUs(
  symbols: Set<string>,
): Promise<HistPoint[]> {
  const points: HistPoint[] = [];

  if (r2Configured()) {
    try {
      const text = await r2GetObjectText(ETF_DB_US_LATEST_KEY);
      if (text) {
        const data = JSON.parse(text) as {
          as_of?: string;
          rows?: Array<{
            symbol?: string;
            units?: number | null;
            nav?: number | null;
            aum_mn?: number | null;
          }>;
          ticker_series?: Record<
            string,
            {
              dates?: string[];
              units?: Array<number | null>;
              nav?: Array<number | null>;
              aum_mn?: Array<number | null>;
            }
          >;
        };
        if (data.as_of) {
          const symbolsMap: HistPoint["symbols"] = {};
          for (const r of data.rows || []) {
            const sym = (r.symbol || "").toUpperCase();
            if (!symbols.has(sym)) continue;
            const nav = r.nav ?? null;
            const aum =
              r.aum_mn != null && r.aum_mn > 0 ? r.aum_mn * 1_000_000 : null;
            let units = r.units ?? null;
            if (
              (units == null || !(units > 0)) &&
              nav != null &&
              nav > 0 &&
              aum != null
            ) {
              units = aum / nav;
            }
            if (nav == null || !(nav > 0) || aum == null || units == null) continue;
            symbolsMap[sym] = { aum_usd: aum, nav, units };
          }
          if (Object.keys(symbolsMap).length) {
            points.push({ date: data.as_of, symbols: symbolsMap });
          }
        }
        // Historical units from ticker_series (sparse — skip flat price-proxy days later via sanity)
        for (const sym of symbols) {
          const ts = data.ticker_series?.[sym];
          if (!ts?.dates?.length) continue;
          for (let i = 0; i < ts.dates.length; i++) {
            const date = ts.dates[i]!;
            const units = ts.units?.[i];
            const nav = ts.nav?.[i];
            const aumMn = ts.aum_mn?.[i];
            if (units == null || !(units > 0) || nav == null || !(nav > 0)) continue;
            const aum =
              aumMn != null && aumMn > 0 ? aumMn * 1_000_000 : units * nav;
            let point = points.find((p) => p.date === date);
            if (!point) {
              point = { date, symbols: {} };
              points.push(point);
            }
            point.symbols[sym] = { aum_usd: aum, nav, units };
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Public API fallback (no R2 in some agent/dev envs)
  if (!points.length) {
    try {
      const res = await fetch("https://savvyetf.vercel.app/api/etf-db-us", {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          as_of?: string;
          rows?: Array<{
            symbol?: string;
            units?: number | null;
            nav?: number | null;
            aum_mn?: number | null;
          }>;
          ticker_series?: Record<
            string,
            {
              dates?: string[];
              units?: Array<number | null>;
              nav?: Array<number | null>;
              aum_mn?: Array<number | null>;
            }
          >;
        };
        for (const sym of symbols) {
          const ts = data.ticker_series?.[sym];
          if (!ts?.dates?.length) continue;
          // Keep only last ~40 sessions to bound size
          const start = Math.max(0, ts.dates.length - 40);
          for (let i = start; i < ts.dates.length; i++) {
            const date = ts.dates[i]!;
            const units = ts.units?.[i];
            const nav = ts.nav?.[i];
            const aumMn = ts.aum_mn?.[i];
            if (units == null || !(units > 0) || nav == null || !(nav > 0)) continue;
            const aum =
              aumMn != null && aumMn > 0 ? aumMn * 1_000_000 : units * nav;
            let point = points.find((p) => p.date === date);
            if (!point) {
              point = { date, symbols: {} };
              points.push(point);
            }
            point.symbols[sym] = { aum_usd: aum, nav, units };
          }
        }
        // Non-equity basket names absent from US equity DB — leave for live Yahoo only
        void data.rows;
        void data.as_of;
      }
    } catch {
      /* ignore */
    }
  }

  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

function findLookback(
  points: HistPoint[],
  targetDate: string,
): HistPoint | null {
  const eligible = points
    .filter((p) => p.date <= targetDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  return eligible.at(-1) || null;
}

function impliedFlowUsd(
  now: { aum_usd: number; nav: number; units: number },
  then: { aum_usd: number; nav: number; units: number },
): number | null {
  if (!(now.nav > 0 && then.nav > 0)) return null;
  // Prefer units path when both look consistent
  const viaUnits = computeFlowMn(now.nav, now.units, then.units);
  if (viaUnits != null) return viaUnits * 1_000_000;
  // Fallback: AUM_t − AUM_{t−n}×(NAV_t/NAV_{t−n})
  return now.aum_usd - then.aum_usd * (now.nav / then.nav);
}

function saneFlow(flow: number, aum: number, period: MoneyFlowPeriod): boolean {
  if (!(aum > 0)) return false;
  const absRatio = Math.abs(flow) / aum;
  // Soft caps — larger windows allow larger cumulative moves
  const cap = period === "1w" ? 0.12 : period === "1m" ? 0.25 : 0.45;
  return absRatio <= cap;
}

export async function buildBasketFlows(
  period: MoneyFlowPeriod,
): Promise<Record<AssetId, BasketFlowResult>> {
  const allSymbols = [
    ...new Set(Object.values(ETF_BASKETS).flatMap((b) => b.symbols)),
  ];
  const today = new Date().toISOString().slice(0, 10);
  const lookbackTarget = new Date(Date.now() - periodDays(period) * 86400_000)
    .toISOString()
    .slice(0, 10);

  const [live, hist0, seeds] = await Promise.all([
    fetchYahooFundStats(allSymbols),
    loadBasketHistory(),
    seedFromEtfDbUs(new Set(allSymbols)),
  ]);

  let hist = [...hist0];
  for (const seed of seeds) {
    const existing = hist.find((p) => p.date === seed.date);
    if (!existing) {
      hist.push(seed);
    } else {
      existing.symbols = { ...seed.symbols, ...existing.symbols };
    }
  }
  hist.sort((a, b) => a.date.localeCompare(b.date));

  // Upsert today's live point
  const todaySymbols: HistPoint["symbols"] = {};
  for (const [sym, s] of live) {
    if (s.aum_usd != null && s.nav != null && s.units != null && s.nav > 0) {
      todaySymbols[sym] = {
        aum_usd: s.aum_usd,
        nav: s.nav,
        units: s.units,
      };
    }
  }
  if (Object.keys(todaySymbols).length) {
    const idx = hist.findIndex((p) => p.date === today);
    const point: HistPoint = { date: today, symbols: todaySymbols };
    if (idx >= 0) hist[idx] = point;
    else hist.push(point);
    hist.sort((a, b) => a.date.localeCompare(b.date));
    void persistBasketHistory(hist);
  }

  const lookback = findLookback(
    hist.filter((p) => p.date < today),
    lookbackTarget,
  );

  const out = {} as Record<AssetId, BasketFlowResult>;
  for (const [assetId, basket] of Object.entries(ETF_BASKETS) as Array<
    [AssetId, (typeof ETF_BASKETS)[AssetId]]
  >) {
    const used: string[] = [];
    let aumSum = 0;
    let flowSum = 0;
    let flowN = 0;
    let asOf: string | null = today;
    const lookDate = lookback?.date ?? null;

    for (const sym of basket.symbols) {
      const now = live.get(sym);
      if (!now?.aum_usd || !now.nav || !now.units) continue;
      used.push(sym);
      aumSum += now.aum_usd;
      const then = lookback?.symbols[sym];
      if (then) {
        const f = impliedFlowUsd(
          { aum_usd: now.aum_usd, nav: now.nav, units: now.units },
          then,
        );
        if (f != null && saneFlow(f, now.aum_usd, period)) {
          flowSum += f;
          flowN += 1;
        }
      }
    }

    if (!used.length) {
      out[assetId] = {
        flow_usd: null,
        aum_usd: null,
        flow_aum_pct: null,
        symbols_used: [],
        as_of: null,
        lookback_date: null,
        method: "Yahoo fund stats missing",
        estimated: true,
        error: "Data unavailable",
      };
      continue;
    }

    const flow_usd = flowN > 0 ? flowSum : null;
    const flow_aum_pct =
      flow_usd != null && aumSum > 0 ? (100 * flow_usd) / aumSum : null;

    out[assetId] = {
      flow_usd,
      aum_usd: aumSum,
      flow_aum_pct,
      symbols_used: used,
      as_of: asOf,
      lookback_date: lookDate,
      estimated: true,
      method:
        flow_usd != null
          ? `추정(ETF units) ${basket.label}: AUM_t − AUM_lookback×(NAV_t/NAV_lb) · lookback ${lookDate} · ${basket.note}`
          : `AUM only (${basket.label}) — prior units snapshot missing for ${period}; cron will fill Flow · ${basket.note}`,
      error:
        flow_usd == null
          ? "Flow lookback snapshot not yet available"
          : undefined,
    };
  }

  return out;
}

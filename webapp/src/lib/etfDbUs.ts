/**
 * US-listed ETF DB — curated classified universe + Yahoo metrics + NAV×Δshares flow.
 * Mirrors Korean ETF DB dimensions (type / region / sector / theme).
 */

import { reconstructUsHistories } from "@/lib/etfDbUsHistory";
import { uniqueUsUniverse } from "@/lib/etfDbUsUniverse";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

export type EtfDbUsDimension = "type" | "region" | "sector" | "theme";

export type EtfDbUsMeta = {
  symbol: string;
  name: string;
  type: string;
  region: string;
  sector: string;
  theme: string;
  /** Force-include in priority theme monitoring */
  watch?: boolean;
  /** Universe-build AUM seed ($M) */
  aum_seed_mn?: number;
};

export type EtfDbUsRow = EtfDbUsMeta & {
  price: number | null;
  nav: number | null;
  change_rate: number | null;
  /** AUM in $ millions */
  aum_mn: number;
  units: number | null;
  /** Shares traded (latest session) */
  volume: number | null;
  /** Trading value $M: price × volume / 1e6 */
  turnover_mn: number | null;
  /** Estimated creation/redemption flow in $ millions: NAV × Δshares / 1e6 */
  flow_mn: number | null;
};

export type EtfDbUsAggregate = {
  label: string;
  count: number;
  aum_mn: number;
  aum_share_pct: number;
  /** Sum of member turnover $M (latest day) */
  turnover_mn: number;
  turnover_share_pct: number;
  flow_mn: number | null;
  flow_available: boolean;
};

export type EtfDbUsHistory = {
  dates: string[];
  series: Record<string, Array<number | null>>;
};

export type EtfDbUsTickerSeries = {
  symbol: string;
  name: string;
  dates: string[];
  nav: Array<number | null>;
  units: Array<number | null>;
  aum_mn: Array<number | null>;
  /** Daily close×volume ($M) */
  turnover_daily_mn: Array<number | null>;
  /** Cumulative Σ daily turnover ($M) */
  turnover_cum_mn: Array<number | null>;
  /** Daily NAV×Δunits ($M) */
  flow_daily_mn: Array<number | null>;
  /** Cumulative Σ daily flow ($M) — ETF 수급 계정 */
  flow_cum_mn: Array<number | null>;
};

export type EtfDbUsPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  count: number;
  total_aum_mn: number;
  total_turnover_mn: number;
  prev_as_of: string | null;
  as_of?: string | null;
  equity_only?: boolean;
  aggregates: Record<EtfDbUsDimension, EtfDbUsAggregate[]>;
  aum_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** AUM-weighted NAV index (100 = period start) */
  nav_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** Cumulative 거래대금: Σ (close×volume) in $M */
  turnover_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** Daily 거래대금: close×volume in $M */
  turnover_daily_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** Cumulative ETF 수급 account: Σ (NAV × Δunits) in $M */
  flow_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** Daily ETF 수급: NAV × Δunits in $M */
  flow_daily_history: Record<EtfDbUsDimension, EtfDbUsHistory>;
  /** Per-ticker ~1y series for charts */
  ticker_series: Record<string, EtfDbUsTickerSeries>;
  history_note: string;
  rows: EtfDbUsRow[];
  note: string;
  error?: string;
};

export const ETF_DB_US_LATEST_KEY = "etf_db_us/latest.json";
export const ETF_DB_US_SNAP_PREFIX = "etf_db_us/snapshots/";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

/**
 * Tracked US ETF universe.
 * Themes of interest (watch): precious metals, defense, nuclear, rare earths,
 * oil, tanker/war shipping (BWET), uranium, etc.
 */
export const US_ETF_UNIVERSE: EtfDbUsMeta[] = uniqueUsUniverse();

const EQUITY_TYPES = new Set(["미국 시장지수", "업종/테마", "파생"]);

/** Equity filter: US market / sector-theme / leveraged equity. */
export function isEquityUsEtf(row: Pick<EtfDbUsRow, "type" | "sector">): boolean {
  if (!EQUITY_TYPES.has(row.type)) return false;
  if (row.sector === "채권") return false;
  return true;
}

export function aggregateUsRows(
  rows: EtfDbUsRow[],
  dimension: EtfDbUsDimension,
): EtfDbUsAggregate[] {
  const buckets = new Map<string, EtfDbUsAggregate>();
  for (const row of rows) {
    const key = String(row[dimension] || "기타");
    const bucket = buckets.get(key) || {
      label: key,
      count: 0,
      aum_mn: 0,
      aum_share_pct: 0,
      turnover_mn: 0,
      turnover_share_pct: 0,
      flow_mn: 0,
      flow_available: false,
    };
    bucket.count += 1;
    bucket.aum_mn += row.aum_mn || 0;
    bucket.turnover_mn += row.turnover_mn || 0;
    if (row.flow_mn != null) {
      bucket.flow_mn = (bucket.flow_mn || 0) + row.flow_mn;
      bucket.flow_available = true;
    }
    buckets.set(key, bucket);
  }
  const list = [...buckets.values()];
  const totalAum = list.reduce((s, b) => s + b.aum_mn, 0) || 1;
  const totalTurn = list.reduce((s, b) => s + b.turnover_mn, 0) || 1;
  return list
    .map((b) => ({
      ...b,
      aum_share_pct: (100 * b.aum_mn) / totalAum,
      turnover_share_pct: (100 * b.turnover_mn) / totalTurn,
      flow_mn: b.flow_available ? b.flow_mn : null,
    }))
    .sort((a, b) => b.turnover_mn - a.turnover_mn || b.aum_mn - a.aum_mn);
}

/** Same formula as KR ETF DB: flow = NAV_t × (units_t − units_{t−1}). */
export function computeFlowMn(
  nav: number | null,
  units: number | null,
  prevUnits: number | null | undefined,
): number | null {
  if (nav == null || !(nav > 0) || units == null || prevUnits == null) return null;
  if (!Number.isFinite(units) || !Number.isFinite(prevUnits)) return null;
  return (nav * (units - prevUnits)) / 1_000_000;
}

type YahooQuote = {
  symbol: string;
  price: number | null;
  change_pct: number | null;
  nav: number | null;
  total_assets: number | null;
  shares: number | null;
  volume: number | null;
};

type YahooCookieJar = { cookie: string; crumb: string; expires: number };
let yahooJar: YahooCookieJar | null = null;

async function getYahooCrumb(): Promise<YahooCookieJar> {
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
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.includes("="))
      .join("; ");
  }

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
  });
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
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker()),
  );
  return out;
}

async function fetchOneYahooQuote(symbol: string): Promise<YahooQuote | null> {
  try {
    const jar = await getYahooCrumb();
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
    if (res.status === 401) {
      yahooJar = null;
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as {
      quoteSummary?: {
        result?: Array<{
          price?: Record<string, { raw?: number } | undefined>;
          defaultKeyStatistics?: Record<string, { raw?: number } | undefined>;
          summaryDetail?: Record<string, { raw?: number } | undefined>;
        }>;
      };
    };
    const r = json.quoteSummary?.result?.[0];
    if (!r) return null;
    const price = r.price || {};
    const ks = r.defaultKeyStatistics || {};
    const sd = r.summaryDetail || {};
    const px = num(price.regularMarketPrice?.raw);
    const chgRaw = num(price.regularMarketChangePercent?.raw);
    const nav =
      num(price.navPrice?.raw) ??
      num(sd.navPrice?.raw) ??
      px;
    const total_assets =
      num(ks.totalAssets?.raw) ??
      num(sd.totalAssets?.raw) ??
      num(price.marketCap?.raw);
    const shares =
      num(ks.sharesOutstanding?.raw) ??
      (nav != null && total_assets != null && nav > 0
        ? total_assets / nav
        : null);
    const volume =
      num(price.regularMarketVolume?.raw) ??
      num(sd.volume?.raw) ??
      num(sd.regularMarketVolume?.raw);
    return {
      symbol: symbol.toUpperCase(),
      price: px,
      change_pct: chgRaw != null ? chgRaw * 100 : null,
      nav,
      total_assets,
      shares,
      volume,
    };
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Chart fallback when quoteSummary fails — price/change only. */
async function fetchChartFallback(symbol: string): Promise<YahooQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?range=5d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
          };
        }>;
      };
    };
    const meta = json.chart?.result?.[0]?.meta;
    const px = num(meta?.regularMarketPrice);
    const prev = num(meta?.chartPreviousClose) ?? num(meta?.previousClose);
    const change_pct =
      px != null && prev != null && prev > 0 ? ((px / prev - 1) * 100) : null;
    return {
      symbol: symbol.toUpperCase(),
      price: px,
      change_pct,
      nav: px,
      total_assets: null,
      shares: null,
      volume: null,
    };
  } catch {
    return null;
  }
}

async function fetchYahooQuotes(
  symbols: string[],
  opts?: { preferAumFrom?: Record<string, { aum_mn?: number }> },
): Promise<Map<string, YahooQuote>> {
  const out = new Map<string, YahooQuote>();
  if (!symbols.length) return out;
  const prefer = opts?.preferAumFrom || {};

  // 1) Batch v7 quotes for price / volume (fast).
  try {
    const jar = await getYahooCrumb();
    const chunkSize = 80;
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      const url =
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(","))}` +
        `&fields=symbol,regularMarketPrice,regularMarketChangePercent,regularMarketVolume,sharesOutstanding` +
        `&crumb=${encodeURIComponent(jar.crumb)}`;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": UA,
            Cookie: jar.cookie,
            Accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 401) {
          yahooJar = null;
          break;
        }
        if (!res.ok) continue;
        const json = (await res.json()) as {
          quoteResponse?: {
            result?: Array<{
              symbol?: string;
              regularMarketPrice?: number;
              regularMarketChangePercent?: number;
              regularMarketVolume?: number;
              sharesOutstanding?: number;
            }>;
          };
        };
        for (const r of json.quoteResponse?.result || []) {
          const sym = (r.symbol || "").toUpperCase();
          if (!sym) continue;
          const px = num(r.regularMarketPrice);
          const chg = num(r.regularMarketChangePercent);
          const prevAum = prefer[sym]?.aum_mn;
          out.set(sym, {
            symbol: sym,
            price: px,
            change_pct: chg,
            nav: px,
            total_assets:
              prevAum != null && prevAum > 0 ? prevAum * 1_000_000 : null,
            shares: num(r.sharesOutstanding),
            volume: num(r.regularMarketVolume),
          });
        }
      } catch {
        /* continue chunks */
      }
    }
  } catch {
    /* fall through */
  }

  // 2) Fresh AUM via quoteSummary — prioritize symbols lacking snapshot AUM,
  //    then top names by current price presence (cap to keep latency bounded).
  const missingAum = symbols.filter((s) => {
    const q = out.get(s.toUpperCase());
    return !q || q.total_assets == null || !(q.total_assets > 0);
  });
  const haveAum = symbols.filter((s) => !missingAum.includes(s));
  const refreshCap = 220;
  const refreshList = [
    ...missingAum,
    ...haveAum.slice(0, Math.max(0, refreshCap - missingAum.length)),
  ].slice(0, refreshCap);

  const summaries = await mapPool(refreshList, 16, async (sym) => {
    const q = (await fetchOneYahooQuote(sym)) || (await fetchChartFallback(sym));
    return q;
  });
  for (const q of summaries) {
    if (!q) continue;
    const prev = out.get(q.symbol);
    out.set(q.symbol, {
      symbol: q.symbol,
      price: q.price ?? prev?.price ?? null,
      change_pct: q.change_pct ?? prev?.change_pct ?? null,
      nav: q.nav ?? prev?.nav ?? q.price ?? prev?.price ?? null,
      total_assets: q.total_assets ?? prev?.total_assets ?? null,
      shares: q.shares ?? prev?.shares ?? null,
      volume: q.volume ?? prev?.volume ?? null,
    });
  }

  // 3) Chart fallback for any still missing price.
  const missingPx = symbols.filter((s) => {
    const q = out.get(s.toUpperCase());
    return !q || q.price == null;
  });
  if (missingPx.length) {
    const charts = await mapPool(missingPx.slice(0, 80), 12, (sym) =>
      fetchChartFallback(sym),
    );
    for (const q of charts) {
      if (!q) continue;
      const prev = out.get(q.symbol);
      out.set(q.symbol, {
        ...(prev || {
          symbol: q.symbol,
          price: null,
          change_pct: null,
          nav: null,
          total_assets: null,
          shares: null,
          volume: null,
        }),
        price: q.price ?? prev?.price ?? null,
        change_pct: q.change_pct ?? prev?.change_pct ?? null,
        nav: prev?.nav ?? q.nav ?? q.price,
        volume: prev?.volume ?? q.volume,
      });
    }
  }

  return out;
}

type PrevSnap = {
  as_of: string;
  by_code: Record<string, { units?: number | null; nav?: number | null; aum_mn?: number }>;
};

export async function loadPrevUsSnapshot(): Promise<PrevSnap | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(ETF_DB_US_LATEST_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as {
      as_of?: string;
      rows?: Array<{ symbol?: string; units?: number | null; nav?: number | null; aum_mn?: number }>;
    };
    const by_code: PrevSnap["by_code"] = {};
    for (const r of data.rows || []) {
      if (!r.symbol) continue;
      by_code[r.symbol.toUpperCase()] = {
        units: r.units ?? null,
        nav: r.nav ?? null,
        aum_mn: r.aum_mn,
      };
    }
    return { as_of: data.as_of || "", by_code };
  } catch {
    return null;
  }
}

export async function persistUsSnapshot(payload: EtfDbUsPayload): Promise<void> {
  if (!r2Configured() || !payload.ok) return;
  const asOf = payload.as_of || new Date().toISOString().slice(0, 10);
  const body = JSON.stringify({
    as_of: asOf,
    generated_at: payload.generated_at,
    rows: payload.rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      type: r.type,
      region: r.region,
      sector: r.sector,
      theme: r.theme,
      nav: r.nav,
      units: r.units,
      aum_mn: r.aum_mn,
      volume: r.volume,
      turnover_mn: r.turnover_mn,
      flow_mn: r.flow_mn,
      price: r.price,
      change_rate: r.change_rate,
    })),
    aggregates: payload.aggregates,
    aum_history: payload.aum_history,
    nav_history: payload.nav_history,
    turnover_history: payload.turnover_history,
    turnover_daily_history: payload.turnover_daily_history,
    flow_history: payload.flow_history,
    flow_daily_history: payload.flow_daily_history,
    ticker_series: payload.ticker_series,
    history_note: payload.history_note,
  });
  const buf = Buffer.from(body, "utf8");
  try {
    await r2PutObject(
      ETF_DB_US_LATEST_KEY,
      buf,
      "application/json; charset=utf-8",
      "public, max-age=300",
    );
    await r2PutObject(
      `${ETF_DB_US_SNAP_PREFIX}${asOf}.json`,
      buf,
      "application/json; charset=utf-8",
      "public, max-age=86400",
    );
  } catch {
    /* ignore persist errors */
  }
}

function emptyHist(): EtfDbUsHistory {
  return { dates: [], series: {} };
}

function mergeLiveAumHistory(
  prev: EtfDbUsHistory | undefined,
  liveAggs: EtfDbUsAggregate[],
  day: string,
): EtfDbUsHistory {
  const dates = [...(prev?.dates || [])];
  const series: Record<string, Array<number | null>> = {};
  for (const [k, vals] of Object.entries(prev?.series || {})) {
    series[k] = [...vals];
  }
  const liveTotal = liveAggs.reduce((s, a) => s + a.aum_mn, 0);
  if (!series["전체"]) series["전체"] = dates.map(() => null);

  if (dates.length && dates[dates.length - 1] === day) {
    series["전체"][dates.length - 1] = liveTotal;
    for (const a of liveAggs) {
      if (!series[a.label]) series[a.label] = dates.map(() => null);
      series[a.label]![dates.length - 1] = a.aum_mn;
    }
  } else {
    dates.push(day);
    for (const key of Object.keys(series)) {
      series[key]!.push(null);
    }
    if (!series["전체"]) series["전체"] = dates.map(() => null);
    series["전체"][dates.length - 1] = liveTotal;
    for (const a of liveAggs) {
      if (!series[a.label]) series[a.label] = Array.from({ length: dates.length - 1 }, () => null);
      while (series[a.label]!.length < dates.length) series[a.label]!.push(null);
      series[a.label]![dates.length - 1] = a.aum_mn;
    }
  }

  const ranked = Object.keys(series)
    .filter((k) => k !== "전체")
    .sort((a, b) => {
      const sa = series[a]!.slice(-10).reduce<number>((s, v) => s + (v ?? 0), 0);
      const sb = series[b]!.slice(-10).reduce<number>((s, v) => s + (v ?? 0), 0);
      return sb - sa;
    });
  const liveLabels = liveAggs.map((a) => a.label);
  const keep = Array.from(new Set(["전체", ...ranked.slice(0, 14), ...liveLabels]));
  return {
    dates,
    series: Object.fromEntries(keep.filter((k) => series[k]).map((k) => [k, series[k]!])),
  };
}

export async function buildEtfDbUsPayload(opts?: {
  equityOnly?: boolean;
  watchOnly?: boolean;
}): Promise<EtfDbUsPayload> {
  let metas = [...US_ETF_UNIVERSE];
  if (opts?.watchOnly) metas = metas.filter((m) => m.watch);
  const prev = await loadPrevUsSnapshot();
  const seedAum: Record<string, { aum_mn?: number }> = {};
  for (const m of metas) {
    if (m.aum_seed_mn != null && m.aum_seed_mn > 0) {
      seedAum[m.symbol.toUpperCase()] = { aum_mn: m.aum_seed_mn };
    }
  }
  const preferAum = { ...seedAum, ...(prev?.by_code || {}) };
  const quotes = await fetchYahooQuotes(
    metas.map((m) => m.symbol),
    { preferAumFrom: preferAum },
  );
  const today = new Date().toISOString().slice(0, 10);

  let rows: EtfDbUsRow[] = metas.map((m) => {
    const q = quotes.get(m.symbol.toUpperCase());
    const prevRow = prev?.by_code[m.symbol.toUpperCase()];
    const price = q?.price ?? null;
    const nav = q?.nav ?? price;
    const change = q?.change_pct ?? null;
    const assets = q?.total_assets ?? null;
    let aum_mn = assets != null && assets > 0 ? assets / 1_000_000 : 0;
    // Prefer live AUM; fall back to previous snapshot so ranking stays stable if Yahoo gaps.
    if (!(aum_mn > 0) && prevRow?.aum_mn != null && prevRow.aum_mn > 0) {
      aum_mn = prevRow.aum_mn;
    }
    let units = q?.shares ?? null;
    if ((units == null || !(units > 0)) && nav != null && nav > 0 && aum_mn > 0) {
      units = (aum_mn * 1_000_000) / nav;
    }
    if ((units == null || !(units > 0)) && prevRow?.units != null && prevRow.units > 0) {
      units = prevRow.units;
    }
    const volume = q?.volume ?? null;
    const turnover_mn =
      price != null && price > 0 && volume != null && volume > 0
        ? (price * volume) / 1_000_000
        : null;
    const prevUnits = prevRow?.units;
    // Same calendar day → don't treat as a new flow day
    const flow_mn =
      prev?.as_of && prev.as_of !== today
        ? computeFlowMn(nav, units, prevUnits)
        : null;

    return {
      ...m,
      price,
      nav,
      change_rate: change,
      aum_mn,
      units,
      volume,
      turnover_mn,
      flow_mn,
    };
  });

  // Live AUM rank — keep top 1000 equity names (universe is already ~1000).
  rows.sort(
    (a, b) =>
      (b.aum_mn || 0) - (a.aum_mn || 0) ||
      (b.turnover_mn || 0) - (a.turnover_mn || 0),
  );
  if (opts?.equityOnly) rows = rows.filter(isEquityUsEtf);
  if (rows.length > 1000) rows = rows.slice(0, 1000);

  // Prefer turnover sort for table default after AUM cap.
  rows.sort(
    (a, b) =>
      (b.turnover_mn || 0) - (a.turnover_mn || 0) || (b.aum_mn || 0) - (a.aum_mn || 0),
  );

  const aggregates = {
    type: aggregateUsRows(rows, "type"),
    region: aggregateUsRows(rows, "region"),
    sector: aggregateUsRows(rows, "sector"),
    theme: aggregateUsRows(rows, "theme"),
  };

  const hist = await reconstructUsHistories({
    rows,
    aggregates,
    liveDay: today,
    equityOnly: !!opts?.equityOnly,
    watchOnly: !!opts?.watchOnly,
  });

  // Backfill live turnover from last chart day when quote volume was missing.
  rows = rows.map((r) => {
    if (r.turnover_mn != null && r.turnover_mn > 0) return r;
    const ts = hist.ticker_series[r.symbol];
    const last = ts?.turnover_daily_mn?.at(-1);
    if (last == null || !(last > 0)) return r;
    return { ...r, turnover_mn: last };
  });
  const aggregatesFresh = {
    type: aggregateUsRows(rows, "type"),
    region: aggregateUsRows(rows, "region"),
    sector: aggregateUsRows(rows, "sector"),
    theme: aggregateUsRows(rows, "theme"),
  };

  const now = new Date();
  const display = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const quoted = rows.filter((r) => r.price != null || r.aum_mn > 0).length;
  const histDays = hist.turnover_history.theme?.dates?.length || 0;
  const total_turnover_mn = rows.reduce((s, r) => s + (r.turnover_mn || 0), 0);

  return {
    ok: true,
    generated_at: now.toISOString(),
    generated_at_display: display,
    source: `yahoo · US equity AUM top~1000 · tracked ${metas.length} · quoted ${quoted} · history ${histDays}d`,
    count: rows.length,
    total_aum_mn: rows.reduce((s, r) => s + (r.aum_mn || 0), 0),
    total_turnover_mn,
    prev_as_of: prev?.as_of && prev.as_of !== today ? prev.as_of : null,
    as_of: today,
    equity_only: !!opts?.equityOnly,
    aggregates: aggregatesFresh,
    aum_history: hist.aum_history,
    nav_history: hist.nav_history,
    turnover_history: hist.turnover_history,
    turnover_daily_history: hist.turnover_daily_history,
    flow_history: hist.flow_history,
    flow_daily_history: hist.flow_daily_history,
    ticker_series: hist.ticker_series,
    history_note: hist.method_note,
    rows,
    note:
      "미국 주식형 ETF를 AUM 기준 상위 약 1,000종 모니터링합니다. " +
      "주 지표는 거래대금(종가×거래량, $M). 유형·지역·섹터·테마로 분류합니다. " +
      "ETF 수급(NAV×Δ좌수)은 사이드에 유지(스냅샷 축적 후 유의미).",
  };
}

export function fmtUsdMn(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1000) {
    return `$${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  }
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
}

export function fmtSignedUsdMn(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtUsdMn(n)}`;
}

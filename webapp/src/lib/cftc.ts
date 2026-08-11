/**
 * CFTC Commitments of Traders enrichment (free public sources only).
 *
 * - Legacy Futures Only (6dca-aqww): Non-Commercial net
 * - Disaggregated Futures Only (72hh-3qpy): Managed Money net (= 투기 자금에 더 가깝)
 * - Yahoo chart: futures/ETF proxies for price overlay + ratios
 *
 * No API key required for CFTC SODA (anonymous public) or Yahoo chart.
 * Snapshot: R2 daily 09:00 KST via /api/cron/cftc-refresh
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

export const CFTC_R2_LATEST_KEY = "cftc/latest_v2.json";
export const CFTC_SCHEDULE_NOTE =
  "매일 오전 9시(KST) 스냅샷 · CFTC는 화요일 포지션을 금요일 공시(시차) · SODA 공개 API(키 불필요)";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const CFTC_LEGACY_URL =
  "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
const CFTC_DISAGG_URL =
  "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";
const HISTORY_LIMIT = 160;

export type CftcMarketId =
  | "gold"
  | "silver"
  | "wti"
  | "brent"
  | "natgas"
  | "copper"
  | "platinum"
  | "corn"
  | "soybeans"
  | "wheat";

export type CftcMarketSpec = {
  id: CftcMarketId;
  label: string;
  group: "금속" | "에너지" | "농산물";
  market_name: string;
  /** Yahoo symbol for price overlay */
  yahoo: string;
  watch?: boolean;
};

export const CFTC_MARKET_SPECS: CftcMarketSpec[] = [
  {
    id: "gold",
    label: "금 (Gold)",
    group: "금속",
    market_name: "GOLD - COMMODITY EXCHANGE INC.",
    yahoo: "GC=F",
    watch: true,
  },
  {
    id: "silver",
    label: "은 (Silver)",
    group: "금속",
    market_name: "SILVER - COMMODITY EXCHANGE INC.",
    yahoo: "SI=F",
    watch: true,
  },
  {
    id: "copper",
    label: "구리 (Copper)",
    group: "금속",
    market_name: "COPPER- #1 - COMMODITY EXCHANGE INC.",
    yahoo: "HG=F",
  },
  {
    id: "platinum",
    label: "백금 (Platinum)",
    group: "금속",
    market_name: "PLATINUM - NEW YORK MERCANTILE EXCHANGE",
    yahoo: "PL=F",
  },
  {
    id: "wti",
    label: "원유 WTI",
    group: "에너지",
    market_name: "WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE",
    yahoo: "CL=F",
    watch: true,
  },
  {
    id: "brent",
    label: "원유 Brent",
    group: "에너지",
    market_name: "BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE",
    yahoo: "BZ=F",
    watch: true,
  },
  {
    id: "natgas",
    label: "천연가스 (Henry Hub)",
    group: "에너지",
    market_name: "HENRY HUB - NEW YORK MERCANTILE EXCHANGE",
    yahoo: "NG=F",
  },
  {
    id: "corn",
    label: "옥수수",
    group: "농산물",
    market_name: "CORN - CHICAGO BOARD OF TRADE",
    yahoo: "ZC=F",
  },
  {
    id: "soybeans",
    label: "대두",
    group: "농산물",
    market_name: "SOYBEANS - CHICAGO BOARD OF TRADE",
    yahoo: "ZS=F",
  },
  {
    id: "wheat",
    label: "소맥 (SRW)",
    group: "농산물",
    market_name: "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    yahoo: "ZW=F",
  },
];

export type CftcPoint = {
  date: string;
  /** Legacy Non-Commercial */
  long_nc: number;
  short_nc: number;
  net_noncomm: number;
  /** Disaggregated Managed Money */
  long_mm: number | null;
  short_mm: number | null;
  net_mm: number | null;
  open_interest: number;
  /** net_mm / OI × 100 (fallback net_noncomm) */
  net_pct_oi: number | null;
  net_chg: number | null;
  /** 0–100 historical percentile of primary net (MM preferred) */
  percentile: number | null;
  /** Yahoo close aligned to report week (nearest prior/equal) */
  price: number | null;
};

export type CftcMarketSeries = {
  id: CftcMarketId;
  label: string;
  group: CftcMarketSpec["group"];
  market_name: string;
  yahoo: string;
  watch: boolean;
  latest: CftcPoint | null;
  series: CftcPoint[];
  /** Extreme flag from percentile */
  extreme: "과열" | "과매도" | null;
};

export type CftcSpreadSeries = {
  id: string;
  label: string;
  unit: string;
  latest: number | null;
  as_of: string | null;
  series: Array<{ date: string; value: number | null }>;
};

export type CftcPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  as_of: string | null;
  source: string;
  schedule_note: string;
  note: string;
  from_cache: boolean;
  markets: CftcMarketSeries[];
  spreads: CftcSpreadSeries[];
  vix: { price: number | null; as_of: string | null } | null;
  next_cot_friday: string | null;
  error?: string;
};

type LegacyRow = {
  market_and_exchange_names?: string;
  report_date_as_yyyy_mm_dd?: string;
  noncomm_positions_long_all?: string | number;
  noncomm_positions_short_all?: string | number;
  open_interest_all?: string | number;
};

type DisaggRow = {
  report_date_as_yyyy_mm_dd?: string;
  m_money_positions_long_all?: string | number;
  m_money_positions_short_all?: string | number;
  open_interest_all?: string | number;
};

function kstNowParts(): { ymd: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

function displayNow(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Historical percentile of last value in `vals` (0–100). */
function percentileOfLatest(vals: Array<number | null>): number | null {
  const clean = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (clean.length < 8) return null;
  const latest = clean[clean.length - 1]!;
  const below = clean.filter((v) => v <= latest).length;
  return Math.round((100 * (below - 1)) / (clean.length - 1));
}

function extremeFromPct(p: number | null): "과열" | "과매도" | null {
  if (p == null) return null;
  if (p >= 90) return "과열";
  if (p <= 10) return "과매도";
  return null;
}

/** Next Friday (UTC date string) — typical COT release day. */
function nextCotFridayYmd(): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0 Sun … 5 Fri
  const add = day <= 5 ? 5 - day : 6; // if Sat→next Fri = 6
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add));
  return out.toISOString().slice(0, 10);
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

async function fetchYahooCloses(
  symbol: string,
  lookbackDays = 800,
): Promise<Map<string, number>> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - lookbackDays * 86400;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return new Map();
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !(c > 0)) continue;
    out.set(new Date(ts[i]! * 1000).toISOString().slice(0, 10), c);
  }
  return out;
}

/** Align price to COT date: nearest close on or before date. */
function priceOnOrBefore(prices: Map<string, number>, date: string): number | null {
  if (prices.has(date)) return prices.get(date)!;
  const keys = [...prices.keys()].filter((d) => d <= date).sort();
  const hit = keys.at(-1);
  return hit ? prices.get(hit)! : null;
}

async function fetchLegacyRows(marketName: string): Promise<LegacyRow[]> {
  const url =
    `${CFTC_LEGACY_URL}?` +
    new URLSearchParams({
      $where: `market_and_exchange_names='${marketName.replace(/'/g, "''")}'`,
      $order: "report_date_as_yyyy_mm_dd DESC",
      $limit: String(HISTORY_LIMIT),
    }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  return (await res.json()) as LegacyRow[];
}

async function fetchDisaggRows(marketName: string): Promise<DisaggRow[]> {
  const url =
    `${CFTC_DISAGG_URL}?` +
    new URLSearchParams({
      $where: `market_and_exchange_names='${marketName.replace(/'/g, "''")}'`,
      $order: "report_date_as_yyyy_mm_dd DESC",
      $limit: String(HISTORY_LIMIT),
    }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  return (await res.json()) as DisaggRow[];
}

async function fetchMarketSeries(
  spec: CftcMarketSpec,
  prices: Map<string, number>,
): Promise<CftcMarketSeries> {
  const [legacy, disagg] = await Promise.all([
    fetchLegacyRows(spec.market_name),
    fetchDisaggRows(spec.market_name),
  ]);

  const mmByDate = new Map<
    string,
    { long: number; short: number; oi: number | null }
  >();
  for (const row of disagg) {
    const date = (row.report_date_as_yyyy_mm_dd || "").slice(0, 10);
    const long = num(row.m_money_positions_long_all);
    const short = num(row.m_money_positions_short_all);
    if (!date || long == null || short == null) continue;
    mmByDate.set(date, {
      long,
      short,
      oi: num(row.open_interest_all),
    });
  }

  const chronological: CftcPoint[] = [];
  for (const row of [...legacy].reverse()) {
    const date = (row.report_date_as_yyyy_mm_dd || "").slice(0, 10);
    const long_nc = num(row.noncomm_positions_long_all);
    const short_nc = num(row.noncomm_positions_short_all);
    const oiLegacy = num(row.open_interest_all) ?? 0;
    if (!date || long_nc == null || short_nc == null) continue;
    const net_noncomm = long_nc - short_nc;
    const mm = mmByDate.get(date);
    const long_mm = mm?.long ?? null;
    const short_mm = mm?.short ?? null;
    const net_mm =
      long_mm != null && short_mm != null ? long_mm - short_mm : null;
    const oi = mm?.oi && mm.oi > 0 ? mm.oi : oiLegacy;
    const primary = net_mm ?? net_noncomm;
    const net_pct_oi = oi > 0 ? (100 * primary) / oi : null;
    const prev = chronological[chronological.length - 1];
    const prevPrimary = prev ? (prev.net_mm ?? prev.net_noncomm) : null;

    chronological.push({
      date,
      long_nc,
      short_nc,
      net_noncomm,
      long_mm,
      short_mm,
      net_mm,
      open_interest: oi,
      net_pct_oi,
      net_chg: prevPrimary != null ? primary - prevPrimary : null,
      percentile: null,
      price: priceOnOrBefore(prices, date),
    });
  }

  const primarySeries = chronological.map((p) => p.net_mm ?? p.net_noncomm);
  const pctLatest = percentileOfLatest(primarySeries);
  // Attach running percentile for chart (cheap rank vs history up to i)
  for (let i = 0; i < chronological.length; i++) {
    const window = primarySeries.slice(0, i + 1);
    chronological[i]!.percentile =
      i === chronological.length - 1
        ? pctLatest
        : percentileOfLatest(window);
  }

  const latest = chronological.length
    ? chronological[chronological.length - 1]!
    : null;

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    market_name: spec.market_name,
    yahoo: spec.yahoo,
    watch: !!spec.watch,
    latest,
    series: chronological,
    extreme: extremeFromPct(latest?.percentile ?? null),
  };
}

function buildSpread(
  id: string,
  label: string,
  unit: string,
  dates: string[],
  compute: (date: string) => number | null,
): CftcSpreadSeries {
  const series = dates.map((date) => ({ date, value: compute(date) }));
  const last = [...series].reverse().find((p) => p.value != null) || null;
  return {
    id,
    label,
    unit,
    latest: last?.value ?? null,
    as_of: last?.date ?? null,
    series,
  };
}

export async function buildCftcPayload(): Promise<CftcPayload> {
  const yahooSymbols = [
    ...new Set([...CFTC_MARKET_SPECS.map((s) => s.yahoo), "^VIX"]),
  ];
  const priceMaps = await mapPool(yahooSymbols, 6, async (sym) => {
    try {
      return [sym, await fetchYahooCloses(sym)] as const;
    } catch {
      return [sym, new Map<string, number>()] as const;
    }
  });
  const byYahoo = new Map(priceMaps);

  const markets = await mapPool(CFTC_MARKET_SPECS, 4, async (spec) =>
    fetchMarketSeries(spec, byYahoo.get(spec.yahoo) || new Map()),
  );

  const withData = markets.filter((m) => m.series.length > 0);
  const as_of =
    withData
      .map((m) => m.latest?.date || "")
      .filter(Boolean)
      .sort()
      .at(-1) || null;

  const dateSet = new Set<string>();
  for (const m of markets) for (const p of m.series) dateSet.add(p.date);
  const dates = [...dateSet].sort();

  const byId = Object.fromEntries(markets.map((m) => [m.id, m])) as Record<
    CftcMarketId,
    CftcMarketSeries
  >;
  const priceAt = (id: CftcMarketId, date: string) => {
    const hit = byId[id]?.series.find((p) => p.date === date);
    return hit?.price ?? null;
  };

  const spreads: CftcSpreadSeries[] = [
    buildSpread("gold_silver", "Gold / Silver", "배", dates, (d) => {
      const g = priceAt("gold", d);
      const s = priceAt("silver", d);
      return g != null && s != null && s > 0 ? g / s : null;
    }),
    buildSpread("wti_brent", "WTI − Brent", "$", dates, (d) => {
      const w = priceAt("wti", d);
      const b = priceAt("brent", d);
      return w != null && b != null ? w - b : null;
    }),
    buildSpread("copper_gold", "Copper / Gold", "배", dates, (d) => {
      const c = priceAt("copper", d);
      const g = priceAt("gold", d);
      return c != null && g != null && g > 0 ? c / g : null;
    }),
  ];

  const vixMap = byYahoo.get("^VIX") || new Map();
  const vixDates = [...vixMap.keys()].sort();
  const vixLast = vixDates.at(-1) || null;

  return {
    ok: withData.length > 0,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    as_of,
    source: `CFTC Disagg(MM)+Legacy(NC) SODA · Yahoo futures · ${withData.length}/${markets.length}`,
    schedule_note: CFTC_SCHEDULE_NOTE,
    note:
      "주 지표: Managed Money 순매수(Disaggregated). Legacy Non-Commercial도 병기. " +
      "%OI·역사 퍼센타일(≥90 과열 / ≤10 과매도). 가격은 Yahoo 선물. " +
      "스프레드: Gold/Silver, WTI−Brent, Copper/Gold. SODA·Yahoo 모두 공개(키 불필요).",
    from_cache: false,
    markets,
    spreads,
    vix: {
      price: vixLast ? vixMap.get(vixLast)! : null,
      as_of: vixLast,
    },
    next_cot_friday: nextCotFridayYmd(),
    error: withData.length ? undefined : "CFTC 응답 없음",
  };
}

export async function loadCachedCftc(): Promise<CftcPayload | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(CFTC_R2_LATEST_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as CftcPayload;
    if (!data?.ok || !Array.isArray(data.markets)) return null;
    // Reject v1 caches without enrichment fields
    if (!Array.isArray(data.spreads)) return null;
    return { ...data, from_cache: true };
  } catch {
    return null;
  }
}

export async function persistCftcPayload(payload: CftcPayload): Promise<void> {
  if (!r2Configured() || !payload.ok) return;
  try {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    await r2PutObject(
      CFTC_R2_LATEST_KEY,
      body,
      "application/json; charset=utf-8",
      "public, max-age=300",
    );
    const day = payload.as_of || payload.generated_at.slice(0, 10);
    await r2PutObject(
      `cftc/snapshots/${day}.json`,
      body,
      "application/json; charset=utf-8",
      "public, max-age=86400",
    );
  } catch {
    /* ignore */
  }
}

export async function getCftcPayload(opts?: {
  force?: boolean;
}): Promise<CftcPayload> {
  const force = !!opts?.force;
  const { ymd, hour } = kstNowParts();

  if (!force) {
    const cached = await loadCachedCftc();
    if (cached?.ok) {
      const genKst = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(cached.generated_at));
      if (hour < 9 || genKst === ymd) return cached;
    }
  }

  const fresh = await buildCftcPayload();
  if (fresh.ok) await persistCftcPayload(fresh);
  else {
    const cached = await loadCachedCftc();
    if (cached?.ok) {
      return { ...cached, note: `${cached.note} · 라이브 갱신 실패 → 캐시` };
    }
  }
  return fresh;
}

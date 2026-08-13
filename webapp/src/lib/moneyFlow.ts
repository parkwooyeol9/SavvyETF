/**
 * Global Money Flow Monitor — free/public connectors only.
 *
 * Storage (MVP): R2 `money_flow/latest.json` (same pattern as CFTC).
 * Logical Supabase schema: see `webapp/supabase/money_flow.sql`.
 *
 * Metric families (NEVER sum across families):
 * - Flow: ETF/fund net inflows, stablecoin net issuance
 * - Position: futures OI, CFTC managed-money net
 * - Activity: notional traded volume
 * - Liquidity: MMF AUM, stablecoin supply stock
 */

import { getCftcPayload, type CftcMarketId } from "@/lib/cftc";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import { withServerCache } from "@/lib/apiCache";
import { buildBasketFlows, ETF_BASKETS } from "@/lib/moneyFlowEtf";

export const MONEY_FLOW_R2_KEY = "money_flow/latest.json";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export type MoneyFlowPeriod = "1w" | "1m" | "3m";

export type MetricKind = "flow" | "position" | "activity" | "liquidity" | "price";

export type AssetId =
  | "us_equity"
  | "global_equity"
  | "treasury"
  | "credit"
  | "gold"
  | "oil"
  | "dollar_cash"
  | "btc"
  | "eth_alts";

export type MetricCell = {
  kind: MetricKind;
  value: number | null;
  unit: string;
  label: string;
  zscore_1m: number | null;
  percentile_1m: number | null;
  source: string;
  method: string;
  as_of: string | null;
  unavailable_reason?: string;
  /** True when value is estimated (e.g. NAV×Δunits), not issuer/ICI official */
  estimated?: boolean;
};

export type AssetRow = {
  id: AssetId;
  label_ko: string;
  label_en: string;
  etf_flow: MetricCell;
  flow_aum: MetricCell;
  oi_change: MetricCell;
  cftc: MetricCell;
  volume_change: MetricCell;
  price_return: MetricCell;
  status: "risk_on" | "risk_off" | "mixed" | "unavailable";
  status_ko: string;
  notes: string[];
};

export type MoneyFlowPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  as_of_kst: string;
  period: MoneyFlowPeriod;
  note: string;
  risk_summary: {
    regime: "risk_on" | "risk_off" | "mixed" | "unavailable";
    regime_ko: string;
    drivers: string[];
  };
  top_inflow: { asset: string; kind: MetricKind; value_label: string } | null;
  top_outflow: { asset: string; kind: MetricKind; value_label: string } | null;
  rows: AssetRow[];
  charts: {
    flow_bars: Array<{ asset: string; value: number | null; kind: MetricKind; inferred?: boolean }>;
    family_compare: Array<{
      asset: string;
      flow_z: number | null;
      position_z: number | null;
      activity_z: number | null;
    }>;
    crypto_derivatives: {
      btc_oi_usd: number | null;
      eth_oi_usd: number | null;
      btc_funding: number | null;
      eth_funding: number | null;
      source: string;
      as_of: string | null;
    };
    cftc_changes: Array<{
      market: string;
      mm_net: number | null;
      mm_net_chg: number | null;
      as_of: string | null;
    }>;
  };
  inferences: Array<{ text: string; confidence: "inferred"; basis: string }>;
  sources: Array<{ name: string; url: string; used_for: string }>;
  errors: string[];
  from_cache?: boolean;
  error?: string;
};

type YahooPoint = { date: string; close: number; volume: number };

const ASSET_SPECS: Array<{
  id: AssetId;
  label_ko: string;
  label_en: string;
  yahoo: string;
  /** Optional second symbol for volume (ETF) when yahoo is futures */
  volume_yahoo?: string;
  cftc_id?: CftcMarketId;
}> = [
  {
    id: "us_equity",
    label_ko: "미국 주식",
    label_en: "US Equity",
    yahoo: "SPY",
    cftc_id: "es_mini",
  },
  {
    id: "global_equity",
    label_ko: "글로벌 주식",
    label_en: "Global Equity",
    yahoo: "VT",
    volume_yahoo: "VXUS",
    cftc_id: "msci_eafe",
  },
  {
    id: "treasury",
    label_ko: "국채",
    label_en: "Treasuries",
    yahoo: "TLT",
    cftc_id: "ust_10y",
  },
  { id: "credit", label_ko: "회사채", label_en: "Credit", yahoo: "LQD" },
  {
    id: "gold",
    label_ko: "금",
    label_en: "Gold",
    yahoo: "GC=F",
    volume_yahoo: "GLD",
    cftc_id: "gold",
  },
  {
    id: "oil",
    label_ko: "원유",
    label_en: "Crude Oil",
    yahoo: "CL=F",
    volume_yahoo: "USO",
    cftc_id: "wti",
  },
  {
    id: "dollar_cash",
    label_ko: "달러·현금",
    label_en: "USD / Cash",
    yahoo: "BIL",
    cftc_id: "usd_index",
  },
  { id: "btc", label_ko: "BTC", label_en: "Bitcoin", yahoo: "BTC-USD", volume_yahoo: "IBIT" },
  {
    id: "eth_alts",
    label_ko: "ETH·알트코인",
    label_en: "ETH / Alts",
    yahoo: "ETH-USD",
    volume_yahoo: "ETHA",
  },
];

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

function kstDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function periodDays(p: MoneyFlowPeriod): number {
  if (p === "1w") return 7;
  if (p === "3m") return 91;
  return 30;
}

async function fetchJson<T>(url: string, timeout = 18_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchYahooDaily(symbol: string, days = 140): Promise<YahooPoint[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - (days + 10) * 86400;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const json = await fetchJson<{
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  }>(url);
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const vols = result?.indicators?.quote?.[0]?.volume || [];
  const out: YahooPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    const v = vols[i];
    if (c == null || !(c > 0)) continue;
    out.push({
      date: new Date((ts[i] as number) * 1000).toISOString().slice(0, 10),
      close: c,
      volume: v != null && v > 0 ? v : 0,
    });
  }
  return out;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number | null {
  if (xs.length < 3) return null;
  const m = mean(xs);
  if (m == null) return null;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function zscore(series: number[], last: number): number | null {
  const m = mean(series);
  const s = stdev(series);
  if (m == null || s == null || !(s > 0)) return null;
  return (last - m) / s;
}

function percentileRank(series: number[], last: number): number | null {
  if (!series.length) return null;
  const below = series.filter((x) => x <= last).length;
  return (100 * below) / series.length;
}

function unavailable(
  kind: MetricKind,
  label: string,
  reason: string,
  source = "—",
): MetricCell {
  return {
    kind,
    value: null,
    unit: "",
    label,
    zscore_1m: null,
    percentile_1m: null,
    source,
    method: reason,
    as_of: null,
    unavailable_reason: reason,
  };
}

function periodReturn(points: YahooPoint[], days: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const cutoff = Date.parse(last.date) - days * 86400_000;
  let base = points[0]!;
  for (const p of points) {
    if (Date.parse(p.date) <= cutoff) base = p;
  }
  if (!(base.close > 0)) return null;
  return (100 * (last.close - base.close)) / base.close;
}

function dollarVolumeSeries(points: YahooPoint[]): number[] {
  return points.filter((p) => p.volume > 0).map((p) => p.close * p.volume);
}

function volumeRatioVs20d(points: YahooPoint[], windowDays: number): {
  ratio: number | null;
  lastUsd: number | null;
  as_of: string | null;
  hist: number[];
} {
  const dvs = dollarVolumeSeries(points);
  if (dvs.length < 25) {
    return { ratio: null, lastUsd: null, as_of: null, hist: [] };
  }
  const lastUsd = dvs[dvs.length - 1]!;
  const avg20 = mean(dvs.slice(-21, -1));
  const ratio = avg20 && avg20 > 0 ? lastUsd / avg20 : null;
  // rolling ratios for z-score
  const hist: number[] = [];
  for (let i = 21; i < dvs.length; i++) {
    const a = mean(dvs.slice(i - 20, i));
    if (a && a > 0) hist.push(dvs[i]! / a);
  }
  return {
    ratio,
    lastUsd,
    as_of: points[points.length - 1]?.date ?? null,
    hist: hist.slice(-windowDays),
  };
}

/** FRED MMF total assets (liquidity stock). API key optional — CSV fallback. */
async function fetchFredSeriesCsv(
  seriesId: string,
  lookbackDays = 800,
): Promise<Array<{ date: string; value: number }>> {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);
  const url =
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}` +
    `&cosd=${start.toISOString().slice(0, 10)}&coed=${end.toISOString().slice(0, 10)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/csv" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    const out: Array<{ date: string; value: number }> = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      const comma = line.indexOf(",");
      if (comma < 0) continue;
      const date = line.slice(0, comma).trim();
      const raw = line.slice(comma + 1).trim();
      if (!date || raw === "." || raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      out.push({ date, value });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchFredMmf(): Promise<{
  value: number | null;
  chg_pct: number | null;
  as_of: string | null;
  hist: number[];
  source: string;
  error?: string;
}> {
  const key = process.env.FRED_API_KEY?.trim();
  // Money Market Funds; Total Financial Assets (USD millions)
  const seriesId = "MMMFFAQ027S";

  if (key) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}` +
      `&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=24`;
    const json = await fetchJson<{
      observations?: Array<{ date: string; value: string }>;
    }>(url);
    const rows = (json?.observations || [])
      .map((o) => ({ date: o.date, value: Number(o.value) }))
      .filter((o) => Number.isFinite(o.value));
    if (rows.length) {
      const latest = rows[0]!;
      const prev = rows[1];
      const chg =
        prev && prev.value > 0
          ? (100 * (latest.value - prev.value)) / prev.value
          : null;
      return {
        value: latest.value * 1_000_000,
        chg_pct: chg,
        as_of: latest.date,
        hist: rows.map((r) => r.value).reverse(),
        source: `FRED API ${seriesId}`,
      };
    }
  }

  const csv = await fetchFredSeriesCsv(seriesId, 1200);
  if (!csv.length) {
    return {
      value: null,
      chg_pct: null,
      as_of: null,
      hist: [],
      source: "FRED",
      error: key ? "FRED empty" : "FRED CSV empty (no API key fallback)",
    };
  }
  const latest = csv[csv.length - 1]!;
  const prev = csv.length > 1 ? csv[csv.length - 2]! : null;
  const chg =
    prev && prev.value > 0
      ? (100 * (latest.value - prev.value)) / prev.value
      : null;
  return {
    value: latest.value * 1_000_000,
    chg_pct: chg,
    as_of: latest.date,
    hist: csv.map((r) => r.value),
    source: `FRED CSV ${seriesId}`,
  };
}

/** DefiLlama stablecoin supply — Flow ≈ Δ supply (net issuance proxy). */
async function fetchStablecoinSupply(): Promise<{
  total_usd: number | null;
  chg_7d_pct: number | null;
  as_of: string | null;
  error?: string;
}> {
  const json = await fetchJson<{
    totalPeggedUSD?: number;
    peggedAssets?: Array<{
      circulating?: { peggedUSD?: number };
      circulatingPrevWeek?: { peggedUSD?: number };
    }>;
  }>("https://stablecoins.llama.fi/stablecoins?includePrices=true");
  if (!json) {
    return { total_usd: null, chg_7d_pct: null, as_of: null, error: "DefiLlama unavailable" };
  }
  let total = json.totalPeggedUSD ?? null;
  let prevWeek = 0;
  let cur = 0;
  for (const a of json.peggedAssets || []) {
    cur += a.circulating?.peggedUSD || 0;
    prevWeek += a.circulatingPrevWeek?.peggedUSD || 0;
  }
  if (total == null && cur > 0) total = cur;
  const chg =
    prevWeek > 0 && cur > 0 ? (100 * (cur - prevWeek)) / prevWeek : null;
  return {
    total_usd: total,
    chg_7d_pct: chg,
    as_of: kstDate(),
  };
}

async function fetchOkxSwapMetrics(instId: string): Promise<{
  oi_usd: number | null;
  funding_pct: number | null;
  as_of: string | null;
}> {
  const [oiJson, fundJson] = await Promise.all([
    fetchJson<{ data?: Array<{ oiUsd?: string; ts?: string }> }>(
      `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`,
    ),
    fetchJson<{
      data?: Array<{ fundingRate?: string; fundingTime?: string }>;
    }>(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`),
  ]);
  const oiUsd = Number(oiJson?.data?.[0]?.oiUsd);
  const fr = Number(fundJson?.data?.[0]?.fundingRate);
  const ts =
    fundJson?.data?.[0]?.fundingTime || oiJson?.data?.[0]?.ts || null;
  return {
    oi_usd: Number.isFinite(oiUsd) && oiUsd > 0 ? oiUsd : null,
    funding_pct: Number.isFinite(fr) ? fr * 100 : null,
    as_of: ts ? new Date(Number(ts)).toISOString() : null,
  };
}

/** Crypto OI / funding — OKX first (Vercel-friendly), then Binance, then CoinGecko. */
async function fetchCryptoDerivatives(): Promise<{
  btc_oi_usd: number | null;
  eth_oi_usd: number | null;
  btc_funding: number | null;
  eth_funding: number | null;
  source: string;
  as_of: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  let btc_oi_usd: number | null = null;
  let eth_oi_usd: number | null = null;
  let btc_funding: number | null = null;
  let eth_funding: number | null = null;
  let source = "—";
  let as_of: string | null = null;

  // 1) OKX SWAP (same pattern as cryptoAssets.ts — reliable from cloud egress)
  try {
    const [btc, eth] = await Promise.all([
      fetchOkxSwapMetrics("BTC-USDT-SWAP"),
      fetchOkxSwapMetrics("ETH-USDT-SWAP"),
    ]);
    btc_oi_usd = btc.oi_usd;
    eth_oi_usd = eth.oi_usd;
    btc_funding = btc.funding_pct;
    eth_funding = eth.funding_pct;
    as_of = btc.as_of || eth.as_of;
    if (btc_oi_usd != null || eth_oi_usd != null || btc_funding != null) {
      source = "OKX SWAP (public)";
      return { btc_oi_usd, eth_oi_usd, btc_funding, eth_funding, source, as_of, errors };
    }
    errors.push("OKX OI/funding empty");
  } catch (e) {
    errors.push(`OKX: ${e instanceof Error ? e.message : "failed"}`);
  }

  // 2) Binance Futures (often HTTP 451 from Vercel)
  const [btcOi, ethOi, btcFund, ethFund] = await Promise.all([
    fetchJson<{ openInterest?: string }>(
      "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT",
    ),
    fetchJson<{ openInterest?: string }>(
      "https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT",
    ),
    fetchJson<Array<{ fundingRate?: string; fundingTime?: number }>>(
      "https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1",
    ),
    fetchJson<Array<{ fundingRate?: string; fundingTime?: number }>>(
      "https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=1",
    ),
  ]);

  const btcPx = await fetchYahooDaily("BTC-USD", 5);
  const ethPx = await fetchYahooDaily("ETH-USD", 5);
  const btcPrice = btcPx[btcPx.length - 1]?.close ?? null;
  const ethPrice = ethPx[ethPx.length - 1]?.close ?? null;

  if (btcOi?.openInterest && btcPrice) {
    btc_oi_usd = Number(btcOi.openInterest) * btcPrice;
  }
  if (ethOi?.openInterest && ethPrice) {
    eth_oi_usd = Number(ethOi.openInterest) * ethPrice;
  }
  if (Array.isArray(btcFund) && btcFund[0]?.fundingRate) {
    btc_funding = Number(btcFund[0].fundingRate) * 100;
    if (btcFund[0].fundingTime) {
      as_of = new Date(btcFund[0].fundingTime).toISOString();
    }
  }
  if (Array.isArray(ethFund) && ethFund[0]?.fundingRate) {
    eth_funding = Number(ethFund[0].fundingRate) * 100;
  }

  if (btc_oi_usd != null || eth_oi_usd != null) {
    source = "Binance Futures";
    return { btc_oi_usd, eth_oi_usd, btc_funding, eth_funding, source, as_of, errors };
  }
  errors.push("Binance OI geo-blocked or failed");

  // 3) CoinGecko exchange-level derivatives (avoid full ticker dump)
  const cgEx = await fetchJson<
    Array<{
      name?: string;
      open_interest_btc?: number;
      trade_volume_24h_btc?: number;
    }>
  >("https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=5&order=open_interest_btc_desc");

  if (Array.isArray(cgEx) && cgEx.length && btcPrice) {
    const oiBtc = cgEx.reduce(
      (s, e) => s + (Number(e.open_interest_btc) || 0),
      0,
    );
    if (oiBtc > 0) {
      btc_oi_usd = oiBtc * btcPrice;
      source = "CoinGecko Derivatives Exchanges (BTC OI aggregate)";
      as_of = new Date().toISOString();
      // ETH not split in this endpoint — leave null (honest)
      eth_oi_usd = null;
      eth_funding = null;
      btc_funding = null;
      errors.push("CoinGecko exchange OI is BTC-denominated aggregate; ETH OI unavailable");
    }
  } else {
    errors.push("CoinGecko derivatives exchanges unavailable");
  }

  return { btc_oi_usd, eth_oi_usd, btc_funding, eth_funding, source, as_of, errors };
}

function statusFromSignals(input: {
  price: number | null;
  activityZ: number | null;
  flowZ: number | null;
}): AssetRow["status"] {
  let score = 0;
  let n = 0;
  if (input.price != null) {
    score += input.price > 1 ? 1 : input.price < -1 ? -1 : 0;
    n += 1;
  }
  if (input.activityZ != null) {
    score += input.activityZ > 0.5 ? 1 : input.activityZ < -0.5 ? -1 : 0;
    n += 1;
  }
  if (input.flowZ != null) {
    score += input.flowZ > 0.5 ? 1 : input.flowZ < -0.5 ? -1 : 0;
    n += 1;
  }
  if (!n) return "unavailable";
  if (score >= 1) return "risk_on";
  if (score <= -1) return "risk_off";
  return "mixed";
}

function statusKo(s: AssetRow["status"]): string {
  if (s === "risk_on") return "Risk-on";
  if (s === "risk_off") return "Risk-off";
  if (s === "mixed") return "Mixed";
  return "Data unavailable";
}

export async function buildMoneyFlowPayload(
  period: MoneyFlowPeriod = "1m",
): Promise<MoneyFlowPayload> {
  const errors: string[] = [];
  const days = periodDays(period);
  const sources: MoneyFlowPayload["sources"] = [
    {
      name: "Yahoo Finance",
      url: "https://finance.yahoo.com",
      used_for:
        "Price · Activity volume · ETF AUM/NAV×Δunits Flow 추정 (baskets)",
    },
    {
      name: "CFTC SODA",
      url: "https://publicreporting.cftc.gov",
      used_for:
        "Position — ES·EAFE·UST10Y·DX·gold·WTI (MM/NC net · OI)",
    },
    {
      name: "FRED",
      url: "https://fred.stlouisfed.org",
      used_for: "Money market fund assets (Liquidity) — API or CSV",
    },
    {
      name: "DefiLlama Stablecoins",
      url: "https://stablecoins.llama.fi",
      used_for: "Stablecoin supply (Liquidity; not summed with BTC ETF Flow)",
    },
    {
      name: "OKX / Binance / CoinGecko Derivatives",
      url: "https://www.okx.com",
      used_for: "Crypto perpetual OI · funding (Position)",
    },
    {
      name: "US ETF DB (R2 seed)",
      url: "https://savvyetf.vercel.app",
      used_for: "Optional units history seed for basket Flow lookback",
    },
  ];

  const [yahooMap, cftc, mmf, stables, derivs, baskets] = await Promise.all([
    (async () => {
      const map = new Map<string, YahooPoint[]>();
      const symbols = new Set<string>();
      for (const a of ASSET_SPECS) {
        symbols.add(a.yahoo);
        if (a.volume_yahoo) symbols.add(a.volume_yahoo);
      }
      await Promise.all(
        [...symbols].map(async (sym) => {
          map.set(sym, await fetchYahooDaily(sym, 140));
        }),
      );
      return map;
    })(),
    getCftcPayload().catch((e) => {
      errors.push(`CFTC: ${e instanceof Error ? e.message : "failed"}`);
      return null;
    }),
    fetchFredMmf(),
    fetchStablecoinSupply(),
    fetchCryptoDerivatives(),
    buildBasketFlows(period).catch((e) => {
      errors.push(`ETF baskets: ${e instanceof Error ? e.message : "failed"}`);
      return {} as Awaited<ReturnType<typeof buildBasketFlows>>;
    }),
  ]);

  if (mmf.error) errors.push(`FRED MMF: ${mmf.error}`);
  if (stables.error) errors.push(`Stablecoins: ${stables.error}`);
  errors.push(...derivs.errors);

  const rows: AssetRow[] = [];

  for (const spec of ASSET_SPECS) {
    const pxSeries = yahooMap.get(spec.yahoo) || [];
    const volSeries = yahooMap.get(spec.volume_yahoo || spec.yahoo) || pxSeries;
    const ret = periodReturn(pxSeries, days);
    const vol = volumeRatioVs20d(volSeries, 30);
    const actZ = vol.ratio != null ? zscore(vol.hist, vol.ratio) : null;
    const actPct = vol.ratio != null ? percentileRank(vol.hist, vol.ratio) : null;

    const priceCell: MetricCell =
      ret == null
        ? unavailable("price", "가격수익률", "Yahoo series missing", "Yahoo")
        : {
            kind: "price",
            value: ret,
            unit: "%",
            label: "가격수익률",
            zscore_1m: null,
            percentile_1m: null,
            source: `Yahoo ${spec.yahoo}`,
            method: `${period} close-to-close return`,
            as_of: pxSeries[pxSeries.length - 1]?.date ?? null,
          };

    const volumeCell: MetricCell =
      vol.ratio == null
        ? unavailable("activity", "거래량 변화", "Insufficient volume history", "Yahoo")
        : {
            kind: "activity",
            value: vol.ratio,
            unit: "x 20d avg",
            label: "거래량 변화",
            zscore_1m: actZ,
            percentile_1m: actPct,
            source: `Yahoo ${spec.volume_yahoo || spec.yahoo}`,
            method: "Last session $volume / prior 20d average $volume (Activity, not Flow)",
            as_of: vol.as_of,
          };

    // ETF basket Flow (추정) + AUM — never sum with Position/Activity
    const basket = baskets[spec.id];
    const basketMeta = ETF_BASKETS[spec.id];
    let etfFlow = unavailable(
      "flow",
      "ETF·펀드 Flow",
      basket?.error ||
        "Issuer/ICI official flow not wired — waiting for units lookback",
      "Yahoo ETF baskets",
    );
    let flowAum = unavailable(
      "flow",
      "Flow/AUM",
      "Requires fund-flow + AUM",
      "Yahoo ETF baskets",
    );

    if (basket?.aum_usd != null && basket.aum_usd > 0) {
      flowAum = {
        kind: "liquidity",
        value: basket.aum_usd / 1e9,
        unit: "USD bn AUM",
        label: "바스켓 AUM",
        zscore_1m: null,
        percentile_1m: null,
        source: `Yahoo ${basketMeta.label}`,
        method: `Sum of ${basket.symbols_used.join("+")} totalAssets (Liquidity stock)`,
        as_of: basket.as_of,
        estimated: true,
      };
    }

    if (basket?.flow_usd != null) {
      etfFlow = {
        kind: "flow",
        value: basket.flow_usd / 1e9,
        unit: "USD bn",
        label: "ETF Flow 추정",
        zscore_1m: null,
        percentile_1m: null,
        source: `Yahoo ${basketMeta.label}`,
        method: basket.method,
        as_of: basket.as_of,
        estimated: true,
      };
      if (basket.flow_aum_pct != null && basket.aum_usd != null) {
        flowAum = {
          kind: "flow",
          value: basket.flow_aum_pct,
          unit: "% AUM",
          label: "Flow/AUM",
          zscore_1m: null,
          percentile_1m: null,
          source: `Yahoo ${basketMeta.label}`,
          method: `Period ETF Flow ÷ basket AUM · ${basket.method}`,
          as_of: basket.as_of,
          estimated: true,
        };
      }
    }

    // Dollar/cash: overlay FRED MMF as Liquidity (separate from BIL+SGOV ETF basket)
    if (spec.id === "dollar_cash" && mmf.chg_pct != null) {
      // Prefer FRED for the Flow系 summary of cash when ETF basket flow missing
      if (etfFlow.value == null) {
        etfFlow = {
          kind: "liquidity",
          value: mmf.chg_pct,
          unit: "%",
          label: "MMF AUM 변화",
          zscore_1m: null,
          percentile_1m: null,
          source: mmf.source,
          method:
            "QoQ/period change in money-market fund assets (Liquidity stock Δ — not ETF creations)",
          as_of: mmf.as_of,
        };
      }
      if (mmf.value != null && (flowAum.value == null || flowAum.kind === "liquidity")) {
        flowAum = {
          kind: "liquidity",
          value: mmf.value / 1e12,
          unit: "USD tn MMF",
          label: "MMF AUM",
          zscore_1m: null,
          percentile_1m: null,
          source: mmf.source,
          method: "Level of money-market fund financial assets (FRED)",
          as_of: mmf.as_of,
        };
      }
    }

    // Stables = system Liquidity note for crypto (not summed into IBIT/ETHA Flow)
    const notes: string[] = [];
    if (basket?.method) notes.push(basket.method);
    if (spec.id === "btc" && stables.chg_7d_pct != null) {
      notes.push(
        `스테이블 순발행 ${stables.chg_7d_pct.toFixed(2)}% 7d (Liquidity/Flow proxy — IBIT ETF Flow와 합산 안 함)`,
      );
    }
    if (spec.id === "btc" && stables.chg_7d_pct != null && etfFlow.value == null) {
      etfFlow = {
        kind: "flow",
        value: stables.chg_7d_pct,
        unit: "% 7d",
        label: "스테이블 순발행",
        zscore_1m: null,
        percentile_1m: null,
        source: "DefiLlama Stablecoins",
        method:
          "IBIT lookback missing — temporary Flow proxy = 7d stablecoin supply Δ (not spot ETF)",
        as_of: stables.as_of,
        estimated: true,
      };
      // Keep IBIT basket AUM when present; otherwise show stable supply
      if (flowAum.value == null && stables.total_usd != null) {
        flowAum = {
          kind: "liquidity",
          value: stables.total_usd / 1e9,
          unit: "USD bn",
          label: "스테이블 공급",
          zscore_1m: null,
          percentile_1m: null,
          source: "DefiLlama Stablecoins",
          method: "Total pegged stablecoin supply (Liquidity stock)",
          as_of: stables.as_of,
        };
      }
    }

    let oiCell = unavailable(
      "position",
      "OI 변화",
      "No OI series for this asset in MVP",
      "—",
    );
    let cftcCell = unavailable(
      "position",
      "CFTC 포지션",
      "Not in CFTC coverage set",
      "CFTC",
    );

    if (spec.cftc_id && cftc?.ok) {
      const m = cftc.markets?.find((x) => x.id === spec.cftc_id);
      if (m?.latest) {
        const mm = m.latest.net_mm ?? m.latest.net_noncomm;
        const hist = m.series
          .map((h) => h.net_mm ?? h.net_noncomm)
          .filter((x): x is number => x != null);
        cftcCell = {
          kind: "position",
          value: mm,
          unit: "contracts",
          label: m.latest.net_mm != null ? "CFTC MM net" : "CFTC NC net",
          zscore_1m: mm != null ? zscore(hist.slice(-30), mm) : null,
          percentile_1m: m.latest.percentile,
          source: "CFTC Disaggregated / Legacy",
          method: `${m.label} · Managed Money net preferred, else Non-Commercial (Position — not cash flow)`,
          as_of: m.latest.date || cftc.as_of || null,
        };

        const oiNow = m.latest.open_interest;
        const prevPt = m.series.length >= 2 ? m.series[m.series.length - 2] : null;
        const oiPrev = prevPt?.open_interest ?? null;
        if (oiNow > 0 && oiPrev != null && oiPrev > 0) {
          const oiChgPct = (100 * (oiNow - oiPrev)) / oiPrev;
          oiCell = {
            kind: "position",
            value: oiChgPct,
            unit: "% OI WoW",
            label: "OI 변화",
            zscore_1m: null,
            percentile_1m: null,
            source: "CFTC open_interest_all",
            method: "WoW % change in futures open interest (Position)",
            as_of: m.latest.date || null,
          };
        } else if (m.latest.net_chg != null) {
          oiCell = {
            kind: "position",
            value: m.latest.net_chg,
            unit: "Δ contracts",
            label: "CFTC net Δ",
            zscore_1m: null,
            percentile_1m: null,
            source: "CFTC",
            method: "WoW change in primary net (Position change)",
            as_of: m.latest.date || null,
          };
        }
      }
    }

    if (spec.id === "btc" && derivs.btc_oi_usd != null) {
      oiCell = {
        kind: "position",
        value: derivs.btc_oi_usd / 1e9,
        unit: "USD bn OI",
        label: "BTC OI",
        zscore_1m: null,
        percentile_1m: null,
        source: derivs.source,
        method: "Perpetual/futures open interest notional (Position)",
        as_of: derivs.as_of,
      };
    }
    if (spec.id === "eth_alts" && derivs.eth_oi_usd != null) {
      oiCell = {
        kind: "position",
        value: derivs.eth_oi_usd / 1e9,
        unit: "USD bn OI",
        label: "ETH OI",
        zscore_1m: null,
        percentile_1m: null,
        source: derivs.source,
        method: "Perpetual/futures open interest notional (Position)",
        as_of: derivs.as_of,
      };
    }

    const status = statusFromSignals({
      price: ret,
      activityZ: actZ,
      flowZ:
        etfFlow.value != null
          ? etfFlow.value > 0
            ? 1
            : etfFlow.value < 0
              ? -1
              : 0
          : null,
    });

    if (etfFlow.unavailable_reason) notes.push(`Flow: ${etfFlow.unavailable_reason}`);
    if (etfFlow.estimated) notes.push("Flow 값은 추정(Inferred/ETF units) — ICI 공식 아님");

    rows.push({
      id: spec.id,
      label_ko: spec.label_ko,
      label_en: spec.label_en,
      etf_flow: etfFlow,
      flow_aum: flowAum,
      oi_change: oiCell,
      cftc: cftcCell,
      volume_change: volumeCell,
      price_return: priceCell,
      status,
      status_ko: statusKo(status),
      notes,
    });
  }

  // Risk summary from row statuses (counts — not dollar sums)
  const on = rows.filter((r) => r.status === "risk_on").length;
  const off = rows.filter((r) => r.status === "risk_off").length;
  let regime: MoneyFlowPayload["risk_summary"]["regime"] = "mixed";
  if (on === 0 && off === 0) regime = "unavailable";
  else if (on > off + 1) regime = "risk_on";
  else if (off > on + 1) regime = "risk_off";

  const drivers: string[] = [];
  for (const r of rows) {
    if (r.status === "risk_on" || r.status === "risk_off") {
      drivers.push(
        `${r.label_ko}: ${r.status_ko}` +
          (r.price_return.value != null
            ? ` · 수익률 ${r.price_return.value.toFixed(1)}%`
            : ""),
      );
    }
  }

  // Top inflow/outflow among material Flow cells (skip ~0 ETF lookback noise)
  const flowRows = rows
    .map((r) => ({
      asset: r.label_ko,
      kind: r.etf_flow.kind,
      value: r.etf_flow.value,
      unit: r.etf_flow.unit,
      label: r.etf_flow.label,
    }))
    .filter(
      (x): x is {
        asset: string;
        kind: MetricKind;
        value: number;
        unit: string;
        label: string;
      } =>
        x.value != null &&
        Number.isFinite(x.value) &&
        Math.abs(x.value) > 1e-4 &&
        (x.kind === "flow" || x.kind === "liquidity"),
    );
  flowRows.sort((a, b) => b.value - a.value);
  const topIn = flowRows[0] || null;
  const topOut = flowRows.length > 1 ? flowRows[flowRows.length - 1]! : null;

  const inferences: MoneyFlowPayload["inferences"] = [];
  const us = rows.find((r) => r.id === "us_equity");
  const tr = rows.find((r) => r.id === "treasury");
  if (
    us?.volume_change.value != null &&
    tr?.volume_change.value != null &&
    us.volume_change.value < 0.8 &&
    tr.volume_change.value > 1.2 &&
    (tr.price_return.value ?? 0) > 0
  ) {
    inferences.push({
      text: "미국 주식 Activity 둔화 + 국채 Activity·가격 상대 강세 → 주식→채권 이동 가능성",
      confidence: "inferred",
      basis: "Volume ratio & returns only; ETF creation/redemption not observed",
    });
  }

  const cftc_changes =
    cftc?.markets
      ?.filter(
        (m) =>
          m.id === "gold" ||
          m.id === "wti" ||
          m.id === "es_mini" ||
          m.id === "msci_eafe" ||
          m.id === "ust_10y" ||
          m.id === "usd_index",
      )
      .map((m) => ({
        market: m.label,
        mm_net: m.latest?.net_mm ?? m.latest?.net_noncomm ?? null,
        mm_net_chg: m.latest?.net_chg ?? null,
        as_of: m.latest?.date || null,
      })) || [];

  const payload: MoneyFlowPayload = {
    ok: true,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    as_of_kst: kstDate(),
    period,
    note:
      "Flow / Position / Activity / Liquidity are separate — never summed. " +
      "ETF Flow is 추정(NAV×Δunits / implied AUM) unless ICI/issuer official. " +
      "USD · timestamps KST.",
    risk_summary: {
      regime,
      regime_ko:
        regime === "risk_on"
          ? "Risk-on 우세"
          : regime === "risk_off"
            ? "Risk-off 우세"
            : regime === "mixed"
              ? "혼조"
              : "판단 불가",
      drivers: drivers.slice(0, 6),
    },
    top_inflow: topIn
      ? {
          asset: topIn.asset,
          kind: topIn.kind,
          value_label: `${topIn.label} ${topIn.value.toFixed(2)}${topIn.unit}`,
        }
      : null,
    top_outflow:
      topOut && topIn && topOut.asset !== topIn.asset
        ? {
            asset: topOut.asset,
            kind: topOut.kind,
            value_label: `${topOut.label} ${topOut.value.toFixed(2)}${topOut.unit}`,
          }
        : null,
    rows,
    charts: {
      flow_bars: rows.map((r) => ({
        asset: r.label_ko,
        value: r.etf_flow.value,
        kind: r.etf_flow.kind,
        inferred: !!r.etf_flow.estimated,
      })),
      family_compare: rows.map((r) => ({
        asset: r.label_ko,
        flow_z: r.etf_flow.zscore_1m,
        position_z: r.cftc.zscore_1m ?? r.oi_change.zscore_1m,
        activity_z: r.volume_change.zscore_1m,
      })),
      crypto_derivatives: {
        btc_oi_usd: derivs.btc_oi_usd,
        eth_oi_usd: derivs.eth_oi_usd,
        btc_funding: derivs.btc_funding,
        eth_funding: derivs.eth_funding,
        source: derivs.source,
        as_of: derivs.as_of,
      },
      cftc_changes,
    },
    inferences,
    sources,
    errors,
  };

  if (r2Configured()) {
    try {
      await r2PutObject(MONEY_FLOW_R2_KEY, JSON.stringify(payload), "application/json");
    } catch (e) {
      errors.push(`R2 persist: ${e instanceof Error ? e.message : "failed"}`);
      payload.errors = errors;
    }
  }

  return payload;
}

export async function getMoneyFlowPayload(
  period: MoneyFlowPeriod = "1m",
): Promise<MoneyFlowPayload> {
  return withServerCache(
    `money-flow:${period}`,
    5 * 60_000,
    30 * 60_000,
    () => buildMoneyFlowPayload(period),
  );
}

export async function loadMoneyFlowFromR2(): Promise<MoneyFlowPayload | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(MONEY_FLOW_R2_KEY);
    if (!text) return null;
    return JSON.parse(text) as MoneyFlowPayload;
  } catch {
    return null;
  }
}

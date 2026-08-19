/**
 * Crypto / 가상자산 dashboard — free public APIs only.
 * CoinGecko (prices, dominance), Upbit (KRW), Yahoo KRW=X (FX),
 * alternative.me Fear&Greed, OKX (BTC perp OI / L/S / funding / candles).
 */

import {
  buildAssetSignal,
  interpretCryptoPanel,
  type AssetSignal,
  type CryptoIndicator as SignalCryptoIndicator,
  type SignalPoint,
} from "@/lib/tradingSignals";

export const CRYPTO_SCHEDULE_NOTE =
  "CoinGecko·Upbit·OKX·DefiLlama·Yahoo 공개 API · 약 1–2분 캐시 · 교육용(투자 권유 아님)";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const WATCHLIST_SIZE = 20;

/** CoinGecko ids that are stables or wrapped/staked versions of BTC/ETH. */
const EXCLUDED_COIN_IDS = new Set([
  "tether",
  "usd-coin",
  "dai",
  "ethena-usde",
  "ethena-staked-usde",
  "first-digital-usd",
  "paypal-usd",
  "true-usd",
  "binance-usd",
  "usds",
  "usd1",
  "ripple-usd",
  "global-dollar",
  "usual-usd",
  "liquity-usd",
  "frax",
  "susds",
  "usdt0",
  "ondo-us-dollar-yield",
  "staked-ether",
  "wrapped-steth",
  "wrapped-bitcoin",
  "weth",
  "coinbase-wrapped-btc",
  "kelp-dao-restaked-eth",
  "rocket-pool-eth",
  "mantle-staked-ether",
  "wrapped-eeth",
  "ether-fi-staked-eth",
  "binance-peg-weth",
]);

const EXCLUDED_SYMBOLS = new Set([
  "USDT",
  "USDC",
  "DAI",
  "USDE",
  "FDUSD",
  "TUSD",
  "BUSD",
  "PYUSD",
  "USDS",
  "USD1",
  "RLUSD",
  "USDD",
  "GUSD",
  "LUSD",
  "FRAX",
  "USD0",
  "USDG",
  "USDY",
  "USDP",
  "STETH",
  "WSTETH",
  "WBTC",
  "WETH",
  "CBBTC",
]);

const COIN_SYMBOL_HINT: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  ripple: "XRP",
  binancecoin: "BNB",
  dogecoin: "DOGE",
  cardano: "ADA",
  "avalanche-2": "AVAX",
  chainlink: "LINK",
  polkadot: "DOT",
  tron: "TRX",
  "the-open-network": "TON",
  "near-protocol": "NEAR",
  sui: "SUI",
  litecoin: "LTC",
  "bitcoin-cash": "BCH",
  "shiba-inu": "SHIB",
  stellar: "XLM",
  uniswap: "UNI",
  hyperliquid: "HYPE",
  "leo-token": "LEO",
  "figure-heloc": "FIGR",
  "hedera-hashgraph": "HBAR",
  mantle: "MNT",
  aptos: "APT",
  "render-token": "RENDER",
  "internet-computer": "ICP",
  "crypto-com-chain": "CRO",
  pepe: "PEPE",
  aave: "AAVE",
  "world-liberty-financial": "WLFI",
  bittensor: "TAO",
  "official-trump": "TRUMP",
};

export function parseCoinId(raw: string | null | undefined): string {
  const id = (raw || "").trim().toLowerCase();
  if (!id || id.length > 64 || !/^[a-z0-9-]+$/.test(id)) return "bitcoin";
  return id;
}

function symbolHint(coinId: string): string {
  return COIN_SYMBOL_HINT[coinId] || coinId.replace(/-.*$/, "").toUpperCase();
}

function isExcludedCoin(c: {
  id?: string;
  symbol?: string;
  name?: string;
}): boolean {
  const id = (c.id || "").toLowerCase();
  const sym = (c.symbol || "").toUpperCase();
  const name = (c.name || "").toLowerCase();
  if (EXCLUDED_COIN_IDS.has(id) || EXCLUDED_SYMBOLS.has(sym)) return true;
  if (sym.startsWith("USD") || (sym.endsWith("USD") && sym !== "SUSHI")) {
    return true;
  }
  if (
    (name.includes("wrapped") || name.includes("staked")) &&
    (name.includes("bitcoin") || name.includes("ether"))
  ) {
    return true;
  }
  return false;
}

/** Upbit KRW markets used for kimchi premium */
const UPBIT_MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL"] as const;

export type CryptoAssetRow = {
  id: string;
  symbol: string;
  name: string;
  price_usd: number | null;
  change_24h_pct: number | null;
  change_7d_pct: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  sparkline_7d: number[];
};

export type KimchiRow = {
  symbol: string;
  upbit_krw: number | null;
  fair_krw: number | null;
  usd: number | null;
  premium_pct: number | null;
};

export type CryptoIndicator = {
  id: string;
  label: string;
  value: number | null;
  display: string;
  note?: string;
  tone?: "up" | "down" | "flat";
};

export type FearGreedPoint = {
  date: string;
  value: number;
  classification: string;
};

export type CryptoSeriesPoint = {
  ts: number;
  label: string;
  value: number;
};

export type BtcCandle = {
  ts: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20: number | null;
  sma50: number | null;
};

export type CryptoStrategy = {
  action: "buy" | "hold" | "sell";
  action_ko: string;
  score: number;
  title: string;
  summary: string;
  bias_note: string | null;
  entry: string;
  stop: string;
  targets: string[];
  invalidation: string;
  risk_notes: string[];
  drivers: string[];
  price: number | null;
  sma20: number | null;
  sma50: number | null;
  support: number | null;
  resistance: number | null;
  signal: AssetSignal | null;
};

export type FuturesPanel = {
  mark: number | null;
  chg24_pct: number | null;
  oi_usd: number | null;
  oi_chg_24h_pct: number | null;
  ls_ratio: number | null;
  long_pct: number | null;
  funding_pct: number | null;
  taker_imbalance: number | null;
  book_imbalance: number | null;
  vol_btc_24h: number | null;
  oi_series: CryptoSeriesPoint[];
  ls_series: CryptoSeriesPoint[];
  funding_series: CryptoSeriesPoint[];
  indicators: CryptoIndicator[];
};

export type BtcChartBarId = "1m" | "5m" | "15m" | "1H" | "4H" | "1D";

export const BTC_CHART_BARS: Array<{
  id: BtcChartBarId;
  okx: string;
  label: string;
  limit: number;
}> = [
  { id: "1m", okx: "1m", label: "1분", limit: 120 },
  { id: "5m", okx: "5m", label: "5분", limit: 144 },
  { id: "15m", okx: "15m", label: "15분", limit: 96 },
  { id: "1H", okx: "1H", label: "1시간", limit: 168 },
  { id: "4H", okx: "4H", label: "4시간", limit: 90 },
  { id: "1D", okx: "1D", label: "1일", limit: 120 },
];

export function parseBtcChartBar(raw: string | null | undefined): BtcChartBarId {
  const hit = BTC_CHART_BARS.find((b) => b.id === raw);
  return hit?.id ?? "1H";
}

export type CryptoVolumeLeader = {
  id: string;
  symbol: string;
  name: string;
  volume_24h: number | null;
  price_usd: number | null;
  change_24h_pct: number | null;
  market_cap: number | null;
  volume_share_pct: number | null;
};

export type CryptoEtfFlowRow = {
  symbol: string;
  name: string;
  aum_usd: number | null;
  nav: number | null;
  change_24h_pct: number | null;
  as_of: string | null;
  method: string;
};

export type CryptoMoneyFlowPanel = {
  volume_leaders: CryptoVolumeLeader[];
  total_volume_tracked: number | null;
  market: {
    total_mcap_usd: number | null;
    total_volume_24h_usd: number | null;
    btc_dominance_pct: number | null;
    eth_dominance_pct: number | null;
  };
  stables: {
    total_usd: number | null;
    chg_1d_pct: number | null;
    chg_7d_pct: number | null;
    chg_1d_usd: number | null;
    chg_7d_usd: number | null;
    usdt_usd: number | null;
    usdt_chg_1d_pct: number | null;
    usdt_chg_7d_pct: number | null;
    usdt_chg_1d_usd: number | null;
    usdt_chg_7d_usd: number | null;
    as_of: string | null;
    source: string;
  };
  etf: {
    rows: CryptoEtfFlowRow[];
    note: string;
  };
  headlines: string[];
};

export type CryptoWatchCoin = {
  id: string;
  symbol: string;
  name: string;
  market_cap: number | null;
  rank: number;
};

export type CryptoSelectedCoin = {
  id: string;
  symbol: string;
  name: string;
  inst_id: string | null;
  chart_source: "okx" | "coingecko";
};

export type CryptoAssetsPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  schedule_note: string;
  note: string;
  usdkrw: number | null;
  assets: CryptoAssetRow[];
  watchlist: CryptoWatchCoin[];
  selected_coin: CryptoSelectedCoin;
  kimchi: KimchiRow[];
  indicators: CryptoIndicator[];
  fear_greed: FearGreedPoint[];
  interpretations: string[];
  futures: FuturesPanel;
  btc_chart: BtcCandle[];
  btc_chart_interval: BtcChartBarId;
  btc_chart_intervals: Array<{ id: BtcChartBarId; label: string }>;
  money_flow: CryptoMoneyFlowPanel;
  strategy: CryptoStrategy | null;
  error?: string;
};

type CgMarket = {
  id: string;
  symbol: string;
  name: string;
  current_price?: number;
  price_change_percentage_24h?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  market_cap?: number;
  total_volume?: number;
  sparkline_in_7d?: { price?: number[] };
};

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

function toneFrom(n: number | null | undefined): "up" | "down" | "flat" {
  if (n == null || !Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4)}`;
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  }
  if (n >= 1) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  if (n >= 0.01) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  }
  return `$${n.toPrecision(4)}`;
}

function candleLabel(ts: number, bar: BtcChartBarId): string {
  const opts: Intl.DateTimeFormatOptions =
    bar === "1D"
      ? {
          timeZone: "Asia/Seoul",
          month: "2-digit",
          day: "2-digit",
        }
      : bar === "1m" || bar === "5m" || bar === "15m"
        ? {
            timeZone: "Asia/Seoul",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }
        : {
            timeZone: "Asia/Seoul",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          };
  return new Intl.DateTimeFormat("ko-KR", opts).format(new Date(ts));
}

function hourLabel(ts: number): string {
  return candleLabel(ts, "1H");
}

async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchOkxJson<T>(path: string): Promise<T | null> {
  return fetchJson<T>(`https://www.okx.com${path}`);
}

async function fetchUsdKrw(): Promise<number | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 5 * 86400;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/KRW=X` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const json = await fetchJson<{
    chart?: {
      result?: Array<{ meta?: { regularMarketPrice?: number } }>;
    };
  }>(url);
  const px = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return px != null && px > 0 ? px : null;
}

function smaAt(values: number[], i: number, window: number): number | null {
  if (i + 1 < window) return null;
  let sum = 0;
  for (let j = i - window + 1; j <= i; j++) sum += values[j]!;
  return sum / window;
}

function parseCandles(
  rows: string[][] | undefined,
  limit: number,
  bar: BtcChartBarId = "1H",
): BtcCandle[] {
  if (!rows?.length) return [];
  const chron = [...rows].reverse().slice(-limit);
  const closes = chron.map((r) => Number(r[4]));
  const out: BtcCandle[] = [];
  for (let i = 0; i < chron.length; i++) {
    const row = chron[i]!;
    const ts = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[6]); // base vol (BTC)
    if (![ts, open, high, low, close].every(Number.isFinite)) continue;
    out.push({
      ts,
      label: candleLabel(ts, bar),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      sma20: smaAt(closes, i, 20),
      sma50: smaAt(closes, i, 50),
    });
  }
  return out;
}

function seriesFromPairs(
  rows: string[][] | undefined,
  valueIdx: number,
  limit: number,
): CryptoSeriesPoint[] {
  if (!rows?.length) return [];
  return [...rows]
    .reverse()
    .slice(-limit)
    .map((row) => {
      const ts = Number(row[0]);
      const value = Number(row[valueIdx]);
      return {
        ts,
        label: hourLabel(ts),
        value,
      };
    })
    .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value));
}

function parseCgOhlc(
  rows: number[][] | undefined,
  bar: BtcChartBarId,
): BtcCandle[] {
  if (!rows?.length) return [];
  const closes = rows.map((r) => Number(r[4]));
  const out: BtcCandle[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const ts = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    if (![ts, open, high, low, close].every(Number.isFinite)) continue;
    out.push({
      ts,
      label: candleLabel(ts, bar),
      open,
      high,
      low,
      close,
      volume: 0,
      sma20: smaAt(closes, i, 20),
      sma50: smaAt(closes, i, 50),
    });
  }
  return out;
}

function cgDaysForBar(bar: BtcChartBarId): number {
  switch (bar) {
    case "1m":
    case "5m":
    case "15m":
      return 1;
    case "1H":
      return 7;
    case "4H":
      return 30;
    default:
      return 180;
  }
}

function okxInstCandidates(symbol: string): string[] {
  const sym = symbol.toUpperCase();
  const primary = `${sym}-USDT-SWAP`;
  if (["SHIB", "PEPE", "FLOKI", "BONK"].includes(sym)) {
    return [`1000${sym}-USDT-SWAP`, primary];
  }
  return [primary];
}

async function loadCoinMarketData(opts: {
  symbol: string;
  coinId: string;
  bar: BtcChartBarId;
}): Promise<{
  chart: BtcCandle[];
  chart1h: BtcCandle[];
  dailyCloses: SignalPoint[];
  futures: FuturesPanel;
  source: "okx" | "coingecko";
  instId: string | null;
}> {
  const barSpec = BTC_CHART_BARS.find((b) => b.id === opts.bar) ?? BTC_CHART_BARS[3]!;
  const candidates = okxInstCandidates(opts.symbol);
  const instId = candidates[0]!;
  const ccy = instId.startsWith("1000")
    ? instId.slice(4).replace("-USDT-SWAP", "")
    : opts.symbol.toUpperCase();

  const [
    funding,
    oi,
    ticker,
    lsRatio,
    oiHist,
    takerVol,
    books,
    fundingHist,
    candlesChart,
    candles1h,
    candles1d,
  ] = await Promise.all([
    fetchOkxJson<{ data?: Array<{ fundingRate?: string }> }>(
      `/api/v5/public/funding-rate?instId=${instId}`,
    ),
    fetchOkxJson<{ data?: Array<{ oiUsd?: string }> }>(
      `/api/v5/public/open-interest?instType=SWAP&instId=${instId}`,
    ),
    fetchOkxJson<{
      data?: Array<{
        last?: string;
        volCcy24h?: string;
        open24h?: string;
      }>;
    }>(`/api/v5/market/ticker?instId=${instId}`),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`,
    ),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/rubik/stat/contracts/open-interest-history?instId=${instId}&period=1H`,
    ),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/rubik/stat/taker-volume?ccy=${ccy}&instType=CONTRACTS&period=1H`,
    ),
    fetchOkxJson<{ data?: Array<{ bids?: string[][]; asks?: string[][] }> }>(
      `/api/v5/market/books?instId=${instId}&sz=10`,
    ),
    fetchOkxJson<{
      data?: Array<{ fundingRate?: string; fundingTime?: string }>;
    }>(`/api/v5/public/funding-rate-history?instId=${instId}&limit=48`),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/market/candles?instId=${instId}&bar=${barSpec.okx}&limit=${barSpec.limit}`,
    ),
    opts.bar === "1H"
      ? Promise.resolve(null)
      : fetchOkxJson<{ data?: string[][] }>(
          `/api/v5/market/candles?instId=${instId}&bar=1H&limit=168`,
        ),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/market/candles?instId=${instId}&bar=1D&limit=120`,
    ),
  ]);

  let usedInst = instId;
  let chartRows = candlesChart?.data;
  if (!chartRows?.length && candidates[1]) {
    const alt = candidates[1];
    const altCandles = await fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/market/candles?instId=${alt}&bar=${barSpec.okx}&limit=${barSpec.limit}`,
    );
    if (altCandles?.data?.length) {
      usedInst = alt;
      chartRows = altCandles.data;
    }
  }

  let chart = parseCandles(chartRows, barSpec.limit, opts.bar);
  let source: "okx" | "coingecko" = chart.length ? "okx" : "coingecko";
  let chart1h = parseCandles(
    opts.bar === "1H" ? chartRows : candles1h?.data,
    168,
    "1H",
  );
  let dailyCloses: SignalPoint[] = parseCandles(candles1d?.data, 120, "1D").map(
    (c) => ({
      date: new Date(c.ts).toISOString().slice(0, 10),
      value: c.close,
    }),
  );

  if (!chart.length) {
    const days = cgDaysForBar(opts.bar);
    const ohlc = await fetchJson<number[][]>(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(opts.coinId)}/ohlc?vs_currency=usd&days=${days}`,
    );
    chart = parseCgOhlc(ohlc || undefined, opts.bar);
    source = "coingecko";
    if (!dailyCloses.length) {
      const daily =
        days >= 90
          ? ohlc
          : await fetchJson<number[][]>(
              `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(opts.coinId)}/ohlc?vs_currency=usd&days=180`,
            );
      dailyCloses = parseCgOhlc(daily || undefined, "1D").map((c) => ({
        date: new Date(c.ts).toISOString().slice(0, 10),
        value: c.close,
      }));
    }
    if (!chart1h.length) {
      const hourly = await fetchJson<number[][]>(
        `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(opts.coinId)}/ohlc?vs_currency=usd&days=7`,
      );
      chart1h = parseCgOhlc(hourly || undefined, "1H");
    }
  }

  const mark = Number(ticker?.data?.[0]?.last);
  const open24h = Number(ticker?.data?.[0]?.open24h);
  const volBase = Number(ticker?.data?.[0]?.volCcy24h);
  const chg24 =
    Number.isFinite(mark) && Number.isFinite(open24h) && open24h
      ? (mark / open24h - 1) * 100
      : null;

  const fundingRate = Number(funding?.data?.[0]?.fundingRate);
  const fundingPct = Number.isFinite(fundingRate) ? fundingRate * 100 : null;
  const oiUsd = Number(oi?.data?.[0]?.oiUsd);

  const oi_series = seriesFromPairs(oiHist?.data, 3, 72);
  const oiNow =
    Number.isFinite(oiUsd) && oiUsd > 0
      ? oiUsd
      : oi_series.at(-1)?.value ?? null;
  const oiPrev24 = oi_series.length >= 25 ? oi_series.at(-25)?.value ?? null : null;
  const oi_chg_24h_pct =
    oiNow != null && oiPrev24 != null && oiPrev24 > 0
      ? (oiNow / oiPrev24 - 1) * 100
      : null;

  const ls_series = seriesFromPairs(lsRatio?.data, 1, 72);
  const ls_ratio = ls_series.at(-1)?.value ?? null;
  const long_pct =
    ls_ratio != null && ls_ratio > 0 ? (ls_ratio / (1 + ls_ratio)) * 100 : null;
  const lsPrev = ls_series.length >= 2 ? ls_series.at(-2)?.value ?? null : null;
  const lsChg = ls_ratio != null && lsPrev != null ? ls_ratio - lsPrev : null;

  const funding_series = (fundingHist?.data || [])
    .map((row) => {
      const ts = Number(row.fundingTime);
      const rate = Number(row.fundingRate);
      return {
        ts,
        label: hourLabel(ts),
        value: Number.isFinite(rate) ? rate * 100 : NaN,
      };
    })
    .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value))
    .reverse();

  const takerLatest = takerVol?.data?.[0];
  const takerBuy = takerLatest ? Number(takerLatest[1]) : null;
  const takerSell = takerLatest ? Number(takerLatest[2]) : null;
  const taker_imbalance =
    takerBuy != null &&
    takerSell != null &&
    takerBuy + takerSell > 0
      ? ((takerBuy - takerSell) / (takerBuy + takerSell)) * 100
      : null;

  const book = books?.data?.[0];
  let book_imbalance: number | null = null;
  if (book?.bids?.length && book?.asks?.length) {
    const bidQty = book.bids
      .slice(0, 10)
      .reduce((s, row) => s + Number(row[1] || 0), 0);
    const askQty = book.asks
      .slice(0, 10)
      .reduce((s, row) => s + Number(row[1] || 0), 0);
    if (bidQty + askQty > 0) {
      book_imbalance = ((bidQty - askQty) / (bidQty + askQty)) * 100;
    }
  }

  const px = Number.isFinite(mark) ? mark : chart.at(-1)?.close ?? null;
  const pxChg = chg24;
  const venue = source === "okx" ? `OKX ${usedInst}` : "CoinGecko 현물";

  const futuresIndicators: CryptoIndicator[] = [
    {
      id: "mark",
      label: `${opts.symbol} Mark`,
      value: px,
      display: fmtPx(px),
      note: pxChg != null ? `24h ${fmtPct(pxChg)} · ${venue}` : venue,
      tone: toneFrom(pxChg),
    },
    {
      id: "oi",
      label: "Open Interest",
      value: oiNow,
      display: fmtUsd(oiNow),
      note:
        oi_chg_24h_pct != null
          ? `24h ${fmtPct(oi_chg_24h_pct)} · ${usedInst}`
          : source === "okx"
            ? `${usedInst} OI (USD)`
            : "퍼프 없음 · 현물 OHLC",
      tone: toneFrom(oi_chg_24h_pct),
    },
    {
      id: "ls_ratio",
      label: `${opts.symbol} Perp L/S`,
      value: ls_ratio,
      display:
        ls_ratio != null
          ? `${ls_ratio.toFixed(2)} (Long ${long_pct?.toFixed(1) ?? "—"}%)`
          : "—",
      note:
        lsChg != null
          ? `1H Δ ${lsChg >= 0 ? "+" : ""}${lsChg.toFixed(2)} · OKX 계정 수 비율`
          : "OKX long/short account ratio",
      tone: toneFrom(lsChg),
    },
    {
      id: "funding",
      label: "Funding Rate",
      value: fundingPct,
      display: fundingPct != null ? `${fundingPct.toFixed(4)}%` : "—",
      note: "OKX 현재 펀딩 · +면 롱 비용",
      tone: toneFrom(fundingPct),
    },
    {
      id: "taker",
      label: "Taker Buy/Sell",
      value: taker_imbalance,
      display: taker_imbalance != null ? `${taker_imbalance.toFixed(1)}%` : "—",
      note: "OKX 계약 taker 매수−매도 불균형",
      tone: toneFrom(taker_imbalance),
    },
    {
      id: "book",
      label: "Book Imbalance",
      value: book_imbalance,
      display: book_imbalance != null ? `${book_imbalance.toFixed(1)}%` : "—",
      note: "OKX top10 bid−ask · +면 매수벽",
      tone: toneFrom(book_imbalance),
    },
    {
      id: "vol24",
      label: "Perp 24h Volume",
      value: Number.isFinite(volBase) ? volBase : null,
      display: Number.isFinite(volBase)
        ? `${volBase.toFixed(0)} ${opts.symbol}`
        : "—",
      note: "OKX 베이스 자산 거래량",
      tone: "flat",
    },
  ];

  const futures: FuturesPanel =
    source === "okx"
      ? {
          mark: px,
          chg24_pct: pxChg,
          oi_usd: oiNow,
          oi_chg_24h_pct,
          ls_ratio,
          long_pct,
          funding_pct: fundingPct,
          taker_imbalance,
          book_imbalance,
          vol_btc_24h: Number.isFinite(volBase) ? volBase : null,
          oi_series,
          ls_series,
          funding_series,
          indicators: futuresIndicators,
        }
      : {
          ...emptyFutures(),
          mark: px,
          indicators: [
            {
              id: "mark",
              label: `${opts.symbol} Spot`,
              value: px,
              display: fmtPx(px),
              note: "OKX 퍼프 없음 · CoinGecko 현물",
              tone: "flat",
            },
          ],
        };

  return {
    chart,
    chart1h,
    dailyCloses,
    futures,
    source,
    instId: source === "okx" ? usedInst : null,
  };
}

function emptyFutures(): FuturesPanel {
  return {
    mark: null,
    chg24_pct: null,
    oi_usd: null,
    oi_chg_24h_pct: null,
    ls_ratio: null,
    long_pct: null,
    funding_pct: null,
    taker_imbalance: null,
    book_imbalance: null,
    vol_btc_24h: null,
    oi_series: [],
    ls_series: [],
    funding_series: [],
    indicators: [],
  };
}

function buildPlaybook(input: {
  signal: AssetSignal;
  bias_note: string | null;
  mark: number | null;
  ls: number | null;
  fundingPct: number | null;
  oiChg: number | null;
  fear: number | null;
  kimchiBtc: number | null;
  support: number | null;
  resistance: number | null;
}): CryptoStrategy {
  const {
    signal,
    bias_note,
    mark,
    ls,
    fundingPct,
    oiChg,
    fear,
    kimchiBtc,
    support,
    resistance,
  } = input;
  const price = mark ?? signal.price;
  const sma20 = signal.sma20;
  const sma50 = signal.sma50;
  const risk_notes: string[] = [
    "룰 기반 교육용 시나리오입니다. 투자 자문·매매 권유가 아닙니다.",
  ];

  const crowdedLong =
    (ls != null && ls >= 1.8) || (fundingPct != null && fundingPct >= 0.02);
  const crowdedShort =
    (ls != null && ls <= 0.9) || (fundingPct != null && fundingPct <= -0.01);

  if (crowdedLong) {
    risk_notes.push("L/S·펀딩상 롱 과밀 — 추격 매수·고배율 롱은 리스크가 큽니다.");
  }
  if (crowdedShort) {
    risk_notes.push("숏 우세/음수 펀딩 — 숏 스퀴즈 반등 여지를 같이 봅니다.");
  }
  if (oiChg != null && Math.abs(oiChg) >= 5) {
    risk_notes.push(
      `OI 24h ${fmtPct(oiChg)} — 레버리지 유입/청산이 활발한 구간입니다.`,
    );
  }
  if (fear != null && fear <= 25) {
    risk_notes.push("Fear&Greed 극단 공포 — 변동성·휩쏘에 유의합니다.");
  }
  if (kimchiBtc != null && Math.abs(kimchiBtc) >= 2) {
    risk_notes.push(
      `김치 프리미엄 ${fmtPct(kimchiBtc)} — 국내·해외 수급 괴리가 큽니다.`,
    );
  }

  let title = "관망 · 레벨 확인";
  let summary =
    "뚜렷한 추세 신호가 약합니다. 지지·저항과 포지션 과열(L/S·펀딩)을 우선 봅니다.";
  let entry = price != null ? `관망. ${fmtPx(price)} 부근에서 방향 확인` : "관망";
  let stop =
    support != null
      ? `하방 ${fmtPx(support)} 이탈 시 약세 시나리오 강화`
      : "최근 스윙 저점 이탈 시 재평가";
  const targets: string[] = [];
  let invalidation =
    sma20 != null
      ? `종가 기준 SMA20(${fmtPx(sma20)}) 돌파/이탈로 시나리오 재설정`
      : "추세 전환 시 시나리오 폐기";

  if (signal.signal === "buy") {
    title = crowdedLong ? "분할 롱 · 눌림 대기" : "추세 롱 편향";
    summary = crowdedLong
      ? `가격 룰은 매수(${signal.score})이나 롱 과밀이라 추격보다 눌림/분할이 유리합니다.`
      : `가격 룰 매수(${signal.score}). SMA·모멘텀이 우호적이면 추세 추종 롱을 검토합니다.`;
    entry =
      sma20 != null && price != null
        ? crowdedLong
          ? `SMA20(${fmtPx(sma20)}) 근처 눌림 또는 ${fmtPx(price * 0.99)} 부근 분할`
          : `현재가 ${fmtPx(price)} 또는 SMA20(${fmtPx(sma20)}) 지지 확인 후 분할 롱`
        : `현재가 분할 롱`;
    stop =
      support != null
        ? `손절 참고: ${fmtPx(support)} (최근 스윙 저점)`
        : sma20 != null
          ? `손절 참고: SMA20(${fmtPx(sma20)}) 종가 이탈`
          : "최근 스윙 저점 이탈";
    if (resistance != null) targets.push(`1차 ${fmtPx(resistance)} (최근 고점)`);
    if (price != null) {
      targets.push(`2차 ${fmtPx(price * 1.03)} (+3%)`);
      targets.push(`확장 ${fmtPx(price * 1.05)} (+5%)`);
    }
    invalidation =
      sma50 != null
        ? `종가가 SMA50(${fmtPx(sma50)}) 아래로 마감되면 롱 시나리오 무효`
        : invalidation;
  } else if (signal.signal === "sell") {
    title = crowdedShort ? "분할 숏 · 반등 매도" : "추세 숏/관망 축소";
    summary = crowdedShort
      ? `가격 룰은 매도(${signal.score})이나 숏 과밀이라 추격 숏보다 반등 매도·비중 축소가 안전합니다.`
      : `가격 룰 매도(${signal.score}). 모멘텀 약화·이평 이탈이면 숏/현금 비중을 검토합니다.`;
    entry =
      sma20 != null && price != null
        ? crowdedShort
          ? `SMA20(${fmtPx(sma20)}) 근처 반등 또는 ${fmtPx(price * 1.01)} 부근 분할 숏/축소`
          : `현재가 ${fmtPx(price)} 또는 SMA20(${fmtPx(sma20)}) 저항 확인 후 숏/축소`
        : `현재가 분할 숏/축소`;
    stop =
      resistance != null
        ? `손절 참고: ${fmtPx(resistance)} (최근 스윙 고점)`
        : sma20 != null
          ? `손절 참고: SMA20(${fmtPx(sma20)}) 종가 돌파`
          : "최근 스윙 고점 돌파";
    if (support != null) targets.push(`1차 ${fmtPx(support)} (최근 저점)`);
    if (price != null) {
      targets.push(`2차 ${fmtPx(price * 0.97)} (−3%)`);
      targets.push(`확장 ${fmtPx(price * 0.95)} (−5%)`);
    }
    invalidation =
      sma50 != null
        ? `종가가 SMA50(${fmtPx(sma50)}) 위로 마감되면 숏 시나리오 무효`
        : invalidation;
  } else {
    if (price != null && resistance != null) {
      targets.push(`상단 돌파 시 ${fmtPx(resistance)} 관찰`);
    }
    if (price != null && support != null) {
      targets.push(`하단 이탈 시 ${fmtPx(support)} 관찰`);
    }
    if (!targets.length && price != null) {
      targets.push(`±2% 밴드 ${fmtPx(price * 0.98)} ~ ${fmtPx(price * 1.02)}`);
    }
  }

  return {
    action: signal.signal,
    action_ko: signal.signal_ko,
    score: signal.score,
    title,
    summary,
    bias_note,
    entry,
    stop,
    targets: targets.slice(0, 3),
    invalidation,
    risk_notes: risk_notes.slice(0, 5),
    drivers: signal.drivers.slice(0, 4),
    price,
    sma20,
    sma50,
    support,
    resistance,
    signal,
  };
}

export async function buildCryptoAssetsPayload(opts?: {
  bar?: string | null;
  coin?: string | null;
}): Promise<CryptoAssetsPayload> {
  const bar = parseBtcChartBar(opts?.bar);
  const coinId = parseCoinId(opts?.coin);
  const hintSym = symbolHint(coinId);
  const marketsUrl =
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
    `&order=market_cap_desc&per_page=60&page=1&sparkline=true` +
    `&price_change_percentage=24h%2C7d`;
  const volumeUrl =
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
    `&order=volume_desc&per_page=30&page=1&sparkline=false` +
    `&price_change_percentage=24h`;

  const [
    markets,
    volumeMarkets,
    global,
    upbit,
    usdkrw,
    fng,
    stablesRaw,
    etfQuotes,
    marketData,
  ] = await Promise.all([
    fetchJson<CgMarket[]>(marketsUrl),
    fetchJson<CgMarket[]>(volumeUrl),
    fetchJson<{
      data?: {
        market_cap_percentage?: Record<string, number>;
        total_market_cap?: { usd?: number };
        total_volume?: { usd?: number };
      };
    }>("https://api.coingecko.com/api/v3/global"),
    fetchJson<Array<{ market: string; trade_price: number }>>(
      `https://api.upbit.com/v1/ticker?markets=${UPBIT_MARKETS.join(",")}`,
    ),
    fetchUsdKrw(),
    fetchJson<{
      data?: Array<{
        value: string;
        value_classification: string;
        timestamp: string;
      }>;
    }>("https://api.alternative.me/fng/?limit=30"),
    fetchJson<{
      totalPeggedUSD?: number;
      peggedAssets?: Array<{
        name?: string;
        symbol?: string;
        circulating?: { peggedUSD?: number };
        circulatingPrevDay?: { peggedUSD?: number };
        circulatingPrevWeek?: { peggedUSD?: number };
      }>;
    }>("https://stablecoins.llama.fi/stablecoins?includePrices=true"),
    (async () => {
      try {
        const { fetchYahooFundStats } = await import("@/lib/moneyFlowEtf");
        return await fetchYahooFundStats(["IBIT", "ETHA"]);
      } catch {
        return new Map();
      }
    })(),
    loadCoinMarketData({ coinId, symbol: hintSym, bar }),
  ]);

  const ranked = (markets || []).filter((c) => !isExcludedCoin(c));
  const top = ranked.slice(0, WATCHLIST_SIZE);
  const assets: CryptoAssetRow[] = top.map((c) => ({
    id: c.id,
    symbol: COIN_SYMBOL_HINT[c.id] || (c.symbol || "").toUpperCase(),
    name: c.name,
    price_usd: c.current_price ?? null,
    change_24h_pct: c.price_change_percentage_24h ?? null,
    change_7d_pct: c.price_change_percentage_7d_in_currency ?? null,
    market_cap: c.market_cap ?? null,
    volume_24h: c.total_volume ?? null,
    sparkline_7d: (c.sparkline_in_7d?.price || []).slice(-48),
  }));
  const watchlist: CryptoWatchCoin[] = assets.map((a, i) => ({
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    market_cap: a.market_cap,
    rank: i + 1,
  }));

  const selectedRow =
    assets.find((a) => a.id === coinId) ||
    assets.find((a) => a.id === "bitcoin") ||
    assets[0] ||
    null;
  const selectedSymbol = selectedRow?.symbol || hintSym;
  const selectedName = selectedRow?.name || selectedSymbol;
  const selectedId = selectedRow?.id || coinId;

  let coinMarket = marketData;
  if (selectedSymbol !== hintSym) {
    coinMarket = await loadCoinMarketData({
      coinId: selectedId,
      symbol: selectedSymbol,
      bar,
    });
  }

  const btc_chart = coinMarket.chart;
  const futures = coinMarket.futures;
  const futuresIndicators = futures.indicators;
  const dailyCloses = coinMarket.dailyCloses;

  const usdBySym = new Map(
    assets.map((a) => [a.symbol, a.price_usd] as const),
  );
  const kimchi: KimchiRow[] = (upbit || []).map((u) => {
    const symbol = u.market.split("-")[1] || "";
    const usd = usdBySym.get(symbol) ?? null;
    const fair =
      usd != null && usdkrw != null && usdkrw > 0 ? usd * usdkrw : null;
    const premium =
      fair != null && fair > 0 ? (u.trade_price / fair - 1) * 100 : null;
    return {
      symbol,
      upbit_krw: u.trade_price,
      fair_krw: fair,
      usd,
      premium_pct: premium,
    };
  });

  const mcapPct = global?.data?.market_cap_percentage || {};
  const btcDom = mcapPct.btc ?? null;
  const ethDom = mcapPct.eth ?? null;
  const usdtDom = mcapPct.usdt ?? null;
  const totalMcap = global?.data?.total_market_cap?.usd ?? null;
  const totalVol = global?.data?.total_volume?.usd ?? null;
  const liquidity =
    totalMcap && totalVol && totalMcap > 0 ? (totalVol / totalMcap) * 100 : null;

  const fear_greed: FearGreedPoint[] = (fng?.data || [])
    .map((row) => ({
      date: new Date(Number(row.timestamp) * 1000).toISOString().slice(0, 10),
      value: Number(row.value),
      classification: row.value_classification,
    }))
    .filter((p) => Number.isFinite(p.value))
    .reverse();

  const fearLatest = fear_greed.at(-1)?.value ?? null;
  const kimchiBtc =
    kimchi.find((k) => k.symbol === "BTC")?.premium_pct ?? null;
  const kimchiSelected =
    kimchi.find((k) => k.symbol === selectedSymbol)?.premium_pct ?? kimchiBtc;

  const indicators: CryptoIndicator[] = [
    {
      id: "btc_dom",
      label: "BTC Dominance",
      value: btcDom,
      display: btcDom != null ? `${btcDom.toFixed(2)}%` : "—",
      note: "CoinGecko · 알트 대비 BTC 시총 비중",
      tone: "flat",
    },
    {
      id: "eth_dom",
      label: "ETH Dominance",
      value: ethDom,
      display: ethDom != null ? `${ethDom.toFixed(2)}%` : "—",
      note: "CoinGecko",
      tone: "flat",
    },
    {
      id: "usdt_dom",
      label: "USDT Dominance",
      value: usdtDom,
      display: usdtDom != null ? `${usdtDom.toFixed(2)}%` : "—",
      note: "테더 비중↑ = 대기자금·위험회피 성격",
      tone: "flat",
    },
    {
      id: "kimchi_btc",
      label: "김치 프리미엄 (BTC)",
      value: kimchiBtc,
      display: fmtPct(kimchiBtc),
      note: "Upbit KRW ÷ (CoinGecko USD × Yahoo KRW=X)",
      tone: toneFrom(kimchiBtc),
    },
    {
      id: "fear_greed",
      label: "Fear & Greed",
      value: fearLatest,
      display:
        fearLatest != null
          ? `${fearLatest} · ${fear_greed.at(-1)?.classification || ""}`
          : "—",
      note: "alternative.me",
      tone:
        fearLatest == null
          ? "flat"
          : fearLatest >= 60
            ? "up"
            : fearLatest <= 40
              ? "down"
              : "flat",
    },
    {
      id: "liquidity",
      label: "Crypto Liquidity",
      value: liquidity,
      display: liquidity != null ? `${liquidity.toFixed(2)}%` : "—",
      note: "글로벌 24h Vol / Mcap",
      tone: "flat",
    },
    {
      id: "total_mcap",
      label: "Total Crypto Mcap",
      value: totalMcap ?? null,
      display: fmtUsd(totalMcap ?? null),
      note: "CoinGecko global",
      tone: "flat",
    },
    {
      id: "usdkrw",
      label: "USD/KRW",
      value: usdkrw,
      display: usdkrw != null ? usdkrw.toFixed(2) : "—",
      note: "Yahoo KRW=X · 김치 산출용",
      tone: "flat",
    },
  ];

  const panelIndicators: SignalCryptoIndicator[] = [
    ...futuresIndicators,
    ...indicators.filter((i) =>
      ["usdt_dom", "btc_dom", "liquidity"].includes(i.id),
    ),
  ];
  const signal = buildAssetSignal(
    {
      id: selectedId,
      symbol: `${selectedSymbol}USDT.P`,
      label: `${selectedName} Perpetual`,
      group: "crypto",
    },
    dailyCloses,
    null,
    { vix: null, hyOas: null },
  );
  if (futures.mark != null) signal.price = futures.mark;

  const { interpretations, bias_note } = interpretCryptoPanel({
    signal,
    indicators: panelIndicators,
  });

  const recent = (coinMarket.chart1h.length
    ? coinMarket.chart1h
    : btc_chart
  ).slice(-48);
  const support = recent.length
    ? Math.min(...recent.map((c) => c.low))
    : null;
  const resistance = recent.length
    ? Math.max(...recent.map((c) => c.high))
    : null;

  const strategy = buildPlaybook({
    signal,
    bias_note,
    mark: futures.mark,
    ls: futures.ls_ratio,
    fundingPct: futures.funding_pct,
    oiChg: futures.oi_chg_24h_pct,
    fear: fearLatest,
    kimchiBtc: kimchiSelected,
    support,
    resistance,
  });

  const selected_coin: CryptoSelectedCoin = {
    id: selectedId,
    symbol: selectedSymbol,
    name: selectedName,
    inst_id: coinMarket.instId,
    chart_source: coinMarket.source,
  };

  // —— Crypto money flow panel (volume / stables / spot ETF AUM) ——
  const STABLE_IDS = new Set([
    "tether",
    "usd-coin",
    "ethena-usde",
    "dai",
    "first-digital-usd",
    "paypal-usd",
    "usds",
    "true-usd",
    "binance-bridged-usdt-bnb-smart-chain",
    "binance-bridged-usdc-bnb-smart-chain",
  ]);
  const STABLE_SYMS = new Set(["USDT", "USDC", "USDE", "DAI", "FDUSD", "PYUSD", "USDS", "TUSD"]);
  const volRows = (volumeMarkets || []).filter((c) => {
    const id = (c.id || "").toLowerCase();
    const sym = (c.symbol || "").toUpperCase();
    return !STABLE_IDS.has(id) && !STABLE_SYMS.has(sym);
  });
  const totalVolTracked = volRows.reduce(
    (s, r) => s + (r.total_volume || 0),
    0,
  );
  const volume_leaders: CryptoVolumeLeader[] = volRows.slice(0, 12).map((c) => ({
    id: c.id,
    symbol: (c.symbol || "").toUpperCase(),
    name: c.name,
    volume_24h: c.total_volume ?? null,
    price_usd: c.current_price ?? null,
    change_24h_pct: c.price_change_percentage_24h ?? null,
    market_cap: c.market_cap ?? null,
    volume_share_pct:
      totalVolTracked > 0 && c.total_volume != null
        ? (100 * c.total_volume) / totalVolTracked
        : null,
  }));

  let stablesTotal: number | null = stablesRaw?.totalPeggedUSD ?? null;
  let stablesCur = 0;
  let stablesPrevDay = 0;
  let stablesPrevWeek = 0;
  let usdtCur = 0;
  let usdtPrevDay = 0;
  let usdtPrevWeek = 0;
  for (const a of stablesRaw?.peggedAssets || []) {
    const cur = a.circulating?.peggedUSD || 0;
    const d = a.circulatingPrevDay?.peggedUSD || 0;
    const w = a.circulatingPrevWeek?.peggedUSD || 0;
    stablesCur += cur;
    stablesPrevDay += d;
    stablesPrevWeek += w;
    const sym = (a.symbol || "").toUpperCase();
    const name = (a.name || "").toLowerCase();
    if (sym === "USDT" || name.includes("tether")) {
      usdtCur += cur;
      usdtPrevDay += d;
      usdtPrevWeek += w;
    }
  }
  if (stablesTotal == null && stablesCur > 0) stablesTotal = stablesCur;
  const stables_chg_1d_usd =
    stablesPrevDay > 0 ? stablesCur - stablesPrevDay : null;
  const stables_chg_7d_usd =
    stablesPrevWeek > 0 ? stablesCur - stablesPrevWeek : null;
  const stables_chg_1d =
    stablesPrevDay > 0
      ? (100 * (stablesCur - stablesPrevDay)) / stablesPrevDay
      : null;
  const stables_chg_7d =
    stablesPrevWeek > 0
      ? (100 * (stablesCur - stablesPrevWeek)) / stablesPrevWeek
      : null;
  const usdt_chg_1d_usd = usdtPrevDay > 0 ? usdtCur - usdtPrevDay : null;
  const usdt_chg_7d_usd = usdtPrevWeek > 0 ? usdtCur - usdtPrevWeek : null;
  const usdt_chg_1d =
    usdtPrevDay > 0 ? (100 * (usdtCur - usdtPrevDay)) / usdtPrevDay : null;
  const usdt_chg_7d =
    usdtPrevWeek > 0 ? (100 * (usdtCur - usdtPrevWeek)) / usdtPrevWeek : null;

  const etfRows: CryptoEtfFlowRow[] = [];
  for (const [sym, name] of [
    ["IBIT", "iShares Bitcoin Trust"] as const,
    ["ETHA", "iShares Ethereum Trust"] as const,
  ]) {
    const q = etfQuotes.get(sym);
    etfRows.push({
      symbol: sym,
      name,
      aum_usd: q?.aum_usd ?? null,
      nav: q?.nav ?? null,
      change_24h_pct: q?.change_24h_pct ?? null,
      as_of: q?.aum_usd != null ? new Date().toISOString().slice(0, 10) : null,
      method:
        "Yahoo totalAssets (AUM stock) + 일봉 %. Official daily creations not free — see Money Flow for NAV×Δunits when history exists",
    });
  }

  const headlines: string[] = [];
  if (volume_leaders[0]?.symbol) {
    headlines.push(
      `24h 거래대금 1위 ${volume_leaders[0].symbol}` +
        (volume_leaders[0].volume_24h != null
          ? ` (${fmtUsd(volume_leaders[0].volume_24h)})`
          : ""),
    );
  }
  if (totalMcap != null) {
    headlines.push(
      `크립토 시총 ${fmtUsd(totalMcap)}` +
        (btcDom != null ? ` · BTC.D ${btcDom.toFixed(1)}%` : ""),
    );
  }
  if (usdt_chg_1d_usd != null || usdt_chg_1d != null) {
    const abs =
      usdt_chg_1d_usd != null
        ? `${usdt_chg_1d_usd >= 0 ? "+" : ""}${fmtUsd(usdt_chg_1d_usd)}`
        : "";
    const pct = usdt_chg_1d != null ? ` (${fmtPct(usdt_chg_1d)})` : "";
    const tone =
      (usdt_chg_1d ?? 0) > 0.05
        ? " · 테더 순발행↑(유동성 유입 신호)"
        : (usdt_chg_1d ?? 0) < -0.05
          ? " · 테더 상환↑(유동성 회수 신호)"
          : " · 큰 변화 없음";
    headlines.push(`USDT 1일 ${abs}${pct}${tone}`);
  } else if (stables_chg_7d != null) {
    headlines.push(`스테이블 전체 공급 7일 ${fmtPct(stables_chg_7d)}`);
  }
  if (etfRows[0]?.aum_usd != null) {
    headlines.push(
      `BTC 현물 ETF(IBIT) AUM ${fmtUsd(etfRows[0].aum_usd)}` +
        (etfRows[0].change_24h_pct != null
          ? ` · ${fmtPct(etfRows[0].change_24h_pct)}`
          : ""),
    );
  }
  if (etfRows[1]?.aum_usd != null) {
    headlines.push(
      `ETH 현물 ETF(ETHA) AUM ${fmtUsd(etfRows[1].aum_usd)}` +
        (etfRows[1].change_24h_pct != null
          ? ` · ${fmtPct(etfRows[1].change_24h_pct)}`
          : ""),
    );
  }

  const money_flow: CryptoMoneyFlowPanel = {
    volume_leaders,
    total_volume_tracked: totalVolTracked > 0 ? totalVolTracked : null,
    market: {
      total_mcap_usd: totalMcap,
      total_volume_24h_usd: totalVol,
      btc_dominance_pct: btcDom,
      eth_dominance_pct: ethDom,
    },
    stables: {
      total_usd: stablesTotal,
      chg_1d_pct: stables_chg_1d,
      chg_7d_pct: stables_chg_7d,
      chg_1d_usd: stables_chg_1d_usd,
      chg_7d_usd: stables_chg_7d_usd,
      usdt_usd: usdtCur > 0 ? usdtCur : null,
      usdt_chg_1d_pct: usdt_chg_1d,
      usdt_chg_7d_pct: usdt_chg_7d,
      usdt_chg_1d_usd: usdt_chg_1d_usd,
      usdt_chg_7d_usd: usdt_chg_7d_usd,
      as_of: new Date().toISOString().slice(0, 10),
      source: "DefiLlama Stablecoins",
    },
    etf: {
      rows: etfRows,
      note:
        "현물 ETF AUM·일봉%는 Yahoo. 일별 creations/redemptions 공식 API는 무료로 제한적 — 추정 Flow는 시황→Money Flow 탭 참고",
    },
    headlines,
  };

  const ok = assets.length > 0 || btc_chart.length > 0;
  return {
    ok,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    source: `CoinGecko · Upbit · ${
      selected_coin.inst_id || "CoinGecko OHLC"
    } · DefiLlama · Yahoo · alternative.me · 시총 상위 ${assets.length} (스테이블 제외)`,
    schedule_note: CRYPTO_SCHEDULE_NOTE,
    note:
      "시가총액 상위 20개 코인(스테이블·랩핑 제외)을 선택하면 해당 종목의 차트와 룰 코멘트가 바뀝니다. " +
      "선물 데이터가 있으면 OKX 퍼프, 없으면 CoinGecko 현물 OHLC입니다.",
    usdkrw,
    assets,
    watchlist,
    selected_coin,
    kimchi,
    indicators,
    fear_greed,
    interpretations,
    futures,
    btc_chart,
    btc_chart_interval: bar,
    btc_chart_intervals: BTC_CHART_BARS.map((b) => ({
      id: b.id,
      label: b.label,
    })),
    money_flow,
    strategy,
    error: ok ? undefined : "가상자산 데이터 로드 실패",
  };
}

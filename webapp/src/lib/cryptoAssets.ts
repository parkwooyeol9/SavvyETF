/**
 * Crypto / 가상자산 dashboard — free public APIs only.
 * CoinGecko (prices, dominance), Upbit (KRW), Yahoo KRW=X (FX),
 * alternative.me Fear&Greed, OKX (BTC perp OI / L/S / funding / candles).
 */

import {
  CRYPTO_PERP_SPEC,
  buildAssetSignal,
  interpretCryptoPanel,
  type AssetSignal,
  type CryptoIndicator as SignalCryptoIndicator,
  type SignalPoint,
} from "@/lib/tradingSignals";

export const CRYPTO_SCHEDULE_NOTE =
  "CoinGecko·Upbit·OKX·Yahoo 공개 API · 약 1–2분 캐시 · 교육용(투자 권유 아님)";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const OKX_SWAP = "BTC-USDT-SWAP";

const COIN_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "ripple",
  "binancecoin",
  "dogecoin",
  "cardano",
  "avalanche-2",
  "chainlink",
  "polkadot",
] as const;

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

export type CryptoAssetsPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  schedule_note: string;
  note: string;
  usdkrw: number | null;
  assets: CryptoAssetRow[];
  kimchi: KimchiRow[];
  indicators: CryptoIndicator[];
  fear_greed: FearGreedPoint[];
  interpretations: string[];
  futures: FuturesPanel;
  btc_chart: BtcCandle[];
  btc_chart_interval: string;
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
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
}

function hourLabel(ts: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
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
      label: hourLabel(ts),
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

export async function buildCryptoAssetsPayload(): Promise<CryptoAssetsPayload> {
  const ids = COIN_IDS.join(",");
  const marketsUrl =
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
    `&ids=${encodeURIComponent(ids)}&order=market_cap_desc&sparkline=true` +
    `&price_change_percentage=24h%2C7d`;

  const [
    markets,
    global,
    upbit,
    usdkrw,
    fng,
    funding,
    oi,
    ticker,
    lsRatio,
    oiHist,
    takerVol,
    books,
    fundingHist,
    candles1h,
    candles1d,
  ] = await Promise.all([
    fetchJson<CgMarket[]>(marketsUrl),
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
    fetchOkxJson<{ data?: Array<{ fundingRate?: string }> }>(
      `/api/v5/public/funding-rate?instId=${OKX_SWAP}`,
    ),
    fetchOkxJson<{ data?: Array<{ oiUsd?: string }> }>(
      `/api/v5/public/open-interest?instType=SWAP&instId=${OKX_SWAP}`,
    ),
    fetchOkxJson<{
      data?: Array<{
        last?: string;
        volCcy24h?: string;
        open24h?: string;
      }>;
    }>(`/api/v5/market/ticker?instId=${OKX_SWAP}`),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H`,
    ),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/rubik/stat/contracts/open-interest-history?instId=${OKX_SWAP}&period=1H`,
    ),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/rubik/stat/taker-volume?ccy=BTC&instType=CONTRACTS&period=1H`,
    ),
    fetchOkxJson<{ data?: Array<{ bids?: string[][]; asks?: string[][] }> }>(
      `/api/v5/market/books?instId=${OKX_SWAP}&sz=10`,
    ),
    fetchOkxJson<{
      data?: Array<{ fundingRate?: string; fundingTime?: string }>;
    }>(`/api/v5/public/funding-rate-history?instId=${OKX_SWAP}&limit=48`),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/market/candles?instId=${OKX_SWAP}&bar=1H&limit=168`,
    ),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/market/candles?instId=${OKX_SWAP}&bar=1D&limit=120`,
    ),
  ]);

  const assets: CryptoAssetRow[] = (markets || []).map((c) => ({
    id: c.id,
    symbol: (c.symbol || "").toUpperCase(),
    name: c.name,
    price_usd: c.current_price ?? null,
    change_24h_pct: c.price_change_percentage_24h ?? null,
    change_7d_pct: c.price_change_percentage_7d_in_currency ?? null,
    market_cap: c.market_cap ?? null,
    volume_24h: c.total_volume ?? null,
    sparkline_7d: (c.sparkline_in_7d?.price || []).slice(-48),
  }));

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

  const mark = Number(ticker?.data?.[0]?.last);
  const open24h = Number(ticker?.data?.[0]?.open24h);
  const volBtc = Number(ticker?.data?.[0]?.volCcy24h);
  const chg24 =
    Number.isFinite(mark) && Number.isFinite(open24h) && open24h
      ? (mark / open24h - 1) * 100
      : null;

  const fundingRate = Number(funding?.data?.[0]?.fundingRate);
  const fundingPct = Number.isFinite(fundingRate) ? fundingRate * 100 : null;
  const oiUsd = Number(oi?.data?.[0]?.oiUsd);

  const oi_series = seriesFromPairs(oiHist?.data, 3, 72).map((p) => ({
    ...p,
    value: p.value, // USD OI
  }));
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
    ls_ratio != null && ls_ratio > 0
      ? (ls_ratio / (1 + ls_ratio)) * 100
      : null;
  const lsPrev = ls_series.length >= 2 ? ls_series.at(-2)?.value ?? null : null;
  const lsChg =
    ls_ratio != null && lsPrev != null ? ls_ratio - lsPrev : null;

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

  const futuresIndicators: CryptoIndicator[] = [
    {
      id: "mark",
      label: "BTCUSDT.P Mark",
      value: Number.isFinite(mark) ? mark : null,
      display: fmtPx(Number.isFinite(mark) ? mark : null),
      note: chg24 != null ? `24h ${fmtPct(chg24)} · OKX SWAP` : "OKX SWAP",
      tone: toneFrom(chg24),
    },
    {
      id: "oi",
      label: "Open Interest",
      value: oiNow,
      display: fmtUsd(oiNow),
      note:
        oi_chg_24h_pct != null
          ? `24h ${fmtPct(oi_chg_24h_pct)} · OKX BTC-USDT-SWAP`
          : "OKX BTC-USDT-SWAP OI (USD)",
      tone: toneFrom(oi_chg_24h_pct),
    },
    {
      id: "ls_ratio",
      label: "BTC Perp L/S Ratio",
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
      value: Number.isFinite(volBtc) ? volBtc : null,
      display: Number.isFinite(volBtc) ? `${volBtc.toFixed(0)} BTC` : "—",
      note: "OKX 베이스 자산 거래량",
      tone: "flat",
    },
  ];

  const futures: FuturesPanel = {
    mark: Number.isFinite(mark) ? mark : null,
    chg24_pct: chg24,
    oi_usd: oiNow,
    oi_chg_24h_pct,
    ls_ratio,
    long_pct,
    funding_pct: fundingPct,
    taker_imbalance,
    book_imbalance,
    vol_btc_24h: Number.isFinite(volBtc) ? volBtc : null,
    oi_series,
    ls_series,
    funding_series,
    indicators: futuresIndicators,
  };

  const btc_chart = parseCandles(candles1h?.data, 168);
  const dailyCloses: SignalPoint[] = parseCandles(candles1d?.data, 120).map(
    (c) => ({
      date: new Date(c.ts).toISOString().slice(0, 10),
      value: c.close,
    }),
  );

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

  // Interpretations + strategy (reuse trading-signals heuristics)
  const panelIndicators: SignalCryptoIndicator[] = [
    ...futuresIndicators,
    ...indicators.filter((i) =>
      ["usdt_dom", "btc_dom", "liquidity"].includes(i.id),
    ),
  ];
  const signal = buildAssetSignal(
    CRYPTO_PERP_SPEC,
    dailyCloses,
    null,
    { vix: null, hyOas: null },
  );
  if (Number.isFinite(mark)) signal.price = mark;

  const { interpretations, bias_note } = interpretCryptoPanel({
    signal,
    indicators: panelIndicators,
  });

  const recent = btc_chart.slice(-48);
  const support = recent.length
    ? Math.min(...recent.map((c) => c.low))
    : null;
  const resistance = recent.length
    ? Math.max(...recent.map((c) => c.high))
    : null;

  const strategy = buildPlaybook({
    signal,
    bias_note,
    mark: Number.isFinite(mark) ? mark : null,
    ls: ls_ratio,
    fundingPct,
    oiChg: oi_chg_24h_pct,
    fear: fearLatest,
    kimchiBtc,
    support,
    resistance,
  });

  const ok = assets.length > 0 || btc_chart.length > 0;
  return {
    ok,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    source: `CoinGecko · Upbit · OKX BTC-USDT-SWAP · Yahoo · alternative.me · ${assets.length} assets`,
    schedule_note: CRYPTO_SCHEDULE_NOTE,
    note:
      "주요 코인 시세와 함께 BTC 선물 OI·롱숏비율·펀딩·테이커/호가, " +
      "김치·도미넌스·Fear&Greed, 그리고 OKX 1H 라이브 차트 기반 룰 매매 시나리오를 제공합니다.",
    usdkrw,
    assets,
    kimchi,
    indicators,
    fear_greed,
    interpretations,
    futures,
    btc_chart,
    btc_chart_interval: "1H",
    strategy,
    error: ok ? undefined : "가상자산 데이터 로드 실패",
  };
}

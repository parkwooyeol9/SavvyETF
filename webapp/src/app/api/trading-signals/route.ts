import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  ALL_SIGNAL_SPECS,
  CORE_SPECS,
  CRYPTO_PERP_SPEC,
  SECTOR_SPECS,
  SIGNAL_DISCLAIMER,
  SIGNAL_METHODOLOGY,
  SIGNAL_SCHEDULE_NOTE,
  THEME_SPECS,
  buildAssetSignal,
  buildRiskRegime,
  buildSummary,
  pctChange,
  type CryptoIndicator,
  type CryptoPanel,
  type SignalPoint,
  type TradingSignalsPayload,
} from "@/lib/tradingSignals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const OKX_SWAP = "BTC-USDT-SWAP";

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

async function fetchYahooSeries(
  symbol: string,
  range = "1y",
): Promise<SignalPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 180 },
  });
  if (!res.ok) return [];
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series: SignalPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    series.push({
      date: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
      value: close,
    });
  }
  return series;
}

async function fetchFredLast(seriesId: string): Promise<number | null> {
  const end = new Date();
  const start = new Date(end.getTime() - 120 * 86_400_000);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${start.toISOString().slice(0, 10)}&coed=${end.toISOString().slice(0, 10)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/csv" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).slice(1);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      const comma = line.indexOf(",");
      if (comma < 0) continue;
      const raw = line.slice(comma + 1).trim();
      if (!raw || raw === ".") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchOkxJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://www.okx.com${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchBtcPerpCandles(): Promise<SignalPoint[]> {
  const payload = await fetchOkxJson<{
    code?: string;
    data?: string[][];
  }>(`/api/v5/market/candles?instId=${OKX_SWAP}&bar=1D&limit=120`);
  if (!payload?.data?.length) {
    // fallback: Yahoo BTC-USD spot (not perp, but usable for trend)
    return fetchYahooSeries("BTC-USD", "6mo");
  }
  // OKX returns newest first
  const series: SignalPoint[] = [];
  for (const row of [...payload.data].reverse()) {
    const ts = Number(row[0]);
    const close = Number(row[4]);
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    series.push({
      date: new Date(ts).toISOString().slice(0, 10),
      value: close,
    });
  }
  return series;
}

function toneFrom(n: number | null, invert = false): "up" | "down" | "flat" {
  if (n == null || Math.abs(n) < 1e-9) return "flat";
  const positive = n > 0;
  if (invert) return positive ? "down" : "up";
  return positive ? "up" : "down";
}

function fmtUsdCompact(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

async function buildCryptoPanel(macro: {
  vix: number | null;
  hyOas: number | null;
}): Promise<CryptoPanel> {
  const [
    candles,
    funding,
    oi,
    ticker,
    lsRatio,
    takerVol,
    books,
    global,
    derivatives,
  ] = await Promise.all([
    fetchBtcPerpCandles(),
    fetchOkxJson<{
      data?: Array<{ fundingRate?: string; fundingTime?: string }>;
    }>(`/api/v5/public/funding-rate?instId=${OKX_SWAP}`),
    fetchOkxJson<{ data?: Array<{ oiUsd?: string; oiCcy?: string }> }>(
      `/api/v5/public/open-interest?instType=SWAP&instId=${OKX_SWAP}`,
    ),
    fetchOkxJson<{
      data?: Array<{
        last?: string;
        volCcy24h?: string;
        vol24h?: string;
        open24h?: string;
      }>;
    }>(`/api/v5/market/ticker?instId=${OKX_SWAP}`),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1D`,
    ),
    fetchOkxJson<{ data?: string[][] }>(
      `/api/v5/rubik/stat/taker-volume?ccy=BTC&instType=CONTRACTS&period=1D`,
    ),
    fetchOkxJson<{ data?: Array<{ bids?: string[][]; asks?: string[][] }> }>(
      `/api/v5/market/books?instId=${OKX_SWAP}&sz=10`,
    ),
    fetch("https://api.coingecko.com/api/v3/global", {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 300 },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as Promise<{
      data?: {
        market_cap_percentage?: Record<string, number>;
        total_market_cap?: { usd?: number };
        total_volume?: { usd?: number };
      };
    } | null>,
    fetch("https://api.coingecko.com/api/v3/derivatives", {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 300 },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as Promise<
      | Array<{
          market?: string;
          symbol?: string;
          funding_rate?: number;
          open_interest?: number;
          volume_24h?: number;
          price?: string;
        }>
      | null
    >,
  ]);

  const signal = buildAssetSignal(CRYPTO_PERP_SPEC, candles, null, macro);

  const mark = Number(ticker?.data?.[0]?.last);
  if (Number.isFinite(mark)) signal.price = mark;

  const fundingRate = Number(funding?.data?.[0]?.fundingRate);
  const oiUsd = Number(oi?.data?.[0]?.oiUsd);
  const volCcy24h = Number(ticker?.data?.[0]?.volCcy24h); // BTC
  const open24h = Number(ticker?.data?.[0]?.open24h);
  const chg24 =
    Number.isFinite(mark) && Number.isFinite(open24h) && open24h
      ? ((mark / open24h - 1) * 100)
      : null;

  // OKX long/short: [[ts, ratio], ...] newest first-ish; ratio = long/short accounts
  const lsLatest = lsRatio?.data?.[0];
  const lsPrev = lsRatio?.data?.[1];
  const longShortRatio = lsLatest ? Number(lsLatest[1]) : null;
  const longShortPrev = lsPrev ? Number(lsPrev[1]) : null;
  const longShortChg =
    longShortRatio != null && longShortPrev != null
      ? longShortRatio - longShortPrev
      : null;
  // Convert ratio L/S to long% approx: long = r/(1+r)
  const longPct =
    longShortRatio != null && longShortRatio > 0
      ? (longShortRatio / (1 + longShortRatio)) * 100
      : null;

  // Taker volume: [[ts, buyUsd, sellUsd], ...]
  const takerLatest = takerVol?.data?.[0];
  const takerBuy = takerLatest ? Number(takerLatest[1]) : null;
  const takerSell = takerLatest ? Number(takerLatest[2]) : null;
  const takerImbalance =
    takerBuy != null &&
    takerSell != null &&
    takerBuy + takerSell > 0
      ? ((takerBuy - takerSell) / (takerBuy + takerSell)) * 100
      : null;

  const book = books?.data?.[0];
  let bookImbalance: number | null = null;
  if (book?.bids?.length && book?.asks?.length) {
    const bidQty = book.bids
      .slice(0, 10)
      .reduce((s, row) => s + Number(row[1] || 0), 0);
    const askQty = book.asks
      .slice(0, 10)
      .reduce((s, row) => s + Number(row[1] || 0), 0);
    if (bidQty + askQty > 0) {
      bookImbalance = ((bidQty - askQty) / (bidQty + askQty)) * 100;
    }
  }

  const mcapPct = global?.data?.market_cap_percentage || {};
  const usdtDom = mcapPct.usdt ?? null;
  const btcDom = mcapPct.btc ?? null;
  const totalMcap = global?.data?.total_market_cap?.usd ?? null;
  const totalVol = global?.data?.total_volume?.usd ?? null;
  const cryptoLiquidity =
    totalMcap && totalVol && totalMcap > 0 ? (totalVol / totalMcap) * 100 : null;

  const binanceDeriv = Array.isArray(derivatives)
    ? derivatives.find(
        (d) =>
          d.symbol === "BTCUSDT" &&
          String(d.market || "").includes("Binance"),
      )
    : null;

  const indicators: CryptoIndicator[] = [
    {
      id: "price",
      label: "BTCUSDT.P Mark",
      value: Number.isFinite(mark) ? mark : signal.price,
      display: Number.isFinite(mark)
        ? `$${mark.toLocaleString(undefined, { maximumFractionDigits: 1 })}`
        : signal.price != null
          ? `$${signal.price.toLocaleString(undefined, { maximumFractionDigits: 1 })}`
          : "—",
      note: chg24 != null ? `24h ${chg24 >= 0 ? "+" : ""}${chg24.toFixed(2)}%` : "OKX SWAP",
      tone: toneFrom(chg24),
    },
    {
      id: "usdt_dom",
      label: "USDT Dominance",
      value: usdtDom,
      display: usdtDom != null ? `${usdtDom.toFixed(2)}%` : "—",
      note: "CoinGecko · 스테이블 비중↑ = 위험회피/대기자금",
      tone: "flat",
    },
    {
      id: "btc_dom",
      label: "BTC Dominance",
      value: btcDom,
      display: btcDom != null ? `${btcDom.toFixed(2)}%` : "—",
      note: "알트 대비 BTC 비중",
      tone: "flat",
    },
    {
      id: "ls_ratio",
      label: "BTC Perp L/S Ratio",
      value: longShortRatio,
      display:
        longShortRatio != null
          ? `${longShortRatio.toFixed(2)} (Long ${longPct?.toFixed(1) ?? "—"}%)`
          : "—",
      note:
        longShortChg != null
          ? `1D Δ ${longShortChg >= 0 ? "+" : ""}${longShortChg.toFixed(2)} · OKX 계정 수 비율`
          : "OKX long/short account ratio",
      tone: toneFrom(longShortChg),
    },
    {
      id: "funding",
      label: "Funding Rate",
      value: Number.isFinite(fundingRate) ? fundingRate * 100 : null,
      display: Number.isFinite(fundingRate)
        ? `${(fundingRate * 100).toFixed(4)}%`
        : "—",
      note: "OKX 현재 펀딩 · +면 롱 과열 편향",
      tone: toneFrom(
        Number.isFinite(fundingRate) ? fundingRate : null,
        false,
      ),
    },
    {
      id: "oi",
      label: "Open Interest",
      value: Number.isFinite(oiUsd) ? oiUsd : null,
      display: fmtUsdCompact(Number.isFinite(oiUsd) ? oiUsd : null),
      note: "OKX BTC-USDT-SWAP OI (USD)",
      tone: "flat",
    },
    {
      id: "vol24",
      label: "Perp 24h Volume",
      value: Number.isFinite(volCcy24h) ? volCcy24h : null,
      display: Number.isFinite(volCcy24h)
        ? `${volCcy24h.toFixed(0)} BTC`
        : "—",
      note: "OKX 베이스 자산 거래량",
      tone: "flat",
    },
    {
      id: "liquidity",
      label: "Crypto Liquidity",
      value: cryptoLiquidity,
      display: cryptoLiquidity != null ? `${cryptoLiquidity.toFixed(2)}%` : "—",
      note: "글로벌 24h Vol / Mcap (CoinGecko)",
      tone: "flat",
    },
    {
      id: "book",
      label: "Book Imbalance",
      value: bookImbalance,
      display: bookImbalance != null ? `${bookImbalance.toFixed(1)}%` : "—",
      note: "OKX top10 bid−ask 수량 불균형 · +면 매수벽",
      tone: toneFrom(bookImbalance),
    },
    {
      id: "taker",
      label: "Taker Buy/Sell",
      value: takerImbalance,
      display: takerImbalance != null ? `${takerImbalance.toFixed(1)}%` : "—",
      note: "OKX 계약 taker 매수−매도 불균형",
      tone: toneFrom(takerImbalance),
    },
  ];

  if (binanceDeriv?.open_interest != null) {
    indicators.push({
      id: "bn_oi",
      label: "Binance BTCUSDT OI",
      value: binanceDeriv.open_interest,
      display: fmtUsdCompact(binanceDeriv.open_interest),
      note: `CoinGecko agg · funding ${(binanceDeriv.funding_rate ?? 0).toFixed(4)}%`,
      tone: "flat",
    });
  }

  const as_of =
    candles.length > 0
      ? candles[candles.length - 1]!.date
      : new Date().toISOString().slice(0, 10);

  // Enrich drivers with crypto-specific context
  if (usdtDom != null && usdtDom >= 7.5) {
    signal.drivers = [`USDT.D ${usdtDom.toFixed(2)}% (대기자금)`, ...signal.drivers].slice(0, 3);
  }
  if (longShortRatio != null && longShortRatio >= 2.0) {
    signal.drivers = [
      `L/S ${longShortRatio.toFixed(2)} (롱 과밀)`,
      ...signal.drivers,
    ].slice(0, 3);
  } else if (longShortRatio != null && longShortRatio <= 0.9) {
    signal.drivers = [
      `L/S ${longShortRatio.toFixed(2)} (숏 우세)`,
      ...signal.drivers,
    ].slice(0, 3);
  }

  return {
    symbol: "BTCUSDT.P",
    label: "BTCUSDT Perpetual",
    source_note:
      "가격·펀딩·OI·L/S·호가: OKX BTC-USDT-SWAP · 도미넌스/유동성: CoinGecko · (Binance 직접 API는 일부 지역 차단 → 퍼프 프록시로 OKX 사용)",
    signal,
    indicators,
    as_of,
  };
}

async function buildPayload(): Promise<TradingSignalsPayload> {
  const generated_at = new Date().toISOString();
  const symbols = Array.from(
    new Set(["^VIX", ...ALL_SIGNAL_SPECS.map((s) => s.symbol)]),
  );

  const seriesEntries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const series = await fetchYahooSeries(symbol, "1y");
        return [symbol, series] as const;
      } catch {
        return [symbol, [] as SignalPoint[]] as const;
      }
    }),
  );
  const seriesMap = new Map(seriesEntries);

  const [vixFred, hyFred] = await Promise.all([
    fetchFredLast("VIXCLS"),
    fetchFredLast("BAMLH0A0HYM2"),
  ]);

  const vixSeries = seriesMap.get("^VIX") || [];
  const vix =
    vixFred ??
    (vixSeries.length ? vixSeries[vixSeries.length - 1]!.value : null);
  const hyOas = hyFred;
  const macro = { vix, hyOas };

  const spySeries = seriesMap.get("SPY") || [];
  const spy20d = pctChange(spySeries, 20);

  const core = CORE_SPECS.map((spec) =>
    buildAssetSignal(spec, seriesMap.get(spec.symbol) || [], spy20d, macro),
  );
  const sectors = SECTOR_SPECS.map((spec) =>
    buildAssetSignal(spec, seriesMap.get(spec.symbol) || [], spy20d, macro),
  ).sort(
    (a, b) => (b.excess_20d_vs_spy ?? -999) - (a.excess_20d_vs_spy ?? -999),
  );
  const themes = THEME_SPECS.map((spec) =>
    buildAssetSignal(spec, seriesMap.get(spec.symbol) || [], spy20d, macro),
  ).sort(
    (a, b) => (b.excess_20d_vs_spy ?? -999) - (a.excess_20d_vs_spy ?? -999),
  );

  const crypto = await buildCryptoPanel(macro);

  const risk = buildRiskRegime({
    vix,
    hyOas,
    spy20d,
    sectorSignals: sectors,
  });
  const summary = buildSummary({
    risk,
    core,
    sectors,
    themes,
    crypto: crypto.signal,
  });

  const as_of =
    spySeries.length > 0
      ? spySeries[spySeries.length - 1]!.date
      : core.find((c) => c.price != null)?.price != null
        ? generated_at.slice(0, 10)
        : null;

  return {
    ok: true,
    generated_at,
    as_of,
    note: "Yahoo 일봉 + FRED(VIX/HY) + OKX/CoinGecko 크립토",
    schedule_note: SIGNAL_SCHEDULE_NOTE,
    disclaimer: SIGNAL_DISCLAIMER,
    methodology: SIGNAL_METHODOLOGY,
    risk,
    summary,
    core,
    sectors,
    themes,
    crypto,
  };
}

export async function GET() {
  try {
    const payload = await withServerCache(
      "trading-signals:v2-crypto",
      120_000,
      600_000,
      () => buildPayload(),
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        as_of: null,
        note: "",
        schedule_note: SIGNAL_SCHEDULE_NOTE,
        disclaimer: SIGNAL_DISCLAIMER,
        methodology: SIGNAL_METHODOLOGY,
        risk: {
          score: 0,
          regime: "Calm",
          regime_ko: "안정",
          drivers: [message],
          vix: null,
          hy_oas: null,
          spy_20d_pct: null,
          breadth_above_sma20: null,
        },
        summary: [],
        core: [],
        sectors: [],
        themes: [],
        crypto: null,
        error: message,
      } satisfies TradingSignalsPayload,
      { status: 502 },
    );
  }
}

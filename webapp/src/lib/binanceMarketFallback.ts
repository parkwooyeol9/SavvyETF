/**
 * Binance fapi is geo-blocked from Vercel (US) — HTTP 451.
 * Paper signals use Yahoo Finance / CoinGecko as public fallbacks (no API keys).
 */

import type { SignalPoint } from "@/lib/tradingSignals";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

/** Binance USDT-M symbol → Yahoo chart symbol */
export const YAHOO_SYMBOL_BY_BINANCE: Record<string, string> = {
  BTCUSDT: "BTC-USD",
  ETHUSDT: "ETH-USD",
  XAUUSDT: "GC=F",
  XAGUSDT: "SI=F",
  EWYUSDT: "EWY",
  MUUSDT: "MU",
};

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

export async function fetchYahooCandles(
  yahooSymbol: string,
  count = 120,
): Promise<SignalPoint[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - count * 86400 - 86400 * 5;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as YahooChart;
    const result = json.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const out: SignalPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = closes[i];
      if (close == null || !(close > 0)) continue;
      out.push({
        date: new Date((ts[i] as number) * 1000).toISOString().slice(0, 10),
        value: close,
      });
    }
    return out.slice(-count);
  } catch {
    return [];
  }
}

export async function fetchYahooPrices(
  binanceSymbols: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(
    binanceSymbols.map(async (sym) => {
      const yahoo = YAHOO_SYMBOL_BY_BINANCE[sym];
      if (!yahoo) return;
      const candles = await fetchYahooCandles(yahoo, 5);
      const last = candles[candles.length - 1]?.value;
      if (last != null && last > 0) out.set(sym, last);
    }),
  );
  return out;
}

export async function fetchCoingeckoBtcUsd(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { bitcoin?: { usd?: number } };
    const px = json.bitcoin?.usd;
    return px != null && px > 0 ? px : null;
  } catch {
    return null;
  }
}

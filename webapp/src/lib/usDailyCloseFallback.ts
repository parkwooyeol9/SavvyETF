/**
 * After the US regular close, Yahoo 1d bars often leave today's close null.
 * Fill that session from Finnhub (candles, then quote), then Stooq.
 */

import {
  expectedLatestUsDailyDate,
  isUsListedSymbol,
  unixToEtYmd,
} from "@/lib/usEquitySession";

export type DailyClosePoint = { date: string; close: number };

export type CloseFillSource = "yahoo" | "finnhub" | "stooq" | "yahoo-quote";

export type CloseFillResult = {
  points: DailyClosePoint[];
  source: CloseFillSource;
  as_of: string | null;
  filled: boolean;
};

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const FILL_CACHE_MS = 120_000;

type CachedFill = {
  expires: number;
  date: string;
  close: number;
  source: Exclude<CloseFillSource, "yahoo">;
};

const fillCache = new Map<string, CachedFill>();
const inflight = new Map<string, Promise<CachedFill | null>>();

let finnhubChain: Promise<void> = Promise.resolve();

function finnhubKey(): string {
  return (process.env.FINNHUB_API_KEY || "").trim();
}

function toFinnhubSymbol(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  if (raw === "^VIX") return "VIX";
  if (raw.startsWith("^")) return raw;
  return raw.replace(/-/g, ".");
}

function toStooqSymbol(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  if (raw === "^VIX") return "^vix";
  if (raw.startsWith("^")) return raw.toLowerCase();
  return `${raw.replace(/\./g, "-").toLowerCase()}.us`;
}

function enqueueFinnhub<T>(fn: () => Promise<T>): Promise<T> {
  const run = finnhubChain.then(fn, fn);
  finnhubChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function finnhubGet(path: string, params: Record<string, string>): Promise<unknown> {
  const token = finnhubKey();
  if (!token) return null;
  const qs = new URLSearchParams({ ...params, token });
  const url = `${FINNHUB_BASE}/${path}?${qs}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  return res.json();
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function finnhubDailyClose(
  ticker: string,
  expected: string,
): Promise<{ date: string; close: number } | null> {
  return enqueueFinnhub(async () => {
    const symbol = toFinnhubSymbol(ticker);

    const quote = (await finnhubGet("quote", { symbol })) as {
      c?: number;
      t?: number;
    } | null;
    const quoteClose = num(quote?.c);
    const quoteTs = typeof quote?.t === "number" ? quote.t : 0;
    if (quoteClose != null && quoteTs > 0 && unixToEtYmd(quoteTs) === expected) {
      return { date: expected, close: quoteClose };
    }

    const to = Math.floor(Date.now() / 1000);
    const from = to - 21 * 86_400;
    const candle = (await finnhubGet("stock/candle", {
      symbol,
      resolution: "D",
      from: String(from),
      to: String(to),
    })) as { s?: string; t?: number[]; c?: Array<number | null> } | null;

    if (candle?.s !== "ok") return null;
    const ts = candle.t || [];
    const closes = candle.c || [];
    for (let i = ts.length - 1; i >= 0; i--) {
      const close = num(closes[i]);
      if (close == null) continue;
      const date = unixToEtYmd(ts[i]!);
      if (date === expected) return { date, close };
      if (date < expected) break;
    }
    return null;
  });
}

async function stooqDailyClose(
  ticker: string,
  expected: string,
): Promise<{ date: string; close: number } | null> {
  const symbol = toStooqSymbol(ticker);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/csv,text/plain,*/*",
        "User-Agent": UA,
        Referer: "https://stooq.com/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.startsWith("Date") && !text.includes("\n")) return null;
    const lines = text.trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 1; i--) {
      const [date, , , , closeRaw] = lines[i]!.split(",");
      const close = num(closeRaw);
      if (!date || close == null) continue;
      if (date === expected) return { date, close };
      if (date < expected) return null;
    }
  } catch {
    return null;
  }
  return null;
}

async function lookupFallbackClose(
  ticker: string,
  expected: string,
): Promise<CachedFill | null> {
  const cacheKey = `${ticker.toUpperCase()}:${expected}`;
  const hit = fillCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit;

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const run = (async (): Promise<CachedFill | null> => {
    const finnhub = finnhubKey() ? await finnhubDailyClose(ticker, expected) : null;
    const picked = finnhub
      ? { ...finnhub, source: "finnhub" as const }
      : await stooqDailyClose(ticker, expected).then((row) =>
          row ? { ...row, source: "stooq" as const } : null,
        );
    if (!picked) return null;
    const cached: CachedFill = {
      expires: Date.now() + FILL_CACHE_MS,
      date: picked.date,
      close: picked.close,
      source: picked.source,
    };
    fillCache.set(cacheKey, cached);
    return cached;
  })().finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, run);
  return run;
}

export async function fillUsSessionCloseIfNeeded(
  symbol: string,
  points: DailyClosePoint[],
  opts?: { endDate?: string; sessionQuote?: DailyClosePoint | null },
): Promise<CloseFillResult> {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted[sorted.length - 1];
  const yahooAsOf = last?.date ?? null;

  if (!isUsListedSymbol(symbol)) {
    return { points: sorted, source: "yahoo", as_of: yahooAsOf, filled: false };
  }

  const expected = expectedLatestUsDailyDate();
  const endDate = opts?.endDate;
  if (
    !expected ||
    (endDate && expected > endDate) ||
    (last && last.date >= expected)
  ) {
    return { points: sorted, source: "yahoo", as_of: last?.date ?? expected, filled: false };
  }

  const filled = await lookupFallbackClose(symbol, expected);
  const quote = opts?.sessionQuote;
  const picked =
    filled ??
    (quote && quote.date === expected && quote.close > 0
      ? { date: quote.date, close: quote.close, source: "yahoo-quote" as const, expires: 0 }
      : null);
  if (!picked) {
    return { points: sorted, source: "yahoo", as_of: yahooAsOf, filled: false };
  }

  const next = sorted.filter((p) => p.date !== picked.date);
  next.push({ date: picked.date, close: picked.close });
  next.sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    points: next,
    source: picked.source,
    as_of: picked.date,
    filled: true,
  };
}

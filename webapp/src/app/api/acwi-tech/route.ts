import { NextResponse } from "next/server";

import factsFile from "@/data/acwiTechFacts.json";
import universeFile from "@/data/acwiYahooUniverse.json";
import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  acwiCountries,
  acwiSectors,
  findAcwiRow,
  pickAcwiMajors,
  sliceAcwiSeries,
  type AcwiTechBoard,
  type AcwiTechFacts,
  type AcwiTechLookup,
  type AcwiTechRow,
  type AcwiUniverseRow,
} from "@/lib/acwiTech";
import type { GsPoint } from "@/lib/gsQuant";
import { r2GetObjectText } from "@/lib/r2";
import {
  buildQuantSnapshot,
  lookupQuantSpec,
  parseQuantRange,
  parseQuantTicker,
  type QuantAssetSpec,
  type QuantRange,
} from "@/lib/quantDesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";
const R2_KEY = "acwi_px/latest.json";
const UNIVERSE = (universeFile.rows || []) as AcwiUniverseRow[];
const FACTS_AS_OF = factsFile.as_of || null;
const FACTS = factsFile.rows as Record<string, AcwiTechFacts>;

function factsFor(ric: string | undefined): AcwiTechFacts | null {
  if (!ric) return null;
  const row = FACTS[ric];
  return row && Object.keys(row).length ? row : null;
}
const COUNTRIES = acwiCountries(UNIVERSE);
const SECTORS = acwiSectors(UNIVERSE);

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

type StoredSeries = Record<string, Array<[string, number]>>;

async function loadStored(): Promise<{ as_of: string | null; series: StoredSeries } | null> {
  const text = await r2GetObjectText(R2_KEY);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { as_of?: string | null; series?: StoredSeries };
    if (!parsed.series || typeof parsed.series !== "object") return null;
    return { as_of: parsed.as_of ?? null, series: parsed.series };
  } catch {
    return null;
  }
}

function storedPoints(series: StoredSeries, yahoo: string): GsPoint[] | null {
  const rows = series[yahoo];
  if (!rows?.length) return null;
  const points: GsPoint[] = [];
  for (const row of rows) {
    const date = row?.[0];
    const value = row?.[1];
    if (!date || !(value > 0)) continue;
    points.push({ date, value });
  }
  return points.length ? points : null;
}

async function fetchYahoo(symbol: string, range: QuantRange): Promise<GsPoint[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series: GsPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || !(close > 0)) continue;
    series.push({
      date: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
      value: close,
    });
  }
  return series;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

function specFor(row: AcwiUniverseRow): QuantAssetSpec {
  const base = lookupQuantSpec(row.yahoo, row.name);
  return {
    ...base,
    label: `${row.name} (${base.short.includes(".") ? row.yahoo.replace(/\.[A-Z0-9]+$/i, "") : base.short})`,
    short: row.yahoo.replace(/\.[A-Z0-9]+$/i, ""),
    group: "주식",
    from: `ACWI · ${row.country} · ${row.sector}`,
  };
}

async function seriesFor(
  yahoo: string,
  range: QuantRange,
  stored: StoredSeries | null,
): Promise<GsPoint[]> {
  const cached = stored ? storedPoints(stored, yahoo) : null;
  if (cached) return sliceAcwiSeries(cached, range);
  return fetchYahoo(yahoo, range);
}

async function buildBoard(country: string, sector: string, range: QuantRange): Promise<AcwiTechBoard> {
  const picked = pickAcwiMajors(UNIVERSE, country, sector);
  const stored = await loadStored();
  const spy = await seriesFor("SPY", range, stored?.series ?? null);
  const snaps = await mapPool(picked, 6, async (row) => {
    const prices = await seriesFor(row.yahoo, range, stored?.series ?? null);
    if (prices.length < 30) return null;
    return buildQuantSnapshot(specFor(row), prices, null, spy.length ? spy : null);
  });
  const rows: AcwiTechRow[] = picked.map((row, i) => ({
    ric: row.ric,
    yahoo: row.yahoo,
    name: row.name,
    country: row.country,
    sector: row.sector,
    weight: row.weight,
    snapshot: snaps[i] ?? null,
    facts: factsFor(row.ric),
  }));
  return {
    ok: true,
    source: stored ? "Yahoo Finance · 06:30 KST 갱신" : "Yahoo Finance",
    as_of: stored?.as_of ?? null,
    country,
    sector,
    range,
    countries: COUNTRIES,
    country_chips: COUNTRIES.slice(0, 12),
    sectors: SECTORS,
    rows,
    facts_as_of: FACTS_AS_OF,
    note: "고른 국가·업종에서 ACWI 비중이 큰 종목만 펼칩니다. 행을 누르거나 티커를 넣으면 그 종목의 볼린저, 낙폭, RSI와 매수·관망·매도 코멘트가 열립니다.",
  };
}

async function buildLookup(raw: string, range: QuantRange): Promise<AcwiTechLookup> {
  const ticker = parseQuantTicker(raw);
  if (!ticker) return { ok: true, snapshot: null, facts: null, facts_as_of: FACTS_AS_OF, error: "티커 형식이 아닙니다." };
  const row = findAcwiRow(UNIVERSE, ticker) || findAcwiRow(UNIVERSE, raw);
  const yahoo = row?.yahoo || ticker;
  const stored = await loadStored();
  const [prices, spy] = await Promise.all([
    seriesFor(yahoo, range, stored?.series ?? null),
    seriesFor("SPY", range, stored?.series ?? null),
  ]);
  if (prices.length < 30) {
    return { ok: true, snapshot: null, facts: factsFor(row?.ric), facts_as_of: FACTS_AS_OF, error: `${yahoo} 시세를 가져오지 못했습니다.` };
  }
  const spec = row
    ? specFor(row)
    : { ...lookupQuantSpec(yahoo), from: "직접 입력" };
  return {
    ok: true,
    snapshot: buildQuantSnapshot(spec, prices, null, spy.length ? spy : null),
    facts: factsFor(row?.ric),
    facts_as_of: FACTS_AS_OF,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const range = parseQuantRange(url.searchParams.get("range"));
  const ticker = (url.searchParams.get("ticker") || "").trim();
  try {
    if (ticker) {
      const body = await withServerCache(`acwi-tech:t:${ticker}:${range}`, 90_000, 10 * 60_000, () =>
        buildLookup(ticker, range),
      );
      return NextResponse.json(body, {
        headers: { "Cache-Control": cdnCacheHeader("yahoo") },
      });
    }
    const country = url.searchParams.get("country") || "미국";
    const sector = url.searchParams.get("sector") || "전체";
    const safeCountry = country === "전체" || COUNTRIES.includes(country) ? country : "미국";
    const safeSector = sector === "전체" || SECTORS.includes(sector) ? sector : "전체";
    const body = await withServerCache(
      `acwi-tech:${safeCountry}:${safeSector}:${range}`,
      3 * 60_000,
      20 * 60_000,
      () => buildBoard(safeCountry, safeSector, range),
    );
    return NextResponse.json(body, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "read failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

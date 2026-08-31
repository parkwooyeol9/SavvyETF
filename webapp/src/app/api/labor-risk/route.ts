import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  COMPANY_BY_ID,
  LABOR_COMPANIES,
  LABOR_EVENTS,
  LABOR_HORIZONS,
  LABOR_NOTE,
  STAGE_META,
  buildDifferentiationNarrative,
  buildOverallNarrative,
  companyStats,
  isoTodayKst,
  stageStats,
  windowReturn,
  type LaborEventResult,
  type LaborRiskPayload,
  type PricePoint,
} from "@/lib/laborRisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const SERIES_START = "2018-01-01";

function todayIso(): string {
  return isoTodayKst();
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function fetchYahooDaily(symbol: string): Promise<PricePoint[]> {
  const period1 = Math.floor(Date.parse(`${SERIES_START}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  const url =
    `${YAHOO_CHART}/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=div%7Csplit`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{ close?: Array<number | null> }>;
          adjclose?: Array<{ adjclose?: Array<number | null> }>;
        };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const adj = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const map = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i++) {
    const px = adj[i] ?? closes[i];
    if (px == null || !Number.isFinite(px) || px <= 0) continue;
    const iso = new Date(timestamps[i]! * 1000).toISOString().slice(0, 10);
    map.set(iso, px);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close }));
}

async function fetchNaverDaily(code: string): Promise<PricePoint[]> {
  const end = todayIso().replace(/-/g, "");
  const url =
    `https://fchart.stock.naver.com/siseJson.naver?symbol=${encodeURIComponent(code)}` +
    `&requestType=1&startTime=20180101&endTime=${end}&timeframe=day`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/json",
      Referer: "https://finance.naver.com/",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Naver ${code}: HTTP ${res.status}`);
  const text = await res.text();
  const matches = text.matchAll(
    /\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g,
  );
  const map = new Map<string, number>();
  for (const m of matches) {
    const ymd = m[1]!;
    const close = Number(m[5]);
    if (!Number.isFinite(close) || close <= 0) continue;
    map.set(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`, close);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close }));
}

async function fetchSeries(yahoo: string, naverCode: string): Promise<PricePoint[]> {
  try {
    const yahooPts = await fetchYahooDaily(yahoo);
    if (yahooPts.length >= 40) return yahooPts;
  } catch {
    /* Naver fallback */
  }
  try {
    return await fetchNaverDaily(naverCode);
  } catch {
    return [];
  }
}

function eventTradingMeta(points: PricePoint[], eventIso: string) {
  const t0 = points.find((p) => p.date >= eventIso);
  if (!t0) return {};
  const prior = [...points].reverse().find((p) => p.date < t0.date);
  return {
    trading_date: t0.date,
    prior_date: prior?.date,
    prior_px: prior?.close,
  };
}

function computeEvent(
  ev: (typeof LABOR_EVENTS)[number],
  stock: PricePoint[],
  kospi: PricePoint[],
): LaborEventResult {
  const company = COMPANY_BY_ID[ev.company];
  const meta = eventTradingMeta(stock, ev.date);
  const windows = LABOR_HORIZONS.map((h) => {
    const stockW = windowReturn(stock, ev.date, h);
    const kospiW = windowReturn(kospi, ev.date, h);
    const stockRet = stockW.return_pct;
    const kospiRet = kospiW.return_pct;
    const excess =
      stockRet != null && kospiRet != null && Number.isFinite(stockRet) && Number.isFinite(kospiRet)
        ? stockRet - kospiRet
        : null;
    return {
      horizon: h,
      return_pct: stockRet,
      kospi_pct: kospiRet,
      excess_pct: excess,
      end_date: stockW.end_date,
      truncated: stockW.truncated,
      error: stockW.error,
    };
  });
  return {
    ...ev,
    company_label: company.label,
    ticker: company.ticker,
    event_date: ev.date,
    ...meta,
    windows,
  };
}

async function buildPayload(): Promise<LaborRiskPayload> {
  const specs = [
    { id: "kospi", yahoo: "^KS11", naver: "KOSPI" },
    ...LABOR_COMPANIES.map((c) => ({ id: c.id, yahoo: c.yahoo, naver: c.ticker })),
  ];
  const seriesRows = await mapPool(specs, 4, async (spec) => {
    const points = await withServerCache(
      `labor-risk:series:v1:${spec.id}`,
      6 * 3_600_000,
      12 * 3_600_000,
      () => fetchSeries(spec.yahoo, spec.naver),
    );
    return { id: spec.id, points };
  });
  const series: Record<string, PricePoint[]> = {};
  for (const row of seriesRows) series[row.id] = row.points;
  const kospi = series.kospi || [];

  const events = LABOR_EVENTS.map((ev) =>
    computeEvent(ev, series[ev.company] || [], kospi),
  );
  const stage_stats = stageStats(events);
  const company_stats = companyStats(events);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: "yahoo/naver",
    note: LABOR_NOTE,
    companies: LABOR_COMPANIES,
    stages: STAGE_META.map((s) => ({ id: s.id, label: s.label })),
    events,
    stage_stats,
    company_stats,
    overall_ko: buildOverallNarrative(stage_stats, events),
    differentiation_ko: buildDifferentiationNarrative(company_stats),
  };
}

export async function GET() {
  try {
    const payload = await withServerCache(
      `labor-risk:payload:v1:${todayIso()}`,
      3_600_000,
      6 * 3_600_000,
      buildPayload,
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "노동리스크 분석을 불러오지 못했습니다.",
      } satisfies LaborRiskPayload,
      { status: 502 },
    );
  }
}

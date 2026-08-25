import { NextRequest, NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  attachDriverMoves,
  CATALOG_EPISODES,
  CATEGORY_META,
  DEFAULT_EPISODE_IDS,
  detectTrendEpisodes,
  EPISODE_ASSETS,
  isoTodayKst,
  mergeSuggestions,
  MAX_PERIODS,
  periodReturn,
  SERIES_LOOKBACK_START,
  validatePeriod,
  type EpisodeAssetResult,
  type EpisodePeriod,
  type EventEpisodesPayload,
  type PricePoint,
  type SuggestedEpisode,
} from "@/lib/eventEpisodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

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
  const period1 = Math.floor(Date.parse(`${SERIES_LOOKBACK_START}T00:00:00Z`) / 1000);
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

function naverSymbol(spec: (typeof EPISODE_ASSETS)[number]): string | null {
  if (spec.id === "kospi") return "KOSPI";
  if (spec.id === "kosdaq") return "KOSDAQ";
  if (spec.symbol.endsWith(".KS") || spec.symbol.endsWith(".KQ")) {
    return spec.symbol.slice(0, 6);
  }
  return null;
}

async function fetchNaverDaily(code: string): Promise<PricePoint[]> {
  const end = todayIso().replace(/-/g, "");
  const url =
    `https://fchart.stock.naver.com/siseJson.naver?symbol=${encodeURIComponent(code)}` +
    `&requestType=1&startTime=19960101&endTime=${end}&timeframe=day`;
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

async function fetchAssetSeries(spec: (typeof EPISODE_ASSETS)[number]): Promise<PricePoint[]> {
  try {
    const yahoo = await fetchYahooDaily(spec.symbol);
    if (yahoo.length >= 20) return yahoo;
  } catch {
    /* Naver fallback for KR indices / ETFs */
  }
  const code = naverSymbol(spec);
  if (!code) return [];
  try {
    return await fetchNaverDaily(code);
  } catch {
    return [];
  }
}

async function loadSeriesMap(ids: string[]): Promise<Record<string, PricePoint[]>> {
  const specs = EPISODE_ASSETS.filter((a) => ids.includes(a.id));
  const rows = await mapPool(specs, 5, async (spec) => {
    try {
      const points = await withServerCache(
        `event-episodes:series:v3:${spec.id}`,
        6 * 3_600_000,
        12 * 3_600_000,
        () => fetchAssetSeries(spec),
      );
      return { id: spec.id, points };
    } catch {
      return { id: spec.id, points: [] as PricePoint[] };
    }
  });
  const out: Record<string, PricePoint[]> = {};
  for (const row of rows) out[row.id] = row.points;
  return out;
}

function buildDetected(series: Record<string, PricePoint[]>): SuggestedEpisode[] {
  const fx = series.usdkrw || [];
  const oil = series.wti || [];
  const fxEps = detectTrendEpisodes(fx, {
    thresholdPct: 8,
    minDays: 21,
    maxPerDirection: 4,
    up: { category: "fx_up", labelPrefix: "원달러 상승" },
    down: { category: "fx_down", labelPrefix: "원달러 하락" },
    driverId: "usdkrw",
    driverLabel: "원달러",
  });
  const oilEps = detectTrendEpisodes(oil, {
    thresholdPct: 25,
    minDays: 21,
    maxPerDirection: 4,
    up: { category: "oil_up", labelPrefix: "유가 상승" },
    down: { category: "oil_down", labelPrefix: "유가 하락" },
    driverId: "wti",
    driverLabel: "WTI",
  });
  return [...fxEps, ...oilEps];
}

async function buildSuggestions(): Promise<SuggestedEpisode[]> {
  const series = await loadSeriesMap(["usdkrw", "wti"]);
  const merged = mergeSuggestions(CATALOG_EPISODES, buildDetected(series));
  return attachDriverMoves(merged, series);
}

function computeAssets(
  periods: EpisodePeriod[],
  series: Record<string, PricePoint[]>,
): EpisodeAssetResult[] {
  return EPISODE_ASSETS.map((spec) => {
    const points = series[spec.id] || [];
    const listedFrom = points[0]?.date;
    const returns = periods.map((p) => {
      const ret = periodReturn(points, p.start, p.end);
      return { ...ret, period_id: p.id };
    });
    return { ...spec, listed_from: listedFrom, returns };
  });
}

function parsePeriodsFromQuery(raw: string | null): EpisodePeriod[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Array<{ id?: string; label?: string; start?: string; end?: string }>;
    if (!Array.isArray(parsed)) return null;
    const out: EpisodePeriod[] = [];
    for (let i = 0; i < parsed.length && i < MAX_PERIODS; i++) {
      const v = validatePeriod(parsed[i] || {}, i);
      if (!v.ok) return null;
      out.push(v.period);
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function parsePeriodsFromBody(body: unknown): { ok: true; periods: EpisodePeriod[] } | { ok: false; error: string } {
  const raw = body && typeof body === "object" ? (body as { periods?: unknown }).periods : null;
  if (!Array.isArray(raw) || !raw.length) {
    return { ok: false, error: "periods 배열이 필요합니다." };
  }
  if (raw.length > MAX_PERIODS) {
    return { ok: false, error: `구간은 최대 ${MAX_PERIODS}개까지 비교할 수 있습니다.` };
  }
  const periods: EpisodePeriod[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const v = validatePeriod(
      row && typeof row === "object" ? (row as { id?: string; label?: string; start?: string; end?: string }) : {},
      i,
    );
    if (!v.ok) return v;
    periods.push({
      ...v.period,
      category: row && typeof row === "object" ? (row as EpisodePeriod).category : undefined,
      note: row && typeof row === "object" ? (row as EpisodePeriod).note : undefined,
      source: row && typeof row === "object" && (row as EpisodePeriod).source
        ? (row as EpisodePeriod).source
        : "custom",
    });
  }
  return { ok: true, periods };
}

async function computePayload(periods: EpisodePeriod[]): Promise<EventEpisodesPayload> {
  const series = await loadSeriesMap(EPISODE_ASSETS.map((a) => a.id));
  const assets = computeAssets(periods, series);
  const missingMarkets = assets
    .filter((a) => a.kind === "market" && !a.returns.some((r) => r.return_pct != null))
    .map((a) => a.label);
  return {
    ok: true,
    periods,
    assets,
    source: "yahoo/naver",
    generated_at: new Date().toISOString(),
    note:
      "업종은 KOSPI 200 업종 ETF(TIGER 200·KODEX) 프록시입니다. 공식 업종지수와 추적오차가 있을 수 있습니다." +
      (missingMarkets.length ? ` 시장 데이터 없음: ${missingMarkets.join(", ")}.` : ""),
  };
}

function suggestionsEnvelope(suggestions: SuggestedEpisode[]): EventEpisodesPayload {
  return {
    ok: true,
    suggestions,
    defaults: [...DEFAULT_EPISODE_IDS],
    categories: CATEGORY_META,
    generated_at: new Date().toISOString(),
    note: "카탈로그(과거 사건)와 원달러·WTI 시계열에서 탐지한 추세 구간을 함께 제안합니다.",
  };
}

export async function GET(req: NextRequest) {
  const compute = (req.nextUrl.searchParams.get("compute") || "").trim();
  const queryPeriods = parsePeriodsFromQuery(req.nextUrl.searchParams.get("periods"));

  try {
    const suggestions = await withServerCache(
      `event-episodes:suggest:v3:${todayIso()}`,
      3_600_000,
      6 * 3_600_000,
      buildSuggestions,
    );
    const envelope = suggestionsEnvelope(suggestions);

    let periods: EpisodePeriod[] | null = queryPeriods;
    if (!periods && compute === "defaults") {
      const byId = new Map(suggestions.map((s) => [s.id, s]));
      periods = DEFAULT_EPISODE_IDS.map((id) => byId.get(id)).filter(Boolean) as SuggestedEpisode[];
      if (periods.length < 2) {
        periods = CATALOG_EPISODES.filter((e) =>
          (DEFAULT_EPISODE_IDS as readonly string[]).includes(e.id),
        );
      }
    }

    if (periods?.length) {
      const result = await withServerCache(
        `event-episodes:compute:v2:${periods.map((p) => `${p.start}_${p.end}`).join("|")}`,
        3_600_000,
        6 * 3_600_000,
        () => computePayload(periods!),
      );
      return NextResponse.json(
        { ...envelope, ...result, suggestions, defaults: envelope.defaults },
        { headers: { "Cache-Control": cdnCacheHeader("yahoo") } },
      );
    }

    return NextResponse.json(envelope, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "이벤트 구간을 불러오지 못했습니다.",
      } satisfies EventEpisodesPayload,
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON body required" }, { status: 400 });
  }
  const parsed = parsePeriodsFromBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  try {
    const result = await computePayload(parsed.periods);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "수익률 계산에 실패했습니다.",
      } satisfies EventEpisodesPayload,
      { status: 502 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

import {
  FRED_SERIES_SPECS,
  HYPERSCALER_SPECS,
  MACRO_ASSET_SPECS,
  MACRO_SCHEDULE_NOTE,
  computeMacroStress,
  deltaOver,
  lastValue,
  parseHyperscalerRange,
  parseMacroRange,
  pctChange,
  type HyperscalerRange,
  type HyperscalerSeries,
  type MacroAsset,
  type MacroCalendarEvent,
  type MacroMetric,
  type MacroPayload,
  type MacroPoint,
  type MacroRange,
  type MacroSnapshot,
} from "@/lib/macro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; chartPreviousClose?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

type FredObs = {
  observations?: Array<{ date: string; value: string }>;
};

function fredObservationLimit(range: MacroRange): number {
  switch (range) {
    case "1mo":
      return 45;
    case "3mo":
      return 100;
    case "6mo":
      return 200;
    case "1y":
      return 400;
    default:
      return 100;
  }
}

function downsample(points: MacroPoint[], maxPoints: number): MacroPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

function fredApiKey(): string {
  return (process.env.FRED_API_KEY || "").trim();
}

function finnhubApiKey(): string {
  return (process.env.FINNHUB_API_KEY || "").trim();
}

async function fetchFredSeries(
  seriesId: string,
  limit: number,
): Promise<MacroPoint[]> {
  const apiKey = fredApiKey();
  if (!apiKey) return [];
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": UA },
    next: { revalidate: 1800 },
  });
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const payload = (await res.json()) as FredObs;
  const points: MacroPoint[] = [];
  for (const row of payload.observations || []) {
    if (row.value === "." || row.value === "" || row.value == null) continue;
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    points.push({ date: row.date, value });
  }
  return points.reverse();
}

async function fetchYahooSeries(
  symbol: string,
  range: string,
  maxPoints = 90,
): Promise<{ price: number | null; series: MacroPoint[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 180 },
  });
  if (!res.ok) return { price: null, series: [] };
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result) return { price: null, series: [] };

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series: MacroPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    series.push({
      date: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
      value: close,
    });
  }
  const price =
    result.meta?.regularMarketPrice ??
    (series.length ? series[series.length - 1]!.value : null);
  return { price, series: downsample(series, maxPoints) };
}

function alignSpread(a: MacroPoint[], b: MacroPoint[]): MacroPoint[] {
  const mapB = new Map(b.map((p) => [p.date, p.value]));
  const out: MacroPoint[] = [];
  for (const p of a) {
    const bv = mapB.get(p.date);
    if (bv == null) continue;
    out.push({ date: p.date, value: p.value - bv });
  }
  return out;
}

function ratioSeries(a: MacroPoint[], b: MacroPoint[]): MacroPoint[] {
  const mapB = new Map(b.map((p) => [p.date, p.value]));
  const out: MacroPoint[] = [];
  for (const p of a) {
    const bv = mapB.get(p.date);
    if (bv == null || bv === 0) continue;
    out.push({ date: p.date, value: p.value / bv });
  }
  return out;
}

async function fetchCalendar(): Promise<MacroCalendarEvent[]> {
  const key = finnhubApiKey();
  if (!key) return [];
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 2);
  const to = new Date(today);
  to.setDate(to.getDate() + 7);
  const url = new URL("https://finnhub.io/api/v1/calendar/economic");
  url.searchParams.set("from", from.toISOString().slice(0, 10));
  url.searchParams.set("to", to.toISOString().slice(0, 10));
  url.searchParams.set("token", key);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": UA },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const payload = (await res.json()) as {
      economicCalendar?: Array<Record<string, unknown>>;
    };
    const rows = payload.economicCalendar || [];
    return rows
      .filter((r) => {
        const country = String(r.country || "").toUpperCase();
        const impact = String(r.impact || "").toLowerCase();
        return (
          (country === "US" || country === "UNITED STATES") && impact === "high"
        );
      })
      .slice(0, 18)
      .map((r) => ({
        date: String(r.time || r.date || "").slice(0, 10),
        time: String(r.time || "").includes("T")
          ? String(r.time).slice(11, 16)
          : undefined,
        country: String(r.country || "US"),
        event: String(r.event || r.eventName || "Event"),
        impact: String(r.impact || "high"),
        actual: r.actual != null ? String(r.actual) : null,
        estimate: r.estimate != null ? String(r.estimate) : null,
        prev: r.prev != null ? String(r.prev) : null,
      }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const range = parseMacroRange(req.nextUrl.searchParams.get("range"));
  const hsRange = parseHyperscalerRange(
    req.nextUrl.searchParams.get("hsRange"),
  ) as HyperscalerRange;
  const generated_at = new Date().toISOString();
  const usesFred = Boolean(fredApiKey());
  const fredLimit = fredObservationLimit(range);

  const snapshot: MacroSnapshot = {
    as_of: generated_at,
    DGS3MO: null,
    DGS2: null,
    DGS10: null,
    DGS30: null,
    T10Y2Y: null,
    T10Y3M: null,
    HY_OAS: null,
    IG_OAS: null,
    VIX: null,
    FED_FUNDS: null,
    SOFR: null,
    MOVE: null,
    T5YIE: null,
    T10YIE: null,
    NFCI: null,
    SPY_5D: null,
    SPY_20D: null,
    HYG_TLT_20D: null,
  };

  const seriesMap = new Map<string, MacroPoint[]>();
  const sourceMap = new Map<string, string>();
  const errors: string[] = [];

  await Promise.all(
    FRED_SERIES_SPECS.map(async (spec) => {
      let points: MacroPoint[] = [];
      let source = "FRED";
      try {
        if (usesFred && spec.fredId) {
          points = await fetchFredSeries(spec.fredId, fredLimit);
        }
      } catch (exc) {
        errors.push(
          `${spec.fredId}: ${exc instanceof Error ? exc.message : "FRED fail"}`,
        );
      }
      if (!points.length && spec.yahooSymbol) {
        try {
          const y = await fetchYahooSeries(spec.yahooSymbol, range);
          points = y.series;
          source = "Yahoo";
        } catch (exc) {
          errors.push(
            `${spec.yahooSymbol}: ${exc instanceof Error ? exc.message : "Yahoo fail"}`,
          );
        }
      }
      if (points.length) {
        seriesMap.set(spec.id, downsample(points, 90));
        sourceMap.set(spec.id, source);
        const latest = lastValue(points);
        if (spec.snapshotKey && latest != null) {
          (snapshot as Record<string, string | number | null>)[spec.snapshotKey] =
            latest;
        }
      }
    }),
  );

  const dgs10 = seriesMap.get("dgs10") || [];
  const dgs2 = seriesMap.get("dgs2") || [];
  const dgs3mo = seriesMap.get("dgs3mo") || [];
  if (!seriesMap.get("t10y2y")?.length && dgs10.length && dgs2.length) {
    const spread = alignSpread(dgs10, dgs2);
    if (spread.length) {
      seriesMap.set("t10y2y", downsample(spread, 90));
      sourceMap.set("t10y2y", "derived");
      snapshot.T10Y2Y = lastValue(spread);
    }
  }
  if (!seriesMap.get("t10y3m")?.length && dgs10.length && dgs3mo.length) {
    const spread = alignSpread(dgs10, dgs3mo);
    if (spread.length) {
      seriesMap.set("t10y3m", downsample(spread, 90));
      sourceMap.set("t10y3m", "derived");
      snapshot.T10Y3M = lastValue(spread);
    }
  }

  const [assets, hyperscalers, calendar] = await Promise.all([
    Promise.all(
      MACRO_ASSET_SPECS.map(async (spec): Promise<MacroAsset> => {
        try {
          const { price, series } = await fetchYahooSeries(spec.symbol, range);
          return {
            id: spec.id,
            symbol: spec.symbol,
            label: spec.label,
            group: spec.group,
            thesis: spec.thesis,
            price,
            change_1d_pct: pctChange(series, 1),
            change_5d_pct: pctChange(series, 5),
            change_range_pct:
              series.length >= 2
                ? ((series[series.length - 1]!.value / series[0]!.value - 1) *
                    100)
                : null,
            series,
          };
        } catch (exc) {
          return {
            id: spec.id,
            symbol: spec.symbol,
            label: spec.label,
            group: spec.group,
            thesis: spec.thesis,
            price: null,
            change_1d_pct: null,
            change_5d_pct: null,
            change_range_pct: null,
            error: exc instanceof Error ? exc.message : "fetch fail",
          };
        }
      }),
    ),
    Promise.all(
      HYPERSCALER_SPECS.map(async (spec): Promise<HyperscalerSeries> => {
        try {
          const { price, series } = await fetchYahooSeries(
            spec.symbol,
            hsRange,
            260,
          );
          return {
            id: spec.id,
            symbol: spec.symbol,
            label: spec.label,
            color: spec.color,
            price,
            change_1d_pct: pctChange(series, 1),
            change_range_pct:
              series.length >= 2
                ? ((series[series.length - 1]!.value / series[0]!.value - 1) *
                    100)
                : null,
            series,
          };
        } catch (exc) {
          return {
            id: spec.id,
            symbol: spec.symbol,
            label: spec.label,
            color: spec.color,
            price: null,
            change_1d_pct: null,
            change_range_pct: null,
            series: [],
            error: exc instanceof Error ? exc.message : "fetch fail",
          };
        }
      }),
    ),
    fetchCalendar(),
  ]);

  const spy = assets.find((a) => a.id === "spy");
  const hyg = assets.find((a) => a.id === "hyg");
  const tlt = assets.find((a) => a.id === "tlt");
  if (spy?.series?.length) {
    snapshot.SPY_5D = pctChange(spy.series, 5);
    snapshot.SPY_20D = pctChange(spy.series, 20);
  }
  if (hyg?.series?.length && tlt?.series?.length) {
    const ratio = ratioSeries(hyg.series, tlt.series);
    snapshot.HYG_TLT_20D = pctChange(ratio, 20);
  }

  const metrics: MacroMetric[] = FRED_SERIES_SPECS.map((spec) => {
    const series = seriesMap.get(spec.id) || [];
    return {
      id: spec.id,
      label: spec.label,
      group: spec.group,
      unit: spec.unit,
      value: lastValue(series),
      change_5d: deltaOver(series, 5),
      change_20d: deltaOver(series, 20),
      series,
      source: sourceMap.get(spec.id),
      cadence: spec.cadence,
      note:
        spec.note ||
        (!series.length && (spec.group === "credit" || !spec.yahooSymbol)
          ? "FRED_API_KEY 필요"
          : undefined),
    };
  });

  if (hyg?.series?.length && tlt?.series?.length) {
    const ratio = downsample(ratioSeries(hyg.series, tlt.series), 90);
    metrics.push({
      id: "hyg_tlt",
      label: "HYG / TLT",
      group: "market",
      unit: "index",
      value: lastValue(ratio),
      change_5d: pctChange(ratio, 5),
      change_20d: pctChange(ratio, 20),
      series: ratio,
      source: "Yahoo",
      cadence: "일간",
      note: "리스크 온/오프 비율",
    });
  }

  const stress = computeMacroStress(snapshot);

  const noteParts = [
    usesFred ? "FRED 공식 시계열" : "Yahoo 프록시 (FRED_API_KEY 미설정)",
    finnhubApiKey() ? "Finnhub 캘린더" : null,
    "텔레그램 /macro 와 동일 스트레스 스코어",
  ].filter(Boolean);

  const payload: MacroPayload = {
    ok: true,
    generated_at,
    note: noteParts.join(" · "),
    schedule_note: MACRO_SCHEDULE_NOTE,
    range,
    uses_fred: usesFred,
    snapshot,
    stress,
    yield_curve: [
      { tenor: "3M", value: snapshot.DGS3MO },
      { tenor: "2Y", value: snapshot.DGS2 },
      { tenor: "10Y", value: snapshot.DGS10 },
      { tenor: "30Y", value: snapshot.DGS30 },
    ],
    metrics,
    assets,
    hyperscalers,
    hyperscaler_range: hsRange,
    calendar,
    error: errors.length ? errors.slice(0, 4).join("; ") : undefined,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";

import { fetchBotJson } from "@/lib/bot";
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
      meta?: { regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

function downsample(points: MacroPoint[], maxPoints: number): MacroPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
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

/** Local Yahoo-only fallback when Render bot is cold/unreachable. */
async function buildLocalFallback(
  range: MacroRange,
  hsRange: HyperscalerRange,
): Promise<MacroPayload> {
  const generated_at = new Date().toISOString();
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
  await Promise.all(
    FRED_SERIES_SPECS.map(async (spec) => {
      if (!spec.yahooSymbol) return;
      try {
        const y = await fetchYahooSeries(spec.yahooSymbol, range);
        if (y.series.length) {
          seriesMap.set(spec.id, y.series);
          if (spec.snapshotKey) {
            (snapshot as Record<string, string | number | null>)[
              spec.snapshotKey
            ] = lastValue(y.series);
          }
        }
      } catch {
        /* ignore */
      }
    }),
  );

  const [assets, hyperscalers] = await Promise.all([
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
  ]);

  const spy = assets.find((a) => a.id === "spy");
  const hyg = assets.find((a) => a.id === "hyg");
  const tlt = assets.find((a) => a.id === "tlt");
  if (spy?.series?.length) {
    snapshot.SPY_5D = pctChange(spy.series, 5);
    snapshot.SPY_20D = pctChange(spy.series, 20);
  }
  if (hyg?.series?.length && tlt?.series?.length) {
    snapshot.HYG_TLT_20D = pctChange(ratioSeries(hyg.series, tlt.series), 20);
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
      source: series.length ? "Yahoo" : undefined,
      cadence: spec.cadence,
      note: !series.length
        ? "Render 봇 연결 대기 · FRED 전용 지표"
        : undefined,
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
  const calendar: MacroCalendarEvent[] = [];

  return {
    ok: true,
    generated_at,
    note: "Render 봇 미응답 — Yahoo 로컬 폴백 (FRED/Finnhub는 Render 키 사용)",
    schedule_note: MACRO_SCHEDULE_NOTE,
    range,
    uses_fred: false,
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
    error: "Render /api/web/macro unreachable — showing Yahoo fallback",
  };
}

export async function GET(req: NextRequest) {
  const range = parseMacroRange(req.nextUrl.searchParams.get("range"));
  const hsRange = parseHyperscalerRange(
    req.nextUrl.searchParams.get("hsRange"),
  ) as HyperscalerRange;
  const prefer = req.nextUrl.searchParams.get("prefer") || "render";

  // Primary path: Render bot already has FRED_API_KEY + FINNHUB_API_KEY.
  if (prefer !== "local") {
    try {
      const qs = new URLSearchParams({ range, hsRange });
      const remote = await fetchBotJson<MacroPayload & { ok?: boolean }>(
        `/api/web/macro?${qs}`,
        { timeoutMs: 55_000 },
      );
      if (remote?.ok) {
        return NextResponse.json(
          { ...remote, source: "render" },
          {
            headers: {
              "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
            },
          },
        );
      }
    } catch {
      // fall through to local Yahoo
    }
  }

  const local = await buildLocalFallback(range, hsRange);
  return NextResponse.json(local, {
    status: local.ok ? 200 : 502,
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}

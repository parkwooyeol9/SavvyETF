import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  ALL_SIGNAL_SPECS,
  CORE_SPECS,
  SECTOR_SPECS,
  SIGNAL_DISCLAIMER,
  SIGNAL_SCHEDULE_NOTE,
  THEME_SPECS,
  buildAssetSignal,
  buildRiskRegime,
  buildSummary,
  pctChange,
  type SignalPoint,
  type TradingSignalsPayload,
} from "@/lib/tradingSignals";

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

  const risk = buildRiskRegime({
    vix,
    hyOas,
    spy20d,
    sectorSignals: sectors,
  });
  const summary = buildSummary({ risk, core, sectors, themes });

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
    note: "Yahoo 일봉 + FRED(VIX/HY) · 룰 기반 트레이딩 시그널",
    schedule_note: SIGNAL_SCHEDULE_NOTE,
    disclaimer: SIGNAL_DISCLAIMER,
    risk,
    summary,
    core,
    sectors,
    themes,
  };
}

export async function GET() {
  try {
    const payload = await withServerCache(
      "trading-signals:v1",
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
        error: message,
      } satisfies TradingSignalsPayload,
      { status: 502 },
    );
  }
}

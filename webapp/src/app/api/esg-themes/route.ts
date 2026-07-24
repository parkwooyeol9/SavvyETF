import { NextResponse } from "next/server";

import {
  ESG_THEME_SPECS,
  type EsgThemePoint,
  type EsgThemeSignal,
  type EsgThemesPayload,
} from "@/lib/esgThemes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type ChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

function downsample(points: EsgThemePoint[], maxPoints: number): EsgThemePoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

async function fetchSignal(
  spec: (typeof ESG_THEME_SPECS)[number]["signals"][number],
): Promise<EsgThemeSignal> {
  const base: EsgThemeSignal = {
    id: spec.id,
    symbol: spec.symbol,
    label: spec.label,
    thesis: spec.thesis,
    price: null,
    change_1d_pct: null,
    change_1m_pct: null,
  };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.symbol)}?range=3mo&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 180 },
    });
    if (!res.ok) return { ...base, error: `HTTP ${res.status}` };
    const payload = (await res.json()) as ChartPayload;
    const result = payload.chart?.result?.[0];
    if (!result) return { ...base, error: "no data" };

    const timestamps = result.timestamp || [];
    const rawCloses = result.indicators?.quote?.[0]?.close || [];
    const points: EsgThemePoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = rawCloses[i];
      if (close == null || !Number.isFinite(close)) continue;
      points.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close: Math.round(close * 1000) / 1000,
      });
    }
    if (points.length < 2) return { ...base, error: "no closes" };

    const closes = points.map((p) => p.close);
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const monthAgo = closes.length >= 22 ? closes[closes.length - 22] : closes[0];
    const change_1d_pct =
      prev && prev !== 0 ? Math.round(((last / prev - 1) * 100) * 100) / 100 : null;
    const change_1m_pct =
      monthAgo && monthAgo !== 0
        ? Math.round(((last / monthAgo - 1) * 100) * 100) / 100
        : null;

    return {
      ...base,
      price: last,
      change_1d_pct,
      change_1m_pct,
      series: downsample(points, 60),
    };
  } catch (exc) {
    return {
      ...base,
      error: exc instanceof Error ? exc.message : "fetch failed",
    };
  }
}

export async function GET() {
  try {
    const pillars = await Promise.all(
      ESG_THEME_SPECS.map(async (spec) => {
        const signals = await Promise.all(spec.signals.map((s) => fetchSignal(s)));
        return {
          id: spec.id,
          rank: spec.rank,
          title: spec.title,
          title_en: spec.title_en,
          significance: spec.significance,
          implication: spec.implication,
          implication_ko: spec.implication_ko,
          blurb: spec.blurb,
          signals,
        };
      }),
    );

    const payload: EsgThemesPayload = {
      ok: true,
      generated_at: new Date().toISOString(),
      note: "Yahoo 일봉 프록시. 투자 조언이 아니며 별도 DB 저장 없음.",
      pillars,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        note: "",
        pillars: [],
        error: exc instanceof Error ? exc.message : "esg themes fetch failed",
      } satisfies EsgThemesPayload,
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type RangeKey = "1mo" | "3mo" | "6mo" | "1y" | "5y";

function rangeParam(range: string): RangeKey {
  if (range === "1mo" || range === "3mo" || range === "6mo" || range === "5y") {
    return range;
  }
  return "1y";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = rangeParam(searchParams.get("range") || "1y");
  const symbol = "USDKRW=X";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Yahoo FX HTTP ${res.status}` },
        { status: 502 },
      );
    }
    const payload = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            currency?: string;
          };
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const result = payload.chart?.result?.[0];
    if (!result) {
      return NextResponse.json({ ok: false, error: "No FX data" }, { status: 502 });
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points: Array<{ date: string; close: number }> = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || !Number.isFinite(close)) continue;
      const iso = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      points.push({ date: iso, close: Math.round(close * 100) / 100 });
    }

    if (points.length < 2) {
      return NextResponse.json({ ok: false, error: "Not enough FX bars" }, { status: 502 });
    }

    const last = points[points.length - 1].close;
    const prev = points[points.length - 2].close;
    const first = points[0].close;
    const dayChangePct = prev ? ((last / prev - 1) * 100) : 0;
    const rangeChangePct = first ? ((last / first - 1) * 100) : 0;
    const min = Math.min(...points.map((p) => p.close));
    const max = Math.max(...points.map((p) => p.close));

    // Downsample for chart payload
    const maxPoints = 400;
    const step = Math.max(1, Math.ceil(points.length / maxPoints));
    const series = points.filter((_, i) => i % step === 0 || i === points.length - 1);

    return NextResponse.json({
      ok: true,
      symbol,
      label: "원/달러 (USDKRW)",
      range,
      generated_at: new Date().toISOString(),
      spot: last,
      day_change_pct: Math.round(dayChangePct * 100) / 100,
      range_change_pct: Math.round(rangeChangePct * 100) / 100,
      high: max,
      low: min,
      meta: {
        previous_close: result.meta?.chartPreviousClose ?? prev,
        currency: result.meta?.currency || "KRW",
      },
      series,
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "FX fetch failed",
      },
      { status: 500 },
    );
  }
}

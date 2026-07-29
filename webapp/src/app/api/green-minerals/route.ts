import { NextResponse } from "next/server";

import {
  CRITICAL_LIST_LABELS,
  CRITICAL_LIST_META,
  DUAL_USE_MAP,
  GREEN_MINERALS,
  GREEN_MINERAL_ETF_SPECS,
  GREEN_MINERAL_EVENTS,
  METHODOLOGY_BLOCKS,
  type GreenMineralEtf,
  type GreenMineralHeadline,
  type GreenMineralPayload,
  type GreenMineralPoint,
} from "@/lib/greenMinerals";

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

function downsample(points: GreenMineralPoint[], maxPoints: number): GreenMineralPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

async function fetchEtf(
  spec: (typeof GREEN_MINERAL_ETF_SPECS)[number],
): Promise<GreenMineralEtf> {
  const base: GreenMineralEtf = {
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
    const points: GreenMineralPoint[] = [];
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
    return {
      ...base,
      price: last,
      change_1d_pct:
        prev && prev !== 0
          ? Math.round(((last / prev - 1) * 100) * 100) / 100
          : null,
      change_1m_pct:
        monthAgo && monthAgo !== 0
          ? Math.round(((last / monthAgo - 1) * 100) * 100) / 100
          : null,
      series: downsample(points, 48),
    };
  } catch (exc) {
    return {
      ...base,
      error: exc instanceof Error ? exc.message : "fetch failed",
    };
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchNews(): Promise<GreenMineralHeadline[]> {
  const queries = [
    "critical minerals OR critical raw materials OR export controls gallium OR germanium OR antimony",
    "핵심광물 OR 희토류 OR 리튬 OR 흑연 OR 안티몬 수출통제",
    "mining social licence OR FPIC OR battery recycling OR rare earth",
    "IEA critical minerals OR USGS mineral commodity",
  ];
  const out: GreenMineralHeadline[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    try {
      const url =
        "https://news.google.com/rss/search?" +
        new URLSearchParams({
          q,
          hl: "ko",
          gl: "KR",
          ceid: "KR:ko",
        }).toString();
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/rss+xml, application/xml, text/xml",
        },
        next: { revalidate: 300 },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 4)) {
        const title = decodeXml(
          (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
            item.match(/<title>(.*?)<\/title>/)?.[1] ||
            "").trim(),
        );
        const link = (
          item.match(/<link>(.*?)<\/link>/)?.[1] ||
          item.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/)?.[1] ||
          ""
        ).trim();
        const pub = decodeXml(
          (item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "").trim(),
        );
        const source = decodeXml(
          (item.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || "Google News").trim(),
        );
        const key = title.toLowerCase().replace(/\s+/g, "");
        if (!title || key.length < 8 || seen.has(key)) continue;
        seen.add(key);
        out.push({
          headline: title,
          source,
          published: pub
            ? new Date(pub).toISOString().slice(0, 16).replace("T", " ")
            : "",
          url: link,
          query: q,
        });
      }
    } catch {
      // soft-fail
    }
  }
  return out.slice(0, 18);
}

function basePayload(
  partial: Partial<GreenMineralPayload> & { ok: boolean },
): GreenMineralPayload {
  return {
    generated_at: new Date().toISOString(),
    subtitle_ko: "녹색 전환이 지정학·인권과 충돌하는 지점",
    subtitle_en:
      "Where the Green Transition Collides with Geopolitics and Human Rights",
    note:
      "Phase 1.5: 국가목록 스냅샷·정책 이벤트·Methodology·Yahoo ETF·RSS. 거래소 광물가·무역 HHI·프로젝트 지도·소셜라이선스 자동점수는 제품 비범위(미표시).",
    minerals: GREEN_MINERALS,
    dual_use: DUAL_USE_MAP,
    events: [...GREEN_MINERAL_EVENTS].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    ),
    etfs: [],
    headlines: [],
    list_meta: CRITICAL_LIST_META,
    list_labels: CRITICAL_LIST_LABELS,
    methodology: METHODOLOGY_BLOCKS,
    ...partial,
  };
}

export async function GET() {
  try {
    const [etfs, headlines] = await Promise.all([
      Promise.all(GREEN_MINERAL_ETF_SPECS.map((s) => fetchEtf(s))),
      fetchNews(),
    ]);

    return NextResponse.json(basePayload({ ok: true, etfs, headlines }), {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      basePayload({
        ok: false,
        error: exc instanceof Error ? exc.message : "green-minerals failed",
      }),
      { status: 502 },
    );
  }
}

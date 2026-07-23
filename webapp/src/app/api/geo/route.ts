import { NextResponse } from "next/server";

import {
  GEO_RELATED_ETFS,
  GEO_SIGNAL_SPECS,
  computeComposite,
  type GeoHeadline,
  type GeoPayload,
  type GeoSignal,
} from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type ChartPayload = {
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

async function fetchYahooSignal(spec: (typeof GEO_SIGNAL_SPECS)[number]): Promise<GeoSignal> {
  const base: GeoSignal = {
    id: spec.id,
    symbol: spec.symbol,
    label: spec.label,
    group: spec.group,
    thesis: spec.thesis,
    price: null,
    change_1d_pct: null,
    change_5d_pct: null,
  };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.symbol)}?range=5d&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return { ...base, error: `HTTP ${res.status}` };
    }
    const payload = (await res.json()) as ChartPayload;
    const result = payload.chart?.result?.[0];
    if (!result) return { ...base, error: "no data" };

    const closes = (result.indicators?.quote?.[0]?.close || []).filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    if (!closes.length) return { ...base, error: "no closes" };

    const last = closes[closes.length - 1];
    const prev = closes.length >= 2 ? closes[closes.length - 2] : null;
    const first = closes[0];
    const change_1d_pct =
      prev && prev !== 0 ? Math.round(((last / prev - 1) * 100) * 100) / 100 : null;
    const change_5d_pct =
      first && first !== 0 ? Math.round(((last / first - 1) * 100) * 100) / 100 : null;

    return {
      ...base,
      price: Math.round(last * 1000) / 1000,
      change_1d_pct,
      change_5d_pct,
      currency: result.meta?.currency || "USD",
    };
  } catch (exc) {
    return {
      ...base,
      error: exc instanceof Error ? exc.message : "fetch failed",
    };
  }
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseRssItems(xml: string, source: string, limit: number): GeoHeadline[] {
  const items: GeoHeadline[] = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    if (items.length >= limit) break;
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    const title = decodeXml(titleMatch[1] || "");
    if (!title) continue;
    const linkMatch = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const pubMatch = chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    items.push({
      title,
      link: linkMatch ? decodeXml(linkMatch[1] || "") : undefined,
      source,
      published: pubMatch ? decodeXml(pubMatch[1] || "") : undefined,
    });
  }
  return items;
}

async function fetchHeadlines(): Promise<GeoHeadline[]> {
  const feeds: Array<{ url: string; source: string }> = [
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  ];
  const out: GeoHeadline[] = [];
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" },
          next: { revalidate: 600 },
        });
        if (!res.ok) return;
        const xml = await res.text();
        out.push(...parseRssItems(xml, feed.source, 6));
      } catch {
        // ignore individual feed failures
      }
    }),
  );
  // Prefer geopolitics-ish keywords first, then fill
  const keywords =
    /war|israel|gaza|ukraine|russia|china|taiwan|iran|oil|sanction|nato|military|strike|missile|conflict|middle east|red sea|suez|hormuz|트럼프|중동|우크라|대만|중국|제재|원유/i;
  const ranked = [
    ...out.filter((h) => keywords.test(h.title)),
    ...out.filter((h) => !keywords.test(h.title)),
  ];
  const seen = new Set<string>();
  const unique: GeoHeadline[] = [];
  for (const h of ranked) {
    const key = h.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(h);
    if (unique.length >= 10) break;
  }
  return unique;
}

export async function GET() {
  try {
    const [signals, headlines] = await Promise.all([
      Promise.all(GEO_SIGNAL_SPECS.map((spec) => fetchYahooSignal(spec))),
      fetchHeadlines(),
    ]);
    const composite = computeComposite(signals);
    const payload: GeoPayload = {
      ok: true,
      generated_at: new Date().toISOString(),
      note:
        "시험 탭: Yahoo 시세 + 공개 RSS만 사용합니다. 지도·원문 아카이브는 저장하지 않으며, 투자 조언이 아닙니다.",
      composite,
      signals,
      headlines,
      related_etfs: GEO_RELATED_ETFS,
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        note: "",
        composite: { score: 0, label: "n/a", drivers: [] },
        signals: [],
        headlines: [],
        related_etfs: GEO_RELATED_ETFS,
        error: exc instanceof Error ? exc.message : "geo fetch failed",
      } satisfies GeoPayload,
      { status: 500 },
    );
  }
}

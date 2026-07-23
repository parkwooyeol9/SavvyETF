import { NextResponse } from "next/server";

import {
  GEO_RELATED_ETFS,
  GEO_SIGNAL_SPECS,
  computeComposite,
  parseGeoRange,
  type GeoChokepoint,
  type GeoHeadline,
  type GeoPayload,
  type GeoPoint,
  type GeoRange,
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

function downsample(points: GeoPoint[], maxPoints: number): GeoPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  return out;
}

async function fetchYahooSignal(
  spec: (typeof GEO_SIGNAL_SPECS)[number],
  range: GeoRange,
): Promise<GeoSignal> {
  const base: GeoSignal = {
    id: spec.id,
    symbol: spec.symbol,
    label: spec.label,
    group: spec.group,
    thesis: spec.thesis,
    price: null,
    change_1d_pct: null,
    change_5d_pct: null,
    change_range_pct: null,
  };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.symbol)}?range=${range}&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 180 },
    });
    if (!res.ok) {
      return { ...base, error: `HTTP ${res.status}` };
    }
    const payload = (await res.json()) as ChartPayload;
    const result = payload.chart?.result?.[0];
    if (!result) return { ...base, error: "no data" };

    const timestamps = result.timestamp || [];
    const rawCloses = result.indicators?.quote?.[0]?.close || [];
    const points: GeoPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = rawCloses[i];
      if (close == null || !Number.isFinite(close)) continue;
      points.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close: Math.round(close * 1000) / 1000,
      });
    }
    if (!points.length) return { ...base, error: "no closes" };

    const closes = points.map((p) => p.close);
    const last = closes[closes.length - 1];
    const prev = closes.length >= 2 ? closes[closes.length - 2] : null;
    const first = closes[0];
    const fiveAgo = closes.length >= 6 ? closes[closes.length - 6] : first;

    const change_1d_pct =
      prev && prev !== 0 ? Math.round(((last / prev - 1) * 100) * 100) / 100 : null;
    const change_5d_pct =
      fiveAgo && fiveAgo !== 0
        ? Math.round(((last / fiveAgo - 1) * 100) * 100) / 100
        : null;
    const change_range_pct =
      first && first !== 0 ? Math.round(((last / first - 1) * 100) * 100) / 100 : null;

    return {
      ...base,
      price: last,
      change_1d_pct,
      change_5d_pct,
      change_range_pct,
      currency: result.meta?.currency || "USD",
      series: downsample(points, 120),
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

type EagleChokepointRaw = {
  chokepoint?: string;
  name?: string;
  status?: string;
  signalsLast24h?: number;
  highAlertsLast24h?: number;
  signalsLast7d?: number;
  latestHighHeadline?: string | null;
  pageUrl?: string;
  lastUpdated?: string;
};

type EaglePayload = {
  source?: string;
  url?: string;
  chokepoints?: EagleChokepointRaw[];
};

async function fetchChokepoints(): Promise<{
  chokepoints: GeoChokepoint[];
  source?: { name: string; url: string };
}> {
  try {
    const res = await fetch("https://eagleintelmari.com/api/chokepoint-status", {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { chokepoints: [] };
    const payload = (await res.json()) as EaglePayload;
    const chokepoints: GeoChokepoint[] = (payload.chokepoints || [])
      .filter((c) => c.chokepoint && c.name)
      .map((c) => ({
        id: String(c.chokepoint),
        name: String(c.name),
        status: String(c.status || "UNKNOWN").toUpperCase(),
        signals_24h: Number(c.signalsLast24h) || 0,
        high_alerts_24h: Number(c.highAlertsLast24h) || 0,
        signals_7d: Number(c.signalsLast7d) || 0,
        latest_headline: c.latestHighHeadline || null,
        page_url: c.pageUrl,
        last_updated: c.lastUpdated,
      }));
    return {
      chokepoints,
      source: {
        name: payload.source || "Eagle Intelligence",
        url: payload.url || "https://eagleintelmari.com",
      },
    };
  } catch {
    return { chokepoints: [] };
  }
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
          headers: {
            "User-Agent": UA,
            Accept: "application/rss+xml, application/xml, text/xml",
          },
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = parseGeoRange(searchParams.get("range"));

  try {
    const [signals, headlines, choke] = await Promise.all([
      Promise.all(GEO_SIGNAL_SPECS.map((spec) => fetchYahooSignal(spec, range))),
      fetchHeadlines(),
      fetchChokepoints(),
    ]);
    const composite = computeComposite(signals, choke.chokepoints);
    const payload: GeoPayload = {
      ok: true,
      generated_at: new Date().toISOString(),
      note:
        "Yahoo 일봉 + Eagle 해운 병목 + 공개 RSS. 투자 조언이 아니며 별도 DB 저장 없음.",
      range,
      composite,
      chokepoints: choke.chokepoints,
      chokepoint_source: choke.source,
      signals,
      headlines,
      related_etfs: GEO_RELATED_ETFS,
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
        range,
        composite: { score: 0, label: "n/a", drivers: [] },
        chokepoints: [],
        signals: [],
        headlines: [],
        related_etfs: GEO_RELATED_ETFS,
        error: exc instanceof Error ? exc.message : "geo fetch failed",
      } satisfies GeoPayload,
      { status: 500 },
    );
  }
}

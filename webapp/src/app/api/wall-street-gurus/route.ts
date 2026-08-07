import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  GURU_DISCLAIMER,
  GURU_METHODOLOGY,
  GURU_ROSTER,
  GURU_SCHEDULE_NOTE,
  buildWallStreetGurusPayload,
  briefingAsOfKst,
  type RawGuruItem,
  type WallStreetGurusPayload,
} from "@/lib/wallStreetGurus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseRssItems(
  xml: string,
  source: string,
  limit: number,
  guru_id?: string,
): RawGuruItem[] {
  const items: RawGuruItem[] = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    if (items.length >= limit) break;
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    const title = decodeXml(titleMatch[1] || "");
    if (!title) continue;
    const linkMatch = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const pubMatch = chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = chunk.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const outlet = sourceMatch ? decodeXml(sourceMatch[1] || "") : source;
    items.push({
      title,
      link: linkMatch ? decodeXml(linkMatch[1] || "") : undefined,
      source: outlet || source,
      published: pubMatch ? decodeXml(pubMatch[1] || "") : undefined,
      guru_id,
    });
  }
  return items;
}

function googleNewsUrl(query: string): string {
  const q = `${query} when:7d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

async function fetchFeed(
  url: string,
  source: string,
  limit: number,
  guru_id?: string,
): Promise<RawGuruItem[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/xml, text/xml,*/*",
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, source, limit, guru_id);
  } catch {
    return [];
  }
}

async function collectGuruHeadlines(): Promise<RawGuruItem[]> {
  const broadQ =
    '("Warren Buffett" OR Berkshire OR "Ray Dalio" OR "Bridgewater Associates" OR "Ken Griffin" OR Citadel OR "Bill Ackman" OR "Pershing Square" OR "Paul Singer" OR Elliott OR "Steve Cohen" OR Point72 OR "David Tepper" OR Appaloosa OR "George Soros" OR "Jeremy Grantham" OR "Stanley Druckenmiller" OR "Renaissance Technologies") (stock OR market OR invest OR hedge OR portfolio OR Fed OR rates)';

  const marketWatchQ =
    'site:marketwatch.com (Buffett OR Dalio OR Ackman OR Griffin OR "Paul Singer" OR Tepper OR Grantham OR Druckenmiller OR Cohen OR Soros OR Bridgewater OR Citadel OR Elliott)';

  const feeds: Array<Promise<RawGuruItem[]>> = [
    fetchFeed(googleNewsUrl(broadQ), "Google News", 30),
    fetchFeed(googleNewsUrl(marketWatchQ), "MarketWatch via GN", 20),
  ];

  // Per-guru feeds (top of roster) for coverage depth
  for (const guru of GURU_ROSTER) {
    feeds.push(
      fetchFeed(googleNewsUrl(guru.search_q), "Google News", 8, guru.id),
    );
  }

  const batches = await Promise.all(feeds);
  return batches.flat();
}

export async function GET() {
  try {
    const payload = await withServerCache(
      `wall-street-gurus:v1:${briefingAsOfKst()}`,
      180_000,
      900_000,
      async () => {
        const raw = await collectGuruHeadlines();
        return buildWallStreetGurusPayload(raw);
      },
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    const empty: WallStreetGurusPayload = {
      ok: false,
      generated_at: new Date().toISOString(),
      as_of_kst: briefingAsOfKst(),
      schedule_note: GURU_SCHEDULE_NOTE,
      disclaimer: GURU_DISCLAIMER,
      methodology: GURU_METHODOLOGY,
      summary: [],
      highlighted: [],
      hedge_funds: [],
      investors: [],
      roster: GURU_ROSTER,
      sources_note: "",
      error: message,
    };
    return NextResponse.json(empty, { status: 502 });
  }
}

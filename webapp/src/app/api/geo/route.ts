import { NextResponse } from "next/server";

import {
  GEO_RELATED_ETFS,
  GEO_SIGNAL_SPECS,
  computeComposite,
  parseGeoRange,
  type GeoChokepoint,
  type GeoHeadline,
  type GeoHormuzCrisis,
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

type HormuzRaw = {
  asOf?: string;
  status?: string;
  brent?: number;
  wti?: number;
  aisConcurrentInZone?: number;
  verdict?: { short?: string; long?: string; status?: string };
  transits?: {
    count?: number;
    baseline?: number;
    throughputPct?: number;
    asOfDate?: string;
  };
  dailyTransits?: { nTotal?: number; nTanker?: number; date?: string };
  insurance?: {
    multiple?: number;
    vlccPremiumLow?: number;
    vlccPremiumHigh?: number;
  };
  hormuzIndex?: {
    crisisPressure?: { value?: number; band?: string };
    escalationProbability?: { value?: number; band?: string };
  };
  iranRate?: {
    midRial?: number;
    deltaDayPct?: number;
    delta7dPct?: number;
  };
  tradeImpact?: {
    worldOilAtRiskPct?: number;
    worldLngAtRiskPct?: number;
    dailyEconomicCostUsd?: number;
    alternativeRouteExtraDays?: number;
  };
  carrierSuspensions?: Array<{ carrier?: string; notes?: string }>;
  chokepoints?: Array<{
    key?: string;
    label?: string;
    date?: string;
    nTotal?: number;
    baselineMedian?: number;
    preCrisisBaselineMedian?: number;
    deltaDay?: number;
  }>;
  events?: Array<{ title?: string; occurredAt?: string; severity?: string }>;
  predictionMarkets?: Array<{
    title?: string;
    question?: string;
    probability?: number;
    venue?: string;
    sourceUrl?: string;
  }>;
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchHormuzCrisis(): Promise<GeoHormuzCrisis | null> {
  const urls = [
    "https://cdn.jsdelivr.net/gh/jasonhjohnson/strait-of-hormuz-data@main/data/status.json",
    "https://raw.githubusercontent.com/jasonhjohnson/strait-of-hormuz-data/main/data/status.json",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        next: { revalidate: 180 },
      });
      if (!res.ok) continue;
      const raw = (await res.json()) as HormuzRaw;
      if (!raw || (!raw.verdict && !raw.status && raw.brent == null)) continue;

      const carriers = (raw.carrierSuspensions || [])
        .filter((c) => c.carrier)
        .slice(0, 8)
        .map((c) => ({
          name: String(c.carrier),
          notes: c.notes ? String(c.notes).slice(0, 160) : undefined,
        }));

      const lanes = (raw.chokepoints || [])
        .filter((c) => c.key && c.label)
        .map((c) => ({
          id: String(c.key),
          name: String(c.label),
          date: c.date,
          n_total: num(c.nTotal),
          baseline: num(c.baselineMedian),
          pre_crisis_baseline: num(c.preCrisisBaselineMedian),
          delta_day: num(c.deltaDay),
        }));

      const events = (raw.events || [])
        .filter((e) => e.title)
        .slice(0, 8)
        .map((e) => ({
          title: String(e.title),
          occurred_at: e.occurredAt,
          severity: e.severity,
        }));

      const markets = (raw.predictionMarkets || [])
        .filter((m) => m.title || m.question)
        .slice(0, 4)
        .map((m) => ({
          title: String(m.title || m.question),
          probability:
            m.probability == null ? null : Math.round(m.probability * 1000) / 10,
          venue: m.venue,
          url: m.sourceUrl,
        }));

      return {
        as_of: raw.asOf,
        status: raw.status,
        verdict_short: raw.verdict?.short,
        verdict_long: raw.verdict?.long,
        verdict_status: raw.verdict?.status,
        brent: num(raw.brent),
        wti: num(raw.wti),
        ais_in_zone: num(raw.aisConcurrentInZone),
        transit_count: num(raw.transits?.count ?? raw.dailyTransits?.nTotal),
        transit_baseline: num(raw.transits?.baseline),
        transit_throughput_pct: num(raw.transits?.throughputPct),
        transit_as_of: raw.transits?.asOfDate || raw.dailyTransits?.date,
        tanker_count: num(raw.dailyTransits?.nTanker),
        insurance_multiple: num(raw.insurance?.multiple),
        vlcc_premium_low: num(raw.insurance?.vlccPremiumLow),
        vlcc_premium_high: num(raw.insurance?.vlccPremiumHigh),
        crisis_pressure: num(raw.hormuzIndex?.crisisPressure?.value),
        crisis_band: raw.hormuzIndex?.crisisPressure?.band || null,
        escalation: num(raw.hormuzIndex?.escalationProbability?.value),
        escalation_band: raw.hormuzIndex?.escalationProbability?.band || null,
        iran_usd_mid: num(raw.iranRate?.midRial),
        iran_delta_1d_pct:
          raw.iranRate?.deltaDayPct == null
            ? null
            : Math.round(raw.iranRate.deltaDayPct * 100) / 100,
        iran_delta_7d_pct:
          raw.iranRate?.delta7dPct == null
            ? null
            : Math.round(raw.iranRate.delta7dPct * 100) / 100,
        world_oil_at_risk_pct: num(raw.tradeImpact?.worldOilAtRiskPct),
        world_lng_at_risk_pct: num(raw.tradeImpact?.worldLngAtRiskPct),
        daily_cost_usd: num(raw.tradeImpact?.dailyEconomicCostUsd),
        alt_route_extra_days: num(raw.tradeImpact?.alternativeRouteExtraDays),
        carriers,
        lanes,
        events,
        markets,
        source: {
          name: "straits.live",
          url: "https://straits.live",
          mirror:
            "https://github.com/jasonhjohnson/strait-of-hormuz-data",
        },
      };
    } catch {
      // try next mirror
    }
  }
  return null;
}

async function fetchHeadlines(
  hormuzEvents: GeoHormuzCrisis["events"] = [],
): Promise<GeoHeadline[]> {
  const feeds: Array<{ url: string; source: string; limit: number }> = [
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World", limit: 8 },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera", limit: 8 },
    {
      url: "https://news.google.com/rss/search?q=Iran+OR+Hormuz+OR+%22Strait+of+Hormuz%22+when:2d&hl=en-US&gl=US&ceid=US:en",
      source: "Google News",
      limit: 10,
    },
  ];
  const out: GeoHeadline[] = [];

  for (const e of hormuzEvents.slice(0, 5)) {
    out.push({
      title: e.title,
      source: "Hormuz live",
      published: e.occurred_at,
    });
  }

  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          headers: {
            "User-Agent": UA,
            Accept: "application/rss+xml, application/xml, text/xml,*/*",
          },
          next: { revalidate: 600 },
        });
        if (!res.ok) return;
        const xml = await res.text();
        out.push(...parseRssItems(xml, feed.source, feed.limit));
      } catch {
        // ignore individual feed failures
      }
    }),
  );

  const iranFocus =
    /iran|hormuz|tehran|irgc|strait of hormuz|persian gulf|hezbollah|houthi|red sea|israel.?iran|중동|이란|호르무즈/i;
  const keywords =
    /war|israel|gaza|ukraine|russia|china|taiwan|iran|oil|sanction|nato|military|strike|missile|conflict|middle east|red sea|suez|hormuz|트럼프|중동|우크라|대만|중국|제재|원유/i;

  const ranked = [
    ...out.filter((h) => iranFocus.test(h.title)),
    ...out.filter((h) => keywords.test(h.title) && !iranFocus.test(h.title)),
    ...out.filter((h) => !keywords.test(h.title) && !iranFocus.test(h.title)),
  ];
  const seen = new Set<string>();
  const unique: GeoHeadline[] = [];
  for (const h of ranked) {
    const key = h.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(h);
    if (unique.length >= 12) break;
  }
  return unique;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = parseGeoRange(searchParams.get("range"));

  try {
    const [signals, choke, hormuz] = await Promise.all([
      Promise.all(GEO_SIGNAL_SPECS.map((spec) => fetchYahooSignal(spec, range))),
      fetchChokepoints(),
      fetchHormuzCrisis(),
    ]);
    const headlines = await fetchHeadlines(hormuz?.events || []);
    const composite = computeComposite(signals, choke.chokepoints, hormuz);
    const payload: GeoPayload = {
      ok: true,
      generated_at: new Date().toISOString(),
      note:
        "이란·호르무즈(straits.live) + Eagle 해운경보 + Yahoo/RSS. 투자 조언 아님 · DB 저장 없음.",
      range,
      composite,
      hormuz,
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
        hormuz: null,
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

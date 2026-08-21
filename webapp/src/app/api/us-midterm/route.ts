import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import { timingSafeEqual } from "crypto";
import {
  CURRENT_COMPOSITION,
  MIDTERM_ETF_SPECS,
  MIDTERM_HISTORY,
  MIDTERM_SCHEDULE_NOTE,
  MIDTERM_SOURCES,
  NATIONAL_SNAPSHOT,
  POLYMARKET_EVENTS,
  SENATE_MAP,
  SENATE_RACES,
  daysToElection,
  emptyMidtermPayload,
  hydrateRacePolicy,
  isMidtermSnapshotCurrent,
  loadCachedMidterm,
  persistMidtermPayload,
  type ChamberMarket,
  type MidtermEtf,
  type MidtermHeadline,
  type MidtermPayload,
  type PowerSplit,
  type SeatBucket,
  type SenateRace,
} from "@/lib/usMidterm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const GAMMA = "https://gamma-api.polymarket.com/events";

type PolyMarket = {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
  volumeNum?: number;
  liquidityNum?: number;
  active?: boolean;
  oneWeekPriceChange?: number;
  oneMonthPriceChange?: number;
  updatedAt?: string;
};

type PolyEvent = {
  slug?: string;
  title?: string;
  volume?: number;
  updatedAt?: string;
  markets?: PolyMarket[];
};

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseJsonArray(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function yesPrice(m: PolyMarket): number | null {
  const outcomes = parseJsonArray(m.outcomes).map((s) => s.toLowerCase());
  const prices = parseJsonArray(m.outcomePrices).map((s) => Number(s));
  if (!prices.length || prices.some((p) => !Number.isFinite(p))) return null;
  const idx = outcomes.findIndex((o) => o === "yes");
  const p = prices[idx >= 0 ? idx : 0];
  return Number.isFinite(p) ? p : null;
}

function partyFromTitle(text: string): "D" | "R" | null {
  const t = text.toLowerCase();
  if (/\bdemoc|\(d\)|\bblue\b/.test(t)) return "D";
  if (/\brepub|\(r\)|\bred\b/.test(t)) return "R";
  return null;
}

async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Api-User-Agent": UA,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchEvent(slug: string): Promise<PolyEvent | null> {
  const data = await fetchJson<PolyEvent[] | PolyEvent>(
    `${GAMMA}?slug=${encodeURIComponent(slug)}`,
  );
  if (!data) return null;
  if (Array.isArray(data)) return data[0] || null;
  return data.slug || data.markets ? data : null;
}

function activeMarkets(ev: PolyEvent | null): PolyMarket[] {
  return (ev?.markets || []).filter((m) => m.active !== false);
}

function wikiThumbUrl(src: string): string {
  return src.replace(/\?.*$/, "");
}

async function attachCandidatePhotos(races: SenateRace[]): Promise<SenateRace[]> {
  const missing = new Set<string>();
  for (const race of races) {
    if (race.dem_profile?.wiki && !race.dem_profile.photo_url) {
      missing.add(race.dem_profile.wiki);
    }
    if (race.gop_profile?.wiki && !race.gop_profile.photo_url) {
      missing.add(race.gop_profile.wiki);
    }
  }
  if (!missing.size) return races;

  const photos = new Map<string, string>();
  await Promise.all(
    [...missing].map(async (wiki) => {
      const data = await fetchJson<{ thumbnail?: { source?: string } }>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${wiki}`,
      );
      const src = data?.thumbnail?.source;
      if (src) photos.set(wiki, wikiThumbUrl(src));
    }),
  );
  if (!photos.size) return races;

  return races.map((race) => ({
    ...race,
    dem_profile: race.dem_profile
      ? {
          ...race.dem_profile,
          photo_url:
            photos.get(race.dem_profile.wiki) || race.dem_profile.photo_url || null,
        }
      : race.dem_profile,
    gop_profile: race.gop_profile
      ? {
          ...race.gop_profile,
          photo_url:
            photos.get(race.gop_profile.wiki) || race.gop_profile.photo_url || null,
        }
      : race.gop_profile,
  }));
}

function chamberFromEvent(
  ev: PolyEvent | null,
  chamber: ChamberMarket["chamber"],
): ChamberMarket | null {
  if (!ev) return null;
  let dem: PolyMarket | undefined;
  let gop: PolyMarket | undefined;
  for (const m of activeMarkets(ev)) {
    const label = `${m.groupItemTitle || ""} ${m.question || ""}`;
    const party = partyFromTitle(label);
    if (party === "D") dem = m;
    if (party === "R") gop = m;
  }
  const demP = dem ? yesPrice(dem) : null;
  const gopP = gop ? yesPrice(gop) : null;
  if (demP == null && gopP == null) return null;
  return {
    chamber,
    dem_prob: demP,
    gop_prob: gopP,
    volume: num(ev.volume),
    change_1w_dem: dem?.oneWeekPriceChange ?? null,
    change_1m_dem: dem?.oneMonthPriceChange ?? null,
    updated_at: ev.updatedAt,
  };
}

function parsePower(ev: PolyEvent | null): PowerSplit[] {
  if (!ev) return [];
  const specs: Array<{ id: string; label: string; label_ko: string; match: RegExp }> = [
    {
      id: "d-sweep",
      label: "Democrats Sweep",
      label_ko: "민주 하원+상원",
      match: /democrats sweep|d senate.*d house|democratic sweep/i,
    },
    {
      id: "split-d-house",
      label: "R Senate, D House",
      label_ko: "공화 상원 · 민주 하원",
      match: /r senate.*d house|d house.*r senate/i,
    },
    {
      id: "split-d-senate",
      label: "D Senate, R House",
      label_ko: "민주 상원 · 공화 하원",
      match: /d senate.*r house|r house.*d senate/i,
    },
    {
      id: "r-sweep",
      label: "Republicans Sweep",
      label_ko: "공화 하원+상원",
      match: /republicans sweep|republican sweep/i,
    },
  ];
  return specs.map((spec) => {
    const m = activeMarkets(ev).find((row) =>
      spec.match.test(`${row.groupItemTitle || ""} ${row.question || ""}`),
    );
    return {
      id: spec.id,
      label: spec.label,
      label_ko: spec.label_ko,
      probability: m ? yesPrice(m) : null,
      change_1m: m?.oneMonthPriceChange ?? null,
    };
  });
}

function parseSeatHistogram(ev: PolyEvent | null): SeatBucket[] {
  if (!ev) return [];
  const buckets: SeatBucket[] = [];
  for (const m of activeMarkets(ev)) {
    const title = (m.groupItemTitle || m.question || "").trim();
    const compact = title.replace(/\s+/g, "");
    let seats_low = NaN;
    let seats_high = NaN;
    let label = title;
    const le = compact.match(/^(≤|<=|≦)(\d+)$/) || title.match(/≤\s*(\d+)/);
    const ge = compact.match(/^(≥|>=|≧)(\d+)$/) || title.match(/(\d+)\+/);
    const exact = compact.match(/^(\d+)$/);
    if (le) {
      const n = Number(le[2] || le[1]);
      seats_low = 0;
      seats_high = n;
      label = `≤${n}`;
    } else if (ge) {
      const n = Number(ge[2] || ge[1]);
      seats_low = n;
      seats_high = 100;
      label = `${n}+`;
    } else if (exact) {
      const n = Number(exact[1]);
      seats_low = n;
      seats_high = n;
      label = String(n);
    } else {
      continue;
    }
    buckets.push({
      id: label,
      label,
      seats_low,
      seats_high,
      probability: yesPrice(m),
      change_1w: m.oneWeekPriceChange ?? null,
    });
  }
  return buckets.sort((a, b) => a.seats_low - b.seats_low || a.seats_high - b.seats_high);
}

function nameHit(hay: string, name: string): boolean {
  const h = hay.toLowerCase();
  const parts = name.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
  if (!parts.length) return false;
  return parts.every((p) => h.includes(p));
}

function overlayRace(base: SenateRace, ev: PolyEvent | null): SenateRace {
  if (!ev) return { ...base };
  const markets = activeMarkets(ev);
  let demM: PolyMarket | undefined;
  let gopM: PolyMarket | undefined;
  for (const m of markets) {
    const label = `${m.groupItemTitle || ""} ${m.question || ""}`;
    if (nameHit(label, base.dem) || partyFromTitle(label) === "D") {
      if (nameHit(label, base.dem) || !demM) demM = m;
    }
    if (nameHit(label, base.gop) || partyFromTitle(label) === "R") {
      if (nameHit(label, base.gop) || !gopM) gopM = m;
    }
  }
  return {
    ...base,
    dem_prob: demM ? yesPrice(demM) : null,
    gop_prob: gopM ? yesPrice(gopM) : null,
    volume: num(ev.volume),
    change_1w_dem: demM?.oneWeekPriceChange ?? null,
  };
}

async function fetchEtfs(): Promise<MidtermEtf[]> {
  const out: MidtermEtf[] = [];
  await Promise.all(
    MIDTERM_ETF_SPECS.map(async (spec) => {
      const base: MidtermEtf = {
        ...spec,
        price: null,
        change_1d_pct: null,
        change_5d_pct: null,
      };
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.symbol)}?range=5d&interval=1d&includePrePost=false`;
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          out.push({ ...base, error: `HTTP ${res.status}` });
          return;
        }
        const payload = (await res.json()) as YahooChart;
        const result = payload.chart?.result?.[0];
        const closes = (result?.indicators?.quote?.[0]?.close || []).filter(
          (c): c is number => c != null && Number.isFinite(c),
        );
        const last = closes.at(-1) ?? result?.meta?.regularMarketPrice ?? null;
        const prev = closes.at(-2) ?? null;
        const fiveAgo = closes[0] ?? null;
        const chg = (a: number | null, b: number | null) =>
          a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null;
        out.push({
          ...base,
          price: last,
          change_1d_pct: chg(last, prev),
          change_5d_pct: chg(last, fiveAgo),
        });
      } catch (exc) {
        out.push({
          ...base,
          error: exc instanceof Error ? exc.message : "yahoo fail",
        });
      }
    }),
  );
  const order = new Map(MIDTERM_ETF_SPECS.map((s, i) => [s.id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripCdata(m[1]).replace(/<[^>]+>/g, "").trim() : "";
}

async function fetchHeadlines(): Promise<MidtermHeadline[]> {
  const feeds: Array<{ url: string; source: string; limit: number }> = [
    {
      url:
        "https://news.google.com/rss/search?q=2026%20midterm%20election%20Senate%20OR%20House%20when:2d&hl=en-US&gl=US&ceid=US:en",
      source: "Google News",
      limit: 8,
    },
    {
      url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",
      source: "BBC US",
      limit: 4,
    },
  ];
  const items: MidtermHeadline[] = [];
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          headers: {
            "User-Agent": UA,
            Accept: "application/rss+xml, application/xml, text/xml,*/*",
          },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return;
        const xml = await res.text();
        const blocks = xml.split(/<item[\s>]/i).slice(1);
        for (const block of blocks.slice(0, feed.limit)) {
          const title = tag(block, "title");
          if (!title) continue;
          items.push({
            title,
            link: tag(block, "link") || undefined,
            source: feed.source,
            published: tag(block, "pubDate") || undefined,
          });
        }
      } catch {
        /* ignore feed */
      }
    }),
  );
  const seen = new Set<string>();
  return items.filter((h) => {
    const key = h.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

async function buildPayload(): Promise<MidtermPayload> {
  const warnings: string[] = [];
  const raceSlugs = SENATE_RACES.map((r) => r.slug).filter(
    (s): s is string => Boolean(s),
  );

  const [senateEv, houseEv, powerEv, seatsEv, etfs, headlines, ...raceEvs] =
    await Promise.all([
      fetchEvent(POLYMARKET_EVENTS.senate),
      fetchEvent(POLYMARKET_EVENTS.house),
      fetchEvent(POLYMARKET_EVENTS.power),
      fetchEvent(POLYMARKET_EVENTS.seats),
      fetchEtfs(),
      fetchHeadlines(),
      ...raceSlugs.map((slug) => fetchEvent(slug)),
    ]);

  if (!senateEv && !houseEv) {
    warnings.push(
      "예측시장 API를 읽지 못했습니다. 폴링 스냅샷·전문가 등급은 그대로 표시합니다.",
    );
  }

  const raceBySlug = new Map<string, PolyEvent | null>();
  raceSlugs.forEach((slug, i) => {
    raceBySlug.set(slug, raceEvs[i] as PolyEvent | null);
  });

  const races = await attachCandidatePhotos(
    hydrateRacePolicy(
      SENATE_RACES.map((r) =>
        overlayRace(r, r.slug ? raceBySlug.get(r.slug) || null : null),
      ),
    ),
  );

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    election_date: "2026-11-03",
    days_to_election: daysToElection(),
    note:
      "전국 폴은 Silver Bulletin(FLIPR), 주별 등급은 Cook/270toWin/DDHQ 합의입니다. 투자·선거 조언이 아닙니다.",
    composition: { ...CURRENT_COMPOSITION },
    national: { ...NATIONAL_SNAPSHOT },
    senate: chamberFromEvent(senateEv, "senate"),
    house: chamberFromEvent(houseEv, "house"),
    power: parsePower(powerEv),
    seat_histogram: parseSeatHistogram(seatsEv),
    races,
    map: SENATE_MAP,
    etfs,
    headlines,
    history: MIDTERM_HISTORY,
    sources: MIDTERM_SOURCES,
    warnings,
    schedule_note: MIDTERM_SCHEDULE_NOTE,
  };
}

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(token && secretsEqual(token, secret));
}

export async function GET(request: Request) {
  const force =
    new URL(request.url).searchParams.get("refresh") === "1" &&
    cronAuthorized(request);
  try {
    if (!force) {
      const cached = await loadCachedMidterm();
      if (cached?.ok && isMidtermSnapshotCurrent(cached.generated_at)) {
        cached.races = await attachCandidatePhotos(
          hydrateRacePolicy(cached.races || []),
        );
        cached.schedule_note = MIDTERM_SCHEDULE_NOTE;
        cached.note = cached.note?.replace(/\s*예측시장은 Polymarket,\s*/i, "") || cached.note;
        cached.sources = MIDTERM_SOURCES;
        return jsonWithCdnCache(cached, "yahoo");
      }
    }

    const payload = await withServerCache(
      force ? `us-midterm-force-${Date.now()}` : "us-midterm-v3",
      180_000,
      600_000,
      buildPayload,
    );
    payload.races = await attachCandidatePhotos(
      hydrateRacePolicy(payload.races || []),
    );
    const stored = payload.ok ? await persistMidtermPayload(payload) : payload;
    return jsonWithCdnCache(stored, "yahoo");
  } catch (exc) {
    const cached = await loadCachedMidterm();
    if (cached?.ok) {
      cached.races = await attachCandidatePhotos(
        hydrateRacePolicy(cached.races || []),
      );
      cached.warnings = [
        ...(cached.warnings || []),
        "라이브 갱신 실패 → 아침 스냅샷",
      ];
      return jsonWithCdnCache(cached, "yahoo");
    }
    const fallback = emptyMidtermPayload();
    fallback.warnings.push(
      exc instanceof Error ? exc.message : "중간선거 데이터를 불러오지 못했습니다",
    );
    return jsonWithCdnCache(fallback, "yahoo");
  }
}

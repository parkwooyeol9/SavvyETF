import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";
import {
  NLP_LOOKBACK_DAYS,
  NLP_UNIVERSE,
  assembleNameCards,
  buildMarketPulse,
  emptyNlpPayload,
  isCallHeadline,
  isDartEvent,
  matchUniverse,
  scoreText,
  type NlpHeadline,
  type NlpName,
  type NlpPulsePayload,
} from "@/lib/nlpPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

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

function parseRss(xml: string, limit: number): Array<{ title: string; url?: string; date: string; source: string }> {
  const out: Array<{ title: string; url?: string; date: string; source: string }> = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    if (out.length >= limit) break;
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    const title = decodeXml(titleMatch[1] || "");
    if (!title) continue;
    const linkMatch = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const pubMatch = chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = chunk.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const published = pubMatch ? decodeXml(pubMatch[1] || "") : "";
    const ts = published ? Date.parse(published) : NaN;
    out.push({
      title,
      url: linkMatch ? decodeXml(linkMatch[1] || "") : undefined,
      date: Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : isoDate(new Date()),
      source: sourceMatch ? decodeXml(sourceMatch[1] || "") : "news",
    });
  }
  return out;
}

async function poolMap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function googleNewsUrl(spec: NlpName): string {
  const hl = spec.market === "kospi200" ? "ko" : "en-US";
  const gl = spec.market === "kospi200" ? "KR" : "US";
  const ceid = spec.market === "kospi200" ? "KR:ko" : "US:en";
  return (
    "https://news.google.com/rss/search?" +
    new URLSearchParams({
      q: `${spec.news_query} when:${NLP_LOOKBACK_DAYS}d`,
      hl,
      gl,
      ceid,
    }).toString()
  );
}

async function fetchNameNews(spec: NlpName): Promise<NlpHeadline[]> {
  try {
    const res = await fetch(googleNewsUrl(spec), {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml,*/*" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRss(xml, 5);
    return items.map((item) => {
      const scored = scoreText(item.title);
      const kind = isCallHeadline(item.title) ? "call" : "news";
      return {
        id: `${spec.id}|${item.title.slice(0, 48)}|${item.date}`,
        name_id: spec.id,
        market: spec.market,
        ticker: spec.ticker,
        name: spec.name,
        date: item.date,
        title: item.title,
        source: item.source,
        url: item.url,
        score: scored.score,
        matched: scored.matched,
        kind,
      } satisfies NlpHeadline;
    });
  } catch {
    return [];
  }
}

async function fetchDartEvents(): Promise<{ hits: NlpHeadline[]; error?: string }> {
  const key = (process.env.DART_API_KEY || "").trim();
  if (!key) return { hits: [], error: "DART_API_KEY 없음" };
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - NLP_LOOKBACK_DAYS);
  const hits: NlpHeadline[] = [];
  try {
    for (let page = 1; page <= 4 && hits.length < 40; page++) {
      const url = new URL("https://opendart.fss.or.kr/api/list.json");
      url.searchParams.set("crtfc_key", key);
      url.searchParams.set("bgn_de", ymd(start));
      url.searchParams.set("end_de", ymd(end));
      url.searchParams.set("page_count", "100");
      url.searchParams.set("page_no", String(page));
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        next: { revalidate: 180 },
      });
      if (!res.ok) return { hits, error: `DART HTTP ${res.status}` };
      const payload = (await res.json()) as {
        list?: Array<Record<string, string>>;
        status?: string;
        message?: string;
      };
      if (payload.status && payload.status !== "000") {
        return { hits, error: payload.message || payload.status };
      }
      const rows = payload.list || [];
      if (!rows.length) break;
      for (const row of rows) {
        const report = (row.report_nm || "").trim();
        const matchedKw = isDartEvent(report);
        const code = (row.stock_code || "").trim();
        const names = matchUniverse(`${row.corp_name || ""} ${report}`, { stock_code: code });
        if (!names.length || !matchedKw.length) continue;
        for (const spec of names.filter((n) => n.market === "kospi200")) {
          const scored = scoreText(`${report} ${row.corp_name || ""}`);
          const rcept = row.rcept_no || "";
          hits.push({
            id: `dart|${rcept || report}|${spec.id}`,
            name_id: spec.id,
            market: "kospi200",
            ticker: spec.ticker,
            name: spec.name,
            date: (row.rcept_dt || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
            title: `${row.corp_name || spec.name} · ${report}`,
            source: "DART",
            url: rcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}` : undefined,
            score: scored.score,
            matched: matchedKw.length ? matchedKw : scored.matched,
            kind: "dart",
          });
        }
        if (hits.length >= 40) break;
      }
    }
    return { hits };
  } catch (exc) {
    return { hits, error: exc instanceof Error ? exc.message : "DART 실패" };
  }
}

async function fetchSecEvents(): Promise<{ hits: NlpHeadline[]; error?: string }> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - NLP_LOOKBACK_DAYS);
  const email =
    (process.env.SEC_CONTACT_EMAIL || "").trim() || "savvyetf@users.noreply.github.com";
  const ua =
    (process.env.SEC_EDGAR_USER_AGENT || "").trim() || `SavvyETF/1.0 (${email})`;
  try {
    const url = new URL("https://efts.sec.gov/LATEST/search-index");
    url.searchParams.set(
      "q",
      '"Item 2.02" OR "Item 5.02" OR "Item 8.01" OR "Item 7.01" OR earnings OR guidance',
    );
    url.searchParams.set("forms", "8-K");
    url.searchParams.set("dateRange", "custom");
    url.searchParams.set("startdt", isoDate(start));
    url.searchParams.set("enddt", isoDate(end));
    url.searchParams.set("from", "0");
    url.searchParams.set("size", "25");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": ua, "User-Agent-Email": email },
      next: { revalidate: 180 },
    });
    if (!res.ok) return { hits: [], error: `SEC HTTP ${res.status}` };
    const payload = (await res.json()) as {
      hits?: {
        hits?: Array<{
          _source?: {
            display_names?: string[];
            form?: string;
            file_date?: string;
            items?: string[];
            cik?: string | number;
            tickers?: string[];
          };
        }>;
      };
    };
    const hits: NlpHeadline[] = [];
    for (const hit of payload.hits?.hits || []) {
      const src = hit._source || {};
      const company = (src.display_names?.[0] || "").split("(")[0]?.trim() || "";
      const ticker = (src.tickers?.[0] || "").toUpperCase();
      const names = matchUniverse(`${company} ${ticker}`, { ticker });
      const us = names.filter((n) => n.market === "sp500");
      if (!us.length) continue;
      const items = (src.items || []).join(", ");
      const title = `${company || us[0]!.name} · 8-K ${items || src.form || ""}`.trim();
      const scored = scoreText(title);
      for (const spec of us) {
        hits.push({
          id: `sec|${src.cik || company}|${spec.id}|${src.file_date}`,
          name_id: spec.id,
          market: "sp500",
          ticker: spec.ticker,
          name: spec.name,
          date: src.file_date || isoDate(end),
          title,
          source: "SEC",
          url: src.cik
            ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.cik}`
            : "https://www.sec.gov/edgar/search/",
          score: scored.score,
          matched: items ? items.split(",").slice(0, 4) : scored.matched,
          kind: "sec",
        });
      }
    }
    return { hits };
  } catch (exc) {
    return { hits: [], error: exc instanceof Error ? exc.message : "SEC 실패" };
  }
}

async function fetchEarningsCalls(): Promise<{ hits: NlpHeadline[]; error?: string }> {
  const key = (process.env.FINNHUB_API_KEY || "").trim();
  if (!key) return { hits: [], error: "FINNHUB_API_KEY 없음" };
  const from = new Date();
  from.setDate(from.getDate() - 1);
  const to = new Date();
  to.setDate(to.getDate() + 7);
  try {
    const url =
      "https://finnhub.io/api/v1/calendar/earnings?" +
      new URLSearchParams({
        from: isoDate(from),
        to: isoDate(to),
        token: key,
      }).toString();
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { hits: [], error: `Finnhub HTTP ${res.status}` };
    const payload = (await res.json()) as {
      earningsCalendar?: Array<{
        date?: string;
        symbol?: string;
        hour?: string;
        epsEstimate?: number | null;
        epsActual?: number | null;
      }>;
    };
    const hits: NlpHeadline[] = [];
    const byTicker = new Map<string, NlpName>();
    for (const n of NLP_UNIVERSE) {
      byTicker.set(n.ticker.toUpperCase(), n);
      if (n.stock_code) byTicker.set(n.stock_code, n);
    }
    for (const row of payload.earningsCalendar || []) {
      const sym = (row.symbol || "").toUpperCase();
      const spec = byTicker.get(sym);
      if (!spec) continue;
      const actual = row.epsActual;
      const est = row.epsEstimate;
      let title = `${spec.name} 실적 (${row.hour || "TBD"})`;
      let score = 0;
      const matched: string[] = ["earnings"];
      if (actual != null && est != null) {
        if (actual > est) {
          title = `${spec.name} EPS 서프라이즈 ${actual} vs ${est}`;
          score = 70;
          matched.push("beat");
        } else if (actual < est) {
          title = `${spec.name} EPS 하회 ${actual} vs ${est}`;
          score = -70;
          matched.push("miss");
        } else {
          title = `${spec.name} EPS 컨센서스 부합 ${actual}`;
        }
      } else {
        title = `${spec.name} 실적·컨콜 ${row.date || ""} ${row.hour || ""}`.trim();
      }
      hits.push({
        id: `call|${sym}|${row.date}`,
        name_id: spec.id,
        market: spec.market,
        ticker: spec.ticker,
        name: spec.name,
        date: row.date || isoDate(new Date()),
        title,
        source: "Finnhub",
        url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`,
        score,
        matched,
        kind: "call",
      });
    }
    return { hits };
  } catch (exc) {
    return { hits: [], error: exc instanceof Error ? exc.message : "earnings 실패" };
  }
}

function uniqueHeadlines(rows: NlpHeadline[]): NlpHeadline[] {
  const seen = new Set<string>();
  const out: NlpHeadline[] = [];
  for (const row of rows) {
    const key = `${row.kind}|${row.name_id}|${row.title.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

type BotNlp = {
  ok?: boolean;
  dart?: Array<{
    corp_name?: string;
    stock_code?: string;
    report_nm?: string;
    date?: string;
    matched?: string[];
    url?: string | null;
  }>;
  sec?: Array<{
    company?: string;
    tickers?: string[];
    items?: string[];
    form?: string;
    file_date?: string;
    url?: string;
  }>;
  earnings?: Array<{
    symbol?: string;
    date?: string;
    hour?: string;
    epsEstimate?: number | null;
    epsActual?: number | null;
  }>;
  sources?: string[];
  errors?: string[];
};

function aliasTicker(sym: string): string {
  const u = sym.toUpperCase();
  if (u === "GOOG") return "GOOGL";
  if (u === "BRK-B") return "BRK.B";
  return u;
}

function mapBotDart(rows: NonNullable<BotNlp["dart"]>): NlpHeadline[] {
  const hits: NlpHeadline[] = [];
  for (const row of rows) {
    const report = (row.report_nm || "").trim();
    const names = matchUniverse(`${row.corp_name || ""} ${report}`, {
      stock_code: (row.stock_code || "").trim(),
    });
    for (const spec of names.filter((n) => n.market === "kospi200")) {
      const scored = scoreText(`${report} ${row.corp_name || ""}`);
      hits.push({
        id: `dart|${row.date}|${spec.id}|${report.slice(0, 40)}`,
        name_id: spec.id,
        market: "kospi200",
        ticker: spec.ticker,
        name: spec.name,
        date: row.date || isoDate(new Date()),
        title: `${row.corp_name || spec.name} · ${report}`,
        source: "DART",
        url: row.url || undefined,
        score: scored.score,
        matched: row.matched?.length ? row.matched : scored.matched,
        kind: "dart",
      });
    }
  }
  return hits;
}

function mapBotSec(rows: NonNullable<BotNlp["sec"]>): NlpHeadline[] {
  const hits: NlpHeadline[] = [];
  for (const row of rows) {
    const ticker = aliasTicker((row.tickers || [])[0] || "");
    const names = matchUniverse(`${row.company || ""} ${ticker}`, { ticker });
    const us = names.filter((n) => n.market === "sp500");
    if (!us.length) continue;
    const items = (row.items || []).join(", ");
    const title = `${row.company || us[0]!.name} · 8-K ${items || row.form || ""}`.trim();
    const scored = scoreText(title);
    for (const spec of us) {
      hits.push({
        id: `sec|${row.file_date}|${spec.id}|${title.slice(0, 40)}`,
        name_id: spec.id,
        market: "sp500",
        ticker: spec.ticker,
        name: spec.name,
        date: row.file_date || isoDate(new Date()),
        title,
        source: "SEC",
        url: row.url,
        score: scored.score,
        matched: items ? items.split(",").slice(0, 4) : scored.matched,
        kind: "sec",
      });
    }
  }
  return hits;
}

function mapBotEarnings(rows: NonNullable<BotNlp["earnings"]>): NlpHeadline[] {
  const hits: NlpHeadline[] = [];
  for (const row of rows) {
    const raw = (row.symbol || "").toUpperCase();
    const spec = NLP_UNIVERSE.find(
      (n) =>
        n.ticker.toUpperCase() === aliasTicker(raw) ||
        n.stock_code === raw.replace(/\.(KS|KQ)$/i, "") ||
        n.ticker.toUpperCase() === raw,
    );
    if (!spec) continue;
    const actual = row.epsActual;
    const est = row.epsEstimate;
    let title = `${spec.name} 실적 (${row.hour || "TBD"})`;
    let score = 0;
    const matched: string[] = ["earnings"];
    if (actual != null && est != null) {
      if (actual > est) {
        title = `${spec.name} EPS 서프라이즈 ${actual} vs ${est}`;
        score = 70;
        matched.push("beat");
      } else if (actual < est) {
        title = `${spec.name} EPS 하회 ${actual} vs ${est}`;
        score = -70;
        matched.push("miss");
      } else {
        title = `${spec.name} EPS 컨센서스 부합 ${actual}`;
      }
    } else {
      title = `${spec.name} 실적·컨콜 ${row.date || ""} ${row.hour || ""}`.trim();
    }
    hits.push({
      id: `call|${raw}|${row.date}`,
      name_id: spec.id,
      market: spec.market,
      ticker: spec.ticker,
      name: spec.name,
      date: row.date || isoDate(new Date()),
      title,
      source: "Finnhub",
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(raw)}`,
      score,
      matched,
      kind: "call",
    });
  }
  return hits;
}

function isSkippableKeyedError(text: string): boolean {
  return /API_KEY 없음|not set|DART_API_KEY|FINNHUB_API_KEY|SEC HTTP 403|HTTP 403/i.test(
    text,
  );
}

async function fetchKeyedSources(): Promise<{
  hits: NlpHeadline[];
  sources: string[];
  errors: string[];
}> {
  try {
    const bot = await fetchBotJson<BotNlp>("/api/web/nlp-pulse", { timeoutMs: 28_000 });
    if (bot && bot.ok !== false) {
      return {
        hits: [
          ...mapBotDart(bot.dart || []),
          ...mapBotSec(bot.sec || []),
          ...mapBotEarnings(bot.earnings || []),
        ],
        sources: bot.sources || [],
        errors: (bot.errors || []).filter((e) => !isSkippableKeyedError(e)),
      };
    }
  } catch {
    // Render cold start / timeout — try Vercel env keys next.
  }

  const [dart, earnings] = await Promise.all([fetchDartEvents(), fetchEarningsCalls()]);
  const sources: string[] = [];
  const errors: string[] = [];
  if (!dart.error) sources.push("Open DART");
  else if (!isSkippableKeyedError(dart.error)) errors.push(dart.error);
  if (!earnings.error) sources.push("Finnhub earnings");
  else if (!isSkippableKeyedError(earnings.error)) errors.push(earnings.error);
  if (!sources.length && !errors.length) {
    errors.push("공시·실적은 Render 봇 배포 후 표시됩니다");
  }
  return {
    hits: [...dart.hits, ...earnings.hits],
    sources,
    errors,
  };
}

async function buildPayload(): Promise<NlpPulsePayload> {
  const sources: string[] = ["Google News"];
  const [newsLists, keyed] = await Promise.all([
    poolMap(NLP_UNIVERSE, 6, fetchNameNews),
    fetchKeyedSources(),
  ]);
  sources.push(...keyed.sources);

  const headlines = uniqueHeadlines([...newsLists.flat(), ...keyed.hits]);

  const cards = assembleNameCards(headlines);
  const kospi = buildMarketPulse("kospi200", cards, headlines);
  const spx = buildMarketPulse("sp500", cards, headlines);
  const events = headlines
    .filter((h) => h.kind === "dart" || h.kind === "sec")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 18);
  const calls = headlines
    .filter((h) => h.kind === "call")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);
  const feed = [...headlines]
    .filter((h) => h.kind === "news")
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.date.localeCompare(a.date))
    .slice(0, 16);

  const payload = emptyNlpPayload();
  return {
    ...payload,
    ok: true,
    generated_at: new Date().toISOString(),
    kospi,
    spx,
    events,
    calls,
    feed,
    sources,
    error: keyed.errors.length ? keyed.errors.join(" · ") : undefined,
  };
}

export async function GET() {
  try {
    const payload = await withServerCache("nlp-pulse:v3", 180_000, 600_000, buildPayload);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(emptyNlpPayload(message), { status: 502 });
  }
}

/**
 * "주목할 내부자 거래": tickers surfaced by the last week of insider-trading
 * headlines (Google News RSS), ranked by side/size/role, and kept only when the
 * issuer actually has recent SEC Form 4 filings.
 */

import { withServerCache } from "@/lib/apiCache";
import { etToday, getInsiderSummary, recentForm4, tickerMap } from "@/lib/insiderServer";
import type { InsiderNewsItem, InsiderSpotlight, InsiderSpotlightItem } from "@/lib/insiderTrading";

const QUERIES = [
  '"insider buying" when:7d',
  "insider bought shares when:7d",
  "CEO buys shares stock when:7d",
  "director purchases shares when:7d",
  "insider sells shares when:7d",
];
const NEWS_DAYS = 7;
const FORM4_DAYS = 14;
const VERIFY_MAX = 24;
const ITEMS_MAX = 12;

type Headline = InsiderNewsItem & { ts: number };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

async function fetchHeadlines(): Promise<Headline[]> {
  const since = Date.now() - NEWS_DAYS * 86_400_000;
  const pages = await Promise.allSettled(
    QUERIES.map(async (q) => {
      const url = `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: "en-US", gl: "US", ceid: "US:en" })}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SavvyETF/1.0)" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`news ${res.status}`);
      return res.text();
    }),
  );
  const out = new Map<string, Headline>();
  for (const page of pages) {
    if (page.status !== "fulfilled") continue;
    for (const m of page.value.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const it = m[1];
      const source = decode(it.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "");
      let title = decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const pub = it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
      const ts = pub ? Date.parse(pub) : NaN;
      if (!title || !Number.isFinite(ts) || ts < since || out.has(title)) continue;
      out.set(title, {
        title,
        source,
        url: decode(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ""),
        published: new Date(ts).toISOString(),
        ts,
      });
    }
  }
  return [...out.values()];
}

// --- Ticker extraction --------------------------------------------------------

const US_TAG = /\((?:NYSE|NASDAQ|Nasdaq|NYSEAMERICAN|NYSEARCA|NYSEMKT|AMEX|BATS|CBOE|OTC|OTCMKTS)\s*:\s*([A-Z][A-Z0-9.\-]{0,6})\)/g;
const FOREIGN_TAG = /\((?:LON|TSE|TSX|TSXV|CVE|CNSX|NEO|ASX|ETR|FRA|EPA|AMS|BIT|BME|SWX|STO|HKG|NSE|BSE|KRX|TYO|SHA|SHE|JSE|NZE)\s*:/;
const ACRONYMS = new Set(
  "CEO CFO COO CTO CIO EVP SVP VP ETF ETFS IPO SEC USA US UK EU AI EV EPS GDP IT LLC PLC NYSE OTC SPAC REIT ESG FDA M&A Q1 Q2 Q3 Q4 FY TV".split(" "),
);
/** Single-word company names that are also everyday headline words. */
const COMMON = new Set(
  "insider insiders buying buys bought sell sells selling sold stock stocks shares share director directors chief officer executive major shareholder company purchase purchases acquires million billion small caps undervalued value focus confidence wave market markets investment investments global capital energy first united american national general international financial trust bank group holdings partners income growth equity fund funds daily weekly report news today week month new big top best".split(
    " ",
  ),
);

const SUFFIX =
  /\b(inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|holding|holdings|group|sa|nv|ag|se|lp|llc|the|class [a-z]|ord|ads|adr|de|new|bancorp)\b/g;

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type NameIndex = Map<string, string>;
let nameIndexFor: Map<string, { cik: string; title: string }> | null = null;
let nameIndex: NameIndex = new Map();

/** core company name → ticker (first ticker per CIK; SEC lists the main class first). */
function buildNameIndex(map: Map<string, { cik: string; title: string }>): NameIndex {
  if (nameIndexFor === map) return nameIndex;
  const idx: NameIndex = new Map();
  const ciks = new Set<string>();
  for (const [ticker, { cik, title }] of map) {
    if (ciks.has(cik)) continue;
    ciks.add(cik);
    const core = normName(title);
    const words = core.split(" ").filter(Boolean);
    if (!words.length || words.length > 4) continue;
    if (words.length === 1 && (core.length < 4 || COMMON.has(core))) continue;
    if (!idx.has(core)) idx.set(core, ticker);
  }
  nameIndexFor = map;
  nameIndex = idx;
  return idx;
}

function extractTickers(title: string, map: Map<string, { cik: string; title: string }>): string[] {
  const valid = (t: string) => map.has(t) && !ACRONYMS.has(t);
  const tagged = [...title.matchAll(US_TAG)].map((m) => m[1]).filter(valid);
  const cash = [...title.matchAll(/\$([A-Z]{1,5})\b/g)].map((m) => m[1]).filter(valid);
  if (tagged.length || cash.length) return [...new Set([...tagged, ...cash])];
  const bare = [
    ...[...title.matchAll(/\(([A-Z]{1,5})\)/g)].map((m) => m[1]),
    ...[...title.matchAll(/\b([A-Z]{2,5})\s+(?:Stock|Shares|Insiders?|CEO|CFO|Director)\b/g)].map((m) => m[1]),
  ].filter(valid);
  if (bare.length) return [bare[0]];
  // Company name: first (leftmost) match only — later names are usually side mentions.
  const idx = buildNameIndex(map);
  const raw = title.replace(/['’]s\b/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const norm = raw.map((w) => normName(w));
  for (let i = 0; i < raw.length; i += 1) {
    for (let n = Math.min(4, raw.length - i); n >= 1; n -= 1) {
      const words = norm.slice(i, i + n).filter(Boolean);
      if (words.length !== n) continue;
      const hit = idx.get(words.join(" "));
      if (!hit) continue;
      if (n === 1 && !/^[A-Z]/.test(raw[i])) continue;
      return [hit];
    }
  }
  return [];
}

// --- Scoring --------------------------------------------------------------------

const BUY_RE = /\b(buy|buys|buying|bought|purchas\w*|acquir\w*|adds|spends?|invests?)\b/i;
const SELL_RE = /\b(sell|sells|selling|sold|dump\w*|unload\w*|offload\w*|dispos\w*|trims?)\b/i;
const CSUITE_RE = /\b(CEO|CFO|COO|Chair(man|woman)?|President|Founder|Chief Executive)\b/i;
const MULTI_RE = /\b(insiders|wave|cluster|several|multiple|directors|executives)\b/i;

function maxAmount(title: string): number | null {
  let best: number | null = null;
  for (const m of title.matchAll(/(?:US)?\$\s?([\d][\d,]*(?:\.\d+)?)\s*(million|billion|mn|bn|m|b|k)?\b/gi)) {
    const after = title.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12);
    if (/^\s*(a|per|\/)\s*share/i.test(after)) continue;
    let v = Number(m[1].replace(/,/g, ""));
    const unit = (m[2] || "").toLowerCase();
    if (unit === "k") v *= 1e3;
    else if (unit === "m" || unit === "mn" || unit === "million") v *= 1e6;
    else if (unit === "b" || unit === "bn" || unit === "billion") v *= 1e9;
    // Unitless small figures are per-share prices ("300 shares at $20.75"), not trade sizes.
    if (!unit && v < 1_000) continue;
    if (Number.isFinite(v) && (best == null || v > best)) best = v;
  }
  return best;
}

type Acc = {
  ticker: string;
  buy: number;
  sell: number;
  max: number | null;
  csuite: boolean;
  multi: boolean;
  newest: number;
  sources: Set<string>;
  news: Headline[];
};

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function buildSpotlight(): Promise<InsiderSpotlight> {
  const [headlines, map, summary] = await Promise.all([
    fetchHeadlines(),
    tickerMap(),
    getInsiderSummary().catch(() => null),
  ]);
  const acc = new Map<string, Acc>();
  for (const h of headlines) {
    if (FOREIGN_TAG.test(h.title)) continue;
    const isBuy = BUY_RE.test(h.title);
    const isSell = SELL_RE.test(h.title);
    if (!isBuy && !isSell) continue;
    for (const ticker of extractTickers(h.title, map)) {
      const a =
        acc.get(ticker) ||
        ({ ticker, buy: 0, sell: 0, max: null, csuite: false, multi: false, newest: 0, sources: new Set(), news: [] } as Acc);
      if (isBuy && !isSell) a.buy += 1;
      else if (isSell && !isBuy) a.sell += 1;
      else {
        a.buy += 0.5;
        a.sell += 0.5;
      }
      const amt = maxAmount(h.title);
      if (amt != null && (a.max == null || amt > a.max)) a.max = amt;
      a.csuite ||= CSUITE_RE.test(h.title);
      a.multi ||= MULTI_RE.test(h.title);
      a.newest = Math.max(a.newest, h.ts);
      if (h.source) a.sources.add(h.source);
      a.news.push(h);
      acc.set(ticker, a);
    }
  }

  const clusters = new Map((summary?.clusters || []).map((c) => [c.ticker, c.n_insiders]));
  const net = new Map(
    [...(summary?.net_buyers || []), ...(summary?.net_sellers || [])].map((r) => [r.ticker, r.net_value]),
  );
  const now = Date.now();
  const scored = [...acc.values()]
    .map((a) => {
      const sizePts = a.max ? Math.min(4, Math.max(0, Math.log10(a.max) - 4)) : 0;
      const score =
        a.buy * 2 +
        a.sell +
        sizePts +
        (a.csuite ? 1.5 : 0) +
        (a.multi ? 1.5 : 0) +
        0.5 * Math.max(0, a.sources.size - 1) +
        (now - a.newest < 2 * 86_400_000 ? 1 : 0) +
        (clusters.has(a.ticker) ? 2 : 0);
      return { a, score };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, VERIFY_MAX);

  const since = shiftDay(etToday(), -FORM4_DAYS);
  const verified = await Promise.all(
    scored.map(async ({ a, score }) => {
      const hit = map.get(a.ticker);
      if (!hit) return null;
      const f4 = await recentForm4(hit.cik, since).catch(() => null);
      if (!f4 || !f4.count) return null;
      const side: InsiderSpotlightItem["side"] =
        a.buy >= a.sell * 2 ? "buy" : a.sell >= a.buy * 2 ? "sell" : "mixed";
      const news = [...a.news]
        .sort((x, y) => y.ts - x.ts)
        .slice(0, 3)
        .map(({ ts: _ts, ...n }) => n);
      return {
        ticker: a.ticker,
        issuer: hit.title,
        side,
        score: Math.round(score * 10) / 10,
        max_amount: a.max,
        c_suite: a.csuite,
        multi_insider: a.multi,
        form4_14d: f4.count,
        last_form4: f4.last,
        news_count: a.news.length,
        news,
        in_cluster: clusters.get(a.ticker) ?? null,
        net_value: net.get(a.ticker) ?? null,
      } satisfies InsiderSpotlightItem;
    }),
  );
  const items = verified.filter((x): x is InsiderSpotlightItem => x != null).slice(0, ITEMS_MAX);
  return {
    ok: true,
    updated_at: new Date().toISOString(),
    headlines: headlines.length,
    items,
    ...(headlines.length ? {} : { error: "뉴스를 불러오지 못했습니다." }),
  };
}

export async function getInsiderSpotlight(): Promise<InsiderSpotlight> {
  return withServerCache("insider:spotlight", 30 * 60_000, 3 * 3_600_000, buildSpotlight);
}

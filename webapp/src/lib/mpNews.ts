/**
 * Per-holding headlines for the MP tab: Google News RSS (en / ko / zh-CN)
 * plus Yahoo Finance RSS for US tickers in English mode.
 */

import { withServerCache } from "@/lib/apiCache";
import { normalizeTicker, tickerMeta, type MpCountry } from "@/lib/mpPortfolio";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export type MpNewsLang = "auto" | "ko" | "en";

export type MpNewsItem = {
  title: string;
  link: string;
  source: string;
  published: string | null;
  ts: number;
};

export type MpNewsBlock = {
  key: string;
  ticker: string;
  country: MpCountry;
  name: string;
  lang: "ko" | "en" | "zh";
  query: string;
  items: MpNewsItem[];
  error?: string;
};

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function tag(chunk: string, name: string): string {
  const m = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeXml(m[1] || "") : "";
}

function parseRss(xml: string, fallbackSource: string): MpNewsItem[] {
  const out: MpNewsItem[] = [];
  for (const chunk of xml.split(/<item[\s>]/i).slice(1)) {
    let title = tag(chunk, "title");
    const link = tag(chunk, "link");
    if (!title || !link) continue;
    const source = tag(chunk, "source") || fallbackSource;
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const published = tag(chunk, "pubDate") || null;
    const ts = published ? Date.parse(published) : NaN;
    out.push({ title, link, source, published, ts: Number.isFinite(ts) ? ts : 0 });
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" },
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function googleNewsUrl(query: string, lang: "ko" | "en" | "zh"): string {
  const loc =
    lang === "ko"
      ? "hl=ko&gl=KR&ceid=KR:ko"
      : lang === "zh"
        ? "hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
        : "hl=en-US&gl=US&ceid=US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${loc}`;
}

function buildQuery(ticker: string, country: MpCountry, lang: MpNewsLang) {
  const meta = tickerMeta(ticker);
  const resolved: "ko" | "en" | "zh" =
    lang === "ko" ? "ko" : lang === "en" ? "en" : country === "CN" && meta?.name_zh ? "zh" : "en";
  if (resolved === "ko") {
    const name = meta?.name_ko || meta?.name || ticker;
    return { lang: resolved, name, query: `"${name}" 주가 when:14d` };
  }
  if (resolved === "zh") {
    const name = meta?.name_zh || ticker;
    return { lang: resolved, name, query: `${name} when:14d` };
  }
  const name = meta?.name || ticker;
  const q = meta?.kind === "etf" ? `"${name}"` : country === "US" ? `"${name}" ${ticker} stock` : `"${name}" shares`;
  return { lang: resolved, name, query: `${q} when:14d` };
}

const NAME_STOPWORDS = new Set([
  "technology",
  "technologies",
  "corporation",
  "corp",
  "group",
  "holdings",
  "financial",
  "energy",
  "medicines",
  "insurance",
  "mining",
  "memory",
  "etf",
  "inc",
  "company",
  "harvest",
  "sse",
  "star",
  "chip",
  "fund",
]);

/** Title must mention the ticker or a distinctive name token (drops loosely-tagged feed items). */
function relevanceMatcher(ticker: string): (title: string) => boolean {
  const meta = tickerMeta(ticker);
  const words = new Set<string>();
  for (const w of (meta?.name || "").split(/[\s.,&()-]+/)) {
    if (w.length >= 3 && !NAME_STOPWORDS.has(w.toLowerCase())) words.add(w.toLowerCase());
  }
  for (const n of [meta?.name_ko, meta?.name_zh?.replace(/ETF$/i, "")]) {
    if (n && n.length >= 2) words.add(n.toLowerCase());
  }
  if (ticker.length >= 4) words.add(ticker.toLowerCase());
  const escaped = ticker.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const shortTicker = ticker.length < 4 ? new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`) : null;
  return (title: string) => {
    const t = title.toLowerCase();
    if (shortTicker?.test(title)) return true;
    for (const w of words) if (t.includes(w)) return true;
    return false;
  };
}

async function newsForOne(
  ticker: string,
  country: MpCountry,
  lang: MpNewsLang,
  limit: number,
): Promise<MpNewsBlock> {
  const t = normalizeTicker(ticker, country);
  const { lang: resolved, name, query } = buildQuery(t, country, lang);
  return withServerCache(`mp:news:${country}:${t}:${resolved}`, 20 * 60_000, 2 * 3_600_000, async () => {
    const block: MpNewsBlock = { key: t, ticker: t, country, name, lang: resolved, query, items: [] };
    const tasks: Array<Promise<MpNewsItem[]>> = [
      fetchText(googleNewsUrl(query, resolved)).then((x) => parseRss(x, "Google News")),
    ];
    if (resolved === "en" && country === "US") {
      tasks.push(
        fetchText(
          `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(t)}&region=US&lang=en-US`,
        ).then((x) => parseRss(x, "Yahoo Finance")),
      );
    }
    const settled = await Promise.allSettled(tasks);
    if (settled.every((s) => s.status === "rejected")) throw new Error("뉴스 피드 조회 실패");
    const relevant = relevanceMatcher(t);
    const cutoff = Date.now() - 21 * 86_400_000;
    const collect = (filter: boolean, sources: number[]) => {
      const seen = new Set<string>();
      const out: MpNewsItem[] = [];
      for (const idx of sources) {
        const s = settled[idx];
        if (!s || s.status !== "fulfilled") continue;
        for (const it of s.value) {
          if (it.ts && it.ts < cutoff) continue;
          if (filter && !relevant(it.title)) continue;
          const k = it.title.toLowerCase().replace(/[^a-z0-9가-힣\u4e00-\u9fff]+/g, "").slice(0, 80);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(it);
        }
      }
      return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
    };
    const filtered = collect(true, settled.map((_, i) => i));
    block.items = filtered.length ? filtered : collect(false, [0]);
    return block;
  });
}

export async function fetchMpNews(
  items: Array<{ ticker: string; country: MpCountry }>,
  lang: MpNewsLang,
  limit = 6,
): Promise<MpNewsBlock[]> {
  const out = new Array<MpNewsBlock>(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(6, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      const it = items[i]!;
      try {
        out[i] = await newsForOne(it.ticker, it.country, lang, limit);
      } catch (exc) {
        out[i] = {
          key: it.ticker,
          ticker: it.ticker,
          country: it.country,
          name: it.ticker,
          lang: "en",
          query: "",
          items: [],
          error: exc instanceof Error ? exc.message : String(exc),
        };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

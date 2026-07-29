import { NextRequest, NextResponse } from "next/server";

import {
  AI_POLICY_CALENDAR,
  type AiGovDartHit,
  type AiGovHeadline,
  type AiGovPolicyEvent,
  type AiGovScreenPayload,
  type AiGovSecFiling,
} from "@/lib/aiGov";
import { fetchBotJson } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const DART_KEYWORDS = [
  "인공지능",
  "개인정보",
  "정보보호",
  "정보유출",
  "보안사고",
  "사이버",
  "유출사고",
  "해킹",
  "랜섬웨어",
  "딥페이크",
] as const;

const NEWS_KEYS = [
  "artificial intelligence",
  "ai act",
  "ai governance",
  "cybersecurity",
  "data breach",
  "privacy",
  "openai",
  "chatgpt",
  "generative ai",
  "인공지능",
  "개인정보",
  "사이버",
  "정보유출",
  "ai기본법",
  "딥페이크",
];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function matchNews(text: string): boolean {
  const low = text.toLowerCase();
  return NEWS_KEYS.some((k) => low.includes(k.toLowerCase()));
}

function policyEvents(): AiGovPolicyEvent[] {
  const today = new Date();
  const todayIso = isoDate(today);
  const start = new Date(today);
  start.setDate(start.getDate() - 120);
  const end = new Date(today);
  end.setDate(end.getDate() + 180);
  const startIso = isoDate(start);
  const endIso = isoDate(end);

  return AI_POLICY_CALENDAR.filter((e) => e.date >= startIso && e.date <= endIso).map(
    (e) => {
      const days = Math.round(
        (Date.parse(e.date) - Date.parse(todayIso)) / (24 * 3600 * 1000),
      );
      return {
        ...e,
        days_from_today: days,
        status: days < 0 ? "past" : days === 0 ? "today" : "upcoming",
      };
    },
  );
}

async function fetchDartHits(): Promise<NonNullable<AiGovScreenPayload["dart"]>> {
  const key = (process.env.DART_API_KEY || "").trim();
  if (!key) {
    return { ok: false, source: "opendart", error: "DART_API_KEY not set", hits: [] };
  }
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const hits: AiGovDartHit[] = [];
  try {
    for (let page = 1; page <= 8 && hits.length < 40; page++) {
      const url = new URL("https://opendart.fss.or.kr/api/list.json");
      url.searchParams.set("crtfc_key", key);
      url.searchParams.set("bgn_de", ymd(start));
      url.searchParams.set("end_de", ymd(end));
      url.searchParams.set("page_count", "100");
      url.searchParams.set("page_no", String(page));
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        next: { revalidate: 300 },
      });
      if (!res.ok) {
        return {
          ok: false,
          source: "opendart",
          error: `HTTP ${res.status}`,
          hits,
        };
      }
      const payload = (await res.json()) as {
        list?: Array<Record<string, string>>;
        status?: string;
        message?: string;
      };
      const rows = payload.list || [];
      if (!rows.length) break;
      for (const row of rows) {
        const name = (row.report_nm || "").trim();
        const matched = DART_KEYWORDS.filter((k) => name.includes(k));
        if (!matched.length) continue;
        const rcept = row.rcept_no || "";
        hits.push({
          date: row.rcept_dt,
          corp_name: row.corp_name,
          stock_code: (row.stock_code || "").trim(),
          report_nm: name,
          rcept_no: rcept,
          viewer: rcept
            ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}`
            : null,
          matched: [...matched],
        });
        if (hits.length >= 40) break;
      }
    }
    hits.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return {
      ok: true,
      source: "opendart",
      days: 90,
      keywords: [...DART_KEYWORDS],
      hit_count: hits.length,
      hits: hits.slice(0, 40),
    };
  } catch (exc) {
    return {
      ok: false,
      source: "opendart",
      error: exc instanceof Error ? exc.message : "dart failed",
      hits,
    };
  }
}

async function fetchSecCyber(): Promise<NonNullable<AiGovScreenPayload["sec"]>> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const email =
    (process.env.SEC_CONTACT_EMAIL || "").trim() || "savvyetf@users.noreply.github.com";
  const ua =
    (process.env.SEC_EDGAR_USER_AGENT || "").trim() || `SavvyETF/1.0 (${email})`;
  try {
    const url = new URL("https://efts.sec.gov/LATEST/search-index");
    url.searchParams.set("q", '"Item 1.05" OR cybersecurity OR "data breach"');
    url.searchParams.set("forms", "8-K");
    url.searchParams.set("dateRange", "custom");
    url.searchParams.set("startdt", isoDate(start));
    url.searchParams.set("enddt", isoDate(end));
    url.searchParams.set("from", "0");
    url.searchParams.set("size", "12");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": ua, "User-Agent-Email": email },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return { ok: false, source: "sec_edgar", error: `HTTP ${res.status}`, filings: [] };
    }
    const payload = (await res.json()) as {
      hits?: {
        total?: { value?: number };
        hits?: Array<{
          _source?: {
            display_names?: string[];
            form?: string;
            root_forms?: string[];
            file_date?: string;
            items?: string[];
            adsh?: string;
            cik?: string | number;
            file_num?: string;
          };
          id?: string;
        }>;
      };
    };
    const rawHits = payload.hits?.hits || [];
    const count = payload.hits?.total?.value ?? rawHits.length;
    const filings: AiGovSecFiling[] = rawHits.map((hit) => {
      const src = hit._source || {};
      const company = (src.display_names?.[0] || "Unknown").split("(")[0]?.trim();
      const items = src.items || [];
      return {
        company,
        form: src.form || src.root_forms?.[0] || "8-K",
        file_date: src.file_date || "",
        items: items.join(", "),
        item_summary: items.includes("1.05")
          ? "Cybersecurity incident"
          : items.slice(0, 2).join(", "),
        url: src.cik
          ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.cik}`
          : "https://www.sec.gov/edgar/search/",
      };
    });
    return {
      ok: true,
      source: "sec_edgar",
      window_days: 30,
      filing_count: count,
      filings,
    };
  } catch (exc) {
    return {
      ok: false,
      source: "sec_edgar",
      error: exc instanceof Error ? exc.message : "sec failed",
      filings: [],
    };
  }
}

async function fetchFinnhubNews(): Promise<NonNullable<AiGovScreenPayload["finnhub"]>> {
  const key = (process.env.FINNHUB_API_KEY || "").trim();
  if (!key) {
    return {
      ok: false,
      source: "finnhub",
      error: "FINNHUB_API_KEY not set",
      headlines: [],
    };
  }
  try {
    const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      next: { revalidate: 180 },
    });
    if (!res.ok) {
      return {
        ok: false,
        source: "finnhub",
        error: `HTTP ${res.status}`,
        headlines: [],
      };
    }
    const items = (await res.json()) as Array<{
      headline?: string;
      source?: string;
      datetime?: number;
      summary?: string;
      url?: string;
    }>;
    const mapped: AiGovHeadline[] = (Array.isArray(items) ? items : []).map((item) => {
      const ts = item.datetime;
      return {
        headline: item.headline || "",
        source: item.source || "Finnhub",
        published:
          typeof ts === "number"
            ? new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ")
            : "",
        summary: (item.summary || "").slice(0, 220),
        url: item.url || "",
      };
    });
    const filtered = mapped.filter(
      (h) => matchNews(h.headline || "") || matchNews(h.summary || ""),
    );
    return {
      ok: true,
      source: "finnhub",
      headlines: (filtered.length ? filtered : mapped).slice(0, 10),
      filtered: filtered.length > 0,
    };
  } catch (exc) {
    return {
      ok: false,
      source: "finnhub",
      error: exc instanceof Error ? exc.message : "finnhub failed",
      headlines: [],
    };
  }
}

async function fetchGoogleNewsRss(): Promise<NonNullable<AiGovScreenPayload["naver"]>> {
  const queries = [
    "AI기본법 OR 인공지능 거버넌스 OR 개인정보 유출",
    "AI Act OR AI governance OR cybersecurity incident",
  ];
  const headlines: AiGovHeadline[] = [];
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
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" },
        next: { revalidate: 300 },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 8)) {
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
        headlines.push({
          headline: title,
          source,
          published: pub ? new Date(pub).toISOString().slice(0, 16).replace("T", " ") : "",
          url: link,
          query: q,
        });
      }
    } catch {
      // soft-fail per query
    }
  }

  return {
    ok: headlines.length > 0,
    source: "google_news_rss",
    headlines: headlines.slice(0, 12),
    error: headlines.length ? undefined : "rss empty",
  };
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Key-free core: SEC + policy calendar + Google News RSS. */
async function openSourcesBundle(): Promise<AiGovScreenPayload> {
  const [sec, news] = await Promise.all([fetchSecCyber(), fetchGoogleNewsRss()]);
  const policy = { ok: true as const, events: policyEvents() };
  const errors = [sec.error, news.error].filter(Boolean) as string[];
  return {
    ok: Boolean(sec.ok || news.ok || policy.events.length),
    generated_at: new Date().toISOString(),
    note:
      "공개 소스 우선: SEC EDGAR · Google News RSS · 정책 캘린더 (API 키 불필요). DART/Finnhub/봇은 선택 보강.",
    dart: {
      ok: false,
      source: "opendart",
      hits: [],
      error: "optional (DART_API_KEY / bot)",
    },
    sec,
    finnhub: { ok: false, source: "finnhub", headlines: [], error: "optional key" },
    naver: news,
    policy,
    errors,
  };
}

async function enrichWithOptionalKeys(
  base: AiGovScreenPayload,
): Promise<AiGovScreenPayload> {
  const tasks: Promise<void>[] = [];
  let dart = base.dart;
  let finnhub = base.finnhub;

  if ((process.env.DART_API_KEY || "").trim()) {
    tasks.push(
      fetchDartHits().then((d) => {
        dart = d;
      }),
    );
  }
  if ((process.env.FINNHUB_API_KEY || "").trim()) {
    tasks.push(
      fetchFinnhubNews().then((f) => {
        finnhub = f;
      }),
    );
  }
  if (tasks.length) await Promise.all(tasks);

  const errors = [
    ...(base.errors || []),
    dart?.error,
    finnhub?.error,
  ].filter(Boolean) as string[];

  return {
    ...base,
    dart,
    finnhub,
    ok: Boolean(
      base.ok || dart?.ok || finnhub?.ok || (finnhub?.headlines || []).length,
    ),
    errors: errors.slice(0, 6),
  };
}

export async function GET(req: NextRequest) {
  // Prefer key-free open sources first (reliable on Vercel without bot secrets).
  try {
    const open = await enrichWithOptionalKeys(await openSourcesBundle());

    // Optional bot enrich — never block/replace open core if bot fails.
    const q =
      req.nextUrl.searchParams.get("q") || req.nextUrl.searchParams.get("query") || "";
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    try {
      const bot = await fetchBotJson<AiGovScreenPayload>(`/api/web/ai-gov-screen${qs}`, {
        timeoutMs: 12_000,
      });
      if (bot && typeof bot === "object" && bot.ok) {
        return NextResponse.json(
          {
            ...open,
            ...bot,
            // Keep open-source news if bot naver empty
            naver:
              bot.naver?.headlines?.length ? bot.naver : open.naver,
            policy:
              bot.policy?.events?.length ? bot.policy : open.policy,
            sec: bot.sec?.filings?.length ? bot.sec : open.sec,
            note:
              (bot.note || "") +
              " · 웹 공개소스(SEC/RSS/캘린더)와 병합. API 키 없이도 핵심 패널 표시.",
            generated_at: new Date().toISOString(),
            ok: true,
          } satisfies AiGovScreenPayload,
          {
            headers: {
              "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
            },
          },
        );
      }
    } catch {
      // ignore bot
    }

    return NextResponse.json(open, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        note: "정책 캘린더만 표시 (공개 소스 폴백).",
        policy: { ok: true, events: policyEvents() },
        dart: { ok: false, hits: [] },
        sec: { ok: false, filings: [] },
        finnhub: { ok: false, headlines: [] },
        naver: { ok: false, headlines: [] },
        error: exc instanceof Error ? exc.message : "ai-gov-screen failed",
      } satisfies AiGovScreenPayload,
      { status: 200 },
    );
  }
}

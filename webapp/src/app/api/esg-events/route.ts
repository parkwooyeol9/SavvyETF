import { NextResponse } from "next/server";

import { fetchBotJson } from "@/lib/bot";
import {
  ESG_EVENT_CATEGORY_META,
  ESG_EVENTS_R2_KEY,
  emptyEsgEventsPayload,
  isEsgEventsPayload,
  type EsgEventCategory,
  type EsgEventHit,
  type EsgEventsPayload,
} from "@/lib/esgEvents";
import { r2Configured, r2GetObjectText } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hitId(parts: string[]): string {
  return parts.join("|").slice(0, 80);
}

async function loadFromR2(): Promise<EsgEventsPayload | null> {
  try {
    if (!r2Configured()) return null;
    const text = await r2GetObjectText(ESG_EVENTS_R2_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text) as unknown;
    if (!isEsgEventsPayload(parsed) || !parsed.categories.length) return null;
    return { ...parsed, ok: true, source: parsed.source || "r2" };
  } catch {
    return null;
  }
}

function isFreshEnough(payload: EsgEventsPayload, maxAgeHours = 36): boolean {
  const raw = payload.generated_at || payload.as_of || "";
  if (!raw) return false;
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) {
    const ageH = (Date.now() - ts) / 3_600_000;
    return ageH >= 0 && ageH <= maxAgeHours;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const ageMs = Date.now() - Date.parse(`${raw}T09:00:00+09:00`);
    return ageMs >= 0 && ageMs <= maxAgeHours * 3_600_000;
  }
  return false;
}

async function fetchNewsFallback(): Promise<EsgEventsPayload> {
  const categories: EsgEventCategory[] = [];
  for (const meta of ESG_EVENT_CATEGORY_META) {
    const hits: EsgEventHit[] = [];
    const seen = new Set<string>();
    for (const q of meta.news_queries) {
      try {
        const url =
          "https://news.google.com/rss/search?" +
          new URLSearchParams({
            q: `${q} when:14d`,
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
        for (const item of items.slice(0, 5)) {
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
          if (!title || title.length < 8) continue;
          const relevant = meta.keywords.some((k) => title.includes(k));
          if (!relevant) continue;
          const key = title.toLowerCase().replace(/\s+/g, "");
          if (seen.has(key)) continue;
          seen.add(key);
          let date = "";
          const parsed = Date.parse(pub);
          if (Number.isFinite(parsed)) {
            date = new Date(parsed).toISOString().slice(0, 10);
          }
          hits.push({
            id: hitId([meta.id, title, date]),
            date,
            title,
            source,
            source_url: link,
            kind: "news",
            matched: meta.keywords.filter((k) => title.includes(k)),
          });
        }
      } catch {
        // soft-fail
      }
    }
    categories.push({
      id: meta.id,
      pillar: meta.pillar,
      title: meta.title,
      check: meta.check,
      sources_note: meta.sources_note,
      importance: meta.importance,
      hits: [],
      news: hits.slice(0, 8),
    });
  }

  const by_pillar = { E: 0, S: 0, G: 0 };
  let total = 0;
  for (const cat of categories) {
    const n = cat.hits.length + cat.news.length;
    total += n;
    by_pillar[cat.pillar] += n;
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    lookback_days: 14,
    timezone: "Asia/Seoul",
    note: "09:00 봇 스냅샷이 없어 뉴스 RSS 폴백입니다. KIND·DART 공시는 오전 갱신 후 표시됩니다.",
    channel: {
      name: "ESG 에이전트",
      handle: "@SavvyESG",
      href: "https://t.me/SavvyESG",
    },
    categories,
    summary: { total, fresh: 0, by_pillar },
    source: "news-fallback",
  };
}

export async function GET() {
  try {
    const fromR2 = await loadFromR2();
    if (fromR2 && (isFreshEnough(fromR2) || (fromR2.summary?.total || 0) > 0)) {
      return NextResponse.json(fromR2, {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
        },
      });
    }

    try {
      const bot = await fetchBotJson<EsgEventsPayload>("/api/web/esg-events", {
        timeoutMs: 12_000,
      });
      if (bot && isEsgEventsPayload(bot) && bot.ok) {
        return NextResponse.json(
          { ...bot, source: bot.source || "bot" },
          {
            headers: {
              "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
            },
          },
        );
      }
    } catch {
      // ignore bot
    }

    const fallback = await fetchNewsFallback();
    return NextResponse.json(fallback, {
      headers: {
        "Cache-Control": "public, s-maxage=180, stale-while-revalidate=600",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      emptyEsgEventsPayload(exc instanceof Error ? exc.message : "esg-events failed"),
      { status: 200 },
    );
  }
}

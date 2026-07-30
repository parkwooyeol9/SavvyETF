import { NextResponse } from "next/server";

import {
  ESG_REG_CURATED_EVENTS,
  ESG_REG_STATUS_LIST,
  computeJurisdictionScores,
  type EsgRegHeadline,
  type EsgRegPayload,
} from "@/lib/esgReg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

function kstYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchRegNewsRss(): Promise<EsgRegHeadline[]> {
  const queries = [
    "CSRD OR ESRS OR SFDR OR CBAM OR CSDDD OR ISSB",
    "ESG 공시 OR K-택소노미 OR 배출권 OR 녹색채권 OR ISSB",
    "SEC climate disclosure OR ESMA fund name",
  ];
  const out: EsgRegHeadline[] = [];
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
        headers: {
          "User-Agent": UA,
          Accept: "application/rss+xml, application/xml, text/xml",
        },
        next: { revalidate: 300 },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 6)) {
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
        out.push({
          headline: title,
          source,
          published: pub
            ? new Date(pub).toISOString().slice(0, 16).replace("T", " ")
            : "",
          url: link,
          query: q,
        });
      }
    } catch {
      // soft-fail
    }
  }
  return out.slice(0, 18);
}

export async function GET() {
  const fetchedAt = new Date().toISOString();
  const today = kstYmd();

  try {
    const events = [...ESG_REG_CURATED_EVENTS].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    const scores = computeJurisdictionScores(events);
    const headlines = await fetchRegNewsRss();

    const newlyPublished = events.filter((e) => e.date === today).length;

    const payload: EsgRegPayload = {
      ok: true,
      generated_at: fetchedAt,
      note:
        "핵심은 편집 검토 이벤트 카탈로그(2026년 신규·변경 기본 표시, 과거는 아카이브). " +
        "RSS는 보조 헤드라인. Regulatory Momentum Score는 관할권별·최근 lookback 합산이며 " +
        "국가 간 단일 순위로 해석하지 마세요.",
      timezone_display: "Asia/Seoul",
      statuses: ESG_REG_STATUS_LIST,
      events,
      scores,
      headlines,
      provenance: {
        cadence: "event",
        fetched_at: fetchedAt,
        collected_today: kstYmd(new Date(fetchedAt)) === today,
        newly_published_today: newlyPublished > 0,
        source_name: "SavvyETF curated catalog + Google News RSS",
        methodology:
          "Status taxonomy + momentum deltas (+2…-2) with per-event rationale. " +
          "No paid regulatory API. Missing official machine feeds → curated milestones.",
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        generated_at: fetchedAt,
        note: "",
        timezone_display: "Asia/Seoul",
        statuses: ESG_REG_STATUS_LIST,
        events: ESG_REG_CURATED_EVENTS,
        scores: computeJurisdictionScores(ESG_REG_CURATED_EVENTS),
        headlines: [],
        provenance: {
          cadence: "event",
          fetched_at: fetchedAt,
          collected_today: true,
          newly_published_today: false,
          source_name: "SavvyETF curated catalog",
          methodology: "Curated fallback only",
        },
        error: exc instanceof Error ? exc.message : "esg-reg fetch failed",
      } satisfies EsgRegPayload,
      { status: 200 },
    );
  }
}

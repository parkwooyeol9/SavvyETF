import { NextRequest, NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";
import { isDartEvent, scoreText } from "@/lib/nlpPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type NlpDartEvent = {
  date: string;
  title: string;
  matched: string[];
  url?: string | null;
  score?: number;
};

type DartPayload = {
  ok: boolean;
  code: string;
  name?: string;
  events: NlpDartEvent[];
  count?: number;
  error?: string;
};

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function isoFromYmd(raw: string): string {
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw;
}

async function fetchDartDirect(code: string): Promise<DartPayload> {
  const key = (process.env.DART_API_KEY || "").trim();
  if (!key) return { ok: false, code, events: [], error: "DART_API_KEY 없음" };
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 400);
  const events: NlpDartEvent[] = [];
  try {
    for (let page = 1; page <= 6 && events.length < 80; page++) {
      const url = new URL("https://opendart.fss.or.kr/api/list.json");
      url.searchParams.set("crtfc_key", key);
      url.searchParams.set("stock_code", code);
      url.searchParams.set("bgn_de", ymd(start));
      url.searchParams.set("end_de", ymd(end));
      url.searchParams.set("page_count", "100");
      url.searchParams.set("page_no", String(page));
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return { ok: false, code, events, error: `DART HTTP ${res.status}` };
      const payload = (await res.json()) as {
        list?: Array<Record<string, string>>;
        status?: string;
        message?: string;
      };
      if (payload.status && payload.status !== "000") {
        if (payload.status === "013") break;
        return { ok: false, code, events, error: payload.message || payload.status };
      }
      const rows = payload.list || [];
      if (!rows.length) break;
      for (const row of rows) {
        const report = (row.report_nm || "").trim();
        const matched = isDartEvent(report);
        if (!matched.length) continue;
        if ((row.stock_code || "").trim() && (row.stock_code || "").trim() !== code) continue;
        const scored = scoreText(report);
        const rcept = (row.rcept_no || "").trim();
        events.push({
          date: isoFromYmd(row.rcept_dt || ""),
          title: report,
          matched,
          url: rcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}` : undefined,
          score: scored.score,
        });
      }
      if (rows.length < 100) break;
    }
    return { ok: true, code, events: events.slice(0, 80), count: Math.min(events.length, 80) };
  } catch (exc) {
    return {
      ok: false,
      code,
      events,
      error: exc instanceof Error ? exc.message : "DART 실패",
    };
  }
}

async function loadDart(code: string): Promise<DartPayload> {
  try {
    const bot = await fetchBotJson<DartPayload>(`/api/web/nlp-dart?code=${encodeURIComponent(code)}`, {
      timeoutMs: 18_000,
    });
    if (bot && bot.ok && Array.isArray(bot.events) && bot.events.length) {
      return bot;
    }
  } catch {
    /* fall through */
  }
  return fetchDartDirect(code);
}

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") || "").trim();
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { ok: false, code, events: [], error: "종목코드가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const payload = await withServerCache(`nlp-dart:${code}:v1`, 600_000, 1_800_000, () =>
    loadDart(code),
  );
  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 502,
    headers: { "Cache-Control": cdnCacheHeader("yahooSlow") },
  });
}

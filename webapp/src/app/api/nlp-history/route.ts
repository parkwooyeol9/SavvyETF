import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  NLP_HISTORY_R2_PREFIX,
  emptyNlpHistoryIndex,
  emptyNlpHistorySeries,
  type NlpHistoryDay,
  type NlpHistoryIndex,
  type NlpHistoryMarket,
  type NlpHistoryName,
  type NlpHistorySeries,
} from "@/lib/nlpHistory";
import { r2Configured, r2GetObjectText } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function localCandidates(file: string): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "data", "nlp_history", file),
    path.join(cwd, "..", "data", "nlp_history", file),
    path.join(cwd, "public", "nlp-history", file),
  ];
}

async function readLocalJson(file: string): Promise<unknown | null> {
  for (const p of localCandidates(file)) {
    try {
      const text = await fs.readFile(p, "utf8");
      return JSON.parse(text) as unknown;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function readR2Json(file: string): Promise<unknown | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(`${NLP_HISTORY_R2_PREFIX}/${file}`);
    if (text) return JSON.parse(text) as unknown;
  } catch {
    /* fall through */
  }
  return null;
}

function richerName(a: NlpHistoryName, b: NlpHistoryName): NlpHistoryName {
  const ad = a.n_days || 0;
  const bd = b.n_days || 0;
  if (bd !== ad) return bd > ad ? b : a;
  return (b.n_headlines || 0) > (a.n_headlines || 0) ? b : a;
}

function mergeIndexes(a: NlpHistoryIndex | null, b: NlpHistoryIndex | null): NlpHistoryIndex | null {
  if (!a) return b;
  if (!b) return a;
  const byCode = new Map<string, NlpHistoryName>();
  for (const row of [...a.names, ...b.names]) {
    const prev = byCode.get(row.code);
    byCode.set(row.code, prev ? richerName(prev, row) : row);
  }
  const newer = (a.generated_at || "") >= (b.generated_at || "") ? a : b;
  return {
    ...newer,
    ok: true,
    names: [...byCode.values()],
  };
}

function richerSeries(a: NlpHistorySeries | null, b: NlpHistorySeries | null): NlpHistorySeries | null {
  if (!a) return b;
  if (!b) return a;
  if ((b.n_days || 0) !== (a.n_days || 0)) {
    return (b.n_days || 0) > (a.n_days || 0) ? b : a;
  }
  return (b.n_headlines || 0) > (a.n_headlines || 0) ? b : a;
}

function asMarket(v: unknown): NlpHistoryMarket {
  return v === "kosdaq" ? "kosdaq" : "kospi";
}

function parseIndex(raw: unknown): NlpHistoryIndex | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const namesIn = Array.isArray(row.names) ? row.names : [];
  const names: NlpHistoryName[] = [];
  for (const item of namesIn) {
    if (!item || typeof item !== "object") continue;
    const n = item as Record<string, unknown>;
    const code = String(n.code || "").trim();
    const name = String(n.name || "").trim();
    if (!code || !name) continue;
    names.push({
      code,
      name,
      market: asMarket(n.market),
      yahoo: String(n.yahoo || `${code}.KS`),
      n_days: typeof n.n_days === "number" ? n.n_days : undefined,
      n_headlines: typeof n.n_headlines === "number" ? n.n_headlines : undefined,
      last_score: typeof n.last_score === "number" ? n.last_score : null,
      last_date: typeof n.last_date === "string" ? n.last_date : null,
    });
  }
  if (!names.length) return null;
  return {
    ok: true,
    generated_at: typeof row.generated_at === "string" ? row.generated_at : undefined,
    lookback_days: typeof row.lookback_days === "number" ? row.lookback_days : 365,
    max_headlines_per_day: typeof row.max_headlines_per_day === "number" ? row.max_headlines_per_day : 8,
    methodology: Array.isArray(row.methodology) ? row.methodology.map(String) : [],
    names,
  };
}

function parseSeries(raw: unknown, fallbackCode: string): NlpHistorySeries | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const code = String(row.code || fallbackCode).trim();
  const daysIn = Array.isArray(row.days) ? row.days : [];
  const days: NlpHistoryDay[] = [];
  for (const item of daysIn) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const date = String(d.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const headlines = Array.isArray(d.headlines)
      ? d.headlines
          .map((h) => {
            if (!h || typeof h !== "object") return null;
            const hh = h as Record<string, unknown>;
            const title = String(hh.title || "").trim();
            if (!title) return null;
            return {
              title,
              source: String(hh.source || "news"),
              url: typeof hh.url === "string" ? hh.url : undefined,
              score: typeof hh.score === "number" ? hh.score : 0,
              matched: Array.isArray(hh.matched) ? hh.matched.map(String) : [],
            };
          })
          .filter((h): h is NonNullable<typeof h> => h != null)
      : [];
    days.push({
      date,
      score: typeof d.score === "number" ? d.score : 0,
      n: typeof d.n === "number" ? d.n : headlines.length,
      bull_n: typeof d.bull_n === "number" ? d.bull_n : 0,
      bear_n: typeof d.bear_n === "number" ? d.bear_n : 0,
      headlines,
    });
  }
  return {
    ok: true,
    code,
    name: String(row.name || code),
    market: asMarket(row.market),
    yahoo: String(row.yahoo || `${code}.KS`),
    query: typeof row.query === "string" ? row.query : undefined,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
    n_days: typeof row.n_days === "number" ? row.n_days : days.length,
    n_headlines: typeof row.n_headlines === "number" ? row.n_headlines : days.reduce((s, d) => s + d.n, 0),
    last_score: typeof row.last_score === "number" ? row.last_score : null,
    last_date: typeof row.last_date === "string" ? row.last_date : null,
    days,
  };
}

async function loadIndex(): Promise<NlpHistoryIndex> {
  const merged = mergeIndexes(
    parseIndex(await readR2Json("index.json")),
    parseIndex(await readLocalJson("index.json")),
  );
  if (merged) return merged;
  return emptyNlpHistoryIndex("1년 뉴스 아카이브가 아직 없습니다. 백필을 실행하세요.");
}

async function loadSeries(code: string): Promise<NlpHistorySeries> {
  const merged = richerSeries(
    parseSeries(await readR2Json(`${code}.json`), code),
    parseSeries(await readLocalJson(`${code}.json`), code),
  );
  if (merged) return merged;
  return emptyNlpHistorySeries(code, "해당 종목의 뉴스 시계열이 없습니다.");
}

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") || "").trim();
  try {
    if (!code) {
      const payload = await withServerCache("nlp-history:index:v3", 120_000, 600_000, loadIndex);
      return NextResponse.json(payload, {
        headers: { "Cache-Control": cdnCacheHeader("yahoo") },
      });
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(emptyNlpHistorySeries(code, "종목코드가 올바르지 않습니다."), { status: 400 });
    }
    const payload = await withServerCache(
      `nlp-history:code:${code}:v2`,
      120_000,
      600_000,
      () => loadSeries(code),
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : "로드 실패";
    if (code) return NextResponse.json(emptyNlpHistorySeries(code, msg), { status: 500 });
    return NextResponse.json(emptyNlpHistoryIndex(msg), { status: 500 });
  }
}

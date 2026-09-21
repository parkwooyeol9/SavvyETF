import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  emptyNlpClimatePayload,
  mergeNlpClimateRows,
  nlpClimatePoint,
  nlpClimateRowFromRaw,
  summarizeNlpClimate,
  type NlpClimatePayload,
  type NlpClimateRow,
} from "@/lib/nlpClimate";
import { NLP_HISTORY_R2_PREFIX, nlpKstTodayIso, nlpNameByCode } from "@/lib/nlpHistory";
import { r2Configured, r2GetObjectText } from "@/lib/r2";
import nlpHistorySeed from "@/data/nlpHistorySeed.json";
import type { NlpClimateNameDay } from "@/lib/nlpClimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const SERIES_DAYS = 90;

type DayMap = Map<string, Map<string, NlpClimateRow>>;

let seedDays: DayMap | null = null;
let localDays: DayMap | null = null;
let localTried = false;

function localCandidates(file: string): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "data", "nlp_history", file),
    path.join(cwd, "..", "data", "nlp_history", file),
  ];
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function readLocalJson(file: string): Promise<unknown | null> {
  for (const p of localCandidates(file)) {
    const hit = await readJsonFile(p);
    if (hit) return hit;
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

function putRow(target: DayMap, date: string, row: NlpClimateRow): void {
  let byCode = target.get(date);
  if (!byCode) {
    byCode = new Map();
    target.set(date, byCode);
  }
  const prev = byCode.get(row.code);
  byCode.set(row.code, prev ? mergeNlpClimateRows(prev, row) : row);
}

function ingestNamePayload(target: DayMap, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const row = raw as Record<string, unknown>;
  const code = String(row.code || "").trim();
  if (!/^\d{6}$/.test(code)) return;
  const days = Array.isArray(row.days) ? row.days : [];
  for (const item of days) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const date = String(d.date || "");
    if (!YMD.test(date)) continue;
    const parsed = nlpClimateRowFromRaw(code, { ...d, name: row.name, market: row.market });
    if (parsed) putRow(target, date, parsed);
  }
}

function ingestDayFile(target: DayMap, raw: unknown, fallbackDate?: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const date = String(row.date || fallbackDate || "");
  if (!YMD.test(date)) return null;
  const names = row.names && typeof row.names === "object" ? (row.names as Record<string, unknown>) : {};
  for (const [code, item] of Object.entries(names)) {
    if (!item || typeof item !== "object") continue;
    const parsed = nlpClimateRowFromRaw(code, item as Record<string, unknown>);
    if (parsed) putRow(target, date, parsed);
  }
  return date;
}

function seedIndex(): DayMap {
  if (seedDays) return seedDays;
  const target: DayMap = new Map();
  const raw = nlpHistorySeed as { names?: unknown[] };
  for (const name of raw.names || []) ingestNamePayload(target, name);
  seedDays = target;
  return target;
}

async function localIndex(): Promise<DayMap> {
  if (localTried && localDays) return localDays;
  if (localTried) return new Map();
  localTried = true;
  const dirs = [
    path.join(process.cwd(), "data", "nlp_history"),
    path.join(process.cwd(), "..", "data", "nlp_history"),
  ];
  let dir: string | null = null;
  for (const candidate of dirs) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        dir = candidate;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!dir) {
    localDays = new Map();
    return localDays;
  }
  const target: DayMap = new Map();
  const files = await fs.readdir(dir);
  await Promise.all(
    files
      .filter((name) => /^\d{6}\.json$/.test(name))
      .map(async (name) => {
        ingestNamePayload(target, await readJsonFile(path.join(dir!, name)));
      }),
  );
  localDays = target;
  return target;
}

function cloneDays(src: DayMap): DayMap {
  const out: DayMap = new Map();
  for (const [date, rows] of src) {
    out.set(date, new Map(rows));
  }
  return out;
}

function mergeDayMaps(base: DayMap, extra: DayMap): DayMap {
  for (const [date, rows] of extra) {
    for (const row of rows.values()) putRow(base, date, row);
  }
  return base;
}

function shiftIso(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, (d || 1) + delta));
  return dt.toISOString().slice(0, 10);
}

async function overlayRecentDayFiles(target: DayMap, around: string): Promise<void> {
  const dates = new Set<string>();
  dates.add(around);
  dates.add(nlpKstTodayIso());
  for (let i = 0; i < 10; i += 1) dates.add(shiftIso(around, -i));
  await Promise.all(
    [...dates].map(async (date) => {
      const file = `days/${date}.json`;
      ingestDayFile(target, await readR2Json(file), date);
      ingestDayFile(target, await readLocalJson(file), date);
    }),
  );
}

function namesNeedingHeadlines(rows: NlpClimateRow[], extraCodes: string[] = []): string[] {
  const missing = rows.filter((row) => !row.headlines.length);
  const byAbs = [...missing].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const bull = missing.filter((row) => row.score >= 12).sort((a, b) => b.score - a.score);
  const bear = missing.filter((row) => row.score <= -12).sort((a, b) => a.score - b.score);
  const codes: string[] = [];
  const add = (code: string) => {
    if (!/^\d{6}$/.test(code) || codes.includes(code) || codes.length >= 28) return;
    codes.push(code);
  };
  extraCodes.forEach(add);
  bull.slice(0, 8).forEach((row) => add(row.code));
  bear.slice(0, 8).forEach((row) => add(row.code));
  byAbs.forEach((row) => add(row.code));
  return codes;
}

async function hydrateNameHeadlines(target: DayMap, code: string, date: string): Promise<void> {
  const month = date.slice(0, 7);
  ingestNamePayload(target, await readR2Json(`${code}.json`));
  ingestNamePayload(target, await readLocalJson(`${code}.json`));
  ingestNamePayload(target, await readR2Json(`headlines/${code}/${month}.json`));
  ingestNamePayload(target, await readLocalJson(`headlines/${code}/${month}.json`));
}

function rowsOn(target: DayMap, date: string): NlpClimateRow[] {
  return [...(target.get(date)?.values() || [])];
}

function buildPayload(target: DayMap, date: string, source: string): NlpClimatePayload {
  const dates = [...target.keys()].sort();
  if (!dates.length) return emptyNlpClimatePayload("뉴스 일별 단면이 아직 없습니다.");
  const max_date = dates[dates.length - 1]!;
  const min_date = dates[0]!;
  let chosen = max_date;
  if (YMD.test(date)) {
    if (date < min_date) chosen = min_date;
    else if (date > max_date) chosen = max_date;
    else chosen = date;
  }
  const rows = rowsOn(target, chosen);
  const from = shiftIso(max_date, -(SERIES_DAYS - 1));
  const seriesDates = dates.filter((d) => d >= from);
  const seriesFor = (market: "all" | "kospi" | "kosdaq") =>
    seriesDates.map((d) => nlpClimatePoint(d, rowsOn(target, d), market));
  return {
    ok: true,
    date: chosen,
    min_date,
    max_date,
    dates,
    all: summarizeNlpClimate(chosen, "all", rows),
    kospi: summarizeNlpClimate(chosen, "kospi", rows),
    kosdaq: summarizeNlpClimate(chosen, "kosdaq", rows),
    series: {
      all: seriesFor("all"),
      kospi: seriesFor("kospi"),
      kosdaq: seriesFor("kosdaq"),
    },
    source,
  };
}

async function assembleClimate(date: string, extraCodes: string[] = []): Promise<{
  target: DayMap;
  payload: NlpClimatePayload;
}> {
  const target = cloneDays(seedIndex());
  mergeDayMaps(target, await localIndex());
  const wanted = YMD.test(date) ? date : nlpKstTodayIso();
  await overlayRecentDayFiles(target, wanted);
  const day = YMD.test(date) ? date : wanted;
  ingestDayFile(target, await readR2Json(`days/${day}.json`), day);
  ingestDayFile(target, await readLocalJson(`days/${day}.json`), day);
  const draft = buildPayload(target, date, "seed");
  const chosen = draft.date;
  const hydrateCodes = namesNeedingHeadlines(rowsOn(target, chosen), extraCodes);
  if (hydrateCodes.length) {
    await Promise.all(hydrateCodes.map((code) => hydrateNameHeadlines(target, code, chosen)));
  }
  const sources = ["seed"];
  if (localDays && localDays.size) sources.push("local");
  if (r2Configured()) sources.push("r2");
  return { target, payload: buildPayload(target, date, sources.join("+")) };
}

async function loadClimate(date: string, extraCodes: string[] = []): Promise<NlpClimatePayload> {
  return (await assembleClimate(date, extraCodes)).payload;
}

async function loadNameDay(date: string, code: string): Promise<NlpClimateNameDay> {
  const { target, payload } = await assembleClimate(date, [code]);
  const spec = nlpNameByCode(code);
  const row = rowsOn(target, payload.date).find((item) => item.code === code);
  const name = row?.name || spec?.name || code;
  const headlines = (row?.headlines || []).map((h) => ({
    code,
    name,
    title: h.title,
    source: h.source,
    url: h.url,
    score: h.score,
  }));
  return {
    ok: true,
    date: payload.date,
    code,
    name,
    score: row?.score ?? 0,
    n: row?.n || headlines.length,
    headlines,
    error: headlines.length ? undefined : "이 날짜에 저장된 제목이 없습니다.",
  };
}

export async function GET(req: NextRequest) {
  const date = (req.nextUrl.searchParams.get("date") || "").trim();
  const code = (req.nextUrl.searchParams.get("code") || "").trim();
  if (date && !YMD.test(date)) {
    return NextResponse.json(emptyNlpClimatePayload("날짜 형식이 올바르지 않습니다."), { status: 400 });
  }
  if (code && !/^\d{6}$/.test(code)) {
    return NextResponse.json({ ok: false, date, code, name: code, score: 0, n: 0, headlines: [], error: "종목코드가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    if (code) {
      const payload = await withServerCache(
        `nlp-climate:${date || "latest"}:${code}:v2`,
        120_000,
        600_000,
        () => loadNameDay(date, code),
      );
      return NextResponse.json(payload, {
        headers: { "Cache-Control": cdnCacheHeader("yahoo") },
      });
    }
    const payload = await withServerCache(
      `nlp-climate:${date || "latest"}:v2`,
      120_000,
      600_000,
      () => loadClimate(date),
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : "로드 실패";
    if (code) {
      return NextResponse.json({ ok: false, date, code, name: code, score: 0, n: 0, headlines: [], error: msg }, { status: 500 });
    }
    return NextResponse.json(emptyNlpClimatePayload(msg), { status: 500 });
  }
}

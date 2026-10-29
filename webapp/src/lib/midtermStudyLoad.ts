import { inflateRawSync } from "node:zlib";

import krxBundle from "@/data/krSectorMidterm.json";
import { withServerCache } from "@/lib/apiCache";
import {
  KR_MARKET_SPECS,
  KR_SECTOR_SPECS,
  MARKET_SPECS,
  MIDTERM_ELECTIONS,
  WINDOW_POST_DAYS,
  WINDOW_PRE_DAYS,
  addCalendarDays,
  buildMidtermStudyPayload,
  emptyMidtermStudyPayload,
  parseFrench12DailyCsv,
  type MidtermStudyPayload,
  type PricePoint,
} from "@/lib/midtermStudy";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const FRENCH_ZIP =
  "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/12_Industry_Portfolios_daily_CSV.zip";
const NAVER_SISE = "https://api.finance.naver.com/siseJson.naver";
const SERIES_START = "1950-01-01";
const CACHE_KEY = "midterm-study:v4";

/** Daily closes around each midterm (election −30d … +400d), for the Excel raw sheets. */
export type MidtermRawWindow = {
  election: string;
  dates: string[];
  closes: Record<string, Array<number | null>>;
};

export type MidtermStudyBundle = {
  payload: MidtermStudyPayload;
  raw: MidtermRawWindow[];
};

type KrxBundle = {
  generated_at: string | null;
  source: string;
  first_seen: Record<string, string>;
  windows: Array<{ election: string; dates: string[]; closes: Record<string, Array<number | null>> }>;
};

function unzipFirstFile(buf: Buffer): string {
  let offset = 0;
  while (offset < buf.length - 30 && buf.readUInt32LE(offset) !== 0x04034b50) {
    offset += 1;
  }
  if (offset >= buf.length - 30) throw new Error("zip local header missing");
  const compression = buf.readUInt16LE(offset + 8);
  const compressedSize = buf.readUInt32LE(offset + 18);
  const nameLen = buf.readUInt16LE(offset + 26);
  const extraLen = buf.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const data =
    compressedSize > 0 && compressedSize < 0xffff_ffff
      ? buf.subarray(dataStart, dataStart + compressedSize)
      : buf.subarray(dataStart);
  if (compression === 0) return data.toString("latin1");
  if (compression === 8) return inflateRawSync(data).toString("latin1");
  throw new Error(`unsupported zip compression ${compression}`);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function fetchYahooDaily(symbol: string): Promise<PricePoint[]> {
  const period1 = Math.floor(Date.parse(`${SERIES_START}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  const url =
    `${YAHOO_CHART}/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=div%7Csplit`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{ close?: Array<number | null> }>;
          adjclose?: Array<{ adjclose?: Array<number | null> }>;
        };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const adj = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const map = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i++) {
    const px = adj[i] ?? closes[i];
    if (px == null || !Number.isFinite(px) || px <= 0) continue;
    const iso = new Date(timestamps[i]! * 1000).toISOString().slice(0, 10);
    map.set(iso, px);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close }));
}

/** Naver siseJson: header row is EUC-KR text, data rows are ["YYYYMMDD", o, h, l, c, ...]. */
async function fetchNaverDaily(symbol: string, start: string): Promise<PricePoint[]> {
  const url =
    `${NAVER_SISE}?symbol=${encodeURIComponent(symbol)}&requestType=1` +
    `&startTime=${start.replace(/-/g, "")}&endTime=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}` +
    `&timeframe=day`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://finance.naver.com/" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Naver ${symbol}: HTTP ${res.status}`);
  const text = await res.text();
  const out: PricePoint[] = [];
  const re = /\["(\d{8})",\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const close = Number(m[5]);
    if (!(close > 0)) continue;
    const d = m[1]!;
    out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, close });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** KRX index windows bundled by 04_국내시장/krx_sector_midterm.py, keyed by KRX code. */
function krxSeries(): Record<string, PricePoint[]> {
  const bundle = krxBundle as KrxBundle;
  const byCode: Record<string, Map<string, number>> = {};
  for (const w of bundle.windows || []) {
    for (const [code, closes] of Object.entries(w.closes || {})) {
      const m = byCode[code] || new Map<string, number>();
      w.dates.forEach((date, i) => {
        const v = closes[i];
        if (v != null && v > 0) m.set(date, v);
      });
      byCode[code] = m;
    }
  }
  const out: Record<string, PricePoint[]> = {};
  for (const [code, m] of Object.entries(byCode)) {
    out[code] = [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, close]) => ({ date, close }));
  }
  return out;
}

/** Splice: live series wins on overlapping dates; older bundle points fill the front. */
function splice(live: PricePoint[], older: PricePoint[]): PricePoint[] {
  if (!older.length) return live;
  const first = live[0]?.date ?? "9999-12-31";
  return [...older.filter((p) => p.date < first), ...live];
}

function seriesSpan(points: PricePoint[]): string {
  return points.length
    ? `${points[0]!.date}–${points[points.length - 1]!.date} (${points.length}일)`
    : "시계열 없음";
}

function rawWindows(seriesMap: Record<string, PricePoint[]>): MidtermRawWindow[] {
  return MIDTERM_ELECTIONS.map((e) => {
    const lo = addCalendarDays(e.date, -WINDOW_PRE_DAYS);
    const hi = addCalendarDays(e.date, WINDOW_POST_DAYS);
    const byAsset: Record<string, Map<string, number>> = {};
    const dates = new Set<string>();
    for (const [id, points] of Object.entries(seriesMap)) {
      const m = new Map<string, number>();
      for (const p of points) {
        if (p.date < lo) continue;
        if (p.date > hi) break;
        m.set(p.date, p.close);
        dates.add(p.date);
      }
      if (m.size) byAsset[id] = m;
    }
    const sorted = [...dates].sort();
    const closes: Record<string, Array<number | null>> = {};
    for (const [id, m] of Object.entries(byAsset)) {
      closes[id] = sorted.map((d) => m.get(d) ?? null);
    }
    return { election: e.date, dates: sorted, closes };
  });
}

async function fetchFrenchIndustries(): Promise<Record<string, PricePoint[]>> {
  const res = await fetch(FRENCH_ZIP, {
    headers: { "User-Agent": UA, Accept: "application/zip,*/*" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Ken French: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const csv = unzipFirstFile(buf);
  return parseFrench12DailyCsv(csv);
}

async function buildBundle(): Promise<MidtermStudyBundle> {
  const coverage: string[] = [];
  const seriesMap: Record<string, PricePoint[]> = {};

  const markets = await mapPool(MARKET_SPECS, 3, async (spec) => {
    try {
      const points = await fetchYahooDaily(spec.symbol!);
      return { id: spec.id, points, error: points.length ? null : "empty" };
    } catch (exc) {
      return {
        id: spec.id,
        points: [] as PricePoint[],
        error: exc instanceof Error ? exc.message : String(exc),
      };
    }
  });
  for (const row of markets) {
    seriesMap[row.id] = row.points;
    const spec = MARKET_SPECS.find((s) => s.id === row.id);
    if (row.points.length) {
      coverage.push(
        `${spec?.label || row.id} ${row.points[0]!.date}–${row.points[row.points.length - 1]!.date} (${row.points.length}일)`,
      );
    } else {
      coverage.push(`${spec?.label || row.id}: ${row.error || "시계열 없음"}`);
    }
  }

  try {
    const french = await fetchFrenchIndustries();
    let n = 0;
    let first = "";
    let last = "";
    for (const [id, points] of Object.entries(french)) {
      seriesMap[id] = points;
      n = Math.max(n, points.length);
      if (points[0] && (!first || points[0].date < first)) first = points[0].date;
      const end = points[points.length - 1];
      if (end && end.date > last) last = end.date;
    }
    coverage.push(`Ken French 12산업(가치가중) ${first}–${last} (${n}일)`);
  } catch (exc) {
    coverage.push(`업종 대용(Ken French) 실패: ${exc instanceof Error ? exc.message : String(exc)}`);
  }

  const krx = krxSeries();
  const krxNote = (krxBundle as KrxBundle).generated_at
    ? `KRX 업종지수 번들 ${(krxBundle as KrxBundle).generated_at!.slice(0, 10)} 수집`
    : "KRX 업종지수 번들 없음(04_국내시장/krx_sector_midterm.py 실행 전)";
  for (const spec of KR_MARKET_SPECS) {
    let live: PricePoint[] = [];
    try {
      live = await fetchNaverDaily(spec.naver!, "1990-01-01");
    } catch (exc) {
      coverage.push(`${spec.label} 네이버 실패: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
    seriesMap[spec.id] = splice(live, krx[spec.krx!] || []);
    coverage.push(`${spec.label} ${seriesSpan(seriesMap[spec.id]!)}`);
  }
  let krSectors = 0;
  for (const spec of KR_SECTOR_SPECS) {
    const points = krx[spec.krx!] || [];
    seriesMap[spec.id] = points;
    if (points.length) krSectors += 1;
  }
  coverage.push(krSectors ? `${krxNote} · 업종 ${krSectors}개` : krxNote);

  if (!(seriesMap.spx && seriesMap.spx.length >= 200)) {
    return {
      payload: emptyMidtermStudyPayload("S&P 500 일별 시계열을 불러오지 못했습니다."),
      raw: [],
    };
  }
  return { payload: buildMidtermStudyPayload(seriesMap, coverage), raw: rawWindows(seriesMap) };
}

export async function loadMidtermStudyBundle(): Promise<MidtermStudyBundle> {
  return withServerCache(CACHE_KEY, 24 * 3_600_000, 48 * 3_600_000, buildBundle);
}

export async function loadMidtermStudyPayload(): Promise<MidtermStudyPayload> {
  return (await loadMidtermStudyBundle()).payload;
}

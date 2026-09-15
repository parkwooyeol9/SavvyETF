import { inflateRawSync } from "node:zlib";

import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  MARKET_SPECS,
  buildMidtermStudyPayload,
  emptyMidtermStudyPayload,
  parseFrench12DailyCsv,
  type PricePoint,
} from "@/lib/midtermStudy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const FRENCH_ZIP =
  "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/12_Industry_Portfolios_daily_CSV.zip";
const SERIES_START = "1950-01-01";

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

async function buildPayload() {
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

  if (!(seriesMap.spx && seriesMap.spx.length >= 200)) {
    return emptyMidtermStudyPayload("S&P 500 일별 시계열을 불러오지 못했습니다.");
  }
  return buildMidtermStudyPayload(seriesMap, coverage);
}

export async function GET() {
  try {
    const payload = await withServerCache(
      "midterm-study:v2",
      24 * 3_600_000,
      48 * 3_600_000,
      buildPayload,
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : "midterm study failed";
    return NextResponse.json(emptyMidtermStudyPayload(message), { status: 500 });
  }
}

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import {
  ETF_FLOW_US_UNIVERSE,
  aggregateEtfFlowGroups,
  flowsFromNavShares,
  type EtfFlowBucket,
  type EtfFlowDayPoint,
  type EtfFlowPayload,
  type NavShareDay,
} from "@/lib/etfFlow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

function parseSsgaDate(raw: unknown): string | null {
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const text = String(raw).trim();
  // 23-Jul-2026
  const m = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[2]];
    if (!mm) return null;
    return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).replace(/,/g, "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

async function fetchSsgaNavHist(
  ticker: string,
  maxRows: number,
): Promise<NavShareDay[]> {
  const url = `https://www.ssga.com/library-content/products/fund-data/etfs/us/navhist-us-en-${ticker.toLowerCase()}.xlsx`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
      Referer: "https://www.ssga.com/",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Newest rows first; limit rows for speed.
  const wb = XLSX.read(buf, { type: "buffer", sheetRows: maxRows + 8 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  }) as unknown[][];

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i];
    if (
      r &&
      String(r[0] ?? "").trim() === "Date" &&
      String(r[1] ?? "").toUpperCase().includes("NAV")
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error(`navhist header missing for ${ticker}`);

  const days: NavShareDay[] = [];
  for (let i = headerIdx + 1; i < rows.length && days.length < maxRows + 1; i++) {
    const r = rows[i];
    if (!r || r[0] == null) continue;
    const date = parseSsgaDate(r[0]);
    const nav = parseNumber(r[1]);
    const shares = parseNumber(r[2]);
    const aum = parseNumber(r[3]);
    if (!date || nav == null || shares == null || aum == null) continue;
    if (nav <= 0 || shares <= 0 || aum <= 0) continue;
    days.push({ date, nav, shares, aum });
  }
  // File is newest→oldest; chronological for Δshares.
  return days.reverse();
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bucketParam = (searchParams.get("bucket") || "all").toLowerCase();
    const bucketFilter: EtfFlowBucket | "all" =
      bucketParam === "country" ||
      bucketParam === "sector" ||
      bucketParam === "theme"
        ? bucketParam
        : "all";
    const lookbackRaw = Number(searchParams.get("days") || "40");
    const lookbackDays = Number.isFinite(lookbackRaw)
      ? Math.min(90, Math.max(10, Math.floor(lookbackRaw)))
      : 40;

    const universe =
      bucketFilter === "all"
        ? ETF_FLOW_US_UNIVERSE
        : ETF_FLOW_US_UNIVERSE.filter((m) => m.bucket === bucketFilter);

    const perCode = await mapPool(universe, 5, async (meta) => {
      try {
        const days = await fetchSsgaNavHist(meta.code, lookbackDays + 1);
        const trimmed = days.slice(-(lookbackDays + 1));
        // USD millions
        const series = flowsFromNavShares(trimmed, 1e6).slice(-lookbackDays);
        return { meta, series, error: null as string | null };
      } catch (exc) {
        return {
          meta,
          series: [] as EtfFlowDayPoint[],
          error: exc instanceof Error ? exc.message : "fetch failed",
        };
      }
    });

    const groups = aggregateEtfFlowGroups(
      perCode.map(({ meta, series }) => ({ meta, series })),
    );
    const errors = perCode.filter((p) => p.error).length;

    const payload: EtfFlowPayload = {
      ok: true,
      market: "us",
      unit: "usd_mn",
      generated_at: new Date().toISOString(),
      source: "State Street SSGA navhist (NAV · Shares Outstanding · Total Net Assets)",
      formula: "flow_t ≈ NAV_{t-1} × Δshares_t",
      lookback_days: lookbackDays,
      note:
        "미국 상장 SPDR 큐레이션 유니버스. SSGA 공개 일별 NAV·상장좌수로 창출/환매를 추정합니다. " +
        "단위는 USD million. iShares/Invesco 등 타 운용사 일별 shares 히스토리는 동일 공개 포맷이 없어 1차에서 SPDR로 한정했습니다." +
        (errors ? ` · ${errors}종목 수집 실패` : ""),
      groups,
    };
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        market: "us",
        unit: "usd_mn",
        error: exc instanceof Error ? exc.message : "US ETF flow fetch failed",
      } satisfies EtfFlowPayload,
      { status: 500 },
    );
  }
}

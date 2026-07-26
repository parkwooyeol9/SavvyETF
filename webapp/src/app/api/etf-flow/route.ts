import { NextResponse } from "next/server";

import {
  ETF_FLOW_UNIVERSE,
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

function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).replace(/,/g, "").replace(/%/g, "").trim();
  if (!text || text === "-" || text === "N/A") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: "https://finance.naver.com/",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    return new TextDecoder("euc-kr").decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

/** Reconstruct daily shares ≈ 외국인 보유주수 / 보유율, AUM ≈ shares × close. */
async function fetchShareSeries(code: string, maxPages = 3): Promise<NavShareDay[]> {
  const byDate = new Map<string, NavShareDay>();
  for (let page = 1; page <= maxPages; page++) {
    let html = "";
    try {
      html = await fetchText(
        `https://finance.naver.com/item/frgn.naver?code=${code}&page=${page}`,
      );
    } catch {
      break;
    }
    let found = 0;
    const rows = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
    for (const row of rows) {
      const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) =>
        stripTags(td[1]).replace(/\s+/g, ""),
      );
      if (tds.length < 9 || !/^\d{4}\.\d{2}\.\d{2}$/.test(tds[0] || "")) continue;
      const iso = tds[0].replace(/\./g, "-");
      const close = parseNumber(tds[1]);
      const hold = parseNumber(tds[7]);
      const rate = parseNumber(tds[8]);
      if (close == null || hold == null || rate == null || rate <= 0 || hold <= 0) {
        continue;
      }
      const shares = hold / (rate / 100);
      byDate.set(iso, {
        date: iso,
        nav: close,
        shares,
        aum: shares * close,
      });
      found += 1;
    }
    if (found === 0) break;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
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
    const pages = lookbackDays > 40 ? 4 : 3;

    const universe =
      bucketFilter === "all"
        ? ETF_FLOW_UNIVERSE
        : ETF_FLOW_UNIVERSE.filter((m) => m.bucket === bucketFilter);

    const perCode = await mapPool(universe, 6, async (meta) => {
      try {
        const days = await fetchShareSeries(meta.code, pages);
        const trimmed = days.slice(-(lookbackDays + 1));
        const series = flowsFromNavShares(trimmed, 1e8).slice(-lookbackDays);
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
      market: "kr",
      unit: "krw_eok",
      generated_at: new Date().toISOString(),
      source: "Naver Finance (외국인 보유주수÷보유율 → 상장좌수 역산)",
      formula: "flow_t ≈ close_{t-1} × Δshares_t  (close as NAV proxy)",
      lookback_days: lookbackDays,
      note:
        "국내 상장 ETF 큐레이션 유니버스. 공개 ‘수급 계정’이 없어 전일 종가(NAV 대용)×상장좌수 증감으로 추정합니다. " +
        "상장좌수는 외국인 보유주수÷보유율로 역산합니다." +
        (errors ? ` · ${errors}종목 수집 실패` : ""),
      groups,
    };
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        market: "kr",
        unit: "krw_eok",
        error: exc instanceof Error ? exc.message : "ETF flow fetch failed",
      } satisfies EtfFlowPayload,
      { status: 500 },
    );
  }
}

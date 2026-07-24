import { NextResponse } from "next/server";

import {
  ETF_FLOW_BUCKET_LABELS,
  ETF_FLOW_UNIVERSE,
  type EtfFlowBucket,
  type EtfFlowDayPoint,
  type EtfFlowGroupSeries,
  type EtfFlowPayload,
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

type ShareDay = {
  date: string; // YYYY-MM-DD
  close: number;
  shares: number;
  aum: number;
};

/** Reconstruct daily shares ≈ 외국인 보유주수 / 보유율, AUM ≈ shares × close. */
async function fetchShareSeries(code: string, maxPages = 3): Promise<ShareDay[]> {
  const byDate = new Map<string, ShareDay>();
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
        close,
        shares,
        aum: shares * close,
      });
      found += 1;
    }
    if (found === 0) break;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function flowsFromShares(days: ShareDay[]): EtfFlowDayPoint[] {
  const out: EtfFlowDayPoint[] = [];
  let cum = 0;
  for (let i = 0; i < days.length; i++) {
    const cur = days[i];
    let flow = 0;
    if (i > 0) {
      const prev = days[i - 1];
      // flow_t ≈ NAV_{t-1} × Δshares  (close as NAV proxy)
      flow = prev.close * (cur.shares - prev.shares);
    }
    cum += flow;
    out.push({
      date: cur.date,
      flow_eok: flow / 1e8,
      flow_cum_eok: cum / 1e8,
      aum_eok: cur.aum / 1e8,
    });
  }
  return out;
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
      bucketParam === "country" || bucketParam === "sector" || bucketParam === "theme"
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
        // Keep one extra day so first visible Δshares uses prior NAV.
        const trimmed = days.slice(-(lookbackDays + 1));
        const series = flowsFromShares(trimmed).slice(-lookbackDays);
        return { meta, series, error: null as string | null };
      } catch (exc) {
        return {
          meta,
          series: [] as EtfFlowDayPoint[],
          error: exc instanceof Error ? exc.message : "fetch failed",
        };
      }
    });

    const groupMap = new Map<
      string,
      {
        key: string;
        label: string;
        bucket: EtfFlowBucket;
        color: string;
        members: Array<{ code: string; name: string }>;
        byDate: Map<string, { flow: number; aum: number }>;
      }
    >();

    for (const item of perCode) {
      const gkey = `${item.meta.bucket}:${item.meta.label}`;
      let g = groupMap.get(gkey);
      if (!g) {
        g = {
          key: gkey,
          label: item.meta.label,
          bucket: item.meta.bucket,
          color: item.meta.color,
          members: [],
          byDate: new Map(),
        };
        groupMap.set(gkey, g);
      }
      g.members.push({ code: item.meta.code, name: item.meta.name });
      for (const pt of item.series) {
        const cur = g.byDate.get(pt.date) || { flow: 0, aum: 0 };
        cur.flow += pt.flow_eok;
        cur.aum += pt.aum_eok;
        g.byDate.set(pt.date, cur);
      }
    }

    const bucketOrder: EtfFlowBucket[] = ["country", "sector", "theme"];
    const groups: EtfFlowGroupSeries[] = [...groupMap.values()]
      .sort((a, b) => {
        const bi = bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket);
        if (bi !== 0) return bi;
        return a.label.localeCompare(b.label, "ko");
      })
      .map((g) => {
        const dates = [...g.byDate.keys()].sort();
        let cum = 0;
        const series: EtfFlowDayPoint[] = dates.map((date) => {
          const row = g.byDate.get(date)!;
          cum += row.flow;
          return {
            date,
            flow_eok: row.flow,
            flow_cum_eok: cum,
            aum_eok: row.aum,
          };
        });
        const latest = series[series.length - 1];
        return {
          key: g.key,
          label: `${ETF_FLOW_BUCKET_LABELS[g.bucket]} · ${g.label}`,
          bucket: g.bucket,
          color: g.color,
          members: g.members,
          latest_flow_eok: latest?.flow_eok ?? 0,
          latest_aum_eok: latest?.aum_eok ?? 0,
          flow_cum_eok: latest?.flow_cum_eok ?? 0,
          series,
        };
      });

    const errors = perCode.filter((p) => p.error).length;
    const payload: EtfFlowPayload = {
      ok: true,
      generated_at: new Date().toISOString(),
      source: "Naver Finance (외국인 보유주수÷보유율 → 상장좌수 역산)",
      formula: "flow_t ≈ close_{t-1} × Δshares_t  (close as NAV proxy)",
      lookback_days: lookbackDays,
      note:
        "국내 상장 ETF 큐레이션 유니버스. 공개 ‘수급 계정’이 없어 전일 종가(NAV 대용)×상장좌수 증감으로 추정합니다. " +
        "상장좌수는 외국인 보유주수÷보유율로 역산합니다. " +
        "미국 상장 ETF 일별 shares outstanding 히스토리는 무료 안정 API가 없어 1차 범위에서 제외했습니다." +
        (errors ? ` · ${errors}종목 수집 실패` : ""),
      groups,
    };
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "ETF flow fetch failed",
      } satisfies EtfFlowPayload,
      { status: 500 },
    );
  }
}

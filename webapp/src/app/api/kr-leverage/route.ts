import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchForcedSellBoard } from "@/lib/kofiaFreeSis";
import {
  LEV_GROUP_METAS,
  levGroupKey,
  SINGLE_STOCK_LEV_ETFS,
  SINGLE_STOCK_LEV_LISTING_DATE,
  SINGLE_STOCK_LEV_LISTING_YMD,
  type LevBrokerSide,
  type LevDealerBoard,
  type LevDeleverBucket,
  type LevDeleveraging,
  type LevDeleverPoint,
  type LevGroupKey,
  type LevGroupPoint,
  type LevGroupSeries,
  type LevInvestorDay,
  type SingleStockLevBoard,
  type SingleStockLevRow,
} from "@/lib/krMarket";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).replace(/,/g, "").replace(/%/g, "").replace(/^\+/, "").trim();
  if (!text || text === "-" || text === "N/A") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: "https://m.stock.naver.com/",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

function decodeHtmlBuffer(buf: Buffer, contentType: string | null): string {
  const header = (contentType || "").toLowerCase();
  const headerCharset = header.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]?.toLowerCase();
  const peek = buf.subarray(0, Math.min(buf.length, 4096)).toString("latin1");
  const metaCharset = peek
    .match(/charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i)?.[1]
    ?.toLowerCase();
  const raw = headerCharset || metaCharset || "utf-8";
  const encoding =
    raw === "euc-kr" || raw === "euckr" || raw === "ks_c_5601-1987" || raw === "cp949"
      ? "euc-kr"
      : raw === "utf8" || raw === "utf-8"
        ? "utf-8"
        : raw;
  try {
    return new TextDecoder(encoding).decode(buf);
  } catch {
    return encoding === "utf-8"
      ? new TextDecoder("euc-kr").decode(buf)
      : buf.toString("utf-8");
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      Referer: "https://finance.naver.com/",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return decodeHtmlBuffer(buf, res.headers.get("content-type"));
}

function todayBizdateKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, "");
}

function ymdToIso(ymd: string): string {
  if (ymd.length !== 8) return ymd;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

type EtfDayPoint = {
  date: string;
  close: number;
  volume: number;
  value: number;
  aum: number;
};

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchSiseDayPoints(code: string): Promise<EtfDayPoint[]> {
  const end = todayBizdateKst();
  const url =
    `https://fchart.stock.naver.com/siseJson.naver?symbol=${code}` +
    `&requestType=1&startTime=${SINGLE_STOCK_LEV_LISTING_YMD}&endTime=${end}&timeframe=day`;
  const text = await fetchText(url);
  const matches = text.matchAll(
    /\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g,
  );
  const out: EtfDayPoint[] = [];
  for (const m of matches) {
    const date = m[1];
    if (date < SINGLE_STOCK_LEV_LISTING_YMD) continue;
    const close = Number(m[5]);
    const volume = Number(m[6]);
    if (!Number.isFinite(close) || !Number.isFinite(volume)) continue;
    out.push({
      date,
      close,
      volume,
      value: close * volume,
      aum: 0,
    });
  }
  return out;
}

/** Reconstruct daily AUM ≈ 상장주식수×종가 via 외국인 보유주수 / 보유율. */
async function fetchAumByDate(code: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let page = 1; page <= 4; page++) {
    let html = "";
    try {
      html = await fetchText(
        `https://finance.naver.com/item/frgn.naver?code=${code}&page=${page}`,
      );
    } catch {
      break;
    }
    let found = 0;
    let reachedListing = false;
    const rows = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
    for (const row of rows) {
      const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) =>
        stripTags(td[1]).replace(/\s+/g, ""),
      );
      if (tds.length < 9 || !/^\d{4}\.\d{2}\.\d{2}$/.test(tds[0] || "")) continue;
      const ymd = tds[0].replace(/\./g, "");
      if (ymd < SINGLE_STOCK_LEV_LISTING_YMD) {
        reachedListing = true;
        continue;
      }
      const close = parseNumber(tds[1]);
      const hold = parseNumber(tds[7]);
      const rate = parseNumber(tds[8]);
      if (close == null || hold == null || rate == null || rate <= 0 || hold <= 0) {
        continue;
      }
      const shares = hold / (rate / 100);
      out[ymd] = shares * close;
      found += 1;
    }
    if (found === 0 || reachedListing) break;
  }
  return out;
}

async function fetchInvestorTrend(code: string): Promise<LevInvestorDay[]> {
  type Row = {
    bizdate?: string;
    foreignerPureBuyQuant?: string;
    organPureBuyQuant?: string;
    individualPureBuyQuant?: string;
    accumulatedTradingVolume?: string;
    closePrice?: string;
  };
  const rows = await fetchJson<Row[]>(
    `https://m.stock.naver.com/api/stock/${code}/trend?pageSize=60&page=1`,
  );
  const out: LevInvestorDay[] = [];
  for (const row of rows || []) {
    if (!row.bizdate || row.bizdate.length !== 8) continue;
    out.push({
      date: ymdToIso(row.bizdate),
      volume: parseNumber(row.accumulatedTradingVolume) ?? 0,
      foreign_net: parseNumber(row.foreignerPureBuyQuant) ?? 0,
      institution_net: parseNumber(row.organPureBuyQuant) ?? 0,
      individual_net: parseNumber(row.individualPureBuyQuant) ?? 0,
      close: parseNumber(row.closePrice),
    });
  }
  return out.reverse();
}

function parseDealerHtml(code: string, html: string): LevDealerBoard {
  const empty: LevDealerBoard = {
    code,
    sell: [],
    buy: [],
    note: "거래원 상위 데이터가 아직 없습니다(네이버 20분 지연·장중 갱신).",
  };
  const tableMatch = html.match(
    /<table[^>]*summary="[^"]*거래원[^"]*"[^>]*>([\s\S]*?)<\/table>/i,
  );
  if (!tableMatch) return empty;
  const body = tableMatch[1];
  const sell: LevBrokerSide[] = [];
  const buy: LevBrokerSide[] = [];
  let foreign_est_sell: number | null = null;
  let foreign_est_buy: number | null = null;

  const foot = body.match(/외국계추정합[\s\S]*?<\/tr>/i);
  if (foot) {
    const nums = [...foot[0].matchAll(/>([\d,\-+]+)</g)].map((x) => parseNumber(x[1]));
    foreign_est_sell = nums[0] ?? null;
    foreign_est_buy = nums[1] ?? null;
  }

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(body))) {
    const row = m[1];
    if (/매도상위|외국계|space|colspan/i.test(row)) continue;
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    );
    if (cells.length < 4) continue;
    const [sellName, sellVol, buyName, buyVol] = cells;
    const sv = parseNumber(sellVol);
    const bv = parseNumber(buyVol);
    if (sellName && sv != null && sv > 0) sell.push({ name: sellName, volume: sv });
    if (buyName && bv != null && bv > 0) buy.push({ name: buyName, volume: bv });
  }

  if (!sell.length && !buy.length) return empty;
  return {
    code,
    sell: sell.slice(0, 5),
    buy: buy.slice(0, 5),
    foreign_est_sell,
    foreign_est_buy,
  };
}

async function fetchDealer(code: string): Promise<LevDealerBoard> {
  try {
    const html = await fetchText(
      `https://finance.naver.com/item/main.naver?code=${code}`,
    );
    return parseDealerHtml(code, html);
  } catch {
    return {
      code,
      sell: [],
      buy: [],
      note: "거래원 페이지를 불러오지 못했습니다.",
    };
  }
}

function sumInvestorDays(seriesList: LevInvestorDay[][]): LevInvestorDay[] {
  const byDate = new Map<string, LevInvestorDay>();
  for (const series of seriesList) {
    for (const d of series) {
      const cur = byDate.get(d.date) || {
        date: d.date,
        volume: 0,
        foreign_net: 0,
        institution_net: 0,
        individual_net: 0,
      };
      cur.volume += d.volume;
      cur.foreign_net += d.foreign_net;
      cur.institution_net += d.institution_net;
      cur.individual_net += d.individual_net;
      byDate.set(d.date, cur);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

type CodeDaySeries = {
  meta: (typeof SINGLE_STOCK_LEV_ETFS)[number];
  days: EtfDayPoint[];
};

function buildDeleverBucket(
  key: string,
  label: string,
  members: CodeDaySeries[],
  color?: string,
): LevDeleverBucket {
  const dateSet = new Set<string>();
  const maps = members.map((m) => {
    for (const d of m.days) dateSet.add(d.date);
    return new Map(m.days.map((d) => [d.date, d] as const));
  });
  const dates = [...dateSet].sort();

  type Raw = { date: string; aum_eok: number; units_proxy: number };
  const raw: Raw[] = [];
  for (const ymd of dates) {
    let aum = 0;
    let units = 0;
    for (const map of maps) {
      const pt = map.get(ymd);
      if (!pt) continue;
      aum += pt.aum;
      if (pt.aum > 0 && pt.close > 0) units += pt.aum / pt.close;
    }
    if (aum <= 0 && units <= 0) continue;
    raw.push({ date: ymdToIso(ymd), aum_eok: aum / 1e8, units_proxy: units });
  }

  let peakAum = 0;
  let peakAumDate = raw[0]?.date || "";
  let peakUnits = 0;
  let peakUnitsDate = raw[0]?.date || "";
  for (const pt of raw) {
    if (pt.aum_eok >= peakAum) {
      peakAum = pt.aum_eok;
      peakAumDate = pt.date;
    }
    if (pt.units_proxy >= peakUnits) {
      peakUnits = pt.units_proxy;
      peakUnitsDate = pt.date;
    }
  }

  const latest = raw[raw.length - 1];
  const currentAum = latest?.aum_eok ?? 0;
  const currentUnits = latest?.units_proxy ?? 0;
  const remainingPct =
    peakUnits > 0 ? Math.max(0, Math.min(100, (100 * currentUnits) / peakUnits)) : 100;
  const progressPct = Math.max(0, Math.min(100, 100 - remainingPct));
  const aumDrawdown =
    peakAum > 0 ? Math.max(0, Math.min(100, (100 * (peakAum - currentAum)) / peakAum)) : 0;

  const series: LevDeleverPoint[] = raw.map((pt) => {
    const rem =
      peakUnits > 0 ? Math.max(0, Math.min(100, (100 * pt.units_proxy) / peakUnits)) : 100;
    return {
      date: pt.date,
      aum_eok: pt.aum_eok,
      units_proxy: pt.units_proxy,
      remaining_pct: rem,
      progress_pct: Math.max(0, Math.min(100, 100 - rem)),
    };
  });

  return {
    key,
    label,
    color,
    peak_aum_eok: peakAum,
    peak_aum_date: peakAumDate,
    current_aum_eok: currentAum,
    aum_drawdown_pct: aumDrawdown,
    peak_units: peakUnits,
    peak_units_date: peakUnitsDate,
    current_units: currentUnits,
    progress_pct: progressPct,
    remaining_pct: remainingPct,
    series,
  };
}

function buildDeleveraging(perCode: CodeDaySeries[]): LevDeleveraging {
  const total = buildDeleverBucket("all", "전체 16종", perCode);
  const lev = buildDeleverBucket(
    "lev",
    "레버리지(2x)",
    perCode.filter((p) => p.meta.direction === "lev"),
    "#3b82f6",
  );
  const inv = buildDeleverBucket(
    "inv",
    "인버스(-2x)",
    perCode.filter((p) => p.meta.direction === "inv"),
    "#f59e0b",
  );
  const by_group = LEV_GROUP_METAS.map((g) =>
    buildDeleverBucket(
      g.key,
      g.label,
      perCode.filter(
        (p) => levGroupKey(p.meta.underlying, p.meta.direction) === g.key,
      ),
      g.color,
    ),
  );
  return {
    total,
    lev,
    inv,
    by_group,
    note:
      "좌수 프록시(AUM÷종가)의 피크 대비 감소율. AUM 하락에는 가격효과가 섞이므로 좌수 기준을 우선합니다. 헤지펀드 식별·공식 설정/해지는 포함하지 않습니다.",
  };
}

async function buildBoard(): Promise<SingleStockLevBoard> {
  const codes = SINGLE_STOCK_LEV_ETFS.map((e) => e.code);
  const metaByCode = Object.fromEntries(
    SINGLE_STOCK_LEV_ETFS.map((e) => [e.code, e]),
  );
  const groupMeta = Object.fromEntries(LEV_GROUP_METAS.map((g) => [g.key, g]));

  type PollRow = {
    itemCode?: string;
    closePriceRaw?: string;
    compareToPreviousClosePriceRaw?: string;
    fluctuationsRatioRaw?: string;
    accumulatedTradingVolumeRaw?: string;
    accumulatedTradingValueRaw?: string;
    marketValueFullRaw?: string;
    marketStatus?: string;
    localTradedAt?: string;
  };

  const poll = await settled(
    fetchJson<{ datas?: PollRow[] }>(
      `https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.join(",")}`,
    ),
    { datas: [] },
  );

  const liveByCode: Record<
    string,
    {
      last: number;
      change: number;
      change_pct: number;
      volume: number;
      value: number;
      aum: number;
      market_status?: string;
      localTradedAt?: string;
    }
  > = {};
  let asOf: string | undefined;
  for (const raw of poll.datas || []) {
    const code = raw.itemCode || "";
    if (!metaByCode[code]) continue;
    liveByCode[code] = {
      last: parseNumber(raw.closePriceRaw) ?? 0,
      change: parseNumber(raw.compareToPreviousClosePriceRaw) ?? 0,
      change_pct: parseNumber(raw.fluctuationsRatioRaw) ?? 0,
      volume: parseNumber(raw.accumulatedTradingVolumeRaw) ?? 0,
      value: parseNumber(raw.accumulatedTradingValueRaw) ?? 0,
      aum: parseNumber(raw.marketValueFullRaw) ?? 0,
      market_status: raw.marketStatus,
      localTradedAt: raw.localTradedAt,
    };
    if (raw.localTradedAt) asOf = raw.localTradedAt;
  }

  const todayYmd = todayBizdateKst();

  const perCode = await Promise.all(
    SINGLE_STOCK_LEV_ETFS.map(async (meta) => {
      const [siseDays, aumMap, trend, dealer] = await Promise.all([
        settled(fetchSiseDayPoints(meta.code), [] as EtfDayPoint[]),
        settled(fetchAumByDate(meta.code), {} as Record<string, number>),
        settled(fetchInvestorTrend(meta.code), [] as LevInvestorDay[]),
        settled(fetchDealer(meta.code), {
          code: meta.code,
          sell: [],
          buy: [],
          note: "거래원 없음",
        } as LevDealerBoard),
      ]);

      const live = liveByCode[meta.code];
      const byDate = new Map<string, EtfDayPoint>();
      for (const d of siseDays) {
        byDate.set(d.date, { ...d, aum: aumMap[d.date] ?? 0 });
      }
      if (live) {
        const prev = byDate.get(todayYmd);
        byDate.set(todayYmd, {
          date: todayYmd,
          close: live.last || prev?.close || 0,
          volume: live.volume || prev?.volume || 0,
          value: live.value > 0 ? live.value : prev?.value || 0,
          aum: live.aum > 0 ? live.aum : prev?.aum || aumMap[todayYmd] || 0,
        });
      }
      const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      let lastAum = 0;
      for (const d of days) {
        if (d.aum > 0) lastAum = d.aum;
        else if (lastAum > 0) d.aum = lastAum;
      }

      const latestTrend = trend[trend.length - 1];
      const gKey = levGroupKey(meta.underlying, meta.direction);
      const product: SingleStockLevRow = {
        code: meta.code,
        name: meta.name,
        underlying: meta.underlying,
        direction: meta.direction,
        structure: meta.structure,
        group_key: gKey,
        group_label: groupMeta[gKey]?.label || gKey,
        last: live?.last ?? latestTrend?.close ?? days[days.length - 1]?.close ?? 0,
        change: live?.change ?? 0,
        change_pct: live?.change_pct ?? 0,
        volume: live?.volume ?? latestTrend?.volume ?? 0,
        value: live?.value ?? 0,
        value_eok: (live?.value ?? 0) / 1e8,
        aum_eok: (live?.aum ?? days[days.length - 1]?.aum ?? 0) / 1e8,
        foreign_net: latestTrend?.foreign_net ?? null,
        institution_net: latestTrend?.institution_net ?? null,
        individual_net: latestTrend?.individual_net ?? null,
        trend_date: latestTrend?.date ?? null,
        market_status: live?.market_status,
      };

      return {
        meta,
        days,
        product,
        trend,
        dealer,
      };
    }),
  );

  const dateSet = new Set<string>();
  for (const { days } of perCode) {
    for (const d of days) dateSet.add(d.date);
  }
  const dates = [...dateSet].sort();

  const groups: LevGroupSeries[] = LEV_GROUP_METAS.map((g) => {
    const members = perCode.filter(
      (p) => levGroupKey(p.meta.underlying, p.meta.direction) === g.key,
    );
    const dayMaps = members.map(
      (m) => new Map(m.days.map((d) => [d.date, d] as const)),
    );
    const series: LevGroupPoint[] = [];
    let cum = 0;
    for (const ymd of dates) {
      let aum = 0;
      let value = 0;
      for (const map of dayMaps) {
        const pt = map.get(ymd);
        if (!pt) continue;
        aum += pt.aum;
        value += pt.value;
      }
      cum += value;
      series.push({
        date: ymdToIso(ymd),
        aum_eok: aum / 1e8,
        value_eok: value / 1e8,
        value_cum_eok: cum / 1e8,
      });
    }
    const latest = series[series.length - 1];
    return {
      key: g.key,
      label: g.label,
      underlying: g.underlying,
      direction: g.direction,
      color: g.color,
      product_count: members.length,
      latest_aum_eok: latest?.aum_eok ?? 0,
      latest_value_eok: latest?.value_eok ?? 0,
      value_cum_eok: latest?.value_cum_eok ?? 0,
      series,
    };
  });

  const products = perCode.map((p) => p.product).sort((a, b) => b.value - a.value);
  const investors_by_code: Record<string, LevInvestorDay[]> = {};
  const dealers_by_code: Record<string, LevDealerBoard> = {};
  for (const p of perCode) {
    investors_by_code[p.meta.code] = p.trend;
    dealers_by_code[p.meta.code] = p.dealer;
  }

  const investors_by_group = {} as Record<LevGroupKey, LevInvestorDay[]>;
  for (const g of LEV_GROUP_METAS) {
    const seriesList = perCode
      .filter((p) => levGroupKey(p.meta.underlying, p.meta.direction) === g.key)
      .map((p) => p.trend);
    investors_by_group[g.key] = sumInvestorDays(seriesList);
  }

  const deleveraging = buildDeleveraging(perCode);
  const forced_sell = await settled(fetchForcedSellBoard(90), {
    as_of: null,
    stress: "calm" as const,
    stress_label: "데이터 없음",
    latest_fund: null,
    latest_credit: null,
    credit_delta: null,
    fund_series: [],
    credit_series: [],
    note: "반대매매·신용 데이터를 불러오지 못했습니다.",
  });

  return {
    listing_date: SINGLE_STOCK_LEV_LISTING_DATE,
    groups,
    products,
    investors_by_code,
    investors_by_group,
    dealers_by_code,
    deleveraging,
    forced_sell,
    total_aum_eok: groups.reduce((s, g) => s + g.latest_aum_eok, 0),
    total_value_eok: groups.reduce((s, g) => s + g.latest_value_eok, 0),
    total_value_cum_eok: groups.reduce((s, g) => s + g.value_cum_eok, 0),
    as_of: asOf,
    note:
      "16개 단일종목 레버리지·인버스 ETF. 유형 합산·투자자·거래원(네이버) + 청산 프록시 + 반대매매·신용(금투협 FreeSIS).",
  };
}

export async function GET() {
  try {
    const board = await withServerCache(
      "kr-leverage:v4",
      170_000,
      600_000,
      buildBoard,
    );
    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        board,
      },
      { headers: { "Cache-Control": cdnCacheHeader("heavy") } },
    );
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "leverage fetch failed",
      },
      { status: 500 },
    );
  }
}

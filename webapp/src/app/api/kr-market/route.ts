import { NextResponse } from "next/server";

import {
  computeTechnicals,
  LEV_GROUP_METAS,
  levGroupKey,
  SINGLE_STOCK_LEV_ETFS,
  SINGLE_STOCK_LEV_LISTING_DATE,
  SINGLE_STOCK_LEV_LISTING_YMD,
  type KrCandle,
  type KrCreditRow,
  type KrFlowDay,
  type KrFlowPoint,
  type KrIndexBoard,
  type KrIndexQuote,
  type KrMarketPayload,
  type LevGroupPoint,
  type LevGroupSeries,
  type SingleStockLevBoard,
} from "@/lib/krMarket";

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

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: "https://finance.naver.com/",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Naver sise HTML is typically EUC-KR; fall back so ASCII numbers still parse.
  try {
    return new TextDecoder("euc-kr").decode(buf);
  } catch {
    return buf.toString("latin1");
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

function todayBizdateKst(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}${m}${d}`;
}

function shiftBizdate(yyyymmdd: string, daysBack: number): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

async function fetchRealtimeQuotes(
  codes: string[],
): Promise<Record<string, { last: number; change: number; change_pct: number; status?: string }>> {
  const query = codes.map((c) => `SERVICE_INDEX:${c}`).join(",");
  const url = `https://polling.finance.naver.com/api/realtime?query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        Referer: "https://finance.naver.com/",
        Origin: "https://finance.naver.com",
      },
      cache: "no-store",
    });
    if (!res.ok) return {};
    const payload = (await res.json()) as {
      result?: {
        areas?: Array<{
          datas?: Array<{
            cd?: string;
            nv?: number;
            cv?: number;
            cr?: number;
            ms?: string;
          }>;
        }>;
      };
    };
    const out: Record<
      string,
      { last: number; change: number; change_pct: number; status?: string }
    > = {};
    for (const row of payload.result?.areas?.[0]?.datas || []) {
      if (!row.cd || row.nv == null) continue;
      out[row.cd] = {
        last: row.nv / 100,
        change: (row.cv ?? 0) / 100,
        change_pct: row.cr ?? 0,
        status: row.ms,
      };
    }
    return out;
  } catch {
    return {};
  }
}

async function quoteFromDaily(
  code: string,
  name: string,
  daily: KrCandle[],
): Promise<KrIndexQuote> {
  const last = daily[daily.length - 1];
  const prev = daily.length >= 2 ? daily[daily.length - 2] : undefined;
  const close = last?.close ?? 0;
  const change = prev ? close - prev.close : 0;
  const change_pct = prev && prev.close ? (change / prev.close) * 100 : 0;
  // Prefer page=1 first row which is latest from Naver price API
  try {
    type Row = {
      closePrice?: string;
      compareToPreviousClosePrice?: string;
      fluctuationsRatio?: string;
      openPrice?: string;
      highPrice?: string;
      lowPrice?: string;
    };
    const rows = await fetchJson<Row[]>(
      `https://m.stock.naver.com/api/index/${code}/price?pageSize=1&page=1`,
    );
    if (rows?.[0]) {
      const c = parseNumber(rows[0].closePrice);
      if (c != null) {
        return {
          code,
          name,
          last: c,
          change: parseNumber(rows[0].compareToPreviousClosePrice) ?? change,
          change_pct: parseNumber(rows[0].fluctuationsRatio) ?? change_pct,
          open: parseNumber(rows[0].openPrice) ?? last?.open,
          high: parseNumber(rows[0].highPrice) ?? last?.high,
          low: parseNumber(rows[0].lowPrice) ?? last?.low,
          prev_close: prev?.close,
        };
      }
    }
  } catch {
    // fall through
  }
  return {
    code,
    name,
    last: close,
    change,
    change_pct,
    open: last?.open,
    high: last?.high,
    low: last?.low,
    prev_close: prev?.close,
  };
}

async function fetchDailyPrices(code: string, pageSize = 60): Promise<KrCandle[]> {
  type Row = {
    localTradedAt?: string;
    closePrice?: string;
    openPrice?: string;
    highPrice?: string;
    lowPrice?: string;
    accumulatedTradingVolume?: string | number;
  };
  // Naver occasionally rejects large pageSize — retry smaller.
  const sizes = [pageSize, 60, 30, 20];
  let rows: Row[] | null = null;
  let lastErr: unknown = null;
  for (const size of sizes) {
    try {
      rows = await fetchJson<Row[]>(
        `https://m.stock.naver.com/api/index/${code}/price?pageSize=${size}&page=1`,
      );
      break;
    } catch (exc) {
      lastErr = exc;
    }
  }
  if (!rows) throw lastErr instanceof Error ? lastErr : new Error("daily price fetch failed");
  const candles: KrCandle[] = [];
  for (const row of [...rows].reverse()) {
    const close = parseNumber(row.closePrice);
    if (close == null || !row.localTradedAt) continue;
    candles.push({
      time: row.localTradedAt.slice(0, 10),
      open: parseNumber(row.openPrice) ?? close,
      high: parseNumber(row.highPrice) ?? close,
      low: parseNumber(row.lowPrice) ?? close,
      close,
      volume: parseNumber(row.accumulatedTradingVolume) ?? undefined,
    });
  }
  return candles;
}

async function fetchIntradayMinutes(code: string): Promise<KrCandle[]> {
  type Row = {
    localDateTime?: string;
    currentPrice?: number;
    openPrice?: number;
    highPrice?: number;
    lowPrice?: number;
    accumulatedTradingVolume?: number;
  };
  const rows = await fetchJson<Row[]>(
    `https://api.stock.naver.com/chart/domestic/index/${code}/minute?periodType=day`,
  );
  return (rows || [])
    .filter((row) => row.localDateTime && row.currentPrice != null)
    .map((row) => {
      const ts = String(row.localDateTime);
      const time = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;
      const close = Number(row.currentPrice);
      return {
        time,
        open: Number(row.openPrice ?? close),
        high: Number(row.highPrice ?? close),
        low: Number(row.lowPrice ?? close),
        close,
        volume: row.accumulatedTradingVolume,
      };
    });
}

async function fetchStockDaily(code: string, pageSize = 120): Promise<KrCandle[]> {
  type Row = {
    localTradedAt?: string;
    closePrice?: string;
    openPrice?: string;
    highPrice?: string;
    lowPrice?: string;
    accumulatedTradingVolume?: string | number;
  };
  const rows = await fetchJson<Row[]>(
    `https://m.stock.naver.com/api/stock/${code}/price?pageSize=${pageSize}&page=1`,
  );
  const candles: KrCandle[] = [];
  for (const row of [...rows].reverse()) {
    const close = parseNumber(row.closePrice);
    if (close == null || !row.localTradedAt) continue;
    candles.push({
      time: row.localTradedAt.slice(0, 10),
      open: parseNumber(row.openPrice) ?? close,
      high: parseNumber(row.highPrice) ?? close,
      low: parseNumber(row.lowPrice) ?? close,
      close,
      volume: parseNumber(row.accumulatedTradingVolume) ?? undefined,
    });
  }
  return candles;
}

async function fetchStockQuote(code: string): Promise<KrIndexQuote | null> {
  type Row = {
    localTradedAt?: string;
    closePrice?: string;
    compareToPreviousClosePrice?: string;
    fluctuationsRatio?: string;
    openPrice?: string;
    highPrice?: string;
    lowPrice?: string;
  };
  const rows = await fetchJson<Row[]>(
    `https://m.stock.naver.com/api/stock/${code}/price?pageSize=2&page=1`,
  );
  if (!rows?.length) return null;
  const last = rows[0];
  const close = parseNumber(last.closePrice);
  if (close == null) return null;
  return {
    code,
    name: "KODEX 코스닥150",
    last: close,
    change: parseNumber(last.compareToPreviousClosePrice) ?? 0,
    change_pct: parseNumber(last.fluctuationsRatio) ?? 0,
    open: parseNumber(last.openPrice) ?? undefined,
    high: parseNumber(last.highPrice) ?? undefined,
    low: parseNumber(last.lowPrice) ?? undefined,
  };
}

function buildIndexBoard(
  code: string,
  name: string,
  quote: KrIndexQuote,
  daily: KrCandle[],
  intraday: KrCandle[],
): KrIndexBoard {
  const closes = daily.map((c) => c.close);
  return {
    quote,
    intraday,
    daily,
    technicals: computeTechnicals(closes),
  };
}

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (exc) {
    console.error("kr-market partial failure:", exc);
    return fallback;
  }
}

function parseFlowTable(
  html: string,
  mode: "intraday" | "daily",
): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) =>
      stripTags(c),
    );
    if (!cells.length) continue;
    const key = cells[0];
    if (mode === "intraday" && !/^\d{1,2}:\d{2}$/.test(key)) continue;
    if (mode === "daily" && !/^\d{2}\.\d{2}\.\d{2}$/.test(key)) continue;
    // Layout: date/time, 개인, 외국인, 기관계, then institution breakdown…
    rows.push({
      key,
      individual: cells[1] || "",
      foreign: cells[2] || "",
      institution: cells[3] || "",
    });
  }
  return rows;
}

async function fetchFlows(sosok: "01" | "02"): Promise<{
  intraday: KrFlowPoint[];
  daily: KrFlowDay[];
}> {
  const today = todayBizdateKst();
  // Try today, then walk back a few days for holiday/weekend
  let intradayHtml = "";
  let usedDate = today;
  for (let i = 0; i < 5; i++) {
    const biz = shiftBizdate(today, i);
    const url = `https://finance.naver.com/sise/investorDealTrendTime.naver?bizdate=${biz}&sosok=${sosok}`;
    const html = await fetchText(url);
    const parsed = parseFlowTable(html, "intraday");
    if (parsed.length) {
      intradayHtml = html;
      usedDate = biz;
      break;
    }
  }
  const intradayRows = parseFlowTable(intradayHtml, "intraday");
  // Chronological (page is newest-first)
  const intraday: KrFlowPoint[] = [...intradayRows]
    .reverse()
    .map((row) => ({
      time: row.key,
      individual: parseNumber(row.individual) ?? 0,
      foreign: parseNumber(row.foreign) ?? 0,
      institution: parseNumber(row.institution) ?? 0,
    }));

  const dayUrl = `https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${usedDate}&sosok=${sosok}`;
  const dayHtml = await fetchText(dayUrl);
  const dayRows = parseFlowTable(dayHtml, "daily");
  const daily: KrFlowDay[] = [...dayRows]
    .reverse()
    .map((row) => ({
      date: `20${row.key.replace(/\./g, "-")}`,
      individual: parseNumber(row.individual) ?? 0,
      foreign: parseNumber(row.foreign) ?? 0,
      institution: parseNumber(row.institution) ?? 0,
    }));

  return { intraday, daily };
}

async function fetchCredit(): Promise<{
  rows: KrCreditRow[];
  latest: KrCreditRow | null;
  credit_ratio_proxy: number | null;
}> {
  const html = await fetchText("https://finance.naver.com/sise/sise_deposit.naver");
  const rows: KrCreditRow[] = [];
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) =>
      stripTags(c),
    );
    if (!cells.length || !/^\d{2}\.\d{2}\.\d{2}$/.test(cells[0])) continue;
    // Headers: 날짜, 고객예탁금, 신용잔고, 주식형, 혼합형, 채권형 (with delta cols interleaved)
    // Observed sample: date, deposit, depositΔ, credit, creditΔ, fundStock, fundStockΔ, mixed, mixedΔ, bond, bondΔ
    const date = `20${cells[0].replace(/\./g, "-")}`;
    const customer_deposit = parseNumber(cells[1]);
    const credit_balance = parseNumber(cells[3]);
    const fund_stock = parseNumber(cells[5]);
    const fund_mixed = parseNumber(cells[7]);
    const fund_bond = parseNumber(cells[9]);
    if (customer_deposit == null || credit_balance == null) continue;
    rows.push({
      date,
      customer_deposit,
      credit_balance,
      fund_stock: fund_stock ?? 0,
      fund_mixed: fund_mixed ?? 0,
      fund_bond: fund_bond ?? 0,
    });
  }
  // Page is newest-first
  const chronological = [...rows].reverse();
  const latest = chronological[chronological.length - 1] || null;
  const credit_ratio_proxy =
    latest && latest.customer_deposit > 0
      ? (latest.credit_balance / latest.customer_deposit) * 100
      : null;
  return { rows: chronological, latest, credit_ratio_proxy };
}

function ymdToIso(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

type EtfDayPoint = {
  date: string; // YYYYMMDD
  close: number;
  volume: number;
  value: number; // KRW
  aum: number; // KRW (시가총액 ≈ AUM)
};

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
      // Naver day chart has no 거래대금; close×volume is a stable trend proxy.
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

async function fetchSingleStockLevBoard(): Promise<SingleStockLevBoard> {
  const codes = SINGLE_STOCK_LEV_ETFS.map((e) => e.code);
  const metaByCode = Object.fromEntries(
    SINGLE_STOCK_LEV_ETFS.map((e) => [e.code, e]),
  );

  type PollRow = {
    itemCode?: string;
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
    { value: number; aum: number; localTradedAt?: string }
  > = {};
  let asOf: string | undefined;
  for (const raw of poll.datas || []) {
    const code = raw.itemCode || "";
    if (!metaByCode[code]) continue;
    const value = parseNumber(raw.accumulatedTradingValueRaw) ?? 0;
    const aum = parseNumber(raw.marketValueFullRaw) ?? 0;
    liveByCode[code] = { value, aum, localTradedAt: raw.localTradedAt };
    if (raw.localTradedAt) asOf = raw.localTradedAt;
  }

  const todayYmd = todayBizdateKst();

  const perCode = await Promise.all(
    SINGLE_STOCK_LEV_ETFS.map(async (meta) => {
      const [siseDays, aumMap] = await Promise.all([
        settled(fetchSiseDayPoints(meta.code), [] as EtfDayPoint[]),
        settled(fetchAumByDate(meta.code), {} as Record<string, number>),
      ]);
      const live = liveByCode[meta.code];
      const byDate = new Map<string, EtfDayPoint>();
      for (const d of siseDays) {
        byDate.set(d.date, {
          ...d,
          aum: aumMap[d.date] ?? 0,
        });
      }
      // Prefer live AUM / 거래대금 for the current session.
      if (live) {
        const prev = byDate.get(todayYmd);
        byDate.set(todayYmd, {
          date: todayYmd,
          close: prev?.close ?? 0,
          volume: prev?.volume ?? 0,
          value: live.value > 0 ? live.value : prev?.value ?? 0,
          aum: live.aum > 0 ? live.aum : prev?.aum ?? aumMap[todayYmd] ?? 0,
        });
      }
      const days = [...byDate.values()].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      // Forward-fill AUM gaps (frgn table sometimes skips a session).
      let lastAum = 0;
      for (const d of days) {
        if (d.aum > 0) lastAum = d.aum;
        else if (lastAum > 0) d.aum = lastAum;
      }
      return { meta, days };
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

  const total_aum_eok = groups.reduce((s, g) => s + g.latest_aum_eok, 0);
  const total_value_eok = groups.reduce((s, g) => s + g.latest_value_eok, 0);
  const total_value_cum_eok = groups.reduce((s, g) => s + g.value_cum_eok, 0);

  return {
    listing_date: SINGLE_STOCK_LEV_LISTING_DATE,
    groups,
    total_aum_eok,
    total_value_eok,
    total_value_cum_eok,
    as_of: asOf,
    note:
      "유형별(전자 2x·전자 -2x·닉스 -2x·닉스 2x) 합산. AUM은 시가총액(상장좌수×종가) 기준, 과거 일별 거래대금은 종가×거래량 추정치입니다.",
  };
}

export async function GET() {
  try {
    const [
      rt,
      kpiDaily,
      kqDaily,
      kpiIntra,
      kqIntra,
      kospiFlow,
      kosdaqFlow,
      credit,
      kq150Daily,
      kq150Quote,
      singleStockLev,
    ] = await Promise.all([
      settled(fetchRealtimeQuotes(["KPI200", "KOSDAQ", "KOSPI"]), {}),
      settled(fetchDailyPrices("KPI200", 60), [] as KrCandle[]),
      settled(fetchDailyPrices("KOSDAQ", 60), [] as KrCandle[]),
      settled(fetchIntradayMinutes("KPI200"), [] as KrCandle[]),
      settled(fetchIntradayMinutes("KOSDAQ"), [] as KrCandle[]),
      settled(fetchFlows("01"), { intraday: [], daily: [] }),
      settled(fetchFlows("02"), { intraday: [], daily: [] }),
      settled(fetchCredit(), {
        rows: [] as KrCreditRow[],
        latest: null,
        credit_ratio_proxy: null,
      }),
      settled(fetchStockDaily("229200", 120), [] as KrCandle[]),
      settled(fetchStockQuote("229200"), null),
      settled(fetchSingleStockLevBoard(), {
        listing_date: SINGLE_STOCK_LEV_LISTING_DATE,
        groups: [],
        total_aum_eok: 0,
        total_value_eok: 0,
        total_value_cum_eok: 0,
      } satisfies SingleStockLevBoard),
    ]);

    const kpiQuote = rt.KPI200
      ? {
          code: "KPI200",
          name: "코스피200",
          last: rt.KPI200.last,
          change: rt.KPI200.change,
          change_pct: rt.KPI200.change_pct,
          market_status: rt.KPI200.status,
          open: kpiDaily[kpiDaily.length - 1]?.open,
          high: kpiDaily[kpiDaily.length - 1]?.high,
          low: kpiDaily[kpiDaily.length - 1]?.low,
          prev_close:
            kpiDaily.length >= 2
              ? kpiDaily[kpiDaily.length - 2].close
              : undefined,
        }
      : await settled(
          quoteFromDaily("KPI200", "코스피200", kpiDaily),
          {
            code: "KPI200",
            name: "코스피200",
            last: kpiDaily[kpiDaily.length - 1]?.close ?? 0,
            change: 0,
            change_pct: 0,
          },
        );

    const kqQuote = rt.KOSDAQ
      ? {
          code: "KOSDAQ",
          name: "코스닥 종합",
          last: rt.KOSDAQ.last,
          change: rt.KOSDAQ.change,
          change_pct: rt.KOSDAQ.change_pct,
          market_status: rt.KOSDAQ.status,
          open: kqDaily[kqDaily.length - 1]?.open,
          high: kqDaily[kqDaily.length - 1]?.high,
          low: kqDaily[kqDaily.length - 1]?.low,
          prev_close:
            kqDaily.length >= 2 ? kqDaily[kqDaily.length - 2].close : undefined,
        }
      : await settled(
          quoteFromDaily("KOSDAQ", "코스닥 종합", kqDaily),
          {
            code: "KOSDAQ",
            name: "코스닥 종합",
            last: kqDaily[kqDaily.length - 1]?.close ?? 0,
            change: 0,
            change_pct: 0,
          },
        );

    const kospi200 = buildIndexBoard(
      "KPI200",
      "코스피200",
      kpiQuote,
      kpiDaily,
      kpiIntra,
    );
    const kosdaq = buildIndexBoard(
      "KOSDAQ",
      "코스닥 종합",
      kqQuote,
      kqDaily,
      kqIntra,
    );

    const payload: KrMarketPayload = {
      ok: true,
      generated_at: new Date().toISOString(),
      note:
        "코스닥100 지수는 코스닥150으로 개편되어, 시황·수급은 코스닥 종합 기준입니다. 대형주 추세는 KODEX 코스닥150으로 참고하세요.",
      kospi200,
      kosdaq,
      kosdaq150: kq150Quote
        ? {
            quote: kq150Quote,
            daily: kq150Daily,
            technicals: computeTechnicals(kq150Daily.map((c) => c.close)),
          }
        : undefined,
      flows: {
        kospi_intraday: kospiFlow.intraday,
        kosdaq_intraday: kosdaqFlow.intraday,
        kospi_daily: kospiFlow.daily,
        kosdaq_daily: kosdaqFlow.daily,
        as_of: todayBizdateKst(),
      },
      credit: {
        rows: credit.rows,
        latest: credit.latest,
        credit_ratio_proxy: credit.credit_ratio_proxy,
      },
      single_stock_lev: singleStockLev,
    };

    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "KR market fetch failed",
      } satisfies KrMarketPayload,
      { status: 500 },
    );
  }
}

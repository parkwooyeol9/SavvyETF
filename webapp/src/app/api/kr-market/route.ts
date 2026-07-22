import { NextResponse } from "next/server";

import {
  computeTechnicals,
  type KrCandle,
  type KrCreditRow,
  type KrFlowDay,
  type KrFlowPoint,
  type KrIndexBoard,
  type KrIndexQuote,
  type KrMarketPayload,
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

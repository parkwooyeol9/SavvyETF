/**
 * Server-only scrapers for market leverage indicators (Naver Finance).
 */

import {
  LEV_GROUP_METAS,
  levGroupKey,
  SINGLE_STOCK_LEV_ETFS,
  SINGLE_STOCK_LEV_LISTING_DATE,
  SINGLE_STOCK_LEV_LISTING_YMD,
  type LevGroupPoint,
  type LevGroupSeries,
  type SingleStockLevBoard,
} from "@/lib/krMarket";
import type {
  KrCreditRowEx,
  MarketLeveragePayload,
  ProgramDay,
} from "@/lib/marketLeverage";

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

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
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

function ymdToIso(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function yyMmDdToIso(raw: string): string {
  // 26.07.24 → 2026-07-24
  return `20${raw.replace(/\./g, "-")}`;
}

export async function fetchCredit(): Promise<{
  rows: KrCreditRowEx[];
  latest: KrCreditRowEx | null;
  credit_ratio_proxy: number | null;
}> {
  const byDate = new Map<string, KrCreditRowEx>();
  for (let page = 1; page <= 3; page++) {
    let html = "";
    try {
      html = await fetchText(
        `https://finance.naver.com/sise/sise_deposit.naver?page=${page}`,
      );
    } catch {
      break;
    }
    let found = 0;
    const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(
        (c) => stripTags(c),
      );
      if (!cells.length || !/^\d{2}\.\d{2}\.\d{2}$/.test(cells[0])) continue;
      // date, deposit, depositΔ, credit, creditΔ, fundStock, fundStockΔ, mixed, mixedΔ, bond, bondΔ
      const date = yyMmDdToIso(cells[0]);
      const customer_deposit = parseNumber(cells[1]);
      const customer_deposit_delta = parseNumber(cells[2]);
      const credit_balance = parseNumber(cells[3]);
      const credit_balance_delta = parseNumber(cells[4]);
      const fund_stock = parseNumber(cells[5]);
      const fund_mixed = parseNumber(cells[7]);
      const fund_bond = parseNumber(cells[9]);
      if (customer_deposit == null || credit_balance == null) continue;
      const credit_ratio =
        customer_deposit > 0 ? (credit_balance / customer_deposit) * 100 : null;
      byDate.set(date, {
        date,
        customer_deposit,
        customer_deposit_delta,
        credit_balance,
        credit_balance_delta,
        credit_ratio,
        fund_stock: fund_stock ?? 0,
        fund_mixed: fund_mixed ?? 0,
        fund_bond: fund_bond ?? 0,
      });
      found += 1;
    }
    if (found === 0) break;
  }

  const chronological = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const latest = chronological[chronological.length - 1] || null;
  const credit_ratio_proxy = latest?.credit_ratio ?? null;
  return { rows: chronological, latest, credit_ratio_proxy };
}

export async function fetchProgramKospi(
  pages = 4,
): Promise<{ rows: ProgramDay[]; latest: ProgramDay | null }> {
  const byDate = new Map<string, ProgramDay>();
  const biz = todayBizdateKst();
  for (let page = 1; page <= pages; page++) {
    let html = "";
    try {
      html = await fetchText(
        `https://finance.naver.com/sise/programDealTrendDay.naver?bizdate=${biz}&sosok=01&page=${page}`,
      );
    } catch {
      break;
    }
    let found = 0;
    const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(
        (c) => stripTags(c),
      );
      if (!cells.length || !/^\d{2}\.\d{2}\.\d{2}$/.test(cells[0])) continue;
      // date, arb buy/sell/net, nonarb buy/sell/net, total buy/sell/net
      if (cells.length < 10) continue;
      const date = yyMmDdToIso(cells[0]);
      const arb_net = parseNumber(cells[3]) ?? 0;
      const nonarb_net = parseNumber(cells[6]) ?? 0;
      const total_buy = parseNumber(cells[7]) ?? 0;
      const total_sell = parseNumber(cells[8]) ?? 0;
      const total_net = parseNumber(cells[9]) ?? 0;
      byDate.set(date, {
        date,
        arb_net,
        nonarb_net,
        total_buy,
        total_sell,
        total_net,
      });
      found += 1;
    }
    if (found === 0) break;
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { rows, latest: rows[rows.length - 1] || null };
}

type EtfDayPoint = {
  date: string;
  close: number;
  volume: number;
  value: number;
  aum: number;
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
      value: close * volume,
      aum: 0,
    });
  }
  return out;
}

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

export async function fetchSingleStockLevBoard(): Promise<SingleStockLevBoard> {
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

export async function buildMarketLeveragePayload(): Promise<MarketLeveragePayload> {
  const [credit, singleStockLev, program] = await Promise.all([
    settled(fetchCredit(), {
      rows: [] as KrCreditRowEx[],
      latest: null,
      credit_ratio_proxy: null,
    }),
    settled(fetchSingleStockLevBoard(), {
      listing_date: SINGLE_STOCK_LEV_LISTING_DATE,
      groups: [],
      total_aum_eok: 0,
      total_value_eok: 0,
      total_value_cum_eok: 0,
    } satisfies SingleStockLevBoard),
    settled(fetchProgramKospi(4), {
      rows: [] as ProgramDay[],
      latest: null,
    }),
  ]);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source:
      "Naver Finance sise_deposit · programDealTrendDay · 단일종목 레버 ETF 시세",
    note:
      "증시 레버리지 현황: 신용융자잔고·고객예탁금, 코스피 프로그램매매, 단일종목 레버리지 ETF 4유형 합산. " +
      "공매도·대차잔고는 KRX 로그인/세션 API라 자동 수집하지 않습니다.",
    credit: {
      rows: credit.rows,
      latest: credit.latest,
      credit_ratio_proxy: credit.credit_ratio_proxy,
    },
    single_stock_lev: singleStockLev,
    program_kospi: {
      rows: program.rows,
      latest: program.latest,
    },
  };
}

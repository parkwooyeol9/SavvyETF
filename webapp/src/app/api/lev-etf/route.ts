import { NextResponse } from "next/server";

import {
  LEV_ETF_UNIVERSE,
  TRADER_WINDOWS,
  individualNetFrom,
  metaToGroup,
  type InvestorDay,
  type LevEtfItem,
  type LevEtfPayload,
  type TraderSnapshot,
  type TraderWindow,
} from "@/lib/levEtf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type CacheEntry = { at: number; payload: LevEtfPayload };
let cache: CacheEntry | null = null;
const CACHE_MS = 3 * 60_000;

function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  let text = String(raw).replace(/,/g, "").replace(/%/g, "").trim();
  if (!text || text === "-" || text === "N/A") return null;
  // strip 상승/하락 prefixes commonly embedded
  text = text.replace(/^(상승|하락|보합)/, "");
  const neg = /^\(.*\)$/.test(text) || text.startsWith("-");
  text = text.replace(/[()]/g, "");
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return neg && n > 0 ? -n : n;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      Referer: "https://finance.naver.com/",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    return new TextDecoder("euc-kr").decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

function parseTraderBoard(html: string, window: TraderWindow): TraderSnapshot {
  const start = html.indexOf("거래원정보");
  const chunk = start >= 0 ? html.slice(start, start + 8000) : html;
  const sell_top: TraderSnapshot["sell_top"] = [];
  const buy_top: TraderSnapshot["buy_top"] = [];

  const rows = chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
  for (const row of rows) {
    const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) =>
      stripTags(td[1]).replace(/\s+/g, ""),
    );
    if (tds.length < 4) continue;
    // firm | sellVol | firm | buyVol
    const sellFirm = tds[0];
    const sellVol = parseNumber(tds[1]);
    const buyFirm = tds[2];
    const buyVol = parseNumber(tds[3]);
    if (
      sellFirm &&
      sellVol != null &&
      !sellFirm.includes("매도") &&
      !sellFirm.includes("외국")
    ) {
      sell_top.push({ broker: sellFirm, volume: sellVol });
    }
    if (
      buyFirm &&
      buyVol != null &&
      !buyFirm.includes("매수") &&
      !buyFirm.includes("외국")
    ) {
      buy_top.push({ broker: buyFirm, volume: buyVol });
    }
  }

  let foreign_net: number | null = null;
  let foreign_label: string | null = null;
  const foreignMatch = chunk.match(
    /(외국인\s*순매매량|외국계추정합)[\s\S]{0,500}?(?:class="[^"]*")?>\s*([+\-()0-9,]+)\s*</,
  );
  if (foreignMatch) {
    foreign_label = foreignMatch[1].replace(/\s+/g, "");
    foreign_net = parseNumber(foreignMatch[2]);
  } else if (/외국계추정합/.test(chunk)) {
    foreign_label = "외국계추정합";
    foreign_net = null;
  } else if (/외국인\s*순매매량/.test(chunk)) {
    foreign_label = "외국인순매매량";
    foreign_net = null;
  }

  return {
    window,
    sell_top: sell_top.slice(0, 5),
    buy_top: buy_top.slice(0, 5),
    foreign_net,
    foreign_label,
  };
}

function parseInvestorDays(html: string): InvestorDay[] {
  const out: InvestorDay[] = [];
  // Prefer the type2 table that has 날짜/종가/기관/외국인
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map(
    (m) => m[1],
  );
  let target = "";
  for (const t of tables) {
    if (t.includes("날짜") && t.includes("종가") && t.includes("외국인") && t.includes("기관")) {
      target = t;
      break;
    }
  }
  if (!target) return out;

  const rows = target.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
  for (const row of rows) {
    const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) =>
      stripTags(td[1]).replace(/\s+/g, ""),
    );
    if (tds.length < 7 || !/^\d{4}\.\d{2}\.\d{2}$/.test(tds[0] || "")) continue;
    const date = tds[0].replace(/\./g, "-");
    const close = parseNumber(tds[1]);
    // tds[2] is 전일비 with arrow text, tds[3] 등락률, tds[4] 거래량, tds[5] 기관, tds[6] 외국인
    const changeRaw = tds[2] || "";
    let change = parseNumber(changeRaw.replace(/상승|하락|보합/g, "")) ?? 0;
    if (changeRaw.includes("하락") && change > 0) change = -change;
    const change_pct = parseNumber(tds[3]) ?? 0;
    const volume = parseNumber(tds[4]) ?? 0;
    const institution_net = parseNumber(tds[5]) ?? 0;
    const foreign_net = parseNumber(tds[6]) ?? 0;
    const foreign_shares = tds.length > 7 ? parseNumber(tds[7]) : null;
    const foreign_ratio = tds.length > 8 ? parseNumber(tds[8]) : null;
    if (close == null) continue;
    out.push({
      date,
      close,
      change,
      change_pct,
      volume,
      institution_net,
      foreign_net,
      individual_net: individualNetFrom(foreign_net, institution_net),
      foreign_shares,
      foreign_ratio,
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

async function fetchEtfBoard(code: string): Promise<{
  traders: TraderSnapshot[];
  investors: InvestorDay[];
}> {
  // Trader windows in parallel
  const traderHtmls = await mapPool(TRADER_WINDOWS, 4, async (window) => {
    const url = `https://finance.naver.com/item/frgn.naver?code=${code}&page=1&trader_day=${window}`;
    const html = await fetchHtml(url);
    return { window, html };
  });

  const traders = traderHtmls.map(({ window, html }) =>
    parseTraderBoard(html, window),
  );

  // Investor daily: paginate from page 1 of any window (reuse day=1 html)
  const byDate = new Map<string, InvestorDay>();
  const first = traderHtmls.find((t) => t.window === 1)?.html || "";
  for (const row of parseInvestorDays(first)) byDate.set(row.date, row);

  for (let page = 2; page <= 4; page++) {
    try {
      const html = await fetchHtml(
        `https://finance.naver.com/item/frgn.naver?code=${code}&page=${page}&trader_day=1`,
      );
      const rows = parseInvestorDays(html);
      if (!rows.length) break;
      for (const row of rows) byDate.set(row.date, row);
    } catch {
      break;
    }
  }

  const investors = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return { traders, investors };
}

async function buildPayload(): Promise<LevEtfPayload> {
  const items = await mapPool(LEV_ETF_UNIVERSE, 4, async (meta) => {
    try {
      const { traders, investors } = await fetchEtfBoard(meta.code);
      const item: LevEtfItem = {
        code: meta.code,
        name: meta.name,
        underlying: meta.underlying,
        direction: meta.direction,
        structure: meta.structure,
        group: metaToGroup(meta),
        traders,
        investors,
      };
      return item;
    } catch (exc) {
      return {
        code: meta.code,
        name: meta.name,
        underlying: meta.underlying,
        direction: meta.direction,
        structure: meta.structure,
        group: metaToGroup(meta),
        traders: [],
        investors: [],
        error: exc instanceof Error ? exc.message : "fetch failed",
      } satisfies LevEtfItem;
    }
  });

  const errors = items.filter((i) => i.error).length;
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source: "Naver Finance item/frgn (거래원 20분 지연 · 일별 투자자 순매매)",
    note:
      "16개 단일종목 레버리지·인버스 ETF. 거래원은 당일/5/20/60일 누적 상위 5개 회원사, " +
      "투자자별은 일별 거래량·기관·외국인 순매매이며 개인은 -(외국인+기관)으로 추정합니다. " +
      "증권사 합산은 종목별 TOP5만(전 회원사 아님). 거래원 일별 시계열은 원천에 없어 창(당일~60일) 기준으로 제공합니다. " +
      "원천: KRX 집계의 네이버 재배포(20분 지연)." +
      (errors ? ` · ${errors}종목 수집 실패` : ""),
    items,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("refresh") === "1";
    if (!force && cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json(cache.payload);
    }
    const payload = await buildPayload();
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "lev-etf fetch failed",
      } satisfies LevEtfPayload,
      { status: 500 },
    );
  }
}

/**
 * On-demand ETF constituent/weight lookup for KR-listed vs US-listed products.
 *
 * Universe (which market?):
 *   KR — Naver ETF list (same source as ETF DB)
 *   US — curated US ETF DB (`etfDbUsUniverseTop1000`)
 *
 * Holdings (weights):
 *   KR — ETF CHECK daily PDF, fallback Naver CU table (dart_etf_memb)
 *   US — ETF CHECK global PDF (`getGlobalEtfPdfDetail` via MSTARID)
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { fetchBotJson } from "@/lib/bot";
import {
  fetchGlobalEtfItemInfo,
  fetchGlobalEtfMastBySymbol,
  fetchGlobalEtfPdfDetail,
  fetchKrPdfWeights,
} from "@/lib/etfCheck";
import { classifyNaverItem, type EtfDbRow } from "@/lib/etfDb";
import { uniqueUsUniverse, type UsUniverseMeta } from "@/lib/etfDbUsUniverse";

export type EtfHoldingsMarket = "KR" | "US";

export type EtfHoldingRow = {
  code: string;
  name: string;
  weight_pct: number | null;
  price?: number | null;
  change_pct?: number | null;
};

export type EtfHoldingsStats = {
  holding_count: number;
  top5_weight_pct: number | null;
  top10_weight_pct: number | null;
  max_weight_pct: number | null;
  coverage_weight_pct: number | null;
};

export type EtfHoldingsSuggestion = {
  ticker: string;
  name: string;
  market: EtfHoldingsMarket;
  extra?: string;
};

export type EtfHoldingsLookupPayload = {
  ok: boolean;
  ticker?: string;
  market?: EtfHoldingsMarket;
  name?: string;
  type?: string | null;
  region?: string | null;
  as_of?: string | null;
  aum_label?: string | null;
  source?: string;
  source_note?: string;
  db_hit?: boolean;
  holdings?: EtfHoldingRow[];
  stats?: EtfHoldingsStats;
  suggestions?: EtfHoldingsSuggestion[];
  notes?: string[];
  error?: string;
};

const NAVER_ETF_LIST_URL = "https://finance.naver.com/api/sise/etfItemList.nhn";
const NAVER_UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type KrCache = { at: number; rows: EtfDbRow[] };
let krCache: KrCache | null = null;
const KR_TTL_MS = 10 * 60_000;

const KR_CODE = /^[0-9A-Z]{6}$/;
const US_TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function looksLikeKrCode(ticker: string): boolean {
  return KR_CODE.test(ticker) && /[0-9]/.test(ticker);
}

function looksLikeUsTicker(ticker: string): boolean {
  return US_TICKER.test(ticker) && !looksLikeKrCode(ticker);
}

function looksLikeTicker(raw: string): boolean {
  const t = raw.trim().toUpperCase();
  return looksLikeKrCode(t) || looksLikeUsTicker(t);
}

function analyzeWeights(holdings: EtfHoldingRow[]): EtfHoldingsStats {
  const weights = holdings
    .map((h) => h.weight_pct)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const top5 = weights.length ? sum(weights.slice(0, 5)) : null;
  const top10 = weights.length ? sum(weights.slice(0, 10)) : null;
  const maxW = weights.length ? Math.max(...weights) : null;
  const coverage = weights.length ? sum(weights) : null;
  return {
    holding_count: holdings.length,
    top5_weight_pct: top5 != null ? round2(top5) : null,
    top10_weight_pct: top10 != null ? round2(top10) : null,
    max_weight_pct: maxW != null ? round2(maxW) : null,
    coverage_weight_pct: coverage != null ? round2(coverage) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtAumEok(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}조`;
  return `${Math.round(n).toLocaleString("ko-KR")}억`;
}

const execFileAsync = promisify(execFile);

async function lookupUsViaLocalPython(
  ticker: string,
  limit: number,
): Promise<EtfHoldingsLookupPayload | null> {
  if (process.env.VERCEL) return null;
  const cwd = process.cwd().endsWith("webapp")
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
  try {
    const { stdout } = await execFileAsync(
      "python3",
      [
        "-c",
        "from etf_holdings_web import holdings_lookup_payload; import json,sys; " +
          `print(json.dumps(holdings_lookup_payload(${JSON.stringify(ticker)}, limit=${limit}), ensure_ascii=False))`,
      ],
      { cwd, timeout: 45_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as EtfHoldingsLookupPayload;
    return parsed?.ok ? parsed : null;
  } catch {
    return null;
  }
}

function fmtAumUsdMn(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
  return `$${n.toFixed(0)}M`;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseNum(raw: string | null): number | null {
  if (!raw) return null;
  const text = raw.replace(/[% ,]/g, "").trim();
  if (!text || text === "-") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Naver PC ETF page CU table — same source family as KR ETF DB / dart_etf_memb. */
async function fetchNaverCuHoldings(
  ticker: string,
  limit: number,
): Promise<EtfHoldingRow[]> {
  const res = await fetch(
    `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(ticker)}`,
    {
      headers: {
        "User-Agent": NAVER_UA,
        Referer: "https://finance.naver.com/",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) throw new Error(`Naver ETF page HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const utf8 = buf.toString("utf8");
  let html = utf8;
  if (!html.includes("구성자산") && !html.includes("구성종목")) {
    try {
      html = new TextDecoder("euc-kr").decode(buf);
    } catch {
      html = utf8;
    }
  }
  const tableMatch = html.match(
    /구성자산<\/span><\/h4>\s*<table[^>]*>([\s\S]*?)<\/table>/,
  );
  if (!tableMatch?.[1]) {
    throw new Error("Naver 구성종목 테이블을 찾지 못했습니다.");
  }
  const out: EtfHoldingRow[] = [];
  for (const tr of tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = tr[1] || "";
    const link = row.match(/code=([0-9A-Za-z]+)"[^>]*>([^<]+)<\/a>/);
    if (!link) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      stripTags(m[1] || ""),
    );
    out.push({
      code: link[1] || "",
      name: (link[2] || "").trim(),
      weight_pct: parseNum(cells[2] || null),
      price: parseNum(cells[3] || null),
      change_pct: parseNum(cells[5] || null),
    });
  }
  out.sort(
    (a, b) =>
      Number(a.weight_pct == null) - Number(b.weight_pct == null) ||
      (b.weight_pct || 0) - (a.weight_pct || 0),
  );
  if (!out.length) throw new Error("Naver 구성종목이 비어 있습니다.");
  return out.slice(0, Math.max(1, limit));
}

async function loadKrDb(): Promise<EtfDbRow[]> {
  if (krCache && Date.now() - krCache.at < KR_TTL_MS) return krCache.rows;
  const res = await fetch(NAVER_ETF_LIST_URL, {
    headers: {
      "User-Agent": NAVER_UA,
      Accept: "application/json,text/plain,*/*",
      Referer: "https://finance.naver.com/sise/etf.naver",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Naver ETF list HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("euc-kr").decode(buf);
  } catch {
    text = buf.toString("utf8");
  }
  const data = JSON.parse(text) as {
    result?: { etfItemList?: unknown[] };
  };
  const items = data?.result?.etfItemList;
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Naver ETF list empty");
  }
  const rows = items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) =>
      classifyNaverItem({
        itemcode: String(item.itemcode || ""),
        itemname: String(item.itemname || ""),
        etfTabCode: Number(item.etfTabCode || 0),
        nowVal: Number(item.nowVal),
        nav: Number(item.nav),
        changeRate: Number(item.changeRate),
        threeMonthEarnRate: Number(item.threeMonthEarnRate),
        marketSum: Number(item.marketSum),
      }),
    )
    .filter((row) => row.code);
  krCache = { at: Date.now(), rows };
  return rows;
}

function loadUsDb(): UsUniverseMeta[] {
  return uniqueUsUniverse();
}

function rankSuggestion(
  q: string,
  ticker: string,
  name: string,
): number {
  const t = ticker.toLowerCase();
  const n = name.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (n.startsWith(q)) return 2;
  if (t.includes(q)) return 3;
  if (n.includes(q)) return 4;
  return 9;
}

export function suggestFromDbs(
  query: string,
  kr: EtfDbRow[],
  us: UsUniverseMeta[],
  limit = 12,
): EtfHoldingsSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const hits: Array<EtfHoldingsSuggestion & { rank: number }> = [];
  for (const row of kr) {
    const rank = rankSuggestion(q, row.code, row.name);
    if (rank >= 9) continue;
    hits.push({
      ticker: row.code,
      name: row.name,
      market: "KR",
      extra: row.type,
      rank,
    });
  }
  for (const row of us) {
    const rank = rankSuggestion(q, row.symbol, row.name);
    if (rank >= 9) continue;
    hits.push({
      ticker: row.symbol,
      name: row.name,
      market: "US",
      extra: row.type,
      rank,
    });
  }
  hits.sort((a, b) => a.rank - b.rank || a.ticker.localeCompare(b.ticker));
  const seen = new Set<string>();
  const out: EtfHoldingsSuggestion[] = [];
  for (const hit of hits) {
    const key = `${hit.market}:${hit.ticker}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ticker: hit.ticker,
      name: hit.name,
      market: hit.market,
      extra: hit.extra,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function suggestEtfHoldings(
  query: string,
): Promise<EtfHoldingsLookupPayload> {
  const q = query.trim();
  if (q.length < 1) {
    return { ok: true, suggestions: [] };
  }
  const [kr, us] = await Promise.all([loadKrDb(), Promise.resolve(loadUsDb())]);
  return { ok: true, suggestions: suggestFromDbs(q, kr, us, 12) };
}

function resolveMarket(
  ticker: string,
  krHit: EtfDbRow | undefined,
  usHit: UsUniverseMeta | undefined,
  hint?: EtfHoldingsMarket,
): EtfHoldingsMarket | null {
  if (hint === "KR" && (krHit || looksLikeKrCode(ticker))) return "KR";
  if (hint === "US" && (usHit || looksLikeUsTicker(ticker))) return "US";
  if (krHit && !usHit) return "KR";
  if (usHit && !krHit) return "US";
  if (krHit && usHit) {
    return looksLikeKrCode(ticker) ? "KR" : "US";
  }
  if (looksLikeKrCode(ticker)) return "KR";
  if (looksLikeUsTicker(ticker)) return "US";
  return null;
}

async function lookupKr(
  ticker: string,
  dbRow: EtfDbRow | undefined,
  limit: number,
): Promise<EtfHoldingsLookupPayload> {
  let holdingsRaw: EtfHoldingRow[] = [];
  let source: "etfcheck_pdf" | "naver_cu" = "naver_cu";
  let asOf: string | null = null;
  const errors: string[] = [];

  try {
    holdingsRaw = await fetchNaverCuHoldings(ticker, limit);
    source = "naver_cu";
  } catch (exc) {
    errors.push(exc instanceof Error ? exc.message : String(exc));
  }

  if (!holdingsRaw.length) {
    try {
      const pdf = await fetchKrPdfWeights(ticker, Math.max(limit, 200));
      asOf = pdf.find((h) => h.as_of)?.as_of || null;
      holdingsRaw = pdf.slice(0, limit).map((h) => ({
        code: h.code,
        name: h.name,
        weight_pct: h.weight_pct,
        price: h.price,
        change_pct: h.change_pct,
      }));
      source = "etfcheck_pdf";
    } catch (exc) {
      errors.push(exc instanceof Error ? exc.message : String(exc));
    }
  }

  if (!holdingsRaw.length) {
    try {
      const bot = await fetchBotJson<EtfHoldingsLookupPayload>(
        `/api/web/etf-holdings?ticker=${encodeURIComponent(ticker)}&market=KR&limit=${limit}`,
        { timeoutMs: 40_000 },
      );
      if (bot?.ok && bot.holdings?.length) {
        return {
          ...bot,
          market: "KR",
          ticker,
          name: dbRow?.name || bot.name || ticker,
          type: dbRow?.type ?? bot.type ?? null,
          region: dbRow?.country ?? bot.region ?? null,
          aum_label: fmtAumEok(dbRow?.aum_eok) || bot.aum_label,
          db_hit: !!dbRow,
        };
      }
    } catch (exc) {
      errors.push(exc instanceof Error ? exc.message : String(exc));
    }
  }

  if (!holdingsRaw.length) {
    return {
      ok: false,
      ticker,
      market: "KR",
      name: dbRow?.name,
      type: dbRow?.type ?? null,
      region: dbRow?.country ?? null,
      db_hit: !!dbRow,
      source: "naver_cu",
      source_note: "국내 ETF DB(Naver) · 편입비: Naver CU / ETF CHECK PDF",
      error: `구성종목 조회 실패: ${errors.join(" · ") || "데이터 없음"}`,
    };
  }

  const notes: string[] = [];
  if (!dbRow) {
    notes.push("국내 ETF DB 정확 일치가 없어 티커 형식으로 국내 편입비를 조회했습니다.");
  }
  if (source === "naver_cu") {
    notes.push("Naver 구성자산은 CU 기준 상위 종목입니다. 전체 PDF는 ETF CHECK가 열릴 때 확장됩니다.");
  }
  return {
    ok: true,
    ticker,
    market: "KR",
    name: dbRow?.name || ticker,
    type: dbRow?.type ?? null,
    region: dbRow?.country ?? null,
    as_of: asOf,
    aum_label: fmtAumEok(dbRow?.aum_eok),
    source,
    source_note:
      source === "naver_cu"
        ? "국내 ETF DB(Naver 상장 유니버스) · 편입비: Naver 구성자산"
        : "국내 ETF DB(Naver 상장 유니버스) · 편입비: ETF CHECK 일간 PDF",
    db_hit: !!dbRow,
    holdings: holdingsRaw,
    stats: analyzeWeights(holdingsRaw),
    notes: notes.length ? notes : undefined,
  };
}

async function lookupUs(
  ticker: string,
  dbRow: UsUniverseMeta | undefined,
  limit: number,
): Promise<EtfHoldingsLookupPayload> {
  const errors: string[] = [];
  const mergeUs = (
    payload: EtfHoldingsLookupPayload,
  ): EtfHoldingsLookupPayload => ({
    ...payload,
    market: "US",
    ticker,
    name: payload.name || dbRow?.name || ticker,
    type: dbRow?.type ?? payload.type ?? null,
    region: dbRow?.region ?? payload.region ?? null,
    db_hit: !!dbRow,
    source: payload.source || "etfcheck_global_pdf",
    source_note:
      payload.source_note || "미국 ETF DB · 편입비: ETF CHECK 글로벌 PDF",
  });

  if (!process.env.VERCEL) {
    const local = await lookupUsViaLocalPython(ticker, limit);
    if (local?.ok && local.holdings?.length) return mergeUs(local);
  }

  try {
    const bot = await fetchBotJson<EtfHoldingsLookupPayload>(
      `/api/web/etf-holdings?ticker=${encodeURIComponent(ticker)}&market=US&limit=${limit}`,
      { timeoutMs: 40_000 },
    );
    if (bot?.ok && bot.holdings?.length) return mergeUs(bot);
    if (bot?.error) errors.push(bot.error);
  } catch (exc) {
    errors.push(exc instanceof Error ? exc.message : String(exc));
  }

  try {
    return await lookupUsInner(ticker, dbRow, limit);
  } catch (exc) {
    errors.push(exc instanceof Error ? exc.message : String(exc));
    return {
      ok: false,
      ticker,
      market: "US",
      name: dbRow?.name,
      type: dbRow?.type ?? null,
      region: dbRow?.region ?? null,
      db_hit: !!dbRow,
      source: "etfcheck_global_pdf",
      source_note: "미국 ETF DB · ETF CHECK 글로벌 PDF",
      error: `구성종목 조회 실패: ${errors.join(" · ")}`,
    };
  }
}

async function lookupUsInner(
  ticker: string,
  dbRow: UsUniverseMeta | undefined,
  limit: number,
): Promise<EtfHoldingsLookupPayload> {
  const mast = await fetchGlobalEtfMastBySymbol();
  const mastRow = mast.get(ticker);
  if (!mastRow) {
    return {
      ok: false,
      ticker,
      market: "US",
      name: dbRow?.name,
      type: dbRow?.type ?? null,
      region: dbRow?.region ?? null,
      db_hit: !!dbRow,
      source: "etfcheck_global_pdf",
      source_note: "미국 ETF DB · ETF CHECK 글로벌 PDF",
      error: dbRow
        ? "미국 ETF DB에는 있으나 ETF CHECK 글로벌 마스터에 없습니다."
        : "미국 ETF DB와 ETF CHECK 글로벌 마스터에서 티커를 찾지 못했습니다.",
    };
  }

  const [info, raw] = await Promise.all([
    fetchGlobalEtfItemInfo(mastRow.mstar_id).catch(() => null),
    fetchGlobalEtfPdfDetail(mastRow.mstar_id, 800),
  ]);
  const holdings = raw.slice(0, limit).map((h) => ({
    code: h.code,
    name: h.name,
    weight_pct: h.weight_pct,
  }));
  if (!holdings.length) {
    return {
      ok: false,
      ticker,
      market: "US",
      name:
        String(info?.FUNDNAME || mastRow.name || dbRow?.name || ticker).trim() ||
        ticker,
      type: dbRow?.type ?? null,
      region: dbRow?.region ?? null,
      db_hit: !!dbRow,
      source: "etfcheck_global_pdf",
      source_note: "미국 ETF DB · ETF CHECK 글로벌 PDF",
      error: "ETF CHECK 글로벌 PDF 구성종목이 비어 있습니다.",
    };
  }

  const asOf = String(info?.TRADEDATE || info?.W01010_date || "").trim() || null;
  const aumUsd = Number(info?.CLSNETASSETS);
  const aumMn =
    Number.isFinite(aumUsd) && aumUsd > 0
      ? aumUsd / 1e6
      : dbRow?.aum_seed_mn ?? null;

  return {
    ok: true,
    ticker,
    market: "US",
    name:
      String(info?.FUNDNAME || mastRow.name || dbRow?.name || ticker).trim() ||
      ticker,
    type: dbRow?.type ?? null,
    region: dbRow?.region ?? null,
    as_of: asOf && /^\d{8}$/.test(asOf)
      ? `${asOf.slice(0, 4)}-${asOf.slice(4, 6)}-${asOf.slice(6, 8)}`
      : asOf,
    aum_label: fmtAumUsdMn(aumMn),
    source: "etfcheck_global_pdf",
    source_note: "미국 ETF DB(AUM Top1000) · 편입비: ETF CHECK 글로벌 PDF",
    db_hit: !!dbRow,
    holdings,
    stats: analyzeWeights(holdings),
    notes: dbRow
      ? undefined
      : ["미국 ETF DB(Top1000) 밖 티커라 ETF CHECK 글로벌 마스터로 조회했습니다."],
  };
}

export async function lookupEtfHoldings(
  raw: string,
  opts?: { market?: EtfHoldingsMarket; limit?: number },
): Promise<EtfHoldingsLookupPayload> {
  const query = raw.trim();
  if (!query) {
    return { ok: false, error: "티커를 입력하세요." };
  }
  const limit = Math.max(10, Math.min(300, opts?.limit ?? 80));
  const us = loadUsDb();

  if (!looksLikeTicker(query)) {
    const kr = await loadKrDb().catch(() => [] as EtfDbRow[]);
    const suggestions = suggestFromDbs(query, kr, us, 12);
    if (suggestions.length === 1) {
      return lookupEtfHoldings(suggestions[0]!.ticker, {
        market: suggestions[0]!.market,
        limit,
      });
    }
    if (suggestions.length > 1) {
      return {
        ok: false,
        error: "여러 종목이 맞습니다. 아래에서 티커를 선택하세요.",
        suggestions,
      };
    }
    return {
      ok: false,
      error:
        "국내 ETF DB와 미국 ETF DB에서 일치하는 종목을 찾지 못했습니다. 티커를 확인하세요.",
      suggestions: [],
    };
  }

  const ticker = query.toUpperCase();
  const usHit = us.find((row) => row.symbol.toUpperCase() === ticker);
  const likelyUs = looksLikeUsTicker(ticker) && !looksLikeKrCode(ticker);
  const kr =
    likelyUs && !opts?.market
      ? []
      : await loadKrDb().catch(() => [] as EtfDbRow[]);
  const krHit = kr.find((row) => row.code.toUpperCase() === ticker);
  const market = resolveMarket(ticker, krHit, usHit, opts?.market);
  if (!market) {
    return {
      ok: false,
      ticker,
      error:
        "국내 상장(Naver ETF DB) 또는 미국 상장(US ETF DB) 티커만 조회할 수 있습니다.",
      suggestions: suggestFromDbs(query, kr, us, 8),
    };
  }

  if (market === "KR") return lookupKr(ticker, krHit, limit);
  return lookupUs(ticker, usHit, limit);
}

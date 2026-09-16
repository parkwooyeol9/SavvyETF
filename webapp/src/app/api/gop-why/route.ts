import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import { lookupEtfHoldings } from "@/lib/etfHoldingsLookup";
import {
  GOP_WHY_NOTE,
  classifyGopSector,
  emptyGopWhy,
  interpretGopWhy,
  rollupGopSectors,
  yahooHoldingSymbol,
  type GopWhyDriver,
  type GopWhyPayload,
} from "@/lib/gopWhy";
import {
  POLI_RANGES,
  POLI_YAHOO_QUERY,
  parsePoliRange,
  type PoliRange,
} from "@/lib/poliThemes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const DRIVER_LIMIT = 10;

type ChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function rangeReturn(symbol: string, range: PoliRange): Promise<number | null> {
  const q = POLI_YAHOO_QUERY[range];
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=${q.range}&interval=${q.interval}&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as ChartPayload;
    const result = payload.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const vals: number[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c != null && Number.isFinite(c)) vals.push(c);
    }
    if (vals.length < 2) return null;
    const first = vals[0]!;
    const last = vals[vals.length - 1]!;
    if (!first) return null;
    return round2(((last / first - 1) * 100));
  } catch {
    return null;
  }
}

async function buildPayload(range: PoliRange): Promise<GopWhyPayload> {
  const rangeLabel = POLI_RANGES.find((r) => r.id === range)?.label || range;
  const holdingsPromise = Promise.race([
    lookupEtfHoldings("GOP", { market: "US", limit: 30 }).catch(() => null),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 12_000);
    }),
  ]);
  const [gopRet, spyRet, xleRet, xlfRet, itaRet, holdings] = await Promise.all([
    rangeReturn("GOP", range).then(async (v) => v ?? rangeReturn("KRUZ", range)),
    rangeReturn("SPY", range),
    rangeReturn("XLE", range),
    rangeReturn("XLF", range),
    rangeReturn("ITA", range),
    holdingsPromise,
  ]);

  const rows = (holdings?.ok ? holdings.holdings : []) || [];
  const candidates = rows
    .map((h) => {
      const yahoo = yahooHoldingSymbol(h.code || "");
      return yahoo
        ? {
            ticker: yahoo,
            name: h.name || yahoo,
            weight_pct: h.weight_pct ?? null,
          }
        : null;
    })
    .filter((h): h is { ticker: string; name: string; weight_pct: number | null } => Boolean(h))
    .sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0))
    .slice(0, DRIVER_LIMIT);

  const returns = await Promise.all(candidates.map((h) => rangeReturn(h.ticker, range)));
  const drivers: GopWhyDriver[] = candidates.map((h, i) => {
    const sector = classifyGopSector(h.ticker, h.name);
    const ret = returns[i] ?? null;
    const contribution =
      ret != null && h.weight_pct != null ? round2((h.weight_pct / 100) * ret) : null;
    return {
      ticker: h.ticker,
      name: h.name,
      weight_pct: h.weight_pct != null ? round2(h.weight_pct) : null,
      return_pct: ret,
      contribution_pct: contribution,
      sector: sector.id,
      sector_ko: sector.ko,
    };
  });

  const sectors = rollupGopSectors(drivers);
  const coverage = drivers.reduce((a, d) => a + (d.weight_pct || 0), 0);
  const explained = drivers.reduce((a, d) => a + (d.contribution_pct || 0), 0);
  const vsSpy =
    gopRet != null && spyRet != null ? round2(gopRet - spyRet) : null;
  const copy = interpretGopWhy({
    rangeLabel,
    fundReturn: gopRet,
    spyReturn: spyRet,
    xleReturn: xleRet,
    xlfReturn: xlfRet,
    itaReturn: itaRet,
    drivers,
    sectors,
    coverage: coverage || null,
  });

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    range,
    ticker: "GOP",
    former_ticker: "KRUZ",
    fund_return_pct: gopRet,
    spy_return_pct: spyRet,
    vs_spy_pct: vsSpy,
    xle_return_pct: xleRet,
    xlf_return_pct: xlfRet,
    ita_return_pct: itaRet,
    headline: copy.headline,
    mode: copy.mode,
    bullets: copy.bullets,
    drivers,
    sectors,
    coverage_weight_pct: coverage ? round2(coverage) : null,
    explained_contrib_pct: explained ? round2(explained) : null,
    as_of: holdings?.as_of || null,
    note: GOP_WHY_NOTE,
    error: holdings?.ok ? undefined : holdings?.error,
  };
}

export async function GET(request: Request) {
  const range = parsePoliRange(new URL(request.url).searchParams.get("range"));
  try {
    const payload = await withServerCache(
      `gop-why-v1-${range}`,
      600_000,
      1_200_000,
      () => buildPayload(range),
    );
    return jsonWithCdnCache(payload, "yahoo");
  } catch (exc) {
    return jsonWithCdnCache(
      emptyGopWhy(range, exc instanceof Error ? exc.message : "GOP 분석 실패"),
      "yahoo",
      200,
    );
  }
}

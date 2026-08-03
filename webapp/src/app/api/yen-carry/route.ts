import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  YEN_CARRY_ASSET_SPECS,
  YEN_CARRY_SCHEDULE_NOTE,
  buildCarryToRiskSeries,
  buildRateSpreadSeries,
  computeYenCarryStress,
  deltaOver,
  downsample,
  lastValue,
  parseYenCarryRange,
  pctChange,
  realizedVol,
  realizedVolSeries,
  type YenCarryAsset,
  type YenCarryCftcPoint,
  type YenCarryPayload,
  type YenCarryPoint,
  type YenCarryRange,
  type YenCarrySnapshot,
} from "@/lib/yenCarry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

type CftcRow = {
  report_date_as_yyyy_mm_dd?: string;
  noncomm_positions_long_all?: string;
  noncomm_positions_short_all?: string;
  open_interest_all?: string;
  market_and_exchange_names?: string;
};

const RANGE_TO_YAHOO: Record<YenCarryRange, string> = {
  "6mo": "6mo",
  "1y": "1y",
  "2y": "2y",
  "5y": "5y",
};

/** Calendar lookback for FRED CSV so charts cover the selected UI range. */
const RANGE_TO_DAYS: Record<YenCarryRange, number> = {
  "6mo": 200,
  "1y": 400,
  "2y": 800,
  "5y": 2000,
};

async function fetchYahooSeries(
  symbol: string,
  range: string,
  maxPoints = 260,
): Promise<{ price: number | null; series: YenCarryPoint[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 180 },
  });
  if (!res.ok) return { price: null, series: [] };
  const payload = (await res.json()) as YahooChart;
  const result = payload.chart?.result?.[0];
  if (!result) return { price: null, series: [] };
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const series: YenCarryPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    series.push({
      date: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
      value: close,
    });
  }
  const price =
    result.meta?.regularMarketPrice ??
    (series.length ? series[series.length - 1]!.value : null);
  return { price, series: downsample(series, maxPoints) };
}

async function fetchFredCsv(
  seriesId: string,
  lookbackDays: number,
): Promise<YenCarryPoint[]> {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${startStr}&coed=${endStr}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/csv" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const out: YenCarryPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    const raw = line.slice(comma + 1).trim();
    if (!date || raw === "." || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

async function fetchCftcYen(limit = 260): Promise<YenCarryCftcPoint[]> {
  const url =
    "https://publicreporting.cftc.gov/resource/6dca-aqww.json?" +
    new URLSearchParams({
      $where: "market_and_exchange_names like '%JAPANESE YEN%'",
      $order: "report_date_as_yyyy_mm_dd DESC",
      $limit: String(limit),
    }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as CftcRow[];
  const out: YenCarryCftcPoint[] = [];
  for (const row of rows) {
    const dateRaw = row.report_date_as_yyyy_mm_dd || "";
    const date = dateRaw.slice(0, 10);
    const long = Number(row.noncomm_positions_long_all);
    const short = Number(row.noncomm_positions_short_all);
    const oi = Number(row.open_interest_all);
    if (!date || !Number.isFinite(long) || !Number.isFinite(short)) continue;
    out.push({
      date,
      long,
      short,
      net_noncomm: long - short,
      open_interest: Number.isFinite(oi) ? oi : 0,
    });
  }
  // API returns newest first — chronological for charts
  return out.reverse();
}

function filterByRange(
  series: YenCarryPoint[],
  range: YenCarryRange,
): YenCarryPoint[] {
  if (!series.length) return [];
  const days = RANGE_TO_DAYS[range];
  const cutoff = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return series.filter((p) => p.date >= cutoff);
}

async function buildPayload(range: YenCarryRange): Promise<YenCarryPayload> {
  const generated_at = new Date().toISOString();
  const yahooRange = RANGE_TO_YAHOO[range];
  const fredDays = Math.max(RANGE_TO_DAYS[range], 1400); // need history for percentiles
  const notes: string[] = [
    "2024-08 참조: BoJ 인상 + 약한 고용 + VIX 급등으로 엔케리·레버리지 청산 동시 발생 (BIS Bulletin 90).",
    "CFTC는 화요일 포지션을 금요일에 공시 — 시차가 있습니다.",
  ];

  const [
    yahooJpy,
    yahooVix,
    yahooUs10,
    fredUsdjpy,
    fredUs10,
    fredJp10,
    fredVix,
    fredHy,
    cftc,
    assetResults,
  ] = await Promise.all([
    fetchYahooSeries("JPY=X", "5y", 900),
    fetchYahooSeries("^VIX", "5y", 900),
    fetchYahooSeries("^TNX", "5y", 900),
    fetchFredCsv("DEXJPUS", fredDays),
    fetchFredCsv("DGS10", fredDays),
    fetchFredCsv("IRLTLT01JPM156N", Math.max(fredDays, 2000)),
    fetchFredCsv("VIXCLS", fredDays),
    fetchFredCsv("BAMLH0A0HYM2", fredDays),
    fetchCftcYen(260),
    Promise.all(
      YEN_CARRY_ASSET_SPECS.map(async (spec): Promise<YenCarryAsset> => {
        try {
          const { price, series } = await fetchYahooSeries(
            spec.symbol,
            yahooRange,
            180,
          );
          return {
            id: spec.id,
            symbol: spec.symbol,
            label: spec.label,
            group: spec.group,
            thesis: spec.thesis,
            price,
            change_1d_pct: pctChange(series, 1),
            change_5d_pct: pctChange(series, 5),
            change_20d_pct: pctChange(series, 20),
            change_range_pct:
              series.length >= 2
                ? ((series[series.length - 1]!.value / series[0]!.value - 1) *
                    100)
                : null,
            series,
          };
        } catch (exc) {
          return {
            id: spec.id,
            symbol: spec.symbol,
            label: spec.label,
            group: spec.group,
            thesis: spec.thesis,
            price: null,
            change_1d_pct: null,
            change_5d_pct: null,
            change_20d_pct: null,
            change_range_pct: null,
            error: exc instanceof Error ? exc.message : "fetch fail",
          };
        }
      }),
    ),
  ]);

  // Prefer FRED for official series; Yahoo as live fallback / fresher tip.
  const usdjpyFull =
    fredUsdjpy.length >= 20 ? fredUsdjpy : yahooJpy.series;
  const us10Full = fredUs10.length >= 20 ? fredUs10 : yahooUs10.series;
  const vixFull = fredVix.length >= 20 ? fredVix : yahooVix.series;
  const jp10Full = fredJp10;
  const hyFull = fredHy;

  // Tip USD/JPY with Yahoo when FRED lags (H.10 often 1–5 sessions behind).
  let usdjpyForSnap = usdjpyFull;
  if (
    yahooJpy.series.length &&
    usdjpyFull.length &&
    yahooJpy.series[yahooJpy.series.length - 1]!.date >
      usdjpyFull[usdjpyFull.length - 1]!.date
  ) {
    const tip = yahooJpy.series.filter(
      (p) => p.date > usdjpyFull[usdjpyFull.length - 1]!.date,
    );
    usdjpyForSnap = [...usdjpyFull, ...tip];
  }

  if (!fredUsdjpy.length) notes.push("USD/JPY: FRED 미응답 → Yahoo JPY=X 사용");
  if (!fredJp10.length) notes.push("일본 10Y: FRED 월간 계열 없음 — 스프레드 제한");
  if (!cftc.length) notes.push("CFTC COT 미응답 — 포지션 섹션 비어 있음");

  const rateSpreadFull = buildRateSpreadSeries(us10Full, jp10Full);
  const volFull = realizedVolSeries(usdjpyForSnap, 20);
  const ctrFull = buildCarryToRiskSeries(rateSpreadFull, volFull);

  const stress = computeYenCarryStress({
    usdjpy: usdjpyForSnap,
    vix: vixFull,
    rateSpread: rateSpreadFull,
    cftcNet: cftc,
  });

  const usdjpy = filterByRange(usdjpyForSnap, range);
  const us10 = filterByRange(us10Full, range);
  const jp10 = filterByRange(jp10Full, range);
  const rateSpread = filterByRange(rateSpreadFull, range);
  const vix = filterByRange(vixFull, range);
  const vol = filterByRange(volFull, range);
  const ctr = filterByRange(ctrFull, range);
  const hy = filterByRange(hyFull, range);
  const cftcRange = cftc.filter((p) => {
    const days = RANGE_TO_DAYS[range];
    const cutoff = new Date(Date.now() - days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return p.date >= cutoff;
  });

  const snapshot: YenCarrySnapshot = {
    as_of:
      lastValue(usdjpyForSnap) != null
        ? usdjpyForSnap[usdjpyForSnap.length - 1]?.date || null
        : null,
    usdjpy: lastValue(usdjpyForSnap) ?? yahooJpy.price,
    usdjpy_5d_pct: pctChange(usdjpyForSnap, 5),
    usdjpy_20d_pct: pctChange(usdjpyForSnap, 20),
    usdjpy_realized_vol_20d: realizedVol(usdjpyForSnap, 20),
    us_10y: lastValue(us10Full),
    jp_10y: lastValue(jp10Full),
    rate_spread_10y: lastValue(rateSpreadFull),
    rate_spread_60d_chg: deltaOver(rateSpreadFull, 60),
    carry_to_risk: lastValue(ctrFull),
    vix: lastValue(vixFull) ?? yahooVix.price,
    hy_oas: lastValue(hyFull),
    cftc_net_noncomm: cftc.length
      ? cftc[cftc.length - 1]!.net_noncomm
      : null,
    cftc_as_of: cftc.length ? cftc[cftc.length - 1]!.date : null,
  };

  return {
    ok: true,
    generated_at,
    range,
    note: "FRED + Yahoo + CFTC · 엔케리 청산 모니터",
    schedule_note: YEN_CARRY_SCHEDULE_NOTE,
    snapshot,
    stress,
    series: {
      usdjpy: downsample(usdjpy, 220),
      us_10y: downsample(us10, 220),
      jp_10y: downsample(jp10, 120),
      rate_spread_10y: downsample(rateSpread, 220),
      carry_to_risk: downsample(ctr, 220),
      vix: downsample(vix, 220),
      usdjpy_realized_vol: downsample(vol, 220),
      hy_oas: downsample(hy, 220),
    },
    cftc: cftcRange,
    assets: assetResults,
    notes,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = parseYenCarryRange(url.searchParams.get("range"));
  const cacheKey = `yen-carry:v1:${range}`;

  try {
    const payload = await withServerCache(cacheKey, 120_000, 600_000, () =>
      buildPayload(range),
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        range,
        note: "",
        schedule_note: YEN_CARRY_SCHEDULE_NOTE,
        snapshot: {
          as_of: null,
          usdjpy: null,
          usdjpy_5d_pct: null,
          usdjpy_20d_pct: null,
          usdjpy_realized_vol_20d: null,
          us_10y: null,
          jp_10y: null,
          rate_spread_10y: null,
          rate_spread_60d_chg: null,
          carry_to_risk: null,
          vix: null,
          hy_oas: null,
          cftc_net_noncomm: null,
          cftc_as_of: null,
        },
        stress: {
          score: 0,
          regime: "Calm",
          regime_ko: "안정",
          drivers: [message],
          components: {
            usdjpy_drop: 0,
            usdjpy_vol: 0,
            vix: 0,
            cftc_crowd: 0,
            spread_compress: 0,
          },
          weights: {
            usdjpy_drop: 0.25,
            usdjpy_vol: 0.2,
            vix: 0.15,
            cftc_crowd: 0.2,
            spread_compress: 0.2,
          },
        },
        series: {
          usdjpy: [],
          us_10y: [],
          jp_10y: [],
          rate_spread_10y: [],
          carry_to_risk: [],
          vix: [],
          usdjpy_realized_vol: [],
          hy_oas: [],
        },
        cftc: [],
        assets: [],
        notes: [],
        error: message,
      } satisfies YenCarryPayload,
      { status: 502 },
    );
  }
}

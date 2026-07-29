import { NextResponse } from "next/server";

import {
  AI_INFRA_BENCHMARK,
  AI_INFRA_DAILY_BUCKETS,
  AI_INFRA_OWID_ENTITIES,
  AI_INFRA_ROADMAP,
  type AiInfraCountryMetric,
  type AiInfraPayload,
  type AiInfraPoint,
  type AiInfraProvenance,
  type AiInfraSignal,
} from "@/lib/aiInfra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type ChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

function kstYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function provenanceBase(
  partial: Omit<AiInfraProvenance, "collected_today" | "newly_published_today"> & {
    collected_today?: boolean;
    newly_published_today?: boolean;
  },
): AiInfraProvenance {
  const today = kstYmd();
  const fetchedDay = kstYmd(new Date(partial.fetched_at));
  const publishDay = partial.published_at || partial.observed_at || null;
  return {
    ...partial,
    collected_today: partial.collected_today ?? fetchedDay === today,
    newly_published_today:
      partial.newly_published_today ?? (publishDay != null && publishDay === today),
  };
}

function downsample(points: AiInfraPoint[], maxPoints: number): AiInfraPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

async function fetchYahooSignal(
  spec: { id: string; symbol: string; label: string; thesis: string },
  fetchedAt: string,
  spy1m: number | null,
): Promise<AiInfraSignal> {
  const base: AiInfraSignal = {
    id: spec.id,
    symbol: spec.symbol,
    label: spec.label,
    thesis: spec.thesis,
    price: null,
    change_1d_pct: null,
    change_1m_pct: null,
  };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.symbol)}?range=3mo&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 180 },
    });
    if (!res.ok) return { ...base, error: `HTTP ${res.status}` };
    const payload = (await res.json()) as ChartPayload;
    const result = payload.chart?.result?.[0];
    if (!result) return { ...base, error: "no data" };

    const timestamps = result.timestamp || [];
    const rawCloses = result.indicators?.quote?.[0]?.close || [];
    const points: AiInfraPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = rawCloses[i];
      if (close == null || !Number.isFinite(close)) continue;
      points.push({
        date: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
        close: Math.round(close * 1000) / 1000,
      });
    }
    if (points.length < 2) return { ...base, error: "no closes" };

    const closes = points.map((p) => p.close);
    const last = closes[closes.length - 1]!;
    const prev = closes[closes.length - 2]!;
    const monthAgo = closes.length >= 22 ? closes[closes.length - 22]! : closes[0]!;
    const change_1d_pct =
      prev && prev !== 0 ? Math.round(((last / prev - 1) * 100) * 100) / 100 : null;
    const change_1m_pct =
      monthAgo && monthAgo !== 0
        ? Math.round(((last / monthAgo - 1) * 100) * 100) / 100
        : null;
    const observed_at = points[points.length - 1]!.date;
    const excess_1m_vs_spy =
      change_1m_pct != null && spy1m != null
        ? Math.round((change_1m_pct - spy1m) * 100) / 100
        : null;

    return {
      ...base,
      price: last,
      change_1d_pct,
      change_1m_pct,
      excess_1m_vs_spy,
      series: downsample(points, 60),
      provenance: provenanceBase({
        cadence: "daily",
        source_name: "Yahoo Finance",
        source_url: `https://finance.yahoo.com/quote/${encodeURIComponent(spec.symbol)}`,
        unit: "USD",
        methodology: "Daily adjusted close (chart API). Not investment advice.",
        fetched_at: fetchedAt,
        observed_at,
        period_end: observed_at,
        revision_status: "final",
      }),
    };
  } catch (exc) {
    return {
      ...base,
      error: exc instanceof Error ? exc.message : "fetch failed",
    };
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}

type OwidSeriesSpec = {
  id: string;
  path: string;
  metric: string;
  metric_ko: string;
  unit: string;
  valueColHint: string;
};

const OWID_SPECS: OwidSeriesSpec[] = [
  {
    id: "carbon_intensity",
    path: "carbon-intensity-electricity",
    metric: "Carbon intensity of electricity",
    metric_ko: "전력 탄소집약도",
    unit: "gCO2/kWh",
    valueColHint: "Carbon intensity",
  },
  {
    id: "renewable_share",
    path: "share-electricity-renewables",
    metric: "Share of electricity from renewables",
    metric_ko: "재생에너지 발전 비중",
    unit: "%",
    valueColHint: "renewables",
  },
  {
    id: "electricity_demand",
    path: "electricity-demand",
    metric: "Electricity demand",
    metric_ko: "전력 수요",
    unit: "TWh",
    valueColHint: "demand",
  },
];

function pickValueColumn(header: string[], hint: string): number {
  const lowerHint = hint.toLowerCase();
  let idx = header.findIndex((h) => h.toLowerCase().includes(lowerHint));
  if (idx >= 0) return idx;
  // Entity, Code, Year, value...
  return Math.min(3, header.length - 1);
}

async function fetchOwidMetric(
  spec: OwidSeriesSpec,
  fetchedAt: string,
): Promise<AiInfraCountryMetric[]> {
  const url = `https://ourworldindata.org/grapher/${spec.path}.csv?v=1&csvType=full&useColumnGeoEntities=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/csv" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    return AI_INFRA_OWID_ENTITIES.map((e) => ({
      entity: e.entity,
      entity_ko: e.entity_ko,
      metric: spec.metric,
      metric_ko: spec.metric_ko,
      value: null,
      previous: null,
      yoy_pct: null,
      unit: spec.unit,
      period_end: null,
      provenance: provenanceBase({
        cadence: "annual",
        source_name: "Our World in Data (Ember)",
        source_url: `https://ourworldindata.org/grapher/${spec.path}`,
        unit: spec.unit,
        methodology: "Annual series via OWID Grapher CSV. Ember underlying data (CC-BY-4.0).",
        fetched_at: fetchedAt,
        revision_status: "unknown",
      }),
      error: `HTTP ${res.status}`,
    }));
  }

  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return [];
  }
  const header = rows[0]!;
  const entityIdx = header.findIndex((h) => /entity/i.test(h));
  const yearIdx = header.findIndex((h) => /year/i.test(h));
  const valueIdx = pickValueColumn(header, spec.valueColHint);
  if (entityIdx < 0 || yearIdx < 0 || valueIdx < 0) {
    return [];
  }

  const wanted = new Map(AI_INFRA_OWID_ENTITIES.map((e) => [e.entity, e.entity_ko]));
  const byEntity = new Map<string, Array<{ year: number; value: number }>>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const entity = (row[entityIdx] || "").trim();
    if (!wanted.has(entity)) continue;
    const year = Number(row[yearIdx]);
    const value = Number(String(row[valueIdx] || "").replace(/,/g, ""));
    if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
    const list = byEntity.get(entity) || [];
    list.push({ year, value });
    byEntity.set(entity, list);
  }

  const out: AiInfraCountryMetric[] = [];
  for (const [entity, entity_ko] of wanted) {
    const series = (byEntity.get(entity) || []).sort((a, b) => a.year - b.year);
    const last = series[series.length - 1];
    const prev = series.length >= 2 ? series[series.length - 2] : null;
    const yoy =
      last && prev && prev.value !== 0
        ? Math.round(((last.value / prev.value - 1) * 100) * 100) / 100
        : null;
    out.push({
      entity,
      entity_ko,
      metric: spec.metric,
      metric_ko: spec.metric_ko,
      value: last ? Math.round(last.value * 100) / 100 : null,
      previous: prev ? Math.round(prev.value * 100) / 100 : null,
      yoy_pct: yoy,
      unit: spec.unit,
      period_end: last ? String(last.year) : null,
      series: series.slice(-8).map((p) => ({
        period: String(p.year),
        value: Math.round(p.value * 100) / 100,
      })),
      provenance: provenanceBase({
        cadence: "annual",
        source_name: "Our World in Data (Ember)",
        source_url: `https://ourworldindata.org/grapher/${spec.path}`,
        unit: spec.unit,
        methodology:
          "Annual OWID Grapher CSV. Underlying electricity data from Ember (CC-BY-4.0). period_end is the statistical year, not fetch day.",
        fetched_at: fetchedAt,
        observed_at: last ? `${last.year}-12-31` : null,
        period_end: last ? String(last.year) : null,
        published_at: null,
        revision_status: "final",
      }),
    });
  }
  return out;
}

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const spy = await fetchYahooSignal(AI_INFRA_BENCHMARK, fetchedAt, null);
    const spy1m = spy.change_1m_pct;

    const dailySignals = await Promise.all(
      AI_INFRA_DAILY_BUCKETS.flatMap((b) =>
        b.signals.map((s) => fetchYahooSignal(s, fetchedAt, spy1m)),
      ),
    );
    const byId = new Map(dailySignals.map((s) => [s.id, s]));
    const buckets = AI_INFRA_DAILY_BUCKETS.map((b) => ({
      id: b.id,
      title: b.title,
      title_en: b.title_en,
      blurb: b.blurb,
      signals: b.signals.map((s) => byId.get(s.id)!).filter(Boolean),
    }));

    const powerIds = ["grid", "xlu", "nlr", "dtcr"];
    const powerRets = powerIds
      .map((id) => byId.get(id)?.change_1m_pct)
      .filter((n): n is number => n != null);
    const powerAvg =
      powerRets.length >= 2
        ? powerRets.reduce((a, b) => a + b, 0) / powerRets.length
        : null;
    const stress =
      powerAvg != null && spy1m != null
        ? Math.round((powerAvg - spy1m) * 100) / 100
        : null;

    const carbon = await fetchYahooSignal(
      {
        id: "krbn",
        symbol: "KRBN",
        label: "탄소배출권",
        thesis: "글로벌 탄소 선물 바스켓 (일간 가격 프록시)",
      },
      fetchedAt,
      spy1m,
    );

    const annualNested = await Promise.all(
      OWID_SPECS.map((spec) => fetchOwidMetric(spec, fetchedAt)),
    );
    const annualMetrics = annualNested.flat();

    const payload: AiInfraPayload = {
      ok: true,
      generated_at: fetchedAt,
      note:
        "일간=시장 프록시(Yahoo), 연간=전력 지표(OWID/Ember). fetched_at과 period_end를 혼동하지 마세요.",
      timezone_display: "Asia/Seoul",
      daily: {
        buckets,
        power_stress_proxy: {
          value: stress,
          label: "Power Stress Proxy (estimated)",
          note:
            "추정: mean(1M% of GRID/XLU/NLR/DTCR) − 1M% SPY. 전력수요·용량 데이터가 없어 정식 Power Constraint Index가 아님.",
          provenance: provenanceBase({
            cadence: "daily",
            source_name: "SavvyETF derived from Yahoo",
            unit: "pp vs SPY (1M)",
            methodology: "Estimated relative-return proxy only.",
            fetched_at: fetchedAt,
            observed_at: spy.provenance?.observed_at || null,
            revision_status: "estimated",
          }),
        },
        carbon_etf: carbon,
      },
      annual: {
        metrics: annualMetrics,
        note:
          "Ember 기반 연간 시계열(OWID). 월간 Ember API·KPX 실시간은 로드맵. Cite: Ember / Our World in Data.",
      },
      roadmap: AI_INFRA_ROADMAP,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=180, stale-while-revalidate=600",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        generated_at: fetchedAt,
        note: "",
        timezone_display: "Asia/Seoul",
        daily: {
          buckets: [],
          power_stress_proxy: {
            value: null,
            label: "Power Stress Proxy",
            note: "",
            provenance: provenanceBase({
              cadence: "daily",
              source_name: "n/a",
              fetched_at: fetchedAt,
              revision_status: "unknown",
            }),
          },
        },
        annual: { metrics: [], note: "" },
        roadmap: AI_INFRA_ROADMAP,
        error: exc instanceof Error ? exc.message : "ai-infra fetch failed",
      } satisfies AiInfraPayload,
      { status: 500 },
    );
  }
}

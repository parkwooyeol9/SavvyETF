import { NLP_KOSDAQ100, NLP_KOSPI200, nlpHistoryTone, nlpNameByCode } from "@/lib/nlpHistory";
import type { NlpTone } from "@/lib/nlpPulse";

export type NlpClimateMarket = "all" | "kospi" | "kosdaq";

export type NlpClimateRow = {
  code: string;
  name: string;
  market: "kospi" | "kosdaq";
  score: number;
  n: number;
  bull_n: number;
  bear_n: number;
  headlines: Array<{
    title: string;
    source: string;
    url?: string;
    score: number;
    matched: string[];
  }>;
};

export type NlpClimatePoint = {
  date: string;
  score: number;
  name_n: number;
  headline_n: number;
  bull_n: number;
  bear_n: number;
};

export type NlpClimateMover = {
  code: string;
  name: string;
  score: number;
  n: number;
  title?: string;
  headlines: NlpClimateHeadline[];
};

export type NlpClimateHeadline = {
  code: string;
  name: string;
  title: string;
  source: string;
  url?: string;
  score: number;
};

export type NlpClimateSlice = {
  date: string;
  market: NlpClimateMarket;
  label: string;
  universe_n: number;
  name_n: number;
  headline_n: number;
  score: number;
  bull_n: number;
  bear_n: number;
  tone: NlpTone;
  verdict: "friendly" | "cautious" | "neutral";
  verdict_ko: string;
  comment: string;
  movers_up: NlpClimateMover[];
  movers_down: NlpClimateMover[];
  headlines: NlpClimateHeadline[];
};

export type NlpClimatePayload = {
  ok: boolean;
  date: string;
  min_date: string | null;
  max_date: string | null;
  dates: string[];
  all: NlpClimateSlice;
  kospi: NlpClimateSlice;
  kosdaq: NlpClimateSlice;
  series: {
    all: NlpClimatePoint[];
    kospi: NlpClimatePoint[];
    kosdaq: NlpClimatePoint[];
  };
  source: string;
  error?: string;
};

export const NLP_CLIMATE_UNIVERSE = {
  kospi: NLP_KOSPI200.length,
  kosdaq: NLP_KOSDAQ100.length,
  all: NLP_KOSPI200.length + NLP_KOSDAQ100.length,
};

const MOVER_CAP = 8;
const HEADLINE_CAP = 10;

export function emptyNlpClimateSlice(
  date: string,
  market: NlpClimateMarket,
  error?: string,
): NlpClimateSlice {
  const label = market === "kosdaq" ? "코스닥 100" : market === "kospi" ? "코스피 200" : "코스피·코스닥";
  return {
    date,
    market,
    label,
    universe_n: NLP_CLIMATE_UNIVERSE[market],
    name_n: 0,
    headline_n: 0,
    score: 0,
    bull_n: 0,
    bear_n: 0,
    tone: "flat",
    verdict: "neutral",
    verdict_ko: "중립",
    comment: error || "이 날짜에는 적재된 뉴스가 없습니다.",
    movers_up: [],
    movers_down: [],
    headlines: [],
  };
}

export function emptyNlpClimatePayload(error?: string): NlpClimatePayload {
  const date = "";
  return {
    ok: false,
    date,
    min_date: null,
    max_date: null,
    dates: [],
    all: emptyNlpClimateSlice(date, "all", error),
    kospi: emptyNlpClimateSlice(date, "kospi", error),
    kosdaq: emptyNlpClimateSlice(date, "kosdaq", error),
    series: { all: [], kospi: [], kosdaq: [] },
    source: "none",
    error,
  };
}

export function mergeNlpClimateRows(a: NlpClimateRow, b: NlpClimateRow): NlpClimateRow {
  const richerHeadlines = (b.headlines.length || 0) > (a.headlines.length || 0) ? b : a;
  const richerN = (b.n || 0) > (a.n || 0) ? b : a;
  const base = richerHeadlines.headlines.length ? richerHeadlines : richerN;
  const other = base === a ? b : a;
  return {
    ...base,
    name: base.name || other.name,
    market: base.market || other.market,
    headlines: richerHeadlines.headlines,
    n: Math.max(a.n || 0, b.n || 0, richerHeadlines.headlines.length),
  };
}

export function nlpClimateRowFromRaw(
  code: string,
  raw: {
    score?: unknown;
    n?: unknown;
    bull_n?: unknown;
    bear_n?: unknown;
    headlines?: unknown;
    name?: unknown;
    market?: unknown;
  },
): NlpClimateRow | null {
  if (!/^\d{6}$/.test(code)) return null;
  const spec = nlpNameByCode(code);
  const headlines = Array.isArray(raw.headlines)
    ? raw.headlines
        .map((h) => {
          if (!h || typeof h !== "object") return null;
          const hh = h as Record<string, unknown>;
          const title = String(hh.title || "").trim();
          if (!title) return null;
          return {
            title,
            source: String(hh.source || "news"),
            url: typeof hh.url === "string" ? hh.url : undefined,
            score: typeof hh.score === "number" ? hh.score : 0,
            matched: Array.isArray(hh.matched) ? hh.matched.map(String) : [],
          };
        })
        .filter((h): h is NonNullable<typeof h> => h != null)
    : [];
  const market = spec?.market || (raw.market === "kosdaq" ? "kosdaq" : "kospi");
  return {
    code,
    name: spec?.name || String(raw.name || code),
    market,
    score: typeof raw.score === "number" ? raw.score : 0,
    n: typeof raw.n === "number" ? raw.n : headlines.length,
    bull_n: typeof raw.bull_n === "number" ? raw.bull_n : headlines.filter((h) => h.score >= 12).length,
    bear_n: typeof raw.bear_n === "number" ? raw.bear_n : headlines.filter((h) => h.score <= -12).length,
    headlines,
  };
}

function weightedScore(rows: NlpClimateRow[]): number {
  let s = 0;
  let w = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.score)) continue;
    const n = row.n > 0 ? row.n : 1;
    s += row.score * n;
    w += n;
  }
  return w ? s / w : 0;
}

function isWeekend(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return false;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
}

function topTitle(row: NlpClimateRow): string | undefined {
  const ranked = [...row.headlines].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return ranked[0]?.title;
}

function asMover(row: NlpClimateRow): NlpClimateMover {
  return {
    code: row.code,
    name: row.name,
    score: row.score,
    n: row.n,
    title: topTitle(row),
    headlines: row.headlines.map((h) => ({
      code: row.code,
      name: row.name,
      title: h.title,
      source: h.source,
      url: h.url,
      score: h.score,
    })),
  };
}

export function summarizeNlpClimate(
  date: string,
  market: NlpClimateMarket,
  rows: NlpClimateRow[],
): NlpClimateSlice {
  const subset = market === "all" ? rows : rows.filter((r) => r.market === market);
  const label = market === "kosdaq" ? "코스닥 100" : market === "kospi" ? "코스피 200" : "코스피·코스닥";
  const universe_n = NLP_CLIMATE_UNIVERSE[market];
  if (!subset.length) {
    return emptyNlpClimateSlice(
      date,
      market,
      isWeekend(date)
        ? `${label}은 주말이라 적재된 종목 뉴스가 없습니다.`
        : `${label}은 이 날짜에 적재된 종목 뉴스가 없습니다.`,
    );
  }
  const score = weightedScore(subset);
  const bull_n = subset.filter((r) => r.score >= 12).length;
  const bear_n = subset.filter((r) => r.score <= -12).length;
  const headline_n = subset.reduce((s, r) => s + (r.n || 0), 0);
  const tone = nlpHistoryTone(score);
  const verdict = score >= 18 ? "friendly" : score <= -18 ? "cautious" : "neutral";
  const verdict_ko = verdict === "friendly" ? "우호" : verdict === "cautious" ? "경계" : "중립";
  const weekend = isWeekend(date)
    ? " 주말은 기사가 적어 표본이 얇습니다."
    : "";
  const comment =
    `${label} ${universe_n}종을 매일 조회하지만, 기사가 있는 종목만 쌓입니다. ` +
    `이날은 ${subset.length}종 · 제목 ${headline_n}건 · 호조 ${bull_n}종 · 경계 ${bear_n}종.` +
    weekend;
  const movers_up = [...subset]
    .filter((r) => r.score >= 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, MOVER_CAP)
    .map(asMover);
  const movers_down = [...subset]
    .filter((r) => r.score <= -12)
    .sort((a, b) => a.score - b.score)
    .slice(0, MOVER_CAP)
    .map(asMover);
  const headlines: NlpClimateHeadline[] = subset
    .flatMap((r) =>
      r.headlines.map((h) => ({
        code: r.code,
        name: r.name,
        title: h.title,
        source: h.source,
        url: h.url,
        score: h.score,
      })),
    )
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.score - a.score)
    .slice(0, HEADLINE_CAP);
  return {
    date,
    market,
    label,
    universe_n,
    name_n: subset.length,
    headline_n,
    score,
    bull_n,
    bear_n,
    tone,
    verdict,
    verdict_ko,
    comment,
    movers_up,
    movers_down,
    headlines,
  };
}

export function nlpClimatePoint(date: string, rows: NlpClimateRow[], market: NlpClimateMarket): NlpClimatePoint {
  const slice = summarizeNlpClimate(date, market, rows);
  return {
    date,
    score: slice.score,
    name_n: slice.name_n,
    headline_n: slice.headline_n,
    bull_n: slice.bull_n,
    bear_n: slice.bear_n,
  };
}

export function nlpClimateSliceForView(
  payload: NlpClimatePayload | null,
  view: "kospi200" | "kosdaq100",
): NlpClimateSlice | null {
  if (!payload?.ok) return null;
  return view === "kosdaq100" ? payload.kosdaq : payload.kospi;
}

export function nlpClimateSeriesForView(
  payload: NlpClimatePayload | null,
  view: "kospi200" | "kosdaq100",
): NlpClimatePoint[] {
  if (!payload?.ok) return [];
  return view === "kosdaq100" ? payload.series.kosdaq : payload.series.kospi;
}

export function nlpClimateHeadlinesForName(slice: NlpClimateSlice, code: string): NlpClimateHeadline[] {
  const fromMovers = [...slice.movers_up, ...slice.movers_down].find((row) => row.code === code);
  if (fromMovers?.headlines.length) return fromMovers.headlines;
  const fromPolar = slice.headlines.filter((row) => row.code === code);
  return fromPolar;
}

export type NlpClimateNameDay = {
  ok: boolean;
  date: string;
  code: string;
  name: string;
  score: number;
  n: number;
  headlines: NlpClimateHeadline[];
  error?: string;
};

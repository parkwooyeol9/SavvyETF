import kosdaqUniverse from "@/data/kosdaq100Universe.json";
import kospiUniverse from "@/data/kospi200Universe.json";
import seed from "@/data/nlpHistoryUniverse.json";

export type NlpHistoryMarket = "kospi" | "kosdaq";
export type NlpMapView = "kosdaq100" | "kospi200" | "sp500";

export type NlpHistoryName = {
  code: string;
  name: string;
  market: NlpHistoryMarket;
  yahoo: string;
  n_days?: number;
  n_headlines?: number;
  last_score?: number | null;
  last_date?: string | null;
  last_n?: number;
  recent_n?: number;
  recent_score?: number | null;
};

export type NlpHistoryHeadline = {
  title: string;
  source: string;
  url?: string;
  score: number;
  matched: string[];
};

export type NlpHistoryDay = {
  date: string;
  score: number;
  n: number;
  bull_n: number;
  bear_n: number;
  headlines: NlpHistoryHeadline[];
};

export type NlpHistoryIndex = {
  ok: boolean;
  generated_at?: string;
  lookback_days: number;
  max_headlines_per_day: number;
  methodology: string[];
  names: NlpHistoryName[];
  error?: string;
};

export type NlpHistorySeries = {
  ok: boolean;
  code: string;
  name: string;
  market: NlpHistoryMarket;
  yahoo: string;
  query?: string;
  updated_at?: string;
  n_days: number;
  n_headlines: number;
  last_score?: number | null;
  last_date?: string | null;
  last_n?: number;
  recent_n?: number;
  recent_score?: number | null;
  days: NlpHistoryDay[];
  error?: string;
};

export const NLP_HISTORY_R2_PREFIX = "nlp_history";

type RawConstituent = { code?: string; name?: string; yahoo?: string; market?: string };

export const NLP_HISTORY_SEED: NlpHistoryName[] = (seed.names as NlpHistoryName[]).map((row) => ({
  code: row.code,
  name: row.name,
  market: row.market === "kosdaq" ? "kosdaq" : "kospi",
  yahoo: row.yahoo,
}));

export const NLP_KOSDAQ100: NlpHistoryName[] = (
  (kosdaqUniverse as { constituents?: RawConstituent[] }).constituents || []
)
  .filter((row) => row.code && row.name && /^\d{6}$/.test(String(row.code)))
  .map((row) => ({
    code: String(row.code),
    name: String(row.name),
    market: "kosdaq" as const,
    yahoo: String(row.yahoo || `${row.code}.KQ`),
  }));

export const NLP_KOSPI200: NlpHistoryName[] = (
  (kospiUniverse as { constituents?: RawConstituent[] }).constituents || []
)
  .filter((row) => row.code && row.name && /^\d{6}$/.test(String(row.code)))
  .map((row) => ({
    code: String(row.code),
    name: String(row.name),
    market: "kospi" as const,
    yahoo: String(row.yahoo || `${row.code}.KS`),
  }));

export const NLP_KOSPI_SEED: NlpHistoryName[] = NLP_KOSPI200.length
  ? NLP_KOSPI200
  : NLP_HISTORY_SEED.filter((n) => n.market === "kospi");

export type NlpOverlayRow = {
  date: string;
  label: string;
  close: number | null;
  score: number | null;
  n: number | null;
  news: boolean;
  dart?: boolean;
  dartTitles?: string[];
  dartMark?: number | null;
};

export function emptyNlpHistoryIndex(error?: string): NlpHistoryIndex {
  return {
    ok: false,
    lookback_days: 365,
    max_headlines_per_day: 8,
    methodology: [],
    names: [...NLP_KOSPI200, ...NLP_KOSDAQ100],
    error,
  };
}

export function nlpNameByCode(code: string): NlpHistoryName | undefined {
  return (
    NLP_KOSPI200.find((n) => n.code === code) ||
    NLP_KOSDAQ100.find((n) => n.code === code) ||
    NLP_HISTORY_SEED.find((n) => n.code === code)
  );
}

export function emptyNlpHistorySeries(code: string, error?: string): NlpHistorySeries {
  const spec = nlpNameByCode(code);
  return {
    ok: false,
    code,
    name: spec?.name || code,
    market: spec?.market || "kospi",
    yahoo: spec?.yahoo || `${code}.KS`,
    n_days: 0,
    n_headlines: 0,
    days: [],
    error,
  };
}

export function mergeHistoryNames(
  universe: NlpHistoryName[],
  indexNames: NlpHistoryName[],
): NlpHistoryName[] {
  const byCode = new Map(indexNames.map((n) => [n.code, n]));
  const seen = new Set<string>();
  const out: NlpHistoryName[] = [];
  for (const row of universe) {
    const hit = byCode.get(row.code);
    out.push(
      hit
        ? {
            ...row,
            n_days: hit.n_days,
            n_headlines: hit.n_headlines,
            last_score: hit.last_score,
            last_date: hit.last_date,
            last_n: hit.last_n,
            recent_n: hit.recent_n,
            recent_score: hit.recent_score,
          }
        : row,
    );
    seen.add(row.code);
  }
  for (const row of indexNames) {
    if (seen.has(row.code)) continue;
    out.push(row);
    seen.add(row.code);
  }
  return out;
}

export function mergeScoreAndPrice(
  days: NlpHistoryDay[],
  bars: Array<{ date: string; label: string; close: number }>,
  dartByDay?: Map<string, string[]>,
): NlpOverlayRow[] {
  const byDay = new Map(days.map((d) => [d.date, d]));
  const dart = dartByDay || new Map<string, string[]>();
  if (!bars.length) {
    return days.map((d) => ({
      date: d.date,
      label: d.date.slice(5).replace("-", "."),
      close: null,
      score: d.score,
      n: d.n,
      news: true,
      dart: dart.has(d.date),
      dartTitles: dart.get(d.date),
      dartMark: dart.has(d.date) ? d.score : null,
    }));
  }
  let lastScore: number | null = null;
  let lastN: number | null = null;
  const out: NlpOverlayRow[] = [];
  for (const bar of bars) {
    const date = bar.date.slice(0, 10);
    const hit = byDay.get(date);
    if (hit) {
      lastScore = hit.score;
      lastN = hit.n;
    }
    out.push({
      date,
      label: bar.label,
      close: bar.close,
      score: lastScore,
      n: lastN,
      news: Boolean(hit),
      dart: dart.has(date),
      dartTitles: dart.get(date),
      dartMark: dart.has(date) ? lastScore ?? 0 : null,
    });
  }
  return out;
}

export const NLP_RECENT_DAYS = 7;

export function nlpOverlayChartRange(days: Array<{ date: string }>, now = Date.now()): "1y" | "max" {
  const first = days[0]?.date;
  if (!first) return "1y";
  const t = Date.parse(`${first}T00:00:00+09:00`);
  if (!Number.isFinite(t)) return "1y";
  return now - t > 400 * 86_400_000 ? "max" : "1y";
}

export function nlpKstTodayIso(now = Date.now()): string {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export function nlpRecentFromIso(now = Date.now()): string {
  const today = nlpKstTodayIso(now);
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) - (NLP_RECENT_DAYS - 1)));
  return dt.toISOString().slice(0, 10);
}

export function nlpRecentScoreFromDays(
  days: Array<{ date: string; score: number; n?: number }>,
  now = Date.now(),
): number | null {
  const from = nlpRecentFromIso(now);
  let w = 0;
  let s = 0;
  for (const day of days) {
    if (!day.date || day.date < from || !Number.isFinite(day.score)) continue;
    const n = day.n && day.n > 0 ? day.n : 1;
    s += day.score * n;
    w += n;
  }
  return w ? s / w : null;
}

export function nlpScoreIsStale(name: Pick<NlpHistoryName, "last_date" | "recent_n" | "recent_score">): boolean {
  if (typeof name.recent_score === "number" && Number.isFinite(name.recent_score)) return false;
  if ((name.recent_n || 0) > 0) return false;
  const last = name.last_date;
  if (!last) return true;
  return last < nlpRecentFromIso();
}

export function nlpMapScore(name: NlpHistoryName): number | null {
  if (typeof name.recent_score === "number" && Number.isFinite(name.recent_score)) {
    return name.recent_score;
  }
  if (typeof name.last_score !== "number" || !Number.isFinite(name.last_score)) return null;
  if (nlpScoreIsStale(name)) return null;
  return name.last_score;
}

export function nlpPearsonStats(rows: NlpOverlayRow[]): { r: number | null; n: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const row of rows) {
    if (!row.news || row.close == null || row.score == null || !Number.isFinite(row.close) || !Number.isFinite(row.score)) {
      continue;
    }
    xs.push(row.score);
    ys.push(row.close);
  }
  const n = xs.length;
  if (n < 12) return { r: null, n };
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  if (!den) return { r: null, n };
  return { r: num / den, n };
}

export function nlpPearson(rows: NlpOverlayRow[]): number | null {
  return nlpPearsonStats(rows).r;
}

export function nlpCorrLabel(r: number | null): string {
  if (r == null) return "겹치는 관측이 아직 부족합니다";
  const abs = Math.abs(r);
  const dir = r >= 0 ? "동행" : "역행";
  if (abs >= 0.5) return `뚜렷한 ${dir}`;
  if (abs >= 0.25) return `약한 ${dir}`;
  return "상관 낮음";
}

export function nlpHistoryTone(score: number): "bull" | "bear" | "flat" {
  if (score >= 12) return "bull";
  if (score <= -12) return "bear";
  return "flat";
}

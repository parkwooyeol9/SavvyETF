import { NextRequest, NextResponse } from "next/server";

import { fetchBotJson } from "@/lib/bot";
import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  DEFAULT_FOCUS_MONTHS,
  LOOKBACK_YEARS,
  type MonthStat,
  type SeasonalityPayload,
  type SeasonalityVerdict,
} from "@/lib/seasonality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const MONTH_LABELS_KO: Record<number, string> = {
  1: "1월",
  2: "2월",
  3: "3월",
  4: "4월",
  5: "5월",
  6: "6월",
  7: "7월",
  8: "8월",
  9: "9월",
  10: "10월",
  11: "11월",
  12: "12월",
};

function toYahooSymbol(ticker: string): string {
  const raw = ticker.trim();
  if (raw.startsWith("^")) return `^${raw.slice(1).toUpperCase()}`;
  const symbol = raw.toUpperCase();
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) return symbol;
  if (/^\d{6}$/.test(symbol)) return `${symbol}.KS`;
  return symbol.replace(/\./g, "-");
}

async function fetchDailyCloses(
  symbol: string,
  years: number,
): Promise<Array<{ date: string; close: number }>> {
  const range = years <= 10 ? `${years}y` : "max";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out: Array<{ date: string; close: number }> = [];
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const cutoffMs = cutoff.getTime();
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    const ts = timestamps[i]!;
    if (close == null || !Number.isFinite(close) || ts * 1000 < cutoffMs) continue;
    out.push({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close,
    });
  }
  return out;
}

function computeMonthlyReturns(
  points: Array<{ date: string; close: number }>,
): Array<{ date: string; ret: number; month: number; year: number }> {
  const byMonth = new Map<string, { date: string; close: number }>();
  for (const p of points) {
    const key = p.date.slice(0, 7);
    const prev = byMonth.get(key);
    if (!prev || p.date > prev.date) byMonth.set(key, p);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const out: Array<{ date: string; ret: number; month: number; year: number }> = [];
  for (let i = 1; i < months.length; i++) {
    const [, prev] = months[i - 1]!;
    const [, curr] = months[i]!;
    const ret = (curr.close / prev.close - 1) * 100;
    const d = new Date(`${curr.date}T00:00:00Z`);
    out.push({
      date: curr.date,
      ret,
      month: d.getUTCMonth() + 1,
      year: d.getUTCFullYear(),
    });
  }
  return out;
}

function mean(vals: number[]): number {
  if (!vals.length) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function welchTTest(a: number[], b: number[]): { t: number; p: number } {
  if (a.length < 3 || b.length < 3) return { t: NaN, p: NaN };
  const ma = mean(a);
  const mb = mean(b);
  const va =
    a.reduce((s, x) => s + (x - ma) ** 2, 0) / Math.max(1, a.length - 1);
  const vb =
    b.reduce((s, x) => s + (x - mb) ** 2, 0) / Math.max(1, b.length - 1);
  const se = Math.sqrt(va / a.length + vb / b.length);
  if (!Number.isFinite(se) || se === 0) return { t: NaN, p: NaN };
  const t = (ma - mb) / se;
  const df =
    (va / a.length + vb / b.length) ** 2 /
    ((va / a.length) ** 2 / Math.max(1, a.length - 1) +
      (vb / b.length) ** 2 / Math.max(1, b.length - 1));
  const x = df / (df + t * t);
  const p = incompleteBeta(df / 2, 0.5, x);
  return { t, p: Math.min(1, 2 * Math.min(p, 1 - p)) };
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta =
    lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2);
    let num: number;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(c * d - 1) < 3e-7) break;
  }
  return front * (f - 1);
}

function lgamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function monthsLabelKo(months: number[]): string {
  return months
    .slice()
    .sort((a, b) => a - b)
    .map((m) => MONTH_LABELS_KO[m])
    .join("·");
}

function classifyVerdict(
  focusMean: number,
  otherMean: number,
  p: number,
  focusMonths: number[],
): SeasonalityVerdict {
  const monthsStr = monthsLabelKo(focusMonths);
  const significant = Number.isFinite(p) && p < 0.05;
  const diff = focusMean - otherMean;
  const pTxt = Number.isFinite(p) ? p.toFixed(3) : "n/a";

  if (!Number.isFinite(focusMean) || !Number.isFinite(otherMean)) {
    return {
      label: "데이터 부족",
      label_en: "insufficient",
      tone: "muted",
      significant: false,
      summary_ko: "월별 수익률 표본이 부족해 계절성을 판정할 수 없습니다.",
    };
  }

  if (diff > 0.05) {
    if (significant) {
      return {
        label: "계절성 있음",
        label_en: "positive",
        tone: "positive",
        significant: true,
        summary_ko: `분석 기간 동안 ${monthsStr} 평균 월수익률(${focusMean.toFixed(2)}%)이 나머지 달(${otherMean.toFixed(2)}%)보다 높으며, Welch t-검정 p=${pTxt}으로 통계적으로 유의합니다.`,
      };
    }
    return {
      label: "약한 상방 경향",
      label_en: "caution",
      tone: "caution",
      significant: false,
      summary_ko: `${monthsStr} 평균 수익률(${focusMean.toFixed(2)}%)이 나머지 달(${otherMean.toFixed(2)}%)보다 높은 경향이나, p=${pTxt}으로 5% 유의수준에서는 유의하지 않습니다.`,
    };
  }
  if (diff < -0.05) {
    if (significant) {
      return {
        label: "역계절성",
        label_en: "negative",
        tone: "negative",
        significant: true,
        summary_ko: `${monthsStr} 평균 월수익률(${focusMean.toFixed(2)}%)이 나머지 달(${otherMean.toFixed(2)}%)보다 낮으며, Welch t-검정 p=${pTxt}으로 통계적으로 유의합니다.`,
      };
    }
    return {
      label: "약한 하방 경향",
      label_en: "caution",
      tone: "caution",
      significant: false,
      summary_ko: `${monthsStr} 평균 수익률이 나머지 달보다 낮은 경향이나, p=${pTxt}으로 유의하지 않습니다.`,
    };
  }
  return {
    label: "계절성 없음",
    label_en: "neutral",
    tone: "neutral",
    significant: false,
    summary_ko: `${monthsStr}(${focusMean.toFixed(2)}%)과 나머지 달(${otherMean.toFixed(2)}%)의 평균 월수익률 차이가 크지 않아 뚜렷한 계절성은 보이지 않습니다.`,
  };
}

async function buildLocalPayload(
  ticker: string,
  focusMonths: number[],
): Promise<SeasonalityPayload> {
  const yahoo = toYahooSymbol(ticker);
  const points = await fetchDailyCloses(yahoo, LOOKBACK_YEARS);
  if (points.length < 60) {
    return { ok: false, error: `${ticker}: 주가 이력이 부족합니다 (${yahoo}).` };
  }

  const monthly = computeMonthlyReturns(points);
  if (monthly.length < 24) {
    return { ok: false, error: "월별 수익률 표본이 부족합니다 (최소 24개월)." };
  }

  const monthlyStats: MonthStat[] = [];
  for (let month = 1; month <= 12; month++) {
    const subset = monthly.filter((m) => m.month === month).map((m) => m.ret);
    const n = subset.length;
    const mMean = mean(subset);
    const sorted = [...subset].sort((a, b) => a - b);
    const median = n ? sorted[Math.floor(n / 2)]! : NaN;
    const variance =
      n > 1
        ? subset.reduce((s, x) => s + (x - mMean) ** 2, 0) / (n - 1)
        : NaN;
    monthlyStats.push({
      month,
      label_ko: MONTH_LABELS_KO[month]!,
      mean_pct: mMean,
      median_pct: median,
      std_pct: Number.isFinite(variance) ? Math.sqrt(variance) : NaN,
      win_rate_pct: n ? (subset.filter((x) => x > 0).length / n) * 100 : NaN,
      n,
      in_focus: focusMonths.includes(month),
    });
  }

  const focusRets = monthly
    .filter((m) => focusMonths.includes(m.month))
    .map((m) => m.ret);
  const otherRets = monthly
    .filter((m) => !focusMonths.includes(m.month))
    .map((m) => m.ret);
  const { t, p } = welchTTest(focusRets, otherRets);
  const focusMean = mean(focusRets);
  const otherMean = mean(otherRets);

  const yearlyFocus: Array<{ year: number; return_pct: number }> = [];
  const years = [...new Set(monthly.map((m) => m.year))].sort();
  for (const year of years) {
    const rows = monthly.filter(
      (m) => m.year === year && focusMonths.includes(m.month),
    );
    if (!rows.length) continue;
    const compounded = (rows.reduce((acc, r) => acc * (1 + r.ret / 100), 1) - 1) * 100;
    yearlyFocus.push({ year, return_pct: compounded });
  }

  return {
    ok: true,
    query: ticker,
    symbol: yahoo,
    yahoo_symbol: yahoo,
    display: ticker.toUpperCase(),
    lookback_years: LOOKBACK_YEARS,
    focus_months: focusMonths,
    focus_label_ko: monthsLabelKo(focusMonths),
    focus_mean_pct: focusMean,
    other_mean_pct: otherMean,
    diff_focus_minus_other_pct: focusMean - otherMean,
    ttest_t: t,
    ttest_p: p,
    focus_n: focusRets.length,
    other_n: otherRets.length,
    verdict: classifyVerdict(focusMean, otherMean, p, focusMonths),
    monthly_stats: monthlyStats,
    yearly_focus: yearlyFocus,
    years_covered: years,
    n_months: monthly.length,
    start_date: monthly[0]?.date,
    end_date: monthly[monthly.length - 1]?.date,
    source: "yahoo",
  };
}

function parseFocusMonths(raw: string | null): number[] {
  if (!raw?.trim()) return [...DEFAULT_FOCUS_MONTHS];
  const months = raw
    .split(",")
    .map((m) => parseInt(m.trim(), 10))
    .filter((m) => m >= 1 && m <= 12);
  return months.length ? [...new Set(months)].sort((a, b) => a - b) : [...DEFAULT_FOCUS_MONTHS];
}

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") || "").trim();
  if (!ticker) {
    return NextResponse.json(
      { ok: false, error: "ticker query param required" },
      { status: 400 },
    );
  }
  const focusMonths = parseFocusMonths(req.nextUrl.searchParams.get("months"));
  const cacheKey = `seasonality:v1:${ticker.toUpperCase()}:${focusMonths.join("-")}`;

  const payload = await withServerCache(
    cacheKey,
    300_000,
    900_000,
    async (): Promise<SeasonalityPayload> => {
      try {
        const remote = await fetchBotJson<SeasonalityPayload>(
          `/api/web/seasonality?ticker=${encodeURIComponent(ticker)}&months=${focusMonths.join(",")}`,
          { timeoutMs: 55_000 },
        );
        if (remote?.ok) return { ...remote, source: "render" };
      } catch {
        /* local Yahoo fallback */
      }
      return buildLocalPayload(ticker, focusMonths);
    },
  );

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 400,
    headers: { "Cache-Control": cdnCacheHeader("yahoo") },
  });
}

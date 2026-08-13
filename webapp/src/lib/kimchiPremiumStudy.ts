/**
 * 김프 히스토리 스터디 — 해소 일수·추가 확대(adverse excursion) 분포.
 * Upbit KRW-BTC + Yahoo BTC-USD + USD/KRW 일봉으로 김프 시계열 구성.
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import {
  KIMCHI_ARB_COST_PCT,
  KIMCHI_ARB_ENTER_PCT,
  KIMCHI_ARB_EXIT_PCT,
  KIMCHI_ARB_STEADY_PCT,
} from "@/lib/kimchiArbEngine";

export const KIMCHI_STUDY_R2_KEY = "challenge/kimchi_study_latest.json";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export type KimchiStudyEpisode = {
  start: string;
  end: string | null;
  side: "high" | "low";
  entry_pct: number;
  exit_pct: number;
  days_to_resolve: number | null;
  max_adverse_pct: number;
  peak_pct: number;
};

export type KimchiStudyReport = {
  version: 1;
  generated_at: string;
  sample_days: number;
  date_from: string | null;
  date_to: string | null;
  mean_kimchi_pct: number | null;
  median_kimchi_pct: number | null;
  pct_above_enter: number | null;
  high_episodes: number;
  low_episodes: number;
  high_resolve_days_median: number | null;
  high_resolve_days_mean: number | null;
  high_max_adverse_median: number | null;
  high_max_adverse_p75: number | null;
  low_resolve_days_median: number | null;
  recommended: {
    enter_pct: number;
    exit_pct: number;
    steady_pct: number;
    max_hold_days: number;
    max_adverse_pct: number;
    cost_buffer_pct: number;
    note: string;
  };
  literature_note: string;
  episodes_sample: KimchiStudyEpisode[];
};

async function fetchJson<T>(url: string, timeout = 20_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchUpbitBtcDaily(count = 200): Promise<Map<string, number>> {
  const url = `https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=${count}`;
  const rows = await fetchJson<
    Array<{ candle_date_time_utc: string; trade_price: number }>
  >(url);
  const out = new Map<string, number>();
  for (const r of rows || []) {
    const d = (r.candle_date_time_utc || "").slice(0, 10);
    if (d && r.trade_price > 0) out.set(d, r.trade_price);
  }
  return out;
}

async function fetchYahooDaily(
  symbol: string,
  days = 220,
): Promise<Map<string, number>> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - days * 86400;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const json = await fetchJson<{
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  }>(url);
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !(c > 0)) continue;
    const d = new Date((ts[i] as number) * 1000).toISOString().slice(0, 10);
    out.set(d, c);
  }
  return out;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx]!;
}

export async function buildKimchiSeries(): Promise<
  Array<{ date: string; kimchi_pct: number }>
> {
  const [upbit, btcUsd, fx] = await Promise.all([
    fetchUpbitBtcDaily(200),
    fetchYahooDaily("BTC-USD", 220),
    fetchYahooDaily("KRW=X", 220),
  ]);
  const dates = [...upbit.keys()].sort();
  const series: Array<{ date: string; kimchi_pct: number }> = [];
  for (const d of dates) {
    const up = upbit.get(d);
    const usd = btcUsd.get(d);
    const krw = fx.get(d);
    if (up == null || usd == null || krw == null || !(usd > 0) || !(krw > 0)) {
      continue;
    }
    const fair = usd * krw;
    series.push({ date: d, kimchi_pct: 100 * (up / fair - 1) });
  }
  return series;
}

function analyzeEpisodes(
  series: Array<{ date: string; kimchi_pct: number }>,
  enter: number,
  exitHigh: number,
  exitLow: number,
): { high: KimchiStudyEpisode[]; low: KimchiStudyEpisode[] } {
  const high: KimchiStudyEpisode[] = [];
  const low: KimchiStudyEpisode[] = [];
  let i = 0;
  while (i < series.length) {
    const row = series[i]!;
    if (row.kimchi_pct >= enter) {
      const start = row.date;
      const entry = row.kimchi_pct;
      let peak = entry;
      let j = i;
      let resolved: KimchiStudyEpisode | null = null;
      for (; j < series.length; j++) {
        const k = series[j]!.kimchi_pct;
        peak = Math.max(peak, k);
        if (k <= exitHigh) {
          resolved = {
            start,
            end: series[j]!.date,
            side: "high",
            entry_pct: entry,
            exit_pct: k,
            days_to_resolve: j - i,
            max_adverse_pct: Math.max(0, peak - entry),
            peak_pct: peak,
          };
          break;
        }
      }
      if (!resolved) {
        resolved = {
          start,
          end: null,
          side: "high",
          entry_pct: entry,
          exit_pct: series[series.length - 1]!.kimchi_pct,
          days_to_resolve: null,
          max_adverse_pct: Math.max(0, peak - entry),
          peak_pct: peak,
        };
        high.push(resolved);
        break;
      }
      high.push(resolved);
      i = j + 1;
      continue;
    }
    if (row.kimchi_pct <= exitLow) {
      const start = row.date;
      const entry = row.kimchi_pct;
      let trough = entry;
      let j = i;
      let resolved: KimchiStudyEpisode | null = null;
      for (; j < series.length; j++) {
        const k = series[j]!.kimchi_pct;
        trough = Math.min(trough, k);
        if (k >= enter) {
          resolved = {
            start,
            end: series[j]!.date,
            side: "low",
            entry_pct: entry,
            exit_pct: k,
            days_to_resolve: j - i,
            max_adverse_pct: Math.max(0, entry - trough),
            peak_pct: trough,
          };
          break;
        }
      }
      if (!resolved) {
        resolved = {
          start,
          end: null,
          side: "low",
          entry_pct: entry,
          exit_pct: series[series.length - 1]!.kimchi_pct,
          days_to_resolve: null,
          max_adverse_pct: Math.max(0, entry - trough),
          peak_pct: trough,
        };
        low.push(resolved);
        break;
      }
      low.push(resolved);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return { high, low };
}

export function recommendFromStudy(input: {
  highResolveMedian: number | null;
  highAdverseP75: number | null;
  meanKimchi: number | null;
}): KimchiStudyReport["recommended"] {
  const resolveMed = input.highResolveMedian ?? 7;
  const adverseP75 = input.highAdverseP75 ?? 2.5;
  const steady =
    input.meanKimchi != null && input.meanKimchi > 0.5
      ? Math.round(input.meanKimchi * 10) / 10
      : KIMCHI_ARB_STEADY_PCT;

  // Literature: random walk inside ~[-1, +3.5]; enter only outside. Prefer 3% enter.
  const enter = Math.max(KIMCHI_ARB_ENTER_PCT, 3.0);
  const exit = Math.min(Math.max(steady, 1.0), enter - 0.5);
  const maxHold = Math.max(7, Math.min(21, Math.ceil(resolveMed * 1.5)));
  const maxAdverse = Math.max(1.5, Math.min(5, Math.round(adverseP75 * 10) / 10));

  return {
    enter_pct: enter,
    exit_pct: exit,
    steady_pct: steady,
    max_hold_days: maxHold,
    max_adverse_pct: maxAdverse,
    cost_buffer_pct: KIMCHI_ARB_COST_PCT,
    note:
      `스터디 기반 권고: 고김프 진입 ${enter}% · 청산 ${exit}%(장기평균~${steady}%) · ` +
      `최대보유 ${maxHold}일 · 추가확대 한도 ${maxAdverse}%p · BTC 재고 없으면 숏김프 금지`,
  };
}

export async function runKimchiPremiumStudy(): Promise<KimchiStudyReport> {
  const series = await buildKimchiSeries();
  const values = series.map((r) => r.kimchi_pct);
  const { high, low } = analyzeEpisodes(
    series,
    KIMCHI_ARB_ENTER_PCT,
    KIMCHI_ARB_STEADY_PCT,
    KIMCHI_ARB_EXIT_PCT,
  );
  const highDays = high
    .map((e) => e.days_to_resolve)
    .filter((d): d is number => d != null);
  const highAdverse = high.map((e) => e.max_adverse_pct);
  const lowDays = low
    .map((e) => e.days_to_resolve)
    .filter((d): d is number => d != null);

  const meanK = mean(values);
  const recommended = recommendFromStudy({
    highResolveMedian: median(highDays),
    highAdverseP75: percentile(highAdverse, 0.75),
    meanKimchi: meanK,
  });

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    sample_days: series.length,
    date_from: series[0]?.date ?? null,
    date_to: series[series.length - 1]?.date ?? null,
    mean_kimchi_pct: meanK != null ? Math.round(meanK * 100) / 100 : null,
    median_kimchi_pct:
      median(values) != null ? Math.round(median(values)! * 100) / 100 : null,
    pct_above_enter:
      values.length > 0
        ? Math.round(
            (100 * values.filter((v) => v >= KIMCHI_ARB_ENTER_PCT).length) /
              values.length,
          )
        : null,
    high_episodes: high.length,
    low_episodes: low.length,
    high_resolve_days_median: median(highDays),
    high_resolve_days_mean:
      mean(highDays) != null ? Math.round(mean(highDays)! * 10) / 10 : null,
    high_max_adverse_median:
      median(highAdverse) != null
        ? Math.round(median(highAdverse)! * 100) / 100
        : null,
    high_max_adverse_p75:
      percentile(highAdverse, 0.75) != null
        ? Math.round(percentile(highAdverse, 0.75)! * 100) / 100
        : null,
    low_resolve_days_median: median(lowDays),
    recommended,
    literature_note:
      "선행연구: 김프는 임계값 안에서는 랜덤워크, 밖에서는 느린 평균회귀. " +
      "장기 정상상태가 0이 아니라 ~1%대일 수 있음(Economic Modelling 2024). " +
      "고김프가 역프보다 오래 지속되는 비대칭.",
    episodes_sample: [...high.slice(-5), ...low.slice(-3)],
  };
}

export async function publishKimchiStudy(
  report: KimchiStudyReport,
): Promise<boolean> {
  if (!r2Configured()) return false;
  try {
    await r2PutObject(KIMCHI_STUDY_R2_KEY, JSON.stringify(report), "application/json");
    return true;
  } catch {
    return false;
  }
}

export async function loadKimchiStudy(): Promise<KimchiStudyReport | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(KIMCHI_STUDY_R2_KEY);
    if (!text) return null;
    return JSON.parse(text) as KimchiStudyReport;
  } catch {
    return null;
  }
}

export async function tickKimchiStudy(): Promise<KimchiStudyReport> {
  const report = await runKimchiPremiumStudy();
  await publishKimchiStudy(report);
  return report;
}

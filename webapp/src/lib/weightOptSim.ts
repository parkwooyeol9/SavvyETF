/**
 * 5-year static buy-and-hold of today's AI Pick / optimized sleeves.
 * Start index = 100. No rebalancing. Cash return = 0.
 * This is an allocation path on today's names — not selection skill.
 */

import { fetchDailyCloses, type PricePoint } from "@/lib/simulate";
import type {
  OptimizedSleeve,
  WeightOptSim5y,
  WeightOptSimDropped,
  WeightOptSimPoint,
} from "@/lib/weightOptimize";

const BENCH = "SPY";
const LOOKBACK_DAYS = 365 * 5 + 21;
const MIN_COVERAGE = 0.8;
const MIN_POINTS = 8;
const MAX_CHART_POINTS = 420;

function ymdDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function maxDrawdownPct(values: number[]): number {
  let peak = values[0] || 0;
  let mdd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) mdd = Math.min(mdd, v / peak - 1);
  }
  return round2(mdd * 100);
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const last = arr.length - 1;
  const idx = new Set<number>();
  for (let i = 0; i < max; i++) {
    idx.add(Math.round((i / (max - 1)) * last));
  }
  return [...idx]
    .sort((a, b) => a - b)
    .map((i) => arr[i]!);
}

function dateSet(points: PricePoint[]): Set<string> {
  return new Set(points.map((p) => p.date));
}

function emptySim(error: string, extra: Partial<WeightOptSim5y> = {}): WeightOptSim5y {
  return {
    ok: false,
    start: null,
    end: null,
    note: "",
    cash_opt_pct: 0,
    cash_pick_pct: 0,
    opt_total_pct: null,
    pick_total_pct: null,
    spy_total_pct: null,
    opt_mdd_pct: null,
    pick_mdd_pct: null,
    spy_mdd_pct: null,
    dropped: extra.dropped || [],
    series: [],
    error,
    ...extra,
  };
}

/** Buy-and-hold index: 100 * (cash + Σ w_i * P_i,t / P_i,0). */
export function buyHoldIndex(
  cashFrac: number,
  weights: number[],
  relPrices: number[][],
): number[] {
  const tCount = relPrices[0]?.length || 0;
  const out = new Array<number>(tCount);
  for (let t = 0; t < tCount; t++) {
    let v = cashFrac;
    for (let i = 0; i < weights.length; i++) {
      v += weights[i]! * (relPrices[i]?.[t] ?? 1);
    }
    out[t] = 100 * v;
  }
  return out;
}

export async function simulateWeightOptBuyHold(
  sleeves: OptimizedSleeve[],
): Promise<WeightOptSim5y> {
  const risky = sleeves.filter((s) => s.asset_class !== "cash");
  if (!risky.length) {
    return emptySim("투자 슬리브가 없어 시뮬레이션할 수 없습니다.");
  }

  const start = ymdDaysAgo(LOOKBACK_DAYS);
  const end = todayYmd();
  const needed = [...new Set([...risky.map((s) => s.symbol), BENCH])];

  const seriesMap: Record<string, PricePoint[]> = {};
  const fetchFail: WeightOptSimDropped[] = [];
  await Promise.all(
    needed.map(async (sym) => {
      try {
        const pts = await fetchDailyCloses(sym, start, end);
        if (pts.length < MIN_POINTS) {
          if (sym !== BENCH) {
            const row = risky.find((s) => s.symbol === sym);
            fetchFail.push({
              symbol: sym,
              reason: "가격 이력 부족",
              opt_pct: row?.opt_pct || 0,
              pick_pct: row?.pick_pct || 0,
            });
          }
          return;
        }
        seriesMap[sym] = pts;
      } catch {
        if (sym !== BENCH) {
          const row = risky.find((s) => s.symbol === sym);
          fetchFail.push({
            symbol: sym,
            reason: "시세 조회 실패",
            opt_pct: row?.opt_pct || 0,
            pick_pct: row?.pick_pct || 0,
          });
        }
      }
    }),
  );

  const spyPts = seriesMap[BENCH];
  if (!spyPts?.length) {
    return emptySim("SPY 가격을 불러오지 못했습니다.", { dropped: fetchFail });
  }

  const spyDates = dateSet(spyPts);
  const dropped: WeightOptSimDropped[] = [...fetchFail];
  const kept: OptimizedSleeve[] = [];
  for (const row of risky) {
    if (dropped.some((d) => d.symbol === row.symbol)) continue;
    const pts = seriesMap[row.symbol];
    if (!pts?.length) {
      dropped.push({
        symbol: row.symbol,
        reason: "가격 없음",
        opt_pct: row.opt_pct,
        pick_pct: row.pick_pct,
      });
      continue;
    }
    const overlap = pts.filter((p) => spyDates.has(p.date)).length;
    if (overlap / spyPts.length < MIN_COVERAGE) {
      dropped.push({
        symbol: row.symbol,
        reason: `상장 이력이 짧음 (${Math.round((overlap / spyPts.length) * 100)}%)`,
        opt_pct: row.opt_pct,
        pick_pct: row.pick_pct,
      });
      continue;
    }
    kept.push(row);
  }

  if (!kept.length) {
    return emptySim("5년 이력이 있는 종목이 없습니다.", { dropped });
  }

  const keys = [...kept.map((s) => s.symbol), BENCH];
  const dateSets = keys.map((k) => dateSet(seriesMap[k]!));
  const dates = [...dateSets[0]!]
    .filter((d) => dateSets.every((s) => s.has(d)))
    .sort();
  if (dates.length < MIN_POINTS) {
    return emptySim("겹치는 거래일이 부족합니다.", { dropped });
  }

  const lookup: Record<string, Map<string, number>> = {};
  for (const k of keys) {
    lookup[k] = new Map(seriesMap[k]!.map((p) => [p.date, p.close]));
  }

  const rel: number[][] = kept.map((row) => {
    const p0 = lookup[row.symbol]!.get(dates[0]!)!;
    return dates.map((d) => lookup[row.symbol]!.get(d)! / p0);
  });
  const spy0 = lookup[BENCH]!.get(dates[0]!)!;
  const spyRel = dates.map((d) => lookup[BENCH]!.get(d)! / spy0);

  const optW = kept.map((s) => s.opt_pct / 100);
  const pickW = kept.map((s) => s.pick_pct / 100);
  const cashOpt = Math.max(0, 1 - optW.reduce((a, b) => a + b, 0));
  const cashPick = Math.max(0, 1 - pickW.reduce((a, b) => a + b, 0));

  const optIdx = buyHoldIndex(cashOpt, optW, rel);
  const pickIdx = buyHoldIndex(cashPick, pickW, rel);
  const spyIdx = spyRel.map((r) => 100 * r);

  const full: WeightOptSimPoint[] = dates.map((date, i) => ({
    date,
    opt: round2(optIdx[i]!),
    pick: round2(pickIdx[i]!),
    spy: round2(spyIdx[i]!),
  }));
  const series = downsample(full, MAX_CHART_POINTS);
  const last = full[full.length - 1]!;

  const dropNote = dropped.length
    ? `이력 부족 ${dropped.map((d) => d.symbol).join(", ")} 은 현금(수익률 0)으로 처리.`
    : "";
  const note = [
    "오늘 종목·비중을 시작일에 사서 5년 보유(리밸런스 없음). 시작=100. 현금 수익률 0.",
    "선별 효과는 포함하지 않음 — 지금 들고 있는 이름을 과거에 들고 있었다고 가정한 배분 경로.",
    dropNote,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ok: true,
    start: dates[0]!,
    end: dates[dates.length - 1]!,
    note,
    cash_opt_pct: round2(cashOpt * 100),
    cash_pick_pct: round2(cashPick * 100),
    opt_total_pct: round2(last.opt - 100),
    pick_total_pct: round2(last.pick - 100),
    spy_total_pct: round2(last.spy - 100),
    opt_mdd_pct: maxDrawdownPct(optIdx),
    pick_mdd_pct: maxDrawdownPct(pickIdx),
    spy_mdd_pct: maxDrawdownPct(spyIdx),
    dropped,
    series,
  };
}

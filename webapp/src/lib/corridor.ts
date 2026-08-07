/**
 * Corridor (band) rebalancing — equity weight bands for asset-allocation funds.
 * Default: KODEX 200 30% + KODEX 단기채권 70% from 2020-01 first session.
 * If equity weight > upper → sell down to upper; if < lower → buy up to lower.
 */

import { CATALOG_BY_SYMBOL } from "@/lib/etfCatalog";
import { fetchDailyCloses } from "@/lib/simulate";

export const CORRIDOR_DEFAULTS = {
  equity_symbol: "069500.KS",
  bond_symbol: "153130.KS",
  target_equity_pct: 30,
  upper_pct: 50,
  lower_pct: 20,
  start_date: "2020-01-02",
  initial_value: 100_000_000,
} as const;

export type CorridorMode = "corridor" | "buy_hold" | "monthly";

export type CorridorMetrics = {
  total_return_pct: number;
  cagr_pct: number;
  annual_vol_pct: number;
  sharpe: number;
  max_drawdown_pct: number;
  final_value: number;
  rebalance_count: number;
  avg_equity_pct: number;
  min_equity_pct: number;
  max_equity_pct: number;
};

export type CorridorSeriesPoint = {
  date: string;
  value: number;
  equity_pct: number;
  rebalanced: boolean;
};

export type CorridorScenario = {
  id: string;
  label: string;
  mode: CorridorMode;
  upper_pct: number | null;
  lower_pct: number | null;
  metrics: CorridorMetrics;
  series: CorridorSeriesPoint[];
};

export type CorridorPayload = {
  ok: boolean;
  error?: string;
  generated_at: string;
  start_date: string;
  end_date: string;
  trading_days: number;
  equity: { symbol: string; name: string };
  bond: { symbol: string; name: string };
  target_equity_pct: number;
  upper_pct: number;
  lower_pct: number;
  initial_value: number;
  primary: CorridorScenario;
  baselines: CorridorScenario[];
  /** Sensitivity grid: vary upper/lower around the primary bands */
  sensitivity: Array<{
    upper_pct: number;
    lower_pct: number;
    total_return_pct: number;
    cagr_pct: number;
    annual_vol_pct: number;
    sharpe: number;
    max_drawdown_pct: number;
    rebalance_count: number;
  }>;
  note: string;
  disclaimer: string;
};

function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function etfName(symbol: string): string {
  return CATALOG_BY_SYMBOL[symbol]?.name || symbol;
}

function alignTwo(
  a: Array<{ date: string; close: number }>,
  b: Array<{ date: string; close: number }>,
): { dates: string[]; eq: number[]; bond: number[] } {
  const mapB = new Map(b.map((p) => [p.date, p.close]));
  const dates: string[] = [];
  const eq: number[] = [];
  const bond: number[] = [];
  for (const p of a) {
    const bc = mapB.get(p.date);
    if (bc == null || !(p.close > 0) || !(bc > 0)) continue;
    dates.push(p.date);
    eq.push(p.close);
    bond.push(bc);
  }
  return { dates, eq, bond };
}

function metricsFromSeries(
  series: CorridorSeriesPoint[],
  initial: number,
  rebalance_count: number,
): CorridorMetrics {
  if (series.length < 2) {
    return {
      total_return_pct: 0,
      cagr_pct: 0,
      annual_vol_pct: 0,
      sharpe: 0,
      max_drawdown_pct: 0,
      final_value: initial,
      rebalance_count,
      avg_equity_pct: 0,
      min_equity_pct: 0,
      max_equity_pct: 0,
    };
  }
  const values = series.map((s) => s.value);
  const final_value = values[values.length - 1]!;
  const total_return_pct = ((final_value / initial) - 1) * 100;

  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    if (prev > 0) rets.push(values[i]! / prev - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const varSum = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const dailyVol = Math.sqrt(varSum);
  const annual_vol_pct = dailyVol * Math.sqrt(252) * 100;
  const cagr_pct =
    (Math.pow(final_value / initial, 252 / Math.max(1, rets.length)) - 1) * 100;
  const sharpe =
    annual_vol_pct > 1e-9 ? (cagr_pct - 0) / annual_vol_pct : 0;

  let peak = values[0]!;
  let maxDd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) maxDd = Math.min(maxDd, v / peak - 1);
  }

  const eqWeights = series.map((s) => s.equity_pct);
  return {
    total_return_pct: round(total_return_pct),
    cagr_pct: round(cagr_pct),
    annual_vol_pct: round(annual_vol_pct),
    sharpe: round(sharpe, 3),
    max_drawdown_pct: round(maxDd * 100),
    final_value: round(final_value, 0),
    rebalance_count,
    avg_equity_pct: round(eqWeights.reduce((a, b) => a + b, 0) / eqWeights.length, 1),
    min_equity_pct: round(Math.min(...eqWeights), 1),
    max_equity_pct: round(Math.max(...eqWeights), 1),
  };
}

function downsampleSeries(
  series: CorridorSeriesPoint[],
  maxPoints = 520,
): CorridorSeriesPoint[] {
  if (series.length <= maxPoints) return series;
  const step = Math.ceil(series.length / maxPoints);
  const out: CorridorSeriesPoint[] = [];
  for (let i = 0; i < series.length; i += step) out.push(series[i]!);
  const last = series[series.length - 1]!;
  if (out[out.length - 1]?.date !== last.date) out.push(last);
  return out;
}

function runPath(input: {
  dates: string[];
  eq: number[];
  bond: number[];
  target: number;
  upper: number | null;
  lower: number | null;
  mode: CorridorMode;
  initial: number;
  id: string;
  label: string;
}): CorridorScenario {
  const { dates, eq, bond, target, upper, lower, mode, initial, id, label } = input;
  let eqVal = initial * target;
  let bondVal = initial * (1 - target);
  let rebalance_count = 0;
  let lastMonth = dates[0]!.slice(0, 7);
  const series: CorridorSeriesPoint[] = [];

  for (let i = 0; i < dates.length; i++) {
    if (i > 0) {
      const eqRet = eq[i - 1]! > 0 ? eq[i]! / eq[i - 1]! - 1 : 0;
      const bondRet = bond[i - 1]! > 0 ? bond[i]! / bond[i - 1]! - 1 : 0;
      eqVal *= 1 + eqRet;
      bondVal *= 1 + bondRet;
    }

    let total = eqVal + bondVal;
    let w = total > 0 ? eqVal / total : target;
    let rebalanced = false;

    if (mode === "monthly") {
      const month = dates[i]!.slice(0, 7);
      if (month !== lastMonth) {
        eqVal = total * target;
        bondVal = total * (1 - target);
        w = target;
        rebalance_count += 1;
        rebalanced = true;
        lastMonth = month;
      }
    } else if (mode === "corridor" && upper != null && lower != null) {
      if (w > upper) {
        eqVal = total * upper;
        bondVal = total * (1 - upper);
        w = upper;
        rebalance_count += 1;
        rebalanced = true;
      } else if (w < lower) {
        eqVal = total * lower;
        bondVal = total * (1 - lower);
        w = lower;
        rebalance_count += 1;
        rebalanced = true;
      }
    }

    total = eqVal + bondVal;
    series.push({
      date: dates[i]!,
      value: total,
      equity_pct: total > 0 ? (eqVal / total) * 100 : target * 100,
      rebalanced,
    });
  }

  return {
    id,
    label,
    mode,
    upper_pct: upper != null ? round(upper * 100, 1) : null,
    lower_pct: lower != null ? round(lower * 100, 1) : null,
    metrics: metricsFromSeries(series, initial, rebalance_count),
    series: downsampleSeries(series),
  };
}

export type CorridorRequest = {
  equity_symbol?: string;
  bond_symbol?: string;
  target_equity_pct?: number;
  upper_pct?: number;
  lower_pct?: number;
  start_date?: string;
  end_date?: string;
  initial_value?: number;
};

export async function runCorridorAnalysis(
  req: CorridorRequest = {},
): Promise<CorridorPayload> {
  const equity_symbol = (req.equity_symbol || CORRIDOR_DEFAULTS.equity_symbol).toUpperCase();
  const bond_symbol = (req.bond_symbol || CORRIDOR_DEFAULTS.bond_symbol).toUpperCase();
  const target_equity_pct = req.target_equity_pct ?? CORRIDOR_DEFAULTS.target_equity_pct;
  const upper_pct = req.upper_pct ?? CORRIDOR_DEFAULTS.upper_pct;
  const lower_pct = req.lower_pct ?? CORRIDOR_DEFAULTS.lower_pct;
  const start_date = req.start_date || CORRIDOR_DEFAULTS.start_date;
  const end_date = req.end_date || new Date().toISOString().slice(0, 10);
  const initial_value = req.initial_value ?? CORRIDOR_DEFAULTS.initial_value;

  if (!(target_equity_pct > 0 && target_equity_pct < 100)) {
    return emptyErr("목표 주식 비중은 0~100% 사이여야 합니다.");
  }
  if (!(lower_pct >= 0 && upper_pct <= 100 && lower_pct < upper_pct)) {
    return emptyErr("하단 < 상단, 0~100% 범위를 확인하세요.");
  }
  if (target_equity_pct < lower_pct || target_equity_pct > upper_pct) {
    return emptyErr("목표 주식 비중은 하단~상단 corridor 안에 있어야 합니다.");
  }

  let eqPts;
  let bondPts;
  try {
    [eqPts, bondPts] = await Promise.all([
      fetchDailyCloses(equity_symbol, start_date, end_date),
      fetchDailyCloses(bond_symbol, start_date, end_date),
    ]);
  } catch (exc) {
    return emptyErr(exc instanceof Error ? exc.message : String(exc));
  }

  const { dates, eq, bond } = alignTwo(eqPts, bondPts);
  if (dates.length < 60) {
    return emptyErr("겹치는 거래일이 부족합니다. 종목·기간을 확인하세요.");
  }

  const target = target_equity_pct / 100;
  const upper = upper_pct / 100;
  const lower = lower_pct / 100;

  const primary = runPath({
    dates,
    eq,
    bond,
    target,
    upper,
    lower,
    mode: "corridor",
    initial: initial_value,
    id: "corridor",
    label: `Corridor ${lower_pct}–${upper_pct}%`,
  });

  const baselines: CorridorScenario[] = [
    runPath({
      dates,
      eq,
      bond,
      target,
      upper: null,
      lower: null,
      mode: "buy_hold",
      initial: initial_value,
      id: "buy_hold",
      label: "Buy & Hold (리밸런싱 없음)",
    }),
    runPath({
      dates,
      eq,
      bond,
      target,
      upper: null,
      lower: null,
      mode: "monthly",
      initial: initial_value,
      id: "monthly",
      label: "월간 목표비중 리밸런싱",
    }),
  ];

  const bandPairs: Array<[number, number]> = [
    [lower_pct, upper_pct],
    [Math.max(0, target_equity_pct - 5), Math.min(100, target_equity_pct + 5)],
    [Math.max(0, target_equity_pct - 10), Math.min(100, target_equity_pct + 10)],
    [20, 40],
    [20, 50],
    [10, 50],
    [25, 35],
  ];
  const seen = new Set<string>();
  const sensitivity: CorridorPayload["sensitivity"] = [];
  for (const [lo, hi] of bandPairs) {
    if (!(lo < target_equity_pct && target_equity_pct < hi)) continue;
    const key = `${lo}-${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sc = runPath({
      dates,
      eq,
      bond,
      target,
      upper: hi / 100,
      lower: lo / 100,
      mode: "corridor",
      initial: initial_value,
      id: key,
      label: `${lo}–${hi}%`,
    });
    sensitivity.push({
      upper_pct: hi,
      lower_pct: lo,
      total_return_pct: sc.metrics.total_return_pct,
      cagr_pct: sc.metrics.cagr_pct,
      annual_vol_pct: sc.metrics.annual_vol_pct,
      sharpe: sc.metrics.sharpe,
      max_drawdown_pct: sc.metrics.max_drawdown_pct,
      rebalance_count: sc.metrics.rebalance_count,
    });
  }
  sensitivity.sort((a, b) => b.sharpe - a.sharpe);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    start_date: dates[0]!,
    end_date: dates[dates.length - 1]!,
    trading_days: dates.length,
    equity: { symbol: equity_symbol, name: etfName(equity_symbol) },
    bond: { symbol: bond_symbol, name: etfName(bond_symbol) },
    target_equity_pct,
    upper_pct,
    lower_pct,
    initial_value,
    primary,
    baselines,
    sensitivity,
    note:
      "주식 비중이 상단을 초과하면 상단까지 매도, 하단을 하회하면 하단까지 매수합니다. 목표 비중으로 되돌리지 않고 밴드 경계에서 멈춥니다.",
    disclaimer:
      "과거 시뮬레이션이며 비용·세금·추적오차는 단순화했습니다. 투자 권유가 아닙니다.",
  };
}

function emptyErr(error: string): CorridorPayload {
  return {
    ok: false,
    error,
    generated_at: new Date().toISOString(),
    start_date: CORRIDOR_DEFAULTS.start_date,
    end_date: new Date().toISOString().slice(0, 10),
    trading_days: 0,
    equity: {
      symbol: CORRIDOR_DEFAULTS.equity_symbol,
      name: etfName(CORRIDOR_DEFAULTS.equity_symbol),
    },
    bond: {
      symbol: CORRIDOR_DEFAULTS.bond_symbol,
      name: etfName(CORRIDOR_DEFAULTS.bond_symbol),
    },
    target_equity_pct: CORRIDOR_DEFAULTS.target_equity_pct,
    upper_pct: CORRIDOR_DEFAULTS.upper_pct,
    lower_pct: CORRIDOR_DEFAULTS.lower_pct,
    initial_value: CORRIDOR_DEFAULTS.initial_value,
    primary: {
      id: "corridor",
      label: "—",
      mode: "corridor",
      upper_pct: null,
      lower_pct: null,
      metrics: metricsFromSeries([], CORRIDOR_DEFAULTS.initial_value, 0),
      series: [],
    },
    baselines: [],
    sensitivity: [],
    note: "",
    disclaimer: "",
  };
}

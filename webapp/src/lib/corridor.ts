/**
 * Corridor (band) rebalancing — equity weight bands for asset-allocation funds.
 * Default: KODEX 200 30% + KODEX 단기채권 70% from 2020-01 first session.
 *
 * After band touch, wait `delay_days` trading days (still outside) then rebalance.
 * Rebalance destination: band edge, inner cushion, or target weight.
 */

import { CATALOG_BY_SYMBOL } from "@/lib/etfCatalog";
import { fetchDailyCloses } from "@/lib/simulate";

export const CORRIDOR_DEFAULTS = {
  equity_symbol: "069500.KS",
  bond_symbol: "153130.KS",
  target_equity_pct: 45,
  start_date: "2020-01-02",
  initial_value: 100_000_000,
  max_scenarios: 5,
} as const;

export type RebalanceTargetMode = "band" | "cushion" | "target";

export type CorridorScenarioConfig = {
  id?: string;
  label?: string;
  lower_pct: number;
  upper_pct: number;
  /** Trading days after first band touch before rebalancing. 0 = same day. */
  delay_days: number;
  /** Where to set equity weight when rebalancing. */
  rebalance_to: RebalanceTargetMode;
  /** Percentage points inside the band when rebalance_to === "cushion". */
  cushion_pct?: number;
};

export type CorridorMode = "corridor" | "buy_hold";

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
  lower_pct: number | null;
  upper_pct: number | null;
  delay_days: number | null;
  rebalance_to: RebalanceTargetMode | null;
  cushion_pct: number | null;
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
  initial_value: number;
  scenarios: CorridorScenario[];
  buy_hold: CorridorScenario;
  note: string;
  disclaimer: string;
};

export const DEFAULT_SCENARIOS: CorridorScenarioConfig[] = [
  {
    id: "c1",
    label: "Corridor 1",
    lower_pct: 30,
    upper_pct: 60,
    delay_days: 0,
    rebalance_to: "band",
    cushion_pct: 5,
  },
  {
    id: "c2",
    label: "Corridor 2",
    lower_pct: 35,
    upper_pct: 60,
    delay_days: 5,
    rebalance_to: "band",
    cushion_pct: 5,
  },
  {
    id: "c3",
    label: "Corridor 3",
    lower_pct: 40,
    upper_pct: 60,
    delay_days: 5,
    rebalance_to: "cushion",
    cushion_pct: 5,
  },
];

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
  const total_return_pct = (final_value / initial - 1) * 100;

  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    if (prev > 0) rets.push(values[i]! / prev - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const varSum =
    rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const dailyVol = Math.sqrt(varSum);
  const annual_vol_pct = dailyVol * Math.sqrt(252) * 100;
  const cagr_pct =
    (Math.pow(final_value / initial, 252 / Math.max(1, rets.length)) - 1) * 100;
  const sharpe = annual_vol_pct > 1e-9 ? (cagr_pct - 0) / annual_vol_pct : 0;

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

function rebalanceLabel(mode: RebalanceTargetMode, cushion_pct: number): string {
  if (mode === "target") return "목표비중";
  if (mode === "cushion") return `여유 ${cushion_pct}%p`;
  return "밴드시";
}

export function scenarioLabel(cfg: CorridorScenarioConfig, index: number): string {
  if (cfg.label?.trim()) return cfg.label.trim();
  const delay = cfg.delay_days ?? 0;
  const cushion = cfg.cushion_pct ?? 5;
  return `C${index + 1} ${cfg.lower_pct}–${cfg.upper_pct}% · D${delay} · ${rebalanceLabel(cfg.rebalance_to, cushion)}`;
}

/** Equity weight to set after a confirmed breach. */
export function resolveRebalanceWeight(input: {
  side: "upper" | "lower";
  upper: number;
  lower: number;
  target: number;
  rebalance_to: RebalanceTargetMode;
  cushion_pct: number;
}): number {
  const { side, upper, lower, target, rebalance_to, cushion_pct } = input;
  const cushion = Math.max(0, cushion_pct);

  if (rebalance_to === "target") {
    return clamp(target, lower, upper);
  }

  if (rebalance_to === "cushion") {
    if (side === "upper") {
      // Sell past the upper edge toward target (more generous / leave room).
      const w = upper - cushion / 100;
      return clamp(Math.max(w, target), lower, upper);
    }
    const w = lower + cushion / 100;
    return clamp(Math.min(w, target), lower, upper);
  }

  // band edge
  return side === "upper" ? upper : lower;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function runPath(input: {
  dates: string[];
  eq: number[];
  bond: number[];
  target: number;
  initial: number;
  id: string;
  label: string;
  mode: CorridorMode;
  cfg?: CorridorScenarioConfig;
}): CorridorScenario {
  const { dates, eq, bond, target, initial, id, label, mode, cfg } = input;
  const upper = cfg != null ? cfg.upper_pct / 100 : null;
  const lower = cfg != null ? cfg.lower_pct / 100 : null;
  const delay_days = cfg != null ? Math.max(0, Math.floor(cfg.delay_days)) : null;
  const rebalance_to = cfg?.rebalance_to ?? null;
  const cushion_pct = cfg != null ? Math.max(0, cfg.cushion_pct ?? 5) : null;

  let eqVal = initial * target;
  let bondVal = initial * (1 - target);
  let rebalance_count = 0;
  let pendingSide: "upper" | "lower" | null = null;
  let pendingSince: number | null = null;
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

    if (
      mode === "corridor" &&
      upper != null &&
      lower != null &&
      delay_days != null &&
      rebalance_to != null &&
      cushion_pct != null
    ) {
      const outsideUpper = w > upper;
      const outsideLower = w < lower;

      if (!outsideUpper && !outsideLower) {
        pendingSide = null;
        pendingSince = null;
      } else {
        const side: "upper" | "lower" = outsideUpper ? "upper" : "lower";
        if (pendingSide !== side) {
          pendingSide = side;
          pendingSince = i;
        }
        if (pendingSince != null && i - pendingSince >= delay_days) {
          const dest = resolveRebalanceWeight({
            side,
            upper,
            lower,
            target,
            rebalance_to,
            cushion_pct,
          });
          eqVal = total * dest;
          bondVal = total * (1 - dest);
          w = dest;
          rebalance_count += 1;
          rebalanced = true;
          pendingSide = null;
          pendingSince = null;
        }
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
    lower_pct: lower != null ? round(lower * 100, 1) : null,
    upper_pct: upper != null ? round(upper * 100, 1) : null,
    delay_days,
    rebalance_to,
    cushion_pct,
    metrics: metricsFromSeries(series, initial, rebalance_count),
    series: downsampleSeries(series),
  };
}

function validateScenario(
  cfg: CorridorScenarioConfig,
  target_equity_pct: number,
  index: number,
): string | null {
  const { lower_pct, upper_pct, delay_days, rebalance_to } = cfg;
  if (!(lower_pct >= 0 && upper_pct <= 100 && lower_pct < upper_pct)) {
    return `시나리오 ${index + 1}: 하단 < 상단, 0~100% 범위를 확인하세요.`;
  }
  if (target_equity_pct < lower_pct || target_equity_pct > upper_pct) {
    return `시나리오 ${index + 1}: 목표 주식 비중은 하단~상단 corridor 안에 있어야 합니다.`;
  }
  if (!(Number.isFinite(delay_days) && delay_days >= 0 && delay_days <= 60)) {
    return `시나리오 ${index + 1}: 지연 거래일은 0~60이어야 합니다.`;
  }
  if (rebalance_to !== "band" && rebalance_to !== "cushion" && rebalance_to !== "target") {
    return `시나리오 ${index + 1}: 리밸 목표(band/cushion/target)를 확인하세요.`;
  }
  if (rebalance_to === "cushion") {
    const c = cfg.cushion_pct ?? 5;
    if (!(c >= 0 && c < upper_pct - lower_pct)) {
      return `시나리오 ${index + 1}: 여유폭(cushion)은 밴드 폭보다 작아야 합니다.`;
    }
  }
  return null;
}

export type CorridorRequest = {
  equity_symbol?: string;
  bond_symbol?: string;
  target_equity_pct?: number;
  start_date?: string;
  end_date?: string;
  initial_value?: number;
  /** Multi-scenario compare. Falls back to DEFAULT_SCENARIOS. */
  scenarios?: CorridorScenarioConfig[];
  /** Legacy single-band fields — mapped to one scenario if scenarios omitted. */
  upper_pct?: number;
  lower_pct?: number;
};

export async function runCorridorAnalysis(
  req: CorridorRequest = {},
): Promise<CorridorPayload> {
  const equity_symbol = (req.equity_symbol || CORRIDOR_DEFAULTS.equity_symbol).toUpperCase();
  const bond_symbol = (req.bond_symbol || CORRIDOR_DEFAULTS.bond_symbol).toUpperCase();
  const target_equity_pct = req.target_equity_pct ?? CORRIDOR_DEFAULTS.target_equity_pct;
  const start_date = req.start_date || CORRIDOR_DEFAULTS.start_date;
  const end_date = req.end_date || new Date().toISOString().slice(0, 10);
  const initial_value = req.initial_value ?? CORRIDOR_DEFAULTS.initial_value;

  if (!(target_equity_pct > 0 && target_equity_pct < 100)) {
    return emptyErr("목표 주식 비중은 0~100% 사이여야 합니다.");
  }

  let scenarioCfgs: CorridorScenarioConfig[];
  if (Array.isArray(req.scenarios) && req.scenarios.length > 0) {
    scenarioCfgs = req.scenarios.slice(0, CORRIDOR_DEFAULTS.max_scenarios);
  } else if (req.upper_pct != null && req.lower_pct != null) {
    scenarioCfgs = [
      {
        id: "c1",
        label: "Corridor 1",
        lower_pct: req.lower_pct,
        upper_pct: req.upper_pct,
        delay_days: 0,
        rebalance_to: "band",
        cushion_pct: 5,
      },
    ];
  } else {
    scenarioCfgs = DEFAULT_SCENARIOS.map((s) => ({ ...s }));
  }

  for (let i = 0; i < scenarioCfgs.length; i++) {
    const err = validateScenario(scenarioCfgs[i]!, target_equity_pct, i);
    if (err) return emptyErr(err);
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

  const scenarios = scenarioCfgs.map((cfg, index) =>
    runPath({
      dates,
      eq,
      bond,
      target,
      initial: initial_value,
      id: cfg.id || `c${index + 1}`,
      label: scenarioLabel(cfg, index),
      mode: "corridor",
      cfg,
    }),
  );

  const buy_hold = runPath({
    dates,
    eq,
    bond,
    target,
    initial: initial_value,
    id: "buy_hold",
    label: "Buy & Hold",
    mode: "buy_hold",
  });

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    start_date: dates[0]!,
    end_date: dates[dates.length - 1]!,
    trading_days: dates.length,
    equity: { symbol: equity_symbol, name: etfName(equity_symbol) },
    bond: { symbol: bond_symbol, name: etfName(bond_symbol) },
    target_equity_pct,
    initial_value,
    scenarios,
    buy_hold,
    note:
      "밴드 터치 후 N거래일 동안 이탈이 유지되면 리밸런싱합니다. 리밸 목표는 밴드시(상·하한), 여유(밴드 안쪽), 목표비중 중 선택할 수 있습니다.",
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
    initial_value: CORRIDOR_DEFAULTS.initial_value,
    scenarios: [],
    buy_hold: {
      id: "buy_hold",
      label: "Buy & Hold",
      mode: "buy_hold",
      lower_pct: null,
      upper_pct: null,
      delay_days: null,
      rebalance_to: null,
      cushion_pct: null,
      metrics: metricsFromSeries([], CORRIDOR_DEFAULTS.initial_value, 0),
      series: [],
    },
    note: "",
    disclaimer: "",
  };
}

/**
 * Quant desk — apply GS Quant public timeseries to SavvyETF majors
 * (vol monitor, trading signals, yen carry, metals, country ETF, derivatives).
 */

import {
  downsampleGs,
  gsBeta,
  gsBollinger,
  gsCorrelation,
  gsCurrentDrawdown,
  gsDrawdownSeries,
  gsMacdLast,
  gsMaxDrawdown,
  gsMovingAverage,
  gsPctChange,
  gsPercentileLast,
  gsRsi,
  gsRsiLast,
  gsSharpe,
  gsSimpleReturns,
  gsVolatility,
  gsVolatilityLast,
  gsZscoreLast,
  type GsPoint,
} from "@/lib/gsQuant";

export type QuantRange = "6mo" | "1y" | "2y";
export type QuantGroup = "주식" | "국가" | "테마" | "변동성" | "금리" | "크레딧" | "원자재" | "환율" | "가상자산";

export const QUANT_RANGES: Array<{ id: QuantRange; label: string }> = [
  { id: "6mo", label: "6개월" },
  { id: "1y", label: "1년" },
  { id: "2y", label: "2년" },
];

export const QUANT_WINDOWS = {
  vol: 22,
  ma: 22,
  bbK: 2,
  rsi: 14,
  beta: 63,
  sharpe: 63,
  corr: 63,
  z: 63,
} as const;

export type QuantAssetSpec = {
  id: string;
  label: string;
  short: string;
  group: QuantGroup;
  yahoo: string;
  color: string;
  /** Maps to an existing SavvyETF surface. */
  from: string;
};

export const QUANT_ASSETS: QuantAssetSpec[] = [
  { id: "spy", label: "S&P 500 (SPY)", short: "SPY", group: "주식", yahoo: "SPY", color: "#60a5fa", from: "트레이딩 시그널" },
  { id: "qqq", label: "Nasdaq-100 (QQQ)", short: "QQQ", group: "주식", yahoo: "QQQ", color: "#818cf8", from: "트레이딩 시그널" },
  { id: "iwm", label: "Russell 2000 (IWM)", short: "IWM", group: "주식", yahoo: "IWM", color: "#38bdf8", from: "시황" },
  { id: "ewy", label: "한국 (EWY)", short: "EWY", group: "국가", yahoo: "EWY", color: "#2563eb", from: "국가ETF · 변동성" },
  { id: "smh", label: "반도체 (SMH)", short: "SMH", group: "테마", yahoo: "SMH", color: "#22d3ee", from: "트레이딩 시그널" },
  { id: "vix", label: "VIX", short: "VIX", group: "변동성", yahoo: "^VIX", color: "#f87171", from: "Volatility Monitor" },
  { id: "tlt", label: "장기국채 (TLT)", short: "TLT", group: "금리", yahoo: "TLT", color: "#a78bfa", from: "경제 · 시그널" },
  { id: "hyg", label: "하이일드 (HYG)", short: "HYG", group: "크레딧", yahoo: "HYG", color: "#c084fc", from: "경제" },
  { id: "gld", label: "금 (GLD)", short: "GLD", group: "원자재", yahoo: "GLD", color: "#eab308", from: "귀금속" },
  { id: "uso", label: "원유 (USO)", short: "USO", group: "원자재", yahoo: "USO", color: "#78716c", from: "원자재" },
  { id: "uup", label: "달러 (UUP)", short: "UUP", group: "환율", yahoo: "UUP", color: "#34d399", from: "경제" },
  { id: "jpy", label: "달러/엔", short: "JPY", group: "환율", yahoo: "JPY=X", color: "#fb7185", from: "엔케리 모니터" },
  { id: "btc", label: "비트코인", short: "BTC", group: "가상자산", yahoo: "BTC-USD", color: "#f59e0b", from: "가상자산" },
];

export type QuantChartPoint = {
  date: string;
  label: string;
  close: number;
  ma: number | null;
  upper: number | null;
  lower: number | null;
  dd: number | null;
  rsi: number | null;
  vol: number | null;
};

export type QuantStretch = "hot" | "cold" | "drawn" | "neutral";

export type QuantSnapshot = {
  id: string;
  label: string;
  short: string;
  group: QuantGroup;
  yahoo: string;
  color: string;
  from: string;
  price: number | null;
  ret_1d: number | null;
  ret_20d: number | null;
  ret_range: number | null;
  vol22: number | null;
  max_dd: number | null;
  dd: number | null;
  sharpe63: number | null;
  beta_spy: number | null;
  corr_spy: number | null;
  rsi: number | null;
  macd: number | null;
  ret_z: number | null;
  px_pctile: number | null;
  stretch: QuantStretch;
  stretch_ko: string;
  chart: QuantChartPoint[];
};

export type QuantHeatCell = {
  a: string;
  b: string;
  value: number | null;
};

export type QuantPayload = {
  ok: boolean;
  generated_at: string;
  range: QuantRange;
  note: string;
  comment: string;
  snapshots: QuantSnapshot[];
  heatmap: QuantHeatCell[];
  ids: string[];
  errors: string[];
  error?: string;
};

export function parseQuantRange(raw: string | null | undefined): QuantRange {
  const v = (raw || "").trim().toLowerCase();
  if (v === "6mo" || v === "1y" || v === "2y") return v;
  return "1y";
}

function stretchOf(
  id: string,
  row: {
    rsi: number | null;
    ret_z: number | null;
    px_pctile: number | null;
    dd: number | null;
    max_dd: number | null;
  },
): { stretch: QuantStretch; stretch_ko: string } {
  const { rsi, ret_z, px_pctile, dd, max_dd } = row;
  if ((rsi != null && rsi >= 70) || (ret_z != null && ret_z >= 2)) {
    return { stretch: "hot", stretch_ko: "과열" };
  }
  if ((rsi != null && rsi <= 30) || (ret_z != null && ret_z <= -2)) {
    return { stretch: "cold", stretch_ko: "위축" };
  }
  if (
    id !== "vix" &&
    dd != null &&
    dd >= 0.12 &&
    max_dd != null &&
    dd >= max_dd * 0.55
  ) {
    return { stretch: "drawn", stretch_ko: "낙폭" };
  }
  if (px_pctile != null && px_pctile >= 98 && rsi != null && rsi >= 60) {
    return { stretch: "hot", stretch_ko: "과열" };
  }
  return { stretch: "neutral", stretch_ko: "중립" };
}

function chartLabel(date: string): string {
  return date.slice(5);
}

export function buildQuantSnapshot(
  spec: QuantAssetSpec,
  prices: GsPoint[],
  lastPrice: number | null,
  spy: GsPoint[] | null,
): QuantSnapshot {
  const values = prices.map((p) => p.value);
  const rets = gsSimpleReturns(values);
  const bb = gsBollinger(values, QUANT_WINDOWS.ma, QUANT_WINDOWS.bbK);
  const rsiSeries = gsRsi(values, QUANT_WINDOWS.rsi);
  const volSeries = gsVolatility(values, QUANT_WINDOWS.vol);
  const ddSeries = gsDrawdownSeries(values);
  const ma = gsMovingAverage(values, QUANT_WINDOWS.ma);
  const chartRaw: QuantChartPoint[] = prices.map((p, i) => ({
    date: p.date,
    label: chartLabel(p.date),
    close: p.value,
    ma: ma[i] ?? null,
    upper: bb.upper[i] ?? null,
    lower: bb.lower[i] ?? null,
    dd: ddSeries[i] != null ? ddSeries[i]! * 100 : null,
    rsi: rsiSeries[i] ?? null,
    vol: volSeries[i] ?? null,
  }));
  const row = {
    rsi: gsRsiLast(values, QUANT_WINDOWS.rsi),
    ret_z: gsZscoreLast(rets, QUANT_WINDOWS.z),
    px_pctile: gsPercentileLast(values),
    dd: gsCurrentDrawdown(values),
    max_dd: gsMaxDrawdown(values),
  };
  const { stretch, stretch_ko } = stretchOf(spec.id, row);
  return {
    id: spec.id,
    label: spec.label,
    short: spec.short,
    group: spec.group,
    yahoo: spec.yahoo,
    color: spec.color,
    from: spec.from,
    price: lastPrice ?? (values.length ? values[values.length - 1]! : null),
    ret_1d: gsPctChange(values, 1),
    ret_20d: gsPctChange(values, 20),
    ret_range: gsPctChange(values, Math.max(1, values.length - 1)),
    vol22: gsVolatilityLast(values, QUANT_WINDOWS.vol),
    max_dd: row.max_dd,
    dd: row.dd,
    sharpe63: gsSharpe(values, QUANT_WINDOWS.sharpe),
    beta_spy: spy ? gsBeta(prices, spy, QUANT_WINDOWS.beta) : null,
    corr_spy: spy ? gsCorrelation(prices, spy, QUANT_WINDOWS.corr) : null,
    rsi: row.rsi,
    macd: gsMacdLast(values),
    ret_z: row.ret_z,
    px_pctile: row.px_pctile,
    stretch,
    stretch_ko,
    chart: downsampleGs(chartRaw, 140),
  };
}

export function buildHeatmap(seriesById: Map<string, GsPoint[]>): QuantHeatCell[] {
  const ids = QUANT_ASSETS.map((s) => s.id);
  const cells: QuantHeatCell[] = [];
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) {
        cells.push({ a, b, value: 1 });
        continue;
      }
      const sa = seriesById.get(a);
      const sb = seriesById.get(b);
      cells.push({
        a,
        b,
        value: sa && sb ? gsCorrelation(sa, sb, QUANT_WINDOWS.corr) : null,
      });
    }
  }
  return cells;
}

export function quantDeskComment(rows: QuantSnapshot[]): string {
  const ok = rows.filter((r) => r.price != null);
  if (!ok.length) return "시세가 없어 데스크 코멘트를 만들지 못했습니다.";
  const spy = ok.find((r) => r.id === "spy");
  const vix = ok.find((r) => r.id === "vix");
  const hot = ok.filter((r) => r.stretch === "hot").map((r) => r.short);
  const cold = ok.filter((r) => r.stretch === "cold").map((r) => r.short);
  const drawn = ok.filter((r) => r.stretch === "drawn").map((r) => r.short);
  const bits: string[] = [];
  if (spy?.rsi != null && spy.vol22 != null) {
    bits.push(
      `SPY RSI ${spy.rsi.toFixed(0)} · 실현변동성(22일) ${spy.vol22.toFixed(1)}%` +
        (spy.sharpe63 != null ? ` · 샤프 ${spy.sharpe63.toFixed(2)}` : "") +
        ".",
    );
  }
  if (vix?.price != null && vix.ret_z != null) {
    bits.push(
      `VIX ${vix.price.toFixed(1)} (일간 수익률 z ${vix.ret_z >= 0 ? "+" : ""}${vix.ret_z.toFixed(1)}).`,
    );
  }
  if (hot.length) bits.push(`과열 쪽: ${hot.join("·")}.`);
  if (cold.length) bits.push(`위축 쪽: ${cold.join("·")}.`);
  if (drawn.length) bits.push(`낙폭 주의: ${drawn.join("·")}.`);
  if (bits.length < 2) {
    bits.push("GS 공개 시계열 기준으로는 뚜렷한 극단이 없습니다.");
  }
  return bits.join(" ");
}

export const QUANT_METHODOLOGY: string[] = [
  "econometrics: returns(simple) · volatility(22, √252·100) · max_drawdown · beta/correlation vs SPY(63) · sharpe(63, rf=0)",
  "statistics: zscores(일간 수익률, 63) · 가격 percentile",
  "technicals: moving_average(22) · bollinger_bands(22, k=2) · RSI(14, SMMA) · MACD(12·26·9)",
  "유니버스: 트레이딩 시그널 · Volatility Monitor · 엔케리 · 귀금속 · 국가ETF · 가상자산에 이미 있는 Yahoo 심볼",
  "시세: Yahoo Finance 일봉. 투자 자문이 아닙니다.",
];

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
export type QuantGroup =
  | "주식"
  | "업종"
  | "테마"
  | "국가"
  | "변동성"
  | "금리"
  | "크레딧"
  | "원자재"
  | "환율"
  | "가상자산"
  | "조회";

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
  { id: "xlk", label: "기술 (XLK)", short: "XLK", group: "업종", yahoo: "XLK", color: "#3b82f6", from: "미국 업종 ETF" },
  { id: "xlc", label: "커뮤니케이션 (XLC)", short: "XLC", group: "업종", yahoo: "XLC", color: "#8b5cf6", from: "미국 업종 ETF" },
  { id: "xly", label: "경기소비재 (XLY)", short: "XLY", group: "업종", yahoo: "XLY", color: "#f59e0b", from: "미국 업종 ETF" },
  { id: "xlp", label: "필수소비재 (XLP)", short: "XLP", group: "업종", yahoo: "XLP", color: "#84cc16", from: "미국 업종 ETF" },
  { id: "xle", label: "에너지 (XLE)", short: "XLE", group: "업종", yahoo: "XLE", color: "#0f766e", from: "미국 업종 ETF" },
  { id: "xlf", label: "금융 (XLF)", short: "XLF", group: "업종", yahoo: "XLF", color: "#22c55e", from: "미국 업종 ETF" },
  { id: "xlv", label: "헬스케어 (XLV)", short: "XLV", group: "업종", yahoo: "XLV", color: "#ec4899", from: "미국 업종 ETF" },
  { id: "xli", label: "산업재 (XLI)", short: "XLI", group: "업종", yahoo: "XLI", color: "#78716c", from: "미국 업종 ETF" },
  { id: "xlb", label: "소재 (XLB)", short: "XLB", group: "업종", yahoo: "XLB", color: "#a16207", from: "미국 업종 ETF" },
  { id: "xlre", label: "부동산 (XLRE)", short: "XLRE", group: "업종", yahoo: "XLRE", color: "#64748b", from: "미국 업종 ETF" },
  { id: "xlu", label: "유틸리티 (XLU)", short: "XLU", group: "업종", yahoo: "XLU", color: "#06b6d4", from: "미국 업종 ETF" },
  { id: "smh", label: "반도체 (SMH)", short: "SMH", group: "테마", yahoo: "SMH", color: "#22d3ee", from: "트레이딩 시그널" },
  { id: "soxx", label: "반도체 (SOXX)", short: "SOXX", group: "테마", yahoo: "SOXX", color: "#06b6d4", from: "주요 테마 ETF" },
  { id: "igv", label: "소프트웨어 (IGV)", short: "IGV", group: "테마", yahoo: "IGV", color: "#818cf8", from: "주요 테마 ETF" },
  { id: "botz", label: "로봇·AI (BOTZ)", short: "BOTZ", group: "테마", yahoo: "BOTZ", color: "#34d399", from: "주요 테마 ETF" },
  { id: "hack", label: "사이버보안 (HACK)", short: "HACK", group: "테마", yahoo: "HACK", color: "#38bdf8", from: "주요 테마 ETF" },
  { id: "xbi", label: "바이오 (XBI)", short: "XBI", group: "테마", yahoo: "XBI", color: "#fb7185", from: "주요 테마 ETF" },
  { id: "arkk", label: "혁신 (ARKK)", short: "ARKK", group: "테마", yahoo: "ARKK", color: "#a78bfa", from: "주요 테마 ETF" },
  { id: "ewy", label: "한국 (EWY)", short: "EWY", group: "국가", yahoo: "EWY", color: "#2563eb", from: "국가ETF · 변동성" },
  { id: "vix", label: "VIX", short: "VIX", group: "변동성", yahoo: "^VIX", color: "#f87171", from: "Volatility Monitor" },
  { id: "tlt", label: "장기국채 (TLT)", short: "TLT", group: "금리", yahoo: "TLT", color: "#a78bfa", from: "경제 · 시그널" },
  { id: "hyg", label: "하이일드 (HYG)", short: "HYG", group: "크레딧", yahoo: "HYG", color: "#c084fc", from: "경제" },
  { id: "gld", label: "금 (GLD)", short: "GLD", group: "원자재", yahoo: "GLD", color: "#eab308", from: "귀금속" },
  { id: "uso", label: "원유 (USO)", short: "USO", group: "원자재", yahoo: "USO", color: "#78716c", from: "원자재" },
  { id: "uup", label: "달러 (UUP)", short: "UUP", group: "환율", yahoo: "UUP", color: "#34d399", from: "경제" },
  { id: "jpy", label: "달러/엔", short: "JPY", group: "환율", yahoo: "JPY=X", color: "#fb7185", from: "엔케리 모니터" },
  { id: "btc", label: "비트코인", short: "BTC", group: "가상자산", yahoo: "BTC-USD", color: "#f59e0b", from: "가상자산" },
];

const LOOKUP_COLORS = ["#93c5fd", "#c4b5fd", "#67e8f9", "#fcd34d", "#fda4af"];

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
export type QuantMomentum = "up" | "down" | "flat";
export type QuantTiming = "buy" | "sell" | "wait";

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
  above_ma: boolean | null;
  stretch: QuantStretch;
  stretch_ko: string;
  momentum: QuantMomentum;
  momentum_ko: string;
  timing: QuantTiming;
  timing_ko: string;
  timing_comment: string;
  chart: QuantChartPoint[];
};

export type QuantPayload = {
  ok: boolean;
  generated_at: string;
  range: QuantRange;
  note: string;
  comment: string;
  snapshots: QuantSnapshot[];
  ids: string[];
  errors: string[];
  lookup?: boolean;
  error?: string;
};

export function parseQuantRange(raw: string | null | undefined): QuantRange {
  const v = (raw || "").trim().toLowerCase();
  if (v === "6mo" || v === "1y" || v === "2y") return v;
  return "1y";
}

/** Normalize a user-entered ETF ticker for Yahoo (US symbols, ^VIX, KR 6-digit). */
export function parseQuantTicker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase();
  if (/^\d{6}$/.test(s)) s = `${s}.KS`;
  if (s.length < 1 || s.length > 16) return null;
  if (!/^[A-Z^][A-Z0-9.^_=/-]*$/.test(s)) return null;
  if (s.includes("..") || s.includes("//") || s.includes("--")) return null;
  return s;
}

export function findQuantAsset(yahooOrId: string): QuantAssetSpec | undefined {
  const key = yahooOrId.trim().toUpperCase();
  return QUANT_ASSETS.find(
    (s) =>
      s.id.toUpperCase() === key ||
      s.yahoo.toUpperCase() === key ||
      s.short.toUpperCase() === key,
  );
}

export function lookupQuantSpec(yahoo: string, name?: string | null): QuantAssetSpec {
  const known = findQuantAsset(yahoo);
  if (known) return known;
  const short = yahoo.replace(/\.(KS|KQ)$/i, "").replace(/^\^/, "");
  const hash = [...yahoo].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const color = LOOKUP_COLORS[hash % LOOKUP_COLORS.length]!;
  const title = name?.trim();
  return {
    id: `lookup-${yahoo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: title ? `${title} (${short})` : short,
    short,
    group: "조회",
    yahoo,
    color,
    from: "직접 입력",
  };
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

function momentumOf(row: {
  ret_20d: number | null;
  macd: number | null;
  rsi: number | null;
  above_ma: boolean | null;
}): { momentum: QuantMomentum; momentum_ko: string } {
  let score = 0;
  let n = 0;
  if (row.ret_20d != null) {
    n += 1;
    if (row.ret_20d > 0.5) score += 1;
    else if (row.ret_20d < -0.5) score -= 1;
  }
  if (row.macd != null) {
    n += 1;
    if (row.macd > 0) score += 1;
    else if (row.macd < 0) score -= 1;
  }
  if (row.rsi != null) {
    n += 1;
    if (row.rsi > 55) score += 1;
    else if (row.rsi < 45) score -= 1;
  }
  if (row.above_ma != null) {
    n += 1;
    if (row.above_ma) score += 1;
    else score -= 1;
  }
  if (n < 2 || Math.abs(score) < 2) return { momentum: "flat", momentum_ko: "횡보" };
  if (score >= 2) return { momentum: "up", momentum_ko: "상승" };
  return { momentum: "down", momentum_ko: "하락" };
}

function timingOf(
  id: string,
  stretch: QuantStretch,
  momentum: QuantMomentum,
): { timing: QuantTiming; timing_ko: string } {
  if (id === "vix") {
    if (stretch === "hot") return { timing: "wait", timing_ko: "관망" };
    if (momentum === "down") return { timing: "wait", timing_ko: "관망" };
    return { timing: "wait", timing_ko: "관망" };
  }
  if (stretch === "hot") return { timing: "sell", timing_ko: "매도" };
  if (momentum === "up" && (stretch === "cold" || stretch === "drawn" || stretch === "neutral")) {
    return { timing: "buy", timing_ko: "매수" };
  }
  return { timing: "wait", timing_ko: "관망" };
}

export function quantTimingComment(input: {
  id: string;
  short: string;
  stretch: QuantStretch;
  momentum: QuantMomentum;
  timing: QuantTiming;
}): string {
  const { id, short, stretch, momentum, timing } = input;
  if (id === "vix") {
    if (stretch === "hot") {
      return "VIX — 변동성이 과열입니다. 위험자산 추격보다 헤지·축소를 우선하세요.";
    }
    if (stretch === "cold") {
      return "VIX — 변동성이 낮습니다. 위험자산에는 우호적이나 변동성 매도는 과하지 마세요.";
    }
    return "VIX — 변동성이 중립입니다. 위험자산 포지션은 추세만 확인하고 유지하세요.";
  }
  if (stretch === "hot" && momentum === "up") {
    return `${short} — 과열인데 상승 모멘텀이 여전합니다. 추격 매수보다 차익 실현·관망이 낫습니다.`;
  }
  if (stretch === "hot" && momentum === "down") {
    return `${short} — 과열 후 모멘텀이 꺾였습니다. 매도 타이밍을 우선 검토하세요.`;
  }
  if (stretch === "hot") {
    return `${short} — 과열 구간입니다. 추가 매수보다는 숨 고르기를 권합니다.`;
  }
  if (stretch === "cold" && momentum === "up") {
    return `${short} — 위축에서 상승 모멘텀이 살아납니다. 분할 매수를 검토할 만합니다.`;
  }
  if (stretch === "cold" && momentum === "down") {
    return `${short} — 위축에 하락 모멘텀입니다. 저점 확인 전 성급한 매수는 보류하세요.`;
  }
  if (stretch === "cold") {
    return `${short} — 위축 구간입니다. 반등 신호를 확인한 뒤 접근하세요.`;
  }
  if (stretch === "drawn" && momentum === "up") {
    return `${short} — 낙폭 이후 반등 모멘텀입니다. 눌림 매수를 검토할 수 있습니다.`;
  }
  if (stretch === "drawn" && momentum === "down") {
    return `${short} — 낙폭이 이어지고 있습니다. 추가 하락 여지를 보고 관망하세요.`;
  }
  if (stretch === "drawn") {
    return `${short} — 낙폭 구간입니다. 추세 전환을 확인한 뒤 대응하세요.`;
  }
  if (momentum === "up") {
    return `${short} — 과열은 아니고 상승 모멘텀입니다. 보유·분할 매수를 유지할 수 있습니다.`;
  }
  if (momentum === "down") {
    return `${short} — 과열은 없으나 모멘텀이 약합니다. 방향이 잡힐 때까지 관망하세요.`;
  }
  if (timing === "buy") {
    return `${short} — 상승 모멘텀 쪽입니다. 분할 매수를 검토하세요.`;
  }
  if (timing === "sell") {
    return `${short} — 과열 신호가 있습니다. 매도·관망을 우선하세요.`;
  }
  return `${short} — 과열·상승 모멘텀이 모두 뚜렷하지 않습니다. 관망이 무난합니다.`;
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
  const price = lastPrice ?? (values.length ? values[values.length - 1]! : null);
  const lastMa = ma.length ? ma[ma.length - 1] : null;
  const above_ma =
    price != null && lastMa != null && Number.isFinite(lastMa) ? price > lastMa : null;
  const stretchRow = {
    rsi: gsRsiLast(values, QUANT_WINDOWS.rsi),
    ret_z: gsZscoreLast(rets, QUANT_WINDOWS.z),
    px_pctile: gsPercentileLast(values),
    dd: gsCurrentDrawdown(values),
    max_dd: gsMaxDrawdown(values),
  };
  const { stretch, stretch_ko } = stretchOf(spec.id, stretchRow);
  const ret_20d = gsPctChange(values, 20);
  const macd = gsMacdLast(values);
  const { momentum, momentum_ko } = momentumOf({
    ret_20d,
    macd,
    rsi: stretchRow.rsi,
    above_ma,
  });
  const { timing, timing_ko } = timingOf(spec.id, stretch, momentum);
  const timing_comment = quantTimingComment({
    id: spec.id,
    short: spec.short,
    stretch,
    momentum,
    timing,
  });
  return {
    id: spec.id,
    label: spec.label,
    short: spec.short,
    group: spec.group,
    yahoo: spec.yahoo,
    color: spec.color,
    from: spec.from,
    price,
    ret_1d: gsPctChange(values, 1),
    ret_20d,
    ret_range: gsPctChange(values, Math.max(1, values.length - 1)),
    vol22: gsVolatilityLast(values, QUANT_WINDOWS.vol),
    max_dd: stretchRow.max_dd,
    dd: stretchRow.dd,
    sharpe63: gsSharpe(values, QUANT_WINDOWS.sharpe),
    beta_spy: spy ? gsBeta(prices, spy, QUANT_WINDOWS.beta) : null,
    corr_spy: spy ? gsCorrelation(prices, spy, QUANT_WINDOWS.corr) : null,
    rsi: stretchRow.rsi,
    macd,
    ret_z: stretchRow.ret_z,
    px_pctile: stretchRow.px_pctile,
    above_ma,
    stretch,
    stretch_ko,
    momentum,
    momentum_ko,
    timing,
    timing_ko,
    timing_comment,
    chart: downsampleGs(chartRaw, 140),
  };
}

export function quantDeskComment(rows: QuantSnapshot[]): string {
  const ok = rows.filter((r) => r.price != null);
  if (!ok.length) return "시세가 없어 데스크 코멘트를 만들지 못했습니다.";
  const spy = ok.find((r) => r.id === "spy");
  const vix = ok.find((r) => r.id === "vix");
  const hot = ok.filter((r) => r.stretch === "hot").map((r) => r.short);
  const buys = ok.filter((r) => r.timing === "buy").map((r) => r.short);
  const sells = ok.filter((r) => r.timing === "sell").map((r) => r.short);
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
  if (hot.length) bits.push(`과열: ${hot.join("·")}.`);
  if (sells.length) bits.push(`매도 검토: ${sells.slice(0, 6).join("·")}.`);
  if (buys.length) bits.push(`매수 검토: ${buys.slice(0, 6).join("·")}.`);
  if (bits.length < 2) {
    bits.push("과열·모멘텀 극단이 뚜렷하지 않습니다.");
  }
  return bits.join(" ");
}

export const QUANT_METHODOLOGY: string[] = [
  "econometrics: returns(simple) · volatility(22, √252·100) · max_drawdown · beta vs SPY(63) · sharpe(63, rf=0)",
  "statistics: zscores(일간 수익률, 63) · 가격 percentile",
  "technicals: moving_average(22) · bollinger_bands(22, k=2) · RSI(14, SMMA) · MACD(12·26·9)",
  "타이밍: 과열(RSI≥70·z≥2·고가 percentile)과 상승 모멘텀(20일+, MACD, RSI, 종가>MA22)을 점검해 매수/매도/관망 한 줄",
  "유니버스: 주식·미국 업종 SPDR·주요 테마 ETF · 시그널·Volatility Monitor 심볼. 티커 직접 조회 가능",
  "시세: Yahoo Finance 일봉. 투자 자문이 아닙니다.",
];

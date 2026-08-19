/**
 * Derivatives monitor — CME/CBOE/ICE front-month futures + options sentiment.
 * Quotes: Yahoo continuous contracts (no API key).
 */

export type DerivPoint = {
  date: string;
  value: number;
};

export type DerivBar = {
  date: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type DerivRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y";

export type DerivGroup =
  | "equity"
  | "vol"
  | "rates"
  | "fx"
  | "commodity"
  | "crypto";

export type DerivContract = {
  id: string;
  symbol: string;
  label: string;
  label_ko: string;
  group: DerivGroup;
  venue: string;
  thesis: string;
  unit?: "index" | "usd" | "pct" | "ratio";
  featured?: boolean;
  price: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_range_pct: number | null;
  volume: number | null;
  series?: DerivPoint[];
  ohlc?: DerivBar[];
  chart_kind?: "candle" | "line";
  error?: string;
};

export type DerivSpread = {
  id: string;
  label: string;
  label_ko: string;
  note: string;
  unit: "index" | "usd" | "pct" | "ratio";
  value: number | null;
  change_5d: number | null;
  tone: "calm" | "caution" | "elevated" | "hot" | "neutral";
  series?: DerivPoint[];
};

export type DerivPulse = {
  score: number;
  regime: string;
  regime_ko: string;
  drivers: string[];
  components: {
    equity_vol: number;
    vol_term: number;
    options: number;
    rates_vol: number;
  };
};

export type DerivVolTenor = {
  tenor: string;
  value: number | null;
};

export type DerivPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  range: DerivRange;
  interval: string;
  interval_label: string;
  pulse: DerivPulse;
  vol_curve: DerivVolTenor[];
  contracts: DerivContract[];
  spreads: DerivSpread[];
  error?: string;
};

export const DERIV_RANGES: Array<{ id: DerivRange; label: string }> = [
  { id: "1d", label: "1일" },
  { id: "5d", label: "5일" },
  { id: "1mo", label: "1개월" },
  { id: "3mo", label: "3개월" },
  { id: "6mo", label: "6개월" },
  { id: "1y", label: "1년" },
];

export const DERIV_YAHOO_QUERY: Record<
  DerivRange,
  { range: string; interval: string; maxBars: number }
> = {
  "1d": { range: "1d", interval: "5m", maxBars: 96 },
  "5d": { range: "5d", interval: "15m", maxBars: 120 },
  "1mo": { range: "1mo", interval: "60m", maxBars: 100 },
  "3mo": { range: "3mo", interval: "1d", maxBars: 80 },
  "6mo": { range: "6mo", interval: "1d", maxBars: 100 },
  "1y": { range: "1y", interval: "1d", maxBars: 120 },
};

export function derivIntervalLabel(range: DerivRange): string {
  switch (range) {
    case "1d":
      return "5분봉";
    case "5d":
      return "15분봉";
    case "1mo":
      return "1시간봉";
    default:
      return "일봉";
  }
}

export const DERIV_GROUP_LABELS: Record<DerivGroup, string> = {
  equity: "지수선물",
  vol: "옵션 · 변동성",
  rates: "금리선물",
  fx: "FX 선물",
  commodity: "원자재",
  crypto: "크립토 선물",
};

export function parseDerivRange(value: string | null | undefined): DerivRange {
  if (
    value === "1d" ||
    value === "5d" ||
    value === "1mo" ||
    value === "6mo" ||
    value === "1y"
  ) {
    return value;
  }
  return "3mo";
}

export function isValidOhlc(
  open: number,
  high: number,
  low: number,
  close: number,
): boolean {
  if (!(close > 0) || !(open > 0) || !(high > 0) || !(low > 0)) return false;
  if (high + 1e-9 < Math.max(open, close)) return false;
  if (low - 1e-9 > Math.min(open, close)) return false;
  return true;
}

export function hasOhlcBars(bars?: DerivBar[] | null): boolean {
  if (!bars?.length) return false;
  let n = 0;
  for (const b of bars) {
    if (!isValidOhlc(b.open, b.high, b.low, b.close)) continue;
    if (b.high > b.low + 1e-9 || b.open !== b.close) n += 1;
    if (n >= 3) return true;
  }
  return n >= Math.min(2, bars.length);
}

export function downsampleOhlc(bars: DerivBar[], maxBars: number): DerivBar[] {
  if (bars.length <= maxBars) return bars;
  const size = Math.ceil(bars.length / maxBars);
  const out: DerivBar[] = [];
  for (let i = 0; i < bars.length; i += size) {
    const chunk = bars.slice(i, i + size);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    let high = first.high;
    let low = first.low;
    let volume = 0;
    let hasVol = false;
    for (const b of chunk) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      if (b.volume != null && Number.isFinite(b.volume)) {
        volume += b.volume;
        hasVol = true;
      }
    }
    out.push({
      date: last.date,
      label: last.label,
      open: first.open,
      high,
      low,
      close: last.close,
      volume: hasVol ? volume : last.volume ?? null,
    });
  }
  return out;
}

export function closesFromOhlc(bars: DerivBar[]): DerivPoint[] {
  return bars.map((b) => ({ date: b.date, value: b.close }));
}

export const DERIV_CONTRACT_SPECS: Array<{
  id: string;
  symbol: string;
  label: string;
  label_ko: string;
  group: DerivGroup;
  venue: string;
  thesis: string;
  unit?: DerivContract["unit"];
  featured?: boolean;
}> = [
  // Equity index futures
  {
    id: "es",
    symbol: "ES=F",
    label: "ES",
    label_ko: "S&P 500 선물",
    group: "equity",
    venue: "CME",
    thesis: "미국 대형주 베타 · 글로벌 위험자산 벤치마크",
    featured: true,
  },
  {
    id: "nq",
    symbol: "NQ=F",
    label: "NQ",
    label_ko: "Nasdaq 100 선물",
    group: "equity",
    venue: "CME",
    thesis: "성장·테크 센티먼트",
    featured: true,
  },
  {
    id: "ym",
    symbol: "YM=F",
    label: "YM",
    label_ko: "Dow 선물",
    group: "equity",
    venue: "CBOT",
    thesis: "가치·경기민감 대형주",
  },
  {
    id: "rty",
    symbol: "RTY=F",
    label: "RTY",
    label_ko: "Russell 2000 선물",
    group: "equity",
    venue: "CME",
    thesis: "미국 소형주 · 리스크 온/오프",
  },
  {
    id: "nkd",
    symbol: "NKD=F",
    label: "NKD",
    label_ko: "닛케이 달러선물",
    group: "equity",
    venue: "CME",
    thesis: "일본 주식 · 엔케리 연동",
  },
  {
    id: "ks200",
    symbol: "^KS200",
    label: "KS200",
    label_ko: "KOSPI 200",
    group: "equity",
    venue: "KRX",
    thesis: "국내 선물·옵션 기초 · 지수 프록시",
    featured: true,
  },
  // Options / vol
  {
    id: "vix1d",
    symbol: "^VIX1D",
    label: "VIX1D",
    label_ko: "VIX 1일",
    group: "vol",
    venue: "CBOE",
    thesis: "초단기 내재변동성 · 당일 이벤트 민감",
    unit: "index",
  },
  {
    id: "vix9d",
    symbol: "^VIX9D",
    label: "VIX9D",
    label_ko: "VIX 9일",
    group: "vol",
    venue: "CBOE",
    thesis: "단기 내재변동성",
    unit: "index",
  },
  {
    id: "vix",
    symbol: "^VIX",
    label: "VIX",
    label_ko: "VIX",
    group: "vol",
    venue: "CBOE",
    thesis: "S&P 30일 내재변동성 · 공포지수",
    unit: "index",
    featured: true,
  },
  {
    id: "vix3m",
    symbol: "^VIX3M",
    label: "VIX3M",
    label_ko: "VIX 3개월",
    group: "vol",
    venue: "CBOE",
    thesis: "중기 내재변동성 · 기간구조 비교용",
    unit: "index",
  },
  {
    id: "vix6m",
    symbol: "^VIX6M",
    label: "VIX6M",
    label_ko: "VIX 6개월",
    group: "vol",
    venue: "CBOE",
    thesis: "장기 내재변동성",
    unit: "index",
  },
  {
    id: "vvix",
    symbol: "^VVIX",
    label: "VVIX",
    label_ko: "VVIX",
    group: "vol",
    venue: "CBOE",
    thesis: "VIX의 변동성 · 테일 헤지 수요",
    unit: "index",
  },
  {
    id: "skew",
    symbol: "^SKEW",
    label: "SKEW",
    label_ko: "SKEW",
    group: "vol",
    venue: "CBOE",
    thesis: "OTM 풋 프리미엄 · 크래시 보험 수요",
    unit: "index",
    featured: true,
  },
  {
    id: "vxn",
    symbol: "^VXN",
    label: "VXN",
    label_ko: "Nasdaq VIX",
    group: "vol",
    venue: "CBOE",
    thesis: "Nasdaq-100 내재변동성",
    unit: "index",
  },
  {
    id: "gvz",
    symbol: "^GVZ",
    label: "GVZ",
    label_ko: "금 변동성",
    group: "vol",
    venue: "CBOE",
    thesis: "금 ETF 내재변동성",
    unit: "index",
  },
  {
    id: "ovx",
    symbol: "^OVX",
    label: "OVX",
    label_ko: "원유 변동성",
    group: "vol",
    venue: "CBOE",
    thesis: "원유 ETF 내재변동성 · 지정학 민감",
    unit: "index",
  },
  {
    id: "move",
    symbol: "^MOVE",
    label: "MOVE",
    label_ko: "MOVE",
    group: "vol",
    venue: "ICE",
    thesis: "미국채 내재변동성",
    unit: "index",
    featured: true,
  },
  // Rates futures
  {
    id: "zt",
    symbol: "ZT=F",
    label: "ZT",
    label_ko: "2년 국채선물",
    group: "rates",
    venue: "CBOT",
    thesis: "단기 금리 · 연준 경로",
  },
  {
    id: "zf",
    symbol: "ZF=F",
    label: "ZF",
    label_ko: "5년 국채선물",
    group: "rates",
    venue: "CBOT",
    thesis: "중기 듀레이션",
  },
  {
    id: "zn",
    symbol: "ZN=F",
    label: "ZN",
    label_ko: "10년 국채선물",
    group: "rates",
    venue: "CBOT",
    thesis: "벤치마크 듀레이션 · 성장/인플레",
    featured: true,
  },
  {
    id: "zb",
    symbol: "ZB=F",
    label: "ZB",
    label_ko: "30년 국채선물",
    group: "rates",
    venue: "CBOT",
    thesis: "장기 금리 · 볼커/재정 민감",
  },
  {
    id: "ff",
    symbol: "ZQ=F",
    label: "FF",
    label_ko: "Fed Funds 선물",
    group: "rates",
    venue: "CBOT",
    thesis: "정책금리 기댓값 프록시",
  },
  // FX
  {
    id: "dx",
    symbol: "DX-Y.NYB",
    label: "DXY",
    label_ko: "달러인덱스",
    group: "fx",
    venue: "ICE",
    thesis: "달러 강세 = 글로벌 유동성 긴축",
    featured: true,
  },
  {
    id: "6e",
    symbol: "6E=F",
    label: "6E",
    label_ko: "유로 선물",
    group: "fx",
    venue: "CME",
    thesis: "EUR/USD · ECB vs Fed",
  },
  {
    id: "6j",
    symbol: "6J=F",
    label: "6J",
    label_ko: "엔 선물",
    group: "fx",
    venue: "CME",
    thesis: "USD/JPY 역 · 엔케리 펀딩",
  },
  {
    id: "6b",
    symbol: "6B=F",
    label: "6B",
    label_ko: "파운드 선물",
    group: "fx",
    venue: "CME",
    thesis: "GBP · 영국 금리·재정",
  },
  {
    id: "6a",
    symbol: "6A=F",
    label: "6A",
    label_ko: "호주달러 선물",
    group: "fx",
    venue: "CME",
    thesis: "위험통화 · 중국/원자재 연동",
  },
  {
    id: "usdkurw",
    symbol: "KRW=X",
    label: "USDKRW",
    label_ko: "원/달러",
    group: "fx",
    venue: "Spot",
    thesis: "국내 연동 · 위험회피 시 상승",
    featured: true,
  },
  // Commodities
  {
    id: "gc",
    symbol: "GC=F",
    label: "GC",
    label_ko: "금 선물",
    group: "commodity",
    venue: "COMEX",
    thesis: "안전자산 · 실질금리·달러 역상관",
    featured: true,
  },
  {
    id: "si",
    symbol: "SI=F",
    label: "SI",
    label_ko: "은 선물",
    group: "commodity",
    venue: "COMEX",
    thesis: "귀금속 + 산업수요 하이브리드",
  },
  {
    id: "hg",
    symbol: "HG=F",
    label: "HG",
    label_ko: "구리 선물",
    group: "commodity",
    venue: "COMEX",
    thesis: "경기·중국 수요 · Dr. Copper",
  },
  {
    id: "pl",
    symbol: "PL=F",
    label: "PL",
    label_ko: "백금 선물",
    group: "commodity",
    venue: "NYMEX",
    thesis: "산업·자동차 촉매 · 남아프리카 공급",
  },
  {
    id: "cl",
    symbol: "CL=F",
    label: "CL",
    label_ko: "WTI 원유",
    group: "commodity",
    venue: "NYMEX",
    thesis: "미국 원유 · 인플레·지정학",
    featured: true,
  },
  {
    id: "bz",
    symbol: "BZ=F",
    label: "BZ",
    label_ko: "브렌트 원유",
    group: "commodity",
    venue: "ICE",
    thesis: "글로벌 원유 벤치마크",
  },
  {
    id: "ng",
    symbol: "NG=F",
    label: "NG",
    label_ko: "천연가스",
    group: "commodity",
    venue: "NYMEX",
    thesis: "날씨·재고 · 변동성 큰 에너지",
  },
  {
    id: "zc",
    symbol: "ZC=F",
    label: "ZC",
    label_ko: "옥수수",
    group: "commodity",
    venue: "CBOT",
    thesis: "곡물 벤치마크 · 기상·에탄올",
  },
  {
    id: "zs",
    symbol: "ZS=F",
    label: "ZS",
    label_ko: "대두",
    group: "commodity",
    venue: "CBOT",
    thesis: "중국 수입 · 남미 작황",
  },
  {
    id: "zw",
    symbol: "ZW=F",
    label: "ZW",
    label_ko: "소맥",
    group: "commodity",
    venue: "CBOT",
    thesis: "식량·흑해 지정학",
  },
  // Crypto
  {
    id: "btc",
    symbol: "BTC=F",
    label: "BTC",
    label_ko: "비트코인 선물",
    group: "crypto",
    venue: "CME",
    thesis: "리스크 온 프록시 · 유동성 민감",
  },
  {
    id: "eth",
    symbol: "ETH=F",
    label: "ETH",
    label_ko: "이더 선물",
    group: "crypto",
    venue: "CME",
    thesis: "크립토 베타 · BTC 대비 고변동",
  },
];

function clip(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function last(series: DerivPoint[]): number | null {
  return series.length ? series[series.length - 1]!.value : null;
}

function lookbackPoint(series: DerivPoint[], days: number): DerivPoint | null {
  if (series.length < 2) return null;
  const end = series[series.length - 1]!;
  const endT = Date.parse(end.date);
  if (!Number.isFinite(endT)) {
    const idx = series.length - days - 1;
    return idx >= 0 ? series[idx]! : series[0]!;
  }
  const target = endT - days * 86_400_000;
  for (let i = series.length - 2; i >= 0; i--) {
    const t = Date.parse(series[i]!.date);
    if (Number.isFinite(t) && t <= target) return series[i]!;
  }
  return series[0]!;
}

function deltaOver(series: DerivPoint[], days: number): number | null {
  if (series.length < 2) return null;
  const start = lookbackPoint(series, days)?.value;
  const end = series[series.length - 1]?.value;
  if (start == null || end == null) return null;
  return end - start;
}

export function pctChange(series: DerivPoint[], days: number): number | null {
  if (series.length < 2) return null;
  const start = lookbackPoint(series, days)?.value;
  const end = series[series.length - 1]?.value;
  if (start == null || end == null || start === 0) return null;
  return (end / start - 1) * 100;
}

export function alignedRatio(
  a: DerivPoint[],
  b: DerivPoint[],
): DerivPoint[] {
  const mapB = new Map(b.map((p) => [p.date, p.value]));
  const out: DerivPoint[] = [];
  for (const p of a) {
    const bv = mapB.get(p.date);
    if (bv == null || bv === 0) continue;
    out.push({ date: p.date, value: p.value / bv });
  }
  return out;
}

export function alignedDiff(
  a: DerivPoint[],
  b: DerivPoint[],
): DerivPoint[] {
  const mapB = new Map(b.map((p) => [p.date, p.value]));
  const out: DerivPoint[] = [];
  for (const p of a) {
    const bv = mapB.get(p.date);
    if (bv == null) continue;
    out.push({ date: p.date, value: p.value - bv });
  }
  return out;
}

function toneFromScore(score: number): DerivSpread["tone"] {
  if (score >= 75) return "hot";
  if (score >= 55) return "elevated";
  if (score >= 35) return "caution";
  return "calm";
}

function vixStress(vix: number | null): { score: number; note?: string } {
  if (vix == null) return { score: 40 };
  if (vix >= 32) return { score: 92, note: `VIX 패닉 (${vix.toFixed(1)})` };
  if (vix >= 24) return { score: 74, note: `VIX 위험 (${vix.toFixed(1)})` };
  if (vix >= 18) return { score: 52, note: `VIX 경계 (${vix.toFixed(1)})` };
  if (vix >= 14) return { score: 32 };
  return { score: 14, note: `VIX 저변동 (${vix.toFixed(1)})` };
}

function termStress(vix: number | null, vix3m: number | null): {
  score: number;
  note?: string;
} {
  if (vix == null || vix3m == null) return { score: 40 };
  const gap = vix3m - vix;
  if (gap < -2) {
    return { score: 88, note: `VIX 백워데이션 (${gap.toFixed(1)})` };
  }
  if (gap < 0) {
    return { score: 68, note: `VIX 기간구조 역전 (${gap.toFixed(1)})` };
  }
  if (gap < 1.5) return { score: 48, note: `VIX 기간구조 평탄` };
  return { score: 22 };
}

function optionsStress(skew: number | null, vvix: number | null): {
  score: number;
  notes: string[];
} {
  const notes: string[] = [];
  let score = 35;
  if (skew != null) {
    if (skew >= 155) {
      score = 80;
      notes.push(`SKEW 크래시 보험 (${skew.toFixed(0)})`);
    } else if (skew >= 145) {
      score = 58;
      notes.push(`SKEW 상승 (${skew.toFixed(0)})`);
    } else {
      score = 32;
    }
  }
  if (vvix != null) {
    if (vvix >= 120) {
      score = Math.max(score, 82);
      notes.push(`VVIX 급등 (${vvix.toFixed(0)})`);
    } else if (vvix >= 100) {
      score = Math.max(score, 58);
      notes.push(`VVIX 상승 (${vvix.toFixed(0)})`);
    }
  }
  return { score: clip(score), notes };
}

function moveStress(move: number | null): { score: number; note?: string } {
  if (move == null) return { score: 40 };
  if (move >= 140) return { score: 90, note: `MOVE 급등 (${move.toFixed(0)})` };
  if (move >= 115) return { score: 70, note: `MOVE 상승 (${move.toFixed(0)})` };
  if (move >= 95) return { score: 48 };
  return { score: 22 };
}

function regimeFor(score: number): { regime: string; regime_ko: string } {
  if (score >= 75) return { regime: "Risk-off", regime_ko: "위험회피" };
  if (score >= 55) return { regime: "Elevated", regime_ko: "경계" };
  if (score >= 35) return { regime: "Watch", regime_ko: "주시" };
  return { regime: "Risk-on", regime_ko: "안정" };
}

export function computeDerivPulse(byId: Map<string, DerivContract>): DerivPulse {
  const vix = byId.get("vix")?.price ?? null;
  const vix3m = byId.get("vix3m")?.price ?? null;
  const skew = byId.get("skew")?.price ?? null;
  const vvix = byId.get("vvix")?.price ?? null;
  const move = byId.get("move")?.price ?? null;

  const eq = vixStress(vix);
  const term = termStress(vix, vix3m);
  const opt = optionsStress(skew, vvix);
  const rates = moveStress(move);

  const components = {
    equity_vol: eq.score,
    vol_term: term.score,
    options: opt.score,
    rates_vol: rates.score,
  };
  const score = Math.round(
    components.equity_vol * 0.35 +
      components.vol_term * 0.25 +
      components.options * 0.25 +
      components.rates_vol * 0.15,
  );
  const { regime, regime_ko } = regimeFor(score);
  const drivers = [
    eq.note,
    term.note,
    ...opt.notes,
    rates.note,
  ]
    .filter((d): d is string => Boolean(d))
    .slice(0, 5);

  return {
    score,
    regime,
    regime_ko,
    drivers: drivers.length
      ? drivers
      : ["뚜렷한 선물·옵션 스트레스 시그널 없음"],
    components,
  };
}

export function buildDerivSpreads(
  byId: Map<string, DerivContract>,
): DerivSpread[] {
  const vix = byId.get("vix");
  const vix3m = byId.get("vix3m");
  const gc = byId.get("gc");
  const si = byId.get("si");
  const hg = byId.get("hg");
  const cl = byId.get("cl");
  const bz = byId.get("bz");
  const skew = byId.get("skew");
  const vvix = byId.get("vvix");

  const out: DerivSpread[] = [];

  if (vix?.series?.length && vix3m?.series?.length) {
    const series = alignedDiff(vix3m.series, vix.series);
    const value = last(series);
    const score =
      value == null ? 40 : value < 0 ? 80 : value < 1.5 ? 50 : 20;
    out.push({
      id: "vix_term",
      label: "VIX3M − VIX",
      label_ko: "변동성 기간구조",
      note: "양수=콘탱고(안정) · 음수=백워데이션(스트레스)",
      unit: "index",
      value,
      change_5d: deltaOver(series, 5),
      tone: toneFromScore(score),
      series,
    });
  }

  if (skew?.price != null) {
    const v = skew.price;
    const score = v >= 155 ? 80 : v >= 145 ? 58 : 30;
    out.push({
      id: "skew_lvl",
      label: "SKEW",
      label_ko: "크래시 보험",
      note: "OTM 풋 상대가격 · 145+ 테일 헤지 확대",
      unit: "index",
      value: v,
      change_5d: deltaOver(skew.series || [], 5),
      tone: toneFromScore(score),
      series: skew.series,
    });
  }

  if (vvix?.price != null) {
    const v = vvix.price;
    const score = v >= 120 ? 78 : v >= 100 ? 55 : 28;
    out.push({
      id: "vvix_lvl",
      label: "VVIX",
      label_ko: "변동성의 변동성",
      note: "VIX 옵션 내재변동성",
      unit: "index",
      value: v,
      change_5d: deltaOver(vvix.series || [], 5),
      tone: toneFromScore(score),
      series: vvix.series,
    });
  }

  if (gc?.series?.length && si?.series?.length) {
    const series = alignedRatio(gc.series, si.series);
    out.push({
      id: "gold_silver",
      label: "Gold / Silver",
      label_ko: "금/은 비율",
      note: "상승 = 안전자산 선호 · 하락 = 리스크 온·산업수요",
      unit: "ratio",
      value: last(series),
      change_5d: pctChange(series, 5),
      tone: "neutral",
      series,
    });
  }

  if (hg?.series?.length && gc?.series?.length) {
    const series = alignedRatio(hg.series, gc.series);
    const chg = pctChange(series, 5);
    const score = chg != null && chg <= -4 ? 70 : chg != null && chg >= 4 ? 22 : 40;
    out.push({
      id: "copper_gold",
      label: "Copper / Gold",
      label_ko: "구리/금 비율",
      note: "경기 민감 / 안전자산 · 하락 = 성장 우려",
      unit: "ratio",
      value: last(series),
      change_5d: chg,
      tone: toneFromScore(score),
      series,
    });
  }

  if (cl?.series?.length && bz?.series?.length) {
    const series = alignedDiff(cl.series, bz.series);
    out.push({
      id: "wti_brent",
      label: "WTI − Brent",
      label_ko: "원유 스프레드",
      note: "보통 음수(브렌트 프리미엄) · 급변은 지역 수급 충격",
      unit: "usd",
      value: last(series),
      change_5d: deltaOver(series, 5),
      tone: "neutral",
      series,
    });
  }

  return out;
}

export function buildVolCurve(byId: Map<string, DerivContract>): DerivVolTenor[] {
  return [
    { tenor: "1D", value: byId.get("vix1d")?.price ?? null },
    { tenor: "9D", value: byId.get("vix9d")?.price ?? null },
    { tenor: "1M", value: byId.get("vix")?.price ?? null },
    { tenor: "3M", value: byId.get("vix3m")?.price ?? null },
    { tenor: "6M", value: byId.get("vix6m")?.price ?? null },
  ];
}

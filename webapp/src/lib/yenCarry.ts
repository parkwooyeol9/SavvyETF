/**
 * Yen carry-trade unwind monitor — types, specs, and composite scoring.
 * Data: FRED CSV (rates/FX) + Yahoo (spot/cross assets) + CFTC COT (JPY futures).
 */

export type YenCarryPoint = { date: string; value: number };

export type YenCarryRange = "6mo" | "1y" | "2y" | "5y";

export const YEN_CARRY_RANGES: Array<{ id: YenCarryRange; label: string }> = [
  { id: "6mo", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "2y", label: "2Y" },
  { id: "5y", label: "5Y" },
];

export function parseYenCarryRange(raw: string | null | undefined): YenCarryRange {
  if (raw === "6mo" || raw === "1y" || raw === "2y" || raw === "5y") return raw;
  return "1y";
}

export type YenCarryAsset = {
  id: string;
  symbol: string;
  label: string;
  group: "fx" | "equity" | "credit" | "rates";
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_20d_pct: number | null;
  change_range_pct: number | null;
  series?: YenCarryPoint[];
  error?: string;
};

export type YenCarryCftcPoint = {
  date: string;
  net_noncomm: number;
  long: number;
  short: number;
  open_interest: number;
};

export type YenCarryStressComponents = {
  usdjpy_drop: number;
  usdjpy_vol: number;
  vix: number;
  cftc_crowd: number;
  spread_compress: number;
};

export type YenCarryStress = {
  score: number;
  regime: string;
  regime_ko: string;
  drivers: string[];
  components: YenCarryStressComponents;
  weights: YenCarryStressComponents;
};

export type YenCarrySnapshot = {
  as_of: string | null;
  usdjpy: number | null;
  usdjpy_5d_pct: number | null;
  usdjpy_20d_pct: number | null;
  usdjpy_realized_vol_20d: number | null;
  us_10y: number | null;
  jp_10y: number | null;
  rate_spread_10y: number | null;
  rate_spread_60d_chg: number | null;
  carry_to_risk: number | null;
  vix: number | null;
  hy_oas: number | null;
  cftc_net_noncomm: number | null;
  cftc_as_of: string | null;
};

export type YenCarryPayload = {
  ok: boolean;
  generated_at: string;
  range: YenCarryRange;
  note: string;
  schedule_note: string;
  snapshot: YenCarrySnapshot;
  stress: YenCarryStress;
  series: {
    usdjpy: YenCarryPoint[];
    us_10y: YenCarryPoint[];
    jp_10y: YenCarryPoint[];
    rate_spread_10y: YenCarryPoint[];
    carry_to_risk: YenCarryPoint[];
    vix: YenCarryPoint[];
    usdjpy_realized_vol: YenCarryPoint[];
    hy_oas: YenCarryPoint[];
  };
  cftc: YenCarryCftcPoint[];
  assets: YenCarryAsset[];
  notes: string[];
  error?: string;
};

export const YEN_CARRY_ASSET_SPECS: Array<{
  id: string;
  symbol: string;
  label: string;
  group: YenCarryAsset["group"];
  thesis: string;
}> = [
  {
    id: "n225",
    symbol: "^N225",
    label: "닛케이 225",
    group: "equity",
    thesis: "2024-08처럼 엔 강세·마진콜이 일본 주식을 증폭 청산",
  },
  {
    id: "audjpy",
    symbol: "AUDJPY=X",
    label: "AUD/JPY",
    group: "fx",
    thesis: "고전적 캐리 페어 — 청산 시 급락",
  },
  {
    id: "mxnjpy",
    symbol: "MXNJPY=X",
    label: "MXN/JPY",
    group: "fx",
    thesis: "고금리 EM 캐리 — 청산 국면에서 JPY와 음의 상관 강화",
  },
  {
    id: "krw",
    symbol: "KRW=X",
    label: "USD/KRW",
    group: "fx",
    thesis: "한국 투자자 체감 채널 — 글로벌 리스크오프 시 원 약세",
  },
  {
    id: "hyg",
    symbol: "HYG",
    label: "HYG",
    group: "credit",
    thesis: "하이일드 위험선호 — 레버리지 크레딧 청산 프록시",
  },
  {
    id: "spy",
    symbol: "SPY",
    label: "S&P 500",
    group: "equity",
    thesis: "USD/JPY와 상관 붕괴 시 유동성 주도 청산 확인",
  },
];

export const YEN_CARRY_SCHEDULE_NOTE =
  "일간: USD/JPY·금리·VIX · 주간: CFTC 엔 선물(화요일 포지션 → 금요일 공시) · 경제 탭과 역할이 다름(JPY 펀딩·포지션·캐리 청산 경로)";

function clip(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function lastValue(series: YenCarryPoint[]): number | null {
  if (!series.length) return null;
  return series[series.length - 1]!.value;
}

export function pctChange(series: YenCarryPoint[], days: number): number | null {
  if (series.length <= days) return null;
  const start = series[series.length - days - 1]?.value;
  const end = series[series.length - 1]?.value;
  if (start == null || end == null || start === 0) return null;
  return ((end / start - 1) * 100);
}

export function deltaOver(series: YenCarryPoint[], days: number): number | null {
  if (series.length <= days) return null;
  const start = series[series.length - days - 1]?.value;
  const end = series[series.length - 1]?.value;
  if (start == null || end == null) return null;
  return end - start;
}

/** Annualized realized vol from daily closes over a trailing window. */
export function realizedVol(
  series: YenCarryPoint[],
  window = 20,
): number | null {
  if (series.length < window + 1) return null;
  const slice = series.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const a = slice[i - 1]!.value;
    const b = slice[i]!.value;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varSum = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
  return Math.sqrt(varSum) * Math.sqrt(252) * 100;
}

export function realizedVolSeries(
  series: YenCarryPoint[],
  window = 20,
): YenCarryPoint[] {
  const out: YenCarryPoint[] = [];
  for (let i = window; i < series.length; i++) {
    const vol = realizedVol(series.slice(0, i + 1), window);
    if (vol == null) continue;
    out.push({ date: series[i]!.date, value: Math.round(vol * 100) / 100 });
  }
  return out;
}

/** Percentile rank of `value` within `history` (0–100). */
export function percentileRank(history: number[], value: number): number {
  const clean = history.filter((x) => Number.isFinite(x));
  if (!clean.length) return 50;
  const below = clean.filter((x) => x <= value).length;
  return clip((below / clean.length) * 100);
}

function alignSeries(
  a: YenCarryPoint[],
  b: YenCarryPoint[],
): YenCarryPoint[] {
  const mapB = new Map(b.map((p) => [p.date, p.value]));
  // Forward-fill slower series (e.g. monthly JP yields) onto daily dates of a
  let lastB: number | null = null;
  const bDates = [...b].sort((x, y) => x.date.localeCompare(y.date));
  let bi = 0;
  const out: YenCarryPoint[] = [];
  for (const p of a) {
    while (bi < bDates.length && bDates[bi]!.date <= p.date) {
      lastB = bDates[bi]!.value;
      bi += 1;
    }
    const exact = mapB.get(p.date);
    const bv = exact ?? lastB;
    if (bv == null) continue;
    out.push({ date: p.date, value: Math.round((p.value - bv) * 1000) / 1000 });
  }
  return out;
}

export function buildRateSpreadSeries(
  us10y: YenCarryPoint[],
  jp10y: YenCarryPoint[],
): YenCarryPoint[] {
  return alignSeries(us10y, jp10y);
}

export function buildCarryToRiskSeries(
  spread: YenCarryPoint[],
  vol: YenCarryPoint[],
): YenCarryPoint[] {
  const volMap = new Map(vol.map((p) => [p.date, p.value]));
  const out: YenCarryPoint[] = [];
  for (const p of spread) {
    const v = volMap.get(p.date);
    if (v == null || v <= 0) continue;
    out.push({ date: p.date, value: Math.round((p.value / v) * 1000) / 1000 });
  }
  return out;
}

function regimeFor(score: number): { regime: string; regime_ko: string } {
  if (score >= 75) return { regime: "Acute", regime_ko: "급성" };
  if (score >= 55) return { regime: "Elevated", regime_ko: "경계" };
  if (score >= 35) return { regime: "Watch", regime_ko: "주시" };
  return { regime: "Calm", regime_ko: "안정" };
}

const WEIGHTS: YenCarryStressComponents = {
  usdjpy_drop: 0.25,
  usdjpy_vol: 0.2,
  vix: 0.15,
  cftc_crowd: 0.2,
  spread_compress: 0.2,
};

/**
 * Composite 0–100 unwind-risk score using percentile ranks vs available history.
 * Higher = more unwind risk.
 */
export function computeYenCarryStress(input: {
  usdjpy: YenCarryPoint[];
  vix: YenCarryPoint[];
  rateSpread: YenCarryPoint[];
  cftcNet: YenCarryCftcPoint[];
}): YenCarryStress {
  const drivers: string[] = [];
  const usdjpyDrop20 = pctChange(input.usdjpy, 20);
  // Yen strength = USDJPY drop → positive severity
  const dropSeverity = usdjpyDrop20 == null ? null : -usdjpyDrop20;
  const dropHistory = input.usdjpy
    .map((_, i) => {
      if (i < 20) return null;
      const start = input.usdjpy[i - 20]?.value;
      const end = input.usdjpy[i]?.value;
      if (start == null || end == null || start === 0) return null;
      return -((end / start - 1) * 100);
    })
    .filter((x): x is number => x != null);

  const volNow = realizedVol(input.usdjpy, 20);
  const volHistory = input.usdjpy
    .map((_, i) =>
      i >= 20 ? realizedVol(input.usdjpy.slice(0, i + 1), 20) : null,
    )
    .filter((x): x is number => x != null);

  const vixNow = lastValue(input.vix);
  const vixHistory = input.vix.map((p) => p.value);

  // More net short (negative) = higher crowding risk
  const cftcNow =
    input.cftcNet.length > 0
      ? input.cftcNet[input.cftcNet.length - 1]!.net_noncomm
      : null;
  const cftcCrowdNow = cftcNow == null ? null : -cftcNow;
  const cftcHistory = input.cftcNet.map((p) => -p.net_noncomm);

  // Spread compression over ~60 trading days = higher risk
  const spreadChg60 = deltaOver(input.rateSpread, 60);
  const compressNow = spreadChg60 == null ? null : -spreadChg60;
  const compressHistory = input.rateSpread
    .map((_, i) => {
      if (i < 60) return null;
      const start = input.rateSpread[i - 60]?.value;
      const end = input.rateSpread[i]?.value;
      if (start == null || end == null) return null;
      return -(end - start);
    })
    .filter((x): x is number => x != null);

  const components: YenCarryStressComponents = {
    usdjpy_drop:
      dropSeverity == null ? 40 : percentileRank(dropHistory, dropSeverity),
    usdjpy_vol: volNow == null ? 40 : percentileRank(volHistory, volNow),
    vix: vixNow == null ? 40 : percentileRank(vixHistory, vixNow),
    cftc_crowd:
      cftcCrowdNow == null ? 40 : percentileRank(cftcHistory, cftcCrowdNow),
    spread_compress:
      compressNow == null ? 40 : percentileRank(compressHistory, compressNow),
  };

  if (dropSeverity != null && dropSeverity >= 5) {
    drivers.push(
      `USD/JPY 20일 ${usdjpyDrop20!.toFixed(1)}% (엔 강세·숏엔 손실)`,
    );
  }
  if (volNow != null && volNow >= 12) {
    drivers.push(`USD/JPY 실현 vol ${volNow.toFixed(1)}% (캐리 불리)`);
  }
  if (vixNow != null && vixNow >= 22) {
    drivers.push(`VIX ${vixNow.toFixed(1)} (주식 변동성·마진 압력)`);
  }
  if (cftcNow != null && cftcNow < -50_000) {
    drivers.push(
      `CFTC 비상업 순매도 ${Math.round(cftcNow).toLocaleString()} (숏엔 과밀)`,
    );
  }
  if (spreadChg60 != null && spreadChg60 <= -0.3) {
    drivers.push(
      `미–일 10Y 스프레드 60일 ${spreadChg60 >= 0 ? "+" : ""}${spreadChg60.toFixed(2)}pp (캐리 유인↓)`,
    );
  }

  // Reweight if some inputs missing history (keep equal among available)
  let w = { ...WEIGHTS };
  const missing: Array<keyof YenCarryStressComponents> = [];
  if (dropSeverity == null) missing.push("usdjpy_drop");
  if (volNow == null) missing.push("usdjpy_vol");
  if (vixNow == null) missing.push("vix");
  if (cftcCrowdNow == null) missing.push("cftc_crowd");
  if (compressNow == null) missing.push("spread_compress");
  if (missing.length && missing.length < 5) {
    const dropped = missing.reduce((s, k) => s + WEIGHTS[k], 0);
    const keep = (Object.keys(WEIGHTS) as Array<keyof YenCarryStressComponents>).filter(
      (k) => !missing.includes(k),
    );
    const keepSum = keep.reduce((s, k) => s + WEIGHTS[k], 0);
    w = { ...WEIGHTS };
    for (const k of missing) w[k] = 0;
    for (const k of keep) w[k] = WEIGHTS[k] + (dropped * WEIGHTS[k]) / keepSum;
  }

  const score = Math.round(
    components.usdjpy_drop * w.usdjpy_drop +
      components.usdjpy_vol * w.usdjpy_vol +
      components.vix * w.vix +
      components.cftc_crowd * w.cftc_crowd +
      components.spread_compress * w.spread_compress,
  );

  const { regime, regime_ko } = regimeFor(score);
  return {
    score: clip(score),
    regime,
    regime_ko,
    drivers: drivers.length
      ? drivers.slice(0, 5)
      : ["현재 스냅샷에 뚜렷한 엔케리 청산 시그널 없음"],
    components: {
      usdjpy_drop: Math.round(components.usdjpy_drop),
      usdjpy_vol: Math.round(components.usdjpy_vol),
      vix: Math.round(components.vix),
      cftc_crowd: Math.round(components.cftc_crowd),
      spread_compress: Math.round(components.spread_compress),
    },
    weights: w,
  };
}

export function componentLabel(key: keyof YenCarryStressComponents): string {
  switch (key) {
    case "usdjpy_drop":
      return "USD/JPY 하락";
    case "usdjpy_vol":
      return "USD/JPY vol";
    case "vix":
      return "VIX";
    case "cftc_crowd":
      return "CFTC 과밀";
    case "spread_compress":
      return "금리차 압축";
    default:
      return key;
  }
}

export function downsample(
  points: YenCarryPoint[],
  maxPoints: number,
): YenCarryPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

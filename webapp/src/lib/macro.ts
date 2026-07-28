/**
 * Macro Risk Monitor types & scoring — ports Telegram `/macro` logic for the web 경제 tab.
 * Data: FRED (rates/credit/vol) + Yahoo (markets / yield fallbacks).
 */

export type MacroPoint = {
  date: string;
  value: number;
};

export type MacroRange = "1mo" | "3mo" | "6mo" | "1y";

export type MacroMetric = {
  id: string;
  label: string;
  group: "rates" | "curve" | "credit" | "vol" | "policy" | "market";
  unit: "pct" | "bps" | "index" | "ret";
  value: number | null;
  change_5d: number | null;
  change_20d: number | null;
  series?: MacroPoint[];
  source?: string;
  note?: string;
};

export type MacroAsset = {
  id: string;
  symbol: string;
  label: string;
  group: "equity" | "rates" | "credit" | "commodity" | "fx";
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_range_pct: number | null;
  series?: MacroPoint[];
  error?: string;
};

export type MacroCalendarEvent = {
  date: string;
  time?: string;
  country?: string;
  event: string;
  impact?: string;
  actual?: string | null;
  estimate?: string | null;
  prev?: string | null;
};

export type MacroStress = {
  score: number;
  regime: string;
  regime_ko: string;
  drivers: string[];
  components: {
    curve: number;
    credit: number;
    volatility: number;
    risk_appetite: number;
  };
};

export type MacroPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  range: MacroRange;
  uses_fred: boolean;
  snapshot: {
    as_of: string;
    DGS3MO: number | null;
    DGS2: number | null;
    DGS10: number | null;
    DGS30: number | null;
    T10Y2Y: number | null;
    T10Y3M: number | null;
    HY_OAS: number | null;
    IG_OAS: number | null;
    VIX: number | null;
    FED_FUNDS: number | null;
    SPY_5D: number | null;
    SPY_20D: number | null;
    HYG_TLT_20D: number | null;
  };
  stress: MacroStress;
  yield_curve: Array<{ tenor: string; value: number | null }>;
  metrics: MacroMetric[];
  assets: MacroAsset[];
  calendar: MacroCalendarEvent[];
  error?: string;
};

export const MACRO_RANGES: Array<{ id: MacroRange; label: string }> = [
  { id: "1mo", label: "1개월" },
  { id: "3mo", label: "3개월" },
  { id: "6mo", label: "6개월" },
  { id: "1y", label: "1년" },
];

export function parseMacroRange(value: string | null | undefined): MacroRange {
  if (value === "1mo" || value === "6mo" || value === "1y") return value;
  return "3mo";
}

export const FRED_SERIES_SPECS: Array<{
  id: string;
  fredId: string;
  label: string;
  group: MacroMetric["group"];
  unit: MacroMetric["unit"];
  snapshotKey: keyof MacroPayload["snapshot"];
  yahooSymbol?: string;
}> = [
  {
    id: "dgs3mo",
    fredId: "DGS3MO",
    label: "3M Treasury",
    group: "rates",
    unit: "pct",
    snapshotKey: "DGS3MO",
    yahooSymbol: "^IRX",
  },
  {
    id: "dgs2",
    fredId: "DGS2",
    label: "2Y Treasury",
    group: "rates",
    unit: "pct",
    snapshotKey: "DGS2",
  },
  {
    id: "dgs10",
    fredId: "DGS10",
    label: "10Y Treasury",
    group: "rates",
    unit: "pct",
    snapshotKey: "DGS10",
    yahooSymbol: "^TNX",
  },
  {
    id: "dgs30",
    fredId: "DGS30",
    label: "30Y Treasury",
    group: "rates",
    unit: "pct",
    snapshotKey: "DGS30",
    yahooSymbol: "^TYX",
  },
  {
    id: "t10y2y",
    fredId: "T10Y2Y",
    label: "10Y−2Y 스프레드",
    group: "curve",
    unit: "pct",
    snapshotKey: "T10Y2Y",
  },
  {
    id: "t10y3m",
    fredId: "T10Y3M",
    label: "10Y−3M 스프레드",
    group: "curve",
    unit: "pct",
    snapshotKey: "T10Y3M",
  },
  {
    id: "hy_oas",
    fredId: "BAMLH0A0HYM2",
    label: "HY OAS",
    group: "credit",
    unit: "pct",
    snapshotKey: "HY_OAS",
  },
  {
    id: "ig_oas",
    fredId: "BAMLC0A0CM",
    label: "IG OAS",
    group: "credit",
    unit: "pct",
    snapshotKey: "IG_OAS",
  },
  {
    id: "vix",
    fredId: "VIXCLS",
    label: "VIX",
    group: "vol",
    unit: "index",
    snapshotKey: "VIX",
    yahooSymbol: "^VIX",
  },
  {
    id: "dff",
    fredId: "DFF",
    label: "Fed Funds",
    group: "policy",
    unit: "pct",
    snapshotKey: "FED_FUNDS",
  },
];

export const MACRO_ASSET_SPECS: Array<{
  id: string;
  symbol: string;
  label: string;
  group: MacroAsset["group"];
  thesis: string;
}> = [
  {
    id: "spy",
    symbol: "SPY",
    label: "S&P 500",
    group: "equity",
    thesis: "위험자산 베타 · 매크로 스트레스 대비",
  },
  {
    id: "qqq",
    symbol: "QQQ",
    label: "Nasdaq 100",
    group: "equity",
    thesis: "성장·테크 센티먼트",
  },
  {
    id: "tlt",
    symbol: "TLT",
    label: "20Y Treasury",
    group: "rates",
    thesis: "장기 금리·듀레이션 리스크",
  },
  {
    id: "hyg",
    symbol: "HYG",
    label: "High Yield",
    group: "credit",
    thesis: "HY 신용 리스크 온/오프",
  },
  {
    id: "lqd",
    symbol: "LQD",
    label: "IG Credit",
    group: "credit",
    thesis: "투자등급 회사채 스프레드 프록시",
  },
  {
    id: "gld",
    symbol: "GLD",
    label: "Gold",
    group: "commodity",
    thesis: "안전자산·실질금리 민감",
  },
  {
    id: "uso",
    symbol: "USO",
    label: "Oil",
    group: "commodity",
    thesis: "인플레·지정학 공급 충격",
  },
  {
    id: "uup",
    symbol: "UUP",
    label: "US Dollar",
    group: "fx",
    thesis: "달러 강세 = 글로벌 유동성 긴축",
  },
];

function clip(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function curveStress(
  t10y2y: number | null,
  t10y3m: number | null,
): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 35;
  if (t10y2y != null) {
    if (t10y2y < -0.5) {
      score = 85;
      notes.push(`10Y-2Y 깊은 역전 (${t10y2y >= 0 ? "+" : ""}${t10y2y.toFixed(2)}%)`);
    } else if (t10y2y < 0) {
      score = 68;
      notes.push(`10Y-2Y 역전 (${t10y2y.toFixed(2)}%)`);
    } else if (t10y2y < 0.5) {
      score = 48;
      notes.push(`10Y-2Y 평탄 (${t10y2y >= 0 ? "+" : ""}${t10y2y.toFixed(2)}%)`);
    } else {
      score = 22;
    }
  }
  if (t10y3m != null && t10y3m < 0) {
    score = Math.max(score, 75);
    notes.push(`10Y-3M 역전 (${t10y3m.toFixed(2)}%)`);
  }
  return { score, notes };
}

function creditStress(
  hyOas: number | null,
  igOas: number | null,
): { score: number; notes: string[] } {
  const notes: string[] = [];
  if (hyOas == null) return { score: 40, notes };
  let score: number;
  if (hyOas >= 6) {
    score = 92;
    notes.push(`HY OAS 매우 확대 (${hyOas.toFixed(2)}%)`);
  } else if (hyOas >= 5) {
    score = 78;
    notes.push(`HY OAS 상승 (${hyOas.toFixed(2)}%)`);
  } else if (hyOas >= 4) {
    score = 58;
    notes.push(`HY OAS 평균 상회 (${hyOas.toFixed(2)}%)`);
  } else if (hyOas >= 3) {
    score = 35;
  } else {
    score = 18;
    notes.push(`HY OAS 타이트 (${hyOas.toFixed(2)}%)`);
  }
  if (igOas != null && igOas >= 1.5) {
    score = clip(score + 8);
    notes.push(`IG OAS 확대 (${igOas.toFixed(2)}%)`);
  }
  return { score: clip(score), notes };
}

function volStress(
  vix: number | null,
  spy20d: number | null,
): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 30;
  if (vix != null) {
    if (vix >= 35) {
      score = 95;
      notes.push(`VIX 위기 수준 (${vix.toFixed(1)})`);
    } else if (vix >= 28) {
      score = 78;
      notes.push(`VIX 상승 (${vix.toFixed(1)})`);
    } else if (vix >= 22) {
      score = 58;
      notes.push(`VIX 경계 (${vix.toFixed(1)})`);
    } else if (vix >= 18) {
      score = 40;
    } else {
      score = 18;
    }
  }
  if (spy20d != null) {
    if (spy20d <= -10) {
      score = Math.max(score, 88);
      notes.push(`S&P 500 20일 낙폭 (${spy20d.toFixed(1)}%)`);
    } else if (spy20d <= -5) {
      score = Math.max(score, 65);
      notes.push(`S&P 500 약세 (${spy20d.toFixed(1)}% / 20일)`);
    } else if (spy20d >= 8) {
      score = Math.min(score, 25);
    }
  }
  return { score: clip(score), notes };
}

function appetiteStress(hygTlt20d: number | null): {
  score: number;
  notes: string[];
} {
  if (hygTlt20d == null) return { score: 40, notes: [] };
  if (hygTlt20d <= -6) {
    return {
      score: 82,
      notes: [`Risk-off: HYG/TLT ${hygTlt20d.toFixed(1)}% (20일)`],
    };
  }
  if (hygTlt20d <= -3) {
    return {
      score: 62,
      notes: [`신용 리스크 회피: HYG/TLT ${hygTlt20d.toFixed(1)}%`],
    };
  }
  if (hygTlt20d >= 4) {
    return {
      score: 18,
      notes: [`Risk-on: HYG/TLT +${hygTlt20d.toFixed(1)}% (20일)`],
    };
  }
  return { score: 35, notes: [] };
}

function regimeFor(score: number): { regime: string; regime_ko: string } {
  if (score >= 75) return { regime: "High Stress", regime_ko: "고스트레스" };
  if (score >= 55) return { regime: "Elevated", regime_ko: "경계" };
  if (score >= 35) return { regime: "Caution", regime_ko: "주의" };
  return { regime: "Calm", regime_ko: "안정" };
}

/** Port of `macro_scores.compute_macro_stress`. */
export function computeMacroStress(snapshot: MacroPayload["snapshot"]): MacroStress {
  const curve = curveStress(snapshot.T10Y2Y, snapshot.T10Y3M);
  const credit = creditStress(snapshot.HY_OAS, snapshot.IG_OAS);
  const vol = volStress(snapshot.VIX, snapshot.SPY_20D);
  const appetite = appetiteStress(snapshot.HYG_TLT_20D);

  const components = {
    curve: curve.score,
    credit: credit.score,
    volatility: vol.score,
    risk_appetite: appetite.score,
  };
  const score = Math.round(
    components.curve * 0.25 +
      components.credit * 0.3 +
      components.volatility * 0.25 +
      components.risk_appetite * 0.2,
  );
  const { regime, regime_ko } = regimeFor(score);
  const drivers = [
    ...curve.notes,
    ...credit.notes,
    ...vol.notes,
    ...appetite.notes,
  ].slice(0, 5);

  return {
    score,
    regime,
    regime_ko,
    drivers: drivers.length ? drivers : ["현재 스냅샷에 뚜렷한 스트레스 시그널 없음"],
    components,
  };
}

export function pctChange(
  series: MacroPoint[],
  days: number,
): number | null {
  if (series.length <= days) return null;
  const start = series[series.length - days - 1]?.value;
  const end = series[series.length - 1]?.value;
  if (start == null || end == null || start === 0) return null;
  return ((end / start - 1) * 100);
}

export function lastValue(series: MacroPoint[]): number | null {
  if (!series.length) return null;
  return series[series.length - 1]!.value;
}

export function deltaOver(
  series: MacroPoint[],
  days: number,
): number | null {
  if (series.length <= days) return null;
  const start = series[series.length - days - 1]?.value;
  const end = series[series.length - 1]?.value;
  if (start == null || end == null) return null;
  return end - start;
}

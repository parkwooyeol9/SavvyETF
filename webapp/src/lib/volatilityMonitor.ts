/**
 * Volatility Monitor — realized vol + rolling correlation for project majors.
 *
 * Prices: Yahoo daily closes. Vol: annualized σ of log returns × √252 × 100.
 * Pair compare: align by date, rolling Pearson on log returns.
 */

export const VOL_MONITOR_SCHEDULE_NOTE =
  "Yahoo 일봉 · 실현변동성(연율화) · 페어 롤링 상관계수 · 페이지 로드 시 갱신";

export type VolMonitorRange = "6mo" | "1y" | "2y" | "5y";
export type VolWindow = 20 | 60;

export const VOL_MONITOR_RANGES: VolMonitorRange[] = ["6mo", "1y", "2y", "5y"];
export const VOL_WINDOWS: VolWindow[] = [20, 60];

export type VolAssetGroup =
  | "금속"
  | "에너지"
  | "가상자산"
  | "주식·변동성"
  | "환율·채권";

export type VolAssetId =
  | "gold"
  | "silver"
  | "copper"
  | "platinum"
  | "wti"
  | "brent"
  | "natgas"
  | "btc"
  | "eth"
  | "spy"
  | "qqq"
  | "vix"
  | "dxy"
  | "tlt"
  | "hyg";

export type VolAssetSpec = {
  id: VolAssetId;
  label: string;
  short: string;
  group: VolAssetGroup;
  yahoo: string;
  color: string;
  /** Default left (A) / right (B) compare pair */
  defaultRole?: "a" | "b";
};

export const VOL_ASSET_SPECS: VolAssetSpec[] = [
  {
    id: "gold",
    label: "금 (GC)",
    short: "금",
    group: "금속",
    yahoo: "GC=F",
    color: "#d4a017",
    defaultRole: "a",
  },
  {
    id: "silver",
    label: "은 (SI)",
    short: "은",
    group: "금속",
    yahoo: "SI=F",
    color: "#94a3b8",
  },
  {
    id: "copper",
    label: "구리 (HG)",
    short: "구리",
    group: "금속",
    yahoo: "HG=F",
    color: "#b45309",
  },
  {
    id: "platinum",
    label: "백금 (PL)",
    short: "백금",
    group: "금속",
    yahoo: "PL=F",
    color: "#64748b",
  },
  {
    id: "wti",
    label: "WTI",
    short: "WTI",
    group: "에너지",
    yahoo: "CL=F",
    color: "#0f766e",
  },
  {
    id: "brent",
    label: "Brent",
    short: "Brent",
    group: "에너지",
    yahoo: "BZ=F",
    color: "#115e59",
  },
  {
    id: "natgas",
    label: "천연가스",
    short: "NG",
    group: "에너지",
    yahoo: "NG=F",
    color: "#0369a1",
  },
  {
    id: "btc",
    label: "비트코인",
    short: "BTC",
    group: "가상자산",
    yahoo: "BTC-USD",
    color: "#f59e0b",
    defaultRole: "b",
  },
  {
    id: "eth",
    label: "이더리움",
    short: "ETH",
    group: "가상자산",
    yahoo: "ETH-USD",
    color: "#6366f1",
  },
  {
    id: "spy",
    label: "S&P 500 (SPY)",
    short: "SPY",
    group: "주식·변동성",
    yahoo: "SPY",
    color: "#2563eb",
  },
  {
    id: "qqq",
    label: "나스닥100 (QQQ)",
    short: "QQQ",
    group: "주식·변동성",
    yahoo: "QQQ",
    color: "#7c3aed",
  },
  {
    id: "vix",
    label: "VIX",
    short: "VIX",
    group: "주식·변동성",
    yahoo: "^VIX",
    color: "#dc2626",
  },
  {
    id: "dxy",
    label: "달러인덱스",
    short: "DXY",
    group: "환율·채권",
    yahoo: "DX-Y.NYB",
    color: "#0891b2",
  },
  {
    id: "tlt",
    label: "미 장기채 (TLT)",
    short: "TLT",
    group: "환율·채권",
    yahoo: "TLT",
    color: "#4f46e5",
  },
  {
    id: "hyg",
    label: "하이일드 (HYG)",
    short: "HYG",
    group: "환율·채권",
    yahoo: "HYG",
    color: "#db2777",
  },
];

export const VOL_ASSET_GROUPS: VolAssetGroup[] = [
  "금속",
  "에너지",
  "가상자산",
  "주식·변동성",
  "환율·채권",
];

export type VolPoint = { date: string; value: number };

export type VolAssetSeries = {
  id: VolAssetId;
  label: string;
  short: string;
  group: VolAssetGroup;
  yahoo: string;
  color: string;
  price: number | null;
  change_pct: number | null;
  /** Latest trailing realized vol (% ann.) */
  vol20: number | null;
  vol60: number | null;
  /** Price history (downsampled) for client-side rolling corr */
  closes: VolPoint[];
  vol20_series: VolPoint[];
  vol60_series: VolPoint[];
};

export type VolMonitorPayload = {
  ok: boolean;
  generated_at: string;
  range: VolMonitorRange;
  schedule_note: string;
  assets: VolAssetSeries[];
  errors: string[];
  error?: string;
};

export function parseVolRange(raw: string | null | undefined): VolMonitorRange {
  const v = (raw || "").trim().toLowerCase();
  if ((VOL_MONITOR_RANGES as string[]).includes(v)) return v as VolMonitorRange;
  return "1y";
}

export function parseVolWindow(raw: string | null | undefined): VolWindow {
  const n = Number(raw);
  if (n === 60) return 60;
  return 20;
}

export function volAssetById(id: string): VolAssetSpec | undefined {
  return VOL_ASSET_SPECS.find((s) => s.id === id);
}

export function defaultPairIds(): { a: VolAssetId; b: VolAssetId } {
  const a = VOL_ASSET_SPECS.find((s) => s.defaultRole === "a")?.id ?? "gold";
  const b = VOL_ASSET_SPECS.find((s) => s.defaultRole === "b")?.id ?? "btc";
  return { a, b };
}

export function downsample(series: VolPoint[], maxPoints: number): VolPoint[] {
  if (series.length <= maxPoints) return series;
  const out: VolPoint[] = [];
  const step = (series.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    out.push(series[idx]!);
  }
  const last = series[series.length - 1]!;
  if (out[out.length - 1]?.date !== last.date) out.push(last);
  return out;
}

/** Annualized realized vol (%) from daily closes over a trailing window. */
export function realizedVol(series: VolPoint[], window = 20): number | null {
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
  series: VolPoint[],
  window = 20,
): VolPoint[] {
  const out: VolPoint[] = [];
  for (let i = window; i < series.length; i++) {
    const vol = realizedVol(series.slice(0, i + 1), window);
    if (vol == null) continue;
    out.push({ date: series[i]!.date, value: Math.round(vol * 100) / 100 });
  }
  return out;
}

export function pctChange(series: VolPoint[], lookback = 1): number | null {
  if (series.length < lookback + 1) return null;
  const a = series[series.length - 1 - lookback]!.value;
  const b = series[series.length - 1]!.value;
  if (!(a > 0) || !Number.isFinite(b)) return null;
  return ((b - a) / a) * 100;
}

/** Align two series on common dates (inner join). */
export function alignCloses(
  a: VolPoint[],
  b: VolPoint[],
): Array<{ date: string; a: number; b: number }> {
  const mapB = new Map(b.map((p) => [p.date, p.value]));
  const out: Array<{ date: string; a: number; b: number }> = [];
  for (const p of a) {
    const bv = mapB.get(p.date);
    if (bv == null || !(p.value > 0) || !(bv > 0)) continue;
    out.push({ date: p.date, a: p.value, b: bv });
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const mx = sumX / n;
  const my = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (!(den > 0)) return null;
  return num / den;
}

/** Full-sample Pearson of log returns on aligned closes. */
export function returnCorrelation(
  closesA: VolPoint[],
  closesB: VolPoint[],
): number | null {
  const aligned = alignCloses(closesA, closesB);
  if (aligned.length < 6) return null;
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    ra.push(Math.log(aligned[i]!.a / aligned[i - 1]!.a));
    rb.push(Math.log(aligned[i]!.b / aligned[i - 1]!.b));
  }
  return pearson(ra, rb);
}

/**
 * Rolling Pearson correlation of log returns.
 * Point at date t uses returns ending on t over `window` return observations.
 */
export function rollingReturnCorrelation(
  closesA: VolPoint[],
  closesB: VolPoint[],
  window = 20,
): VolPoint[] {
  const aligned = alignCloses(closesA, closesB);
  if (aligned.length < window + 2) return [];
  const retsA: number[] = [];
  const retsB: number[] = [];
  const dates: string[] = [];
  for (let i = 1; i < aligned.length; i++) {
    retsA.push(Math.log(aligned[i]!.a / aligned[i - 1]!.a));
    retsB.push(Math.log(aligned[i]!.b / aligned[i - 1]!.b));
    dates.push(aligned[i]!.date);
  }
  const out: VolPoint[] = [];
  for (let i = window - 1; i < retsA.length; i++) {
    const xs = retsA.slice(i - window + 1, i + 1);
    const ys = retsB.slice(i - window + 1, i + 1);
    const c = pearson(xs, ys);
    if (c == null) continue;
    out.push({
      date: dates[i]!,
      value: Math.round(c * 1000) / 1000,
    });
  }
  return out;
}

/** Correlation of log returns inside an inclusive date window. */
export function windowReturnCorrelation(
  closesA: VolPoint[],
  closesB: VolPoint[],
  startDate: string,
  endDate: string,
): number | null {
  const a = closesA.filter((p) => p.date >= startDate && p.date <= endDate);
  const b = closesB.filter((p) => p.date >= startDate && p.date <= endDate);
  return returnCorrelation(a, b);
}

export function meanVolInWindow(
  series: VolPoint[],
  startDate: string,
  endDate: string,
): number | null {
  const slice = series.filter((p) => p.date >= startDate && p.date <= endDate);
  if (!slice.length) return null;
  const sum = slice.reduce((s, p) => s + p.value, 0);
  return Math.round((sum / slice.length) * 100) / 100;
}

export function lastPoint(series: VolPoint[]): VolPoint | null {
  return series.length ? series[series.length - 1]! : null;
}

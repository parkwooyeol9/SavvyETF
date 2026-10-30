/** Window labels and close-to-close returns for the main-tab heatmap. */

export type HeatmapPeriod = "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "3Y";

export const HEATMAP_PERIODS: Array<{ id: HeatmapPeriod; label: string; short: string }> = [
  { id: "1D", label: "1D", short: "1일" },
  { id: "1W", label: "1W", short: "1주" },
  { id: "1M", label: "1M", short: "1개월" },
  { id: "3M", label: "3M", short: "3개월" },
  { id: "YTD", label: "YTD", short: "YTD" },
  { id: "1Y", label: "1Y", short: "1년" },
  { id: "3Y", label: "3Y", short: "3년" },
];

const PERIOD_IDS = new Set(HEATMAP_PERIODS.map((p) => p.id));

export function isHeatmapPeriod(value: string): value is HeatmapPeriod {
  return PERIOD_IDS.has(value as HeatmapPeriod);
}

export function heatmapPeriodMeta(period: HeatmapPeriod) {
  return HEATMAP_PERIODS.find((p) => p.id === period) ?? HEATMAP_PERIODS[0];
}

export function shiftDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Calendar month shift. Clamps the day so Mar 31 → Feb 28/29, not early March. */
export function shiftMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1 + months, 1));
  const dim = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), Math.min(d, dim)))
    .toISOString()
    .slice(0, 10);
}

function daysBetween(later: string, earlier: string): number {
  const [ay, am, ad] = later.split("-").map(Number);
  const [by, bm, bd] = earlier.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/** First day of the Yahoo fetch. 1D stays on the existing two-week window. */
export function heatmapRangeStart(todayYmd: string, period: HeatmapPeriod): string {
  if (period === "1D") return shiftDays(todayYmd, -14);
  if (period === "1W") return shiftDays(todayYmd, -21);
  if (period === "1M") return shiftDays(shiftMonths(todayYmd, -1), -14);
  if (period === "3M") return shiftDays(shiftMonths(todayYmd, -3), -14);
  if (period === "YTD") return shiftDays(`${todayYmd.slice(0, 4)}-01-01`, -14);
  if (period === "1Y") return shiftDays(shiftMonths(todayYmd, -12), -14);
  return shiftDays(shiftMonths(todayYmd, -36), -14);
}

function targetDate(lastDate: string, period: HeatmapPeriod): string {
  if (period === "1W") return shiftDays(lastDate, -7);
  if (period === "1M") return shiftMonths(lastDate, -1);
  if (period === "3M") return shiftMonths(lastDate, -3);
  if (period === "YTD") return shiftDays(`${lastDate.slice(0, 4)}-01-01`, -1);
  if (period === "1Y") return shiftMonths(lastDate, -12);
  return shiftMonths(lastDate, -36);
}

export type CloseBar = { date: string; close: number };

/**
 * Close-to-close return over the window.
 * 1D is the previous bar. Longer windows use the last session on or before the
 * calendar target, and refuse a history gap so a short series is not labeled 3Y.
 */
export function periodReturnPct(
  points: CloseBar[],
  period: HeatmapPeriod,
): { pct: number; base: string; as_of: string } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  if (!last || !(last.close > 0)) return null;
  if (period === "1D") {
    const prev = points[points.length - 2];
    if (!prev || !(prev.close > 0)) return null;
    return { pct: (last.close / prev.close - 1) * 100, base: prev.date, as_of: last.date };
  }
  const target = targetDate(last.date, period);
  let base: CloseBar | null = null;
  for (const p of points) {
    if (p.date >= last.date) break;
    if (p.date <= target) base = p;
    else break;
  }
  if (!base || !(base.close > 0)) return null;
  if (daysBetween(target, base.date) > 10) return null;
  return { pct: (last.close / base.close - 1) * 100, base: base.date, as_of: last.date };
}

/** 1D keeps the existing ±2–6 scale. Longer windows follow the 85th percentile so one name does not paint every tile. */
export function heatmapColorCap(period: HeatmapPeriod, values: number[]): number {
  const abs = values.map((v) => Math.abs(v)).filter((v) => Number.isFinite(v));
  const maxAbs = abs.length ? Math.max(...abs, 0.5) : 0.5;
  if (period === "1D") return Math.min(6, Math.max(2, maxAbs * 1.05));
  abs.sort((a, b) => a - b);
  const p85 = abs[Math.min(abs.length - 1, Math.floor((abs.length - 1) * 0.85))] ?? 1;
  const floor: Record<Exclude<HeatmapPeriod, "1D">, number> = {
    "1W": 4,
    "1M": 8,
    "3M": 12,
    YTD: 12,
    "1Y": 20,
    "3Y": 40,
  };
  return Math.max(floor[period], p85);
}

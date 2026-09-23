/**
 * savvyDB public snapshot (Excel → JSON) hosted at savvydb.savvyetf.chatgpt.site.
 * Used by the Valuation tab — not live market data.
 */

export const SAVVYDB_ORIGIN = "https://savvydb.savvyetf.chatgpt.site";
export const SAVVYDB_EXTERNAL = `${SAVVYDB_ORIGIN}/#sectors`;

export const SAVVYDB_FILES = [
  "meta",
  "sectors",
  "sector-daily",
  "stocks",
  "countries",
  "valuation",
  "themes",
  "catalog",
  "country-daily",
] as const;

export type SavvyDbFile = (typeof SAVVYDB_FILES)[number];

export function isSavvyDbFile(v: string): v is SavvyDbFile {
  return (SAVVYDB_FILES as readonly string[]).includes(v);
}

export type SavvyPoint = [string, number | null];

export type SavvySectorRow = {
  id: string;
  ticker: string;
  name: string;
  group: string;
  row?: number;
  values: Record<string, number | string | null>;
  history: Record<string, SavvyPoint[]>;
};

export type SavvyStockRow = {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  industry?: string;
  row?: number;
  values: Record<string, number | string | null>;
};

export type SavvyCountryRow = {
  id: string;
  ticker: string;
  name: string;
  row?: number;
  values: Record<string, number | string | null>;
  history?: Record<string, SavvyPoint[]>;
};

export type SavvyThemeRow = {
  id?: string;
  ticker: string;
  name: string;
  group: string;
  row?: number;
  sheet?: string;
  values: Record<string, number | string | null>;
};

export type SavvyMeta = {
  sheets?: number;
  cells?: number;
  errors?: number;
  stocks?: number;
  sectors?: number;
  countries?: number;
  snapshotDate?: string;
  books?: Record<string, string>;
  etfs?: number;
};

export const SECTOR_METRICS: Record<string, string> = {
  H: "선행 PER (배)",
  G: "선행 PBR (배)",
  K: "ROE (%)",
  L: "EPS 추정치 3M 변화 (%)",
  M: "EPS 1Y 성장률 (%)",
  O: "RSI",
  S: "ERR (%)",
  U: "ERR 전월차 (%p)",
  D: "1W 수익률 (%)",
  E: "1M 수익률 (%)",
  F: "3M 수익률 (%)",
};

export const HEAT_METRICS: Array<{ key: string; label: string }> = [
  { key: "D", label: "1주" },
  { key: "E", label: "1개월" },
  { key: "F", label: "3개월" },
];

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function fmtNum(v: unknown, d = 2): string {
  const n = num(v);
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  });
}

export function fmtPct(v: unknown, d = 2): string {
  const n = num(v);
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}%`;
}

export function toneClass(v: unknown): string {
  const n = num(v);
  if (n == null || Math.abs(n) < 1e-9) return "flat";
  return n > 0 ? "up" : "down";
}

export function heatStyle(v: unknown): { background: string; color: string } {
  const n = num(v);
  if (n == null) return { background: "rgba(43,54,72,0.55)", color: "#8b9bb4" };
  if (n >= 0) return { background: "rgba(34,140,120,0.22)", color: "#7dcec0" };
  return { background: "rgba(201,123,132,0.22)", color: "#e0a0a8" };
}

export function filterByMonths(
  points: SavvyPoint[] | undefined,
  months: number,
): SavvyPoint[] {
  const pts = (points || []).filter((p) => p?.[0]);
  if (!months || !pts.length) return pts;
  const last = pts[pts.length - 1][0];
  const end = new Date(last);
  if (Number.isNaN(end.getTime())) return pts;
  end.setMonth(end.getMonth() - months);
  const cutoff = end.toISOString().slice(0, 10);
  return pts.filter((p) => p[0] >= cutoff);
}

export function normalizeIndex(points: SavvyPoint[]): SavvyPoint[] {
  const base = points.find((p) => num(p[1]) != null && num(p[1]) !== 0)?.[1];
  const b = num(base);
  if (b == null || b === 0) return points;
  return points.map(([d, v]) => {
    const n = num(v);
    return [d, n == null ? null : (n / b) * 100];
  });
}

export function seriesForChart(
  points: SavvyPoint[] | undefined,
  months: number,
  normalize = false,
): Array<{ t: string; v: number | null }> {
  let pts = filterByMonths(points, months);
  if (normalize) pts = normalizeIndex(pts);
  return pts.map(([t, v]) => ({ t, v: num(v) }));
}

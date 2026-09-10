export const RESEARCH_CATEGORIES = [
  "pending",
  "quant",
  "ai",
  "etf",
  "esg",
  "crypto",
  "geo",
] as const;

export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];

export const RESEARCH_CATEGORY_LABELS: Record<ResearchCategory, string> = {
  pending: "미분류",
  quant: "퀀트",
  ai: "AI",
  etf: "ETF",
  esg: "ESG",
  crypto: "크립토",
  geo: "지정학",
};

export const RESEARCH_CATEGORY_OPTIONS: Array<{
  id: ResearchCategory;
  label: string;
}> = RESEARCH_CATEGORIES.map((id) => ({
  id,
  label: RESEARCH_CATEGORY_LABELS[id],
}));

export const RESEARCH_CLASSIFY_OPTIONS = RESEARCH_CATEGORY_OPTIONS.filter(
  (c) => c.id !== "pending",
);

/** Vercel request bodies stay under ~4.5MB; larger PDFs are sent in chunks. */
export const RESEARCH_PROXY_PDF_BYTES = 3_500_000;
export const RESEARCH_CHUNK_BYTES = 3_000_000;
export const RESEARCH_MAX_PDF_BYTES = 25 * 1024 * 1024;

const DATE_TAIL_RE = /[_.\-\s]?(\d{8})$/;

function basenameNoExt(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "paper";
  return base.replace(/\.pdf$/i, "").trim();
}

export function compactYyyymmdd(raw: string): string | null {
  if (!/^\d{8}$/.test(raw)) return null;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return isResearchDate(iso) ? iso : null;
}

export function dateFromFilename(name: string): string | null {
  const match = basenameNoExt(name).match(DATE_TAIL_RE);
  return match ? compactYyyymmdd(match[1]!) : null;
}

export function resolvePublishedAt(filename: string, fallback: string): string {
  return dateFromFilename(filename) || fallback.trim();
}

export function titleFromFilename(name: string): string {
  const noExt = basenameNoExt(name);
  const cut = noExt.indexOf(";");
  let rest = (cut >= 0 ? noExt.slice(cut + 1) : noExt).trim();
  rest = rest.replace(DATE_TAIL_RE, "").replace(/[_.\-\s]+$/g, "").trim();
  return (rest || noExt.replace(DATE_TAIL_RE, "").trim() || noExt).slice(0, 200);
}

export const DEFAULT_RESEARCH_YEAR = "2026";

export const RESEARCH_YEAR_OPTIONS: string[] = Array.from(
  { length: 12 },
  (_, i) => String(Number(DEFAULT_RESEARCH_YEAR) - i),
);

const YEAR_RE = /^\d{4}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isResearchCategory(value: string): value is ResearchCategory {
  return (RESEARCH_CATEGORIES as readonly string[]).includes(value);
}

export function researchCategoryList(): string {
  return RESEARCH_CATEGORY_OPTIONS.map((c) => c.label).join(", ");
}

export function isResearchDate(value: string): boolean {
  if (YEAR_RE.test(value)) {
    const y = Number(value);
    return y >= 1990 && y <= 2100;
  }
  if (YEAR_MONTH_RE.test(value)) {
    const [y, m] = value.split("-").map(Number);
    return y >= 1990 && y <= 2100 && m >= 1 && m <= 12;
  }
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function composeResearchDate(
  year: string,
  month?: string,
  day?: string,
): string {
  const y = year.trim();
  const m = (month || "").trim();
  const d = (day || "").trim();
  if (!m) return y;
  const mm = m.padStart(2, "0");
  if (!d) return `${y}-${mm}`;
  return `${y}-${mm}-${d.padStart(2, "0")}`;
}

export function researchYear(value: string): string {
  return value.slice(0, 4);
}

export function formatResearchDate(value: string): string {
  const parts = value.split("-");
  const y = Number(parts[0]);
  if (!y) return value;
  if (parts.length === 1) return `${y}년`;
  const m = Number(parts[1]);
  if (parts.length === 2) return `${y}년 ${m}월`;
  const d = Number(parts[2]);
  return `${y}년 ${m}월 ${d}일`;
}

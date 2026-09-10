export const RESEARCH_CATEGORIES = [
  "quant",
  "ai",
  "etf",
  "esg",
  "crypto",
  "geo",
] as const;

export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];

export const RESEARCH_CATEGORY_LABELS: Record<ResearchCategory, string> = {
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

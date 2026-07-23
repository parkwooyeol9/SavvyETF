export type TabId = "kr" | "us" | "etf" | "esg";

export type ShellTabId = "main" | "simulate" | "education" | "geo" | TabId;

export type BriefSection = {
  heading?: string;
  html_or_text: string;
};

export type BriefImage = {
  id: string;
  url: string;
  caption?: string;
};

export type BriefSlot = {
  slot: string;
  generated_at: string;
  title: string;
  html?: string;
  sections?: BriefSection[];
  images?: BriefImage[];
  meta?: Record<string, unknown>;
  received_at?: string;
};

export type TabBriefs = {
  tab: TabId;
  updated_at: string | null;
  slots: Record<string, BriefSlot>;
};

export type AllBriefs = Record<TabId, TabBriefs>;

export const TAB_IDS: TabId[] = ["kr", "us", "etf", "esg"];

export const SHELL_TAB_IDS: ShellTabId[] = [
  "main",
  "simulate",
  "education",
  "geo",
  "kr",
  "us",
  "etf",
  "esg",
];

export const TAB_LABELS: Record<TabId, string> = {
  kr: "국내시황",
  us: "미국시황",
  etf: "ETF시황",
  esg: "ESG시황",
};

export const SHELL_TAB_LABELS: Record<ShellTabId, string> = {
  main: "메인",
  simulate: "ETF 배분",
  education: "교육",
  geo: "지정학",
  ...TAB_LABELS,
};

export const TAB_SLOT_ORDER: Record<TabId, string[]> = {
  kr: ["summary_kor", "summary_kor_intra", "summary_nxt"],
  us: ["summary", "summary_pre", "reddit"],
  etf: ["etf_sector", "etfcheck", "etf_memb"],
  esg: ["esg_monitor", "esg_accident", "esg_overview"],
};

export function isTabId(value: string): value is TabId {
  return (TAB_IDS as string[]).includes(value);
}

export function isBriefTabId(value: string): value is TabId {
  return isTabId(value);
}

export function emptyTab(tab: TabId): TabBriefs {
  return { tab, updated_at: null, slots: {} };
}

export function emptyAllBriefs(): AllBriefs {
  return {
    kr: emptyTab("kr"),
    us: emptyTab("us"),
    etf: emptyTab("etf"),
    esg: emptyTab("esg"),
  };
}

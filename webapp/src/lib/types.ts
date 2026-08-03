export type TabId = "kr" | "us" | "etf" | "esg";

export type ShellTabId =
  | "main"
  | "simulate"
  | "education"
  | "geo"
  | "aigov"
  | "aiinfra"
  | "esgreg"
  | "greenmin"
  | "etfdb"
  | "leverage"
  | "etfweights"
  | "economy"
  | "eventstudy"
  | TabId;

export type NavGroupId = "main" | "market" | "etf" | "esg";

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
  "kr",
  "us",
  "economy",
  "eventstudy",
  "education",
  "simulate",
  "etf",
  "leverage",
  "etfdb",
  "etfweights",
  "esg",
  "geo",
  "aigov",
  "aiinfra",
  "esgreg",
  "greenmin",
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
  etfdb: "ETF DB",
  leverage: "레버리지 ETF",
  etfweights: "편입비 모니터",
  geo: "지정학",
  aigov: "AI 거버넌스",
  aiinfra: "AI 인프라",
  esgreg: "ESG 규제",
  greenmin: "녹색 광물",
  economy: "경제",
  eventstudy: "이벤트 스터디",
  // TabId labels last so kr/us/etf/esg stay authoritative for brief tabs.
  ...TAB_LABELS,
};

/** Top-level groups with nested content tabs. */
export const NAV_GROUPS: Array<{
  id: NavGroupId;
  label: string;
  tabs: ShellTabId[];
}> = [
  { id: "main", label: "메인", tabs: ["main"] },
  { id: "market", label: "시황", tabs: ["kr", "us", "economy", "eventstudy"] },
  {
    id: "etf",
    label: "ETF",
    tabs: ["education", "simulate", "etf", "leverage", "etfdb", "etfweights"],
  },
  // Append-only: do not replace existing ESG sub-tabs when adding entries.
  {
    id: "esg",
    label: "ESG",
    tabs: ["esg", "geo", "aigov", "aiinfra", "esgreg", "greenmin"],
  },
];

export function navGroupForTab(tab: ShellTabId): NavGroupId {
  for (const group of NAV_GROUPS) {
    if (group.tabs.includes(tab)) return group.id;
  }
  return "main";
}

export const TAB_SLOT_ORDER: Record<TabId, string[]> = {
  kr: ["summary_kor", "summary_kor_intra", "summary_nxt"],
  us: ["summary", "summary_pre", "reddit"],
  etf: ["etf_kor15", "etf_sector", "etf_us_new", "etfcheck", "etf_memb"],
  // Priority framing: physical climate (#2) → governance screen (#3) → safety filings
  // Append-only AI gov slots — do not reorder/replace existing entries.
  esg: [
    "esg_monitor",
    "esg_overview",
    "esg_accident",
    "esg_data_briefing",
    "esg_ai_gov",
    "esg_ai_gov_brief",
  ],
};

export function isTabId(value: string): value is TabId {
  return (TAB_IDS as string[]).includes(value);
}

export function isBriefTabId(value: string): value is TabId {
  return isTabId(value);
}

export function isShellTabId(value: string): value is ShellTabId {
  return (SHELL_TAB_IDS as string[]).includes(value);
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

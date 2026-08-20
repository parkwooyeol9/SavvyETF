export type TabId = "kr" | "us" | "etf" | "esg";

export type ShellTabId =
  | "main"
  | "simulate"
  | "usportfolio"
  | "education"
  | "geo"
  | "aigov"
  | "aiinfra"
  | "esgreg"
  | "greenmin"
  | "etfdb"
  | "etfdbus"
  | "leverage"
  | "etfweights"
  | "kosdaqactive"
  | "countryetf"
  | "kosdaq100"
  | "moneyflow"
  | "economy"
  | "yencarry"
  | "cftc"
  | "metals"
  | "crypto"
  | "volmonitor"
  | "derivatives"
  | "ideas"
  | "gurus"
  | "signals"
  | "eventstudy"
  | "aiport"
  | "corridor"
  | "usmidterm"
  | TabId;

export type NavGroupId =
  | "main"
  | "market"
  | "etf"
  | "commodity"
  | "portfolio"
  | "esg"
  | "politics";

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
  "yencarry",
  "cftc",
  "metals",
  "crypto",
  "volmonitor",
  "derivatives",
  "gurus",
  "eventstudy",
  "kosdaq100",
  "moneyflow",
  "education",
  "simulate",
  "usportfolio",
  "signals",
  "ideas",
  "aiport",
  "corridor",
  "etf",
  "leverage",
  "etfdb",
  "etfdbus",
  "etfweights",
  "kosdaqactive",
  "countryetf",
  "esg",
  "geo",
  "aigov",
  "aiinfra",
  "esgreg",
  "greenmin",
  "usmidterm",
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
  usportfolio: "미국 주식",
  education: "교육",
  etfdb: "ETF DB",
  etfdbus: "ETF DB(US)",
  leverage: "레버리지 ETF",
  etfweights: "편입비 모니터",
  kosdaqactive: "코스닥액티브 ETF",
  countryetf: "국가ETF",
  geo: "지정학",
  aigov: "AI 거버넌스",
  aiinfra: "AI 인프라",
  esgreg: "ESG 규제",
  greenmin: "녹색 광물",
  economy: "경제",
  yencarry: "엔케리 모니터",
  cftc: "CFTC",
  metals: "귀금속",
  crypto: "가상자산",
  volmonitor: "Volatility Monitor",
  derivatives: "Derivatives",
  ideas: "AI Pick",
  gurus: "월가 구루",
  signals: "트레이딩 시그널",
  eventstudy: "이벤트 스터디",
  kosdaq100: "코스닥100",
  moneyflow: "Money Flow",
  aiport: "AI포트",
  corridor: "비중조절전략",
  usmidterm: "미 중간선거",
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
  {
    id: "market",
    label: "시황",
    tabs: ["kr", "us", "gurus", "eventstudy", "kosdaq100", "moneyflow"],
  },
  {
    id: "etf",
    label: "ETF",
    tabs: [
      "education",
      "etf",
      "leverage",
      "etfdb",
      "etfdbus",
      "etfweights",
      "kosdaqactive",
      "countryetf",
    ],
  },
  {
    id: "commodity",
    label: "원자재",
    tabs: ["economy", "yencarry", "cftc", "metals", "crypto", "volmonitor", "derivatives"],
  },
  {
    id: "portfolio",
    label: "포트폴리오",
    tabs: ["simulate", "usportfolio", "signals", "ideas", "aiport", "corridor"],
  },
  // Append-only: do not replace existing ESG sub-tabs when adding entries.
  {
    id: "esg",
    label: "ESG",
    tabs: ["esg", "geo", "aigov", "aiinfra", "esgreg", "greenmin"],
  },
  {
    id: "politics",
    label: "정치분석",
    tabs: ["usmidterm"],
  },
];

export function navGroupForTab(tab: ShellTabId): NavGroupId {
  for (const group of NAV_GROUPS) {
    if (group.tabs.includes(tab)) return group.id;
  }
  return "main";
}

export const TAB_SLOT_ORDER: Record<TabId, string[]> = {
  kr: ["summary_kor", "summary_nxt"],
  us: ["summary", "reddit"],
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

/** Slots kept in storage/Telegram but hidden from the dashboard tab UI. */
export const TAB_SLOT_HIDDEN: Partial<Record<TabId, readonly string[]>> = {
  kr: ["summary_kor_intra"],
  us: ["summary_pre"],
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

export type TabId = "kr" | "us" | "etf" | "esg";

export type ShellTabId =
  | "main"
  | "simulate"
  | "usportfolio"
  | "education"
  | "geo"
  | "infra"
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
  | "derivedu"
  | "round"
  | "heatpick"
  | "cardnews"
  | "gamma"
  | "quant"
  | "ideas"
  | "gurus"
  | "signals"
  | "eventstudy"
  | "aiport"
  | "nlp"
  | "graph"
  | "corridor"
  | "usmidterm"
  | "polithemes"
  | "themeetf"
  | "bookclub"
  | "bookclubboard"
  | TabId;

export type NavGroupId =
  | "main"
  | "market"
  | "etf"
  | "commodity"
  | "portfolio"
  | "ai"
  | "esg"
  | "politics"
  | "fundmgr"
  | "derivs"
  | "learn";

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
  "derivedu",
  "gamma",
  "round",
  "heatpick",
  "cardnews",
  "quant",
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
  "nlp",
  "graph",
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
  "infra",
  "aigov",
  "aiinfra",
  "esgreg",
  "greenmin",
  "usmidterm",
  "polithemes",
  "themeetf",
  "bookclub",
  "bookclubboard",
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
  education: "ETF절세",
  heatpick: "모의투자",
  round: "모의투자",
  cardnews: "카드뉴스",
  derivedu: "파생상품",
  etfdb: "ETF DB",
  etfdbus: "ETF DB(US)",
  leverage: "레버리지 ETF",
  etfweights: "편입비 모니터",
  kosdaqactive: "코스닥액티브 ETF",
  countryetf: "국가ETF",
  geo: "지정학",
  infra: "인프라",
  aigov: "인프라",
  aiinfra: "인프라",
  esgreg: "ESG 규제",
  greenmin: "녹색 광물",
  economy: "경제",
  yencarry: "엔케리 모니터",
  cftc: "CFTC",
  metals: "귀금속",
  crypto: "가상자산",
  volmonitor: "Volatility Monitor",
  derivatives: "Derivatives",
  gamma: "감마",
  quant: "Technical",
  ideas: "AI Pick",
  gurus: "월가 구루",
  signals: "트레이딩 시그널",
  eventstudy: "이벤트 스터디",
  kosdaq100: "코스닥100",
  moneyflow: "Money Flow",
  aiport: "AI포트",
  nlp: "NLP",
  graph: "그래프",
  corridor: "비중조절전략",
  usmidterm: "미 중간선거",
  polithemes: "정치테마상품",
  themeetf: "테마 ETF",
  bookclub: "북클럽",
  bookclubboard: "Contact",
  // TabId labels last so kr/us/etf/esg stay authoritative for brief tabs.
  ...TAB_LABELS,
};

export type NavGroup = {
  id: NavGroupId;
  label: string;
  tabs: ShellTabId[];
  nested?: NavGroup[];
};

/** Top-level groups with nested content tabs. */
export const NAV_GROUPS: NavGroup[] = [
  { id: "main", label: "메인", tabs: ["main"] },
  {
    id: "market",
    label: "시황",
    tabs: ["kr", "us", "eventstudy", "quant"],
    nested: [
      {
        id: "fundmgr",
        label: "펀드매니저",
        tabs: ["gurus", "etfweights", "kosdaqactive", "moneyflow"],
      },
    ],
  },
  {
    id: "etf",
    label: "ETF",
    tabs: [
      "etf",
      "etfdb",
      "etfdbus",
      "countryetf",
      "themeetf",
    ],
  },
  {
    id: "ai",
    label: "AI",
    tabs: ["graph", "nlp", "ideas", "aiport"],
    nested: [
      {
        id: "politics",
        label: "정치분석",
        tabs: ["usmidterm", "polithemes"],
      },
      {
        id: "commodity",
        label: "원자재",
        tabs: ["economy", "yencarry", "cftc", "metals", "crypto"],
      },
    ],
  },
  {
    id: "portfolio",
    label: "포트폴리오",
    tabs: ["simulate", "usportfolio", "signals", "corridor"],
    nested: [
      {
        id: "derivs",
        label: "파생상품",
        tabs: ["leverage", "volmonitor", "derivatives", "gamma"],
      },
      {
        id: "esg",
        label: "ESG",
        tabs: ["esg", "geo", "infra", "esgreg", "greenmin"],
      },
    ],
  },
  {
    id: "learn",
    label: "교육",
    tabs: ["bookclub", "cardnews", "heatpick", "education"],
  },
];

export function findNavGroup(id: NavGroupId): NavGroup | undefined {
  for (const group of NAV_GROUPS) {
    if (group.id === id) return group;
    const nested = group.nested?.find((item) => item.id === id);
    if (nested) return nested;
  }
  return undefined;
}

export function navPlacement(tab: ShellTabId): {
  groupId: NavGroupId;
  nestedId: NavGroupId | null;
} {
  if (tab === "kosdaq100") return { groupId: "market", nestedId: "fundmgr" };
  if (tab === "aigov" || tab === "aiinfra") {
    return { groupId: "portfolio", nestedId: "esg" };
  }
  if (
    tab === "education" ||
    tab === "derivedu" ||
    tab === "round" ||
    tab === "heatpick" ||
    tab === "cardnews"
  ) {
    return { groupId: "learn", nestedId: null };
  }
  for (const group of NAV_GROUPS) {
    if (group.tabs.includes(tab)) {
      return { groupId: group.id, nestedId: null };
    }
    for (const nested of group.nested || []) {
      if (nested.tabs.includes(tab)) {
        return { groupId: group.id, nestedId: nested.id };
      }
    }
  }
  return { groupId: "main", nestedId: null };
}

export function navGroupForTab(tab: ShellTabId): NavGroupId {
  return navPlacement(tab).groupId;
}

export const TAB_SLOT_ORDER: Record<TabId, string[]> = {
  kr: ["summary_kor", "summary_nxt"],
  us: ["summary", "reddit"],
  etf: ["etf_kor15", "etf_sector", "etf_us_new", "etfcheck", "etf_memb"],
  // Daily ESG 시황 monitor first; AI gov slots stay append-only after existing entries.
  esg: [
    "esg_events",
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

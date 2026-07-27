/** Korean listed ETF universe — types, classification, AUM aggregates. */

export type EtfDbDimension = "type" | "country" | "sector";

export type EtfDbRow = {
  code: string;
  name: string;
  tab_code: number;
  type: string;
  country: string;
  sector: string;
  price: number | null;
  nav: number | null;
  change_rate: number | null;
  return_3m: number | null;
  aum_eok: number;
  units: number | null;
  flow_eok: number | null;
};

export type EtfDbAggregate = {
  label: string;
  count: number;
  aum_eok: number;
  aum_share_pct: number;
  flow_eok: number | null;
  flow_available: boolean;
};

export type EtfDbHistory = {
  dates: string[];
  series: Record<string, Array<number | null>>;
};

export type EtfDbPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  count: number;
  total_aum_eok: number;
  prev_as_of: string | null;
  as_of?: string | null;
  equity_only?: boolean;
  aggregates: Record<EtfDbDimension, EtfDbAggregate[]>;
  flow_history: Record<EtfDbDimension, EtfDbHistory>;
  aum_history: Record<EtfDbDimension, EtfDbHistory>;
  rows: EtfDbRow[];
  error?: string;
};

export const TYPE_BY_TAB: Record<number, string> = {
  1: "국내 시장지수",
  2: "국내 업종/테마",
  3: "국내 파생",
  4: "해외 주식",
  5: "원자재",
  6: "채권",
  7: "기타",
};

/** Equity ETFs only — Naver tabs 1–4 (excludes 채권·원자재·기타). */
export const EQUITY_TAB_CODES = new Set([1, 2, 3, 4]);

export function isEquityEtf(row: Pick<EtfDbRow, "tab_code" | "type" | "sector">): boolean {
  if (!EQUITY_TAB_CODES.has(Number(row.tab_code) || 0)) return false;
  if (row.type === "채권" || row.type === "원자재" || row.type === "기타") return false;
  if (row.sector === "채권") return false;
  return true;
}

const COUNTRY_RULES: Array<[string, string[]]> = [
  ["미국", ["미국", "S&P", "나스닥", "NASDAQ", "필라델피아", "다우", "러셀", "러셀2000", "QQQ"]],
  ["중국", ["중국", "홍콩", "항셍", "CSI", "본토", "차이나", "항셍테크"]],
  ["일본", ["일본", "니케이", "토픽스", "TOPIX", "닛케이"]],
  ["유럽", ["유럽", "유로", "독일", "STOXX", "유로스탁스"]],
  ["인도", ["인도"]],
  ["베트남", ["베트남"]],
  ["대만", ["대만", "타이완"]],
  ["브라질", ["브라질"]],
  ["신흥", ["신흥", "이머징", "EM ", "EM전", "글로벌신흥"]],
  ["글로벌", ["글로벌", "세계", "월드", "ACWI", "선진국", "MSCI월드"]],
];

const STYLE_SECTOR_RULES: Array<[string, string[]]> = [
  ["커버드콜", ["커버드콜"]],
  ["액티브", ["액티브"]],
  ["배당", ["고배당", "월배당", "배당", "인컴"]],
];

const GICS_SECTOR_RULES: Array<[string, string[]]> = [
  ["헬스케어", ["헬스케어", "바이오", "의료", "제약", "HEALTH"]],
  ["에너지", ["에너지", "원유", "천연가스", "WTI", "석유", "가스"]],
  ["소재", ["소재", "철강", "구리", "리튬", "화학", "금현물", "금선물", "은선물", "은현물", "골드", "원자재", "농산물"]],
  ["산업재", ["산업재", "방산", "우주", "항공", "조선", "해운", "건설", "인프라", "운송", "기계"]],
  ["경기소비재", ["자동차", "자율주행", "화장품", "유통", "리테일", "게임", "엔터", "소비재"]],
  ["필수소비재", ["필수소비"]],
  ["금융", ["금융", "은행", "증권", "보험", "고배당금융"]],
  ["IT", ["반도체", "AI반도체", "필라델피아반도체", "HBM", "칩", "소프트웨어", "테크", "IT", "기술"]],
  ["커뮤니케이션", ["통신", "인터넷", "미디어", "콘텐츠", "SNS"]],
  ["유틸리티", ["유틸", "전력", "원전", "태양광", "풍력", "그리드"]],
  ["부동산", ["리츠", "부동산", "REIT"]],
];

const SECTOR_FALLBACK_RULES: Array<[string, string[]]> = [
  ["레버리지/인버스", ["레버리지", "인버스", "2X", "선물인버스"]],
  ["채권", ["채권", "국채", "회사채", "CD금리", "KOFR", "머니마켓", "단기채", "중장기", "금리"]],
  ["시장지수", ["200", "코스피", "코스닥", "KRX", "MSCI Korea", "KOSPI", "KOSDAQ", "S&P500", "나스닥100"]],
];

type NaverItem = {
  itemcode?: string;
  itemname?: string;
  etfTabCode?: number;
  nowVal?: number;
  nav?: number;
  changeRate?: number;
  threeMonthEarnRate?: number;
  marketSum?: number;
};

function matchLabel(name: string, rules: Array<[string, string[]]>): string | null {
  const upper = name.toUpperCase();
  for (const [label, keywords] of rules) {
    for (const kw of keywords) {
      if (upper.includes(kw.toUpperCase()) || name.includes(kw)) return label;
    }
  }
  return null;
}

function asFloat(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function classifySector(name: string, tab: number): string {
  for (const rules of [STYLE_SECTOR_RULES, GICS_SECTOR_RULES, SECTOR_FALLBACK_RULES]) {
    const hit = matchLabel(name, rules);
    if (hit) return hit;
  }
  return (
    (
      {
        1: "시장지수",
        2: "기타",
        3: "레버리지/인버스",
        4: "기타",
        5: "소재",
        6: "채권",
        7: "기타",
      } as Record<number, string>
    )[tab] || "기타"
  );
}

export function classifyNaverItem(item: NaverItem): EtfDbRow {
  const code = String(item.itemcode || "").trim();
  const name = String(item.itemname || "").trim();
  const tab = Number(item.etfTabCode || 0);
  const etfType = TYPE_BY_TAB[tab] || "기타";

  let country = matchLabel(name, COUNTRY_RULES);
  if (!country) {
    if (tab === 1 || tab === 2 || tab === 3) country = "한국";
    else if (tab === 4) country = "해외(기타)";
    else if (tab === 5) country = "원자재/기타";
    else if (tab === 6) {
      country = ["미국", "글로벌", "세계", "선진", "신흥", "중국", "일본", "유럽"].some((k) =>
        name.includes(k),
      )
        ? "해외채권"
        : "한국";
    } else country = "기타";
  }

  const sector = classifySector(name, tab);

  const nav = asFloat(item.nav);
  const price = asFloat(item.nowVal);
  const aum_eok = asFloat(item.marketSum) || 0;
  const aum_won = aum_eok * 1e8;
  const denom = nav && nav > 0 ? nav : price;
  const units = denom && denom > 0 ? aum_won / denom : null;

  return {
    code,
    name,
    tab_code: tab,
    type: etfType,
    country,
    sector,
    price,
    nav,
    change_rate: asFloat(item.changeRate),
    return_3m: asFloat(item.threeMonthEarnRate),
    aum_eok,
    units,
    flow_eok: null,
  };
}

export function aggregateRows(
  rows: EtfDbRow[],
  dimension: EtfDbDimension,
): EtfDbAggregate[] {
  const buckets = new Map<string, EtfDbAggregate>();
  for (const row of rows) {
    const key = String(row[dimension] || "기타");
    const bucket = buckets.get(key) || {
      label: key,
      count: 0,
      aum_eok: 0,
      aum_share_pct: 0,
      flow_eok: 0,
      flow_available: false,
    };
    bucket.count += 1;
    bucket.aum_eok += row.aum_eok || 0;
    if (row.flow_eok != null) {
      bucket.flow_eok = (bucket.flow_eok || 0) + row.flow_eok;
      bucket.flow_available = true;
    }
    buckets.set(key, bucket);
  }
  const total = [...buckets.values()].reduce((s, b) => s + b.aum_eok, 0) || 1;
  return [...buckets.values()]
    .map((b) => ({
      ...b,
      aum_share_pct: (100 * b.aum_eok) / total,
      flow_eok: b.flow_available ? b.flow_eok : null,
    }))
    .sort((a, b) => b.aum_eok - a.aum_eok);
}

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Merge live category AUM into snapshot history (replace/append today). */
export function mergeLiveAumHistory(
  base: EtfDbHistory | undefined,
  liveAggs: EtfDbAggregate[],
  liveDay: string,
): EtfDbHistory {
  const dates = [...(base?.dates || [])];
  const series: Record<string, Array<number | null>> = {};
  for (const [k, vals] of Object.entries(base?.series || {})) {
    series[k] = [...vals];
  }
  if (!series["전체"]) series["전체"] = dates.map(() => null);

  const liveTotal = liveAggs.reduce((s, a) => s + (a.aum_eok || 0), 0);
  if (dates.length && dates[dates.length - 1] === liveDay) {
    series["전체"][dates.length - 1] = liveTotal;
    const seen = new Set<string>(["전체"]);
    for (const a of liveAggs) {
      seen.add(a.label);
      if (!series[a.label]) series[a.label] = dates.map(() => null);
      series[a.label][dates.length - 1] = a.aum_eok;
    }
    for (const label of Object.keys(series)) {
      if (!seen.has(label)) series[label][dates.length - 1] = null;
    }
  } else {
    dates.push(liveDay);
    for (const label of Object.keys(series)) {
      series[label].push(null);
    }
    series["전체"][dates.length - 1] = liveTotal;
    for (const a of liveAggs) {
      if (!series[a.label]) {
        series[a.label] = Array.from({ length: dates.length - 1 }, () => null);
        series[a.label].push(a.aum_eok);
      } else {
        series[a.label][dates.length - 1] = a.aum_eok;
      }
    }
  }

  const ranked = Object.keys(series)
    .filter((k) => k !== "전체")
    .sort((a, b) => {
      const sa = series[a].slice(-10).reduce<number>((s, v) => s + (v ?? 0), 0);
      const sb = series[b].slice(-10).reduce<number>((s, v) => s + (v ?? 0), 0);
      return sb - sa;
    });
  // Keep top series + every live label so category clicks always have a series key.
  const liveLabels = liveAggs.map((a) => a.label);
  const keep = Array.from(new Set(["전체", ...ranked.slice(0, 12), ...liveLabels]));
  return {
    dates,
    series: Object.fromEntries(keep.filter((k) => series[k]).map((k) => [k, series[k]])),
  };
}

export function buildPayloadFromNaver(
  items: NaverItem[],
  opts?: {
    flowByCode?: Record<string, number>;
    prevAsOf?: string | null;
    flowHistory?: EtfDbPayload["flow_history"];
    aumHistory?: EtfDbPayload["aum_history"];
    equityOnly?: boolean;
  },
): EtfDbPayload {
  const flowByCode = opts?.flowByCode || {};
  let rows = items
    .map(classifyNaverItem)
    .map((row) => {
      const flow = flowByCode[row.code];
      return flow == null ? row : { ...row, flow_eok: flow };
    })
    .sort((a, b) => (b.aum_eok || 0) - (a.aum_eok || 0));

  if (opts?.equityOnly) {
    rows = rows.filter(isEquityEtf);
  }
  const now = new Date();
  const display = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const day = todayKst();

  const emptyHist: EtfDbHistory = { dates: [], series: {} };
  const aggregates = {
    type: aggregateRows(rows, "type"),
    country: aggregateRows(rows, "country"),
    sector: aggregateRows(rows, "sector"),
  };

  const aum_history = {
    type: mergeLiveAumHistory(
      opts?.equityOnly ? undefined : opts?.aumHistory?.type,
      aggregates.type,
      day,
    ),
    country: mergeLiveAumHistory(
      opts?.equityOnly ? undefined : opts?.aumHistory?.country,
      aggregates.country,
      day,
    ),
    sector: mergeLiveAumHistory(
      opts?.equityOnly ? undefined : opts?.aumHistory?.sector,
      aggregates.sector,
      day,
    ),
  };

  return {
    ok: true,
    generated_at: now.toISOString(),
    generated_at_display: `${display} KST`,
    source: "https://finance.naver.com/api/sise/etfItemList.nhn",
    as_of: day,
    count: rows.length,
    total_aum_eok: rows.reduce((s, r) => s + (r.aum_eok || 0), 0),
    prev_as_of: opts?.prevAsOf ?? null,
    equity_only: Boolean(opts?.equityOnly),
    aggregates,
    flow_history: opts?.flowHistory || {
      type: emptyHist,
      country: emptyHist,
      sector: emptyHist,
    },
    aum_history,
    rows,
  };
}

export function fmtEok(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 10000) {
    return `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조`;
  }
  return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`;
}

export function fmtSignedEok(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtEok(n)}`;
}

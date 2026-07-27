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

export type EtfDbPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  count: number;
  total_aum_eok: number;
  prev_as_of: string | null;
  aggregates: Record<EtfDbDimension, EtfDbAggregate[]>;
  flow_history: Record<
    EtfDbDimension,
    { dates: string[]; series: Record<string, Array<number | null>> }
  >;
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

const SECTOR_RULES: Array<[string, string[]]> = [
  ["반도체/AI", ["AI반도체", "반도체", "필라델피아반도체", "칩", "HBM"]],
  ["2차전지", ["2차전지", "배터리", "리튬", "전기차"]],
  ["바이오/헬스케어", ["바이오", "헬스케어", "의료", "제약"]],
  ["방산/우주", ["방산", "우주", "항공"]],
  ["자동차", ["자동차", "자율주행"]],
  ["금융", ["은행", "증권", "보험", "금융", "고배당금융"]],
  ["에너지/유틸", ["에너지", "원전", "전력", "유틸", "태양광", "풍력", "천연가스", "원유"]],
  ["소비/유통", ["소비", "유통", "화장품", "필수소비", "리테일"]],
  ["미디어/게임", ["미디어", "게임", "엔터", "콘텐츠", "인터넷"]],
  ["건설/인프라", ["건설", "인프라", "철강", "조선", "해운"]],
  ["부동산/리츠", ["리츠", "부동산", "REITs"]],
  ["배당", ["고배당", "배당", "월배당", "커버드콜", "인컴"]],
  ["레버리지/인버스", ["레버리지", "인버스", "2X", "선물인버스"]],
  ["채권/금리", ["채권", "국채", "회사채", "CD금리", "KOFR", "머니마켓", "단기채", "중장기", "금리"]],
  ["원자재", ["금", "은", "구리", "원유", "농산물", "원자재", "골드", "은선물"]],
  ["시장지수", ["200", "코스피", "코스닥", "KRX", "MSCI Korea", "KOSPI", "KOSDAQ"]],
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

  let sector = matchLabel(name, SECTOR_RULES);
  if (!sector) {
    sector =
      (
        {
          1: "시장지수",
          2: "국내테마(기타)",
          3: "레버리지/인버스",
          4: "해외주식(기타)",
          5: "원자재",
          6: "채권/금리",
          7: "기타",
        } as Record<number, string>
      )[tab] || "기타";
  }

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

export function buildPayloadFromNaver(
  items: NaverItem[],
  opts?: {
    flowByCode?: Record<string, number>;
    prevAsOf?: string | null;
    flowHistory?: EtfDbPayload["flow_history"];
  },
): EtfDbPayload {
  const flowByCode = opts?.flowByCode || {};
  const rows = items
    .map(classifyNaverItem)
    .map((row) => {
      const flow = flowByCode[row.code];
      return flow == null ? row : { ...row, flow_eok: flow };
    })
    .sort((a, b) => (b.aum_eok || 0) - (a.aum_eok || 0));

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

  const emptyHist = { dates: [] as string[], series: {} as Record<string, Array<number | null>> };

  return {
    ok: true,
    generated_at: now.toISOString(),
    generated_at_display: `${display} KST`,
    source: "https://finance.naver.com/api/sise/etfItemList.nhn",
    count: rows.length,
    total_aum_eok: rows.reduce((s, r) => s + (r.aum_eok || 0), 0),
    prev_as_of: opts?.prevAsOf ?? null,
    aggregates: {
      type: aggregateRows(rows, "type"),
      country: aggregateRows(rows, "country"),
      sector: aggregateRows(rows, "sector"),
    },
    flow_history: opts?.flowHistory || {
      type: emptyHist,
      country: emptyHist,
      sector: emptyHist,
    },
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

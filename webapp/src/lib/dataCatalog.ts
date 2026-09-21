/**
 * Canonical inventory of durable SavvyETF datasets.
 * Live object counts come from R2; this file is the retention / insight contract.
 * Human map (Obsidian vault): `obsidian/` — open that folder as a vault.
 */

export type DatasetKind = "timeseries" | "latest" | "rolling";
export type DatasetGroup = "etf" | "news" | "briefs" | "monitor" | "ops";

export type DatasetSpec = {
  id: string;
  label: string;
  group: DatasetGroup;
  kind: DatasetKind;
  prefixes: string[];
  hotWindow: string;
  archive: string;
  volatile: boolean;
  insight: string;
  viewTab?: string;
};

export const DATA_CATALOG: DatasetSpec[] = [
  {
    id: "etf_db",
    label: "한국 상장 ETF DB",
    group: "etf",
    kind: "timeseries",
    prefixes: ["etf_db/latest.json", "etf_db/snapshots/", "etf_db/archive/"],
    hotWindow: "일별 스냅샷 최근 90일 (수급 계산용)",
    archive: "90일 초과분은 etf_db/archive/로 이동. 삭제하지 않음",
    volatile: false,
    insight: "NAV×Δ설정좌수 추정 수급. 자금흐름 모니터(OI·거래대금)와 합산하지 말 것",
    viewTab: "etfdb",
  },
  {
    id: "etf_db_us",
    label: "미국 상장 ETF DB",
    group: "etf",
    kind: "timeseries",
    prefixes: ["etf_db_us/latest.json", "etf_db_us/snapshots/"],
    hotWindow: "일별 스냅샷 전량 유지",
    archive: "아직 prune 없음. 스냅샷 prefix가 곧 아카이브",
    volatile: false,
    insight: "NAV×Δshares 수급 + 거래대금. 카테고리 히스토리 일부는 Yahoo로 재구성",
    viewTab: "etfdbus",
  },
  {
    id: "nlp_history",
    label: "종목 뉴스 감성 (NLP)",
    group: "news",
    kind: "timeseries",
    prefixes: ["nlp_history/"],
    hotWindow: "종목 JSON: 점수 전 기간 + 최근 30일 제목 전체",
    archive: "30일 이전 제목은 nlp_history/headlines/{code}/{YYYY-MM}.json (같은 prefix 아래)",
    volatile: false,
    insight: "렉시콘 점수(−100~+100). 기사 본문은 없음. 증시 종합기사는 제외",
    viewTab: "nlp",
  },
  {
    id: "briefs",
    label: "시황 브리프",
    group: "briefs",
    kind: "rolling",
    prefixes: [
      "briefs/kr/",
      "briefs/us/",
      "briefs/etf/",
      "briefs/esg/",
    ],
    hotWindow: "슬롯 latest + history 최근 5버전",
    archive: "초과 history는 briefs/{tab}/archive/{slot}/ 로 이동",
    volatile: false,
    insight: "가공된 시황 HTML. 원본 뉴스 코퍼스가 아님",
    viewTab: "kr",
  },
  {
    id: "etf_weights",
    label: "ETF 편입비 모니터",
    group: "etf",
    kind: "timeseries",
    prefixes: ["etf_weights/"],
    hotWindow: "티커별 latest + 일자 스냅샷",
    archive: "스냅샷 유지 (자동 삭제 없음)",
    volatile: false,
    insight: "Roundhill/iShares 편입비 변화. 수급 계정과 별개",
    viewTab: "etfweights",
  },
  {
    id: "kosdaq_active",
    label: "코스닥 액티브 ETF",
    group: "etf",
    kind: "timeseries",
    prefixes: ["kosdaq_active/"],
    hotWindow: "펀드별 latest + 일자 스냅샷",
    archive: "스냅샷 유지 (자동 삭제 없음)",
    volatile: false,
    insight: "PDF 스냅샷 기반 편입·성과 비교",
    viewTab: "kosdaqactive",
  },
  {
    id: "country_etf",
    label: "국가 ETF",
    group: "etf",
    kind: "timeseries",
    prefixes: ["country_etf/"],
    hotWindow: "티커별 latest + 일자 스냅샷",
    archive: "스냅샷 유지 (자동 삭제 없음)",
    volatile: false,
    insight: "국가/지역 ETF 노출. 한국 ETF DB 국가 차원과 별 시계열",
    viewTab: "countryetf",
  },
  {
    id: "money_flow",
    label: "글로벌 자금 흐름",
    group: "monitor",
    kind: "timeseries",
    prefixes: ["money_flow/latest.json", "money_flow/snapshots/"],
    hotWindow: "latest + 일별 스냅샷 (1m 페이로드)",
    archive: "스냅샷 전량 유지 (파일 작아서 prune 없음)",
    volatile: false,
    insight: "Flow/Position/Activity/Liquidity를 서로 합산하지 말 것",
    viewTab: "moneyflow",
  },
  {
    id: "cftc",
    label: "CFTC 포지션",
    group: "monitor",
    kind: "timeseries",
    prefixes: ["cftc/latest_v2.json", "cftc/snapshots/"],
    hotWindow: "latest + 일별 스냅샷",
    archive: "스냅샷 전량 유지",
    volatile: false,
    insight: "Managed money net. Position 패밀리. ETF 수급과 합산 금지",
    viewTab: "cftc",
  },
  {
    id: "credit_monitor",
    label: "신용·자금 (FreeSIS)",
    group: "monitor",
    kind: "timeseries",
    prefixes: ["credit_monitor/latest.json", "credit_monitor/snapshots/"],
    hotWindow: "latest + 일별 스냅샷",
    archive: "스냅샷 전량 유지",
    volatile: false,
    insight: "국내 신용잔고·증시자금",
    viewTab: "kr",
  },
  {
    id: "kosdaq100",
    label: "코스닥100 모니터",
    group: "monitor",
    kind: "timeseries",
    prefixes: [
      "kosdaq100/latest.json",
      "kosdaq100/snapshots/",
      "kosdaq100/fundamentals/latest.json",
      "kosdaq100/fundamentals/snapshots/",
    ],
    hotWindow: "latest + 일별 스냅샷",
    archive: "스냅샷 전량 유지",
    volatile: false,
    insight: "구성종목 스냅샷 + 펀더멘털. NLP 유니버스와 겹침",
    viewTab: "kosdaqactive",
  },
  {
    id: "esg_events",
    label: "ESG 이벤트",
    group: "monitor",
    kind: "timeseries",
    prefixes: ["esg_events/latest.json", "esg_events/snapshots/"],
    hotWindow: "latest + 일별 스냅샷",
    archive: "스냅샷 전량 유지",
    volatile: false,
    insight: "공시·사고 모니터. 시황 브리프 ESG 슬롯과 별도 객체",
    viewTab: "esg",
  },
  {
    id: "us_midterm",
    label: "미 중간선거",
    group: "monitor",
    kind: "timeseries",
    prefixes: ["us-midterm/latest.json", "us-midterm/snapshots/"],
    hotWindow: "latest + 일별 스냅샷",
    archive: "스냅샷 전량 유지",
    volatile: false,
    insight: "예측시장·테마 노출",
    viewTab: "usmidterm",
  },
  {
    id: "scheduler",
    label: "스케줄러 슬롯",
    group: "ops",
    kind: "latest",
    prefixes: ["scheduler/slots.json"],
    hotWindow: "운영 상태",
    archive: "해당 없음",
    volatile: false,
    insight: "적재 성공 여부 점검용. 시세 데이터가 아님",
  },
];

export const DATA_CATALOG_GROUPS: Record<DatasetGroup, string> = {
  etf: "ETF",
  news: "뉴스·NLP",
  briefs: "시황 브리프",
  monitor: "모니터",
  ops: "운영",
};

export type DatasetLiveStats = {
  objects: number;
  bytes: number;
  firstKey: string | null;
  lastKey: string | null;
  firstDay: string | null;
  lastDay: string | null;
  samples: string[];
};

export type CatalogDatasetRow = DatasetSpec & {
  live: DatasetLiveStats;
};

export type DataCatalogPayload = {
  ok: boolean;
  r2: boolean;
  generated_at: string;
  bucket: string | null;
  totals: { objects: number; bytes: number; volatile: number };
  datasets: CatalogDatasetRow[];
  error?: string;
};

export function emptyLiveStats(): DatasetLiveStats {
  return {
    objects: 0,
    bytes: 0,
    firstKey: null,
    lastKey: null,
    firstDay: null,
    lastDay: null,
    samples: [],
  };
}

export function ymdFromKey(key: string): string | null {
  const m = key.match(/(20\d{2}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

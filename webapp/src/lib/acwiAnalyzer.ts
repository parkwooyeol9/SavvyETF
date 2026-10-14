/**
 * ACWI 종목 분석기 (포트폴리오 › ACWI, 관리자 전용).
 * 데이터는 Claude_DB/factor/analyzer.py → export_webapp.py 가 R2 에 봉인해 올린다.
 * 종목 레코드의 짧은 키는 analyzer.py 의 KEYS 가 원본이다.
 */

/** 숫자 필드 (analyzer.py KEYS). 단위: 수익률·괴리·리비전 %, w 는 비중(0~1), cap 은 백만 USD. */
export type AcwiNumKey =
  | "w" | "cap" | "pxu"
  | "pe" | "pb" | "dy" | "roe" | "fcf" | "de" | "eg" | "eg26" | "sg" | "dg"
  | "eps" | "bps" | "dps"
  | "fv" | "fs" | "fd" | "fg" | "fm" | "fq" | "z" | "rk" | "srk" | "pc"
  | "r1w" | "r1m" | "r3m" | "r6m" | "r12m" | "ytd" | "mom"
  | "vol" | "vol3" | "mdd" | "dd52" | "up52" | "ma20" | "ma50" | "ma200" | "gold" | "xd" | "xa"
  | "rsi" | "mh" | "mxd" | "bb" | "beta" | "corr" | "rel3" | "rel12" | "ts"
  | "er1" | "er3" | "er6" | "er12" | "erd" | "e24" | "bg" | "dg12" | "cuts"
  | "pep" | "pbp" | "dyp" | "pez" | "pem"
  | "tail" | "wr"
  // 2026-10-06: 거래량·매출 추정치·10년 밸류 위치
  | "liq" | "vr" | "vz" | "obv" | "sv1" | "sv3" | "sv12" | "svd" | "pep10" | "pbp10" | "dyp10" | "pem10" | "ec5";

/** 문자 필드: ms = MSCI 상태("구성 …"/"편출 …"), sr/er = 편입·편출 리뷰, since/ee = 효력일, xr = 팩터 제외 사유. */
export type AcwiStrKey =
  | "n" | "ct" | "rg" | "s" | "ind" | "isin" | "ef" | "tr"
  | "ms" | "since" | "sr" | "er" | "ee" | "flag" | "xr"
  /** 최상위 모회사 본사 국가 (TR.UltimateParentCountryHQ, 참고용 — 팩터 중립화는 상장 기준 ct 사용) */
  | "hq";

export type AcwiStock = { c: string; susp?: boolean } & Partial<Record<AcwiNumKey, number>> &
  Partial<Record<AcwiStrKey, string>>;

export type AcwiBreadthRow = { g: string } & Record<string, number | string | null>;

export type AcwiEventRow = {
  code: string;
  name?: string;
  country?: string;
  region?: string;
  sector_ko?: string;
  action: "ADD" | "DEL";
  review: string;
  car_pre?: number | null;
  car_ann?: number | null;
  car_run?: number | null;
  car_close?: number | null;
  car_post?: number | null;
};

export type AcwiReview = { review: string; announce: string; effective: string };

export type AcwiSummary = {
  meta: {
    as_of: string;
    built_at: string;
    source: string;
    ri_last: string;
    est_last: string;
    anchor_review: string;
    latest_review: string;
    next_reviews: AcwiReview[];
    factors: Record<string, { label: string; descriptors: string[] }>;
    watch_validation: Record<string, number>;
    bench_r12m?: number;
    bench_r3m?: number;
  };
  quality: Record<string, unknown> & {
    n_scored: number;
    jump_stocks?: Record<string, number[]>;
    last_day_jumps?: string[];
    suspended?: string[];
  };
  stocks: AcwiStock[];
  /** months: 10년 월간(2026-10 파일부터). bench_m: 월간 벤치마크(마지막=1,000) */
  series: { weeks: string[]; months: string[]; bench: (number | null)[]; bench_m?: (number | null)[] };
  breadth: { region: AcwiBreadthRow[]; sector: AcwiBreadthRow[]; country: AcwiBreadthRow[] };
  events: {
    per: AcwiEventRow[];
    path_ann: Record<string, (number | null)[] | number>;
    path_eff: Record<string, (number | null)[] | number>;
    pre: number;
    post: number;
    by_review: (Record<string, number | string | null> & { action: string; review: string })[];
    all: Record<string, Record<string, number | null>>;
    by_region: (Record<string, number | string | null> & { action: string; region: string })[];
  };
  pending: (Record<string, string | number | null> & { action: string; review: string; code?: string; name?: string })[];
  reviews: (Record<string, number | string | null> & { review: string })[];
};

/** ri = 주간 3년, rim = 월간 10년 총수익지수(마지막=1,000), sal = 월간 매출 NTM. 나머지는 월간(months 축). */
export type AcwiSeries = Partial<Record<"ri" | "rim" | "eps" | "bps" | "dps" | "sal" | "pe", (number | null)[]>>;

// ───────── 팩터 백테스트 (Claude_DB/factor/backtest.py → private/acwi/latest/backtest.bin) ─────────
export type BtPerf = {
  cagr?: number; vol?: number; sharpe?: number; mdd?: number; hit?: number; best?: number; worst?: number; months?: number;
  excess?: number; te?: number; ir?: number; hit_vs_bench?: number;
};
export type BtIc = { ic_mean?: number; ic_sd?: number; icir?: number; ic_t?: number; ic_hit?: number };
export type BtSignalResult = {
  /** 5분위 월간 수익률 (Q1 = 점수 최상위), 소수 */
  q: (number | null)[][];
  ls: (number | null)[];
  ic: (number | null)[];
  /** Q1 편입 종목 교체 비율 (월, 0~1) */
  to: (number | null)[];
  stats_q: BtPerf[];
  stats_ls: BtPerf;
  ic_stats: BtIc;
  to_mean: number | null;
  spread_mono: number;
};
export type BtRegionResult = {
  bench_ew: (number | null)[];
  bench_cw: (number | null)[];
  bench_ew_stats: BtPerf;
  bench_cw_stats: BtPerf;
  n: number[];
  sig: Record<string, BtSignalResult>;
};
export type BtMode = "pit" | "pit_large" | "static";
export type AcwiBacktest = {
  meta: {
    built_at: string; source: string; start: string; end: string; n_months: number; lag_months: number; nq: number;
    currency: string; rebalance: string; regions: string[]; diag?: Record<string, number>;
  };
  dates: string[];
  signals: { key: string; label: string; kind: "factor" | "preset" | "descriptor"; desc?: string[]; weights?: Record<string, number> }[];
  results: Record<BtMode, Record<string, BtRegionResult>>;
  factor_corr: { keys: string[]; labels: string[]; m: number[][] };
  coverage: { date: string; n_pit: number; n_static: number; n_pit_large: number; members_upper: number | null; members_confirmed: number | null }[];
};

// ───────── 국가·업종·테마 집계 (Claude_DB/factor/groups.py → private/acwi/latest/groups.bin) ─────────
/** pe·pb·ps 배, dy·roe %, eg·sg·er1·er3 % (같은 종목 묶음 변화율), tr 총수익 지수(시작=100). */
export type GroupMetricKey = "pe" | "pb" | "ps" | "dy" | "roe" | "eg" | "sg" | "er1" | "er3" | "tr";
/** cmp = ETF 비교선 전용 ACWI 그룹 (표에는 안 나옴) */
export type GroupDim = "region" | "country" | "sector" | "igroup" | "industry" | "theme" | "etf" | "cmp";
export type AcwiGroup = {
  id: string;
  dim: GroupDim;
  /** 섹터만: 범위(ACWI·미국·신흥·국가 …) */
  scope: string | null;
  key: string;
  label: string;
  desc?: string;
  /** 구성 종목 수 */
  n: number;
  /** ACWI 내 비중 % */
  w: number | null;
  /** 컨센서스 연도 성장률 %: eg26 = EPS CY26/CY25, eg27 = CY27/CY26, sg = 매출. peg = PER ÷ eg27 (ETF 만) */
  cy: Partial<Record<"eg26" | "eg27" | "sg26" | "sg27" | "peg", number>>;
  /** 비중 큰 순 */
  codes: string[];
  /** ETF 룩스루만: codes 와 같은 순서의 ETF 내 비중 % */
  wts?: (number | null)[];
  /** ETF 만: 운용사·보유종목 기준일(근사는 null)·ACWI 로 덮은 주식 비중 %·비교할 ACWI 그룹 id·방법 */
  etf?: {
    ticker: string;
    issuer: string;
    asof: string | null;
    coverage: number | null;
    n_holdings: number;
    compare: string | null;
    method?: "보유종목" | "ACWI 근사";
  };
};
export type AcwiGroupSeries = Partial<Record<GroupMetricKey | "cov", (number | null)[]>> & { n?: number[] };
export type AcwiGroups = {
  meta: {
    built_at: string;
    as_of: string;
    source: string;
    months: string[];
    n_stocks: number;
    metrics: { key: GroupMetricKey; label: string; unit: string; desc: string; dir: -1 | 0 | 1 }[];
    dims: { key: GroupDim; label: string }[];
    sector_scopes: string[];
    /** ETF 분류 (국가·지역·섹터(미국)·섹터(글로벌)·산업·테마) */
    etf_scopes?: string[];
    themes: { key: string; label: string; desc: string }[];
    quality: Record<string, unknown>;
  };
  groups: AcwiGroup[];
  series: Record<string, AcwiGroupSeries>;
  /** 종목 → 산업그룹(ig)·테마 키(th). ETF 밸류에이션 공개분은 이름(n)·국가(ct)도 */
  stocks: Record<string, { ig?: string; th?: string[]; n?: string; ct?: string }>;
};

/**
 * 밸류에이션 탭 (Claude_DB/factor/etf_valuation.py → private/acwi/latest/etf_valuation.bin, 공개 API).
 * AcwiGroups 와 같은 모양: groups 의 dim 은 "etf"(scope = 분류) 와 "cmp"(비교선).
 */
export type EtfValuation = AcwiGroups & {
  meta: AcwiGroups["meta"] & {
    n_etfs: number;
    quality: { unavailable?: { ticker: string; label: string; reason: string }[]; n_holdings_based?: number; n_proxy?: number } & Record<
      string,
      unknown
    >;
  };
};
/** 관리자 전용: 구성종목 지표 (AcwiStock 과 같은 짧은 키) */
export type EtfValuationStocks = Record<string, Partial<Record<"pe" | "pb" | "dy" | "roe" | "eg" | "sg" | "er3" | "r12m" | "pep10" | "w", number>> & { n?: string; ct?: string; s?: string }>;

/** 비로그인 공개분: 집계 백테스트 + MSCI 리뷰 일정만. 종목별 값·구성/비중은 없다. */
export type AcwiPublic = {
  backtest: AcwiBacktest;
  as_of: string;
  next_reviews: AcwiReview[];
};

export type AcwiApiResponse<T> = { ok: boolean; data?: T; error?: string };

export const ACWI_SERIES_BUCKETS = 32;

/** Claude_DB/factor/export_webapp.py series_bucket 과 같은 규칙. */
export function seriesBucket(code: string): number {
  let sum = 0;
  for (const ch of code) sum += ch.codePointAt(0) ?? 0;
  return sum % ACWI_SERIES_BUCKETS;
}

export const ACWI_FACTORS: [AcwiNumKey, string][] = [
  ["fv", "가치"],
  ["fs", "사이즈"],
  ["fd", "배당"],
  ["fg", "성장"],
  ["fm", "모멘텀"],
  ["fq", "퀄리티"],
];

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmt(v: unknown, d = 1, suf = ""): string {
  return isNum(v)
    ? v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }) + suf
    : "–";
}

export function fmtCap(v: unknown): string {
  if (!isNum(v)) return "–";
  return v >= 1e6 ? fmt(v / 1e6, 2, "조$") : v >= 1e3 ? fmt(v / 1e3, 1, "십억$") : fmt(v, 0, "백만$");
}

/** 표 셀 배경: 상승 빨강·하락 파랑, (lo+hi)/2 기준 대칭. */
export function heatStyle(v: unknown, lo: number, hi: number, invert = false): { background?: string } {
  if (!isNum(v)) return {};
  let t = Math.max(-1, Math.min(1, (v - (lo + hi) / 2) / ((hi - lo) / 2)));
  if (invert) t = -t;
  const col = t >= 0 ? "var(--aa-pos)" : "var(--aa-neg)";
  return { background: `color-mix(in srgb, ${col} ${Math.round(Math.abs(t) * 32)}%, transparent)` };
}

export function sma(a: (number | null)[], n: number): (number | null)[] {
  return a.map((_, i) => {
    if (i < n - 1) return null;
    let s = 0;
    let c = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const v = a[k];
      if (isNum(v)) {
        s += v;
        c++;
      }
    }
    return c >= n * 0.8 ? s / c : null;
  });
}

export function ddayFrom(asOf: string, d: string): number {
  return Math.round((Date.parse(`${d}T00:00:00+09:00`) - Date.parse(`${asOf}T00:00:00+09:00`)) / 86_400_000);
}

export const isDeleted = (s: AcwiStock) => (s.ms ?? "").startsWith("편출");

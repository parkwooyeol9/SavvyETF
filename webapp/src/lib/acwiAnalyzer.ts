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

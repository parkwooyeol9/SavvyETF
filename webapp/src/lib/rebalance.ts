/**
 * ETF 정기변경(리밸런싱) 예상 수급 — `Claude_Work/rebalance/build.py` 출력 스키마.
 * R2 `rebalance/latest.json` 과 번들 `rebalanceSnapshot.json` 이 같은 모양.
 */

export type RebalanceStatus = "past" | "upcoming";

export type FlowStatus = "ok" | "no_holdings" | "no_rule" | "rule_unknown" | "no_aum" | "no_event";

export type RebalanceTradeDay = {
  trade_date: string;
  status: RebalanceStatus;
  etfs: string[];
  aum_eok: number;
  has_index: boolean;
  expiry_same_day?: boolean;
  /** 지수 행을 뺀 ETF 수 · 예상 매매가 계산된 ETF · 그 순자산 합 · 순자산 기준 반영률(%) */
  n_etfs?: number;
  computed_etfs?: string[];
  computed_aum_eok?: number;
  coverage_aum_pct?: number | null;
};

export type RebalanceEvent = {
  etf_code: string;
  etf_name: string;
  issuer?: string | null;
  kind: "etf" | "index";
  theme?: string | null;
  aum_eok: number | null;
  rule: string;
  rule_label: string;
  expiry: string;
  effective: string;
  trade_date: string;
  status: RebalanceStatus;
  holiday_list_ok: boolean;
  /** 방법론상 여러 영업일에 걸친 개편이면 "1/2", "2/2" (순자산은 날짜 수로 나눈 몫) */
  split?: string;
};

export type RebalanceEtf = {
  code: string;
  name: string;
  issuer?: string | null;
  kind: "etf" | "index";
  theme?: string | null;
  index?: string | null;
  months?: number[];
  rule?: string | null;
  rule_label: string;
  cap_pct: number | null;
  aum_eok: number | null;
  aum_as_of?: string | null;
  holdings_as_of?: string | null;
  next_trade_date: string | null;
  next_effective: string | null;
  flow_status: FlowStatus;
  notes: string[];
  /** 확인되지 않은 입력: "months" | "rule" | "weighting" | "effective_date" | "constituents" */
  unverified?: string[];
  /** 운용사 표현대로 읽은 대안 효력일·매매일 (기본과 다를 때만) */
  alt_rule?: string | null;
  alt_rule_label?: string | null;
  next_trade_date_alt?: string | null;
  next_effective_alt?: string | null;
  /** 종목 선정 기준일 · 목표 비중 확정일 (지수 방법론 원문 기준, 없으면 미확인) */
  selection_date?: string | null;
  weight_fix_date?: string | null;
  method_source?: { label: string; url: string } | null;
};

export type RebalanceTrade = {
  code: string;
  name: string;
  current_pct: number;
  target_pct: number;
  delta_pct: number;
  amount_eok: number;
};

export type RebalanceFlow = {
  etf_code: string;
  etf_name: string;
  trade_date: string;
  effective: string;
  alt_trade_date?: string | null;
  split_index?: number;
  split_n?: number;
  scenario_id: string;
  scenario_label: string;
  scenario_note?: string;
  capped_by_mcap?: string[];
  primary: boolean;
  aum_eok: number;
  holdings_as_of?: string | null;
  holdings_source?: string | null;
  coverage_pct: number;
  buy_eok: number;
  sell_eok: number;
  trades: RebalanceTrade[];
};

export type RebalanceImpact = {
  trade_date: string;
  code: string;
  name: string;
  buy_eok: number;
  sell_eok: number;
  net_eok: number;
  adv_eok: number | null;
  impact_ratio: number | null;
  impact_level: "high" | "mid" | "low" | "unknown";
  by_etf: { etf_code: string; etf_name: string; amount_eok: number }[];
};

export type EventStudyRow = {
  event_id: string;
  label: string;
  trade_date: string;
  confidence: string;
  code: string;
  name: string;
  market: string;
  side: "buy" | "sell";
  flow_eok: number | null;
  adv_eok: number | null;
  impact_ratio?: number;
  car_pre: number | null;
  ar_0: number | null;
  car_post: number | null;
  car_path: number[];
};

type SideStats = {
  n: number;
  car_pre: number | null;
  ar_0: number | null;
  car_post: number | null;
};

export type EventStudy = {
  generated_at: string;
  params: { pre: number; hold: number; path_from: number; path_to: number; model: string; price_source: string };
  summary: { n: number; n_events: number; by_side: { buy: SideStats; sell: SideStats } };
  paths: { t: number; buy: number | null; sell: number | null }[];
  rows: EventStudyRow[];
};

export type BrokerEstimate = {
  source: string;
  date: string;
  basis?: string;
  items: { code: string; name: string; amount_eok: number; note?: string }[];
};

export type WhitepaperRowTuple = [
  name: string,
  code: string,
  pre_w: number,
  post_w: number,
  dw: number,
  flow: number,
  adv: number | null,
  imp: number | null,
  mcap: number | null,
  status: string,
  float_pct?: number | null,
  close_px?: number | null,
];

export type WhitepaperEvent = {
  date: string;
  dates: string[];
  turn: number;
  aum: number;
  buy: number;
  sell?: number;
  nin: number | null;
  nout: number | null;
  irr: boolean;
  fc?: boolean;
  tier?: "A" | "B" | "C";
  hi: number | null;
  mid: number | null;
  max: [string, number] | null;
  fx?: number;
  range?: [number, number, number] | null;
  turn_range?: [number, number, number] | null;
  assume?: string;
  cands?: { add: [string, number | null][]; del: [string, number | null][] } | null;
  scheme?: string;
  fit_dist?: number;
  conf_w?: string;
  conf_s?: string;
  sel_note?: string;
  target_note?: string;
  adds?: string[];
  dels?: string[];
  buy_1014?: number | null;
  turn_1014?: number | null;
  range_1014?: [number, number, number] | null;
  turn_range_1014?: [number, number, number] | null;
  assume_1014?: string | null;
  rows: WhitepaperRowTuple[];
};

export type WhitepaperMethod = {
  provider: string;
  freq: string;
  timing: string;
  weight: string;
  source: string;
  verified: boolean;
  extra?: string;
};

export type WhitepaperGroup = {
  id: string;
  short: string;
  title: string;
  family: string;
  market: "KR" | "US";
  members: [code: string, name: string, aum_jo: number][];
  method: WhitepaperMethod;
  next: string | null;
  pdf: string;
  events: WhitepaperEvent[];
  aum_hist: number[];
};

export type AddendumStockRow = {
  name: string;
  code: string;
  w0: number;
  w1: number;
  dw: number;
  flow: number;
  adv: number | null;
  imp: number | null;
  status: string;
  float: number | null;
  close: number | null;
};

export type AddendumEvent = {
  gid: string;
  short: string;
  date: string;
  label: string;
  aum_jo: number;
  members: string[];
  pdf_date: string;
  scheme: string;
  fit_dist: number;
  fit_date: string;
  range?: boolean;
  sel_note: string;
  target_note: string;
  n_add: number;
  n_del: number;
  adds: string[];
  dels: string[];
  turn: number;
  buy: number;
  sell: number;
  buy_range?: [number, number];
  n30: number;
  buys: AddendumStockRow[];
  sells: AddendumStockRow[];
  conf_w: string;
  conf_s: string;
  /** 매매일이 지나 직전 계산값을 유지 / 오늘 계산 실패로 직전 값 사용 */
  frozen?: boolean;
  stale?: boolean;
};

export type CombinedStockRow = {
  name: string;
  code: string;
  flow: number;
  adv: number | null;
  groups: string[];
  imp: number | null;
};

export type EtfRankRow = {
  code: string;
  name: string;
  aum_eok: number;
  tv20_eok: number;
  tv1_eok: number;
  rank_tv?: number;
};

export type TvGroupRow = {
  gid: string;
  short: string;
  aum_eok: number;
  events: string;
  cycle: string;
  scheme: string;
  nov_dec: string;
};

export type AppendixCompareRow = {
  gid: string;
  short: string;
  date: string;
  scheme: string;
  fit: number;
  conf_w: string;
  conf_s: string;
  old_tier: string;
  old_buy: number | null;
  new_buy: number | null;
  new_range: [number, number] | null;
  new_turn: number;
  hist_last_buy: number | null;
  hist_last_date: string | null;
  hist_turn: [number, number] | null;
};

/** R2 rebalance/whitepaper_live.json (봇 wp_forecast.py) */
export type WhitepaperLiveDoc = {
  as_of: string;
  generated_at: string;
  float_asof?: string;
  events: (AddendumEvent & { all?: AddendumStockRow[] })[];
  combined: { buys: CombinedStockRow[]; sells: CombinedStockRow[] };
  combined_window?: [string, string];
  errors?: string[];
};

export type WhitepaperLiveMeta =
  | { source: "r2"; as_of: string; generated_at: string; float_asof?: string; errors: string[]; bundled_as_of: string }
  | { source: "bundled"; reason: string };

export type RebalanceWhitepaper = {
  /** 국내 그룹 예상 기준일 (R2 매일 갱신분이 있으면 그 날짜) */
  live?: WhitepaperLiveMeta;
  as_of: string;
  hist_as_of: string;
  months: string[];
  groups: WhitepaperGroup[];
  addendum: {
    asof: string;
    events: AddendumEvent[];
    combined: {
      buys: CombinedStockRow[];
      sells: CombinedStockRow[];
    };
    rank: {
      asof: string;
      by_aum: EtfRankRow[];
      by_tv: EtfRankRow[];
      all: EtfRankRow[];
    };
    tv_groups: TvGroupRow[];
    tv_lead: string;
    tv_bullets: string[];
  };
  appendix: {
    compare: AppendixCompareRow[];
    counts: {
      pdf_files: number;
      wise: number;
      bars: number;
    };
    fixes: [string, string, string][];
  };
};

export type RebalancePayload = {
  generated_at: string;
  as_of: string;
  window: string[];
  expiries: { month: string; expiry: string; quarterly: boolean }[];
  trade_days: RebalanceTradeDay[];
  events: RebalanceEvent[];
  etfs: RebalanceEtf[];
  flows: RebalanceFlow[];
  impact: RebalanceImpact[];
  adv_as_of: string | null;
  assumptions: string[];
  sources: string[];
  rule_legend: Record<string, string>;
  event_study?: EventStudy | null;
  broker_estimates?: BrokerEstimate[];
  /** `/api/rebalance/whitepaper` 를 따로 받아 화면에서 붙인다 (엑셀 시트용) */
  whitepaper?: RebalanceWhitepaper;
};

export type RebalanceResponse =
  | ({ ok: true; source: "r2" | "bundled" } & RebalancePayload)
  | { ok: false; error: string };

export type RebalanceWhitepaperResponse =
  | { ok: true; whitepaper: RebalanceWhitepaper }
  | { ok: false; error: string };

export const WP_FX_DEFAULT = 1400;

export const REBALANCE_R2_KEY = "rebalance/latest.json";

export const UNVERIFIED_LABEL: Record<string, string> = {
  months: "주기",
  rule: "변경일 규칙",
  weighting: "가중 방식",
  weighting_inputs: "가중 입력값",
  effective_date: "효력일 해석",
  constituents: "편출입",
  multi_day: "다영업일 분할 개편",
  execution: "현물 집행(재량·파생)",
};

export function unverifiedText(keys: string[] | undefined | null): string {
  return (keys || []).map((k) => UNVERIFIED_LABEL[k] || k).join("·");
}

export function impactLevel(ratio: number | null): RebalanceImpact["impact_level"] {
  if (ratio == null) return "unknown";
  if (ratio >= 0.1) return "high";
  if (ratio >= 0.03) return "mid";
  return "low";
}

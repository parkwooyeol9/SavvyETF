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
  scenario_id: string;
  scenario_label: string;
  scenario_note?: string;
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
};

export type RebalanceResponse =
  | ({ ok: true; source: "r2" | "bundled" } & RebalancePayload)
  | { ok: false; error: string };

export const REBALANCE_R2_KEY = "rebalance/latest.json";

export function impactLevel(ratio: number | null): RebalanceImpact["impact_level"] {
  if (ratio == null) return "unknown";
  if (ratio >= 0.1) return "high";
  if (ratio >= 0.03) return "mid";
  return "low";
}

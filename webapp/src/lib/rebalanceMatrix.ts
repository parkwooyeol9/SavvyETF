/**
 * 일자 × ETF × 종목 예상 수급 — 화면(RebalanceFlowMatrix)과 엑셀(rebalanceExcel)이 같은 계산을 쓴다.
 * 입력은 `/api/rebalance` 의 flows(ETF·시나리오·매매일별 종목 매매)와 화면에서 고른 시나리오.
 */
import type { RebalanceFlow, RebalancePayload } from "./rebalance";

export type MatrixStock = {
  code: string;
  name: string;
  byDate: Record<string, number>;
  byEtf: Record<string, number>;
  total: number;
  buy: number;
  sell: number;
  adv: number | null;
  /** 매매일 중 |순매매| / 20일 평균 거래대금 최대값 (분할일수 적용 전) */
  maxRatio: number | null;
  broker: number | null;
};

export type MatrixEtf = {
  code: string;
  name: string;
  date: string;
  effective: string;
  scenario: string;
  aum: number;
  buy: number;
  sell: number;
  split: string | null;
  holdingsAsOf: string | null;
};

export type MatrixLong = {
  date: string;
  effective: string;
  etfCode: string;
  etfName: string;
  scenario: string;
  split: string | null;
  code: string;
  name: string;
  current: number;
  target: number;
  delta: number;
  amount: number;
};

export type FlowMatrix = {
  dates: string[];
  stocks: MatrixStock[];
  etfs: MatrixEtf[];
  long: MatrixLong[];
  totalsByDate: Record<string, { buy: number; sell: number; etfs: number }>;
};

/** ETF마다 선택된(없으면 기본) 시나리오의 flow 만. */
export function chosenFlows(data: RebalancePayload, choice: Record<string, string>): RebalanceFlow[] {
  return data.flows.filter((f) => (choice[f.etf_code] ? choice[f.etf_code] === f.scenario_id : f.primary));
}

export function buildFlowMatrix(
  data: RebalancePayload,
  choice: Record<string, string>,
  opts: { from?: string; to?: string } = {},
): FlowMatrix {
  const adv = new Map<string, number>();
  for (const r of data.impact) if (r.adv_eok) adv.set(r.code, r.adv_eok);
  const broker = new Map<string, number>();
  for (const b of data.broker_estimates?.[0]?.items || []) broker.set(b.code, b.amount_eok);

  const flows = chosenFlows(data, choice).filter(
    (f) => (!opts.from || f.trade_date >= opts.from) && (!opts.to || f.trade_date <= opts.to),
  );
  const dates = [...new Set(flows.map((f) => f.trade_date))].sort();
  const stocks = new Map<string, MatrixStock>();
  const etfs: MatrixEtf[] = [];
  const long: MatrixLong[] = [];
  const totalsByDate: FlowMatrix["totalsByDate"] = {};

  for (const f of flows) {
    const split = f.split_n && f.split_n > 1 ? `${(f.split_index ?? 0) + 1}/${f.split_n}` : null;
    const tot = (totalsByDate[f.trade_date] ||= { buy: 0, sell: 0, etfs: 0 });
    tot.etfs += 1;
    let buy = 0;
    let sell = 0;
    for (const t of f.trades) {
      const a = t.amount_eok;
      if (!a) continue;
      if (a > 0) buy += a;
      else sell += a;
      const s =
        stocks.get(t.code) ||
        ({
          code: t.code, name: t.name, byDate: {}, byEtf: {}, total: 0, buy: 0, sell: 0,
          adv: adv.get(t.code) ?? null, maxRatio: null, broker: broker.get(t.code) ?? null,
        } as MatrixStock);
      s.byDate[f.trade_date] = (s.byDate[f.trade_date] || 0) + a;
      s.byEtf[f.etf_code] = (s.byEtf[f.etf_code] || 0) + a;
      s.total += a;
      if (a > 0) s.buy += a;
      else s.sell += a;
      stocks.set(t.code, s);
      long.push({
        date: f.trade_date, effective: f.effective, etfCode: f.etf_code, etfName: f.etf_name,
        scenario: f.scenario_label, split, code: t.code, name: t.name,
        current: t.current_pct, target: t.target_pct, delta: t.delta_pct, amount: a,
      });
    }
    tot.buy += buy;
    tot.sell += sell;
    etfs.push({
      code: f.etf_code, name: f.etf_name, date: f.trade_date, effective: f.effective, scenario: f.scenario_label,
      aum: f.aum_eok, buy, sell, split, holdingsAsOf: f.holdings_as_of ?? null,
    });
  }
  for (const s of stocks.values()) {
    if (s.adv) s.maxRatio = Math.max(...Object.values(s.byDate).map((v) => Math.abs(v) / (s.adv as number)));
    // 표시용 반올림 오차 정리
    s.total = Math.round(s.total * 10) / 10;
  }
  const list = [...stocks.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  etfs.sort((a, b) => a.date.localeCompare(b.date) || b.aum - a.aum);
  return { dates, stocks: list, etfs, long, totalsByDate };
}

/** 오늘 이후 첫 매매일부터 30일 — '이번 정기변경' 범위 (12월 일정 등 다음 회차를 섞지 않기 위해). */
export function nextCycleRange(data: RebalancePayload, today: string): { from: string; to: string } | null {
  const first = data.flows.map((f) => f.trade_date).filter((d) => d >= today).sort()[0];
  if (!first) return null;
  const [y, m, d] = first.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10);
  return { from: today, to: end };
}


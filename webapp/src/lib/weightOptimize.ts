/**
 * Constrained Black–Litterman sleeve on top of AI Pick.
 *
 * Prior = AI Pick (score-proportional) weights.
 * Views = trading-signal score + NLP polarity + graph cluster heat + money-flow regime.
 * Then mean-variance, shrink toward the prior (turnover), project long-only caps.
 */

import { buildAiBrief } from "@/lib/aiBrief";
import {
  CHAIN_NODES,
  clusterHeat,
  neighborhoodIds,
  type ChainPayload,
} from "@/lib/chainGraph";
import type { MoneyFlowPayload } from "@/lib/moneyFlow";
import type { NlpNameCard, NlpPulsePayload } from "@/lib/nlpPulse";
import type { TradingIdea, TradingIdeasPayload } from "@/lib/tradingIdeas";
import { buildTradingIdeasFromSignals } from "@/lib/tradingIdeas";
import type {
  AssetSignal,
  RiskRegime,
  TradingSignalsPayload,
} from "@/lib/tradingSignals";

export const ETF_CAP_PCT = 22;
export const STOCK_CAP_PCT = 6;
export const TURNOVER_SHRINK = 0.32;

export const WEIGHTOPT_SCHEDULE_NOTE =
  "AI Pick 사전 + 시그널·NLP·그래프·수급 뷰 → Black–Litterman · 교육용";

export const WEIGHTOPT_DISCLAIMER =
  "본 비중은 SavvyETF 규칙 시그널과 텍스트·그래프 뷰를 제약 최적화한 교육용 결과입니다. 투자 자문·자동매매가 아니며, 손실 가능성을 배제하지 않습니다.";

export const WEIGHTOPT_METHODOLOGY: string[] = [
  "사전(π): AI Pick 점수 비례 비중. 균형 초과수익 π = λ Σ w_pick",
  "뷰: 시그널 점수, NLP 극성(종목·QQQ), 그래프 클러스터 1일, Money Flow 레짐",
  "사후 μ = π + Σ(Σ+Ω)⁻¹(Q−π) (각 자산 독립 뷰)",
  "평균-분산 w ∝ Σ⁻¹μ / λ 후 AI Pick 쪽으로 축소(턴오버 패널티)",
  `제약: 롱온리, 현금≥레짐, ETF ${ETF_CAP_PCT}% · 주식 ${STOCK_CAP_PCT}% 상한`,
  "λ는 VIX·HY OAS 레짐에 매핑 (High→보수, Calm→공격)",
];

export type WeightViewBreakdown = {
  signal: number;
  nlp: number;
  graph: number;
  flow: number;
};

export type OptimizedSleeve = {
  symbol: string;
  name: string;
  asset_class: "etf" | "stock" | "cash";
  group: string;
  pick_pct: number;
  opt_pct: number;
  delta_pct: number;
  mu_pct: number;
  vol_pct: number;
  views: WeightViewBreakdown;
  rationale: string[];
};

export type WeightOptimizePayload = {
  ok: boolean;
  generated_at: string;
  as_of: string | null;
  lambda: number;
  regime_ko: string | null;
  cash_pct: number;
  invested_pct: number;
  pick_cash_pct: number;
  turnover_vs_pick_pct: number;
  expected_excess_pct: number | null;
  port_vol_pct: number | null;
  pick_vol_pct: number | null;
  flow_regime_ko: string | null;
  comment: string;
  summary: string[];
  methodology: string[];
  disclaimer: string;
  schedule_note: string;
  sleeves: OptimizedSleeve[];
  sells: TradingIdea[];
  error?: string;
};

const DEFENSIVE = new Set(["XLP", "XLU", "TLT", "GLD", "SLV", "BND"]);
const RISK_ON = new Set(["QQQ", "XLK", "SMH", "SOXX", "IGV", "XLY", "ARKK"]);

function clip(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function lambdaFromRisk(risk: RiskRegime | null): number {
  if (!risk) return 3.6;
  const r = risk.regime.toLowerCase();
  if (r.includes("high")) return 7.2;
  if (r.includes("elevated")) return 5.2;
  if (r.includes("caution")) return 3.8;
  return 2.6;
}

function allSignals(signals: TradingSignalsPayload): AssetSignal[] {
  return [...signals.core, ...signals.sectors, ...signals.themes].filter((a) => !a.error);
}

function findSignal(signals: TradingSignalsPayload, symbol: string): AssetSignal | undefined {
  return allSignals(signals).find((a) => a.symbol === symbol);
}

function nlpByTicker(nlp: NlpPulsePayload | null): Map<string, NlpNameCard> {
  const m = new Map<string, NlpNameCard>();
  if (!nlp?.ok) return m;
  for (const c of [...nlp.kospi.names, ...nlp.spx.names]) {
    m.set(c.ticker.toUpperCase(), c);
  }
  return m;
}

function chainNodeByTicker(chain: ChainPayload | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of chain?.nodes || CHAIN_NODES) {
    m.set(n.ticker.toUpperCase(), n.id);
  }
  return m;
}

function graphLinked(
  tickerA: string,
  tickerB: string,
  idByTicker: Map<string, string>,
): boolean {
  const a = idByTicker.get(tickerA.toUpperCase());
  const b = idByTicker.get(tickerB.toUpperCase());
  if (!a || !b || a === b) return false;
  return neighborhoodIds(a, 2).has(b);
}

function invert(A: number[][]): number[][] | null {
  const n = A.length;
  if (!n) return [];
  const M = A.map((row, i) => {
    const ext = row.slice();
    for (let j = 0; j < n; j++) ext.push(i === j ? 1 : 0);
    return ext;
  });
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i]![k]!) > Math.abs(M[piv]![k]!)) piv = i;
    }
    if (Math.abs(M[piv]![k]!) < 1e-10) return null;
    if (piv !== k) {
      const tmp = M[k]!;
      M[k] = M[piv]!;
      M[piv] = tmp;
    }
    const d = M[k]![k]!;
    for (let j = 0; j < 2 * n; j++) M[k]![j] = M[k]![j]! / d;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const f = M[i]![k]!;
      for (let j = 0; j < 2 * n; j++) M[i]![j] = M[i]![j]! - f * M[k]![j]!;
    }
  }
  return M.map((row) => row.slice(n));
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, a, j) => s + a * (v[j] || 0), 0));
}

function quad(w: number[], Sigma: number[][]): number {
  const Sw = matVec(Sigma, w);
  return w.reduce((s, wi, i) => s + wi * (Sw[i] || 0), 0);
}

function sigmaOf(idea: TradingIdea, sig?: AssetSignal): number {
  const vol = sig?.realized_vol_20d;
  if (vol != null && vol > 2) return clip(vol / 100, 0.08, 0.65);
  return idea.asset_class === "stock" ? 0.28 : 0.18;
}

function correlation(
  a: TradingIdea,
  b: TradingIdea,
  idByTicker: Map<string, string>,
): number {
  if (a.symbol === b.symbol) return 1;
  let p = 0.28;
  if (a.group === b.group) p = 0.58;
  else if (a.asset_class === "etf" && b.asset_class === "etf") p = 0.42;
  else if (a.asset_class === "stock" && b.asset_class === "stock") p = 0.48;
  if (DEFENSIVE.has(a.symbol) && DEFENSIVE.has(b.symbol)) p = Math.max(p, 0.5);
  if (graphLinked(a.symbol, b.symbol, idByTicker)) p = Math.min(0.82, p + 0.16);
  return clip(p, 0.05, 0.9);
}

function buildSigma(ideas: TradingIdea[], signals: TradingSignalsPayload, chain: ChainPayload | null): number[][] {
  const idByTicker = chainNodeByTicker(chain);
  const sigs = ideas.map((i) => sigmaOf(i, findSignal(signals, i.symbol)));
  const n = ideas.length;
  const Sigma: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const p = i === j ? 1 : correlation(ideas[i]!, ideas[j]!, idByTicker);
      row.push(p * sigs[i]! * sigs[j]!);
    }
    row[i] = (row[i] || 0) + 1e-6;
    Sigma.push(row);
  }
  return Sigma;
}

function viewsFor(
  idea: TradingIdea,
  signals: TradingSignalsPayload,
  nlp: NlpPulsePayload | null,
  chain: ChainPayload | null,
  flow: MoneyFlowPayload | null,
  etfBoosts: Record<string, number>,
): { q: WeightViewBreakdown; notes: string[] } {
  const notes: string[] = [];
  const sig = findSignal(signals, idea.symbol);
  const score = sig?.score ?? idea.score;
  const signal = clip(((score - 55) / 100) * 0.16, -0.1, 0.12);
  if (Math.abs(signal) >= 0.012) {
    notes.push(`시그널 ${score.toFixed(0)} → 뷰 ${(signal * 100).toFixed(1)}%`);
  }

  let nlpV = 0;
  const cards = nlpByTicker(nlp);
  const card = cards.get(idea.symbol.toUpperCase());
  if (card) {
    nlpV += clip((card.score / 100) * 0.09, -0.08, 0.08);
    if (card.verdict === "friendly") nlpV += 0.015;
    if (card.verdict === "cautious") nlpV -= 0.015;
    notes.push(`NLP ${card.verdict_ko} (${card.score.toFixed(0)})`);
  }
  const boost = etfBoosts[idea.symbol] || 0;
  if (boost) {
    nlpV += clip(boost / 100, -0.06, 0.06);
    notes.push(`그래프·NLP ETF 가산 ${boost > 0 ? "+" : ""}${boost}`);
  }
  if (nlp?.ok && idea.symbol === "QQQ") {
    if (nlp.spx.verdict === "friendly") nlpV += 0.02;
    if (nlp.spx.verdict === "cautious") nlpV -= 0.02;
  }

  let graph = 0;
  const heat = clusterHeat(chain?.nodes || []);
  const idByTicker = chainNodeByTicker(chain);
  const nodeId = idByTicker.get(idea.symbol.toUpperCase());
  const node = (chain?.nodes || []).find((n) => n.id === nodeId);
  if (node?.ret1d != null) {
    graph += clip(node.ret1d * 0.05, -0.08, 0.08);
    notes.push(`노드 1일 ${node.ret1d >= 0 ? "+" : ""}${node.ret1d.toFixed(2)}%`);
  }
  for (const h of heat) {
    if (h.avg1d == null) continue;
    const mapped = h.id === "gpu" || h.id === "memory" || h.id === "cloud";
    const hit =
      (mapped && ["SMH", "SOXX", "XLK", "QQQ", "NVDA", "AVGO"].includes(idea.symbol)) ||
      (h.id === "auto" && ["XLY", "TSLA"].includes(idea.symbol)) ||
      (h.id === "finance" && ["XLF", "JPM", "V"].includes(idea.symbol)) ||
      (h.id === "battery" && ["006400", "373220"].includes(idea.symbol));
    if (hit) {
      graph += clip(h.avg1d * 0.04, -0.06, 0.06);
      if (Math.abs(h.avg1d) >= 0.6) {
        notes.push(`${h.label} 클러스터 ${h.avg1d >= 0 ? "+" : ""}${h.avg1d.toFixed(2)}%`);
      }
    }
  }

  let flowV = 0;
  const regime = flow?.risk_summary.regime;
  if (regime === "risk_off") {
    if (DEFENSIVE.has(idea.symbol)) flowV += 0.035;
    if (RISK_ON.has(idea.symbol)) flowV -= 0.028;
  } else if (regime === "risk_on") {
    if (DEFENSIVE.has(idea.symbol)) flowV -= 0.012;
    if (RISK_ON.has(idea.symbol)) flowV += 0.02;
  }
  if (flowV) {
    notes.push(`수급 ${flow?.risk_summary.regime_ko || regime}`);
  }

  return {
    q: {
      signal: round1(signal * 100) / 100,
      nlp: round1(nlpV * 100) / 100,
      graph: round1(graph * 100) / 100,
      flow: round1(flowV * 100) / 100,
    },
    notes: notes.slice(0, 3),
  };
}

function projectCaps(
  w: number[],
  ideas: TradingIdea[],
  investable: number,
): number[] {
  const n = w.length;
  let x = w.slice();
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < n; i++) {
      const cap = ideas[i]!.asset_class === "stock" ? STOCK_CAP_PCT : ETF_CAP_PCT;
      x[i] = clip(x[i] || 0, 0, cap);
    }
    const s = x.reduce((t, v) => t + v, 0);
    if (s <= 1e-9) {
      const eq = investable / Math.max(1, n);
      return ideas.map((idea) =>
        Math.min(idea.asset_class === "stock" ? STOCK_CAP_PCT : ETF_CAP_PCT, eq),
      );
    }
    const scale = investable / s;
    let hit = false;
    x = x.map((v, i) => {
      const cap = ideas[i]!.asset_class === "stock" ? STOCK_CAP_PCT : ETF_CAP_PCT;
      const next = v * scale;
      if (next > cap + 1e-6) hit = true;
      return Math.min(next, cap);
    });
    const s2 = x.reduce((t, v) => t + v, 0);
    if (Math.abs(s2 - investable) < 0.05 && !hit) break;
    if (s2 < investable - 0.05) {
      const room = x.map((v, i) => {
        const cap = ideas[i]!.asset_class === "stock" ? STOCK_CAP_PCT : ETF_CAP_PCT;
        return Math.max(0, cap - v);
      });
      const roomSum = room.reduce((t, v) => t + v, 0);
      if (roomSum > 0) {
        const need = investable - s2;
        x = x.map((v, i) => v + (room[i]! / roomSum) * need);
      }
    }
  }
  return x.map((v) => round1(v));
}

function emptyPayload(error: string, comment = ""): WeightOptimizePayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    as_of: null,
    lambda: 3.6,
    regime_ko: null,
    cash_pct: 100,
    invested_pct: 0,
    pick_cash_pct: 100,
    turnover_vs_pick_pct: 0,
    expected_excess_pct: null,
    port_vol_pct: null,
    pick_vol_pct: null,
    flow_regime_ko: null,
    comment,
    summary: [],
    methodology: WEIGHTOPT_METHODOLOGY,
    disclaimer: WEIGHTOPT_DISCLAIMER,
    schedule_note: WEIGHTOPT_SCHEDULE_NOTE,
    sleeves: [],
    sells: [],
    error,
  };
}

export function buildWeightOptimize(input: {
  signals: TradingSignalsPayload;
  nlp?: NlpPulsePayload | null;
  chain?: ChainPayload | null;
  flow?: MoneyFlowPayload | null;
}): WeightOptimizePayload {
  const generated_at = new Date().toISOString();
  const { signals, nlp = null, chain = null, flow = null } = input;
  const ideas = buildTradingIdeasFromSignals(signals, { nlp, chain });
  if (!ideas.ok) {
    return emptyPayload(ideas.error || "AI Pick을 만들지 못했습니다.", ideas.comment);
  }

  const brief = buildAiBrief(nlp, chain);
  const buys = ideas.buys.filter((b) => b.weight_pct > 0);
  const lambda = lambdaFromRisk(ideas.risk);
  let cashPct = ideas.cash_pct;
  if (flow?.risk_summary.regime === "risk_off") cashPct = Math.min(45, cashPct + 3);
  if (flow?.risk_summary.regime === "risk_on") cashPct = Math.max(5, cashPct - 2);
  cashPct = round1(clip(cashPct, 5, 45));
  const investable = round1(Math.max(0, 100 - cashPct));

  if (!buys.length || investable < 1) {
    return {
      ok: true,
      generated_at,
      as_of: ideas.as_of,
      lambda,
      regime_ko: ideas.risk?.regime_ko || null,
      cash_pct: 100,
      invested_pct: 0,
      pick_cash_pct: ideas.cash_pct,
      turnover_vs_pick_pct: 0,
      expected_excess_pct: null,
      port_vol_pct: null,
      pick_vol_pct: null,
      flow_regime_ko: flow?.risk_summary.regime_ko || null,
      comment: brief.comment,
      summary: ["투자 가능 비중이 없어 현금 100%입니다."],
      methodology: WEIGHTOPT_METHODOLOGY,
      disclaimer: WEIGHTOPT_DISCLAIMER,
      schedule_note: WEIGHTOPT_SCHEDULE_NOTE,
      sleeves: [
        {
          symbol: "CASH",
          name: "현금 버퍼",
          asset_class: "cash",
          group: "cash",
          pick_pct: ideas.cash_pct,
          opt_pct: 100,
          delta_pct: round1(100 - ideas.cash_pct),
          mu_pct: 0,
          vol_pct: 0,
          views: { signal: 0, nlp: 0, graph: 0, flow: 0 },
          rationale: ["레짐상 위험자산 배분 없음"],
        },
      ],
      sells: ideas.sells,
    };
  }

  const pickSum = buys.reduce((s, b) => s + b.weight_pct, 0) || 1;
  const wEq = buys.map((b) => (b.weight_pct / pickSum) * investable);
  const wEqUnit = buys.map((b) => b.weight_pct / pickSum);

  const viewPack = buys.map((b) => viewsFor(b, signals, nlp, chain, flow, brief.etfBoosts));
  const Qadd = viewPack.map((v) => v.q.signal + v.q.nlp + v.q.graph + v.q.flow);

  const Sigma = buildSigma(buys, signals, chain);
  const invS = invert(Sigma);
  if (!invS) {
    return emptyPayload("공분산 행렬을 뒤집지 못했습니다.");
  }

  const pi = matVec(Sigma, wEqUnit).map((x) => lambda * x);
  const omegaDiag = Qadd.map((q) => Math.max(0.012 ** 2, (0.04 * (1.1 - clip(Math.abs(q) / 0.08, 0.2, 1))) ** 2));
  const SigmaPlusOm = Sigma.map((row, i) => row.map((a, j) => a + (i === j ? omegaDiag[i]! : 0)));
  const invSO = invert(SigmaPlusOm);
  if (!invSO) {
    return emptyPayload("뷰 불확실성 행렬을 뒤집지 못했습니다.");
  }
  const Q = pi.map((p, i) => p + Qadd[i]!);
  const residual = Q.map((q, i) => q - pi[i]!);
  const blAdj = matVec(Sigma, matVec(invSO, residual));
  const mu = pi.map((p, i) => p + blAdj[i]!);

  const invMu = matVec(invS, mu);
  const raw = invMu.map((x) => x / lambda);
  const rawSum = raw.reduce((s, x) => s + Math.max(0, x), 0) || 1;
  let wStar = raw.map((x, i) => {
    const bl = (Math.max(0, x) / rawSum) * investable;
    return (1 - TURNOVER_SHRINK) * bl + TURNOVER_SHRINK * (wEq[i] || 0);
  });
  const wOpt = projectCaps(wStar, buys, investable);
  const optSum = wOpt.reduce((s, v) => s + v, 0);
  const cashOut = round1(100 - optSum);

  const wOptFrac = wOpt.map((w) => w / 100);
  const wPickFrac = wEq.map((w) => w / 100);
  const portVar = quad(wOptFrac, Sigma);
  const pickVar = quad(wPickFrac, Sigma);
  const muPort = wOptFrac.reduce((s, w, i) => s + w * (mu[i] || 0), 0);
  const turnover =
    0.5 * buys.reduce((s, _, i) => s + Math.abs((wOpt[i] || 0) - (wEq[i] || 0)), 0);

  const sleeves: OptimizedSleeve[] = buys.map((b, i) => {
    const sig = findSignal(signals, b.symbol);
    return {
      symbol: b.symbol,
      name: b.name,
      asset_class: b.asset_class,
      group: b.group,
      pick_pct: round1(wEq[i] || 0),
      opt_pct: wOpt[i] || 0,
      delta_pct: round1((wOpt[i] || 0) - (wEq[i] || 0)),
      mu_pct: round1((mu[i] || 0) * 100),
      vol_pct: round1(sigmaOf(b, sig) * 100),
      views: viewPack[i]!.q,
      rationale: viewPack[i]!.notes.length ? viewPack[i]!.notes : b.rationale.slice(0, 2),
    };
  });
  sleeves.push({
    symbol: "CASH",
    name: "현금 버퍼",
    asset_class: "cash",
    group: "cash",
    pick_pct: round1(ideas.cash_pct),
    opt_pct: cashOut,
    delta_pct: round1(cashOut - ideas.cash_pct),
    mu_pct: 0,
    vol_pct: 0,
    views: { signal: 0, nlp: 0, graph: 0, flow: 0 },
    rationale: [
      ideas.risk ? `레짐 ${ideas.risk.regime_ko}` : "기본 현금",
      ...(flow?.risk_summary.regime_ko ? [`수급 ${flow.risk_summary.regime_ko}`] : []),
    ],
  });
  sleeves.sort((a, b) => {
    if (a.asset_class === "cash") return 1;
    if (b.asset_class === "cash") return -1;
    return b.opt_pct - a.opt_pct;
  });

  const lifted = sleeves.filter((s) => s.delta_pct >= 0.4).slice(0, 3);
  const cut = sleeves.filter((s) => s.delta_pct <= -0.4).slice(0, 3);
  const summary = [
    `λ ${lambda.toFixed(1)} · 현금 ${cashOut.toFixed(0)}% (AI Pick ${ideas.cash_pct.toFixed(0)}%) · 회전율 ${turnover.toFixed(1)}%p`,
    ideas.risk
      ? `레짐 ${ideas.risk.regime_ko} · VIX ${ideas.risk.vix?.toFixed(1) ?? "—"} · HY OAS ${ideas.risk.hy_oas?.toFixed(0) ?? "—"}`
      : "레짐 데이터 없음",
    flow?.risk_summary.regime_ko
      ? `Money Flow ${flow.risk_summary.regime_ko}`
      : "수급 뷰 없음 (캐시 또는 타임아웃)",
    lifted.length
      ? `확대 ${lifted.map((s) => `${s.symbol} ${s.delta_pct > 0 ? "+" : ""}${s.delta_pct.toFixed(1)}`).join(" · ")}`
      : "AI Pick 대비 확대 종목 없음",
    cut.length
      ? `축소 ${cut.map((s) => `${s.symbol} ${s.delta_pct.toFixed(1)}`).join(" · ")}`
      : "AI Pick 대비 축소 종목 없음",
  ];

  return {
    ok: true,
    generated_at,
    as_of: ideas.as_of,
    lambda,
    regime_ko: ideas.risk?.regime_ko || null,
    cash_pct: cashOut,
    invested_pct: round1(100 - cashOut),
    pick_cash_pct: ideas.cash_pct,
    turnover_vs_pick_pct: round1(turnover),
    expected_excess_pct: round1(muPort * 100),
    port_vol_pct: portVar > 0 ? round1(Math.sqrt(portVar) * 100) : null,
    pick_vol_pct: pickVar > 0 ? round1(Math.sqrt(pickVar) * 100) : null,
    flow_regime_ko: flow?.risk_summary.regime_ko || null,
    comment: brief.comment,
    summary,
    methodology: WEIGHTOPT_METHODOLOGY,
    disclaimer: WEIGHTOPT_DISCLAIMER,
    schedule_note: WEIGHTOPT_SCHEDULE_NOTE,
    sleeves,
    sells: ideas.sells,
  };
}

/**
 * Daily trading ideas — portfolio sleeve suggestions from existing
 * SavvyETF rule signals (trend/momentum/RS/vol/macro) + mega-cap stock tilt,
 * blended with Graph + NLP AI 시황 candidates.
 * Designed as the feed for future AI auto-trading and AI포트 tracking.
 */

import { buildAiBrief, emptyAiBrief, type AiBrief, type BriefCandidate } from "@/lib/aiBrief";
import type { ChainPayload } from "@/lib/chainGraph";
import type { NlpPulsePayload } from "@/lib/nlpPulse";
import type {
  AssetSignal,
  RiskRegime,
  TradingSignalsPayload,
} from "@/lib/tradingSignals";

export type IdeaAction = "buy" | "sell" | "hold";

export type TradingIdea = {
  symbol: string;
  name: string;
  asset_class: "etf" | "stock" | "cash";
  group: string;
  action: IdeaAction;
  action_ko: string;
  score: number;
  weight_pct: number;
  rationale: string[];
  change_20d_pct: number | null;
  excess_20d_vs_spy: number | null;
};

export type TradingIdeasPayload = {
  ok: boolean;
  generated_at: string;
  as_of: string | null;
  risk: RiskRegime | null;
  cash_pct: number;
  invested_pct: number;
  ideas: TradingIdea[];
  buys: TradingIdea[];
  sells: TradingIdea[];
  summary: string[];
  methodology: string[];
  disclaimer: string;
  schedule_note: string;
  /** Graph + NLP 시황 paragraph shown on AI Pick */
  comment: string;
  /** Flattened long weights for AI포트 (cash excluded) — sums to invested_pct */
  target_weights: Array<{ symbol: string; weight_pct: number; name: string }>;
  error?: string;
};

export const IDEAS_SCHEDULE_NOTE =
  "일봉 시그널 + 그래프·NLP 시황 · 교육용 (투자 권유 아님)";

export const IDEAS_DISCLAIMER =
  "본 아이디어는 SavvyETF 내 규칙 기반 시그널과 그래프·NLP 점수를 조합한 자동 제안입니다. AI 자동매매·투자 자문이 아니며, 손실 가능성을 배제하지 않습니다.";

export const IDEAS_METHODOLOGY: string[] = [
  "기반: /api/trading-signals 점수 (추세·모멘텀·RS·변동성·매크로)",
  "AI 시황: 그래프 클러스터 1일 평균·노드 등락 + NLP 우호/경계를 규칙 점수화",
  "Buy(≥65) 중 상위 ETF/테마를 롱 후보, 강한 클러스터는 테마 ETF 점수를 가산",
  "미국 주식 후보는 시그널 메가캡 틸트와 합쳐 목표 비중. 국내 후보는 시황 코멘트",
  "리스크 레짐 Elevated/High → 현금·방어(XLP/XLU/TLT/GLD) 비중 확대",
  "비중: 점수 비례 후 ETF 상한 22%·주식 상한 6%, 총 투자 비중 = 100% − 현금",
];

/** Mega-cap stock sleeve candidates (Yahoo-tradable). */
export const STOCK_IDEA_CANDIDATES: Array<{
  symbol: string;
  name: string;
  theme: string;
}> = [
  { symbol: "AAPL", name: "Apple", theme: "tech" },
  { symbol: "MSFT", name: "Microsoft", theme: "tech" },
  { symbol: "NVDA", name: "NVIDIA", theme: "tech" },
  { symbol: "AMZN", name: "Amazon", theme: "tech" },
  { symbol: "META", name: "Meta", theme: "tech" },
  { symbol: "GOOGL", name: "Alphabet", theme: "tech" },
  { symbol: "JPM", name: "JPMorgan", theme: "finance" },
  { symbol: "V", name: "Visa", theme: "finance" },
  { symbol: "UNH", name: "UnitedHealth", theme: "defensive" },
  { symbol: "XOM", name: "Exxon", theme: "energy" },
];

function cashTargetFromRisk(risk: RiskRegime | null): number {
  if (!risk) return 10;
  const r = risk.regime.toLowerCase();
  if (r.includes("high")) return 35;
  if (r.includes("elevated")) return 22;
  if (r.includes("caution")) return 12;
  return 5;
}

function defensiveBoost(risk: RiskRegime | null): number {
  if (!risk) return 0;
  const r = risk.regime.toLowerCase();
  if (r.includes("high")) return 1.35;
  if (r.includes("elevated")) return 1.2;
  return 1;
}

function isDefensive(symbol: string): boolean {
  return ["XLP", "XLU", "TLT", "GLD", "SLV", "BND"].includes(symbol);
}

function etfScore(a: AssetSignal, boosts: Record<string, number>): number {
  return a.score + (boosts[a.symbol] || 0);
}

function applyEtfBoosts(rows: AssetSignal[], boosts: Record<string, number>): AssetSignal[] {
  return rows.map((a) => {
    const d = boosts[a.symbol] || 0;
    if (!d) return a;
    const tag = d > 0 ? `그래프·NLP 가산 +${d}` : `그래프·NLP 감점 ${d}`;
    return {
      ...a,
      score: Math.min(100, Math.max(0, a.score + d)),
      drivers: [tag, ...a.drivers].slice(0, 4),
    };
  });
}

function pickLongEtfs(
  signals: TradingSignalsPayload,
  risk: RiskRegime | null,
  boosts: Record<string, number> = {},
): AssetSignal[] {
  const all = [
    ...signals.core.filter((a) => a.group !== "metal"),
    ...signals.sectors,
    ...signals.themes,
    ...signals.core.filter((a) => a.group === "metal"),
  ].filter((a) => !a.error);

  const pool = all.filter((a) => {
    if (a.signal === "buy" && a.score >= 65) return true;
    const d = boosts[a.symbol] || 0;
    return d >= 6 && etfScore(a, boosts) >= 60;
  });

  const boost = defensiveBoost(risk);
  const ranked = [...pool].sort((a, b) => {
    const sa = etfScore(a, boosts) * (isDefensive(a.symbol) ? boost : 1);
    const sb = etfScore(b, boosts) * (isDefensive(b.symbol) ? boost : 1);
    return sb - sa;
  });

  // Prefer diversity: max 1 metal unless high stress, max 4 sectors, max 2 themes
  const out: AssetSignal[] = [];
  let sectors = 0;
  let themes = 0;
  let metals = 0;
  for (const a of ranked) {
    if (out.length >= 7) break;
    if (a.group === "sector") {
      if (sectors >= 4) continue;
      sectors += 1;
    } else if (a.group === "theme") {
      if (themes >= 2) continue;
      themes += 1;
    } else if (a.group === "metal") {
      if (metals >= (boost > 1 ? 2 : 1)) continue;
      metals += 1;
    }
    out.push(a);
  }

  // Fallback: if few buys, take top hold by score from core+sectors
  if (out.length < 3) {
    const fills = [...signals.core, ...signals.sectors]
      .filter((a) => a.score >= 50 && !out.some((o) => o.symbol === a.symbol))
      .sort((a, b) => b.score - a.score);
    for (const a of fills) {
      if (out.length >= 5) break;
      out.push(a);
    }
  }
  return out;
}

function pickSellEtfs(
  signals: TradingSignalsPayload,
  extra: string[] = [],
): AssetSignal[] {
  const all = [...signals.sectors, ...signals.themes, ...signals.core];
  const fromSignal = all.filter((a) => a.signal === "sell" && a.score <= 34);
  const fromBrief = all.filter(
    (a) =>
      extra.includes(a.symbol) &&
      a.score <= 48 &&
      !fromSignal.some((s) => s.symbol === a.symbol),
  );
  return [...fromSignal, ...fromBrief]
    .sort((a, b) => a.score - b.score)
    .slice(0, 8);
}

function allocateWeights(
  longs: AssetSignal[],
  cashPct: number,
  risk: RiskRegime | null,
): TradingIdea[] {
  const investable = Math.max(0, 100 - cashPct);
  if (!longs.length || investable <= 0) return [];

  const boost = defensiveBoost(risk);
  const raw = longs.map((a) => {
    const s = Math.max(a.score, 1) * (isDefensive(a.symbol) ? boost : 1);
    return { a, s };
  });
  const sum = raw.reduce((t, x) => t + x.s, 0) || 1;
  const capped = raw.map(({ a, s }) => {
    let w = (s / sum) * investable;
    w = Math.min(w, 22);
    return { a, w };
  });
  // Renormalize after cap
  const wSum = capped.reduce((t, x) => t + x.w, 0) || 1;
  return capped.map(({ a, w }) => {
    const weight_pct = Math.round((w / wSum) * investable * 10) / 10;
    return {
      symbol: a.symbol,
      name: a.label,
      asset_class: "etf" as const,
      group: a.group,
      action: "buy" as const,
      action_ko: "매수 제안",
      score: a.score,
      weight_pct,
      rationale: a.drivers.slice(0, 3),
      change_20d_pct: a.change_20d_pct,
      excess_20d_vs_spy: a.excess_20d_vs_spy,
    };
  });
}

/** Optional stock tilts when risk is calm and tech/QQQ is buy. */
export function buildStockTilts(
  signals: TradingSignalsPayload,
  risk: RiskRegime | null,
  stockBudgetPct: number,
): TradingIdea[] {
  if (stockBudgetPct < 3) return [];
  const qqq = signals.core.find((c) => c.symbol === "QQQ");
  const spy = signals.core.find((c) => c.symbol === "SPY");
  const regime = (risk?.regime || "").toLowerCase();
  if (regime.includes("high") || regime.includes("elevated")) return [];
  if (!qqq || qqq.score < 55) return [];

  const picks = STOCK_IDEA_CANDIDATES.filter((s) => {
    if (qqq.signal === "buy" && s.theme === "tech") return true;
    if ((spy?.score || 0) >= 60 && s.theme === "finance") return true;
    if (regime.includes("caution") && s.theme === "defensive") return true;
    return s.theme === "tech" && qqq.score >= 70;
  }).slice(0, 4);

  if (!picks.length) return [];
  const each = Math.round((stockBudgetPct / picks.length) * 10) / 10;
  return picks.map((p) => ({
    symbol: p.symbol,
    name: p.name,
    asset_class: "stock" as const,
    group: "mega_cap",
    action: "buy" as const,
    action_ko: "매수 제안",
    score: qqq.score,
    weight_pct: each,
    rationale: [
      `QQQ 점수 ${qqq.score.toFixed(0)} · 메가캡 틸트`,
      risk?.regime_ko ? `레짐 ${risk.regime_ko}` : "리스크 허용 구간",
    ],
    change_20d_pct: qqq.change_20d_pct,
    excess_20d_vs_spy: qqq.excess_20d_vs_spy,
  }));
}

function candidateToIdea(c: BriefCandidate, qqq?: AssetSignal): TradingIdea {
  return {
    symbol: c.symbol,
    name: c.name,
    asset_class: "stock",
    group: "graph_nlp",
    action: "buy",
    action_ko: "매수 제안",
    score: c.score,
    weight_pct: 0,
    rationale: c.rationale,
    change_20d_pct: qqq?.change_20d_pct ?? null,
    excess_20d_vs_spy: qqq?.excess_20d_vs_spy ?? null,
  };
}

function mergeStockBuys(
  classic: TradingIdea[],
  brief: AiBrief,
  qqq: AssetSignal | undefined,
): TradingIdea[] {
  const sellSym = new Set(brief.sells.filter((s) => s.market === "us").map((s) => s.symbol));
  const bySym = new Map<string, TradingIdea>();
  for (const p of classic) {
    if (sellSym.has(p.symbol)) continue;
    bySym.set(p.symbol, p);
  }
  for (const c of brief.buys.filter((b) => b.market === "us")) {
    if (sellSym.has(c.symbol)) continue;
    const prev = bySym.get(c.symbol);
    const next = candidateToIdea(c, qqq);
    if (prev) {
      bySym.set(c.symbol, {
        ...prev,
        score: Math.max(prev.score, c.score),
        rationale: [...c.rationale, ...prev.rationale.filter((r) => !c.rationale.includes(r))].slice(
          0,
          3,
        ),
      });
    } else {
      bySym.set(c.symbol, next);
    }
  }
  return [...bySym.values()].sort((a, b) => b.score - a.score).slice(0, 4);
}

function allocateStockWeights(picks: TradingIdea[], budget: number): TradingIdea[] {
  if (!picks.length || budget < 3) return [];
  const raw = picks.map((p) => ({ p, s: Math.max(p.score, 1) }));
  const sum = raw.reduce((t, x) => t + x.s, 0) || 1;
  const capped = raw.map(({ p, s }) => ({ p, w: Math.min((s / sum) * budget, 6) }));
  const wSum = capped.reduce((t, x) => t + x.w, 0) || 1;
  return capped.map(({ p, w }) => ({
    ...p,
    weight_pct: Math.round((w / wSum) * budget * 10) / 10,
  }));
}

function stockBudgetFor(
  cashPct: number,
  qqqScore: number,
  risk: RiskRegime | null,
  brief: AiBrief,
): number {
  const regime = (risk?.regime || "").toLowerCase();
  if (regime.includes("high")) return 0;
  const usBuys = brief.buys.filter((b) => b.market === "us").length;
  let budget = 0;
  if (cashPct <= 12 && qqqScore >= 60) budget = 12;
  if (usBuys >= 2) budget = Math.max(budget, regime.includes("elevated") ? 8 : 14);
  else if (usBuys === 1 && budget === 0 && !regime.includes("elevated")) budget = 8;
  if (brief.cashDelta >= 4) budget = Math.min(budget || 0, 8);
  return budget;
}

export function buildTradingIdeasFromSignals(
  signals: TradingSignalsPayload,
  extras?: { nlp?: NlpPulsePayload | null; chain?: ChainPayload | null },
): TradingIdeasPayload {
  const generated_at = new Date().toISOString();
  const brief = extras
    ? buildAiBrief(extras.nlp || null, extras.chain || null)
    : emptyAiBrief();
  if (!signals.ok) {
    return {
      ok: false,
      generated_at,
      as_of: signals.as_of,
      risk: signals.risk || null,
      cash_pct: 100,
      invested_pct: 0,
      ideas: [],
      buys: [],
      sells: [],
      summary: signals.summary || [],
      methodology: IDEAS_METHODOLOGY,
      disclaimer: IDEAS_DISCLAIMER,
      schedule_note: IDEAS_SCHEDULE_NOTE,
      comment: brief.comment,
      target_weights: [],
      error: signals.error || "시그널을 불러오지 못했습니다.",
    };
  }

  const risk = signals.risk;
  let cash_pct = Math.min(40, Math.max(5, cashTargetFromRisk(risk) + brief.cashDelta));
  const longs = applyEtfBoosts(pickLongEtfs(signals, risk, brief.etfBoosts), brief.etfBoosts);
  const sellsRaw = pickSellEtfs(signals, brief.etfSells);
  const qqq = signals.core.find((c) => c.symbol === "QQQ");
  const tentativeStock = stockBudgetFor(cash_pct, qqq?.score || 0, risk, brief);
  const classicTilts = buildStockTilts(signals, risk, tentativeStock);
  const mergedStocks = mergeStockBuys(classicTilts, brief, qqq);
  const stockBudget = mergedStocks.length ? tentativeStock : 0;
  const stockIdeas = allocateStockWeights(mergedStocks, stockBudget);
  let etfIdeas = allocateWeights(longs, cash_pct + stockBudget, risk);

  if (stockIdeas.length) {
    const stockSum = stockIdeas.reduce((s, i) => s + i.weight_pct, 0);
    const etfSum = etfIdeas.reduce((s, i) => s + i.weight_pct, 0);
    const targetEtf = Math.max(0, 100 - cash_pct - stockSum);
    if (etfSum > 0 && targetEtf > 0) {
      const scale = targetEtf / etfSum;
      etfIdeas = etfIdeas.map((i) => ({
        ...i,
        weight_pct: Math.round(i.weight_pct * scale * 10) / 10,
      }));
    }
  }

  const buys = [...etfIdeas, ...stockIdeas].filter((i) => i.weight_pct > 0);
  const buySum = buys.reduce((s, i) => s + i.weight_pct, 0);
  cash_pct = Math.round((100 - buySum) * 10) / 10;

  const buySym = new Set(buys.map((b) => b.symbol));
  const sells: TradingIdea[] = [
    ...sellsRaw.map((a) => ({
      symbol: a.symbol,
      name: a.label,
      asset_class: "etf" as const,
      group: a.group,
      action: "sell" as const,
      action_ko: "매도·회피",
      score: a.score,
      weight_pct: 0,
      rationale: a.drivers.slice(0, 3),
      change_20d_pct: a.change_20d_pct,
      excess_20d_vs_spy: a.excess_20d_vs_spy,
    })),
    ...brief.sells.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      asset_class: "stock" as const,
      group: s.market === "us" ? "graph_nlp" : "kr_nlp",
      action: "sell" as const,
      action_ko: "매도·회피",
      score: s.score,
      weight_pct: 0,
      rationale: s.rationale,
      change_20d_pct: null,
      excess_20d_vs_spy: null,
    })),
  ].filter((s, i, arr) => !buySym.has(s.symbol) && arr.findIndex((x) => x.symbol === s.symbol) === i);

  const cashIdea: TradingIdea = {
    symbol: "CASH",
    name: "현금 버퍼",
    asset_class: "cash",
    group: "cash",
    action: "hold",
    action_ko: "현금 유지",
    score: risk?.score ?? 50,
    weight_pct: cash_pct,
    rationale: [
      risk ? `리스크 레짐 ${risk.regime_ko} (점수 ${risk.score})` : "기본 현금",
      ...(brief.cashDelta ? [`NLP 현금 조정 ${brief.cashDelta > 0 ? "+" : ""}${brief.cashDelta}%p`] : []),
      ...(risk?.drivers || []).slice(0, 2),
    ],
    change_20d_pct: null,
    excess_20d_vs_spy: null,
  };

  const ideas = [...buys, cashIdea, ...sells];
  const summary = [
    `오늘 롱 ${buys.length}종 · 현금 ${cash_pct.toFixed(0)}% · 회피 ${sells.length}종`,
    risk
      ? `레짐 ${risk.regime_ko} · VIX ${risk.vix?.toFixed(1) ?? "—"} · HY OAS ${risk.hy_oas?.toFixed(0) ?? "—"}`
      : "레짐 데이터 없음",
    `AI 시황 · 그래프·NLP 매수 ${brief.buys.length} · 회피 ${brief.sells.length}`,
    ...signals.summary.slice(0, 1),
  ];

  return {
    ok: true,
    generated_at,
    as_of: signals.as_of,
    risk,
    cash_pct,
    invested_pct: Math.round((100 - cash_pct) * 10) / 10,
    ideas,
    buys,
    sells,
    summary,
    methodology: IDEAS_METHODOLOGY,
    disclaimer: IDEAS_DISCLAIMER,
    schedule_note: IDEAS_SCHEDULE_NOTE,
    comment: brief.comment,
    target_weights: buys.map((b) => ({
      symbol: b.symbol,
      weight_pct: b.weight_pct,
      name: b.name,
    })),
  };
}

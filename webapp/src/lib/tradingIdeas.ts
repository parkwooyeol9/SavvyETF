/**
 * Daily trading ideas — portfolio sleeve suggestions from existing
 * SavvyETF rule signals (trend/momentum/RS/vol/macro) + mega-cap stock tilt.
 * Designed as the feed for future AI auto-trading and AI포트 tracking.
 */

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
  /** Flattened long weights for AI포트 (cash excluded) — sums to invested_pct */
  target_weights: Array<{ symbol: string; weight_pct: number; name: string }>;
  error?: string;
};

export const IDEAS_SCHEDULE_NOTE =
  "일봉 시그널 앙상블 · 트레이딩 시그널 + 리스크 레짐 · 교육용 (투자 권유 아님)";

export const IDEAS_DISCLAIMER =
  "본 아이디어는 SavvyETF 내 규칙 기반 시그널을 조합한 자동 제안입니다. AI 자동매매·투자 자문이 아니며, 손실 가능성을 배제하지 않습니다.";

export const IDEAS_METHODOLOGY: string[] = [
  "기반: /api/trading-signals 점수 (추세·모멘텀·RS·변동성·매크로)",
  "Buy(≥65) 중 상위 ETF/테마를 롱 후보, Sell(≤34)은 회피·감축",
  "리스크 레짐 Elevated/High → 현금·방어(XLP/XLU/TLT/GLD) 비중 확대",
  "메가캡 주식 틸트: 시그널 강세 시 기술·금융 대표주 소량 편입",
  "비중: 점수 비례 후 종목 상한 22%, 총 투자 비중 = 100% − 현금",
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

function pickLongEtfs(
  signals: TradingSignalsPayload,
  risk: RiskRegime | null,
): AssetSignal[] {
  const pool = [
    ...signals.core.filter((a) => a.group !== "metal"),
    ...signals.sectors,
    ...signals.themes,
    ...signals.core.filter((a) => a.group === "metal"),
  ].filter((a) => a.signal === "buy" && a.score >= 65 && !a.error);

  const boost = defensiveBoost(risk);
  const ranked = [...pool].sort((a, b) => {
    const sa = a.score * (isDefensive(a.symbol) ? boost : 1);
    const sb = b.score * (isDefensive(b.symbol) ? boost : 1);
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

function pickSellEtfs(signals: TradingSignalsPayload): AssetSignal[] {
  return [...signals.sectors, ...signals.themes, ...signals.core]
    .filter((a) => a.signal === "sell" && a.score <= 34)
    .sort((a, b) => a.score - b.score)
    .slice(0, 6);
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

export function buildTradingIdeasFromSignals(
  signals: TradingSignalsPayload,
): TradingIdeasPayload {
  const generated_at = new Date().toISOString();
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
      target_weights: [],
      error: signals.error || "시그널을 불러오지 못했습니다.",
    };
  }

  const risk = signals.risk;
  let cash_pct = cashTargetFromRisk(risk);
  const longs = pickLongEtfs(signals, risk);
  const sellsRaw = pickSellEtfs(signals);

  // Reserve up to 15% for stock tilts when calm
  const stockBudget =
    cash_pct <= 12 && (signals.core.find((c) => c.symbol === "QQQ")?.score || 0) >= 60
      ? 12
      : 0;

  let etfIdeas = allocateWeights(longs, cash_pct + stockBudget, risk);
  const stockIdeas = buildStockTilts(signals, risk, stockBudget);

  // If stocks added, shrink ETF weights proportionally to free budget
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
  // Fix rounding so buys + cash ≈ 100
  const buySum = buys.reduce((s, i) => s + i.weight_pct, 0);
  cash_pct = Math.round((100 - buySum) * 10) / 10;

  const sells: TradingIdea[] = sellsRaw.map((a) => ({
    symbol: a.symbol,
    name: a.label,
    asset_class: "etf",
    group: a.group,
    action: "sell",
    action_ko: "매도·회피",
    score: a.score,
    weight_pct: 0,
    rationale: a.drivers.slice(0, 3),
    change_20d_pct: a.change_20d_pct,
    excess_20d_vs_spy: a.excess_20d_vs_spy,
  }));

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
    ...signals.summary.slice(0, 2),
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
    target_weights: buys.map((b) => ({
      symbol: b.symbol,
      weight_pct: b.weight_pct,
      name: b.name,
    })),
  };
}

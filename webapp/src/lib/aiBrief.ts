/**
 * AI 시황 — Graph (cluster heat, node returns) + NLP (verdicts, headlines)
 * scored into buy/sell name candidates and ETF overlays for AI Pick.
 */

import {
  CHAIN_CLUSTERS,
  CHAIN_NODES,
  clusterHeat,
  fmtPct,
  neighborhoodIds,
  type ChainNodeView,
  type ChainPayload,
} from "@/lib/chainGraph";
import { NLP_UNIVERSE, type NlpNameCard, type NlpPulsePayload } from "@/lib/nlpPulse";

export type BriefMarket = "kr" | "us";

export type BriefCandidate = {
  id: string;
  symbol: string;
  name: string;
  market: BriefMarket;
  score: number;
  rationale: string[];
};

export type AiBrief = {
  comment: string;
  buys: BriefCandidate[];
  sells: BriefCandidate[];
  etfBoosts: Record<string, number>;
  etfSells: string[];
  cashDelta: number;
};

const CLUSTER_ETF: Record<string, string[]> = {
  gpu: ["SMH", "SOXX", "XLK"],
  memory: ["SMH", "SOXX"],
  auto: ["XLY"],
  cloud: ["XLK", "IGV", "QQQ"],
  finance: ["XLF"],
};

type Spec = {
  id: string;
  name: string;
  ticker: string;
  market: BriefMarket;
};

function clip(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function nameUniverse(): Spec[] {
  const m = new Map<string, Spec>();
  for (const n of CHAIN_NODES) {
    m.set(n.id, { id: n.id, name: n.name, ticker: n.ticker, market: n.market });
  }
  for (const n of NLP_UNIVERSE) {
    if (m.has(n.id)) continue;
    m.set(n.id, {
      id: n.id,
      name: n.name,
      ticker: n.ticker,
      market: n.market === "kospi200" ? "kr" : "us",
    });
  }
  return [...m.values()];
}

function clusterOf(id: string): { id: string; label: string } | null {
  const hub = CHAIN_CLUSTERS.find((c) => c.hub === id);
  if (hub) return { id: hub.id, label: hub.label };
  for (const c of CHAIN_CLUSTERS) {
    if (neighborhoodIds(c.hub, 2).has(id)) return { id: c.id, label: c.label };
  }
  return null;
}

function nlpCards(nlp: NlpPulsePayload | null): Map<string, NlpNameCard> {
  const m = new Map<string, NlpNameCard>();
  if (!nlp) return m;
  for (const c of [...nlp.kospi.names, ...nlp.spx.names]) m.set(c.id, c);
  return m;
}

function newsCount(nlp: NlpPulsePayload | null, id: string): number {
  if (!nlp) return 0;
  return [...nlp.feed, ...nlp.events, ...nlp.calls].filter((h) => h.name_id === id).length;
}

function scoreSpec(
  spec: Spec,
  node: ChainNodeView | undefined,
  card: NlpNameCard | undefined,
  clusterAvg: number | null,
  clusterLabel: string | null,
  headlines: number,
): BriefCandidate | null {
  if (!node && !card) return null;
  let s = 50;
  const rationale: string[] = [];

  if (card) {
    s += clip(card.score * 0.22, -22, 22);
    if (card.verdict === "friendly") {
      s += 8;
      rationale.push(`NLP ${card.verdict_ko} (${card.score.toFixed(0)})`);
    } else if (card.verdict === "cautious") {
      s -= 8;
      rationale.push(`NLP ${card.verdict_ko} (${card.score.toFixed(0)})`);
    } else if (Math.abs(card.score) >= 4) {
      rationale.push(`NLP 중립 (${card.score.toFixed(0)})`);
    }
  }

  if (node?.ret1d != null) {
    s += clip(node.ret1d, -5, 5) * 1.8;
    rationale.push(`그래프 1일 ${fmtPct(node.ret1d)}`);
  }
  if (node?.ret5d != null) {
    s += clip(node.ret5d, -8, 8) * 0.7;
    rationale.push(`5일 ${fmtPct(node.ret5d)}`);
  }
  if (clusterAvg != null && clusterLabel) {
    s += clip(clusterAvg, -3, 3) * 2.5;
    if (Math.abs(clusterAvg) >= 0.6) {
      rationale.push(`${clusterLabel} 클러스터 ${fmtPct(clusterAvg)}`);
    }
  }
  if (headlines > 0) {
    const signed = card && card.score < 0 ? -1.4 : 1.4;
    s += Math.min(headlines, 5) * signed;
    rationale.push(`뉴스 ${headlines}건`);
  }

  s = clip(Math.round(s * 10) / 10, 0, 100);
  if (!rationale.length) return null;
  return {
    id: spec.id,
    symbol: spec.ticker,
    name: spec.name,
    market: spec.market,
    score: s,
    rationale: rationale.slice(0, 3),
  };
}

function pickSide(rows: BriefCandidate[], side: "buy" | "sell"): BriefCandidate[] {
  const filtered =
    side === "buy"
      ? rows.filter((r) => r.score >= 63)
      : rows.filter((r) => r.score <= 40);
  const sorted =
    side === "buy"
      ? filtered.slice().sort((a, b) => b.score - a.score)
      : filtered.slice().sort((a, b) => a.score - b.score);
  const us = sorted.filter((r) => r.market === "us").slice(0, 4);
  const kr = sorted.filter((r) => r.market === "kr").slice(0, 3);
  const usIds = new Set(us.map((r) => r.id));
  return [...us, ...kr.filter((r) => !usIds.has(r.id))];
}

function mixNames(rows: BriefCandidate[], n: number): string[] {
  const us = rows.filter((r) => r.market === "us");
  const kr = rows.filter((r) => r.market === "kr");
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (out.length < n && (i < us.length || j < kr.length)) {
    if (i < us.length) out.push(us[i++]!.name);
    if (out.length < n && j < kr.length) out.push(kr[j++]!.name);
  }
  return out;
}

function buildComment(
  nlp: NlpPulsePayload | null,
  chain: ChainPayload | null,
  heat: ReturnType<typeof clusterHeat>,
  buys: BriefCandidate[],
  sells: BriefCandidate[],
): string {
  const parts: string[] = [];
  if (nlp?.ok) {
    parts.push(
      `NLP 국내 투심은 ${nlp.kospi.verdict_ko}(${nlp.kospi.score.toFixed(0)}), 미국은 ${nlp.spx.verdict_ko}(${nlp.spx.score.toFixed(0)})입니다.`,
    );
  }
  const withAvg = heat.filter((h) => h.avg1d != null);
  if (chain?.ok && withAvg.length) {
    const hot = [...withAvg].sort((a, b) => (b.avg1d || 0) - (a.avg1d || 0))[0]!;
    const cold = [...withAvg].sort((a, b) => (a.avg1d || 0) - (b.avg1d || 0))[0]!;
    const topNode = (chain.nodes || [])
      .filter((n) => n.ret1d != null)
      .slice()
      .sort((a, b) => Math.abs(b.ret1d || 0) - Math.abs(a.ret1d || 0))[0];
    let g = `그래프에서 ${hot.label} 클러스터가 1일 ${fmtPct(hot.avg1d)}로 가장 강합니다`;
    if (cold.id !== hot.id) {
      g = `그래프에서 ${hot.label} 클러스터가 1일 ${fmtPct(hot.avg1d)}로 가장 강하고, ${cold.label}은 ${fmtPct(cold.avg1d)}입니다`;
    }
    if (topNode?.ret1d != null) g += `. 노드로는 ${topNode.short} ${fmtPct(topNode.ret1d)}가 큽니다`;
    parts.push(g.endsWith(".") ? g : `${g}.`);
  }
  const buyNames = mixNames(buys, 4);
  const sellNames = mixNames(sells, 4);
  if (buyNames.length) parts.push(`매수 후보는 ${buyNames.join("·")}입니다.`);
  if (sellNames.length) parts.push(`회피 후보는 ${sellNames.join("·")}입니다.`);
  if (!parts.length) {
    return "그래프·NLP 시황을 아직 붙이지 못해, 기존 시그널 슬리브만 제안합니다.";
  }
  return parts.join(" ");
}

export function emptyAiBrief(comment?: string): AiBrief {
  return {
    comment: comment || "그래프·NLP 시황을 아직 붙이지 못해, 기존 시그널 슬리브만 제안합니다.",
    buys: [],
    sells: [],
    etfBoosts: {},
    etfSells: [],
    cashDelta: 0,
  };
}

/** Score Graph + NLP into 시황 comment, name candidates, and ETF overlays. */
export function buildAiBrief(
  nlp: NlpPulsePayload | null,
  chain: ChainPayload | null,
): AiBrief {
  if (!nlp?.ok && !chain?.ok) return emptyAiBrief();

  const cards = nlpCards(nlp);
  const nodes = new Map((chain?.nodes || []).map((n) => [n.id, n]));
  const heat = clusterHeat(chain?.nodes || []);
  const heatById = new Map(heat.map((h) => [h.id, h]));

  const scored: BriefCandidate[] = [];
  for (const spec of nameUniverse()) {
    const cl = clusterOf(spec.id);
    const h = cl ? heatById.get(cl.id) : undefined;
    const row = scoreSpec(
      spec,
      nodes.get(spec.id),
      cards.get(spec.id),
      h?.avg1d ?? null,
      cl?.label ?? null,
      newsCount(nlp, spec.id),
    );
    if (row) scored.push(row);
  }

  const buys = pickSide(scored, "buy");
  const sells = pickSide(scored, "sell").filter((s) => !buys.some((b) => b.id === s.id));

  const etfBoosts: Record<string, number> = {};
  const etfSells: string[] = [];
  const bump = (sym: string, delta: number) => {
    etfBoosts[sym] = (etfBoosts[sym] || 0) + delta;
  };
  for (const h of heat) {
    const etfs = CLUSTER_ETF[h.id] || [];
    if (!etfs.length || h.avg1d == null) continue;
    const hub = cards.get(h.hub);
    let delta = 0;
    if (h.avg1d >= 0.8) delta += 6;
    if (h.avg1d <= -0.8) delta -= 6;
    if (hub?.verdict === "friendly") delta += 4;
    if (hub?.verdict === "cautious") delta -= 4;
    if (!delta) continue;
    for (const sym of etfs) bump(sym, delta);
    if (delta <= -8) etfSells.push(...etfs);
  }
  if (nlp?.ok) {
    if (nlp.spx.verdict === "friendly") bump("QQQ", 4);
    if (nlp.spx.verdict === "cautious") bump("QQQ", -4);
  }

  let cashDelta = 0;
  if (nlp?.ok) {
    if (nlp.spx.verdict === "cautious" && nlp.kospi.verdict === "cautious") cashDelta += 6;
    else if (nlp.spx.verdict === "cautious") cashDelta += 4;
    else if (nlp.spx.verdict === "friendly" && nlp.kospi.verdict === "friendly") cashDelta -= 3;
  }

  return {
    comment: buildComment(nlp, chain, heat, buys, sells),
    buys,
    sells,
    etfBoosts,
    etfSells: [...new Set(etfSells)],
    cashDelta,
  };
}

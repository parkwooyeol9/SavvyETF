/**
 * 2026 midterm “tape”: one-line read that joins Polymarket chamber odds,
 * the matching event-study scenario, and partisan ETF spreads.
 */

import {
  ALL_SCENARIO_IDS,
  DEFAULT_GROUPING,
  DEFAULT_SCENARIO,
  MIDTERM_ELECTIONS,
  electionMatches,
  incumbentScenarioId,
  partyScenarioId,
  scenarioMeta,
  type ChamberParty,
  type GroupingId,
  type IncumbentScenarioId,
  type ScenarioId,
} from "@/lib/midtermStudy";
import type { PoliQuotePoint } from "@/lib/poliThemes";
import type { ChamberMarket, PowerSplit } from "@/lib/usMidterm";

/** Sitting president for the 2026 cycle. */
export const MIDTERM_PRESIDENT_PARTY: ChamberParty = "R";

export type ChamberLean = "D" | "R" | "toss";

export type TapeSpreadPoint = {
  date: string;
  label: string;
  value: number;
};

export type TapeSpreadSeries = {
  nanc_kruz: TapeSpreadPoint[];
  demz_maga: TapeSpreadPoint[];
};

export type PartisanHoldingFund = {
  symbol: "NANC" | "GOP" | "DEMZ" | "MAGA";
  name_ko: string;
  party: "D" | "R";
  pair: "stock-act" | "pac";
};

export const PARTISAN_HOLDING_FUNDS: PartisanHoldingFund[] = [
  { symbol: "NANC", name_ko: "민주 의원 매매", party: "D", pair: "stock-act" },
  { symbol: "GOP", name_ko: "공화 의원 매매 (구 KRUZ)", party: "R", pair: "stock-act" },
  { symbol: "DEMZ", name_ko: "민주 PAC 대형주", party: "D", pair: "pac" },
  { symbol: "MAGA", name_ko: "공화 America First", party: "R", pair: "pac" },
];

const TOSS_GAP = 0.03;

const POWER_CHAMBERS: Record<string, { house: ChamberParty; senate: ChamberParty }> = {
  "d-sweep": { house: "D", senate: "D" },
  "split-d-house": { house: "D", senate: "R" },
  "split-d-senate": { house: "R", senate: "D" },
  "r-sweep": { house: "R", senate: "R" },
};

export function parseScenarioId(raw: string | null | undefined): ScenarioId | null {
  const v = (raw || "").trim();
  if ((ALL_SCENARIO_IDS as string[]).includes(v)) return v as ScenarioId;
  return null;
}

export function parseGroupingId(raw: string | null | undefined): GroupingId | null {
  if (raw === "incumbent" || raw === "party") return raw;
  return null;
}

export function groupingForScenario(id: ScenarioId): GroupingId {
  if (id === "all") return DEFAULT_GROUPING;
  if (id.startsWith("inc_")) return "incumbent";
  return "party";
}

export function chamberLean(dem?: number | null, gop?: number | null): ChamberLean {
  if (dem == null || gop == null) return "toss";
  if (Math.abs(dem - gop) < TOSS_GAP) return "toss";
  return dem > gop ? "D" : "R";
}

export function topPowerSplit(power?: PowerSplit[] | null): PowerSplit | null {
  const rows = (power || []).filter((p) => p.probability != null);
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0] ?? null;
}

export function impliedChambers(
  senate?: ChamberMarket | null,
  house?: ChamberMarket | null,
  power?: PowerSplit[] | null,
): { house: ChamberParty; senate: ChamberParty; from: "power" | "chambers" | "status-quo" } {
  const top = topPowerSplit(power);
  const mapped = top ? POWER_CHAMBERS[top.id] : undefined;
  if (mapped) return { ...mapped, from: "power" };

  const sLean = chamberLean(senate?.dem_prob, senate?.gop_prob);
  const hLean = chamberLean(house?.dem_prob, house?.gop_prob);
  if (sLean === "toss" && hLean === "toss") {
    return { house: "R", senate: "R", from: "status-quo" };
  }
  return {
    house: hLean === "toss" ? "R" : hLean,
    senate: sLean === "toss" ? "R" : sLean,
    from: "chambers",
  };
}

export function impliedIncumbentScenario(
  senate?: ChamberMarket | null,
  house?: ChamberMarket | null,
  power?: PowerSplit[] | null,
): IncumbentScenarioId {
  const implied = impliedChambers(senate, house, power);
  return incumbentScenarioId(MIDTERM_PRESIDENT_PARTY, implied.house, implied.senate);
}

export function impliedPartyScenario(
  senate?: ChamberMarket | null,
  house?: ChamberMarket | null,
  power?: PowerSplit[] | null,
): ScenarioId {
  const implied = impliedChambers(senate, house, power);
  return partyScenarioId(implied.house, implied.senate);
}

export function sampleYears(scenario: ScenarioId): number[] {
  return MIDTERM_ELECTIONS.filter((e) => electionMatches(e, scenario)).map((e) =>
    Number(e.date.slice(0, 4)),
  );
}

export function spreadLean(spread: number | null | undefined, dead = 0.4): "D" | "R" | "flat" {
  if (spread == null || Number.isNaN(spread) || Math.abs(spread) < dead) return "flat";
  return spread > 0 ? "D" : "R";
}

function partyKo(p: ChamberParty | ChamberLean): string {
  if (p === "toss") return "경합";
  return p === "D" ? "민주" : "공화";
}

function fmtProb(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function fmtSpread(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function alignKey(p: PoliQuotePoint): string {
  if (p.date.includes("T") && p.date.length >= 16) return p.date.slice(0, 16);
  return p.date.slice(0, 10);
}

/** Rebased relative spread: (A/A0 − 1) − (B/B0 − 1), in percentage points. */
export function relativeSpreadSeries(
  a?: PoliQuotePoint[] | null,
  b?: PoliQuotePoint[] | null,
): TapeSpreadPoint[] {
  if (!a?.length || !b?.length) return [];
  const bMap = new Map(b.map((p) => [alignKey(p), p]));
  const paired: Array<{ date: string; label: string; ac: number; bc: number }> = [];
  for (const p of a) {
    const q = bMap.get(alignKey(p));
    if (!q) continue;
    paired.push({ date: p.date, label: p.label, ac: p.close, bc: q.close });
  }
  if (paired.length < 2) return [];
  const a0 = paired[0]!.ac;
  const b0 = paired[0]!.bc;
  if (!a0 || !b0) return [];
  return paired.map((p) => ({
    date: p.date,
    label: p.label,
    value: Math.round(((p.ac / a0 - 1) * 100 - (p.bc / b0 - 1) * 100) * 100) / 100,
  }));
}

export function buildSpreadSeries(args: {
  nanc?: PoliQuotePoint[] | null;
  gop?: PoliQuotePoint[] | null;
  kruz?: PoliQuotePoint[] | null;
  demz?: PoliQuotePoint[] | null;
  maga?: PoliQuotePoint[] | null;
}): TapeSpreadSeries {
  return {
    nanc_kruz: relativeSpreadSeries(args.nanc, args.gop || args.kruz),
    demz_maga: relativeSpreadSeries(args.demz, args.maga),
  };
}

export type MidtermTape = {
  headline: string;
  sub: string;
  bullets: string[];
  scenario: IncumbentScenarioId;
  grouping: GroupingId;
  scenarioLabel: string;
  scenarioSub: string;
  years: number[];
  house: ChamberParty;
  senate: ChamberParty;
  senateLean: ChamberLean;
  houseLean: ChamberLean;
  nancLean: "D" | "R" | "flat";
  demzLean: "D" | "R" | "flat";
  diverge: boolean;
};

export type TapeInputs = {
  senate?: ChamberMarket | null;
  house?: ChamberMarket | null;
  power?: PowerSplit[] | null;
  nanc_kruz_spread?: number | null;
  demz_maga_spread?: number | null;
  rangeLabel?: string;
};

export function buildMidtermTape(input: TapeInputs): MidtermTape {
  const implied = impliedChambers(input.senate, input.house, input.power);
  const scenario = incumbentScenarioId(
    MIDTERM_PRESIDENT_PARTY,
    implied.house,
    implied.senate,
  );
  const meta = scenarioMeta(scenario);
  const years = sampleYears(scenario);
  const sLean = chamberLean(input.senate?.dem_prob, input.senate?.gop_prob);
  const hLean = chamberLean(input.house?.dem_prob, input.house?.gop_prob);
  const nancLean = spreadLean(input.nanc_kruz_spread);
  const demzLean = spreadLean(input.demz_maga_spread);
  const rangeLabel = input.rangeLabel || "기간";
  const top = topPowerSplit(input.power);

  const chamberLine = `상원 ${partyKo(sLean)} ${fmtProb(sLean === "D" ? input.senate?.dem_prob : input.senate?.gop_prob)} · 하원 ${partyKo(hLean)} ${fmtProb(hLean === "D" ? input.house?.dem_prob : input.house?.gop_prob)}`;

  const powerBit = top?.label_ko
    ? `예측시장 최우선은 「${top.label_ko}」${top.probability != null ? ` (${fmtProb(top.probability)})` : ""}.`
    : `예측시장은 상원 ${partyKo(implied.senate)} · 하원 ${partyKo(implied.house)}을 가격한다.`;

  const yearBit = years.length ? ` (${years.join("·")})` : "";
  const headline = `${powerBit} 공화 대통령 기준으로는 스터디의 「${meta?.label ?? scenario}」${yearBit}.`;

  const nancLine = `NANC−GOP ${rangeLabel} ${fmtSpread(input.nanc_kruz_spread)}${
    nancLean === "flat" ? " · 방향 없음" : nancLean === "D" ? " · 민주 의원 바스켓 우위" : " · 공화 의원 바스켓 우위"
  }`;
  const demzLine = `DEMZ−MAGA ${rangeLabel} ${fmtSpread(input.demz_maga_spread)}${
    demzLean === "flat" ? "" : demzLean === "D" ? " · PAC 바스켓도 민주" : " · PAC 바스켓은 공화"
  }`;

  const pricedDemSweep = implied.house === "D" && implied.senate === "D";
  const pricedGopOnly = implied.house === "R" && implied.senate === "R";
  const diverge =
    (nancLean === "D" && pricedGopOnly) || (nancLean === "R" && pricedDemSweep);

  const sub = diverge
    ? "의원 매매 바스켓과 예측시장 방향이 갈린다. 스프레드는 선거 승자가 아니라 담은 주식의 상대성과다."
    : "예측시장이 가격하는 분할과 스터디 기본 시나리오를 같은 카드에서 본다.";

  return {
    headline,
    sub,
    bullets: [chamberLine, nancLine, demzLine].filter(Boolean),
    scenario,
    grouping: "incumbent",
    scenarioLabel: meta?.label ?? scenario,
    scenarioSub: meta?.sub ?? "",
    years,
    house: implied.house,
    senate: implied.senate,
    senateLean: sLean,
    houseLean: hLean,
    nancLean,
    demzLean,
    diverge,
  };
}

export function navShellTab(
  tab: string,
  extra?: { scenario?: string; grouping?: string },
): void {
  if (typeof window === "undefined") return;
  const detail = extra ? { tab, ...extra } : tab;
  window.dispatchEvent(new CustomEvent("savvyetf-nav-tab", { detail }));
}

export function goMidtermStudy(scenario: ScenarioId = DEFAULT_SCENARIO, grouping: GroupingId = "incumbent"): void {
  navShellTab("midtermstudy", { scenario, grouping });
}

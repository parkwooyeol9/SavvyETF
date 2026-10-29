/**
 * AI Pick — rule-based buy/sell picks built only from data the repo and R2 already hold.
 *
 *   ETF   : listing-market universe snapshots (+ R2 `etf_universe_px` 1W/1M/3M/1Y overlay),
 *           grouped by country / sector / theme, adjusted by the weekly ETF Flow snapshot.
 *   Stocks: ACWI constituents in Korea · US · Japan — trend facts (acwiTechFacts.json),
 *           daily-close timing from R2 `acwi_px` (RSI · MA · MACD · Bollinger z),
 *           and KOSPI200 news NLP scores from R2 `kospi200_panel`.
 *
 * Pure functions only; loading lives in `aiPickData.ts`.
 */

import type { AcwiTechFacts, AcwiUniverseRow } from "@/lib/acwiTech";
import type { EtfFlowWeeklyPayload } from "@/lib/etfFlowWeekly";
import type { EtfUniverseFile, EtfUniverseRow } from "@/lib/etfUniverse";
import type { QuantSnapshot } from "@/lib/quantDesk";

export type PickAction = "buy" | "sell";
export type ChipTone = "up" | "down" | "flat";

export type PickChip = { label: string; tone: ChipTone; title?: string };

export type AiPick = {
  key: string;
  action: PickAction;
  /** Group label (ETF) or company name (stock). */
  title: string;
  /** Representative ETF / ticker line. */
  sub: string;
  ticker: string;
  score: number;
  chips: PickChip[];
  /** Date of the main data behind the pick. */
  as_of: string | null;
  note: string;
};

export type EtfDim = "country" | "sector" | "theme";
export const ETF_DIM_LABEL: Record<EtfDim, string> = {
  country: "국가별",
  sector: "업종별",
  theme: "테마별",
};

export type EtfPickMarket = "kr" | "us" | "jp";
export const ETF_PICK_MARKETS: EtfPickMarket[] = ["kr", "us", "jp"];
export const ETF_PICK_MARKET_LABEL: Record<EtfPickMarket, string> = {
  kr: "한국 상장",
  us: "미국 상장",
  jp: "일본 상장",
};

export type EtfDimPicks = { buys: AiPick[]; sells: AiPick[]; groups: number };

export type EtfMarketPicks = {
  market: EtfPickMarket;
  label: string;
  snapshot_as_of: string | null;
  returns_as_of: string | null;
  dims: Record<EtfDim, EtfDimPicks>;
};

export type StockCountry = "한국" | "미국" | "일본";
export const STOCK_COUNTRIES: StockCountry[] = ["한국", "미국", "일본"];

export type StockCountryPicks = {
  country: StockCountry;
  universe: number;
  with_px: number;
  with_nlp: number;
  buys: AiPick[];
  sells: AiPick[];
};

export type AiPickSource = { label: string; as_of: string | null; ok: boolean; note?: string };

export type AiPickPayload = {
  ok: boolean;
  generated_at: string;
  etf: { markets: EtfMarketPicks[]; flow_as_of: string | null };
  stocks: {
    facts_as_of: string | null;
    px_as_of: string | null;
    nlp_as_of: string | null;
    countries: StockCountryPicks[];
  };
  sources: AiPickSource[];
  methodology: { etf: string[]; stock: string[] };
  disclaimer: string;
  error?: string;
};

export const AI_PICK_DISCLAIMER =
  "규칙 기반 자동 선별입니다. 투자 권유나 자문이 아니며, 기준일이 다른 데이터가 섞여 있으니 각 Pick의 기준일을 확인하세요.";

export const AI_PICK_METHOD = {
  etf: [
    "대상: 상장시장별 ETF 유니버스 중 레버리지·인버스 제외. 국가(노출 지역)·업종(섹터)·테마(이름·스타일 키워드)로 묶음",
    "그룹 수익률: 소속 ETF의 1W·1M·3M·1Y를 √AUM 가중 평균. 대표 ETF = AUM 최대",
    "점수 = 같은 구분 안 순위로 3M 40% + 1Y(없으면 6M) 30% + 1M 30%, 0~100",
    "수급 가감(±8): 미국 ETF 주간 Flow 테마 4주 순유입, 미국 상장은 순유입·유출 상위 티커, 한국 상장은 기관+외국인 순매수",
    "매수: 점수 ≥ 65 · 1M > 0 · 3M > 0 · 단기 과열 아님(1W ≥ +8% 또는 1M ≥ +20%이면 제외)",
    "매도: 점수 ≤ 35 · 1M < 0 · 3M < 0",
  ],
  stock: [
    "대상: MSCI ACWI 구성 종목 중 한국·미국·일본",
    "추세: 종가·이평·MACD·RSI·3개월 수익률 6조건 충족 수(추세 n/6), 12개월 수익률 국가 내 순위, 52주 고점 대비",
    "밸류: PER 3년 백분위가 95 이상이면 감점, 20 이하이면 가점. ROE 15% 이상 가점",
    "타이밍(일봉 저장분이 있는 종목): RSI·볼린저 z·MA22·MACD로 매수/관망/매도 판정 후 ±15",
    "뉴스(한국, KOSPI200 패널): NLP 점수 +20 초과 가점, −20 미만 감점",
    "매수: 점수 ≥ 65 · 추세 ≥ 4/6 · 타이밍이 매도 아님. 매도: 점수 ≤ 35 · 추세 ≤ 2/6, 또는 타이밍 매도 + 추세 ≤ 3/6",
  ],
};

const PICKS_PER_SIDE = 5;

/* ------------------------------------------------------------------ helpers */

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round(v: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function fmtSignedPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function toneOf(v: number | null | undefined, eps = 0): ChipTone {
  if (v == null || Math.abs(v) <= eps) return "flat";
  return v > 0 ? "up" : "down";
}

/** Percentile rank in [0, 1]; null when the value is missing. */
function rankMap<T>(items: T[], value: (item: T) => number | null): Map<T, number> {
  const present = items.filter((i) => value(i) != null);
  const sorted = [...present].sort((a, b) => value(a)! - value(b)!);
  const out = new Map<T, number>();
  const n = sorted.length;
  sorted.forEach((item, i) => out.set(item, n <= 1 ? 0.5 : i / (n - 1)));
  return out;
}

function shortDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1]! : null;
}

/* ------------------------------------------------------------------ ETF */

type EtfRow = EtfUniverseRow & { aum: number };

export function etfRows(file: EtfUniverseFile): EtfRow[] {
  const cols = file.cols;
  const out: EtfRow[] = [];
  for (const raw of file.rows) {
    const row = Object.fromEntries(cols.map((c, i) => [c, raw[i] ?? null])) as unknown as EtfUniverseRow;
    if (row.lev && row.lev !== "일반") continue;
    const aum = num(row.aum);
    if (aum == null || aum <= 0) continue;
    out.push({ ...row, aum });
  }
  return out;
}

type ThemeDef = { label: string; pattern?: RegExp; styles?: string[] };

const THEMES: ThemeDef[] = [
  { label: "반도체", pattern: /반도체|semicond|\bSOX|\bchip/i, styles: ["반도체"] },
  { label: "AI·빅테크", pattern: /\bAI\b|인공지능|artificial intel|빅테크|big tech|FANG/i, styles: ["테크·AI"] },
  { label: "2차전지", pattern: /2차전지|이차전지|배터리|battery|lithium|리튬/i },
  { label: "방산·우주", pattern: /방산|방위|defen[cs]e|aerospace|우주|space/i },
  { label: "원자력", pattern: /원자력|원전|nuclear|uranium|우라늄|\bSMR/i },
  { label: "조선", pattern: /조선|shipbuild|해운/i },
  { label: "바이오", pattern: /바이오|biotech|genomic|제약|pharma/i },
  { label: "로봇", pattern: /로봇|robot|휴머노이드|humanoid|자동화|automation/i },
  { label: "클린에너지", pattern: /수소|태양광|clean energy|solar|신재생|renewable|hydrogen|wind/i },
  { label: "전력·인프라", pattern: /전력|grid|infrastructure|인프라|utilities power/i },
  { label: "사이버보안", pattern: /사이버|cyber|security|보안/i },
  { label: "인터넷·플랫폼", pattern: /인터넷|플랫폼|internet|소프트웨어|software|cloud|클라우드/i },
  { label: "게임·엔터", pattern: /게임|엔터|컬처|미디어|gaming|esports|entertain/i },
  { label: "금융·은행", pattern: /은행|bank|증권|보험|insur/i },
  { label: "리츠", pattern: /리츠|REIT|부동산|real estate/i },
  { label: "금", pattern: /금현물|골드|\bgold\b|\bKRX금|금선물/i },
  { label: "가상자산", pattern: /비트코인|이더리움|bitcoin|ether|crypto|가상자산|블록체인|blockchain/i, styles: ["가상자산"] },
  { label: "배당", pattern: /배당|dividend/i, styles: ["배당"] },
  { label: "커버드콜", pattern: /커버드콜|covered call|buywrite|premium income/i, styles: ["커버드콜·옵션"] },
];

const COUNTRY_SKIP = new Set(["국내·해외 혼합", "글로벌", "글로벌(미국 제외)"]);

type Group = {
  dim: EtfDim;
  label: string;
  members: EtfRow[];
  rep: EtfRow;
  r1w: number | null;
  r1m: number | null;
  r3m: number | null;
  rlong: number | null;
  longLabel: "1Y" | "6M";
  aum: number;
};

function weightedAvg(rows: EtfRow[], key: keyof EtfUniverseRow): number | null {
  let sum = 0;
  let w = 0;
  for (const r of rows) {
    const v = num(r[key]);
    if (v == null) continue;
    const weight = Math.sqrt(r.aum);
    sum += v * weight;
    w += weight;
  }
  return w > 0 ? sum / w : null;
}

function buildGroup(dim: EtfDim, label: string, members: EtfRow[]): Group | null {
  const priced = members.filter((m) => num(m.r1m) != null || num(m.r3m) != null);
  if (!priced.length) return null;
  const rep = [...priced].sort((a, b) => b.aum - a.aum)[0]!;
  const r1y = weightedAvg(priced, "r1y");
  const r6m = weightedAvg(priced, "r6m");
  return {
    dim,
    label,
    members: priced,
    rep,
    r1w: weightedAvg(priced, "r1w"),
    r1m: weightedAvg(priced, "r1m"),
    r3m: weightedAvg(priced, "r3m"),
    rlong: r1y ?? r6m,
    longLabel: r1y != null ? "1Y" : "6M",
    aum: priced.reduce((s, m) => s + m.aum, 0),
  };
}

/** Smallest group AUM worth ranking: 300억원 (kr, 억원), $1B (us, $M), $300M (jp, $M). Drops one-fund micro groups. */
const MIN_GROUP_AUM: Record<EtfPickMarket, number> = { kr: 300, us: 1000, jp: 300 };

function groupsFor(rows: EtfRow[], dim: EtfDim, market: EtfPickMarket): Group[] {
  const buckets = new Map<string, EtfRow[]>();
  const add = (label: string, row: EtfRow) => {
    const list = buckets.get(label);
    if (list) list.push(row);
    else buckets.set(label, [row]);
  };
  for (const row of rows) {
    if (dim === "country") {
      if (row.ac !== "주식" || !row.reg || COUNTRY_SKIP.has(row.reg)) continue;
      add(row.reg, row);
    } else if (dim === "sector") {
      if (row.ac !== "주식" || !row.sec || row.sec === "시장 전체(분산)") continue;
      add(row.sec, row);
    } else {
      const name = `${row.n || ""} ${row.bm || ""}`;
      for (const t of THEMES) {
        const byStyle = !!row.st && !!t.styles?.includes(row.st);
        if (byStyle || (t.pattern && t.pattern.test(name))) add(t.label, row);
      }
    }
  }
  const out: Group[] = [];
  for (const [label, members] of buckets) {
    const g = buildGroup(dim, label, members);
    if (g && g.aum >= MIN_GROUP_AUM[market]) out.push(g);
  }
  return out;
}

/** Flow evidence for one group, in $B (US themes / tickers) or 억원 (KR investors). */
type FlowHit = { value: number; unit: "$B" | "억원"; label: string };

/** US ETF Flow theme names → the AI Pick group they speak for. */
const FLOW_THEME_ALIAS: Record<string, { dim: EtfDim; label: string }> = {
  "미국 대형주(S&P500)": { dim: "country", label: "미국" },
  "중국 주식": { dim: "country", label: "중국" },
  에너지: { dim: "sector", label: "에너지" },
  반도체: { dim: "theme", label: "반도체" },
  금: { dim: "theme", label: "금" },
  "미국 배당주": { dim: "theme", label: "배당" },
  디지털자산: { dim: "theme", label: "가상자산" },
};

export type FlowIndex = {
  themes: Map<string, number>;
  usTicker: Map<string, number>;
  krCode: Map<string, number>;
};

export function flowIndex(flow: EtfFlowWeeklyPayload | null): FlowIndex {
  const themes = new Map<string, number>();
  const usTicker = new Map<string, number>();
  const krCode = new Map<string, number>();
  if (flow?.ok !== false && flow) {
    for (const t of flow.us?.themes || []) {
      const alias = FLOW_THEME_ALIAS[t.name];
      if (!alias) continue;
      const total = (t.weekly || []).reduce((s, v) => s + (num(v) ?? 0), 0);
      themes.set(`${alias.dim}:${alias.label}`, total);
    }
    for (const r of [...(flow.us?.top_in || []), ...(flow.us?.top_out || [])]) {
      if (r.ticker && num(r.flow_w) != null) usTicker.set(r.ticker, r.flow_w);
    }
    for (const r of [...(flow.kr?.indiv_buy || []), ...(flow.kr?.indiv_sell || [])]) {
      if (r.code) krCode.set(r.code, (num(r.inst) ?? 0) + (num(r.foreign) ?? 0));
    }
  }
  return { themes, usTicker, krCode };
}

function flowFor(g: Group, market: EtfPickMarket, idx: FlowIndex): FlowHit[] {
  const hits: FlowHit[] = [];
  const theme = idx.themes.get(`${g.dim}:${g.label}`);
  if (theme != null && Math.abs(theme) >= 0.2) {
    hits.push({ value: theme, unit: "$B", label: "미국 ETF 4주" });
  }
  if (market === "us") {
    let sum = 0;
    let n = 0;
    for (const m of g.members) {
      const v = idx.usTicker.get(m.t);
      if (v != null) {
        sum += v;
        n++;
      }
    }
    if (n) hits.push({ value: sum, unit: "$B", label: "주간 순유입 상위" });
  } else if (market === "kr") {
    let sum = 0;
    let n = 0;
    for (const m of g.members) {
      const v = idx.krCode.get(m.t);
      if (v != null) {
        sum += v;
        n++;
      }
    }
    if (n && Math.abs(sum) >= 10) hits.push({ value: sum, unit: "억원", label: "기관+외국인" });
  }
  return hits;
}

function fmtFlow(h: FlowHit): string {
  const sign = h.value > 0 ? "+" : "";
  return h.unit === "$B"
    ? `${h.label} ${sign}$${h.value.toFixed(1)}B`
    : `${h.label} ${sign}${Math.round(h.value).toLocaleString("ko-KR")}억`;
}

function etfDimPicks(
  groups: Group[],
  market: EtfPickMarket,
  flow: FlowIndex,
  asOf: string | null,
): EtfDimPicks {
  const r3 = rankMap(groups, (g) => g.r3m);
  const rl = rankMap(groups, (g) => g.rlong);
  const r1 = rankMap(groups, (g) => g.r1m);
  const scored = groups.map((g) => {
    const parts: Array<[number | undefined, number]> = [
      [r3.get(g), 0.4],
      [rl.get(g), 0.3],
      [r1.get(g), 0.3],
    ];
    let s = 0;
    let w = 0;
    for (const [v, wt] of parts) {
      if (v == null) continue;
      s += v * wt;
      w += wt;
    }
    const base = w > 0 ? (s / w) * 100 : 50;
    const hits = flowFor(g, market, flow);
    const flowSign = Math.sign(hits.reduce((acc, h) => acc + Math.sign(h.value), 0));
    const score = Math.max(0, Math.min(100, base + flowSign * 8));
    const hot = (g.r1w != null && g.r1w >= 8) || (g.r1m != null && g.r1m >= 20);
    return { g, score, hits, hot };
  });

  const toPick = (x: (typeof scored)[number], action: PickAction): AiPick => {
    const { g } = x;
    const chips: PickChip[] = [];
    if (g.r1w != null) chips.push({ label: `1W ${fmtSignedPct(g.r1w)}`, tone: toneOf(g.r1w) });
    if (g.r1m != null) chips.push({ label: `1M ${fmtSignedPct(g.r1m)}`, tone: toneOf(g.r1m) });
    if (g.r3m != null) chips.push({ label: `3M ${fmtSignedPct(g.r3m)}`, tone: toneOf(g.r3m) });
    if (g.rlong != null) chips.push({ label: `${g.longLabel} ${fmtSignedPct(g.rlong)}`, tone: toneOf(g.rlong) });
    for (const h of x.hits) chips.push({ label: fmtFlow(h), tone: toneOf(h.value), title: "ETF Flow 주간 스냅샷" });
    const rep = g.rep;
    const repLine = `${rep.n} (${rep.t})`;
    const note =
      action === "buy"
        ? `${g.members.length}개 ETF 평균 기준 중기 추세 상위${x.hits.some((h) => h.value > 0) ? ", 자금 유입 동반" : ""}`
        : `${g.members.length}개 ETF 평균 기준 중기 추세 하위${x.hits.some((h) => h.value < 0) ? ", 자금 유출 동반" : ""}`;
    return {
      key: `${market}-${g.dim}-${g.label}-${action}`,
      action,
      title: g.label,
      sub: repLine,
      ticker: rep.t,
      score: round(x.score),
      chips,
      as_of: asOf,
      note,
    };
  };

  const buys = scored
    .filter((x) => x.score >= 65 && (x.g.r1m ?? 0) > 0 && (x.g.r3m ?? 0) > 0 && !x.hot)
    .sort((a, b) => b.score - a.score)
    .slice(0, PICKS_PER_SIDE)
    .map((x) => toPick(x, "buy"));
  const sells = scored
    .filter((x) => x.score <= 35 && (x.g.r1m ?? 0) < 0 && (x.g.r3m ?? 0) < 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, PICKS_PER_SIDE)
    .map((x) => toPick(x, "sell"));
  return { buys, sells, groups: groups.length };
}

export function buildEtfMarketPicks(
  market: EtfPickMarket,
  file: EtfUniverseFile,
  flow: FlowIndex,
): EtfMarketPicks {
  const rows = etfRows(file);
  const asOf = shortDate(file.returns_as_of) ?? shortDate(file.as_of);
  const dims = {} as Record<EtfDim, EtfDimPicks>;
  for (const dim of ["country", "sector", "theme"] as EtfDim[]) {
    dims[dim] = etfDimPicks(groupsFor(rows, dim, market), market, flow, asOf);
  }
  return {
    market,
    label: ETF_PICK_MARKET_LABEL[market],
    snapshot_as_of: shortDate(file.as_of),
    returns_as_of: shortDate(file.returns_as_of),
    dims,
  };
}

/* ------------------------------------------------------------------ stocks */

export type StockInput = {
  row: AcwiUniverseRow;
  facts: AcwiTechFacts | null;
  snap: QuantSnapshot | null;
  /** News NLP score (−100…100) and its date. */
  nlp: { score: number; n: number; date: string | null } | null;
};

function tickerOf(row: AcwiUniverseRow): string {
  return row.yahoo.replace(/\.(KS|KQ|T)$/i, "");
}

export function buildStockPicks(
  country: StockCountry,
  inputs: StockInput[],
  dates: { facts: string | null; px: string | null; nlp: string | null },
): StockCountryPicks {
  const r12 = rankMap(inputs, (x) => num(x.facts?.r12m));
  const scored = inputs
    .filter((x) => x.facts && num(x.facts.ts) != null)
    .map((x) => {
      const f = x.facts!;
      const ts = f.ts!;
      const chips: PickChip[] = [];
      let score = (ts / 6) * 55;
      chips.push({ label: `추세 ${ts.toFixed(0)}/6`, tone: ts >= 4 ? "up" : ts <= 2 ? "down" : "flat", title: "종가·이평·MACD·RSI·3개월 수익률 6조건" });
      const rk = r12.get(x);
      if (rk != null) score += rk * 15;
      if (num(f.r12m) != null) chips.push({ label: `12M ${fmtSignedPct(f.r12m)}`, tone: toneOf(f.r12m) });
      const dd = num(f.dd52);
      if (dd != null) {
        if (dd > -10) score += 5;
        else if (dd < -30) score -= 5;
        chips.push({ label: `52주고점 ${fmtSignedPct(dd)}`, tone: dd > -10 ? "up" : dd < -30 ? "down" : "flat" });
      }
      const pep = num(f.pep);
      if (pep != null) {
        if (pep >= 95) score -= 8;
        else if (pep <= 20) score += 5;
        if (pep >= 95 || pep <= 20) {
          chips.push({ label: `PER 3년 ${pep.toFixed(0)}%ile`, tone: pep >= 95 ? "down" : "up", title: "0 = 최근 3년 중 가장 낮은 PER" });
        }
      }
      const roe = num(f.roe);
      if (roe != null && roe >= 15) {
        score += 5;
        chips.push({ label: `ROE ${roe.toFixed(0)}%`, tone: "up" });
      }
      const snap = x.snap;
      if (snap) {
        if (snap.timing === "buy") score += 15;
        else if (snap.timing === "sell") score -= 15;
        if (snap.momentum === "up") score += 5;
        else if (snap.momentum === "down") score -= 5;
        chips.push({
          label: `일봉 ${snap.timing_ko} · ${snap.momentum_ko}/${snap.stretch_ko}`,
          tone: snap.timing === "buy" ? "up" : snap.timing === "sell" ? "down" : "flat",
          title: snap.timing_comment,
        });
        if (snap.rsi != null) chips.push({ label: `RSI ${snap.rsi.toFixed(0)}`, tone: snap.rsi >= 70 ? "down" : snap.rsi <= 30 ? "up" : "flat" });
        if (snap.ret_20d != null) chips.push({ label: `20D ${fmtSignedPct(snap.ret_20d)}`, tone: toneOf(snap.ret_20d) });
      }
      if (x.nlp) {
        if (x.nlp.score > 20) score += 5;
        else if (x.nlp.score < -20) score -= 5;
        chips.push({
          label: `뉴스 ${x.nlp.score > 0 ? "+" : ""}${x.nlp.score.toFixed(0)} (${x.nlp.n}건)`,
          tone: x.nlp.score > 20 ? "up" : x.nlp.score < -20 ? "down" : "flat",
          title: "KOSPI200 패널 NLP 점수",
        });
      }
      return { x, ts, score: Math.max(0, Math.min(100, score)), chips };
    });

  const toPick = (s: (typeof scored)[number], action: PickAction): AiPick => {
    const { x } = s;
    const timing = x.snap?.timing_ko;
    const note = `추세 ${s.ts}/6${timing ? `, 일봉 ${timing}` : ", 일봉 저장분 없음"}${x.nlp ? `, 뉴스 ${x.nlp.score.toFixed(0)}` : ""}`;
    return {
      key: `${country}-${x.row.ric}-${action}`,
      action,
      title: x.row.name,
      sub: `${tickerOf(x.row)} · ${x.row.sector} · ACWI ${x.row.weight >= 0.0001 ? `${(x.row.weight * 100).toFixed(2)}%` : "<0.01%"}`,
      ticker: tickerOf(x.row),
      score: round(s.score),
      chips: s.chips,
      as_of: x.snap ? (dates.px ?? dates.facts) : dates.facts,
      note,
    };
  };

  const byWeight = (a: (typeof scored)[number], b: (typeof scored)[number]) => b.x.row.weight - a.x.row.weight;
  const buys = scored
    .filter((s) => s.score >= 65 && s.ts >= 4 && s.x.snap?.timing !== "sell")
    .sort((a, b) => b.score - a.score || byWeight(a, b))
    .slice(0, PICKS_PER_SIDE)
    .map((s) => toPick(s, "buy"));
  const sells = scored
    .filter((s) => (s.score <= 35 && s.ts <= 2) || (s.x.snap?.timing === "sell" && s.ts <= 3))
    .sort((a, b) => a.score - b.score || byWeight(a, b))
    .slice(0, PICKS_PER_SIDE)
    .map((s) => toPick(s, "sell"));
  return {
    country,
    universe: inputs.length,
    with_px: inputs.filter((x) => x.snap).length,
    with_nlp: inputs.filter((x) => x.nlp).length,
    buys,
    sells,
  };
}

/**
 * MP-ETF배분 analytics (server): USD total-return NAV from dated ETF target
 * versions vs a 60/30/10 multi-asset benchmark (ACWI / Global Agg / commodity-
 * REIT-bitcoin), asset-class Brinson, equity-only country allocation vs MSCI
 * ACWI (look-through), sector look-through, bond duration / credit, multi-asset
 * factors and returns-based asset mix.
 * Prices: Yahoo adjclose (distributions reinvested).
 */

import { countryLabelKo, fetchIsharesBreakdown, loadPrevSnap, type IsharesBreakdown } from "@/lib/countryEtf";
import {
  addDays,
  alignTo,
  cachedLookup,
  drawdowns,
  factorRegression,
  fetchDaily,
  grapLinks,
  isIntradayBar,
  isNum,
  mapPool,
  metricSet,
  monthDay,
  monthlyReturns,
  numOrNull,
  ols,
  periodReturns,
  pick,
  quoteSummary,
  relativeMetrics,
  rfDailyFrom,
  rollingStyle,
  sgn,
  splitNotes,
  styleFit,
  toReturns,
  weeklyIndex,
  type Daily,
  type MpMetricSet,
  type MpPeriodReturn,
  type MpRegression,
  type MpRelativeMetrics,
  type MpStyleRegression,
  type MpWeeklyMover,
} from "@/lib/mpCore";
import {
  altSubOf,
  bmLabel,
  ETF_BM_DURATION,
  etfHoldingKey,
  etfMeta,
  etfYahooSymbol,
  normalizeBm,
  normalizeEtfTicker,
  sortedEtfVersions,
  type EtfAltSub,
  type EtfAsset,
  type EtfBm,
  type EtfHolding,
  type EtfPortfolio,
} from "@/lib/mpEtfPortfolio";
import { MP_SECTORS, mpSectorLabel, type MpSectorKey } from "@/lib/mpPortfolio";

const ACWI = "ACWI";
const AGG = "AGGG.L";
const AGG_FALLBACK = "BNDW";
const AGG_HEDGED = "AGGU.L";
const CMDTY = "DJP";
const REIT = "REET";
const BTC = "BTC-USD";
const RF = "^IRX";
const FVX = "^FVX";
const FACTOR_SYMS = ["IEF", "HYG", "UUP", "EEM"];

export const ETF_FACTORS = [
  { key: "eq", label: "주식", desc: "ACWI − Rf" },
  { key: "rate", label: "금리(듀레이션)", desc: "IEF − Rf" },
  { key: "credit", label: "크레딧", desc: "HYG − IEF" },
  { key: "usd", label: "달러", desc: "UUP − Rf" },
  { key: "cmdty", label: "원자재", desc: "DJP − Rf" },
  { key: "btc", label: "비트코인", desc: "BTC − Rf" },
  { key: "em", label: "신흥국 상대", desc: "EEM − ACWI" },
] as const;

type EtfFactorKey = (typeof ETF_FACTORS)[number]["key"];

export const ETF_STYLE_INDICES = [
  { key: "eq", label: "글로벌 주식(ACWI)", symbol: ACWI },
  { key: "fi", label: "글로벌 채권(BNDW)", symbol: AGG_FALLBACK },
  { key: "cmdty", label: "원자재(BCOM)", symbol: CMDTY },
  { key: "reit", label: "글로벌 리츠", symbol: REIT },
  { key: "btc", label: "비트코인", symbol: BTC },
  { key: "cash", label: "현금(T-bill)", symbol: RF },
] as const;

/** MSCI country ETF used as the country index return in equity allocation. */
const COUNTRY_PROXY: Record<string, string> = {
  "United States": "SPY",
  Japan: "EWJ",
  Taiwan: "EWT",
  "United Kingdom": "EWU",
  Canada: "EWC",
  "South Korea": "EWY",
  China: "MCHI",
  France: "EWQ",
  Switzerland: "EWL",
  Germany: "EWG",
  Australia: "EWA",
  India: "INDA",
  Netherlands: "EWN",
  Spain: "EWP",
  Italy: "EWI",
  Sweden: "EWD",
  Denmark: "EDEN",
  "Hong Kong": "EWH",
  Singapore: "EWS",
  Belgium: "EWK",
  Finland: "EFNL",
  Israel: "EIS",
  Brazil: "EWZ",
  Mexico: "EWW",
  "South Africa": "EZA",
  "Saudi Arabia": "KSA",
  "United Arab Emirates": "UAE",
  Poland: "EPOL",
  Chile: "ECH",
  Peru: "EPU",
  Turkey: "TUR",
  Thailand: "THD",
  Malaysia: "EWM",
  Indonesia: "EIDO",
  Philippines: "EPHE",
  Qatar: "QAT",
};

const EM_COUNTRIES = new Set([
  "China",
  "Taiwan",
  "South Korea",
  "India",
  "Brazil",
  "South Africa",
  "Saudi Arabia",
  "Mexico",
  "United Arab Emirates",
  "Poland",
  "Thailand",
  "Malaysia",
  "Indonesia",
  "Philippines",
  "Qatar",
  "Kuwait",
  "Chile",
  "Peru",
  "Colombia",
  "Turkey",
  "Hungary",
  "Greece",
  "Czech Republic",
  "Egypt",
]);

const ISHARES_URL = {
  ACWI: "https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf",
  EFA: "https://www.ishares.com/us/products/239623/ishares-msci-eafe-etf",
  EEM: "https://www.ishares.com/us/products/239637/ishares-msci-emerging-markets-etf",
};

/** iShares ACWI top-12 countries, 2026-09-28 (used only when live + R2 snapshot both fail). */
const ACWI_COUNTRY_STATIC: Record<string, number> = {
  "United States": 64.01,
  Japan: 5.15,
  Taiwan: 3.42,
  "United Kingdom": 2.99,
  Canada: 2.92,
  "South Korea": 2.63,
  China: 2.33,
  France: 1.97,
  Switzerland: 1.89,
  Germany: 1.81,
  Australia: 1.32,
  India: 1.29,
};

/** Yahoo has no topHoldings for these A-share ETFs — index sector mix (approx.). */
const SECTOR_FALLBACK: Record<string, Partial<Record<MpSectorKey, number>>> = {
  "159915.SZ": {
    technology: 30,
    industrials: 30,
    healthcare: 13,
    financial_services: 12,
    basic_materials: 5,
    consumer_cyclical: 4,
    communication_services: 3,
    consumer_defensive: 2,
    utilities: 1,
  },
  "588000.SS": { technology: 72, industrials: 12, healthcare: 9, basic_materials: 5, communication_services: 2 },
};

const CREDIT_BUCKETS = [
  { key: "us_government", label: "국채" },
  { key: "aaa", label: "AAA" },
  { key: "aa", label: "AA" },
  { key: "a", label: "A" },
  { key: "bbb", label: "BBB" },
  { key: "bb", label: "BB" },
  { key: "b", label: "B" },
  { key: "below_b", label: "B 미만" },
  { key: "other", label: "기타/미분류" },
] as const;

export type EtfMode = "actual" | "backtest";
type Seg = "EQ" | "FI" | EtfAltSub | "CASH";
const SEGS: Seg[] = ["EQ", "FI", "cmdty", "reit", "digital", "CASH"];
const ALT_SEGS: Seg[] = ["cmdty", "reit", "digital"];
const SEG_LABEL: Record<Seg, string> = {
  EQ: "주식 (vs MSCI ACWI)",
  FI: "채권 (vs Global Agg)",
  cmdty: "원자재 (vs BCOM)",
  reit: "리츠 (vs 글로벌 리츠)",
  digital: "디지털자산 (vs 비트코인)",
  CASH: "현금 (vs T-bill)",
};

export type EtfHoldingRow = {
  key: string;
  ticker: string;
  yahoo: string | null;
  name: string;
  name_ko: string;
  asset: EtfAsset;
  seg: Seg;
  group: string;
  currency: string;
  status: "held" | "pending" | "exited";
  target_pct: number;
  current_pct: number;
  first_date: string | null;
  last_price: number | null;
  day_change_pct: number | null;
  return_since_entry_pct: number | null;
  contribution_pct: number;
  week_contribution_pct: number;
  week_return_pct: number | null;
  expense_ratio_pct: number | null;
  yield_pct: number | null;
  duration: number | null;
  duration_emp: number | null;
};

export type EtfBrinsonRow = {
  segment: string;
  label: string;
  port_weight_pct: number;
  bm_weight_pct: number;
  port_return_pct: number | null;
  bm_return_pct: number | null;
  allocation_pct: number;
  selection_pct: number;
  interaction_pct: number;
  total_pct: number;
  subtotal?: boolean;
};

export type EtfCountryRow = {
  key: string;
  label: string;
  em: boolean;
  port_pct: number;
  bm_pct: number;
  active_pct: number;
  port_total_pct: number;
  proxy: string | null;
  bm_ret_pct: number | null;
  allocation_pct: number;
  allocation_total_pct: number;
};

export type EtfWeeklyLeg = {
  key: "EQ" | "FI" | "ALT" | "CASH";
  label: string;
  port_w_pct: number;
  bm_w_pct: number;
  port_ret_pct: number | null;
  bm_ret_pct: number;
  contribution_pct: number;
  allocation_pct: number;
  selection_pct: number;
};

export type EtfWeekly = {
  from: string;
  to: string;
  port_pct: number;
  bm_pct: number;
  excess_pct: number;
  eq_pct: number;
  fi_pct: number;
  alt_pct: number;
  legs: EtfWeeklyLeg[];
  countries: Array<{ key: string; label: string; active_pct: number; allocation_pct: number }>;
  country_alloc_pct: number;
  top: MpWeeklyMover[];
  bottom: MpWeeklyMover[];
  intraday: string[];
  comment: string[];
};

export type EtfAnalysis = {
  ok: boolean;
  error?: string;
  mode: EtfMode;
  as_of: string | null;
  start_date: string | null;
  bm: EtfBm;
  bm_label: string;
  bm_fi_symbol: string;
  ann_factor: number;
  rf_ann_pct: number | null;
  notes: string[];
  last_dates: Record<string, string | null>;
  weekly: EtfWeekly | null;
  series: Array<{ date: string; port: number; bm: number; eq: number; fi: number; alt: number; port_dd: number; bm_dd: number }>;
  period_returns: MpPeriodReturn[];
  monthly: Array<{ month: string; port_pct: number; bm_pct: number; excess_pct: number }>;
  metrics: { port: MpMetricSet; bm: MpMetricSet; rel: MpRelativeMetrics } | null;
  holdings: EtfHoldingRow[];
  assets: Array<{
    key: EtfAsset;
    label: string;
    port_pct: number;
    target_pct: number;
    bm_pct: number;
    active_pct: number;
    contribution_pct: number;
  }>;
  alt_mix: Array<{ key: EtfAltSub; label: string; port_pct: number; in_alt_pct: number; bm_in_alt_pct: number; tickers: string[] }>;
  groups: Array<{ key: string; asset: EtfAsset; label: string; port_pct: number; target_pct: number; contribution_pct: number; tickers: string[] }>;
  brinson: { rows: EtfBrinsonRow[]; residual_pct: number } | null;
  equity: {
    weight_pct: number;
    countries: EtfCountryRow[];
    country_source: string;
    look_through_notes: string[];
    sleeve_return_pct: number | null;
    acwi_return_pct: number | null;
    allocation_pct: number;
    selection_pct: number;
    proxy_gap_pct: number;
    region: { port_dm: number; port_em: number; bm_dm: number; bm_em: number };
    sectors: Array<{ key: string; label: string; port_pct: number; bm_pct: number; active_pct: number }>;
    pe: number | null;
    pb: number | null;
    bm_pe: number | null;
    bm_pb: number | null;
  };
  bonds: {
    weight_pct: number;
    rows: Array<{
      ticker: string;
      name_ko: string;
      group: string;
      weight_pct: number;
      duration: number | null;
      duration_emp: number | null;
      yield_pct: number | null;
      top_rating: string | null;
    }>;
    duration: number | null;
    duration_emp: number | null;
    bm_duration: number;
    bm_duration_emp: number | null;
    duration_contrib: number | null;
    bm_duration_contrib: number;
    yield_pct: number | null;
    credit: Array<{ key: string; label: string; pct: number }>;
    sleeve_return_pct: number | null;
    bm_return_pct: number | null;
    bm_hedged_return_pct: number | null;
  };
  costs: { expense_ratio_pct: number | null; yield_pct: number | null; coverage_pct: number };
  style: {
    rbsa: { daily: MpStyleRegression | null; weekly: MpStyleRegression | null };
    rolling: Array<{ date: string } & Record<string, number | string>>;
    target: Record<string, number>;
  };
  factors: {
    daily: MpRegression | null;
    weekly: MpRegression | null;
    holdings: Array<{ key: string; ticker: string; r2: number; n: number; betas: Record<string, number> }>;
  };
};

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

type FundInfo = {
  name: string | null;
  expense_pct: number | null;
  yield_pct: number | null;
  sectors: Partial<Record<MpSectorKey, number>> | null;
  pe: number | null;
  pb: number | null;
  ratings: Record<string, number> | null;
};

async function fetchFundInfo(symbol: string): Promise<FundInfo | null> {
  return cachedLookup(`mpetf:fund:${symbol}`, 12 * 3_600_000, 48 * 3_600_000, async () => {
    type Raw = { raw?: number };
    const r = await quoteSummary<{
      price?: { longName?: string; shortName?: string };
      summaryDetail?: { yield?: Raw };
      fundProfile?: { feesExpensesInvestment?: { annualReportExpenseRatio?: Raw; netExpRatio?: Raw } };
      topHoldings?: {
        sectorWeightings?: Array<Record<string, Raw>>;
        equityHoldings?: Record<string, Raw>;
        bondRatings?: Array<Record<string, Raw>>;
      };
    }>(symbol, "price,summaryDetail,fundProfile,topHoldings");
    if (!r) return null;
    const th = r.topHoldings;
    let sectors: FundInfo["sectors"] = null;
    if (th?.sectorWeightings?.length) {
      sectors = {};
      for (const row of th.sectorWeightings) {
        for (const [k, v] of Object.entries(row)) {
          if (MP_SECTORS.some((s) => s.key === k) && v?.raw) sectors[k as MpSectorKey] = v.raw * 100;
        }
      }
      if (!Object.keys(sectors).length) sectors = null;
    }
    let ratings: FundInfo["ratings"] = null;
    if (th?.bondRatings?.length) {
      ratings = {};
      for (const row of th.bondRatings) for (const [k, v] of Object.entries(row)) if (v?.raw) ratings[k] = v.raw;
      if (!Object.keys(ratings).length) ratings = null;
    }
    const pe = th?.equityHoldings?.priceToEarnings?.raw;
    const pb = th?.equityHoldings?.priceToBook?.raw;
    const fees = r.fundProfile?.feesExpensesInvestment;
    const er = numOrNull(fees?.annualReportExpenseRatio?.raw) ?? numOrNull(fees?.netExpRatio?.raw);
    const y = numOrNull(r.summaryDetail?.yield?.raw);
    return {
      name: r.price?.longName || r.price?.shortName || null,
      expense_pct: er != null ? er * 100 : null,
      yield_pct: y != null ? y * 100 : null,
      sectors,
      pe: pe && pe > 0 ? 1 / pe : null,
      pb: pb && pb > 0 ? 1 / pb : null,
      ratings,
    };
  });
}

function toWeights(br: IsharesBreakdown | null): Record<string, number> | null {
  if (!br || br.countries.length < 3) return null;
  return Object.fromEntries(br.countries.map((c) => [c.key, c.weight_pct]));
}

function withOther(w: Record<string, number>): Record<string, number> {
  const out = { ...w };
  const sum = Object.entries(out).reduce((s, [k, v]) => s + (k === "Other" ? 0 : v), 0);
  if (sum > 100.5) {
    for (const k of Object.keys(out)) out[k] = (out[k]! / sum) * 100;
    delete out.Other;
    return out;
  }
  out.Other = Math.max(0, 100 - sum);
  return out;
}

/** MSCI ACWI country weights: iShares top list, smaller DM/EM countries scaled from EFA / EEM tables. */
async function acwiCountryWeights(): Promise<{ weights: Record<string, number>; source: string }> {
  const live = await cachedLookup("mpetf:acwi-countries", 12 * 3_600_000, 72 * 3_600_000, async () => {
    const [acwi, efa, eem] = await Promise.all(
      [ISHARES_URL.ACWI, ISHARES_URL.EFA, ISHARES_URL.EEM].map((u) => fetchIsharesBreakdown(u).catch(() => null)),
    );
    const base = toWeights(acwi);
    if (!base || Object.keys(base).length < 5) return null;
    delete base.Other;
    const extend = (w: Record<string, number> | null, pred: (c: string) => boolean) => {
      if (!w) return 0;
      const anchors = Object.keys(w).filter((c) => c !== "Other" && c in base && pred(c));
      const a = anchors.reduce((s, c) => s + base[c]!, 0);
      const b = anchors.reduce((s, c) => s + w[c]!, 0);
      if (!(a > 0 && b > 0)) return 0;
      let n = 0;
      for (const [c, v] of Object.entries(w)) {
        if (c === "Other" || c in base || !pred(c)) continue;
        base[c] = (v * a) / b;
        n++;
      }
      return n;
    };
    const added = extend(toWeights(efa), (c) => !EM_COUNTRIES.has(c)) + extend(toWeights(eem), (c) => EM_COUNTRIES.has(c));
    return {
      weights: base,
      source: `iShares ACWI 국가비중 실시간${added ? ` · 소규모 ${added}개국은 EFA/EEM 비중을 ACWI 규모로 환산` : ""}`,
    };
  });
  if (live) return { weights: withOther(live.weights), source: live.source };
  const snap = await loadPrevSnap(ACWI);
  if (snap?.countries?.length) {
    return {
      weights: withOther(Object.fromEntries(snap.countries.filter((c) => c.key !== "Other").map((c) => [c.key, c.weight_pct]))),
      source: `국가 ETF 탭 ACWI 스냅샷 (${snap.as_of})`,
    };
  }
  return { weights: withOther(ACWI_COUNTRY_STATIC), source: "iShares ACWI 2026-09-28 스냅샷(대체값)" };
}

async function etfCountryMix(ticker: string): Promise<{ mix: Record<string, number>; source: "live" | "estimate" | "none" }> {
  const meta = etfMeta(ticker);
  if (meta?.ishares_url) {
    const url = meta.ishares_url;
    const live = await cachedLookup(`mpetf:ishares-c:${ticker}`, 12 * 3_600_000, 72 * 3_600_000, async () =>
      toWeights(await fetchIsharesBreakdown(url)),
    );
    if (live) return { mix: withOther(live), source: "live" };
  }
  if (meta?.countries) return { mix: withOther(meta.countries), source: "estimate" };
  return { mix: { Other: 100 }, source: "none" };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type AssetInfo = { key: string; ticker: string; yahoo: string; asset: EtfAsset; seg: Seg; group: string };

function segOf(h: Pick<EtfHolding, "asset" | "ticker" | "group">): Seg {
  if (h.asset === "CASH") return "CASH";
  if (h.asset === "ALT") return altSubOf(h);
  return h.asset;
}

function bmWeights(bm: EtfBm): Record<Seg, number> {
  const top = bm.eq + bm.fi + bm.alt;
  const k = top > 100 ? 100 / top : 1;
  const mix = bm.alt_cmdty + bm.alt_reit + bm.alt_btc || 1;
  const alt = (bm.alt * k) / 100;
  return {
    EQ: (bm.eq * k) / 100,
    FI: (bm.fi * k) / 100,
    cmdty: (alt * bm.alt_cmdty) / mix,
    reit: (alt * bm.alt_reit) / mix,
    digital: (alt * bm.alt_btc) / mix,
    CASH: Math.max(0, 1 - (bm.eq + bm.fi + bm.alt) * (k / 100)),
  };
}

function emptyEtf(mode: EtfMode, bm: EtfBm, error: string, notes: string[] = []): EtfAnalysis {
  return {
    ok: false,
    error,
    mode,
    as_of: null,
    start_date: null,
    bm,
    bm_label: bmLabel(bm),
    bm_fi_symbol: AGG,
    ann_factor: 252,
    rf_ann_pct: null,
    notes,
    last_dates: {},
    weekly: null,
    series: [],
    period_returns: [],
    monthly: [],
    metrics: null,
    holdings: [],
    assets: [],
    alt_mix: [],
    groups: [],
    brinson: null,
    equity: {
      weight_pct: 0,
      countries: [],
      country_source: "",
      look_through_notes: [],
      sleeve_return_pct: null,
      acwi_return_pct: null,
      allocation_pct: 0,
      selection_pct: 0,
      proxy_gap_pct: 0,
      region: { port_dm: 0, port_em: 0, bm_dm: 0, bm_em: 0 },
      sectors: [],
      pe: null,
      pb: null,
      bm_pe: null,
      bm_pb: null,
    },
    bonds: {
      weight_pct: 0,
      rows: [],
      duration: null,
      duration_emp: null,
      bm_duration: ETF_BM_DURATION,
      bm_duration_emp: null,
      duration_contrib: null,
      bm_duration_contrib: 0,
      yield_pct: null,
      credit: [],
      sleeve_return_pct: null,
      bm_return_pct: null,
      bm_hedged_return_pct: null,
    },
    costs: { expense_ratio_pct: null, yield_pct: null, coverage_pct: 0 },
    style: { rbsa: { daily: null, weekly: null }, rolling: [], target: {} },
    factors: { daily: null, weekly: null, holdings: [] },
  };
}

function moverLabel(ticker: string): string {
  return ticker.includes(".") ? etfMeta(ticker)?.name_ko || ticker : ticker;
}

function etfWeeklyComment(w: EtfWeekly): string[] {
  const lines: string[] = [];
  const ex = w.excess_pct;
  const verdict =
    Math.abs(ex) < 0.05
      ? `BM(${sgn(w.bm_pct)}%)과 비슷했습니다`
      : `BM(${sgn(w.bm_pct)}%)을 ${Math.abs(ex).toFixed(2)}%p ${ex > 0 ? "상회" : "하회"}했습니다`;
  const spanDays = (Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86_400_000;
  lines.push(
    `${spanDays < 7 ? "설정 이후" : "최근 1주"}(${monthDay(w.from)}~${monthDay(w.to)}) MP-ETF배분은 ${sgn(w.port_pct)}%로 ${verdict}. ` +
      `같은 기간 ACWI ${sgn(w.eq_pct)}%, Global Agg ${sgn(w.fi_pct)}%, 대체 BM ${sgn(w.alt_pct)}%.`,
  );

  const legs = w.legs.filter((l) => l.key !== "CASH" || l.port_w_pct >= 0.5);
  const alloc = w.legs.reduce((s, l) => s + l.allocation_pct, 0);
  const tilts = legs
    .filter((l) => Math.abs(l.port_w_pct - l.bm_w_pct) >= 0.3)
    .map((l) => `${l.label} ${l.port_w_pct.toFixed(1)}%(BM ${l.bm_w_pct.toFixed(0)}%) ${sgn(l.allocation_pct)}%p`);
  const sel = legs
    .filter((l) => l.key !== "CASH" && l.port_w_pct > 0.05)
    .map((l) => `${l.label} ${sgn(l.selection_pct)}%p`)
    .join("·");
  lines.push(
    `자산배분 효과는 ${sgn(alloc)}%p${tilts.length ? `(${tilts.join(", ")})` : ""}` +
      (sel ? `, 자산 내 ETF 선택 효과는 ${sel}였습니다.` : "였습니다."),
  );

  const mover = (m: MpWeeklyMover) => `${m.label}(${sgn(m.contribution_pct)}%p)`;
  const parts: string[] = [];
  if (w.top.length) parts.push(`상승 기여는 ${w.top.slice(0, 2).map(mover).join("·")}`);
  if (w.bottom.length) parts.push(`하락 기여는 ${w.bottom.slice(0, 2).map(mover).join("·")}`);
  const c = w.countries.filter((x) => Math.abs(x.allocation_pct) >= 0.005).slice(0, 2);
  const cText = c.length
    ? `주식 국가배분 효과는 ${sgn(w.country_alloc_pct)}%p로 ${c.map((x) => `${x.label}(비중 ${sgn(x.active_pct, 1)}%p) ${sgn(x.allocation_pct)}%p`).join("·")}가 컸습니다.`
    : `주식 국가배분 효과는 ${sgn(w.country_alloc_pct)}%p였습니다.`;
  lines.push(parts.length ? `${parts.join(", ")}였고, ${cText}` : cText);
  if (w.intraday.length) {
    const when = w.intraday.map((s) => s.replace(/(\d{4}-\d{2}-\d{2})/, (d) => monthDay(d))).join(", ");
    lines.push(`※ ${when}은 장중(지연) 가격 기준이라 마감 후 달라질 수 있습니다.`);
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export async function analyzeEtf(portfolio: EtfPortfolio, mode: EtfMode, lookbackDays = 365): Promise<EtfAnalysis> {
  const notes: string[] = [];
  const bm = normalizeBm(portfolio.bm);
  const wb = bmWeights(bm);
  const wbAlt = wb.cmdty + wb.reit + wb.digital;
  const versions = sortedEtfVersions(portfolio).filter((v) => v.date && v.holdings.length);
  if (!versions.length) return emptyEtf(mode, bm, "편입 내역이 없습니다.");
  const latest = versions[versions.length - 1]!;

  const today = new Date().toISOString().slice(0, 10);
  const start = mode === "actual" ? versions[0]!.date : addDays(today, -Math.max(30, lookbackDays));
  if (start > today) return emptyEtf(mode, bm, "편입일이 미래입니다.");
  const schedule = mode === "actual" ? versions : [{ ...latest, date: start }];

  const assets = new Map<string, AssetInfo>();
  for (const v of schedule) {
    for (const h of v.holdings) {
      if (h.asset === "CASH") continue;
      const yahoo = etfYahooSymbol(h);
      if (!yahoo) continue;
      const key = etfHoldingKey(h);
      assets.set(key, { key, ticker: normalizeEtfTicker(h.ticker), yahoo, asset: h.asset, seg: segOf(h), group: h.group });
    }
  }
  if (assets.size > 60) return emptyEtf(mode, bm, "ETF는 최대 60개까지 분석합니다.", notes);

  // ---------------- Prices ----------------
  const histStart = addDays(start < addDays(today, -400) ? start : addDays(today, -400), -14);
  const eqAssets = [...assets.values()].filter((x) => x.asset === "EQ");
  const backfillSyms =
    mode === "backtest" ? [...assets.values()].flatMap((x) => Object.keys(etfMeta(x.ticker)?.backfill || {})) : [];
  const [fetchedMain, acwiW, mixes] = await Promise.all([
    (async () => {
      const symbols = [
        ...new Set([
          ACWI,
          AGG,
          AGG_FALLBACK,
          AGG_HEDGED,
          CMDTY,
          REIT,
          BTC,
          RF,
          FVX,
          ...FACTOR_SYMS,
          ...[...assets.values()].map((x) => x.yahoo),
          ...backfillSyms,
        ]),
      ];
      const got = await mapPool(symbols, 8, async (s) => {
        try {
          return await fetchDaily(s, histStart, { adjusted: true });
        } catch (exc) {
          if (s !== AGG_FALLBACK && s !== AGG_HEDGED) {
            notes.push(`${s} 가격 조회 실패: ${exc instanceof Error ? exc.message : String(exc)}`);
          }
          return null;
        }
      });
      return symbols.map((s, i) => [s, got[i]] as const);
    })(),
    acwiCountryWeights(),
    mapPool(eqAssets, 4, async (x) => [x.key, await etfCountryMix(x.ticker)] as const),
  ]);
  const bySym = new Map<string, Daily>();
  for (const [s, d] of fetchedMain) if (d && d.dates.length) bySym.set(s, d);
  if (!bySym.get(ACWI)) return emptyEtf(mode, bm, "벤치마크(ACWI) 가격을 불러오지 못했습니다.", notes);
  const fiSym = bySym.has(AGG) ? AGG : AGG_FALLBACK;
  if (!bySym.has(fiSym)) return emptyEtf(mode, bm, "채권 벤치마크 가격을 불러오지 못했습니다.", notes);
  if (fiSym !== AGG) notes.push("Global Agg(AGGG.L) 조회 실패 — 채권 BM을 BNDW(Vanguard Total World Bond)로 대체");
  notes.push(...splitNotes(bySym));

  const mixOf = new Map<string, Record<string, number>>();
  const lookNotes: string[] = [];
  for (const [k, m] of mixes) {
    mixOf.set(k, m.mix);
    if (m.source === "estimate" && !etfMeta(k)?.ishares_url && Object.keys(m.mix).length > 2) lookNotes.push(`${k}: 지수 구성·상위 보유종목 기준 국가비중 추정`);
    if (m.source === "estimate" && etfMeta(k)?.ishares_url) lookNotes.push(`${k}: iShares 국가표 조회 실패 — 2026-09 스냅샷 사용`);
    if (m.source === "none") lookNotes.push(`${k}: 국가 정보 없음 — '기타'로 분류`);
  }

  const acwiCountries = acwiW.weights;
  const countryKeys = new Set<string>(Object.keys(acwiCountries));
  for (const m of mixOf.values()) for (const c of Object.keys(m)) countryKeys.add(c);
  const proxySyms = [...new Set([...countryKeys].map((c) => COUNTRY_PROXY[c]).filter((s): s is string => !!s && !bySym.has(s)))];

  // FX legs for non-USD listings
  const currencies = new Set<string>();
  for (const s of [...[...assets.values()].map((x) => x.yahoo), ...backfillSyms]) {
    const cur = bySym.get(s)?.currency;
    if (cur && cur !== "USD") currencies.add(cur);
  }
  const extra = [...proxySyms, ...[...currencies].map((c) => `${c}=X`)];
  const extraGot = await mapPool(extra, 8, async (s) => {
    try {
      return await fetchDaily(s, histStart, { adjusted: true });
    } catch {
      if (s.endsWith("=X")) notes.push(`${s.replace("=X", "")} 환율 조회 실패 — 현지통화 가격을 그대로 사용`);
      return null;
    }
  });
  extra.forEach((s, i) => {
    const d = extraGot[i];
    if (d && d.dates.length) bySym.set(s, d);
  });

  // Calendar: US sessions (ACWI) ∪ sessions of non-USD holdings
  const calSet = new Set<string>();
  for (const d of bySym.get(ACWI)!.dates) if (d >= start) calSet.add(d);
  for (const x of assets.values()) {
    const d = bySym.get(x.yahoo);
    if (d && d.currency !== "USD") for (const t of d.dates) if (t >= start) calSet.add(t);
  }
  const cal = [...calSet].sort();
  if (cal.length < 2) return emptyEtf(mode, bm, `${start} 이후 거래일이 부족합니다 (최소 2거래일).`, notes);
  const N = cal.length;

  const align = (sym: string) => alignTo(cal, bySym.get(sym));
  const usdPx = (sym: string): number[] => {
    const local = align(sym);
    const cur = bySym.get(sym)?.currency || "USD";
    if (cur === "USD" || !bySym.has(`${cur}=X`)) return local;
    const fx = align(`${cur}=X`);
    return local.map((p, i) => (isNum(p) && isNum(fx[i]!) && fx[i]! > 0 ? p / fx[i]! : NaN));
  };
  const rfDaily = rfDailyFrom(cal, align(RF));

  const px = new Map<string, number[]>();
  const pxLocal = new Map<string, number[]>();
  for (const x of assets.values()) {
    if (!bySym.has(x.yahoo)) notes.push(`${x.ticker}: 가격 데이터 없음 — 현금으로 대기`);
    px.set(x.key, usdPx(x.yahoo));
    pxLocal.set(x.key, align(x.yahoo));
  }

  // Backtest: chain a proxy basket onto ETFs listed after the start date
  if (mode === "backtest") {
    for (const x of assets.values()) {
      const meta = etfMeta(x.ticker);
      const p = px.get(x.key)!;
      const f = p.findIndex((v) => isNum(v) && v > 0);
      if (!meta?.backfill || f <= 0) continue;
      const legs = Object.entries(meta.backfill)
        .filter(([s]) => bySym.has(s))
        .map(([s, w]) => [usdPx(s), w] as const);
      if (!legs.length) continue;
      const lv = new Array<number>(N).fill(NaN);
      lv[f] = 1;
      let from = f;
      for (let i = f; i > 0; i--) {
        let r = 0;
        let wSum = 0;
        for (const [s, w] of legs) {
          const a = s[i - 1]!;
          const b = s[i]!;
          if (isNum(a) && isNum(b) && a > 0) {
            r += w * (b / a - 1);
            wSum += w;
          }
        }
        if (!wSum) break;
        lv[i - 1] = lv[i]! / (1 + r / wSum);
        from = i - 1;
      }
      if (from >= f) continue;
      const local = pxLocal.get(x.key)!;
      for (let i = from; i < f; i++) {
        p[i] = p[f]! * lv[i]!;
        if (isNum(local[f]!)) local[i] = local[f]! * lv[i]!;
      }
      notes.push(
        `${x.ticker}: 상장 전 구간(${cal[from]}~${cal[f - 1]})은 ${meta.backfill_label || Object.keys(meta.backfill).join("·")} 바스켓(달러 환산) 수익률로 대체`,
      );
    }
  }

  // ---------------- Simulation ----------------
  const effIdx = (date: string) => cal.findIndex((d) => d >= date);
  const rebal = new Map<number, EtfHolding[]>();
  if (mode === "actual") {
    for (const v of schedule) {
      const i = effIdx(v.date);
      if (i < 0) {
        notes.push(`${v.date} 리밸런싱: 해당일 이후 종가가 아직 없어 반영 대기`);
        continue;
      }
      rebal.set(i, v.holdings);
    }
  } else {
    for (let i = 0; i < N; i++) rebal.set(i, latest.holdings);
  }

  const units = new Map<string, number>();
  const pending = new Map<string, number>();
  let cashUsd = 0;
  const nav = new Array<number>(N).fill(NaN);
  const contrib = new Map<string, number>();
  const firstDate = new Map<string, string>();
  const entryPx = new Map<string, number>();
  const everHeld = new Set<string>();
  const segDaily: Array<{ w: Record<Seg, number>; r: Record<Seg, number | null> }> = [];
  const eqDaily: Array<{ vals: Array<[string, number]>; base: number; pnl: number }> = [];
  const pendingNoted = new Set<string>();
  const segKey = (k: string): Seg => assets.get(k)?.seg || "CASH";

  const valueAt = (i: number) => {
    let v = cashUsd;
    for (const amt of pending.values()) v += amt;
    for (const [k, u] of units) {
      const p = px.get(k)![i]!;
      if (isNum(p)) v += u * p;
    }
    return v;
  };

  const weekFrom = addDays(cal[N - 1]!, -7);
  let wBase = 0;
  for (let i = 0; i < N; i++) if (cal[i]! <= weekFrom) wBase = i;
  const weekContrib = new Map<string, number>();
  const addWeek = (k: string, pnl: number, i: number) => {
    if (i > wBase) weekContrib.set(k, (weekContrib.get(k) || 0) + (pnl / nav[wBase]!) * 100);
  };
  let weekSeg: Record<Seg, number> = { EQ: 0, FI: 0, cmdty: 0, reit: 0, digital: 0, CASH: 1 };
  let weekEq: Array<[string, number]> = [];
  const zeroSeg = (): Record<Seg, number> => ({ EQ: 0, FI: 0, cmdty: 0, reit: 0, digital: 0, CASH: 0 });

  for (let i = 0; i < N; i++) {
    if (i === 0) {
      nav[0] = 100;
      cashUsd = 100;
    } else {
      const prevNav = nav[i - 1]!;
      const link = prevNav / 100;
      const segPnl = zeroSeg();
      const segW = zeroSeg();
      const eqVals: Array<[string, number]> = [];
      let eqPnl = 0;
      for (const [k, u] of units) {
        const p0 = px.get(k)![i - 1]!;
        const p1 = px.get(k)![i]!;
        const seg = segKey(k);
        if (isNum(p0)) {
          segW[seg] += (u * p0) / prevNav;
          if (seg === "EQ") eqVals.push([k, u * p0]);
        }
        if (!isNum(p0) || !isNum(p1)) continue;
        const pnl = u * (p1 - p0);
        segPnl[seg] += pnl;
        if (seg === "EQ") eqPnl += pnl;
        contrib.set(k, (contrib.get(k) || 0) + (pnl / prevNav) * link * 100);
        addWeek(k, pnl, i);
      }
      const pendingSum = [...pending.values()].reduce((s, v) => s + v, 0);
      const interest = cashUsd * rfDaily[i]!;
      segW.CASH = (cashUsd + pendingSum) / prevNav;
      segPnl.CASH = interest;
      cashUsd += interest;
      contrib.set("CASH:USD", (contrib.get("CASH:USD") || 0) + (interest / prevNav) * link * 100);
      addWeek("CASH:USD", interest, i);
      nav[i] = valueAt(i);
      const r = {} as Record<Seg, number | null>;
      for (const s of SEGS) {
        const base = segW[s] * prevNav;
        r[s] = base > 1e-9 ? segPnl[s] / base : null;
      }
      segDaily.push({ w: segW, r });
      eqDaily.push({ vals: eqVals, base: eqVals.reduce((s, [, v]) => s + v, 0), pnl: eqPnl });
    }

    for (const [k, amt] of [...pending.entries()]) {
      const p = px.get(k)![i]!;
      if (!isNum(p) || p <= 0) continue;
      units.set(k, (units.get(k) || 0) + amt / p);
      pending.delete(k);
      if (!firstDate.has(k)) firstDate.set(k, cal[i]!);
      if (!entryPx.has(k)) entryPx.set(k, p);
      everHeld.add(k);
      if (mode === "actual") notes.push(`${assets.get(k)?.ticker}: ${cal[i]} 첫 거래 가능일에 편입 (상장/데이터 시작)`);
    }

    const targets = rebal.get(i);
    if (targets) {
      const total = valueAt(i);
      units.clear();
      pending.clear();
      let allocated = 0;
      for (const h of targets) {
        const w = (Number(h.weight_pct) || 0) / 100;
        const k = etfHoldingKey(h);
        if (h.asset === "CASH" || !w || !assets.has(k)) continue;
        const amt = total * w;
        allocated += amt;
        const p = px.get(k)![i]!;
        if (isNum(p) && p > 0) {
          units.set(k, (units.get(k) || 0) + amt / p);
          everHeld.add(k);
          if (!firstDate.has(k)) firstDate.set(k, cal[i]!);
          if (!entryPx.has(k)) entryPx.set(k, p);
        } else {
          pending.set(k, (pending.get(k) || 0) + amt);
          if (!pendingNoted.has(k)) {
            pendingNoted.add(k);
            notes.push(`${assets.get(k)!.ticker}: ${cal[i]} 가격 없음 — 첫 종가에 편입, 그 전까지 현금`);
          }
        }
      }
      cashUsd = total - allocated;
    }
    for (const k of [...firstDate.keys()]) {
      if (!units.has(k) && !pending.has(k) && mode === "actual") {
        firstDate.delete(k);
        entryPx.delete(k);
      }
    }
    if (i === wBase) {
      const seg = zeroSeg();
      const eq: Array<[string, number]> = [];
      for (const [k, u] of units) {
        const p = px.get(k)![i]!;
        if (!isNum(p)) continue;
        seg[segKey(k)] += (u * p) / nav[i]!;
        if (segKey(k) === "EQ") eq.push([k, (u * p) / nav[i]!]);
      }
      seg.CASH = 1 - SEGS.filter((s) => s !== "CASH").reduce((s, k) => s + seg[k], 0);
      weekSeg = seg;
      weekEq = eq;
    }
  }

  // ---------------- Benchmark ----------------
  const lvOf = (sym: string) => usdPx(sym);
  const rOf = (sym: string) => toReturns(lvOf(sym)).map((r) => (isNum(r) ? r : 0));
  const rf = rfDaily.slice(1);
  const rbSeg: Record<Seg, number[]> = {
    EQ: rOf(ACWI),
    FI: rOf(fiSym),
    cmdty: rOf(CMDTY),
    reit: rOf(REIT),
    digital: rOf(BTC),
    CASH: rf.map((x) => x || 0),
  };
  const T = N - 1;
  const rBm = Array.from({ length: T }, (_, t) => SEGS.reduce((s, k) => s + wb[k] * rbSeg[k][t]!, 0));
  const altMix = wbAlt > 0 ? wbAlt : 1;
  const altW = wbAlt > 0 ? { cmdty: wb.cmdty / altMix, reit: wb.reit / altMix, digital: wb.digital / altMix } : { cmdty: 0.4, reit: 0.4, digital: 0.2 };
  const rAltBm = Array.from({ length: T }, (_, t) => altW.cmdty * rbSeg.cmdty[t]! + altW.reit * rbSeg.reit[t]! + altW.digital * rbSeg.digital[t]!);
  const level = (rs: number[]) => rs.reduce<number[]>((acc, r) => (acc.push(acc[acc.length - 1]! * (1 + r)), acc), [100]);
  const bmLv = level(rBm);
  const eqLv = level(rbSeg.EQ);
  const fiLv = level(rbSeg.FI);
  const altLv = level(rAltBm);
  const rPort = toReturns(nav);

  const spanDays = (Date.parse(`${cal[N - 1]}T00:00:00Z`) - Date.parse(`${cal[0]}T00:00:00Z`)) / 86_400_000;
  const annF = spanDays >= 90 ? Math.min(270, Math.max(240, ((N - 1) / spanDays) * 365.25)) : 252;
  const rfAnn = spanDays > 0 ? (rf.reduce((s, x) => s + x, 0) / spanDays) * 365 * 100 : null;
  const portDd = drawdowns(nav);
  const bmDd = drawdowns(bmLv);
  const series = cal.map((d, i) => ({
    date: d,
    port: nav[i]!,
    bm: bmLv[i]!,
    eq: eqLv[i]!,
    fi: fiLv[i]!,
    alt: altLv[i]!,
    port_dd: portDd[i]!,
    bm_dd: bmDd[i]!,
  }));
  const portM = metricSet(cal, nav, rPort, rf, annF, spanDays);
  const bmM = metricSet(cal, bmLv, rBm, rf, annF, spanDays);
  const rel = relativeMetrics(rPort, rBm, rf, annF, portM.total_return_pct, bmM.total_return_pct);
  const lastD = cal[N - 1]!;
  const period_returns = periodReturns(cal, nav, bmLv, mode === "actual" ? "설정 이후" : "전체 구간");
  const monthly = monthlyReturns(cal, nav, bmLv);

  // ---------------- Holdings ----------------
  const lastIdx = N - 1;
  const endNav = nav[lastIdx]!;
  const targetMap = new Map<string, number>();
  for (const h of latest.holdings) targetMap.set(etfHoldingKey(h), (targetMap.get(etfHoldingKey(h)) || 0) + (Number(h.weight_pct) || 0));
  const fundSyms = [...new Set([ACWI, ...[...assets.values()].map((x) => x.yahoo)])];
  const fundArr = await mapPool(fundSyms, 6, (s) => fetchFundInfo(s));
  const fund = new Map<string, FundInfo | null>(fundSyms.map((s, i) => [s, fundArr[i]!]));

  // Empirical duration: weekly USD total return vs −Δ(5y yield), trailing year
  const durCal = bySym.get(ACWI)!.dates.filter((d) => d >= addDays(today, -365));
  const durIdx = weeklyIndex(durCal);
  const dy = (() => {
    const lv = pick(alignTo(durCal, bySym.get(FVX)), durIdx);
    return lv.slice(1).map((v, i) => (isNum(v) && isNum(lv[i]!) ? (v - lv[i]!) / 100 : NaN));
  })();
  const empDuration = (sym: string): number | null => {
    if (!bySym.has(sym) || !dy.some(isNum)) return null;
    const cur = bySym.get(sym)!.currency;
    let lv = alignTo(durCal, bySym.get(sym));
    if (cur !== "USD" && bySym.has(`${cur}=X`)) {
      const fx = alignTo(durCal, bySym.get(`${cur}=X`));
      lv = lv.map((p, i) => p / fx[i]!);
    }
    const r = toReturns(pick(lv, durIdx));
    const fit = ols(r, [dy]);
    return fit && fit.n >= 26 ? -fit.coef[1]! : null;
  };

  const holdings: EtfHoldingRow[] = [];
  const allKeys = new Set<string>([...assets.keys(), "CASH:USD"]);
  for (const k of allKeys) {
    const x = assets.get(k);
    const p = x ? px.get(k)! : null;
    const u = units.get(k) || 0;
    let value = 0;
    if (x && u && p && isNum(p[lastIdx]!)) value = u * p[lastIdx]!;
    if (x && pending.has(k)) value = pending.get(k)!;
    if (!x) value = cashUsd;
    const status: EtfHoldingRow["status"] = pending.has(k) ? "pending" : u > 0 || !x ? "held" : "exited";
    if (x && status === "exited" && !everHeld.has(k)) continue;
    const meta = x ? etfMeta(x.ticker) : undefined;
    const f = x ? fund.get(x.yahoo) : null;
    const own = x ? bySym.get(x.yahoo) : undefined;
    const ownLast = own?.close.at(-1) ?? NaN;
    const ownPrev = own?.close.at(-2) ?? NaN;
    const pl = x ? pxLocal.get(k)! : null;
    const ep = entryPx.get(k);
    const isFi = x?.asset === "FI";
    holdings.push({
      key: k,
      ticker: x ? x.ticker : "USD",
      yahoo: x ? x.yahoo : null,
      name: x ? meta?.name || f?.name || own?.name || x.ticker : "달러 현금",
      name_ko: x ? meta?.name_ko || "" : "현금",
      asset: x ? x.asset : "CASH",
      seg: x ? x.seg : "CASH",
      group: x ? x.group : "현금",
      currency: x ? own?.currency || "USD" : "USD",
      status,
      target_pct: targetMap.get(k) || 0,
      current_pct: endNav > 0 && Math.abs(value / endNav) > 1e-9 ? (value / endNav) * 100 : 0,
      first_date: firstDate.get(k) || null,
      last_price: pl && isNum(pl[lastIdx]!) ? pl[lastIdx]! : null,
      day_change_pct: isNum(ownLast) && isNum(ownPrev) && ownPrev > 0 ? (ownLast / ownPrev - 1) * 100 : null,
      return_since_entry_pct: ep && p && isNum(p[lastIdx]!) && status !== "exited" ? (p[lastIdx]! / ep - 1) * 100 : null,
      contribution_pct: contrib.get(k) || 0,
      week_contribution_pct: weekContrib.get(k) || 0,
      week_return_pct:
        p && isNum(p[lastIdx]!) && isNum(p[wBase]!) && p[wBase]! > 0 && status !== "exited" ? (p[lastIdx]! / p[wBase]! - 1) * 100 : null,
      expense_ratio_pct: f?.expense_pct ?? null,
      yield_pct: f?.yield_pct ?? null,
      duration: isFi ? meta?.duration ?? null : null,
      duration_emp: isFi && x ? empDuration(x.yahoo) : null,
    });
  }
  const assetOrder: Record<EtfAsset, number> = { EQ: 0, FI: 1, ALT: 2, CASH: 3 };
  const groupOrder = new Map<string, number>();
  latest.holdings.forEach((h, i) => {
    if (!groupOrder.has(etfHoldingKey(h))) groupOrder.set(etfHoldingKey(h), i);
  });
  holdings.sort(
    (p, q) =>
      assetOrder[p.asset] - assetOrder[q.asset] ||
      (groupOrder.get(p.key) ?? 999) - (groupOrder.get(q.key) ?? 999) ||
      q.current_pct - p.current_pct,
  );
  const sumBy = (pred: (h: EtfHoldingRow) => boolean, f: (h: EtfHoldingRow) => number) =>
    holdings.filter(pred).reduce((s, h) => s + f(h), 0);

  const assetsOut: EtfAnalysis["assets"] = (["EQ", "FI", "ALT", "CASH"] as EtfAsset[]).map((a) => {
    const port = sumBy((h) => h.asset === a, (h) => h.current_pct);
    const bmPct = (a === "ALT" ? wbAlt : a === "CASH" ? wb.CASH : wb[a]) * 100;
    return {
      key: a,
      label: a === "EQ" ? "주식" : a === "FI" ? "채권" : a === "ALT" ? "대체" : "현금",
      port_pct: port,
      target_pct: sumBy((h) => h.asset === a, (h) => h.target_pct),
      bm_pct: bmPct,
      active_pct: port - bmPct,
      contribution_pct: sumBy((h) => h.asset === a, (h) => h.contribution_pct),
    };
  });
  const altTotal = sumBy((h) => h.asset === "ALT", (h) => h.current_pct);
  const alt_mix: EtfAnalysis["alt_mix"] = (["cmdty", "reit", "digital"] as EtfAltSub[]).map((s) => {
    const port = sumBy((h) => h.seg === s, (h) => h.current_pct);
    return {
      key: s,
      label: s === "cmdty" ? "원자재" : s === "reit" ? "리츠" : "디지털자산",
      port_pct: port,
      in_alt_pct: altTotal > 0 ? (port / altTotal) * 100 : 0,
      bm_in_alt_pct: altW[s] * 100,
      tickers: holdings.filter((h) => h.seg === s && h.status !== "exited").map((h) => h.ticker),
    };
  });
  const groupMap = new Map<string, EtfAnalysis["groups"][number]>();
  for (const h of holdings) {
    const key = `${h.asset}:${h.group || "기타"}`;
    const g = groupMap.get(key) || { key, asset: h.asset, label: h.group || "기타", port_pct: 0, target_pct: 0, contribution_pct: 0, tickers: [] };
    g.port_pct += h.current_pct;
    g.target_pct += h.target_pct;
    g.contribution_pct += h.contribution_pct;
    g.tickers.push(h.ticker);
    groupMap.set(key, g);
  }

  // ---------------- Asset-class Brinson ----------------
  let brinson: EtfAnalysis["brinson"] = null;
  const links = grapLinks(rPort, rBm);
  if (segDaily.length) {
    const acc = Object.fromEntries(SEGS.map((s) => [s, { alloc: 0, sel: 0, inter: 0, wp: 0, rp: 1, rb: 1 }])) as Record<
      Seg,
      { alloc: number; sel: number; inter: number; wp: number; rp: number; rb: number }
    >;
    let altRp = 1;
    let altRb = 1;
    segDaily.forEach((d, t) => {
      const rbTot = rBm[t]!;
      const link = links[t]!;
      for (const s of SEGS) {
        const wp = d.w[s] || 0;
        const rb = rbSeg[s][t]!;
        const rp = d.r[s] ?? rb;
        const x = acc[s];
        x.alloc += (wp - wb[s]) * (rb - rbTot) * link;
        x.sel += wb[s] * (rp - rb) * link;
        x.inter += (wp - wb[s]) * (rp - rb) * link;
        x.wp += wp;
        x.rp *= 1 + rp;
        x.rb *= 1 + rb;
      }
      const wAlt = ALT_SEGS.reduce((s, k) => s + (d.w[k] || 0), 0);
      const pnlAlt = ALT_SEGS.reduce((s, k) => s + (d.w[k] || 0) * (d.r[k] ?? rbSeg[k][t]!), 0);
      altRp *= 1 + (wAlt > 1e-9 ? pnlAlt / wAlt : rAltBm[t]!);
      altRb *= 1 + rAltBm[t]!;
    });
    const row = (s: Seg): EtfBrinsonRow => {
      const x = acc[s];
      return {
        segment: s,
        label: SEG_LABEL[s],
        port_weight_pct: (x.wp / segDaily.length) * 100,
        bm_weight_pct: wb[s] * 100,
        port_return_pct: (x.rp - 1) * 100,
        bm_return_pct: (x.rb - 1) * 100,
        allocation_pct: x.alloc,
        selection_pct: x.sel,
        interaction_pct: x.inter,
        total_pct: x.alloc + x.sel + x.inter,
      };
    };
    const altRows = ALT_SEGS.map(row);
    const altSub: EtfBrinsonRow = {
      segment: "ALT",
      label: "대체 합계 (vs 원자재·리츠·비트코인 BM)",
      port_weight_pct: altRows.reduce((s, r) => s + r.port_weight_pct, 0),
      bm_weight_pct: wbAlt * 100,
      port_return_pct: (altRp - 1) * 100,
      bm_return_pct: (altRb - 1) * 100,
      allocation_pct: altRows.reduce((s, r) => s + r.allocation_pct, 0),
      selection_pct: altRows.reduce((s, r) => s + r.selection_pct, 0),
      interaction_pct: altRows.reduce((s, r) => s + r.interaction_pct, 0),
      total_pct: altRows.reduce((s, r) => s + r.total_pct, 0),
      subtotal: true,
    };
    const rows = [row("EQ"), row("FI"), altSub, ...altRows, row("CASH")];
    const explained = rows.filter((r) => !r.subtotal).reduce((s, r) => s + r.total_pct, 0);
    brinson = { rows, residual_pct: rel.excess_return_pct - explained };
  }

  // ---------------- Equity: country allocation vs ACWI ----------------
  const rAcwi = rbSeg.EQ;
  const proxyR = new Map<string, number[]>();
  for (const c of countryKeys) {
    const s = COUNTRY_PROXY[c];
    if (s && bySym.has(s)) proxyR.set(c, rOf(s));
  }
  const countryList = [...countryKeys];
  const mixW = (vals: Array<[string, number]>): Record<string, number> => {
    const base = vals.reduce((s, [, v]) => s + v, 0);
    const out: Record<string, number> = {};
    if (base <= 0) return out;
    for (const [k, v] of vals) {
      const mix = mixOf.get(k) || { Other: 100 };
      for (const [c, w] of Object.entries(mix)) out[c] = (out[c] || 0) + (v / base) * (w / 100);
    }
    return out;
  };
  const sleeveR = eqDaily.map((d, t) => (d.base > 1e-9 ? d.pnl / d.base : rAcwi[t]!));
  const sleeveLinks = grapLinks(sleeveR, rAcwi);
  const allocC = new Map<string, number>();
  const allocTotC = new Map<string, number>();
  let proxyGap = 0;
  eqDaily.forEach((d, t) => {
    if (d.base <= 1e-9) return;
    const wp = mixW(d.vals);
    const ra = rAcwi[t]!;
    let gap = 0;
    for (const c of countryList) {
      const rb = proxyR.get(c)?.[t] ?? ra;
      const wbC = (acwiCountries[c] || 0) / 100;
      const a = ((wp[c] || 0) - wbC) * (rb - ra);
      allocC.set(c, (allocC.get(c) || 0) + a * sleeveLinks[t]!);
      allocTotC.set(c, (allocTotC.get(c) || 0) + a * (segDaily[t]?.w.EQ || 0) * links[t]!);
      gap += wbC * rb;
    }
    proxyGap += (gap - ra) * sleeveLinks[t]!;
  });
  const sleeveCum = eqDaily.some((d) => d.base > 1e-9) ? (sleeveR.reduce((g, r) => g * (1 + r), 1) - 1) * 100 : null;
  const acwiCum = (eqLv[lastIdx]! / eqLv[0]! - 1) * 100;
  const eqCur = holdings.filter((h) => h.asset === "EQ" && h.current_pct > 0);
  const eqWeight = eqCur.reduce((s, h) => s + h.current_pct, 0);
  const curMix = mixW(eqCur.map((h) => [h.key, h.current_pct]));
  const countryCum = (c: string) => {
    const s = COUNTRY_PROXY[c];
    if (!s || !bySym.has(s)) return null;
    const lv = usdPx(s);
    return isNum(lv[0]!) && isNum(lv[lastIdx]!) ? (lv[lastIdx]! / lv[0]! - 1) * 100 : null;
  };
  const countries: EtfCountryRow[] = countryList
    .map((c) => {
      const port = (curMix[c] || 0) * 100;
      const bmPct = acwiCountries[c] || 0;
      return {
        key: c,
        label: c === "Other" ? "기타" : countryLabelKo(c),
        em: EM_COUNTRIES.has(c),
        port_pct: port,
        bm_pct: bmPct,
        active_pct: port - bmPct,
        port_total_pct: (port * eqWeight) / 100,
        proxy: c === "Other" ? null : COUNTRY_PROXY[c] || null,
        bm_ret_pct: countryCum(c),
        allocation_pct: allocC.get(c) || 0,
        allocation_total_pct: allocTotC.get(c) || 0,
      };
    })
    .filter((r) => r.port_pct > 0.05 || r.bm_pct > 0.05)
    .sort((p, q) => (p.key === "Other" ? 1 : q.key === "Other" ? -1 : 0) || Math.max(q.port_pct, q.bm_pct) - Math.max(p.port_pct, p.bm_pct));
  const allocSum = countries.reduce((s, r) => s + r.allocation_pct, 0);
  const region = {
    port_dm: countries.filter((r) => !r.em && r.key !== "Other").reduce((s, r) => s + r.port_pct, 0),
    port_em: countries.filter((r) => r.em).reduce((s, r) => s + r.port_pct, 0),
    bm_dm: countries.filter((r) => !r.em && r.key !== "Other").reduce((s, r) => s + r.bm_pct, 0),
    bm_em: countries.filter((r) => r.em).reduce((s, r) => s + r.bm_pct, 0),
  };

  // Sector look-through (Yahoo / Morningstar taxonomy, same as ACWI)
  const secAgg: Record<string, number> = {};
  let secCovered = 0;
  const fallbackSec: string[] = [];
  for (const h of eqCur) {
    let s = fund.get(h.yahoo || "")?.sectors || null;
    if (!s && SECTOR_FALLBACK[h.ticker]) {
      s = SECTOR_FALLBACK[h.ticker]!;
      fallbackSec.push(h.ticker);
    }
    if (!s) continue;
    const tot = Object.values(s).reduce((a, b) => a + (b || 0), 0);
    if (tot <= 0) continue;
    secCovered += h.current_pct;
    for (const [k, v] of Object.entries(s)) secAgg[k] = (secAgg[k] || 0) + (h.current_pct * (v || 0)) / tot;
  }
  if (fallbackSec.length) lookNotes.push(`${fallbackSec.join(", ")}: Yahoo 업종 데이터 없음 — 지수 업종 구성 근사치 사용`);
  const acwiInfo = fund.get(ACWI);
  const acwiSec = acwiInfo?.sectors || {};
  const acwiSecTot = Object.values(acwiSec).reduce((a, b) => a + (b || 0), 0) || 100;
  const sectors = [...MP_SECTORS.map((s) => s.key as string), "etc"]
    .map((key) => {
      const port = key === "etc" ? (eqWeight > 0 ? ((eqWeight - secCovered) / eqWeight) * 100 : 0) : eqWeight > 0 ? ((secAgg[key] || 0) / eqWeight) * 100 : 0;
      const bmPct = key === "etc" ? 0 : (((acwiSec as Record<string, number>)[key] || 0) / acwiSecTot) * 100;
      return { key, label: key === "etc" ? "미분류" : mpSectorLabel(key), port_pct: port, bm_pct: bmPct, active_pct: port - bmPct };
    })
    .filter((r) => r.port_pct > 0.05 || r.bm_pct > 0.05);
  const harmonic = (field: "pe" | "pb") => {
    let w = 0;
    let inv = 0;
    for (const h of eqCur) {
      const v = fund.get(h.yahoo || "")?.[field];
      if (v && v > 0) {
        w += h.current_pct;
        inv += h.current_pct / v;
      }
    }
    return inv > 0 ? w / inv : null;
  };

  // ---------------- Bonds ----------------
  const fiCur = holdings.filter((h) => h.asset === "FI" && h.current_pct > 0);
  const fiWeight = fiCur.reduce((s, h) => s + h.current_pct, 0);
  const wavg = (rows: EtfHoldingRow[], f: (h: EtfHoldingRow) => number | null) => {
    let w = 0;
    let s = 0;
    for (const h of rows) {
      const v = f(h);
      if (v == null || !Number.isFinite(v)) continue;
      w += h.current_pct;
      s += h.current_pct * v;
    }
    return w > 0 ? s / w : null;
  };
  const credit: Record<string, number> = {};
  for (const h of fiCur) {
    const r = fund.get(h.yahoo || "")?.ratings;
    const tot = r ? Object.values(r).reduce((a, b) => a + b, 0) : 0;
    if (!r || tot <= 0) {
      credit.other = (credit.other || 0) + h.current_pct;
      continue;
    }
    for (const [k, v] of Object.entries(r)) {
      const key = CREDIT_BUCKETS.some((b) => b.key === k) ? k : "other";
      credit[key] = (credit[key] || 0) + (h.current_pct * v) / tot;
    }
  }
  const topRating = (h: EtfHoldingRow): string | null => {
    const r = fund.get(h.yahoo || "")?.ratings;
    if (!r) return null;
    const best = Object.entries(r).sort((a, b) => b[1] - a[1])[0];
    return best ? `${CREDIT_BUCKETS.find((b) => b.key === best[0])?.label || best[0]} ${(best[1] * 100).toFixed(0)}%` : null;
  };
  const fiDur = wavg(fiCur, (h) => h.duration);
  const fiRow = brinson?.rows.find((r) => r.segment === "FI");
  const hedged = bySym.has(AGG_HEDGED) ? usdPx(AGG_HEDGED) : null;

  // ---------------- Weekly read ----------------
  let week: EtfWeekly | null = null;
  if (wBase < lastIdx) {
    const chg = (lv: number[]) => (lv[lastIdx]! / lv[wBase]! - 1) * 100;
    const portW = chg(nav);
    const bmW = chg(bmLv);
    let rfGrow = 1;
    for (let t = wBase + 1; t <= lastIdx; t++) rfGrow *= 1 + rfDaily[t]!;
    const legDefs: Array<{ key: EtfWeeklyLeg["key"]; label: string; segs: Seg[]; wb: number; rb: number }> = [
      { key: "EQ", label: "주식", segs: ["EQ"], wb: wb.EQ, rb: chg(eqLv) },
      { key: "FI", label: "채권", segs: ["FI"], wb: wb.FI, rb: chg(fiLv) },
      { key: "ALT", label: "대체", segs: ALT_SEGS, wb: wbAlt, rb: chg(altLv) },
      { key: "CASH", label: "현금", segs: ["CASH"], wb: wb.CASH, rb: (rfGrow - 1) * 100 },
    ];
    const legs: EtfWeeklyLeg[] = legDefs.map((l) => {
      const wp = l.segs.reduce((s, k) => s + (weekSeg[k] || 0), 0);
      const contribution = holdings.filter((h) => l.segs.includes(h.seg)).reduce((s, h) => s + h.week_contribution_pct, 0);
      const rp = wp > 1e-6 ? contribution / wp : null;
      return {
        key: l.key,
        label: l.label,
        port_w_pct: wp * 100,
        bm_w_pct: l.wb * 100,
        port_ret_pct: rp,
        bm_ret_pct: l.rb,
        contribution_pct: contribution,
        allocation_pct: (wp - l.wb) * (l.rb - bmW),
        selection_pct: rp == null ? 0 : wp * (rp - l.rb),
      };
    });
    const weq = weekEq.reduce((s, [, v]) => s + v, 0);
    const wpC = mixW(weekEq);
    const ra = chg(eqLv);
    const wCountries = countryList
      .map((c) => {
        const s = COUNTRY_PROXY[c];
        const lv = s && bySym.has(s) ? usdPx(s) : null;
        const rb = lv && isNum(lv[wBase]!) && isNum(lv[lastIdx]!) ? (lv[lastIdx]! / lv[wBase]! - 1) * 100 : ra;
        const active = ((wpC[c] || 0) * 100 - (acwiCountries[c] || 0)) * weq;
        return {
          key: c,
          label: c === "Other" ? "기타" : countryLabelKo(c),
          active_pct: active,
          allocation_pct: (active / 100) * (rb - ra),
        };
      })
      .sort((p, q) => Math.abs(q.allocation_pct) - Math.abs(p.allocation_pct));
    const movers = holdings
      .filter((h) => h.asset !== "CASH" && Math.abs(h.week_contribution_pct) > 1e-6)
      .map((h) => ({ key: h.key, label: moverLabel(h.ticker), contribution_pct: h.week_contribution_pct, return_pct: h.week_return_pct }))
      .sort((p, q) => q.contribution_pct - p.contribution_pct);
    const intraday: string[] = [];
    if (isIntradayBar(ACWI, bySym.get(ACWI)?.dates.at(-1))) intraday.push(`미국 ${bySym.get(ACWI)!.dates.at(-1)}`);
    const cn = [...assets.values()].find((x) => /\.(SS|SZ)$/.test(x.yahoo) && bySym.has(x.yahoo));
    if (cn && isIntradayBar(cn.yahoo, bySym.get(cn.yahoo)?.dates.at(-1))) intraday.push(`중국 ${bySym.get(cn.yahoo)!.dates.at(-1)}`);
    week = {
      from: cal[wBase]!,
      to: cal[lastIdx]!,
      port_pct: portW,
      bm_pct: bmW,
      excess_pct: portW - bmW,
      eq_pct: chg(eqLv),
      fi_pct: chg(fiLv),
      alt_pct: chg(altLv),
      legs,
      countries: wCountries,
      country_alloc_pct: wCountries.reduce((s, c) => s + c.allocation_pct, 0),
      top: movers.filter((m) => m.contribution_pct > 0).slice(0, 3),
      bottom: movers.filter((m) => m.contribution_pct < 0).slice(-3).reverse(),
      intraday,
      comment: [],
    };
    week.comment = etfWeeklyComment(week);
  }

  // ---------------- Factors & returns-based asset mix ----------------
  const rfLv = level(rf.map((x) => x || 0));
  const lv = new Map<string, number[]>();
  for (const s of [ACWI, fiSym, AGG_FALLBACK, CMDTY, REIT, BTC, ...FACTOR_SYMS]) lv.set(s, usdPx(s));
  const styleFi = bySym.has(AGG_FALLBACK) ? AGG_FALLBACK : fiSym;
  const build = (idx: number[] | null) => {
    const sel = (l: number[]) => toReturns(idx ? pick(l, idx) : l);
    const rfR = sel(rfLv);
    const rp = sel(nav);
    const r = (s: string) => sel(lv.get(s)!);
    const diff = (x: number[], y: number[]) => x.map((v, i) => v - y[i]!);
    const factors: Record<EtfFactorKey, number[]> = {
      eq: diff(r(ACWI), rfR),
      rate: diff(r("IEF"), rfR),
      credit: diff(r("HYG"), r("IEF")),
      usd: diff(r("UUP"), rfR),
      cmdty: diff(r(CMDTY), rfR),
      btc: diff(r(BTC), rfR),
      em: diff(r("EEM"), r(ACWI)),
    };
    const styleX = ETF_STYLE_INDICES.map((s) => (s.key === "cash" ? rfR : s.key === "fi" ? r(styleFi) : r(s.symbol)));
    return { rfR, rp, factors, styleX, sel };
  };
  const regress = (freq: "daily" | "weekly") => {
    const idx = freq === "weekly" ? weeklyIndex(cal) : null;
    const { rfR, rp, factors, styleX } = build(idx);
    const y = rp.map((v, i) => v - rfR[i]!);
    return {
      reg: factorRegression(y, ETF_FACTORS.map((f) => factors[f.key]), ETF_FACTORS, freq, freq === "weekly" ? 52 : annF),
      style: styleFit(rp, styleX, ETF_STYLE_INDICES, freq),
    };
  };
  const daily = regress("daily");
  const weekly = regress("weekly");
  if (!daily.reg) notes.push("팩터 분석: 관측치가 부족합니다 (일간 최소 17개 필요). 백테스트 모드를 이용해 보세요.");
  const rolling = (() => {
    const { rp, styleX } = build(null);
    return rollingStyle(cal, rp, styleX, ETF_STYLE_INDICES);
  })();
  const holdingFactors: EtfAnalysis["factors"]["holdings"] = [];
  {
    const { rfR, factors, sel } = build(null);
    for (const h of holdings) {
      if (h.asset === "CASH") continue;
      const l = px.get(h.key);
      if (!l) continue;
      const fit = ols(sel(l).map((v, i) => v - rfR[i]!), ETF_FACTORS.map((f) => factors[f.key]));
      if (!fit) continue;
      const betas: Record<string, number> = {};
      ETF_FACTORS.forEach((f, j) => {
        betas[f.key] = fit.coef[j + 1]!;
      });
      holdingFactors.push({ key: h.key, ticker: h.ticker, r2: fit.r2, n: fit.n, betas });
    }
  }

  const invested = holdings.filter((h) => h.asset !== "CASH" && h.current_pct > 0);
  const erRows = invested.filter((h) => h.expense_ratio_pct != null);
  const investedW = invested.reduce((s, h) => s + h.current_pct, 0);

  return {
    ok: true,
    mode,
    as_of: lastD,
    start_date: cal[0]!,
    bm,
    bm_label: bmLabel(bm),
    bm_fi_symbol: fiSym,
    ann_factor: annF,
    rf_ann_pct: rfAnn,
    notes: [...new Set(notes)],
    last_dates: {
      "ACWI": bySym.get(ACWI)?.dates.at(-1) || null,
      [fiSym === AGG ? "Global Agg(AGGG.L)" : "BNDW"]: bySym.get(fiSym)?.dates.at(-1) || null,
      "BCOM(DJP)": bySym.get(CMDTY)?.dates.at(-1) || null,
      "글로벌 리츠(REET)": bySym.get(REIT)?.dates.at(-1) || null,
      "비트코인": bySym.get(BTC)?.dates.at(-1) || null,
    },
    weekly: week,
    series,
    period_returns,
    monthly,
    metrics: { port: portM, bm: bmM, rel },
    holdings,
    assets: assetsOut,
    alt_mix,
    groups: [...groupMap.values()],
    brinson,
    equity: {
      weight_pct: eqWeight,
      countries,
      country_source: acwiW.source,
      look_through_notes: lookNotes,
      sleeve_return_pct: sleeveCum,
      acwi_return_pct: acwiCum,
      allocation_pct: allocSum,
      selection_pct: sleeveCum != null ? sleeveCum - acwiCum - allocSum : 0,
      proxy_gap_pct: proxyGap,
      region,
      sectors,
      pe: harmonic("pe"),
      pb: harmonic("pb"),
      bm_pe: acwiInfo?.pe ?? null,
      bm_pb: acwiInfo?.pb ?? null,
    },
    bonds: {
      weight_pct: fiWeight,
      rows: fiCur.map((h) => ({
        ticker: h.ticker,
        name_ko: h.name_ko,
        group: h.group,
        weight_pct: h.current_pct,
        duration: h.duration,
        duration_emp: h.duration_emp,
        yield_pct: h.yield_pct,
        top_rating: topRating(h),
      })),
      duration: fiDur,
      duration_emp: wavg(fiCur, (h) => h.duration_emp),
      bm_duration: ETF_BM_DURATION,
      bm_duration_emp: empDuration(fiSym),
      duration_contrib: fiDur != null ? (fiDur * fiWeight) / 100 : null,
      bm_duration_contrib: ETF_BM_DURATION * wb.FI,
      yield_pct: wavg(fiCur, (h) => h.yield_pct),
      credit: CREDIT_BUCKETS.map((b) => ({ key: b.key, label: b.label, pct: fiWeight > 0 ? ((credit[b.key] || 0) / fiWeight) * 100 : 0 })).filter(
        (r) => r.pct > 0.05,
      ),
      sleeve_return_pct: fiRow?.port_return_pct ?? null,
      bm_return_pct: fiRow?.bm_return_pct ?? null,
      bm_hedged_return_pct: hedged && isNum(hedged[0]!) && isNum(hedged[lastIdx]!) ? (hedged[lastIdx]! / hedged[0]! - 1) * 100 : null,
    },
    costs: {
      expense_ratio_pct: wavg(invested, (h) => h.expense_ratio_pct),
      yield_pct: wavg(invested, (h) => h.yield_pct),
      coverage_pct: investedW > 0 ? (erRows.reduce((s, h) => s + h.current_pct, 0) / investedW) * 100 : 0,
    },
    style: {
      rbsa: { daily: daily.style, weekly: weekly.style },
      rolling,
      target: { eq: wb.EQ * 100, fi: wb.FI * 100, cmdty: wb.cmdty * 100, reit: wb.reit * 100, btc: wb.digital * 100, cash: wb.CASH * 100 },
    },
    factors: { daily: daily.reg, weekly: weekly.reg, holdings: holdingFactors },
  };
}

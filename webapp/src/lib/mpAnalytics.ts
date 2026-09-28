/**
 * MP performance analytics (server): USD NAV simulation from dated target
 * versions, 70/30 S&P500+CSI300 benchmark, fund metrics, sector / country
 * attribution, holdings- and returns-based style, ETF-proxy factor model.
 * Prices: Yahoo chart (close, price return). CSI300 ← 510300.SS (index has no history on Yahoo).
 */

import {
  addDays,
  alignTo,
  cachedLookup,
  drawdowns,
  factorRegression,
  fetchDaily,
  fetchEtfProfile,
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
  UA,
  weeklyIndex,
  yahooCrumb,
  type Daily,
  type MpMetricSet,
  type MpRegression,
  type MpRelativeMetrics,
  type MpStyleRegression,
  type MpWeeklyMover,
} from "@/lib/mpCore";
import {
  holdingKey,
  MP_BM_SECTOR_FALLBACK,
  MP_SECTORS,
  mpSectorLabel,
  normalizeTicker,
  sortedVersions,
  tickerMeta,
  yahooSymbolFor,
  type MpCountry,
  type MpHolding,
  type MpPortfolio,
  type MpSectorKey,
} from "@/lib/mpPortfolio";

export type { MpMetricSet, MpRegression, MpRelativeMetrics, MpStyleRegression, MpWeeklyMover };

const SPX = "^GSPC";
const CSI = "510300.SS";
const RF = "^IRX";

export const MP_FACTORS = [
  { key: "mkt", label: "시장(BM−Rf)", desc: "벤치마크 초과 무위험수익" },
  { key: "size", label: "규모", desc: "IWM − SPY (소형 − 대형)" },
  { key: "value", label: "가치", desc: "IVE − IVW (가치 − 성장)" },
  { key: "mom", label: "모멘텀", desc: "MTUM − SPY" },
  { key: "qual", label: "퀄리티", desc: "QUAL − SPY (학술 수익성 팩터 RMW와 상관이 낮아 참고용)" },
  { key: "lowvol", label: "저변동", desc: "USMV − SPY" },
  { key: "semi", label: "반도체", desc: "SOXX − SPY" },
  { key: "china", label: "중국 상대", desc: "CSI300(USD) − S&P500" },
] as const;

export type MpFactorKey = (typeof MP_FACTORS)[number]["key"];

export const MP_STYLE_INDICES = [
  { key: "us_lg", label: "미국 대형성장", symbol: "IVW" },
  { key: "us_lv", label: "미국 대형가치", symbol: "IVE" },
  { key: "us_sc", label: "미국 소형", symbol: "IWM" },
  { key: "cn_lc", label: "중국 대형(CSI300)", symbol: CSI },
  { key: "cn_gr", label: "중국 기술성장(STAR50)", symbol: "588000.SS" },
  { key: "cash", label: "현금(T-bill)", symbol: RF },
] as const;

const FACTOR_ETFS = ["SPY", "IWM", "IVE", "IVW", "MTUM", "QUAL", "USMV", "SOXX", "588000.SS"];

export type MpMode = "actual" | "backtest";

export type MpHoldingRow = {
  key: string;
  ticker: string;
  yahoo: string | null;
  name: string;
  country: MpCountry;
  sector_label: string;
  msector: string;
  currency: string;
  status: "held" | "pending" | "exited";
  target_pct: number;
  current_pct: number;
  first_date: string | null;
  last_price: number | null;
  day_change_pct: number | null;
  return_since_entry_pct: number | null;
  local_return_since_entry_pct: number | null;
  contribution_pct: number;
  fx_contribution_pct: number;
  week_contribution_pct: number;
  week_return_pct: number | null;
  market_cap_usd: number | null;
  pe: number | null;
  forward_pe: number | null;
  pb: number | null;
  div_yield_pct: number | null;
  size_bucket: string;
  style_bucket: string;
};

export type MpSectorRow = {
  key: string;
  label: string;
  port_pct: number;
  target_pct: number;
  bm_pct: number;
  bm_us_pct: number;
  bm_cn_pct: number;
  active_pct: number;
  contribution_pct: number;
};

export type MpGroupRow = {
  key: string;
  country: MpCountry;
  label: string;
  port_pct: number;
  target_pct: number;
  contribution_pct: number;
  tickers: string[];
};

export type MpBrinsonRow = {
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
};

export type MpWeekly = {
  from: string;
  to: string;
  port_pct: number;
  bm_pct: number;
  excess_pct: number;
  spx_pct: number;
  csi_pct: number;
  countries: Array<{
    key: MpCountry;
    label: string;
    port_w_pct: number;
    bm_w_pct: number;
    port_ret_pct: number | null;
    bm_ret_pct: number;
    contribution_pct: number;
    allocation_pct: number;
    selection_pct: number;
  }>;
  top: MpWeeklyMover[];
  bottom: MpWeeklyMover[];
  sectors: Array<{ key: string; label: string; contribution_pct: number }>;
  intraday: string[];
  comment: string[];
};

export type MpAnalysis = {
  ok: boolean;
  error?: string;
  mode: MpMode;
  as_of: string | null;
  start_date: string | null;
  bm_label: string;
  ann_factor: number;
  rf_ann_pct: number | null;
  notes: string[];
  last_dates: Record<string, string | null>;
  weekly: MpWeekly | null;
  series: Array<{
    date: string;
    port: number;
    bm: number;
    spx: number;
    csi: number;
    port_dd: number;
    bm_dd: number;
  }>;
  period_returns: Array<{
    key: string;
    label: string;
    port_pct: number | null;
    bm_pct: number | null;
    excess_pct: number | null;
  }>;
  monthly: Array<{ month: string; port_pct: number; bm_pct: number; excess_pct: number }>;
  metrics: { port: MpMetricSet; bm: MpMetricSet; rel: MpRelativeMetrics } | null;
  holdings: MpHoldingRow[];
  sectors: MpSectorRow[];
  bm_sector_source: "live" | "fallback";
  pm_sectors: MpGroupRow[];
  countries: Array<{ key: string; label: string; port_pct: number; bm_pct: number; active_pct: number; contribution_pct: number }>;
  fx_contribution_pct: number;
  brinson: { rows: MpBrinsonRow[]; residual_pct: number } | null;
  style: {
    holdings: {
      coverage_pct: number;
      pe: number | null;
      forward_pe: number | null;
      pb: number | null;
      div_yield_pct: number | null;
      wavg_mcap_usd: number | null;
      median_mcap_usd: number | null;
      bm_pe: number | null;
      bm_pb: number | null;
      size: Array<{ key: string; label: string; weight_pct: number }>;
      box: Record<string, number>;
    };
    rbsa: { daily: MpStyleRegression | null; weekly: MpStyleRegression | null };
    rolling: Array<{ date: string } & Record<string, number | string>>;
  };
  factors: {
    daily: MpRegression | null;
    weekly: MpRegression | null;
    holdings: Array<{ key: string; ticker: string; r2: number; n: number; betas: Record<string, number> }>;
  };
};

/* ------------------------------------------------------------------ */
/* Data fetch                                                          */
/* ------------------------------------------------------------------ */

type Fundamentals = {
  market_cap: number | null;
  pe: number | null;
  forward_pe: number | null;
  pb: number | null;
  /** Yahoo `dividendYield` is already in percent (ADR-safe, unlike trailingAnnualDividendYield). */
  div_yield_pct: number | null;
  currency: string;
  name: string | null;
  /** Yahoo divides the ADR price by book value per ordinary share (no ADR ratio), e.g. TSM ×5. */
  pb_dropped_adr: boolean;
};

async function fetchFundamentals(symbols: string[]): Promise<Map<string, Fundamentals>> {
  if (!symbols.length) return new Map();
  const key = `mp:fund2:${[...symbols].sort().join(",")}`;
  const hit = await cachedLookup(key, 3_600_000, 6 * 3_600_000, async () => {
    const j = await yahooCrumb();
    const url =
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}` +
      `&fields=marketCap,trailingPE,forwardPE,priceToBook,dividendYield,longName,currency,financialCurrency` +
      `&crumb=${encodeURIComponent(j.crumb)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: j.cookie, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { quoteResponse?: { result?: Array<Record<string, unknown>> } };
    const out = new Map<string, Fundamentals>();
    for (const q of json.quoteResponse?.result || []) {
      const sym = String(q.symbol || "").toUpperCase();
      if (!sym) continue;
      const currency = String(q.currency || "USD").toUpperCase();
      const finCur = typeof q.financialCurrency === "string" ? q.financialCurrency.toUpperCase() : currency;
      const adr = currency === "USD" && finCur !== currency;
      out.set(sym, {
        market_cap: numOrNull(q.marketCap),
        pe: numOrNull(q.trailingPE),
        forward_pe: numOrNull(q.forwardPE),
        pb: adr ? null : numOrNull(q.priceToBook),
        div_yield_pct: numOrNull(q.dividendYield),
        currency,
        name: typeof q.longName === "string" ? q.longName : null,
        pb_dropped_adr: adr && numOrNull(q.priceToBook) != null,
      });
    }
    return out.size ? out : null;
  });
  return hit ?? new Map();
}

async function fetchSectorKey(symbol: string): Promise<MpSectorKey | null> {
  return cachedLookup(`mp:sector:${symbol}`, 24 * 3_600_000, 7 * 24 * 3_600_000, async () => {
    const r = await quoteSummary<{ assetProfile?: { sectorKey?: string } }>(symbol, "assetProfile");
    const raw = r?.assetProfile?.sectorKey || "";
    const key = raw.replace(/-/g, "_").replace("real_estate", "realestate") as MpSectorKey;
    return MP_SECTORS.some((s) => s.key === key) ? key : null;
  });
}

/* ------------------------------------------------------------------ */
/* Stats helpers                                                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

type AssetInfo = {
  key: string;
  ticker: string;
  country: MpCountry;
  yahoo: string;
  sector_label: string;
};

function emptyAnalysis(mode: MpMode, error: string, notes: string[] = []): MpAnalysis {
  return {
    ok: false,
    error,
    mode,
    as_of: null,
    start_date: null,
    bm_label: "",
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
    sectors: [],
    bm_sector_source: "fallback",
    pm_sectors: [],
    countries: [],
    fx_contribution_pct: 0,
    brinson: null,
    style: {
      holdings: {
        coverage_pct: 0,
        pe: null,
        forward_pe: null,
        pb: null,
        div_yield_pct: null,
        wavg_mcap_usd: null,
        median_mcap_usd: null,
        bm_pe: null,
        bm_pb: null,
        size: [],
        box: {},
      },
      rbsa: { daily: null, weekly: null },
      rolling: [],
    },
    factors: { daily: null, weekly: null, holdings: [] },
  };
}

function weeklyComment(w: MpWeekly): string[] {
  const lines: string[] = [];
  const ex = w.excess_pct;
  const verdict =
    Math.abs(ex) < 0.05
      ? `BM(${sgn(w.bm_pct)}%)과 비슷했습니다`
      : `BM(${sgn(w.bm_pct)}%)을 ${Math.abs(ex).toFixed(2)}%p ${ex > 0 ? "상회" : "하회"}했습니다`;
  const spanDays = (Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86_400_000;
  lines.push(
    `${spanDays < 7 ? "설정 이후" : "최근 1주"}(${monthDay(w.from)}~${monthDay(w.to)}) MP는 ${sgn(w.port_pct)}%로 ${verdict}. ` +
      `같은 기간 S&P500 ${sgn(w.spx_pct)}%, CSI300(달러) ${sgn(w.csi_pct)}%.`,
  );

  const mover = (m: MpWeeklyMover) => `${m.label}(${sgn(m.contribution_pct)}%p)`;
  const legs: string[] = [];
  if (w.top.length) legs.push(`상승 기여는 ${w.top.slice(0, 2).map(mover).join("·")}`);
  if (w.bottom.length) legs.push(`하락 기여는 ${w.bottom.slice(0, 2).map(mover).join("·")}`);
  const sec = w.sectors[0];
  const secText = sec ? `업종별로는 ${sec.label}(${sgn(sec.contribution_pct)}%p) 영향이 가장 컸습니다.` : "";
  if (legs.length || secText) lines.push(legs.length ? `${legs.join(", ")}였고, ${secText}`.trim() : secText);

  const held = w.countries.filter((c) => c.key !== "CASH" && (c.port_w_pct > 0.05 || c.bm_w_pct > 0.05));
  const cash = w.countries.find((c) => c.key === "CASH");
  const cn = w.countries.find((c) => c.key === "CN");
  const alloc = w.countries.reduce((s, c) => s + c.allocation_pct, 0);
  const pos: string[] = [];
  if (cn && (cn.port_w_pct > 0.05 || cn.bm_w_pct > 0.05)) {
    pos.push(`중국 ${cn.port_w_pct.toFixed(1)}%(BM ${cn.bm_w_pct.toFixed(0)}%)`);
  }
  if (cash && cash.port_w_pct >= 0.5) pos.push(`현금 ${cash.port_w_pct.toFixed(1)}%`);
  const sel = held
    .filter((c) => c.port_w_pct > 0.05)
    .map((c) => `${c.label} ${sgn(c.selection_pct)}%p`)
    .join("·");
  lines.push(
    `${pos.length ? `${pos.join("·")} 비중에 따른 ` : ""}국가 배분 효과는 ${sgn(alloc)}%p` +
      (sel ? `, 종목 선택 효과는 ${sel}였습니다.` : "였습니다."),
  );
  if (w.intraday.length) {
    const when = w.intraday.map((s) => s.replace(/(\d{4}-\d{2}-\d{2})/, (d) => monthDay(d))).join(", ");
    lines.push(`※ ${when}은 장중(지연) 가격 기준이라 마감 후 달라질 수 있습니다.`);
  }
  return lines;
}

export async function analyzeMp(
  portfolio: MpPortfolio,
  mode: MpMode,
  lookbackDays = 365,
): Promise<MpAnalysis> {
  const notes: string[] = [];
  const versions = sortedVersions(portfolio).filter((v) => v.date && v.holdings.length);
  if (!versions.length) return emptyAnalysis(mode, "편입 내역이 없습니다.");
  const latest = versions[versions.length - 1]!;
  const a = Math.min(100, Math.max(0, Number(portfolio.bm_us_pct ?? 70))) / 100;
  const bmLabel = `S&P500 ${Math.round(a * 100)}% + CSI300 ${Math.round((1 - a) * 100)}%`;

  const today = new Date().toISOString().slice(0, 10);
  const start = mode === "actual" ? versions[0]!.date : addDays(today, -Math.max(30, lookbackDays));
  if (start > today) return emptyAnalysis(mode, "편입일이 미래입니다.");
  const schedule =
    mode === "actual" ? versions : [{ ...latest, date: start }];

  // Universe
  const assets = new Map<string, AssetInfo>();
  const cashKeys = new Set<string>();
  for (const v of schedule) {
    for (const h of v.holdings) {
      const key = holdingKey(h);
      if (h.country === "CASH") {
        cashKeys.add(key);
        continue;
      }
      const yahoo = yahooSymbolFor(h);
      if (!yahoo) continue;
      if (!assets.has(key)) {
        assets.set(key, {
          key,
          ticker: normalizeTicker(h.ticker, h.country),
          country: h.country,
          yahoo,
          sector_label: h.sector,
        });
      } else {
        assets.get(key)!.sector_label = h.sector || assets.get(key)!.sector_label;
      }
    }
  }
  if (assets.size > 60) return emptyAnalysis(mode, "종목은 최대 60개까지 분석합니다.");

  const fetchStart = addDays(start, -14);
  const aux = [SPX, CSI, RF, "CNY=X", ...FACTOR_ETFS];
  const symbols = [...new Set([...aux, ...[...assets.values()].map((x) => x.yahoo)])];
  const fetched = await mapPool(symbols, 8, async (s) => {
    try {
      return await fetchDaily(s, fetchStart);
    } catch (exc) {
      notes.push(`${s} 가격 조회 실패: ${exc instanceof Error ? exc.message : String(exc)}`);
      return null;
    }
  });
  const bySym = new Map<string, Daily>();
  fetched.forEach((d, i) => {
    if (d && d.dates.length) bySym.set(symbols[i]!, d);
  });
  if (!bySym.get(SPX) || !bySym.get(CSI)) return emptyAnalysis(mode, "벤치마크 가격을 불러오지 못했습니다.", notes);
  notes.push(...splitNotes(bySym));

  // Extra FX legs (HKD, JPY …) for non-USD listings
  const currencies = new Set<string>();
  for (const x of assets.values()) {
    const cur = bySym.get(x.yahoo)?.currency;
    if (cur && cur !== "USD" && cur !== "CNY") currencies.add(cur);
  }
  if (cashKeys.has("CASH:CNY")) currencies.delete("CNY");
  for (const cur of currencies) {
    try {
      bySym.set(`${cur}=X`, await fetchDaily(`${cur}=X`, fetchStart));
    } catch {
      notes.push(`${cur} 환율 조회 실패 — 현지통화 가격을 그대로 사용`);
    }
  }

  // Calendar: union of US and China trading days from `start`
  const calSet = new Set<string>();
  for (const s of [SPX, CSI]) for (const d of bySym.get(s)!.dates) if (d >= start) calSet.add(d);
  const cal = [...calSet].sort();
  if (cal.length < 2) {
    return emptyAnalysis(mode, `${start} 이후 거래일이 부족합니다 (최소 2거래일).`, notes);
  }
  const N = cal.length;

  const align = (sym: string): number[] => alignTo(cal, bySym.get(sym));
  const fxOf = (cur: string): number[] | null => {
    if (cur === "USD") return null;
    const s = `${cur}=X`;
    if (!bySym.has(s)) return null;
    return align(s);
  };
  const cny = align("CNY=X");
  const usdPx = (sym: string): number[] => {
    const local = align(sym);
    const cur = bySym.get(sym)?.currency || "USD";
    const fx = cur === "CNY" ? cny : fxOf(cur);
    return fx ? local.map((p, i) => (isNum(p) && isNum(fx[i]!) && fx[i]! > 0 ? p / fx[i]! : NaN)) : local;
  };

  const spx = align(SPX);
  const csiUsd = usdPx(CSI);
  const irx = align(RF);
  const rfDaily = rfDailyFrom(cal, irx);

  // Asset price paths (USD) + local
  const px = new Map<string, number[]>();
  const pxLocal = new Map<string, number[]>();
  for (const x of assets.values()) {
    if (!bySym.has(x.yahoo)) {
      notes.push(`${x.ticker}: 가격 데이터 없음 — 현금으로 대기`);
    }
    px.set(x.key, usdPx(x.yahoo));
    pxLocal.set(x.key, align(x.yahoo));
  }

  // ---------------- Simulation ----------------
  const effIdx = (date: string) => cal.findIndex((d) => d >= date);
  const rebal = new Map<number, MpHolding[]>();
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
  let cashCny = 0;
  const nav = new Array<number>(N).fill(NaN);
  const contrib = new Map<string, number>();
  const fxContrib = new Map<string, number>();
  const firstDate = new Map<string, string>();
  const entryPx = new Map<string, number>();
  const entryLocal = new Map<string, number>();
  const everHeld = new Set<string>();
  const segDaily: Array<{ w: Record<string, number>; r: Record<string, number | null> }> = [];
  const pendingNoted = new Set<string>();

  const valueAt = (i: number) => {
    let v = cashUsd + (isNum(cny[i]!) && cny[i]! > 0 ? cashCny / cny[i]! : 0);
    for (const amt of pending.values()) v += amt;
    for (const [k, u] of units) {
      const p = px.get(k)![i]!;
      if (isNum(p)) v += u * p;
    }
    return v;
  };
  const segOf = (k: string) => assets.get(k)?.country || "CASH";

  const weekFrom = addDays(cal[N - 1]!, -7);
  let wBase = 0;
  for (let i = 0; i < N; i++) if (cal[i]! <= weekFrom) wBase = i;
  const weekContrib = new Map<string, number>();
  const addWeek = (k: string, pnl: number, i: number) => {
    if (i > wBase) weekContrib.set(k, (weekContrib.get(k) || 0) + (pnl / nav[wBase]!) * 100);
  };
  let weekSeg: Record<string, number> = { US: 0, CN: 0, CASH: 1 };

  for (let i = 0; i < N; i++) {
    if (i === 0) {
      nav[0] = 100;
      cashUsd = 100;
    } else {
      const prevNav = nav[i - 1]!;
      const link = prevNav / 100;
      const segPnl: Record<string, number> = { US: 0, CN: 0, CASH: 0 };
      const segW: Record<string, number> = { US: 0, CN: 0, CASH: 0 };
      for (const [k, u] of units) {
        const p0 = px.get(k)![i - 1]!;
        const p1 = px.get(k)![i]!;
        const seg = segOf(k);
        if (isNum(p0)) segW[seg] = (segW[seg] || 0) + (u * p0) / prevNav;
        if (!isNum(p0) || !isNum(p1)) continue;
        const pnl = u * (p1 - p0);
        segPnl[seg] = (segPnl[seg] || 0) + pnl;
        contrib.set(k, (contrib.get(k) || 0) + (pnl / prevNav) * link * 100);
        addWeek(k, pnl, i);
        const l0 = pxLocal.get(k)![i - 1]!;
        const l1 = pxLocal.get(k)![i]!;
        if (isNum(l0) && isNum(l1) && l0 > 0 && p0 !== l0) {
          const localPnl = u * (l1 - l0) * (p0 / l0);
          fxContrib.set(k, (fxContrib.get(k) || 0) + ((pnl - localPnl) / prevNav) * link * 100);
        }
      }
      const pendingSum = [...pending.values()].reduce((s, v) => s + v, 0);
      const cnyPrev = isNum(cny[i - 1]!) && cny[i - 1]! > 0 ? cashCny / cny[i - 1]! : 0;
      const cnyNow = isNum(cny[i]!) && cny[i]! > 0 ? cashCny / cny[i]! : cnyPrev;
      const interest = cashUsd * rfDaily[i]!;
      cashUsd += interest;
      const cashPnl = interest + (cnyNow - cnyPrev);
      segW.CASH = (cashUsd - interest + pendingSum + cnyPrev) / prevNav;
      segPnl.CASH = cashPnl;
      if (cashCny) {
        contrib.set("CASH:CNY", (contrib.get("CASH:CNY") || 0) + ((cnyNow - cnyPrev) / prevNav) * link * 100);
        fxContrib.set("CASH:CNY", (fxContrib.get("CASH:CNY") || 0) + ((cnyNow - cnyPrev) / prevNav) * link * 100);
        addWeek("CASH:CNY", cnyNow - cnyPrev, i);
      }
      contrib.set("CASH:USD", (contrib.get("CASH:USD") || 0) + (interest / prevNav) * link * 100);
      addWeek("CASH:USD", interest, i);
      nav[i] = valueAt(i);
      const r: Record<string, number | null> = {};
      for (const s of ["US", "CN", "CASH"]) {
        const base = segW[s]! * prevNav;
        r[s] = base > 1e-9 ? segPnl[s]! / base : null;
      }
      segDaily.push({ w: segW, r });
    }

    // Pending buys: first available price after listing
    for (const [k, amt] of [...pending.entries()]) {
      const p = px.get(k)![i]!;
      if (!isNum(p) || p <= 0) continue;
      units.set(k, (units.get(k) || 0) + amt / p);
      pending.delete(k);
      if (!firstDate.has(k)) firstDate.set(k, cal[i]!);
      if (!entryPx.has(k)) {
        entryPx.set(k, p);
        entryLocal.set(k, pxLocal.get(k)![i]!);
      }
      everHeld.add(k);
      if (mode === "actual") notes.push(`${assets.get(k)?.ticker}: ${cal[i]} 첫 거래 가능일에 편입 (상장/데이터 시작)`);
    }

    const targets = rebal.get(i);
    if (targets) {
      const total = valueAt(i);
      units.clear();
      pending.clear();
      cashCny = 0;
      let allocated = 0;
      let cnyTarget = 0;
      for (const h of targets) {
        const w = (Number(h.weight_pct) || 0) / 100;
        const k = holdingKey(h);
        if (h.country === "CASH") {
          if (k === "CASH:CNY") cnyTarget += w;
          continue;
        }
        if (!w || !assets.has(k)) continue;
        const amt = total * w;
        allocated += amt;
        const p = px.get(k)![i]!;
        if (isNum(p) && p > 0) {
          units.set(k, (units.get(k) || 0) + amt / p);
          everHeld.add(k);
          if (!firstDate.has(k)) firstDate.set(k, cal[i]!);
          if (!entryPx.has(k)) {
            entryPx.set(k, p);
            entryLocal.set(k, pxLocal.get(k)![i]!);
          }
        } else {
          pending.set(k, (pending.get(k) || 0) + amt);
          if (!pendingNoted.has(k)) {
            pendingNoted.add(k);
            notes.push(`${assets.get(k)!.ticker}: ${cal[i]} 가격 없음(미상장) — 상장 후 첫 종가에 편입, 그 전까지 현금`);
          }
        }
      }
      const cnyAmt = total * cnyTarget;
      if (cnyAmt && isNum(cny[i]!)) {
        cashCny = cnyAmt * cny[i]!;
        allocated += cnyAmt;
      }
      cashUsd = total - allocated;
    }
    // Drop entries for assets that were sold entirely
    for (const k of [...firstDate.keys()]) {
      if (!units.has(k) && !pending.has(k) && mode === "actual") {
        firstDate.delete(k);
        entryPx.delete(k);
        entryLocal.delete(k);
      }
    }
    if (i === wBase) {
      const seg: Record<string, number> = { US: 0, CN: 0, CASH: 0 };
      for (const [k, u] of units) {
        const p = px.get(k)![i]!;
        if (isNum(p)) seg[segOf(k)]! += (u * p) / nav[i]!;
      }
      seg.CASH = 1 - seg.US! - seg.CN!;
      weekSeg = seg;
    }
  }

  // ---------------- Benchmark ----------------
  const rSpx = toReturns(spx).map((r) => (isNum(r) ? r : 0));
  const rCsi = toReturns(csiUsd).map((r) => (isNum(r) ? r : 0));
  const rBm = rSpx.map((r, i) => a * r + (1 - a) * rCsi[i]!);
  const bmLv = [100];
  const spxLv = [100];
  const csiLv = [100];
  for (let i = 0; i < rBm.length; i++) {
    bmLv.push(bmLv[i]! * (1 + rBm[i]!));
    spxLv.push(spxLv[i]! * (1 + rSpx[i]!));
    csiLv.push(csiLv[i]! * (1 + rCsi[i]!));
  }
  const rPort = toReturns(nav);
  const rf = rfDaily.slice(1);

  const spanDays = (Date.parse(`${cal[N - 1]}T00:00:00Z`) - Date.parse(`${cal[0]}T00:00:00Z`)) / 86_400_000;
  const annF = spanDays >= 90 ? Math.min(270, Math.max(240, ((N - 1) / spanDays) * 365.25)) : 252;
  const rfAnn = spanDays > 0 ? (rf.reduce((s, x) => s + x, 0) / spanDays) * 365 * 100 : null;

  const portDd = drawdowns(nav);
  const bmDd = drawdowns(bmLv);
  const series = cal.map((d, i) => ({
    date: d,
    port: nav[i]!,
    bm: bmLv[i]!,
    spx: spxLv[i]!,
    csi: csiLv[i]!,
    port_dd: portDd[i]!,
    bm_dd: bmDd[i]!,
  }));

  const portM = metricSet(cal, nav, rPort, rf, annF, spanDays);
  const bmM = metricSet(cal, bmLv, rBm, rf, annF, spanDays);
  const rel = relativeMetrics(rPort, rBm, rf, annF, portM.total_return_pct, bmM.total_return_pct);

  const lastD = cal[N - 1]!;
  const period_returns = periodReturns(cal, nav, bmLv, mode === "actual" ? "설정 이후" : "전체 구간");
  const monthly = monthlyReturns(cal, nav, bmLv);

  // ---------------- Holdings / fundamentals ----------------
  const lastIdx = N - 1;
  const endNav = nav[lastIdx]!;
  const targetMap = new Map<string, number>();
  for (const h of latest.holdings) targetMap.set(holdingKey(h), (targetMap.get(holdingKey(h)) || 0) + (Number(h.weight_pct) || 0));

  const stockSyms = [...assets.values()].map((x) => x.yahoo);
  const [fund, spyProf, ashrProf] = await Promise.all([
    fetchFundamentals(stockSyms),
    fetchEtfProfile("SPY"),
    fetchEtfProfile("ASHR"),
  ]);
  const adrPb = [...fund.entries()].filter(([, f]) => f.pb_dropped_adr).map(([s]) => s);
  if (adrPb.length) notes.push(`P/B 제외(ADR 비율 미반영 데이터): ${adrPb.join(", ")}`);
  const unknownSector = [...assets.values()].filter((x) => !tickerMeta(x.ticker));
  const sectorLookup = new Map<string, MpSectorKey | null>();
  await mapPool(unknownSector, 6, async (x) => {
    sectorLookup.set(x.key, await fetchSectorKey(x.yahoo));
  });
  const msectorOf = (k: string): string => {
    const x = assets.get(k);
    if (!x) return "cash";
    return tickerMeta(x.ticker)?.sector || sectorLookup.get(k) || "etc";
  };

  const bmUsPe = spyProf?.pe ?? null;
  const bmCnPe = ashrProf?.pe ?? null;
  const bmUsPb = spyProf?.pb ?? null;
  const bmCnPb = ashrProf?.pb ?? null;
  const harmonicBlend = (u: number | null, c: number | null) =>
    u && c ? 1 / (a / u + (1 - a) / c) : u || c || null;
  const bmPe = harmonicBlend(bmUsPe, bmCnPe);
  const bmPb = harmonicBlend(bmUsPb, bmCnPb);
  const lastCny = cny[lastIdx]!;

  const sizeBucket = (mcap: number | null, isEtf: boolean) => {
    if (isEtf || mcap == null) return "etf";
    if (mcap >= 200e9) return "mega";
    if (mcap >= 10e9) return "large";
    if (mcap >= 2e9) return "mid";
    return "small";
  };
  const styleBucket = (country: MpCountry, f: Fundamentals | undefined, isEtf: boolean) => {
    if (isEtf || !f) return "na";
    const refPe = country === "CN" ? bmCnPe : bmUsPe;
    const refPb = country === "CN" ? bmCnPb : bmUsPb;
    let ratio: number | null = null;
    if (f.pe && f.pe > 0 && refPe) ratio = f.pe / refPe;
    else if (f.forward_pe && f.forward_pe > 0 && refPe) ratio = f.forward_pe / refPe;
    else if (f.pb && f.pb > 0 && refPb) ratio = f.pb / refPb;
    if (ratio == null) return "na";
    if (ratio < 0.8) return "value";
    if (ratio > 1.25) return "growth";
    return "blend";
  };

  const holdings: MpHoldingRow[] = [];
  const allKeys = new Set<string>([...assets.keys(), ...cashKeys, "CASH:USD"]);
  if (cashCny) allKeys.add("CASH:CNY");
  for (const k of allKeys) {
    const x = assets.get(k);
    const isCash = !x;
    const p = x ? px.get(k)! : null;
    const pl = x ? pxLocal.get(k)! : null;
    const u = units.get(k) || 0;
    let value = 0;
    if (x && u && p && isNum(p[lastIdx]!)) value = u * p[lastIdx]!;
    if (x && pending.has(k)) value = pending.get(k)!;
    if (k === "CASH:USD") value = cashUsd;
    if (k === "CASH:CNY") value = isNum(lastCny) && lastCny > 0 ? cashCny / lastCny : 0;
    const status: MpHoldingRow["status"] = pending.has(k) ? "pending" : u > 0 || isCash ? "held" : "exited";
    if (x && status === "exited" && !everHeld.has(k)) continue;
    const f = x ? fund.get(x.yahoo.toUpperCase()) : undefined;
    const meta = x ? tickerMeta(x.ticker) : undefined;
    const isEtf = meta?.kind === "etf";
    const cur = x ? bySym.get(x.yahoo)?.currency || "USD" : k === "CASH:CNY" ? "CNY" : "USD";
    const mcapUsd =
      f?.market_cap != null ? (f.currency === "CNY" && lastCny > 0 ? f.market_cap / lastCny : f.market_cap) : null;
    const lastLocal = pl ? pl[lastIdx]! : NaN;
    const own = x ? bySym.get(x.yahoo) : undefined;
    const ownLast = own?.close.at(-1) ?? NaN;
    const ownPrev = own?.close.at(-2) ?? NaN;
    const ep = entryPx.get(k);
    const el = entryLocal.get(k);
    holdings.push({
      key: k,
      ticker: x ? x.ticker : k.replace("CASH:", ""),
      yahoo: x ? x.yahoo : null,
      name: x ? meta?.name || f?.name || bySym.get(x.yahoo)?.name || x.ticker : k === "CASH:CNY" ? "위안화 현금" : "달러 현금",
      country: x ? x.country : "CASH",
      sector_label: x ? x.sector_label : "현금",
      msector: msectorOf(k),
      currency: cur,
      status,
      target_pct: targetMap.get(k) || 0,
      current_pct: endNav > 0 ? (value / endNav) * 100 : 0,
      first_date: firstDate.get(k) || null,
      last_price: isNum(lastLocal) ? lastLocal : null,
      day_change_pct: isNum(ownLast) && isNum(ownPrev) && ownPrev > 0 ? (ownLast / ownPrev - 1) * 100 : null,
      return_since_entry_pct: ep && p && isNum(p[lastIdx]!) && status !== "exited" ? (p[lastIdx]! / ep - 1) * 100 : null,
      local_return_since_entry_pct:
        el && isNum(lastLocal) && status !== "exited" ? (lastLocal / el - 1) * 100 : null,
      contribution_pct: contrib.get(k) || 0,
      fx_contribution_pct: fxContrib.get(k) || 0,
      week_contribution_pct: weekContrib.get(k) || 0,
      week_return_pct:
        p && isNum(p[lastIdx]!) && isNum(p[wBase]!) && p[wBase]! > 0 && status !== "exited"
          ? (p[lastIdx]! / p[wBase]! - 1) * 100
          : null,
      market_cap_usd: mcapUsd,
      pe: f?.pe ?? null,
      forward_pe: f?.forward_pe ?? null,
      pb: f?.pb ?? null,
      div_yield_pct: f ? (f.div_yield_pct ?? (isEtf ? null : 0)) : null,
      size_bucket: isCash ? "cash" : sizeBucket(mcapUsd, isEtf),
      style_bucket: isCash ? "cash" : styleBucket(x!.country, f, isEtf),
    });
  }
  holdings.sort((p, q) => {
    const order = { US: 0, CN: 1, CASH: 2 } as const;
    return order[p.country] - order[q.country] || q.target_pct - p.target_pct || q.current_pct - p.current_pct;
  });

  // ---------------- Sectors vs BM ----------------
  const usSec = spyProf?.sectors && Object.keys(spyProf.sectors).length ? spyProf.sectors : MP_BM_SECTOR_FALLBACK.US;
  const cnSec = ashrProf?.sectors && Object.keys(ashrProf.sectors).length ? ashrProf.sectors : MP_BM_SECTOR_FALLBACK.CN;
  const bmSource: "live" | "fallback" = spyProf && ashrProf ? "live" : "fallback";
  const sectorAgg = new Map<string, { port: number; target: number; contrib: number }>();
  for (const h of holdings) {
    const s = sectorAgg.get(h.msector) || { port: 0, target: 0, contrib: 0 };
    s.port += h.current_pct;
    s.target += h.target_pct;
    s.contrib += h.contribution_pct;
    sectorAgg.set(h.msector, s);
  }
  const sectors: MpSectorRow[] = [...MP_SECTORS.map((s) => s.key as string), "etc", "cash"]
    .map((key) => {
      const agg = sectorAgg.get(key) || { port: 0, target: 0, contrib: 0 };
      const us = (usSec as Record<string, number>)[key] || 0;
      const cn = (cnSec as Record<string, number>)[key] || 0;
      const bm = a * us + (1 - a) * cn;
      return {
        key,
        label: key === "etc" ? "기타/미분류" : mpSectorLabel(key),
        port_pct: agg.port,
        target_pct: agg.target,
        bm_pct: bm,
        bm_us_pct: us,
        bm_cn_pct: cn,
        active_pct: agg.port - bm,
        contribution_pct: agg.contrib,
      };
    })
    .filter((r) => r.port_pct > 0.005 || r.bm_pct > 0.005 || r.target_pct > 0.005);

  const pmAgg = new Map<string, MpGroupRow>();
  for (const h of holdings) {
    const label = h.sector_label || "기타";
    const key = `${h.country}:${label}`;
    const row = pmAgg.get(key) || { key, country: h.country, label, port_pct: 0, target_pct: 0, contribution_pct: 0, tickers: [] };
    row.port_pct += h.current_pct;
    row.target_pct += h.target_pct;
    row.contribution_pct += h.contribution_pct;
    row.tickers.push(h.ticker);
    pmAgg.set(key, row);
  }
  const pm_sectors = [...pmAgg.values()];

  const countries = (["US", "CN", "CASH"] as MpCountry[]).map((c) => {
    const port = holdings.filter((h) => h.country === c).reduce((s, h) => s + h.current_pct, 0);
    const bm = c === "US" ? a * 100 : c === "CN" ? (1 - a) * 100 : 0;
    return {
      key: c,
      label: c === "US" ? "미국" : c === "CN" ? "중국" : "현금",
      port_pct: port,
      bm_pct: bm,
      active_pct: port - bm,
      contribution_pct: holdings.filter((h) => h.country === c).reduce((s, h) => s + h.contribution_pct, 0),
    };
  });
  const fx_contribution_pct = holdings.reduce((s, h) => s + h.fx_contribution_pct, 0);

  // ---------------- Country Brinson-Fachler ----------------
  let brinson: MpAnalysis["brinson"] = null;
  if (segDaily.length) {
    const acc: Record<string, { alloc: number; sel: number; inter: number; wp: number; rp: number; rb: number }> = {
      US: { alloc: 0, sel: 0, inter: 0, wp: 0, rp: 1, rb: 1 },
      CN: { alloc: 0, sel: 0, inter: 0, wp: 0, rp: 1, rb: 1 },
      CASH: { alloc: 0, sel: 0, inter: 0, wp: 0, rp: 1, rb: 1 },
    };
    const wbOf: Record<string, number> = { US: a, CN: 1 - a, CASH: 0 };
    const links = grapLinks(rPort, rBm);
    segDaily.forEach((d, t) => {
      const rbSeg: Record<string, number> = { US: rSpx[t]!, CN: rCsi[t]!, CASH: rf[t] || 0 };
      const rbTot = rBm[t]!;
      const link = links[t]!;
      for (const s of ["US", "CN", "CASH"]) {
        const wp = d.w[s] || 0;
        const wb = wbOf[s]!;
        const rp = d.r[s] ?? rbSeg[s]!;
        const x = acc[s]!;
        x.alloc += (wp - wb) * (rbSeg[s]! - rbTot) * link;
        x.sel += wb * (rp - rbSeg[s]!) * link;
        x.inter += (wp - wb) * (rp - rbSeg[s]!) * link;
        x.wp += wp;
        x.rp *= 1 + rp;
        x.rb *= 1 + rbSeg[s]!;
      }
    });
    const rows: MpBrinsonRow[] = (["US", "CN", "CASH"] as const).map((s) => {
      const x = acc[s]!;
      return {
        segment: s,
        label: s === "US" ? "미국 (vs S&P500)" : s === "CN" ? "중국 (vs CSI300)" : "현금 (vs T-bill)",
        port_weight_pct: (x.wp / segDaily.length) * 100,
        bm_weight_pct: wbOf[s]! * 100,
        port_return_pct: (x.rp - 1) * 100,
        bm_return_pct: (x.rb - 1) * 100,
        allocation_pct: x.alloc,
        selection_pct: x.sel,
        interaction_pct: x.inter,
        total_pct: x.alloc + x.sel + x.inter,
      };
    });
    const explained = rows.reduce((s, r) => s + r.total_pct, 0);
    brinson = { rows, residual_pct: rel.excess_return_pct - explained };
  }

  // ---------------- Trailing 1-week read ----------------
  let week: MpWeekly | null = null;
  if (wBase < lastIdx) {
    const chg = (lv: number[]) => (lv[lastIdx]! / lv[wBase]! - 1) * 100;
    const portW = chg(nav);
    const bmW = chg(bmLv);
    const spxW = chg(spxLv);
    const csiW = chg(csiLv);
    let rfGrow = 1;
    for (let t = wBase + 1; t <= lastIdx; t++) rfGrow *= 1 + rfDaily[t]!;
    const segBmRet: Record<MpCountry, number> = { US: spxW, CN: csiW, CASH: (rfGrow - 1) * 100 };
    const segBmW: Record<MpCountry, number> = { US: a, CN: 1 - a, CASH: 0 };
    const weekCountries = (["US", "CN", "CASH"] as MpCountry[]).map((c) => {
      const wp = weekSeg[c] || 0;
      const contribution = holdings.filter((h) => h.country === c).reduce((s, h) => s + h.week_contribution_pct, 0);
      const rp = wp > 1e-6 ? contribution / wp : null;
      return {
        key: c,
        label: c === "US" ? "미국" : c === "CN" ? "중국" : "현금",
        port_w_pct: wp * 100,
        bm_w_pct: segBmW[c] * 100,
        port_ret_pct: rp,
        bm_ret_pct: segBmRet[c],
        contribution_pct: contribution,
        allocation_pct: (wp - segBmW[c]) * (segBmRet[c] - bmW),
        selection_pct: rp == null ? 0 : wp * (rp - segBmRet[c]),
      };
    });
    const moverLabel = (h: MpHoldingRow) =>
      h.country === "CN" ? tickerMeta(h.ticker)?.name_ko || h.ticker : h.ticker;
    const movers = holdings
      .filter((h) => h.country !== "CASH" && Math.abs(h.week_contribution_pct) > 1e-6)
      .map((h) => ({ key: h.key, label: moverLabel(h), contribution_pct: h.week_contribution_pct, return_pct: h.week_return_pct }))
      .sort((p, q) => q.contribution_pct - p.contribution_pct);
    const secAgg = new Map<string, number>();
    for (const h of holdings) {
      if (h.country === "CASH") continue;
      secAgg.set(h.msector, (secAgg.get(h.msector) || 0) + h.week_contribution_pct);
    }
    const intraday: string[] = [];
    if (isIntradayBar(SPX, bySym.get(SPX)?.dates.at(-1))) intraday.push(`미국 ${bySym.get(SPX)!.dates.at(-1)}`);
    if (isIntradayBar(CSI, bySym.get(CSI)?.dates.at(-1))) intraday.push(`중국 ${bySym.get(CSI)!.dates.at(-1)}`);
    week = {
      from: cal[wBase]!,
      to: cal[lastIdx]!,
      port_pct: portW,
      bm_pct: bmW,
      excess_pct: portW - bmW,
      spx_pct: spxW,
      csi_pct: csiW,
      countries: weekCountries,
      top: movers.filter((m) => m.contribution_pct > 0).slice(0, 3),
      bottom: movers.filter((m) => m.contribution_pct < 0).slice(-3).reverse(),
      sectors: [...secAgg.entries()]
        .map(([key, v]) => ({ key, label: key === "etc" ? "기타" : mpSectorLabel(key), contribution_pct: v }))
        .sort((p, q) => Math.abs(q.contribution_pct) - Math.abs(p.contribution_pct)),
      intraday,
      comment: [],
    };
    week.comment = weeklyComment(week);
  }

  // ---------------- Holdings-based style ----------------
  const eq = holdings.filter((h) => h.country !== "CASH" && h.current_pct > 0);
  const eqW = eq.reduce((s, h) => s + h.current_pct, 0);
  const harmonic = (field: "pe" | "forward_pe" | "pb") => {
    let w = 0;
    let inv = 0;
    for (const h of eq) {
      const v = h[field];
      if (v && v > 0) {
        w += h.current_pct;
        inv += h.current_pct / v;
      }
    }
    return inv > 0 ? w / inv : null;
  };
  const covered = eq.filter((h) => h.pe || h.forward_pe || h.pb).reduce((s, h) => s + h.current_pct, 0);
  const dyRows = eq.filter((h) => h.div_yield_pct != null);
  const dyW = dyRows.reduce((s, h) => s + h.current_pct, 0);
  const mcRows = eq.filter((h) => h.market_cap_usd != null);
  const mcW = mcRows.reduce((s, h) => s + h.current_pct, 0);
  const sortedMc = [...mcRows].sort((p, q) => p.market_cap_usd! - q.market_cap_usd!);
  let median: number | null = null;
  {
    let cum = 0;
    for (const h of sortedMc) {
      cum += h.current_pct;
      if (cum >= mcW / 2) {
        median = h.market_cap_usd;
        break;
      }
    }
  }
  const sizeLabels: Record<string, string> = {
    mega: "초대형 (≥$200B)",
    large: "대형 ($10–200B)",
    mid: "중형 ($2–10B)",
    small: "소형 (<$2B)",
    etf: "ETF",
    cash: "현금",
  };
  const size = Object.keys(sizeLabels)
    .map((key) => ({
      key,
      label: sizeLabels[key]!,
      weight_pct: holdings.filter((h) => h.size_bucket === key).reduce((s, h) => s + h.current_pct, 0),
    }))
    .filter((r) => r.weight_pct > 0.005);
  const box: Record<string, number> = {};
  for (const h of eq) {
    const sz = h.size_bucket === "mega" ? "large" : h.size_bucket;
    const k = `${sz}:${h.style_bucket}`;
    box[k] = (box[k] || 0) + h.current_pct;
  }

  // ---------------- Returns-based style & factors ----------------
  const levels = {
    port: nav,
    bm: bmLv,
    rf: rfDaily.reduce<number[]>((acc, r, i) => {
      acc.push(i === 0 ? 1 : acc[i - 1]! * (1 + r));
      return acc;
    }, []),
  };
  const etfLv = new Map<string, number[]>();
  for (const s of FACTOR_ETFS) etfLv.set(s, usdPx(s));
  etfLv.set(CSI, csiUsd);
  etfLv.set(SPX, spx);

  const build = (idx: number[] | null) => {
    const sel = (lv: number[]) => toReturns(idx ? pick(lv, idx) : lv);
    const rfR = sel(levels.rf);
    const rp = sel(levels.port);
    const rbm = sel(levels.bm);
    const r = (s: string) => sel(etfLv.get(s)!);
    const spy = r("SPY");
    const diff = (x: number[], y: number[]) => x.map((v, i) => v - y[i]!);
    const factors: Record<MpFactorKey, number[]> = {
      mkt: diff(rbm, rfR),
      size: diff(r("IWM"), spy),
      value: diff(r("IVE"), r("IVW")),
      mom: diff(r("MTUM"), spy),
      qual: diff(r("QUAL"), spy),
      lowvol: diff(r("USMV"), spy),
      semi: diff(r("SOXX"), spy),
      china: diff(r(CSI), r(SPX)),
    };
    const styleX = MP_STYLE_INDICES.map((s) => (s.key === "cash" ? rfR : r(s.symbol)));
    return { rfR, rp, factors, styleX, sel };
  };

  const regress = (freq: "daily" | "weekly"): { reg: MpRegression | null; style: MpStyleRegression | null } => {
    const idx = freq === "weekly" ? weeklyIndex(cal) : null;
    const { rfR, rp, factors, styleX } = build(idx);
    const y = rp.map((v, i) => v - rfR[i]!);
    const X = MP_FACTORS.map((f) => factors[f.key]);
    return {
      reg: factorRegression(y, X, MP_FACTORS, freq, freq === "weekly" ? 52 : annF),
      style: styleFit(rp, styleX, MP_STYLE_INDICES, freq),
    };
  };

  const daily = regress("daily");
  const weekly = regress("weekly");
  if (!daily.reg) notes.push("팩터 분석: 관측치가 부족합니다 (일간 최소 17개 필요). 백테스트 모드를 이용해 보세요.");

  const rolling: MpAnalysis["style"]["rolling"] = (() => {
    const { rp, styleX } = build(null);
    return rollingStyle(cal, rp, styleX, MP_STYLE_INDICES);
  })();

  const holdingFactors: MpAnalysis["factors"]["holdings"] = [];
  {
    const { rfR, factors, sel } = build(null);
    const keys = MP_FACTORS.map((f) => f.key);
    for (const h of holdings) {
      if (h.country === "CASH") continue;
      const lv = px.get(h.key);
      if (!lv) continue;
      const y = sel(lv).map((v, i) => v - rfR[i]!);
      const fit = ols(y, keys.map((k) => factors[k]));
      if (!fit) continue;
      const betas: Record<string, number> = {};
      keys.forEach((k, j) => {
        betas[k] = fit.coef[j + 1]!;
      });
      holdingFactors.push({ key: h.key, ticker: h.ticker, r2: fit.r2, n: fit.n, betas });
    }
  }

  const last_dates: Record<string, string | null> = {
    "S&P500": bySym.get(SPX)?.dates.at(-1) || null,
    "CSI300(510300)": bySym.get(CSI)?.dates.at(-1) || null,
    "USD/CNY": bySym.get("CNY=X")?.dates.at(-1) || null,
  };

  return {
    ok: true,
    mode,
    as_of: lastD,
    start_date: cal[0]!,
    bm_label: bmLabel,
    ann_factor: annF,
    rf_ann_pct: rfAnn,
    notes: [...new Set(notes)],
    last_dates,
    weekly: week,
    series,
    period_returns,
    monthly,
    metrics: { port: portM, bm: bmM, rel },
    holdings,
    sectors,
    bm_sector_source: bmSource,
    pm_sectors,
    countries,
    fx_contribution_pct,
    brinson,
    style: {
      holdings: {
        coverage_pct: eqW > 0 ? (covered / eqW) * 100 : 0,
        pe: harmonic("pe"),
        forward_pe: harmonic("forward_pe"),
        pb: harmonic("pb"),
        div_yield_pct: dyW > 0 ? dyRows.reduce((s, h) => s + h.current_pct * h.div_yield_pct!, 0) / dyW : null,
        wavg_mcap_usd: mcW > 0 ? mcRows.reduce((s, h) => s + h.current_pct * h.market_cap_usd!, 0) / mcW : null,
        median_mcap_usd: median,
        bm_pe: bmPe,
        bm_pb: bmPb,
        size,
        box,
      },
      rbsa: { daily: daily.style, weekly: weekly.style },
      rolling,
    },
    factors: { daily: daily.reg, weekly: weekly.reg, holdings: holdingFactors },
  };
}

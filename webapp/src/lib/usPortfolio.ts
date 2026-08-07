/**
 * US equity portfolio simulation — open/close entry trades, vs SPY,
 * local persistence, Telegram-ready weekly snapshot shape.
 */

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const STORAGE_KEY_V1 = "savvyetf:us-portfolio:v1";
const STORAGE_KEY = "savvyetf:us-portfolio:v2";
const BENCHMARK = "SPY";

/**
 * Approximate S&P 500 GICS sector weights for active allocation compare.
 * Illustrative (not live reconstituted). Residual bucketed as 기타.
 */
export const SPY_SECTOR_WEIGHTS_PCT: Record<string, number> = {
  Technology: 32.5,
  Financials: 13.2,
  Healthcare: 11.8,
  "Consumer Cyclical": 10.5,
  Communication: 9.0,
  Industrials: 8.2,
  "Consumer Defensive": 5.8,
  Energy: 3.4,
  ETF: 0,
  "ETF/Index": 0,
  기타: 5.6,
};

const SECTOR_LABEL_KO: Record<string, string> = {
  Technology: "기술",
  Financials: "금융",
  Healthcare: "헬스케어",
  "Consumer Cyclical": "경기소비재",
  Communication: "통신·미디어",
  Industrials: "산업재",
  "Consumer Defensive": "필수소비재",
  Energy: "에너지",
  "ETF/Index": "ETF·지수",
  ETF: "ETF·지수",
  Cash: "현금",
  기타: "기타",
};

export function sectorLabelKo(sector: string): string {
  return SECTOR_LABEL_KO[sector] || sector;
}

/** Curated US listed universe for picker + sector attribution. */
export type UniverseName = {
  symbol: string;
  name: string;
};

export type UniverseSector = {
  sector: string;
  sector_ko: string;
  names: UniverseName[];
};

export const US_PORTFOLIO_UNIVERSE: UniverseSector[] = [
  {
    sector: "Technology",
    sector_ko: "기술",
    names: [
      { symbol: "AAPL", name: "Apple" },
      { symbol: "MSFT", name: "Microsoft" },
      { symbol: "NVDA", name: "NVIDIA" },
      { symbol: "AVGO", name: "Broadcom" },
      { symbol: "AMD", name: "AMD" },
      { symbol: "INTC", name: "Intel" },
      { symbol: "CRM", name: "Salesforce" },
      { symbol: "ORCL", name: "Oracle" },
      { symbol: "ADBE", name: "Adobe" },
      { symbol: "CSCO", name: "Cisco" },
      { symbol: "QCOM", name: "Qualcomm" },
      { symbol: "TXN", name: "Texas Instruments" },
      { symbol: "AMAT", name: "Applied Materials" },
      { symbol: "MU", name: "Micron" },
      { symbol: "SNPS", name: "Synopsys" },
      { symbol: "CDNS", name: "Cadence" },
      { symbol: "PLTR", name: "Palantir" },
      { symbol: "IBM", name: "IBM" },
    ],
  },
  {
    sector: "Communication",
    sector_ko: "통신·미디어",
    names: [
      { symbol: "GOOGL", name: "Alphabet A" },
      { symbol: "GOOG", name: "Alphabet C" },
      { symbol: "META", name: "Meta" },
      { symbol: "NFLX", name: "Netflix" },
      { symbol: "DIS", name: "Disney" },
      { symbol: "CMCSA", name: "Comcast" },
      { symbol: "T", name: "AT&T" },
      { symbol: "VZ", name: "Verizon" },
      { symbol: "TMUS", name: "T-Mobile" },
    ],
  },
  {
    sector: "Consumer Cyclical",
    sector_ko: "경기소비재",
    names: [
      { symbol: "AMZN", name: "Amazon" },
      { symbol: "TSLA", name: "Tesla" },
      { symbol: "HD", name: "Home Depot" },
      { symbol: "MCD", name: "McDonald's" },
      { symbol: "NKE", name: "Nike" },
      { symbol: "SBUX", name: "Starbucks" },
      { symbol: "LOW", name: "Lowe's" },
      { symbol: "BKNG", name: "Booking" },
      { symbol: "TJX", name: "TJX" },
    ],
  },
  {
    sector: "Consumer Defensive",
    sector_ko: "필수소비재",
    names: [
      { symbol: "WMT", name: "Walmart" },
      { symbol: "COST", name: "Costco" },
      { symbol: "PG", name: "P&G" },
      { symbol: "KO", name: "Coca-Cola" },
      { symbol: "PEP", name: "PepsiCo" },
      { symbol: "PM", name: "Philip Morris" },
      { symbol: "MO", name: "Altria" },
      { symbol: "CL", name: "Colgate" },
      { symbol: "MDLZ", name: "Mondelez" },
    ],
  },
  {
    sector: "Financials",
    sector_ko: "금융",
    names: [
      { symbol: "JPM", name: "JPMorgan" },
      { symbol: "BAC", name: "Bank of America" },
      { symbol: "WFC", name: "Wells Fargo" },
      { symbol: "GS", name: "Goldman Sachs" },
      { symbol: "MS", name: "Morgan Stanley" },
      { symbol: "BLK", name: "BlackRock" },
      { symbol: "SCHW", name: "Schwab" },
      { symbol: "C", name: "Citigroup" },
      { symbol: "AXP", name: "American Express" },
      { symbol: "V", name: "Visa" },
      { symbol: "MA", name: "Mastercard" },
      { symbol: "PYPL", name: "PayPal" },
    ],
  },
  {
    sector: "Healthcare",
    sector_ko: "헬스케어",
    names: [
      { symbol: "UNH", name: "UnitedHealth" },
      { symbol: "JNJ", name: "J&J" },
      { symbol: "LLY", name: "Eli Lilly" },
      { symbol: "ABBV", name: "AbbVie" },
      { symbol: "MRK", name: "Merck" },
      { symbol: "PFE", name: "Pfizer" },
      { symbol: "TMO", name: "Thermo Fisher" },
      { symbol: "ABT", name: "Abbott" },
      { symbol: "AMGN", name: "Amgen" },
      { symbol: "ISRG", name: "Intuitive Surgical" },
    ],
  },
  {
    sector: "Energy",
    sector_ko: "에너지",
    names: [
      { symbol: "XOM", name: "Exxon" },
      { symbol: "CVX", name: "Chevron" },
      { symbol: "COP", name: "ConocoPhillips" },
      { symbol: "SLB", name: "Schlumberger" },
      { symbol: "EOG", name: "EOG" },
      { symbol: "MPC", name: "Marathon" },
      { symbol: "PSX", name: "Phillips 66" },
    ],
  },
  {
    sector: "Industrials",
    sector_ko: "산업재",
    names: [
      { symbol: "CAT", name: "Caterpillar" },
      { symbol: "GE", name: "GE" },
      { symbol: "HON", name: "Honeywell" },
      { symbol: "UPS", name: "UPS" },
      { symbol: "RTX", name: "RTX" },
      { symbol: "BA", name: "Boeing" },
      { symbol: "DE", name: "Deere" },
      { symbol: "LMT", name: "Lockheed" },
      { symbol: "UNP", name: "Union Pacific" },
    ],
  },
  {
    sector: "ETF/Index",
    sector_ko: "ETF·지수",
    names: [
      { symbol: "SPY", name: "S&P 500 ETF" },
      { symbol: "QQQ", name: "Nasdaq-100 ETF" },
      { symbol: "IWM", name: "Russell 2000 ETF" },
      { symbol: "DIA", name: "Dow ETF" },
      { symbol: "VTI", name: "Total Market" },
      { symbol: "VOO", name: "Vanguard S&P500" },
      { symbol: "IVV", name: "iShares S&P500" },
      { symbol: "ARKK", name: "ARK Innovation" },
    ],
  },
];

const SECTOR_HINTS: Array<{ sector: string; tokens: string[] }> = US_PORTFOLIO_UNIVERSE.map(
  (u) => ({ sector: u.sector, tokens: u.names.map((n) => n.symbol) }),
);

export type PriceMode = "open" | "close";
export type TradeSide = "buy" | "sell";
/** How the trade size is specified */
export type SizeMode = "notional" | "weight_pct" | "shares" | "all";

export type PortfolioTrade = {
  id: string;
  symbol: string;
  side: TradeSide;
  date: string; // YYYY-MM-DD
  /** Exact share count */
  shares?: number | null;
  /** USD notional at trade price */
  notional_usd?: number | null;
  /** % of mark-to-market portfolio equity at trade time */
  weight_pct?: number | null;
  price_mode: PriceMode;
  note?: string;
};

export type OhlcPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type AttributionRow = {
  key: string;
  label: string;
  weight_pct: number | null;
  return_pct: number | null;
  contribution_pct: number;
};

export type PortfolioTelegramSnapshot = {
  kind: "us_portfolio_weekly";
  portfolio_id: string;
  name: string;
  as_of: string;
  generated_at: string;
  /** Ready for future bot broadcast */
  telegram_ready: true;
  week_return_pct: number | null;
  cumulative_return_pct: number;
  excess_vs_spy_pct: number;
  spy_cumulative_return_pct: number;
  max_drawdown_pct: number;
  sector_attribution: AttributionRow[];
  stock_attribution: AttributionRow[];
  series_tail: Array<{ date: string; portfolio: number; spy: number }>;
};

export type SectorWeightCompareRow = {
  sector: string;
  label: string;
  portfolio_pct: number;
  spy_pct: number;
  active_pct: number;
};

export type RiskCompareMetrics = {
  volatility_pct: number | null;
  spy_volatility_pct: number | null;
  max_drawdown_pct: number;
  spy_max_drawdown_pct: number;
  sharpe: number | null;
  spy_sharpe: number | null;
  beta: number | null;
  alpha_ann_pct: number | null;
  tracking_error_pct: number | null;
  information_ratio: number | null;
  calmar: number | null;
  spy_calmar: number | null;
};

export type UsPortfolioResult = {
  ok: boolean;
  error?: string;
  portfolio_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  initial_cash: number;
  final_value: number;
  cash: number;
  cumulative_return_pct: number;
  spy_cumulative_return_pct: number;
  excess_vs_spy_pct: number;
  week_return_pct: number | null;
  max_drawdown_pct: number;
  spy_max_drawdown_pct: number;
  risk: RiskCompareMetrics;
  sector_weights: SectorWeightCompareRow[];
  holdings: Array<{
    symbol: string;
    shares: number;
    last: number | null;
    market_value: number;
    sector: string;
  }>;
  stock_attribution: AttributionRow[];
  sector_attribution: AttributionRow[];
  series: Array<{ date: string; portfolio: number; spy: number; cash: number }>;
  telegram_snapshot: PortfolioTelegramSnapshot;
};

export type StoredUsPortfolio = {
  portfolio_id: string;
  name: string;
  initial_cash: number;
  trades: PortfolioTrade[];
  /** Append-only run history for cumulative tracking without login */
  history: Array<{
    as_of: string;
    cumulative_return_pct: number;
    excess_vs_spy_pct: number;
    week_return_pct: number | null;
    final_value: number;
    max_drawdown_pct?: number;
    volatility_pct?: number | null;
    telegram_snapshot: PortfolioTelegramSnapshot;
  }>;
  updated_at: string;
};

/** Multi-portfolio library persisted in localStorage (v2). */
export type UsPortfolioLibrary = {
  active_id: string;
  portfolios: StoredUsPortfolio[];
};

function toYahooSymbol(ticker: string): string {
  const raw = ticker.trim();
  if (raw.startsWith("^")) return `^${raw.slice(1).toUpperCase()}`;
  return raw.toUpperCase().replace(/\./g, "-");
}

function rangeForDays(days: number): string {
  if (days <= 30) return "1mo";
  if (days <= 100) return "3mo";
  if (days <= 200) return "6mo";
  if (days <= 400) return "1y";
  if (days <= 800) return "2y";
  if (days <= 2000) return "5y";
  return "max";
}

export function sectorForSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  for (const { sector, tokens } of SECTOR_HINTS) {
    if (tokens.includes(s)) return sector;
  }
  return "기타";
}

export function newTradeId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function newPortfolioId(): string {
  return `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function fetchDailyOhlc(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<OhlcPoint[]> {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T23:59:59Z`).getTime();
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  const yahooSym = toYahooSymbol(symbol);
  const url = `${YAHOO_CHART}/${encodeURIComponent(yahooSym)}?range=${rangeForDays(days)}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 1800 },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0] || {};
  const opens = q.open || [];
  const highs = q.high || [];
  const lows = q.low || [];
  const closes = q.close || [];
  const out: OhlcPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = opens[i];
    const close = closes[i];
    if (open == null || close == null || !Number.isFinite(open) || !Number.isFinite(close)) {
      continue;
    }
    const ms = timestamps[i]! * 1000;
    if (ms < start || ms > end) continue;
    const date = new Date(ms).toISOString().slice(0, 10);
    out.push({
      date,
      open,
      high: highs[i] ?? Math.max(open, close),
      low: lows[i] ?? Math.min(open, close),
      close,
    });
  }
  const map = new Map<string, OhlcPoint>();
  for (const p of out) map.set(p.date, p);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function pickPrice(bar: OhlcPoint, mode: PriceMode): number {
  return mode === "open" ? bar.open : bar.close;
}

function maxDrawdown(values: number[]): number {
  let peak = values[0] || 0;
  let mdd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) mdd = Math.min(mdd, v / peak - 1);
  }
  return mdd * 100;
}

function dailyReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    if (prev > 0 && Number.isFinite(cur)) out.push(cur / prev - 1);
  }
  return out;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdSample(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function covSample(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i]! - mx) * (ys[i]! - my);
  return s / (n - 1);
}

export function computeRiskCompare(
  series: Array<{ portfolio: number; spy: number }>,
  cumulative_return_pct: number,
  spy_cumulative_return_pct: number,
): RiskCompareMetrics {
  const portVals = series.map((s) => s.portfolio);
  const spyVals = series.map((s) => s.spy);
  const max_drawdown_pct = maxDrawdown(portVals);
  const spy_max_drawdown_pct = maxDrawdown(spyVals);
  const rp = dailyReturns(portVals);
  const rb = dailyReturns(spyVals);
  const n = Math.min(rp.length, rb.length);
  const rps = rp.slice(0, n);
  const rbs = rb.slice(0, n);
  const sp = stdSample(rps);
  const sb = stdSample(rbs);
  const volatility_pct = sp != null ? sp * Math.sqrt(252) * 100 : null;
  const spy_volatility_pct = sb != null ? sb * Math.sqrt(252) * 100 : null;
  const sharpe =
    sp != null && sp > 0 ? (mean(rps) * 252) / (sp * Math.sqrt(252)) : null;
  const spy_sharpe =
    sb != null && sb > 0 ? (mean(rbs) * 252) / (sb * Math.sqrt(252)) : null;
  const c = covSample(rps, rbs);
  const varB = sb != null ? sb * sb : null;
  const beta = c != null && varB != null && varB > 0 ? c / varB : null;
  const alpha_ann_pct =
    beta != null ? (mean(rps) - beta * mean(rbs)) * 252 * 100 : null;
  const excess = rps.map((r, i) => r - (rbs[i] || 0));
  const te = stdSample(excess);
  const tracking_error_pct = te != null ? te * Math.sqrt(252) * 100 : null;
  const information_ratio =
    te != null && te > 0 ? (mean(excess) * 252) / (te * Math.sqrt(252)) : null;
  const calmar =
    max_drawdown_pct < 0
      ? cumulative_return_pct / Math.abs(max_drawdown_pct)
      : null;
  const spy_calmar =
    spy_max_drawdown_pct < 0
      ? spy_cumulative_return_pct / Math.abs(spy_max_drawdown_pct)
      : null;
  return {
    volatility_pct,
    spy_volatility_pct,
    max_drawdown_pct,
    spy_max_drawdown_pct,
    sharpe,
    spy_sharpe,
    beta,
    alpha_ann_pct,
    tracking_error_pct,
    information_ratio,
    calmar,
    spy_calmar,
  };
}

export function buildSectorWeightCompare(
  holdings: Array<{ sector: string; market_value: number }>,
  cash: number,
  final_value: number,
): SectorWeightCompareRow[] {
  const total = final_value > 0 ? final_value : 1;
  const bySector = new Map<string, number>();
  for (const h of holdings) {
    bySector.set(h.sector, (bySector.get(h.sector) || 0) + h.market_value);
  }
  if (cash > 1e-6) bySector.set("Cash", (bySector.get("Cash") || 0) + cash);

  const sectors = new Set<string>([
    ...Object.keys(SPY_SECTOR_WEIGHTS_PCT),
    ...bySector.keys(),
  ]);
  const rows: SectorWeightCompareRow[] = [];
  for (const sector of sectors) {
    if (sector === "ETF") continue; // folded into ETF/Index
    const portfolio_pct = ((bySector.get(sector) || 0) / total) * 100;
    const spy_pct = sector === "Cash" ? 0 : SPY_SECTOR_WEIGHTS_PCT[sector] ?? 0;
    if (portfolio_pct < 0.05 && spy_pct < 0.05) continue;
    rows.push({
      sector,
      label: sectorLabelKo(sector),
      portfolio_pct,
      spy_pct,
      active_pct: portfolio_pct - spy_pct,
    });
  }
  rows.sort((a, b) => Math.abs(b.active_pct) - Math.abs(a.active_pct));
  return rows;
}

function emptyRisk(): RiskCompareMetrics {
  return {
    volatility_pct: null,
    spy_volatility_pct: null,
    max_drawdown_pct: 0,
    spy_max_drawdown_pct: 0,
    sharpe: null,
    spy_sharpe: null,
    beta: null,
    alpha_ann_pct: null,
    tracking_error_pct: null,
    information_ratio: null,
    calmar: null,
    spy_calmar: null,
  };
}

function weekReturn(series: Array<{ date: string; portfolio: number }>): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1]!;
  const end = new Date(`${last.date}T00:00:00Z`);
  const weekAgo = new Date(end.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  let base = series[0]!;
  for (const pt of series) {
    if (pt.date <= weekAgo) base = pt;
  }
  if (!base.portfolio) return null;
  return ((last.portfolio / base.portfolio) - 1) * 100;
}

export async function simulateUsPortfolio(input: {
  portfolio_id: string;
  name: string;
  initial_cash: number;
  trades: PortfolioTrade[];
}): Promise<UsPortfolioResult> {
  const { portfolio_id, name, initial_cash, trades } = input;
  if (!trades.length) {
    return emptyResult(portfolio_id, name, initial_cash, "편출입 내역이 없습니다.");
  }
  if (!(initial_cash > 0)) {
    return emptyResult(portfolio_id, name, initial_cash, "초기 현금을 입력하세요.");
  }

  const symbols = [...new Set(trades.map((t) => t.symbol.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length > 25) {
    return emptyResult(portfolio_id, name, initial_cash, "종목은 최대 25개까지입니다.");
  }

  const dates = trades.map((t) => t.date).filter(Boolean).sort();
  const startDate = dates[0]!;
  const endDate = new Date().toISOString().slice(0, 10);
  const fetchStart = new Date(new Date(`${startDate}T00:00:00Z`).getTime() - 5 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const ohlcMap = new Map<string, Map<string, OhlcPoint>>();
  try {
    const entries = await Promise.all(
      [...symbols, BENCHMARK].map(async (sym) => {
        const bars = await fetchDailyOhlc(sym, fetchStart, endDate);
        return [sym, new Map(bars.map((b) => [b.date, b]))] as const;
      }),
    );
    for (const [sym, map] of entries) ohlcMap.set(sym, map);
  } catch (exc) {
    return emptyResult(
      portfolio_id,
      name,
      initial_cash,
      exc instanceof Error ? exc.message : String(exc),
    );
  }

  const calendar = [...(ohlcMap.get(BENCHMARK)?.keys() || [])]
    .filter((d) => d >= startDate && d <= endDate)
    .sort();
  if (!calendar.length) {
    return emptyResult(portfolio_id, name, initial_cash, "거래일 캘린더를 만들지 못했습니다.");
  }

  const sortedTrades = [...trades].sort((a, b) =>
    a.date === b.date
      ? a.side === "sell"
        ? -1
        : 1
      : a.date.localeCompare(b.date),
  );

  let cash = initial_cash;
  const positions = new Map<string, number>(); // shares
  const costBasis = new Map<string, number>(); // total cost for contrib approx
  const series: UsPortfolioResult["series"] = [];
  let spyShares = 0;
  let spySeeded = false;

  const tradeIdxByDate = new Map<string, PortfolioTrade[]>();
  for (const t of sortedTrades) {
    const list = tradeIdxByDate.get(t.date) || [];
    list.push(t);
    tradeIdxByDate.set(t.date, list);
  }

  const equityAt = (day: string, mode: PriceMode): number => {
    let equity = cash;
    for (const [s, sh] of positions) {
      const b = ohlcMap.get(s)?.get(day);
      if (!b) continue;
      const p = pickPrice(b, mode);
      if (p > 0) equity += sh * p;
    }
    return equity;
  };

  for (const day of calendar) {
    const dayTrades = tradeIdxByDate.get(day) || [];
    for (const trade of dayTrades) {
      const sym = trade.symbol.trim().toUpperCase();
      const bar = ohlcMap.get(sym)?.get(day);
      if (!bar) continue;
      const px = pickPrice(bar, trade.price_mode);
      if (!(px > 0)) continue;

      if (trade.side === "buy") {
        let shares = 0;
        if (trade.shares && trade.shares > 0) {
          shares = trade.shares;
        } else if (trade.notional_usd && trade.notional_usd > 0) {
          shares = trade.notional_usd / px;
        } else if (trade.weight_pct && trade.weight_pct > 0) {
          const equity = equityAt(day, trade.price_mode);
          shares = (equity * (trade.weight_pct / 100)) / px;
        }
        if (!(shares > 0)) continue;
        const cost = shares * px;
        if (cost > cash + 1e-6) {
          shares = cash / px;
        }
        if (!(shares > 0)) continue;
        cash -= shares * px;
        positions.set(sym, (positions.get(sym) || 0) + shares);
        costBasis.set(sym, (costBasis.get(sym) || 0) + shares * px);
      } else {
        const held = positions.get(sym) || 0;
        if (!(held > 0)) continue;
        let shares = 0;
        if (trade.shares && trade.shares > 0) {
          shares = trade.shares;
        } else if (trade.notional_usd && trade.notional_usd > 0) {
          shares = trade.notional_usd / px;
        } else if (trade.weight_pct && trade.weight_pct > 0) {
          const equity = equityAt(day, trade.price_mode);
          shares = (equity * (trade.weight_pct / 100)) / px;
        } else {
          // no size → sell all
          shares = held;
        }
        shares = Math.min(shares, held);
        if (!(shares > 0)) continue;
        cash += shares * px;
        const left = held - shares;
        if (left <= 1e-8) {
          positions.delete(sym);
          costBasis.delete(sym);
        } else {
          positions.set(sym, left);
          costBasis.set(sym, (costBasis.get(sym) || 0) * (left / held));
        }
      }
    }

    // Seed SPY buy&hold with same initial cash on first calendar day
    if (!spySeeded) {
      const spyBar = ohlcMap.get(BENCHMARK)?.get(day);
      if (spyBar?.close) {
        spyShares = initial_cash / spyBar.close;
        spySeeded = true;
      }
    }

    let equity = cash;
    for (const [sym, shares] of positions) {
      const bar = ohlcMap.get(sym)?.get(day);
      if (bar) equity += shares * bar.close;
    }
    const spyBar = ohlcMap.get(BENCHMARK)?.get(day);
    const spyValue = spyBar && spyShares ? spyShares * spyBar.close : initial_cash;
    series.push({ date: day, portfolio: equity, spy: spyValue, cash });
  }

  if (!series.length) {
    return emptyResult(portfolio_id, name, initial_cash, "시뮬레이션 시계열을 만들지 못했습니다.");
  }

  const last = series[series.length - 1]!;
  const final_value = last.portfolio;
  const cumulative_return_pct = ((final_value / initial_cash) - 1) * 100;
  const spy_cumulative_return_pct = ((last.spy / initial_cash) - 1) * 100;
  const excess_vs_spy_pct = cumulative_return_pct - spy_cumulative_return_pct;
  const week_return_pct = weekReturn(series);
  const risk = computeRiskCompare(series, cumulative_return_pct, spy_cumulative_return_pct);
  const max_drawdown_pct = risk.max_drawdown_pct;
  const spy_max_drawdown_pct = risk.spy_max_drawdown_pct;

  const holdings: UsPortfolioResult["holdings"] = [];
  for (const [sym, shares] of positions) {
    if (shares <= 1e-8) continue;
    const bar = ohlcMap.get(sym)?.get(last.date);
    const lastPx = bar?.close ?? null;
    holdings.push({
      symbol: sym,
      shares,
      last: lastPx,
      market_value: lastPx != null ? shares * lastPx : 0,
      sector: sectorForSymbol(sym),
    });
  }
  holdings.sort((a, b) => b.market_value - a.market_value);

  const sector_weights = buildSectorWeightCompare(holdings, cash, final_value);

  const stock_attribution: AttributionRow[] = holdings.map((h) => {
    const basis = costBasis.get(h.symbol) || h.market_value;
    const ret = basis > 0 ? ((h.market_value / basis) - 1) * 100 : null;
    const contribution_pct =
      initial_cash > 0 ? ((h.market_value - (costBasis.get(h.symbol) || 0)) / initial_cash) * 100 : 0;
    return {
      key: h.symbol,
      label: h.symbol,
      weight_pct: final_value > 0 ? (h.market_value / final_value) * 100 : null,
      return_pct: ret,
      contribution_pct,
    };
  });
  stock_attribution.sort((a, b) => b.contribution_pct - a.contribution_pct);

  const sectorMap = new Map<string, { mv: number; basis: number }>();
  for (const h of holdings) {
    const cur = sectorMap.get(h.sector) || { mv: 0, basis: 0 };
    cur.mv += h.market_value;
    cur.basis += costBasis.get(h.symbol) || 0;
    sectorMap.set(h.sector, cur);
  }
  const sector_attribution: AttributionRow[] = [...sectorMap.entries()]
    .map(([sector, v]) => ({
      key: sector,
      label: sectorLabelKo(sector),
      weight_pct: final_value > 0 ? (v.mv / final_value) * 100 : null,
      return_pct: v.basis > 0 ? ((v.mv / v.basis) - 1) * 100 : null,
      contribution_pct: initial_cash > 0 ? ((v.mv - v.basis) / initial_cash) * 100 : 0,
    }))
    .sort((a, b) => b.contribution_pct - a.contribution_pct);

  const telegram_snapshot: PortfolioTelegramSnapshot = {
    kind: "us_portfolio_weekly",
    portfolio_id,
    name,
    as_of: last.date,
    generated_at: new Date().toISOString(),
    telegram_ready: true,
    week_return_pct,
    cumulative_return_pct,
    excess_vs_spy_pct,
    spy_cumulative_return_pct,
    max_drawdown_pct,
    sector_attribution,
    stock_attribution: stock_attribution.slice(0, 15),
    series_tail: series.slice(-30).map((s) => ({
      date: s.date,
      portfolio: s.portfolio,
      spy: s.spy,
    })),
  };

  return {
    ok: true,
    portfolio_id,
    name,
    start_date: series[0]!.date,
    end_date: last.date,
    initial_cash,
    final_value,
    cash,
    cumulative_return_pct,
    spy_cumulative_return_pct,
    excess_vs_spy_pct,
    week_return_pct,
    max_drawdown_pct,
    spy_max_drawdown_pct,
    risk,
    sector_weights,
    holdings,
    stock_attribution,
    sector_attribution,
    series,
    telegram_snapshot,
  };
}

function emptyResult(
  portfolio_id: string,
  name: string,
  initial_cash: number,
  error: string,
): UsPortfolioResult {
  const snap: PortfolioTelegramSnapshot = {
    kind: "us_portfolio_weekly",
    portfolio_id,
    name,
    as_of: new Date().toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
    telegram_ready: true,
    week_return_pct: null,
    cumulative_return_pct: 0,
    excess_vs_spy_pct: 0,
    spy_cumulative_return_pct: 0,
    max_drawdown_pct: 0,
    sector_attribution: [],
    stock_attribution: [],
    series_tail: [],
  };
  return {
    ok: false,
    error,
    portfolio_id,
    name,
    start_date: null,
    end_date: null,
    initial_cash,
    final_value: initial_cash,
    cash: initial_cash,
    cumulative_return_pct: 0,
    spy_cumulative_return_pct: 0,
    excess_vs_spy_pct: 0,
    week_return_pct: null,
    max_drawdown_pct: 0,
    spy_max_drawdown_pct: 0,
    risk: emptyRisk(),
    sector_weights: [],
    holdings: [],
    stock_attribution: [],
    sector_attribution: [],
    series: [],
    telegram_snapshot: snap,
  };
}

/** Browser-only persistence helpers */
export function defaultStoredPortfolio(name = "포트폴리오 1"): StoredUsPortfolio {
  return {
    portfolio_id: newPortfolioId(),
    name,
    initial_cash: 100_000,
    trades: [],
    history: [],
    updated_at: new Date().toISOString(),
  };
}

export function defaultPortfolioLibrary(): UsPortfolioLibrary {
  const first = defaultStoredPortfolio("포트폴리오 1");
  return { active_id: first.portfolio_id, portfolios: [first] };
}

function migrateV1ToLibrary(raw: unknown): UsPortfolioLibrary | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // already v2
  if (Array.isArray(obj.portfolios) && typeof obj.active_id === "string") {
    const portfolios = obj.portfolios as StoredUsPortfolio[];
    if (!portfolios.length) return defaultPortfolioLibrary();
    const active =
      portfolios.find((p) => p.portfolio_id === obj.active_id)?.portfolio_id ||
      portfolios[0]!.portfolio_id;
    return { active_id: active, portfolios };
  }
  // legacy single portfolio
  if (typeof obj.portfolio_id === "string" && Array.isArray(obj.trades)) {
    const p = obj as unknown as StoredUsPortfolio;
    return { active_id: p.portfolio_id, portfolios: [p] };
  }
  return null;
}

export function loadPortfolioLibrary(): UsPortfolioLibrary {
  if (typeof window === "undefined") return defaultPortfolioLibrary();
  try {
    const v2 = window.localStorage.getItem(STORAGE_KEY);
    if (v2) {
      const parsed = migrateV1ToLibrary(JSON.parse(v2));
      if (parsed) return parsed;
    }
    const v1 = window.localStorage.getItem(STORAGE_KEY_V1);
    if (v1) {
      const parsed = migrateV1ToLibrary(JSON.parse(v1));
      if (parsed) {
        savePortfolioLibrary(parsed);
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return defaultPortfolioLibrary();
}

export function savePortfolioLibrary(lib: UsPortfolioLibrary): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
}

/** @deprecated use loadPortfolioLibrary */
export function loadStoredPortfolio(): StoredUsPortfolio | null {
  const lib = loadPortfolioLibrary();
  return lib.portfolios.find((p) => p.portfolio_id === lib.active_id) || lib.portfolios[0] || null;
}

/** @deprecated use savePortfolioLibrary */
export function saveStoredPortfolio(store: StoredUsPortfolio): void {
  const lib = loadPortfolioLibrary();
  const idx = lib.portfolios.findIndex((p) => p.portfolio_id === store.portfolio_id);
  const portfolios =
    idx >= 0
      ? lib.portfolios.map((p, i) => (i === idx ? store : p))
      : [...lib.portfolios, store];
  savePortfolioLibrary({ active_id: store.portfolio_id, portfolios });
}

export function getActivePortfolio(lib: UsPortfolioLibrary): StoredUsPortfolio {
  return (
    lib.portfolios.find((p) => p.portfolio_id === lib.active_id) ||
    lib.portfolios[0] ||
    defaultStoredPortfolio()
  );
}

export function upsertActivePortfolio(
  lib: UsPortfolioLibrary,
  store: StoredUsPortfolio,
): UsPortfolioLibrary {
  const exists = lib.portfolios.some((p) => p.portfolio_id === store.portfolio_id);
  const portfolios = exists
    ? lib.portfolios.map((p) => (p.portfolio_id === store.portfolio_id ? store : p))
    : [...lib.portfolios, store];
  return { active_id: store.portfolio_id, portfolios };
}

export function createPortfolioInLibrary(
  lib: UsPortfolioLibrary,
  name?: string,
): UsPortfolioLibrary {
  const n = lib.portfolios.length + 1;
  const created = defaultStoredPortfolio(name || `포트폴리오 ${n}`);
  return {
    active_id: created.portfolio_id,
    portfolios: [...lib.portfolios, created],
  };
}

export function duplicatePortfolioInLibrary(
  lib: UsPortfolioLibrary,
  sourceId: string,
): UsPortfolioLibrary {
  const src = lib.portfolios.find((p) => p.portfolio_id === sourceId);
  if (!src) return lib;
  const copy: StoredUsPortfolio = {
    ...structuredClone(src),
    portfolio_id: newPortfolioId(),
    name: `${src.name} 복사`,
    history: [],
    updated_at: new Date().toISOString(),
  };
  return {
    active_id: copy.portfolio_id,
    portfolios: [...lib.portfolios, copy],
  };
}

export function deletePortfolioInLibrary(
  lib: UsPortfolioLibrary,
  id: string,
): UsPortfolioLibrary {
  if (lib.portfolios.length <= 1) return lib;
  const portfolios = lib.portfolios.filter((p) => p.portfolio_id !== id);
  const active_id =
    lib.active_id === id ? portfolios[0]!.portfolio_id : lib.active_id;
  return { active_id, portfolios };
}

export function appendHistory(
  store: StoredUsPortfolio,
  result: UsPortfolioResult,
): StoredUsPortfolio {
  if (!result.ok) return store;
  const entry = {
    as_of: result.end_date || result.telegram_snapshot.as_of,
    cumulative_return_pct: result.cumulative_return_pct,
    excess_vs_spy_pct: result.excess_vs_spy_pct,
    week_return_pct: result.week_return_pct,
    final_value: result.final_value,
    max_drawdown_pct: result.max_drawdown_pct,
    volatility_pct: result.risk.volatility_pct,
    telegram_snapshot: result.telegram_snapshot,
  };
  const history = [...store.history.filter((h) => h.as_of !== entry.as_of), entry]
    .sort((a, b) => a.as_of.localeCompare(b.as_of))
    .slice(-120);
  return {
    ...store,
    history,
    updated_at: new Date().toISOString(),
  };
}

/** Indexed series (base 100) + tight Y domain for comparison charts. */
export function buildIndexedChartSeries(
  series: Array<{ date: string; portfolio: number; spy: number }>,
): {
  data: Array<{ t: string; 포트폴리오: number; SPY: number }>;
  domain: [number, number];
} {
  if (!series.length) return { data: [], domain: [95, 105] };
  const p0 = series[0]!.portfolio || 1;
  const s0 = series[0]!.spy || 1;
  const data = series.map((p) => ({
    t: p.date.slice(5),
    포트폴리오: Math.round((p.portfolio / p0) * 10000) / 100,
    SPY: Math.round((p.spy / s0) * 10000) / 100,
  }));
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    min = Math.min(min, d.포트폴리오, d.SPY);
    max = Math.max(max, d.포트폴리오, d.SPY);
  }
  if (!(max > min)) {
    return { data, domain: [min - 1, max + 1] };
  }
  const pad = Math.max((max - min) * 0.06, 0.4);
  return { data, domain: [min - pad, max + pad] };
}

/** Format telegram-ready text for future bot broadcast */
export function formatTelegramPortfolioBrief(snap: PortfolioTelegramSnapshot): string {
  const lines = [
    `📊 ${snap.name}`,
    `기준 ${snap.as_of}`,
    `주간 ${fmtSignedPct(snap.week_return_pct)} · 누적 ${fmtSignedPct(snap.cumulative_return_pct)}`,
    `S&P500(SPY) 대비 ${fmtSignedPct(snap.excess_vs_spy_pct)}`,
    `MDD ${snap.max_drawdown_pct.toFixed(1)}%`,
    "",
    "업종 기여 Top",
    ...snap.sector_attribution.slice(0, 5).map(
      (r) => `· ${r.label} ${fmtSignedPct(r.contribution_pct)}`,
    ),
    "",
    "종목 기여 Top",
    ...snap.stock_attribution.slice(0, 5).map(
      (r) => `· ${r.label} ${fmtSignedPct(r.contribution_pct)}`,
    ),
  ];
  return lines.join("\n");
}

function fmtSignedPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

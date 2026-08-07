/**
 * US equity portfolio simulation — open/close entry trades, vs SPY,
 * local persistence, Telegram-ready weekly snapshot shape.
 */

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const STORAGE_KEY = "savvyetf:us-portfolio:v1";
const BENCHMARK = "SPY";

/** Lightweight sector tags for attribution (extend as needed). */
const SECTOR_HINTS: Array<{ sector: string; tokens: string[] }> = [
  { sector: "Technology", tokens: ["AAPL", "MSFT", "NVDA", "AVGO", "AMD", "INTC", "CRM", "ORCL", "ADBE", "CSCO", "QCOM", "TXN", "AMAT", "MU", "SNPS", "CDNS"] },
  { sector: "Communication", tokens: ["GOOGL", "GOOG", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS"] },
  { sector: "Consumer Cyclical", tokens: ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "BKNG", "TJX"] },
  { sector: "Consumer Defensive", tokens: ["WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "CL", "MDLZ"] },
  { sector: "Financials", tokens: ["JPM", "BAC", "WFC", "GS", "MS", "BLK", "SCHW", "C", "AXP", "V", "MA", "PYPL"] },
  { sector: "Healthcare", tokens: ["UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT", "AMGN", "ISRG"] },
  { sector: "Energy", tokens: ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX"] },
  { sector: "Industrials", tokens: ["CAT", "GE", "HON", "UPS", "RTX", "BA", "DE", "LMT", "UNP"] },
  { sector: "ETF/Index", tokens: ["SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "IVV", "ARKK"] },
];

export type PriceMode = "open" | "close";
export type TradeSide = "buy" | "sell";

export type PortfolioTrade = {
  id: string;
  symbol: string;
  side: TradeSide;
  date: string; // YYYY-MM-DD
  /** shares if set; else notional USD */
  shares?: number | null;
  notional_usd?: number | null;
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
    telegram_snapshot: PortfolioTelegramSnapshot;
  }>;
  updated_at: string;
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

  for (const day of calendar) {
    const dayTrades = tradeIdxByDate.get(day) || [];
    for (const trade of dayTrades) {
      const sym = trade.symbol.trim().toUpperCase();
      const bar = ohlcMap.get(sym)?.get(day);
      if (!bar) continue;
      const px = pickPrice(bar, trade.price_mode);
      if (!(px > 0)) continue;

      if (trade.side === "buy") {
        let shares = trade.shares && trade.shares > 0 ? trade.shares : 0;
        if (!shares && trade.notional_usd && trade.notional_usd > 0) {
          shares = trade.notional_usd / px;
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
        let shares = trade.shares && trade.shares > 0 ? trade.shares : held;
        shares = Math.min(shares, held);
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
  const max_drawdown_pct = maxDrawdown(series.map((s) => s.portfolio));

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
      label: sector,
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
    holdings: [],
    stock_attribution: [],
    sector_attribution: [],
    series: [],
    telegram_snapshot: snap,
  };
}

/** Browser-only persistence helpers */
export function loadStoredPortfolio(): StoredUsPortfolio | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUsPortfolio;
  } catch {
    return null;
  }
}

export function saveStoredPortfolio(store: StoredUsPortfolio): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function defaultStoredPortfolio(): StoredUsPortfolio {
  return {
    portfolio_id: newPortfolioId(),
    name: "내 미국 주식 포트폴리오",
    initial_cash: 100_000,
    trades: [],
    history: [],
    updated_at: new Date().toISOString(),
  };
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

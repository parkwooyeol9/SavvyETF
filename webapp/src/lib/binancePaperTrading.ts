/**
 * 바이낸스엔진 — Binance USDT-M perpetual paper trading (no real orders).
 *
 * 천만원 챌린지: 바이낸스 배분 ~$3,500 USDT (₩500만 환전 가정).
 * Strategies: BTC/ETH perp + TradeFi (XAU, XAG, EWY, MU) perpetuals.
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import {
  buildAssetSignal,
  type SignalAction,
  type SignalPoint,
} from "@/lib/tradingSignals";
import { SIGNAL_DEBOUNCE_TICKS } from "@/lib/cryptoPaperTrading";

export const BINANCE_PAPER_R2_KEY = "binance_paper/state_v1.json";
export const BINANCE_SIGNALS_R2_KEY = "binance_paper/signals_latest.json";
export const CHALLENGE_BINANCE_ALLOC_USDT = 3500;
export const BINANCE_PAPER_FEE_RATE = 0.0004; // ~0.04% perp taker
export const BINANCE_PAPER_NOTE =
  "바이낸스엔진 · USDT-M 페이퍼 · 실제 주문 없음 · 교육용(투자 권유 아님)";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export type BinanceStrategyId =
  | "major_btc"
  | "major_eth"
  | "tradefi_gold"
  | "tradefi_silver"
  | "tradefi_ewy"
  | "tradefi_mu";

type MarketKind = "crypto" | "tradefi";

export type BinancePaperPosition = {
  symbol: string;
  strategy: BinanceStrategyId;
  quantity: number;
  avg_price: number;
  opened_at: string;
  peak_price: number | null;
};

export type BinancePaperTrade = {
  id: string;
  ts: string;
  symbol: string;
  strategy: BinanceStrategyId;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  usdt: number;
  fee_usdt: number;
  signal: SignalAction;
  reason: string;
};

export type BinanceEquityPoint = {
  ts: string;
  date_kst: string;
  equity_usdt: number;
  cash_usdt: number;
  positions_value_usdt: number;
  return_pct: number;
  btc_benchmark_return_pct: number;
};

export type BinanceStrategySignal = {
  id: BinanceStrategyId;
  label: string;
  symbol: string;
  action: SignalAction;
  action_ko: string;
  score: number | null;
  reason: string;
  target_weight_pct: number;
  current_weight_pct: number;
  debounce?: {
    raw: SignalAction;
    stable: SignalAction;
    count: number;
    required: number;
  };
};

export type BinancePaperState = {
  version: 1;
  engine: "binance";
  initial_usdt: number;
  cash_usdt: number;
  positions: BinancePaperPosition[];
  trades: BinancePaperTrade[];
  equity_curve: BinanceEquityPoint[];
  signals: BinanceStrategySignal[];
  btc_benchmark_entry_price: number | null;
  started_at: string;
  last_tick_at: string | null;
  tick_count: number;
  signal_debounce?: Partial<
    Record<BinanceStrategyId, { raw: SignalAction; stable: SignalAction; count: number }>
  >;
};

export type BinancePaperPayload = {
  ok: boolean;
  engine: "binance";
  generated_at: string;
  generated_at_display: string;
  note: string;
  schedule_note: string;
  from_cache: boolean;
  initial_usdt: number;
  equity_usdt: number;
  cash_usdt: number;
  return_pct: number;
  btc_benchmark_return_pct: number;
  excess_vs_btc_pct: number;
  max_drawdown_pct: number;
  trade_count: number;
  positions: Array<
    BinancePaperPosition & {
      symbol_label: string;
      current_price: number | null;
      value_usdt: number | null;
      pnl_pct: number | null;
    }
  >;
  recent_trades: BinancePaperTrade[];
  equity_curve: BinanceEquityPoint[];
  signals: BinanceStrategySignal[];
  strategies_summary: string[];
  error?: string;
};

const STRATEGY_META: Record<
  BinanceStrategyId,
  {
    label: string;
    symbol: string;
    max_weight_pct: number;
    kind: MarketKind;
    asset_id: string;
    asset_label: string;
    signal_group: "crypto" | "metal" | "sector" | "theme";
  }
> = {
  major_btc: {
    label: "BTC Perp",
    symbol: "BTCUSDT",
    max_weight_pct: 25,
    kind: "crypto",
    asset_id: "btc_usdt",
    asset_label: "BTC",
    signal_group: "crypto",
  },
  major_eth: {
    label: "ETH Perp",
    symbol: "ETHUSDT",
    max_weight_pct: 15,
    kind: "crypto",
    asset_id: "eth_usdt",
    asset_label: "ETH",
    signal_group: "crypto",
  },
  tradefi_gold: {
    label: "Gold (XAU)",
    symbol: "XAUUSDT",
    max_weight_pct: 20,
    kind: "tradefi",
    asset_id: "xau_usdt",
    asset_label: "Gold",
    signal_group: "metal",
  },
  tradefi_silver: {
    label: "Silver (XAG)",
    symbol: "XAGUSDT",
    max_weight_pct: 15,
    kind: "tradefi",
    asset_id: "xag_usdt",
    asset_label: "Silver",
    signal_group: "metal",
  },
  tradefi_ewy: {
    label: "Korea ETF (EWY)",
    symbol: "EWYUSDT",
    max_weight_pct: 15,
    kind: "tradefi",
    asset_id: "ewy_usdt",
    asset_label: "EWY",
    signal_group: "sector",
  },
  tradefi_mu: {
    label: "Micron (MU)",
    symbol: "MUUSDT",
    max_weight_pct: 10,
    kind: "tradefi",
    asset_id: "mu_usdt",
    asset_label: "MU",
    signal_group: "theme",
  },
};

function displayNow(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function kstDateParts(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function newTradeId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function actionKo(a: SignalAction): string {
  if (a === "buy") return "매수";
  if (a === "sell") return "매도";
  return "관망";
}

function applySignalDebounce(
  prev: { raw: SignalAction; stable: SignalAction; count: number } | undefined,
  raw: SignalAction,
  required: number,
): { raw: SignalAction; stable: SignalAction; count: number } {
  if (raw === "hold") return { raw: "hold", stable: "hold", count: 0 };
  const prevRaw = prev?.raw ?? "hold";
  const prevStable = prev?.stable ?? "hold";
  const count = raw === prevRaw ? (prev?.count ?? 0) + 1 : 1;
  const stable = count >= required ? raw : prevStable;
  return { raw, stable, count };
}

export function defaultBinancePaperState(): BinancePaperState {
  const now = new Date().toISOString();
  return {
    version: 1,
    engine: "binance",
    initial_usdt: CHALLENGE_BINANCE_ALLOC_USDT,
    cash_usdt: CHALLENGE_BINANCE_ALLOC_USDT,
    positions: [],
    trades: [],
    equity_curve: [],
    signals: [],
    btc_benchmark_entry_price: null,
    started_at: now,
    last_tick_at: null,
    tick_count: 0,
  };
}

async function fetchJson<T>(url: string, timeout = 15_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type BinanceKline = [number, string, string, string, string, ...unknown[]];

async function fetchFuturesCandles(
  symbol: string,
  count = 120,
): Promise<SignalPoint[]> {
  const url =
    `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}` +
    `&interval=1d&limit=${count}`;
  const rows = await fetchJson<BinanceKline[]>(url);
  if (!rows?.length) return [];
  return rows
    .map((r) => ({
      date: new Date(r[0]).toISOString().slice(0, 10),
      value: Number(r[4]),
    }))
    .filter((p) => p.date && p.value > 0);
}

async function fetchFuturesPrices(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!symbols.length) return out;
  const url = "https://fapi.binance.com/fapi/v1/ticker/price";
  const rows = await fetchJson<Array<{ symbol: string; price: string }>>(url);
  const want = new Set(symbols);
  for (const r of rows || []) {
    if (want.has(r.symbol)) {
      const px = Number(r.price);
      if (px > 0) out.set(r.symbol, px);
    }
  }
  return out;
}

function evaluateTrend(
  meta: (typeof STRATEGY_META)[BinanceStrategyId],
  series: SignalPoint[],
): { action: SignalAction; score: number; reason: string } {
  const sig = buildAssetSignal(
    {
      id: meta.asset_id,
      symbol: meta.symbol,
      label: meta.asset_label,
      group: meta.signal_group,
    },
    series,
    null,
    { vix: null, hyOas: null },
  );
  const drivers = sig.drivers.slice(0, 2).join(" · ") || sig.signal_ko;
  return {
    action: sig.signal,
    score: sig.score,
    reason: `${sig.signal_ko}(${sig.score}) · ${drivers}`,
  };
}

function markToMarket(state: BinancePaperState, prices: Map<string, number>): number {
  let posVal = 0;
  for (const p of state.positions) {
    const px = prices.get(p.symbol);
    if (px != null && px > 0) posVal += p.quantity * px;
  }
  return state.cash_usdt + posVal;
}

function maxDrawdown(curve: BinanceEquityPoint[]): number {
  if (!curve.length) return 0;
  let peak = curve[0]!.equity_usdt;
  let mdd = 0;
  for (const p of curve) {
    if (p.equity_usdt > peak) peak = p.equity_usdt;
    const dd = peak > 0 ? (100 * (p.equity_usdt - peak)) / peak : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

function executeBuy(
  state: BinancePaperState,
  symbol: string,
  strategy: BinanceStrategyId,
  targetUsdt: number,
  price: number,
  signal: SignalAction,
  reason: string,
  now: string,
): BinancePaperState {
  if (!(price > 0) || !(targetUsdt > 5)) return state;
  const spend = Math.min(state.cash_usdt, targetUsdt);
  if (spend < 5) return state;
  const fee = spend * BINANCE_PAPER_FEE_RATE;
  const net = spend - fee;
  const qty = net / price;
  const trade: BinancePaperTrade = {
    id: newTradeId(),
    ts: now,
    symbol,
    strategy,
    side: "buy",
    price,
    quantity: qty,
    usdt: spend,
    fee_usdt: fee,
    signal,
    reason,
  };
  const existing = state.positions.find(
    (p) => p.symbol === symbol && p.strategy === strategy,
  );
  let positions: BinancePaperPosition[];
  if (existing) {
    const totalQty = existing.quantity + qty;
    const avg =
      totalQty > 0
        ? (existing.avg_price * existing.quantity + price * qty) / totalQty
        : price;
    positions = state.positions.map((p) =>
      p.symbol === symbol && p.strategy === strategy
        ? { ...p, quantity: totalQty, avg_price: avg, peak_price: Math.max(p.peak_price ?? price, price) }
        : p,
    );
  } else {
    positions = [
      ...state.positions,
      {
        symbol,
        strategy,
        quantity: qty,
        avg_price: price,
        opened_at: now,
        peak_price: price,
      },
    ];
  }
  return {
    ...state,
    cash_usdt: state.cash_usdt - spend,
    positions,
    trades: [...state.trades, trade].slice(-500),
  };
}

function executeSell(
  state: BinancePaperState,
  symbol: string,
  strategy: BinanceStrategyId,
  price: number,
  signal: SignalAction,
  reason: string,
  now: string,
): BinancePaperState {
  const pos = state.positions.find(
    (p) => p.symbol === symbol && p.strategy === strategy,
  );
  if (!pos || !(pos.quantity > 0) || !(price > 0)) return state;
  const qty = pos.quantity;
  const gross = qty * price;
  const fee = gross * BINANCE_PAPER_FEE_RATE;
  const net = gross - fee;
  const trade: BinancePaperTrade = {
    id: newTradeId(),
    ts: now,
    symbol,
    strategy,
    side: "sell",
    price,
    quantity: qty,
    usdt: gross,
    fee_usdt: fee,
    signal,
    reason,
  };
  const positions = state.positions.filter(
    (p) => !(p.symbol === symbol && p.strategy === strategy),
  );
  return {
    ...state,
    cash_usdt: state.cash_usdt + net,
    positions,
    trades: [...state.trades, trade].slice(-500),
  };
}

export async function tickBinancePaperPortfolio(
  state: BinancePaperState,
): Promise<BinancePaperState> {
  const now = new Date().toISOString();
  const dateKst = kstDateParts();
  const strategyIds = Object.keys(STRATEGY_META) as BinanceStrategyId[];

  const seriesMap = new Map<BinanceStrategyId, SignalPoint[]>();
  await Promise.all(
    strategyIds.map(async (id) => {
      const sym = STRATEGY_META[id].symbol;
      seriesMap.set(id, await fetchFuturesCandles(sym));
    }),
  );

  const symbols = strategyIds.map((id) => STRATEGY_META[id].symbol);
  const prices = await fetchFuturesPrices(symbols);
  for (const p of state.positions) {
    if (!prices.has(p.symbol)) symbols.push(p.symbol);
  }
  const morePrices = await fetchFuturesPrices(
    symbols.filter((s) => !prices.has(s)),
  );
  for (const [k, v] of morePrices) prices.set(k, v);

  let s = { ...state };
  if (s.btc_benchmark_entry_price == null) {
    const bp = prices.get("BTCUSDT");
    if (bp != null && bp > 0) s = { ...s, btc_benchmark_entry_price: bp };
  }

  const equityBefore = markToMarket(s, prices);
  const laneSignals = strategyIds.map((id) => {
    const meta = STRATEGY_META[id];
    const ev = evaluateTrend(meta, seriesMap.get(id) || []);
    return { id, ...ev, symbol: meta.symbol };
  });

  const debounceMap: NonNullable<BinancePaperState["signal_debounce"]> = {
    ...(s.signal_debounce || {}),
  };

  for (const lane of laneSignals) {
    const meta = STRATEGY_META[lane.id];
    const px = prices.get(meta.symbol);
    if (px == null || !(px > 0)) continue;

    const deb = applySignalDebounce(
      debounceMap[lane.id],
      lane.action,
      SIGNAL_DEBOUNCE_TICKS,
    );
    debounceMap[lane.id] = deb;
    const tradeAction = deb.stable;

    const hasPos = s.positions.some(
      (p) => p.strategy === lane.id && p.symbol === meta.symbol && p.quantity > 0,
    );
    const targetUsdt = (equityBefore * meta.max_weight_pct) / 100;

    if (tradeAction === "buy" && !hasPos) {
      s = executeBuy(
        s,
        meta.symbol,
        lane.id,
        targetUsdt,
        px,
        tradeAction,
        lane.reason,
        now,
      );
    } else if (tradeAction === "sell" && hasPos) {
      s = executeSell(s, meta.symbol, lane.id, px, tradeAction, lane.reason, now);
    }
  }

  s = { ...s, signal_debounce: debounceMap };

  const equity = markToMarket(s, prices);
  const retPct =
    s.initial_usdt > 0 ? (100 * (equity - s.initial_usdt)) / s.initial_usdt : 0;
  const btcPx = prices.get("BTCUSDT");
  const btcBench =
    s.btc_benchmark_entry_price != null &&
    s.btc_benchmark_entry_price > 0 &&
    btcPx != null
      ? (100 * (btcPx - s.btc_benchmark_entry_price)) / s.btc_benchmark_entry_price
      : 0;

  const signals: BinanceStrategySignal[] = laneSignals.map((lane) => {
    const meta = STRATEGY_META[lane.id];
    const pos = s.positions.find((p) => p.strategy === lane.id);
    const posVal =
      pos && prices.get(pos.symbol) != null
        ? pos.quantity * prices.get(pos.symbol)!
        : 0;
    const w = equity > 0 ? (100 * posVal) / equity : 0;
    const deb = debounceMap[lane.id];
    const stable = deb?.stable ?? lane.action;
    return {
      id: lane.id,
      label: meta.label,
      symbol: meta.symbol,
      action: stable,
      action_ko: actionKo(stable),
      score: lane.score,
      reason: lane.reason,
      target_weight_pct: meta.max_weight_pct,
      current_weight_pct: Math.round(w * 10) / 10,
      debounce: deb
        ? {
            raw: deb.raw,
            stable: deb.stable,
            count: deb.count,
            required: SIGNAL_DEBOUNCE_TICKS,
          }
        : undefined,
    };
  });

  const lastCurve = s.equity_curve[s.equity_curve.length - 1];
  const shouldAppend =
    !lastCurve ||
    lastCurve.date_kst !== dateKst ||
    Math.abs(lastCurve.equity_usdt - equity) / Math.max(equity, 1) > 0.002;

  const equity_curve = shouldAppend
    ? [
        ...s.equity_curve,
        {
          ts: now,
          date_kst: dateKst,
          equity_usdt: equity,
          cash_usdt: s.cash_usdt,
          positions_value_usdt: equity - s.cash_usdt,
          return_pct: retPct,
          btc_benchmark_return_pct: btcBench,
        },
      ].slice(-400)
    : s.equity_curve;

  return {
    ...s,
    signals,
    equity_curve,
    last_tick_at: now,
    tick_count: s.tick_count + 1,
  };
}

export async function loadBinancePaperState(): Promise<BinancePaperState | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(BINANCE_PAPER_R2_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as BinancePaperState;
    if (data?.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export async function publishBinanceSignalsSnapshot(
  state: BinancePaperState,
): Promise<boolean> {
  if (!r2Configured()) return false;
  try {
    const payload = {
      version: 1,
      engine: "binance",
      generated_at: state.last_tick_at || new Date().toISOString(),
      tick_count: state.tick_count,
      note: "SavvyETF 바이낸스엔진 signals for Render executor",
      strategies: state.signals.map((sig) => ({
        id: sig.id,
        label: sig.label,
        symbol: sig.symbol,
        market_type: "futures",
        action: sig.debounce?.stable ?? sig.action,
        raw_action: sig.debounce?.raw ?? sig.action,
        score: sig.score,
        reason: sig.reason,
        target_weight_pct: sig.target_weight_pct,
        debounce: sig.debounce ?? null,
      })),
    };
    await r2PutObject(
      BINANCE_SIGNALS_R2_KEY,
      JSON.stringify(payload),
      "application/json",
    );
    return true;
  } catch {
    return false;
  }
}

export async function persistBinancePaperState(
  state: BinancePaperState,
): Promise<boolean> {
  if (!r2Configured()) return false;
  try {
    await r2PutObject(
      BINANCE_PAPER_R2_KEY,
      JSON.stringify(state),
      "application/json",
    );
    await publishBinanceSignalsSnapshot(state);
    return true;
  } catch {
    return false;
  }
}

export async function buildBinancePaperPayload(options?: {
  forceTick?: boolean;
}): Promise<BinancePaperPayload> {
  let state = (await loadBinancePaperState()) || defaultBinancePaperState();
  const staleMs = 55 * 60 * 1000;
  const last = state.last_tick_at ? Date.parse(state.last_tick_at) : 0;
  const shouldTick =
    options?.forceTick ||
    !state.last_tick_at ||
    Date.now() - last > staleMs ||
    state.equity_curve.length === 0;

  if (shouldTick) {
    state = await tickBinancePaperPortfolio(state);
    await persistBinancePaperState(state);
  }

  const symbols = [...new Set(state.positions.map((p) => p.symbol))];
  if (!symbols.includes("BTCUSDT")) symbols.push("BTCUSDT");
  const prices = await fetchFuturesPrices(symbols);
  const equity = markToMarket(state, prices);
  const retPct =
    state.initial_usdt > 0
      ? (100 * (equity - state.initial_usdt)) / state.initial_usdt
      : 0;
  const btcPx = prices.get("BTCUSDT");
  const btcBench =
    state.btc_benchmark_entry_price != null &&
    state.btc_benchmark_entry_price > 0 &&
    btcPx != null
      ? (100 * (btcPx - state.btc_benchmark_entry_price)) /
        state.btc_benchmark_entry_price
      : 0;

  const positions = state.positions.map((p) => {
    const px = prices.get(p.symbol);
    const val = px != null ? p.quantity * px : null;
    const pnl =
      px != null && p.avg_price > 0
        ? (100 * (px - p.avg_price)) / p.avg_price
        : null;
    return {
      ...p,
      symbol_label: p.symbol,
      current_price: px ?? null,
      value_usdt: val,
      pnl_pct: pnl,
    };
  });

  const strategies_summary = state.signals.map(
    (s) =>
      `${s.label}: ${s.action_ko} · 목표 ${s.target_weight_pct}% · 현재 ${s.current_weight_pct}% · ${s.reason}`,
  );

  return {
    ok: true,
    engine: "binance",
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    note: BINANCE_PAPER_NOTE,
    schedule_note:
      "바이낸스엔진 · USDT-M 페이퍼 · 약 1시간마다 갱신 · 동일 신호 2회 연속 시 체결",
    from_cache: !shouldTick,
    initial_usdt: state.initial_usdt,
    equity_usdt: equity,
    cash_usdt: state.cash_usdt,
    return_pct: retPct,
    btc_benchmark_return_pct: btcBench,
    excess_vs_btc_pct: retPct - btcBench,
    max_drawdown_pct: maxDrawdown(state.equity_curve),
    trade_count: state.trades.length,
    positions,
    recent_trades: [...state.trades].reverse().slice(0, 20),
    equity_curve: state.equity_curve,
    signals: state.signals,
    strategies_summary,
  };
}

/**
 * Crypto paper trading (Upbit KRW markets) — no real orders.
 *
 * Phase A–B: public Upbit + Yahoo/CoinGecko data, rule signals, simulated fills.
 * State persisted to R2; hourly cron tick.
 *
 * Strategies:
 * 1) Major BTC/ETH — trend score (SMA20/50 + momentum)
 * 2) Kimchi + USDT — premium regime on KRW-USDT
 * 3) Alt surge — 24h volume/price surge scan (single slot)
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import {
  buildAssetSignal,
  type SignalAction,
  type SignalPoint,
} from "@/lib/tradingSignals";

export const CRYPTO_PAPER_R2_KEY = "crypto_paper/state_v1.json";
export const CRYPTO_SIGNALS_R2_KEY = "crypto_paper/signals_latest.json";
export const CRYPTO_PAPER_INITIAL_KRW = 10_000_000;
export const CRYPTO_PAPER_FEE_RATE = 0.0005; // 0.05% per side (KRW markets)
export const CRYPTO_PAPER_FEE_RATE_USDT = 0.0025; // 0.25% per side (KRW-USDT)
/** Consecutive hourly ticks with same raw signal before paper/live execution */
export const SIGNAL_DEBOUNCE_TICKS = 2;
export const CRYPTO_PAPER_NOTE =
  "페이퍼 트레이딩 · 실제 주문 없음 · Upbit 공개 시세 · 교육용(투자 권유 아님)";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export type StrategyId = "major_btc" | "major_eth" | "kimchi_usdt" | "alt_surge";

export type PaperPosition = {
  market: string;
  strategy: StrategyId;
  quantity: number;
  avg_price: number;
  opened_at: string;
  peak_price: number | null;
};

export type PaperTrade = {
  id: string;
  ts: string;
  market: string;
  strategy: StrategyId;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  krw: number;
  fee_krw: number;
  signal: SignalAction;
  reason: string;
};

export type EquityPoint = {
  ts: string;
  date_kst: string;
  equity_krw: number;
  cash_krw: number;
  positions_value_krw: number;
  return_pct: number;
  btc_benchmark_return_pct: number;
};

export type SignalDebounce = {
  raw: SignalAction;
  stable: SignalAction;
  count: number;
  required: number;
};

export type StrategySignal = {
  id: StrategyId;
  label: string;
  market: string;
  action: SignalAction;
  action_ko: string;
  score: number | null;
  reason: string;
  target_weight_pct: number;
  current_weight_pct: number;
  debounce?: SignalDebounce;
};

export type CryptoPaperState = {
  version: 1;
  initial_krw: number;
  cash_krw: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  equity_curve: EquityPoint[];
  signals: StrategySignal[];
  btc_benchmark_entry_price: number | null;
  started_at: string;
  last_tick_at: string | null;
  tick_count: number;
  signal_debounce?: Partial<
    Record<StrategyId, { raw: SignalAction; stable: SignalAction; count: number }>
  >;
};

export type CryptoPaperPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  note: string;
  schedule_note: string;
  from_cache: boolean;
  initial_krw: number;
  equity_krw: number;
  cash_krw: number;
  return_pct: number;
  btc_benchmark_return_pct: number;
  excess_vs_btc_pct: number;
  max_drawdown_pct: number;
  trade_count: number;
  positions: Array<
    PaperPosition & {
      market_label: string;
      current_price: number | null;
      value_krw: number | null;
      pnl_pct: number | null;
    }
  >;
  recent_trades: PaperTrade[];
  equity_curve: EquityPoint[];
  signals: StrategySignal[];
  strategies_summary: string[];
  error?: string;
};

type UpbitCandle = {
  market: string;
  candle_date_time_utc: string;
  trade_price: number;
  candle_acc_trade_price: number;
};

type UpbitTicker = {
  market: string;
  trade_price: number;
  signed_change_rate: number;
  acc_trade_price_24h: number;
};

const STRATEGY_META: Record<
  StrategyId,
  { label: string; market: string; max_weight_pct: number }
> = {
  major_btc: { label: "메이저 BTC", market: "KRW-BTC", max_weight_pct: 35 },
  major_eth: { label: "메이저 ETH", market: "KRW-ETH", max_weight_pct: 25 },
  kimchi_usdt: { label: "김프·USDT", market: "KRW-USDT", max_weight_pct: 20 },
  alt_surge: { label: "알트 급등", market: "", max_weight_pct: 15 },
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
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function actionKo(a: SignalAction): string {
  if (a === "buy") return "매수";
  if (a === "sell") return "매도";
  return "관망";
}

function feeRateForMarket(market: string): number {
  return market === "KRW-USDT" ? CRYPTO_PAPER_FEE_RATE_USDT : CRYPTO_PAPER_FEE_RATE;
}

function applySignalDebounce(
  prev: { raw: SignalAction; stable: SignalAction; count: number } | undefined,
  raw: SignalAction,
  required: number,
): { raw: SignalAction; stable: SignalAction; count: number } {
  if (raw === "hold") {
    return { raw: "hold", stable: "hold", count: 0 };
  }
  const prevRaw = prev?.raw ?? "hold";
  const prevStable = prev?.stable ?? "hold";
  const count = raw === prevRaw ? (prev?.count ?? 0) + 1 : 1;
  const stable = count >= required ? raw : prevStable;
  return { raw, stable, count };
}

export function defaultCryptoPaperState(): CryptoPaperState {
  const now = new Date().toISOString();
  return {
    version: 1,
    initial_krw: CRYPTO_PAPER_INITIAL_KRW,
    cash_krw: CRYPTO_PAPER_INITIAL_KRW,
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

async function fetchUpbitCandles(
  market: string,
  count = 120,
): Promise<SignalPoint[]> {
  const url =
    `https://api.upbit.com/v1/candles/days?market=${encodeURIComponent(market)}` +
    `&count=${count}`;
  const rows = await fetchJson<UpbitCandle[]>(url);
  if (!rows?.length) return [];
  return [...rows]
    .reverse()
    .map((r) => ({
      date: (r.candle_date_time_utc || "").slice(0, 10),
      value: r.trade_price,
    }))
    .filter((p) => p.date && p.value > 0);
}

async function fetchUpbitTickers(markets: string[]): Promise<Map<string, UpbitTicker>> {
  const out = new Map<string, UpbitTicker>();
  if (!markets.length) return out;
  const chunk = 100;
  for (let i = 0; i < markets.length; i += chunk) {
    const slice = markets.slice(i, i + chunk);
    const url =
      `https://api.upbit.com/v1/ticker?markets=${slice.map(encodeURIComponent).join(",")}`;
    const rows = await fetchJson<UpbitTicker[]>(url);
    for (const r of rows || []) {
      if (r.market) out.set(r.market, r);
    }
  }
  return out;
}

async function fetchUpbitKrwMarkets(): Promise<string[]> {
  const rows = await fetchJson<Array<{ market: string }>>(
    "https://api.upbit.com/v1/market/all?isDetails=false",
  );
  return (rows || [])
    .map((r) => r.market)
    .filter((m) => m?.startsWith("KRW-"));
}

async function fetchKimchiBtcPct(): Promise<number | null> {
  const [upbit, cg, krw] = await Promise.all([
    fetchUpbitTickers(["KRW-BTC"]),
    fetchJson<{ bitcoin?: { usd?: number } }>(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    ),
    fetchJson<{
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    }>(
      `https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?period1=${Math.floor(Date.now() / 1000) - 86400}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`,
    ),
  ]);
  const up = upbit.get("KRW-BTC")?.trade_price;
  const usd = cg?.bitcoin?.usd;
  const fx = krw?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (up == null || usd == null || fx == null || !(up > 0) || !(usd > 0) || !(fx > 0)) {
    return null;
  }
  const fair = usd * fx;
  return 100 * (up / fair - 1);
}

function evaluateMajor(series: SignalPoint[]): {
  action: SignalAction;
  score: number;
  reason: string;
} {
  const sig = buildAssetSignal(
    { id: "btc_krw", symbol: "KRW-BTC", label: "BTC", group: "crypto" },
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

function evaluateKimchiUsdt(kimchiPct: number | null): {
  action: SignalAction;
  score: number;
  reason: string;
} {
  if (kimchiPct == null) {
    return { action: "hold", score: 50, reason: "김프 데이터 없음" };
  }
  if (kimchiPct >= 2.5) {
    return {
      action: "buy",
      score: 75,
      reason: `김프 ${kimchiPct.toFixed(2)}% — 국내 프리미엄 확대, USDT 비중 확대 검토`,
    };
  }
  if (kimchiPct >= 1.0) {
    return {
      action: "hold",
      score: 58,
      reason: `김프 ${kimchiPct.toFixed(2)}% — 중립~약한 프리미엄`,
    };
  }
  if (kimchiPct <= 0.2) {
    return {
      action: "sell",
      score: 30,
      reason: `김프 ${kimchiPct.toFixed(2)}% — 프리미엄 소멸, USDT 축소`,
    };
  }
  return {
    action: "hold",
    score: 45,
    reason: `김프 ${kimchiPct.toFixed(2)}% — 뚜렷한 신호 없음`,
  };
}

async function evaluateAltSurge(
  heldMarket: string | null,
  heldEntry: number | null,
): Promise<{ action: SignalAction; market: string; score: number; reason: string }> {
  const EXCLUDE = new Set([
    "KRW-BTC",
    "KRW-ETH",
    "KRW-USDT",
    "KRW-USDC",
    "KRW-DAI",
  ]);
  const markets = (await fetchUpbitKrwMarkets()).filter((m) => !EXCLUDE.has(m));
  const tickers = await fetchUpbitTickers(markets);
  const MIN_KRW = 3_000_000_000; // 30억 원 24h 거래대금

  if (heldMarket && heldEntry != null) {
    const t = tickers.get(heldMarket);
    const px = t?.trade_price;
    if (px != null && px > 0) {
      const pnl = (100 * (px - heldEntry)) / heldEntry;
      if (pnl <= -8) {
        return {
          action: "sell",
          market: heldMarket,
          score: 20,
          reason: `알트 손절 ${pnl.toFixed(1)}% (${heldMarket})`,
        };
      }
      if (pnl >= 12) {
        return {
          action: "sell",
          market: heldMarket,
          score: 70,
          reason: `알트 익절 ${pnl.toFixed(1)}% (${heldMarket})`,
        };
      }
    }
    return {
      action: "hold",
      market: heldMarket,
      score: 52,
      reason: `알트 보유 중 ${heldMarket}`,
    };
  }

  type Cand = { market: string; score: number; reason: string };
  const cands: Cand[] = [];
  for (const [market, t] of tickers) {
    if (!(t.acc_trade_price_24h >= MIN_KRW)) continue;
    const chg = (t.signed_change_rate ?? 0) * 100;
    if (chg < 4) continue;
    const volScore = Math.min(40, t.acc_trade_price_24h / 1e10);
    const score = clip(50 + chg * 2 + volScore);
    cands.push({
      market,
      score,
      reason: `24h ${chg.toFixed(1)}% · 거래대금 ${(t.acc_trade_price_24h / 1e8).toFixed(0)}억`,
    });
  }
  cands.sort((a, b) => b.score - a.score);
  const top = cands[0];
  if (!top || top.score < 68) {
    return {
      action: "hold",
      market: "",
      score: 50,
      reason: "거래량·상승률 기준 알트 후보 없음",
    };
  }
  return {
    action: "buy",
    market: top.market,
    score: top.score,
    reason: `${top.market} · ${top.reason}`,
  };
}

function clip(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function markToMarket(
  state: CryptoPaperState,
  prices: Map<string, number>,
): number {
  let posVal = 0;
  for (const p of state.positions) {
    const px = prices.get(p.market);
    if (px != null && px > 0) posVal += p.quantity * px;
  }
  return state.cash_krw + posVal;
}

function maxDrawdown(curve: EquityPoint[]): number {
  if (!curve.length) return 0;
  let peak = curve[0]!.equity_krw;
  let mdd = 0;
  for (const p of curve) {
    if (p.equity_krw > peak) peak = p.equity_krw;
    const dd = peak > 0 ? (100 * (p.equity_krw - peak)) / peak : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

function executeBuy(
  state: CryptoPaperState,
  market: string,
  strategy: StrategyId,
  targetKrw: number,
  price: number,
  signal: SignalAction,
  reason: string,
  now: string,
): CryptoPaperState {
  if (!(price > 0) || !(targetKrw > 10_000)) return state;
  const spend = Math.min(state.cash_krw, targetKrw);
  if (spend < 10_000) return state;
  const fee = spend * feeRateForMarket(market);
  const net = spend - fee;
  const qty = net / price;
  const trade: PaperTrade = {
    id: newTradeId(),
    ts: now,
    market,
    strategy,
    side: "buy",
    price,
    quantity: qty,
    krw: spend,
    fee_krw: fee,
    signal,
    reason,
  };
  const existing = state.positions.find(
    (p) => p.market === market && p.strategy === strategy,
  );
  let positions: PaperPosition[];
  if (existing) {
    const totalQty = existing.quantity + qty;
    const avg =
      totalQty > 0
        ? (existing.avg_price * existing.quantity + price * qty) / totalQty
        : price;
    positions = state.positions.map((p) =>
      p.market === market && p.strategy === strategy
        ? {
            ...p,
            quantity: totalQty,
            avg_price: avg,
            peak_price: Math.max(p.peak_price ?? price, price),
          }
        : p,
    );
  } else {
    positions = [
      ...state.positions,
      {
        market,
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
    cash_krw: state.cash_krw - spend,
    positions,
    trades: [...state.trades, trade].slice(-500),
  };
}

function executeSell(
  state: CryptoPaperState,
  market: string,
  strategy: StrategyId,
  price: number,
  signal: SignalAction,
  reason: string,
  now: string,
  fraction = 1,
): CryptoPaperState {
  const pos = state.positions.find(
    (p) => p.market === market && p.strategy === strategy,
  );
  if (!pos || !(pos.quantity > 0) || !(price > 0)) return state;
  const qty = pos.quantity * Math.min(1, Math.max(0, fraction));
  const gross = qty * price;
  const fee = gross * feeRateForMarket(market);
  const net = gross - fee;
  const trade: PaperTrade = {
    id: newTradeId(),
    ts: now,
    market,
    strategy,
    side: "sell",
    price,
    quantity: qty,
    krw: gross,
    fee_krw: fee,
    signal,
    reason,
  };
  const remaining = pos.quantity - qty;
  const positions =
    remaining > 1e-12
      ? state.positions.map((p) =>
          p.market === market && p.strategy === strategy
            ? { ...p, quantity: remaining }
            : p,
        )
      : state.positions.filter(
          (p) => !(p.market === market && p.strategy === strategy),
        );
  return {
    ...state,
    cash_krw: state.cash_krw + net,
    positions,
    trades: [...state.trades, trade].slice(-500),
  };
}

export async function tickCryptoPaperPortfolio(
  state: CryptoPaperState,
): Promise<CryptoPaperState> {
  const now = new Date().toISOString();
  const dateKst = kstDateParts();

  const [btcSeries, ethSeries, kimchiPct, altEval] = await Promise.all([
    fetchUpbitCandles("KRW-BTC"),
    fetchUpbitCandles("KRW-ETH"),
    fetchKimchiBtcPct(),
    (async () => {
      const altPos = state.positions.find((p) => p.strategy === "alt_surge");
      return evaluateAltSurge(altPos?.market ?? null, altPos?.avg_price ?? null);
    })(),
  ]);

  const btcEval = evaluateMajor(btcSeries);
  const ethEval = evaluateMajor(ethSeries);
  const usdtEval = evaluateKimchiUsdt(kimchiPct);

  const marketsNeeded = new Set<string>([
    "KRW-BTC",
    "KRW-ETH",
    "KRW-USDT",
  ]);
  if (altEval.market) marketsNeeded.add(altEval.market);
  for (const p of state.positions) marketsNeeded.add(p.market);

  const tickers = await fetchUpbitTickers([...marketsNeeded]);
  const prices = new Map<string, number>();
  for (const [m, t] of tickers) prices.set(m, t.trade_price);

  let s = { ...state };
  if (s.btc_benchmark_entry_price == null) {
    const bp = prices.get("KRW-BTC");
    if (bp != null && bp > 0) s = { ...s, btc_benchmark_entry_price: bp };
  }

  const equityBefore = markToMarket(s, prices);

  const laneSignals: Array<{
    id: StrategyId;
    market: string;
    action: SignalAction;
    score: number;
    reason: string;
  }> = [
    {
      id: "major_btc",
      market: "KRW-BTC",
      action: btcEval.action,
      score: btcEval.score,
      reason: btcEval.reason,
    },
    {
      id: "major_eth",
      market: "KRW-ETH",
      action: ethEval.action,
      score: ethEval.score,
      reason: ethEval.reason,
    },
    {
      id: "kimchi_usdt",
      market: "KRW-USDT",
      action: usdtEval.action,
      score: usdtEval.score,
      reason: usdtEval.reason,
    },
    {
      id: "alt_surge",
      market: altEval.market || "",
      action: altEval.action,
      score: altEval.score,
      reason: altEval.reason,
    },
  ];

  const debounceMap: NonNullable<CryptoPaperState["signal_debounce"]> = {
    ...(s.signal_debounce || {}),
  };

  for (const lane of laneSignals) {
    const meta = STRATEGY_META[lane.id];
    const market =
      lane.id === "alt_surge" ? lane.market || meta.market : meta.market;
    if (!market) continue;
    const px = prices.get(market);
    if (px == null || !(px > 0)) continue;

    const deb = applySignalDebounce(
      debounceMap[lane.id],
      lane.action,
      SIGNAL_DEBOUNCE_TICKS,
    );
    debounceMap[lane.id] = deb;
    const tradeAction = deb.stable;

    const hasPos = s.positions.some(
      (p) => p.strategy === lane.id && p.market === market && p.quantity > 0,
    );
    const targetKrw = (equityBefore * meta.max_weight_pct) / 100;

    if (tradeAction === "buy" && !hasPos) {
      s = executeBuy(
        s,
        market,
        lane.id,
        targetKrw,
        px,
        tradeAction,
        lane.reason,
        now,
      );
    } else if (tradeAction === "sell" && hasPos) {
      s = executeSell(s, market, lane.id, px, tradeAction, lane.reason, now);
    } else if (
      lane.id === "alt_surge" &&
      tradeAction === "buy" &&
      lane.market &&
      lane.market !== market &&
      hasPos
    ) {
      // rotate alt: sell old first (handled in next tick after sell)
    }
  }

  s = { ...s, signal_debounce: debounceMap };

  // Alt rotation: debounced buy for a different market
  const altDeb = debounceMap.alt_surge;
  const altTradeBuy =
    altDeb?.stable === "buy" && altEval.market && altDeb.count >= SIGNAL_DEBOUNCE_TICKS;
  const altPos = s.positions.find((p) => p.strategy === "alt_surge");
  if (altTradeBuy && altEval.market && altPos && altPos.market !== altEval.market) {
    const px = prices.get(altPos.market);
    if (px != null) {
      s = executeSell(
        s,
        altPos.market,
        "alt_surge",
        px,
        "sell",
        `알트 교체 → ${altEval.market}`,
        now,
      );
      const npx = prices.get(altEval.market);
      if (npx != null) {
        const eq = markToMarket(s, prices);
        s = executeBuy(
          s,
          altEval.market,
          "alt_surge",
          (eq * STRATEGY_META.alt_surge.max_weight_pct) / 100,
          npx,
          "buy",
          altEval.reason,
          now,
        );
      }
    }
  }

  const equity = markToMarket(s, prices);
  const retPct =
    s.initial_krw > 0 ? (100 * (equity - s.initial_krw)) / s.initial_krw : 0;
  const btcPx = prices.get("KRW-BTC");
  const btcBench =
    s.btc_benchmark_entry_price != null &&
    s.btc_benchmark_entry_price > 0 &&
    btcPx != null
      ? (100 * (btcPx - s.btc_benchmark_entry_price)) / s.btc_benchmark_entry_price
      : 0;

  const signals: StrategySignal[] = laneSignals.map((lane) => {
    const meta = STRATEGY_META[lane.id];
    const mkt = lane.id === "alt_surge" ? lane.market || "—" : meta.market;
    const pos = s.positions.find((p) => p.strategy === lane.id);
    const posVal =
      pos && prices.get(pos.market) != null
        ? pos.quantity * prices.get(pos.market)!
        : 0;
    const w = equity > 0 ? (100 * posVal) / equity : 0;
    const deb = debounceMap[lane.id];
    const stable = deb?.stable ?? lane.action;
    return {
      id: lane.id,
      label: meta.label,
      market: pos?.market || mkt,
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
    Math.abs(lastCurve.equity_krw - equity) / Math.max(equity, 1) > 0.002;

  const equity_curve = shouldAppend
    ? [
        ...s.equity_curve,
        {
          ts: now,
          date_kst: dateKst,
          equity_krw: equity,
          cash_krw: s.cash_krw,
          positions_value_krw: equity - s.cash_krw,
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

export async function loadCryptoPaperState(): Promise<CryptoPaperState | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(CRYPTO_PAPER_R2_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as CryptoPaperState;
    if (data?.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export async function persistCryptoPaperState(
  state: CryptoPaperState,
): Promise<boolean> {
  if (!r2Configured()) return false;
  try {
    await r2PutObject(
      CRYPTO_PAPER_R2_KEY,
      JSON.stringify(state),
      "application/json",
    );
    await publishSignalsSnapshot(state);
    return true;
  } catch {
    return false;
  }
}

export type CryptoSignalsSnapshot = {
  version: 1;
  generated_at: string;
  tick_count: number;
  note: string;
  strategies: Array<{
    id: StrategyId;
    label: string;
    market: string;
    action: SignalAction;
    raw_action: SignalAction;
    score: number | null;
    reason: string;
    target_weight_pct: number;
    debounce: SignalDebounce | null;
  }>;
};

export async function publishSignalsSnapshot(
  state: CryptoPaperState,
): Promise<boolean> {
  if (!r2Configured()) return false;
  try {
    const payload: CryptoSignalsSnapshot = {
      version: 1,
      generated_at: state.last_tick_at || new Date().toISOString(),
      tick_count: state.tick_count,
      note: "SavvyETF crypto signals for Render executor — debounced stable actions",
      strategies: state.signals.map((sig) => ({
        id: sig.id,
        label: sig.label,
        market: sig.market,
        action: sig.debounce?.stable ?? sig.action,
        raw_action: sig.debounce?.raw ?? sig.action,
        score: sig.score,
        reason: sig.reason,
        target_weight_pct: sig.target_weight_pct,
        debounce: sig.debounce ?? null,
      })),
    };
    await r2PutObject(
      CRYPTO_SIGNALS_R2_KEY,
      JSON.stringify(payload),
      "application/json",
    );
    return true;
  } catch {
    return false;
  }
}

export async function buildCryptoPaperPayload(options?: {
  forceTick?: boolean;
}): Promise<CryptoPaperPayload> {
  let state = (await loadCryptoPaperState()) || defaultCryptoPaperState();
  const staleMs = 55 * 60 * 1000;
  const last = state.last_tick_at ? Date.parse(state.last_tick_at) : 0;
  const shouldTick =
    options?.forceTick ||
    !state.last_tick_at ||
    Date.now() - last > staleMs ||
    state.equity_curve.length === 0;

  if (shouldTick) {
    state = await tickCryptoPaperPortfolio(state);
    await persistCryptoPaperState(state);
  }

  const markets = [...new Set(state.positions.map((p) => p.market))];
  if (!markets.includes("KRW-BTC")) markets.push("KRW-BTC");
  const tickers = await fetchUpbitTickers(markets);
  const prices = new Map<string, number>();
  for (const [m, t] of tickers) prices.set(m, t.trade_price);

  const equity = markToMarket(state, prices);
  const retPct =
    state.initial_krw > 0
      ? (100 * (equity - state.initial_krw)) / state.initial_krw
      : 0;
  const btcPx = prices.get("KRW-BTC");
  const btcBench =
    state.btc_benchmark_entry_price != null &&
    state.btc_benchmark_entry_price > 0 &&
    btcPx != null
      ? (100 * (btcPx - state.btc_benchmark_entry_price)) /
        state.btc_benchmark_entry_price
      : 0;

  const positions = state.positions.map((p) => {
    const px = prices.get(p.market);
    const val = px != null ? p.quantity * px : null;
    const pnl =
      px != null && p.avg_price > 0
        ? (100 * (px - p.avg_price)) / p.avg_price
        : null;
    return {
      ...p,
      market_label: p.market.replace("KRW-", ""),
      current_price: px ?? null,
      value_krw: val,
      pnl_pct: pnl,
    };
  });

  const strategies_summary = state.signals.map(
    (s) =>
      `${s.label}: ${s.action_ko} · 목표 ${s.target_weight_pct}% · 현재 ${s.current_weight_pct}% · ${s.reason}`,
  );

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    note: CRYPTO_PAPER_NOTE,
    schedule_note:
      "시그널·페이퍼 체결은 약 1시간마다 갱신(크론) · 동일 신호 2회 연속 시 체결 · 실제 Upbit 주문 없음",
    from_cache: !shouldTick,
    initial_krw: state.initial_krw,
    equity_krw: equity,
    cash_krw: state.cash_krw,
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

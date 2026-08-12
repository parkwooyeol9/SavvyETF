/**
 * 김프 차익거래 엔진 — 업비트엔진 + 바이낸스엔진 연동 시그널.
 *
 * Upbit KRW-BTC vs Binance BTCUSDT + USD/KRW 환율로 김치 프리미엄 계산.
 * 수수료·슬리피지·전송비 버퍼를 반영한 순스프레드 기준으로 차익 기회를 탐지.
 * 실거래 시 양쪽 거래소 동시 주문(헷지)이 필요 — Render challenge orchestrator가 실행.
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import { fetchCoingeckoBtcUsd } from "@/lib/binanceMarketFallback";

export const KIMCHI_ARB_R2_KEY = "challenge/kimchi_arb_latest.json";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

/** Round-trip cost estimate: Upbit 0.05%×2 + Binance 0.04%×2 + buffer */
export const KIMCHI_ARB_COST_PCT = 0.35;
export const KIMCHI_ARB_ENTER_PCT = 2.0;
export const KIMCHI_ARB_EXIT_PCT = 0.5;

export type KimchiArbLeg = {
  engine: "upbit" | "binance";
  action: "buy" | "sell";
  symbol: string;
  side_ko: string;
  notional_hint: string;
};

export type KimchiArbSignal = {
  version: 1;
  generated_at: string;
  kimchi_pct: number | null;
  net_spread_pct: number | null;
  upbit_btc_krw: number | null;
  binance_btc_usdt: number | null;
  usd_krw: number | null;
  regime: "premium_high" | "premium_low" | "neutral";
  regime_ko: string;
  arb_action: "enter_short_kimchi" | "enter_long_kimchi" | "hold" | "unavailable";
  arb_action_ko: string;
  legs: KimchiArbLeg[];
  reason: string;
  cost_buffer_pct: number;
  thresholds: { enter: number; exit: number };
};

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

export async function computeKimchiPremium(): Promise<{
  kimchi_pct: number | null;
  upbit_btc_krw: number | null;
  binance_btc_usdt: number | null;
  usd_krw: number | null;
}> {
  const [upbit, binance, krw, cgBtc] = await Promise.all([
    fetchJson<Array<{ market: string; trade_price: number }>>(
      "https://api.upbit.com/v1/ticker?markets=KRW-BTC",
    ),
    fetchJson<{ symbol: string; price: string }>(
      "https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT",
    ),
    fetchJson<{
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    }>(
      `https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?period1=${Math.floor(Date.now() / 1000) - 86400}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`,
    ),
    fetchCoingeckoBtcUsd(),
  ]);
  const up = upbit?.[0]?.trade_price;
  let bn = binance ? Number(binance.price) : null;
  if (bn == null || !(bn > 0)) bn = cgBtc;
  const fx = krw?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (up == null || bn == null || fx == null || !(up > 0) || !(bn > 0) || !(fx > 0)) {
    return { kimchi_pct: null, upbit_btc_krw: up ?? null, binance_btc_usdt: bn, usd_krw: fx ?? null };
  }
  const fair = bn * fx;
  const kimchi = 100 * (up / fair - 1);
  return {
    kimchi_pct: kimchi,
    upbit_btc_krw: up,
    binance_btc_usdt: bn,
    usd_krw: fx,
  };
}

export async function evaluateKimchiArb(): Promise<KimchiArbSignal> {
  const now = new Date().toISOString();
  const data = await computeKimchiPremium();
  const kimchi = data.kimchi_pct;

  if (kimchi == null) {
    return {
      version: 1,
      generated_at: now,
      kimchi_pct: null,
      net_spread_pct: null,
      upbit_btc_krw: data.upbit_btc_krw,
      binance_btc_usdt: data.binance_btc_usdt,
      usd_krw: data.usd_krw,
      regime: "neutral",
      regime_ko: "데이터 없음",
      arb_action: "unavailable",
      arb_action_ko: "시그널 불가",
      legs: [],
      reason: "Upbit/Binance/환율 데이터 수집 실패",
      cost_buffer_pct: KIMCHI_ARB_COST_PCT,
      thresholds: { enter: KIMCHI_ARB_ENTER_PCT, exit: KIMCHI_ARB_EXIT_PCT },
    };
  }

  const netSpread = kimchi - KIMCHI_ARB_COST_PCT;

  if (kimchi >= KIMCHI_ARB_ENTER_PCT) {
    return {
      version: 1,
      generated_at: now,
      kimchi_pct: kimchi,
      net_spread_pct: netSpread,
      upbit_btc_krw: data.upbit_btc_krw,
      binance_btc_usdt: data.binance_btc_usdt,
      usd_krw: data.usd_krw,
      regime: "premium_high",
      regime_ko: "김프 확대",
      arb_action: "enter_short_kimchi",
      arb_action_ko: "김프 차익 진입 (업비트 매도·바이낸스 매수 헷지)",
      legs: [
        {
          engine: "upbit",
          action: "sell",
          symbol: "KRW-BTC",
          side_ko: "업비트 BTC 매도",
          notional_hint: "보유 BTC 또는 전략 배분 한도",
        },
        {
          engine: "binance",
          action: "buy",
          symbol: "BTCUSDT",
          side_ko: "바이낸스 BTC 롱",
          notional_hint: "동일 BTC 노출 헷지",
        },
      ],
      reason: `김프 ${kimchi.toFixed(2)}% · 순스프레드 ${netSpread.toFixed(2)}% (비용 ${KIMCHI_ARB_COST_PCT}% 반영)`,
      cost_buffer_pct: KIMCHI_ARB_COST_PCT,
      thresholds: { enter: KIMCHI_ARB_ENTER_PCT, exit: KIMCHI_ARB_EXIT_PCT },
    };
  }

  if (kimchi <= KIMCHI_ARB_EXIT_PCT) {
    return {
      version: 1,
      generated_at: now,
      kimchi_pct: kimchi,
      net_spread_pct: netSpread,
      upbit_btc_krw: data.upbit_btc_krw,
      binance_btc_usdt: data.binance_btc_usdt,
      usd_krw: data.usd_krw,
      regime: "premium_low",
      regime_ko: "김프 축소/역프",
      arb_action: "enter_long_kimchi",
      arb_action_ko: "역프·저김프 — 업비트 매수·바이낸스 매도 헷지",
      legs: [
        {
          engine: "upbit",
          action: "buy",
          symbol: "KRW-BTC",
          side_ko: "업비트 BTC 매수",
          notional_hint: "저평가 국내 매수",
        },
        {
          engine: "binance",
          action: "sell",
          symbol: "BTCUSDT",
          side_ko: "바이낸스 BTC 숏/청산",
          notional_hint: "해외 헷지",
        },
      ],
      reason: `김프 ${kimchi.toFixed(2)}% · 역프/저김프 구간`,
      cost_buffer_pct: KIMCHI_ARB_COST_PCT,
      thresholds: { enter: KIMCHI_ARB_ENTER_PCT, exit: KIMCHI_ARB_EXIT_PCT },
    };
  }

  return {
    version: 1,
    generated_at: now,
    kimchi_pct: kimchi,
    net_spread_pct: netSpread,
    upbit_btc_krw: data.upbit_btc_krw,
    binance_btc_usdt: data.binance_btc_usdt,
    usd_krw: data.usd_krw,
    regime: "neutral",
    regime_ko: "중립",
    arb_action: "hold",
    arb_action_ko: "관망",
    legs: [],
    reason: `김프 ${kimchi.toFixed(2)}% — 진입/청산 임계값 사이`,
    cost_buffer_pct: KIMCHI_ARB_COST_PCT,
    thresholds: { enter: KIMCHI_ARB_ENTER_PCT, exit: KIMCHI_ARB_EXIT_PCT },
  };
}

export async function publishKimchiArbSignal(
  signal: KimchiArbSignal,
): Promise<boolean> {
  if (!r2Configured()) return false;
  try {
    await r2PutObject(KIMCHI_ARB_R2_KEY, JSON.stringify(signal), "application/json");
    return true;
  } catch {
    return false;
  }
}

export async function loadKimchiArbSignal(): Promise<KimchiArbSignal | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(KIMCHI_ARB_R2_KEY);
    if (!text) return null;
    return JSON.parse(text) as KimchiArbSignal;
  } catch {
    return null;
  }
}

export async function tickKimchiArb(): Promise<KimchiArbSignal> {
  const signal = await evaluateKimchiArb();
  await publishKimchiArbSignal(signal);
  return signal;
}

/**
 * 김프 차익거래 엔진 — 업비트엔진 + 바이낸스엔진 연동 시그널.
 *
 * 정책:
 * - 숏김프(고김프): 업비트 BTC 재고가 있을 때만 (무보유 매도 금지)
 * - 롱김프(저김프/역프): KRW 여유 시 업비트 매수 + 바이낸스 숏
 * - 청산은 장기 평균(steady) 근처, 최대보유일·추가확대 한도 병행
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import { fetchCoingeckoBtcUsd } from "@/lib/binanceMarketFallback";

export const KIMCHI_ARB_R2_KEY = "challenge/kimchi_arb_latest.json";
export const KIMCHI_INVENTORY_R2_KEY = "challenge/kimchi_inventory_v1.json";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

/** Round-trip cost estimate: Upbit 0.05%×2 + Binance 0.04%×2 + buffer */
export const KIMCHI_ARB_COST_PCT = 0.35;
/** Default enter — study may recommend ≥3% */
export const KIMCHI_ARB_ENTER_PCT = 3.0;
/** Low/reverse threshold for long-kimchi entry */
export const KIMCHI_ARB_EXIT_PCT = 0.5;
/** Long-run steady / short-kimchi unwind target (literature ~1.2%) */
export const KIMCHI_ARB_STEADY_PCT = 1.2;
export const KIMCHI_ARB_MAX_HOLD_DAYS = 14;
export const KIMCHI_ARB_MAX_ADVERSE_PCT = 2.5;
/** Paper/live inventory target in KRW (BTC float for short-kimchi) */
export const KIMCHI_INVENTORY_TARGET_KRW = 700_000;

export type KimchiArbLeg = {
  engine: "upbit" | "binance";
  action: "buy" | "sell";
  symbol: string;
  side_ko: string;
  notional_hint: string;
};

export type KimchiInventoryState = {
  version: 1;
  /** Simulated Upbit BTC qty reserved for kimchi arb (paper) */
  paper_btc_qty: number;
  paper_btc_avg_krw: number | null;
  target_krw: number;
  updated_at: string;
  note: string;
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
  arb_action:
    | "enter_short_kimchi"
    | "enter_long_kimchi"
    | "hold"
    | "unavailable"
    | "blocked_no_inventory";
  arb_action_ko: string;
  legs: KimchiArbLeg[];
  reason: string;
  cost_buffer_pct: number;
  thresholds: {
    enter: number;
    exit_low: number;
    steady: number;
    max_hold_days: number;
    max_adverse_pct: number;
  };
  inventory: {
    paper_btc_qty: number;
    paper_value_krw: number | null;
    target_krw: number;
    short_kimchi_allowed: boolean;
    policy_ko: string;
  };
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

export function defaultKimchiInventory(): KimchiInventoryState {
  return {
    version: 1,
    paper_btc_qty: 0,
    paper_btc_avg_krw: null,
    target_krw: KIMCHI_INVENTORY_TARGET_KRW,
    updated_at: new Date().toISOString(),
    note: "페이퍼 인벤토리 — 저김프 시 목표 금액만큼 BTC 적립, 고김프 숏김프에만 사용",
  };
}

export async function loadKimchiInventory(): Promise<KimchiInventoryState> {
  if (!r2Configured()) return defaultKimchiInventory();
  try {
    const text = await r2GetObjectText(KIMCHI_INVENTORY_R2_KEY);
    if (!text) return defaultKimchiInventory();
    const data = JSON.parse(text) as KimchiInventoryState;
    if (data?.version !== 1) return defaultKimchiInventory();
    return data;
  } catch {
    return defaultKimchiInventory();
  }
}

export async function persistKimchiInventory(
  state: KimchiInventoryState,
): Promise<boolean> {
  if (!r2Configured()) return false;
  try {
    await r2PutObject(
      KIMCHI_INVENTORY_R2_KEY,
      JSON.stringify(state),
      "application/json",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Paper inventory maintenance:
 * - low kimchi + below target → buy BTC toward target (sim)
 * - short-kimchi enter → reduce inventory (sim)
 */
export async function maintainPaperInventory(
  signal: KimchiArbSignal,
): Promise<KimchiInventoryState> {
  let inv = await loadKimchiInventory();
  const px = signal.upbit_btc_krw;
  if (px == null || !(px > 0)) return inv;

  const value = inv.paper_btc_qty * px;
  const target = inv.target_krw || KIMCHI_INVENTORY_TARGET_KRW;

  // Build inventory on low/neutral below target
  if (
    signal.arb_action === "enter_long_kimchi" ||
    (signal.regime === "neutral" && value < target * 0.9)
  ) {
    const needKrw = Math.max(0, target - value);
    if (needKrw >= 5000) {
      const buyQty = needKrw / px;
      const newQty = inv.paper_btc_qty + buyQty;
      const avg =
        newQty > 0
          ? ((inv.paper_btc_avg_krw ?? px) * inv.paper_btc_qty + px * buyQty) /
            newQty
          : px;
      inv = {
        ...inv,
        paper_btc_qty: newQty,
        paper_btc_avg_krw: avg,
        updated_at: new Date().toISOString(),
      };
    }
  }

  // Consume inventory on short-kimchi (paper)
  if (signal.arb_action === "enter_short_kimchi" && inv.paper_btc_qty > 0) {
    const maxQty = target / px;
    const sellQty = Math.min(inv.paper_btc_qty, maxQty);
    inv = {
      ...inv,
      paper_btc_qty: Math.max(0, inv.paper_btc_qty - sellQty),
      updated_at: new Date().toISOString(),
    };
  }

  await persistKimchiInventory(inv);
  return inv;
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
    return {
      kimchi_pct: null,
      upbit_btc_krw: up ?? null,
      binance_btc_usdt: bn,
      usd_krw: fx ?? null,
    };
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

function thresholds() {
  return {
    enter: KIMCHI_ARB_ENTER_PCT,
    exit_low: KIMCHI_ARB_EXIT_PCT,
    steady: KIMCHI_ARB_STEADY_PCT,
    max_hold_days: KIMCHI_ARB_MAX_HOLD_DAYS,
    max_adverse_pct: KIMCHI_ARB_MAX_ADVERSE_PCT,
  };
}

export async function evaluateKimchiArb(): Promise<KimchiArbSignal> {
  const now = new Date().toISOString();
  const data = await computeKimchiPremium();
  const kimchi = data.kimchi_pct;
  const inv = await loadKimchiInventory();
  const px = data.upbit_btc_krw;
  const invValue = px != null && px > 0 ? inv.paper_btc_qty * px : null;
  const shortAllowed = inv.paper_btc_qty > 0.0001;
  const invBlock = {
    paper_btc_qty: inv.paper_btc_qty,
    paper_value_krw: invValue,
    target_krw: inv.target_krw,
    short_kimchi_allowed: shortAllowed,
    policy_ko: shortAllowed
      ? `인벤토리 ${(invValue ?? 0).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원 — 숏김프 가능`
      : "업비트 BTC 재고 없음 — 숏김프(고김프 매도) 금지 · 저김프 시 인벤토리 적립",
  };

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
      thresholds: thresholds(),
      inventory: invBlock,
    };
  }

  const netSpread = kimchi - KIMCHI_ARB_COST_PCT;
  const th = thresholds();

  if (kimchi >= th.enter) {
    if (!shortAllowed) {
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
        arb_action: "blocked_no_inventory",
        arb_action_ko: "숏김프 차단 (BTC 재고 없음)",
        legs: [],
        reason:
          `김프 ${kimchi.toFixed(2)}%이나 업비트 BTC 미보유 — 매도 불가. ` +
          `저김프 구간에 인벤토리(목표 ${th.enter}% 진입용 ${KIMCHI_INVENTORY_TARGET_KRW.toLocaleString("ko-KR")}원)를 먼저 확보`,
        cost_buffer_pct: KIMCHI_ARB_COST_PCT,
        thresholds: th,
        inventory: invBlock,
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
      regime: "premium_high",
      regime_ko: "김프 확대",
      arb_action: "enter_short_kimchi",
      arb_action_ko: "김프 차익 진입 (업비트 매도·바이낸스 롱 헷지)",
      legs: [
        {
          engine: "upbit",
          action: "sell",
          symbol: "KRW-BTC",
          side_ko: "업비트 BTC 매도(인벤토리)",
          notional_hint: "보유 BTC 한도 내",
        },
        {
          engine: "binance",
          action: "buy",
          symbol: "BTCUSDT",
          side_ko: "바이낸스 BTC 롱",
          notional_hint: "동일 BTC 노출 헷지",
        },
      ],
      reason:
        `김프 ${kimchi.toFixed(2)}% · 순스프레드 ${netSpread.toFixed(2)}% · ` +
        `청산목표 ~${th.steady}% · 최대보유 ${th.max_hold_days}일 · 추가확대한도 ${th.max_adverse_pct}%p`,
      cost_buffer_pct: KIMCHI_ARB_COST_PCT,
      thresholds: th,
      inventory: invBlock,
    };
  }

  if (kimchi <= th.exit_low) {
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
      arb_action_ko: "역프·저김프 — 업비트 매수·바이낸스 숏 (+인벤토리 적립)",
      legs: [
        {
          engine: "upbit",
          action: "buy",
          symbol: "KRW-BTC",
          side_ko: "업비트 BTC 매수",
          notional_hint: "저평가 매수·인벤토리 확보",
        },
        {
          engine: "binance",
          action: "sell",
          symbol: "BTCUSDT",
          side_ko: "바이낸스 BTC 숏",
          notional_hint: "해외 헷지",
        },
      ],
      reason: `김프 ${kimchi.toFixed(2)}% · 역프/저김프 · 인벤토리 목표 ${KIMCHI_INVENTORY_TARGET_KRW.toLocaleString("ko-KR")}원`,
      cost_buffer_pct: KIMCHI_ARB_COST_PCT,
      thresholds: th,
      inventory: invBlock,
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
    reason:
      `김프 ${kimchi.toFixed(2)}% — 진입(${th.enter}%)/저김프(${th.exit_low}%) 사이 · ` +
      `단기 랜덤워크 구간(스터디·문헌)`,
    cost_buffer_pct: KIMCHI_ARB_COST_PCT,
    thresholds: th,
    inventory: invBlock,
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
  await maintainPaperInventory(signal);
  // Refresh inventory fields after maintenance
  const inv = await loadKimchiInventory();
  const px = signal.upbit_btc_krw;
  const invValue = px != null && px > 0 ? inv.paper_btc_qty * px : null;
  const shortAllowed = inv.paper_btc_qty > 0.0001;
  const enriched: KimchiArbSignal = {
    ...signal,
    inventory: {
      paper_btc_qty: inv.paper_btc_qty,
      paper_value_krw: invValue,
      target_krw: inv.target_krw,
      short_kimchi_allowed: shortAllowed,
      policy_ko: shortAllowed
        ? `인벤토리 ${(invValue ?? 0).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원 — 숏김프 가능`
        : "업비트 BTC 재고 없음 — 숏김프 금지 · 저김프 시 적립",
    },
  };
  await publishKimchiArbSignal(enriched);
  return enriched;
}

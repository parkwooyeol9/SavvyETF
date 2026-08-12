/**
 * Precious metals (gold + silver) day-trend timing guide.
 *
 * Assumptions (education / rule engine — not advice):
 * - Instruments: GC/MGC (gold) and SI/SIL (silver) futures
 * - Long leverage up to +10x on strong buy
 * - Short / inverse down to −10x on strong sell
 *
 * Shared macro: FRED 10Y real yield + DXY + USD/KRW
 * Per-metal: OHLC structure, ATR, CFTC Managed Money proxy
 */

import { CFTC_MARKET_SPECS } from "@/lib/cftc";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export const PRECIOUS_METALS_NOTE =
  "교육용 룰 엔진 · 투자 자문 아님 · 금·은 선물 가정(롱 최대 +10배 · 숏/인버스 최대 −10배) · " +
  "RSI 과매수 단독 매도 없음 · 일봉 추세 + 실질금리 + DXY + 손절/손익비 + 원/달러";

export const PRECIOUS_METALS_SCHEDULE =
  "페이지 로드 시 계산 · FRED·Yahoo·CFTC 공개 소스 · ETF 실물 보유량은 MM 대용";

export type MetalId = "gold" | "silver";

export type RuleStatus = "pass" | "fail" | "neutral" | "unavailable";

export type RuleEval = {
  id: string;
  kind: "buy" | "sell" | "tactic";
  label: string;
  detail: string;
  status: RuleStatus;
  weight: number;
};

export type MetalCandle = {
  date: string;
  close: number;
  high: number;
  low: number;
  sma20: number | null;
  sma50: number | null;
  atr14: number | null;
};

export type SignalStrength =
  | "strong_buy"
  | "buy"
  | "neutral"
  | "sell"
  | "strong_sell";

export type LeverageGuide = {
  /** Suggested signed leverage −10 … +10 (0 = flat) */
  suggested: number;
  min: number;
  max: number;
  direction: "long" | "short" | "flat";
  strength: SignalStrength;
  strength_ko: string;
  title: string;
  summary: string;
  instruments: string[];
  risk_caps: string[];
};

export type PositionPreset = {
  id: string;
  metal: MetalId;
  label: string;
  multiplier: number;
  unit: string;
  note: string;
};

export type MetalPlaybook = {
  action: "buy" | "hold" | "sell";
  action_ko: string;
  score: number;
  buy_hits: number;
  buy_needed: number;
  sell_hits: number;
  title: string;
  summary: string;
  entry: string;
  stop: string;
  targets: string[];
  invalidation: string;
  risk_notes: string[];
  suggested_stop: number | null;
  suggested_target: number | null;
  risk_per_unit: number | null;
  reward_per_unit: number | null;
  rr: number | null;
  leverage: LeverageGuide;
};

export type MetalSnapshot = {
  id: MetalId;
  label: string;
  yahoo: string;
  price: number | null;
  as_of: string | null;
  sma20: number | null;
  sma50: number | null;
  atr14: number | null;
  atr_pct: number | null;
  swing_low: number | null;
  swing_high: number | null;
  prior_20d_high: number | null;
  mm_net: number | null;
  mm_chg: number | null;
  mm_as_of: string | null;
  chg_5d_pct: number | null;
};

export type MetalPanel = {
  id: MetalId;
  label: string;
  yahoo: string;
  snapshot: MetalSnapshot;
  buy_rules: RuleEval[];
  sell_rules: RuleEval[];
  tactics: RuleEval[];
  playbook: MetalPlaybook;
  chart: MetalCandle[];
  position_presets: PositionPreset[];
};

export type SharedMacro = {
  real_yield: number | null;
  real_yield_as_of: string | null;
  real_yield_chg_5d: number | null;
  real_yield_chg_10d: number | null;
  real_yield_source: string;
  dxy: number | null;
  dxy_sma20: number | null;
  dxy_as_of: string | null;
  dxy_chg_5d: number | null;
  usdkrw: number | null;
  usdkrw_as_of: string | null;
  usdkrw_chg_5d_pct: number | null;
  gold_silver_ratio: number | null;
};

export type PreciousMetalsPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  schedule_note: string;
  note: string;
  feasibility: {
    verdict: string;
    ready: string[];
    deferred: string[];
    rejected: string[];
  };
  macro: SharedMacro;
  metals: MetalPanel[];
  focus_default: MetalId;
  krw_framing: {
    usdkrw: number | null;
    gold_usd: number | null;
    silver_usd: number | null;
    gold_krw_oz: number | null;
    silver_krw_oz: number | null;
    note: string;
  };
  event_risk: {
    is_friday: boolean;
    note: string;
  };
  leverage_policy: {
    max_long: number;
    max_short: number;
    note: string;
  };
  error?: string;
};

type OhlcBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

const METAL_SPECS: Array<{
  id: MetalId;
  label: string;
  yahoo: string;
  cftcId: "gold" | "silver";
  /** Silver is typically more volatile → tighter leverage ceiling for same signal */
  leverage_scale: number;
  presets: PositionPreset[];
}> = [
  {
    id: "gold",
    label: "금 (Gold)",
    yahoo: "GC=F",
    cftcId: "gold",
    leverage_scale: 1,
    presets: [
      {
        id: "mgc",
        metal: "gold",
        label: "Micro Gold (MGC)",
        multiplier: 10,
        unit: "oz/계약",
        note: "$1/oz → 계약당 $10. 레버리지 시에도 초보 권장.",
      },
      {
        id: "gc",
        metal: "gold",
        label: "Gold (GC)",
        multiplier: 100,
        unit: "oz/계약",
        note: "$1/oz → 계약당 $100. 고배율과 병행 시 손실이 급증합니다.",
      },
    ],
  },
  {
    id: "silver",
    label: "은 (Silver)",
    yahoo: "SI=F",
    cftcId: "silver",
    leverage_scale: 0.7,
    presets: [
      {
        id: "sil",
        metal: "silver",
        label: "Micro Silver (SIL)",
        multiplier: 1000,
        unit: "oz/계약",
        note: "$1/oz → 계약당 $1,000. 은은 변동성이 커 배율을 낮게 잡으세요.",
      },
      {
        id: "si",
        metal: "silver",
        label: "Silver (SI)",
        multiplier: 5000,
        unit: "oz/계약",
        note: "$1/oz → 계약당 $5,000. 고배율·표준 SI 병행은 위험합니다.",
      },
    ],
  },
];

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

function smaAt(values: number[], i: number, window: number): number | null {
  if (i + 1 < window) return null;
  let sum = 0;
  for (let j = i - window + 1; j <= i; j++) sum += values[j]!;
  return sum / window;
}

function atrSeries(bars: OhlcBar[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(bars.length).fill(null);
  if (bars.length < 2) return out;
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    if (i === 0) {
      tr.push(h - l);
      continue;
    }
    const prevClose = bars[i - 1]!.close;
    tr.push(Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose)));
  }
  for (let i = 0; i < bars.length; i++) {
    if (i + 1 < period) continue;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tr[j]!;
    out[i] = sum / period;
  }
  return out;
}

function changeOver(
  series: Array<{ date: string; value: number }>,
  lookback: number,
): number | null {
  if (series.length < lookback + 1) return null;
  return (
    series[series.length - 1]!.value - series[series.length - 1 - lookback]!.value
  );
}

function pctChangeOver(
  series: Array<{ date: string; value: number }>,
  lookback: number,
): number | null {
  if (series.length < lookback + 1) return null;
  const last = series[series.length - 1]!.value;
  const prev = series[series.length - 1 - lookback]!.value;
  if (!(prev > 0)) return null;
  return (100 * (last - prev)) / prev;
}

function fmtPx(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(digits, 2),
  });
}

function fmtChg(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

async function fetchYahooOhlc(
  symbol: string,
  lookbackDays = 400,
): Promise<OhlcBar[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - lookbackDays * 86400;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
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
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0];
  const out: OhlcBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const open = q?.open?.[i];
    const high = q?.high?.[i];
    const low = q?.low?.[i];
    const close = q?.close?.[i];
    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      !(close > 0)
    ) {
      continue;
    }
    out.push({
      date: new Date(ts[i]! * 1000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
    });
  }
  return out;
}

async function fetchFredSeries(
  seriesId: string,
  lookbackDays = 400,
): Promise<Array<{ date: string; value: number }>> {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);
  const url =
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}` +
    `&cosd=${start.toISOString().slice(0, 10)}&coed=${end.toISOString().slice(0, 10)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/csv" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const out: Array<{ date: string; value: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    const raw = line.slice(comma + 1).trim();
    if (!date || raw === "." || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

function subtractSeries(
  a: Array<{ date: string; value: number }>,
  b: Array<{ date: string; value: number }>,
): Array<{ date: string; value: number }> {
  const mapB = new Map(b.map((p) => [p.date, p.value]));
  const out: Array<{ date: string; value: number }> = [];
  for (const p of a) {
    const bv = mapB.get(p.date);
    if (bv == null) continue;
    out.push({ date: p.date, value: p.value - bv });
  }
  return out;
}

async function fetchMmSnapshot(cftcId: "gold" | "silver"): Promise<{
  net: number | null;
  chg: number | null;
  as_of: string | null;
}> {
  const spec = CFTC_MARKET_SPECS.find((s) => s.id === cftcId);
  if (!spec) return { net: null, chg: null, as_of: null };
  try {
    const url =
      "https://publicreporting.cftc.gov/resource/72hh-3qpy.json?" +
      new URLSearchParams({
        $where: `market_and_exchange_names='${spec.market_name.replace(/'/g, "''")}'`,
        $order: "report_date_as_yyyy_mm_dd DESC",
        $limit: "8",
      }).toString();
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { net: null, chg: null, as_of: null };
    const rows = (await res.json()) as Array<{
      report_date_as_yyyy_mm_dd?: string;
      m_money_positions_long_all?: string | number;
      m_money_positions_short_all?: string | number;
    }>;
    const parsed = rows
      .map((r) => {
        const date = (r.report_date_as_yyyy_mm_dd || "").slice(0, 10);
        const long = Number(r.m_money_positions_long_all);
        const short = Number(r.m_money_positions_short_all);
        if (!date || !Number.isFinite(long) || !Number.isFinite(short)) return null;
        return { date, net: long - short };
      })
      .filter((x): x is { date: string; net: number } => !!x);
    if (!parsed.length) return { net: null, chg: null, as_of: null };
    const latest = parsed[0]!;
    const prev = parsed[1];
    return {
      net: latest.net,
      chg: prev ? latest.net - prev.net : null,
      as_of: latest.date,
    };
  } catch {
    return { net: null, chg: null, as_of: null };
  }
}

function buildBuyRules(input: {
  close: number | null;
  sma20: number | null;
  sma20Prev5: number | null;
  sma50: number | null;
  realChg5: number | null;
  realChg10: number | null;
  dxy: number | null;
  dxySma20: number | null;
  mmChg: number | null;
  broke20High: boolean | null;
  pullbackHeld: boolean | null;
}): RuleEval[] {
  const {
    close,
    sma20,
    sma20Prev5,
    sma50,
    realChg5,
    realChg10,
    dxy,
    dxySma20,
    mmChg,
    broke20High,
    pullbackHeld,
  } = input;
  const sma20Rising =
    sma20 != null && sma20Prev5 != null ? sma20 > sma20Prev5 : null;
  const realEasing =
    realChg5 != null || realChg10 != null
      ? (realChg5 != null && realChg5 < 0) || (realChg10 != null && realChg10 < 0)
      : null;
  const dxyBelow = dxy != null && dxySma20 != null ? dxy < dxySma20 : null;

  return [
    {
      id: "close_above_sma50",
      kind: "buy",
      label: "일봉 종가 > 50일 이동평균",
      detail:
        close != null && sma50 != null
          ? `종가 ${fmtPx(close)} / SMA50 ${fmtPx(sma50)}`
          : "가격·SMA50 부족",
      status:
        close == null || sma50 == null
          ? "unavailable"
          : close > sma50
            ? "pass"
            : "fail",
      weight: 1,
    },
    {
      id: "sma20_rising",
      kind: "buy",
      label: "20일 이동평균 상승 중",
      detail:
        sma20 != null && sma20Prev5 != null
          ? `SMA20 ${fmtPx(sma20)} vs 5거래일 전 ${fmtPx(sma20Prev5)}`
          : "SMA20 히스토리 부족",
      status:
        sma20Rising == null ? "unavailable" : sma20Rising ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "real_yield_easing",
      kind: "buy",
      label: "미국 10년 실질금리 최근 5~10거래일 하락",
      detail:
        realChg5 != null || realChg10 != null
          ? `5일 ${fmtChg(realChg5)}%p · 10일 ${fmtChg(realChg10)}%p`
          : "실질금리 시계열 없음",
      status:
        realEasing == null ? "unavailable" : realEasing ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "dxy_below_sma20",
      kind: "buy",
      label: "DXY가 20일 이동평균 아래",
      detail:
        dxy != null && dxySma20 != null
          ? `DXY ${fmtPx(dxy)} / SMA20 ${fmtPx(dxySma20)}`
          : "DXY 부족",
      status: dxyBelow == null ? "unavailable" : dxyBelow ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "demand_proxy",
      kind: "buy",
      label: "투기 수요 증가 (CFTC MM 대용)",
      detail:
        mmChg != null
          ? `Managed Money 순매수 WoW ${fmtChg(mmChg, 0)}계약`
          : "MM 데이터 없음",
      status: mmChg == null ? "unavailable" : mmChg > 0 ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "breakout_close",
      kind: "buy",
      label: "직전 20일 고점 돌파 후 그 위 종가",
      detail:
        broke20High == null
          ? "고점 데이터 부족"
          : broke20High
            ? "20일 최고가 종가 돌파"
            : "20일 고점 미돌파",
      status:
        broke20High == null ? "unavailable" : broke20High ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "pullback_hold",
      kind: "buy",
      label: "조정 시 이전 저점 또는 20일선 유지",
      detail:
        pullbackHeld == null
          ? "스윙/이평 부족"
          : pullbackHeld
            ? "지지 유지"
            : "지지 약화",
      status:
        pullbackHeld == null ? "unavailable" : pullbackHeld ? "pass" : "fail",
      weight: 1,
    },
  ];
}

function buildSellRules(input: {
  close: number | null;
  sma20: number | null;
  sma20Prev5: number | null;
  sma50: number | null;
  swingLow: number | null;
  realChg5: number | null;
  dxy: number | null;
  dxySma20: number | null;
  dxyPrev5: number | null;
}): RuleEval[] {
  const {
    close,
    sma20,
    sma20Prev5,
    sma50,
    swingLow,
    realChg5,
    dxy,
    dxySma20,
    dxyPrev5,
  } = input;
  const belowSwing =
    close != null && swingLow != null ? close < swingLow : null;
  const sma20Falling =
    sma20 != null && sma20Prev5 != null ? sma20 < sma20Prev5 : null;
  const belowSma50 = close != null && sma50 != null ? close < sma50 : null;
  const dualMaWeak =
    sma20Falling != null && belowSma50 != null
      ? sma20Falling && belowSma50
      : null;
  const dxyRising = dxy != null && dxyPrev5 != null ? dxy > dxyPrev5 : null;
  const dxyAboveSma =
    dxy != null && dxySma20 != null ? dxy > dxySma20 : null;
  const yieldAndDollar =
    realChg5 != null && dxyRising != null && dxyAboveSma != null
      ? realChg5 > 0.05 && dxyRising && dxyAboveSma
      : null;

  return [
    {
      id: "close_below_swing_low",
      kind: "sell",
      label: "일봉이 직전 중요 저점 아래 마감",
      detail:
        close != null && swingLow != null
          ? `종가 ${fmtPx(close)} / 스윙저점 ${fmtPx(swingLow)}`
          : "스윙 저점 부족",
      status:
        belowSwing == null ? "unavailable" : belowSwing ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "sma20_down_and_sma50_break",
      kind: "sell",
      label: "20일선 하락 전환 + 50일선 이탈",
      detail:
        sma20 != null && sma50 != null
          ? `SMA20 ${fmtPx(sma20)} · SMA50 ${fmtPx(sma50)} · 종가 ${fmtPx(close)}`
          : "이평 부족",
      status: dualMaWeak == null ? "unavailable" : dualMaWeak ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "yield_and_dxy_rising",
      kind: "sell",
      label: "실질금리·DXY 동시 강세",
      detail:
        realChg5 != null
          ? `실질금리 5일 ${fmtChg(realChg5)}%p · DXY ${fmtPx(dxy)}`
          : "금리/달러 부족",
      status:
        yieldAndDollar == null
          ? "unavailable"
          : yieldAndDollar
            ? "pass"
            : "fail",
      weight: 1,
    },
    {
      id: "news_failed_breakout",
      kind: "sell",
      label: "호재에도 전고점 미돌파 (수동)",
      detail: "뉴스·이벤트는 자동화하지 않음 — 전고점과 함께 수동 점검",
      status: "unavailable",
      weight: 0,
    },
    {
      id: "stop_or_rr",
      kind: "sell",
      label: "손절 도달 / 목표 ≥ 2R",
      detail: "포지션 계산기·플레이북 손절·목표 참고",
      status: "neutral",
      weight: 0,
    },
  ];
}

function buildTactics(input: {
  close: number | null;
  sma50: number | null;
  broke20High: boolean | null;
  atr: number | null;
  isFriday: boolean;
  metalLabel: string;
}): RuleEval[] {
  const { close, sma50, broke20High, atr, isFriday, metalLabel } = input;
  const aboveSma50 =
    close != null && sma50 != null ? close > sma50 : null;
  return [
    {
      id: "only_long_above_sma50",
      kind: "tactic",
      label: `${metalLabel} 일봉이 50일선 위일 때만 롱`,
      detail:
        aboveSma50 == null
          ? "데이터 부족"
          : aboveSma50
            ? "추세 필터 통과"
            : "50일선 아래 — 신규 롱·레버리지 롱 보류",
      status:
        aboveSma50 == null ? "unavailable" : aboveSma50 ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "breakout_candidate",
      kind: "tactic",
      label: "20일 최고가 종가 돌파 = 진입 후보",
      detail:
        broke20High == null
          ? "데이터 부족"
          : broke20High
            ? "돌파 확인 — 다음날 추격보다 되돌림 대기"
            : "돌파 미확인",
      status:
        broke20High == null ? "unavailable" : broke20High ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "wait_pullback",
      kind: "tactic",
      label: "돌파 다음날 추격 금지 · 되돌림 대기",
      detail: "고점 추격보다 돌파 → 되돌림 → 지지 확인 후 진입",
      status: "neutral",
      weight: 0,
    },
    {
      id: "atr_stop",
      kind: "tactic",
      label: "손절 = 스윙저점 또는 진입가 − 1.5~2 ATR",
      detail:
        atr != null
          ? `ATR(14)=${fmtPx(atr)} · 1.5ATR=${fmtPx(atr * 1.5)} · 2ATR=${fmtPx(atr * 2)}`
          : "ATR 부족",
      status: atr != null ? "pass" : "unavailable",
      weight: 1,
    },
    {
      id: "risk_budget",
      kind: "tactic",
      label: "1회 최대 손실 = 자금의 0.5~1% (레버리지 포함)",
      detail: "배율이 커도 계좌 위험금액은 동일하게 유지 — 수량으로 조절",
      status: "neutral",
      weight: 0,
    },
    {
      id: "min_rr",
      kind: "tactic",
      label: "손익비 최소 1:2 · 미달 시 미진입",
      detail: "고배율일수록 RR 미달 진입을 더 엄격히 금지",
      status: "neutral",
      weight: 0,
    },
    {
      id: "leverage_cap",
      kind: "tactic",
      label: "레버리지 상한 +10 / 인버스·숏 −10",
      detail: "강한 신호에서만 고배율 · 금요일·지표 발표 직전 배율 축소",
      status: "neutral",
      weight: 0,
    },
    {
      id: "friday_gap",
      kind: "tactic",
      label: "금요일 주말 갭 — 포지션·배율 축소",
      detail: isFriday
        ? "오늘(UTC) 금요일 — 고배율 롱/숏 축소 권장"
        : "금요일 아님 — 주말 갭 규칙 대기",
      status: isFriday ? "pass" : "neutral",
      weight: 0,
    },
  ];
}

function buildLeverageGuide(input: {
  buyHits: number;
  sellHits: number;
  aboveSma50: boolean;
  belowSma50: boolean;
  rr: number | null;
  atrPct: number | null;
  leverageScale: number;
  isFriday: boolean;
  metalId: MetalId;
  metalLabel: string;
}): LeverageGuide {
  const {
    buyHits,
    sellHits,
    aboveSma50,
    belowSma50,
    rr,
    atrPct,
    leverageScale,
    isFriday,
    metalId,
    metalLabel,
  } = input;

  const instruments =
    metalId === "gold"
      ? [
          "GC / MGC 선물 롱 (최대 +10배 가정)",
          "인버스·숏 상품 (최대 −10배 가정)",
        ]
      : [
          "SI / SIL 선물 롱 (최대 +10배 가정)",
          "은 인버스·숏 상품 (최대 −10배 가정)",
        ];

  const risk_caps: string[] = [
    "계좌 1회 손실 한도(0.5~1%)를 배율과 무관하게 지킵니다.",
    "ATR%가 높을수록 동일 신호라도 배율을 낮춥니다.",
  ];
  if (isFriday) risk_caps.push("금요일 — 배율 상한을 절반으로 축소합니다.");
  if (rr != null && rr < 2) {
    risk_caps.push("추정 RR < 2 — 신규 레버리지·숏 진입 보류.");
  }

  // Volatility haircut: if ATR% > 2%, scale down further
  let volScale = leverageScale;
  if (atrPct != null && atrPct > 2.5) volScale *= 0.55;
  else if (atrPct != null && atrPct > 1.5) volScale *= 0.75;
  if (isFriday) volScale *= 0.5;

  const clampLev = (n: number) =>
    Math.max(-10, Math.min(10, Math.round(n * 2) / 2));

  let strength: SignalStrength = "neutral";
  let suggested = 0;
  let min = 0;
  let max = 0;
  let direction: LeverageGuide["direction"] = "flat";
  let title = "관망 · 배율 0";
  let summary = `${metalLabel}: 뚜렷한 강/약세 신호가 없어 레버리지·공매도를 보류합니다.`;

  const strongBuy =
    buyHits >= 5 && aboveSma50 && (rr == null || rr >= 1.8) && sellHits === 0;
  const mildBuy = buyHits >= 3 && aboveSma50 && sellHits === 0;
  const strongSell =
    sellHits >= 2 && belowSma50 && buyHits <= 2;
  const mildSell = sellHits >= 1 && (belowSma50 || buyHits < 3);

  if (strongBuy) {
    strength = "strong_buy";
    direction = "long";
    min = clampLev(3 * volScale);
    max = clampLev(10 * volScale);
    suggested = clampLev(Math.min(max, Math.max(min, 6 * volScale)));
    title = `강한 매수 · 레버리지 롱 검토 (≈${suggested}×)`;
    summary = `${metalLabel} 매수 조건 ${buyHits}/7 + 50일선 위. 되돌림 확인 후 +${min}~+${max}배 롱(상한 +10). 추격 진입 금지.`;
  } else if (mildBuy) {
    strength = "buy";
    direction = "long";
    min = clampLev(1 * volScale);
    max = clampLev(3 * volScale);
    suggested = clampLev(Math.min(max, Math.max(min, 2 * volScale)));
    title = `매수 검토 · 저배율 롱 (≈${suggested}×)`;
    summary = `${metalLabel} 매수 ${buyHits}/7. 현물~저배율(+${min}~+${max})만 검토. 고배율은 신호 강화 후.`;
  } else if (strongSell) {
    strength = "strong_sell";
    direction = "short";
    min = clampLev(-10 * volScale);
    max = clampLev(-3 * volScale);
    suggested = clampLev(Math.max(min, Math.min(max, -6 * volScale)));
    title = `강한 매도 · 공매도/인버스 검토 (≈${suggested}×)`;
    summary = `${metalLabel} 매도 룰 ${sellHits}개 + 50일선 이탈. −${Math.abs(max)}~−${Math.abs(min)}배 숏/인버스(하한 −10). 반등 매도·분할.`;
  } else if (mildSell) {
    strength = "sell";
    direction = "short";
    min = clampLev(-3 * volScale);
    max = clampLev(-1 * volScale);
    suggested = clampLev(Math.max(min, Math.min(max, -2 * volScale)));
    title = `청산·약한 숏 검토 (≈${suggested}×)`;
    summary = `${metalLabel} 약세 신호. 롱 축소 우선, 숏/인버스는 −${Math.abs(max)}~−${Math.abs(min)}배로 제한.`;
  }

  // RR gate: never suggest high leverage if RR poor
  if (rr != null && rr < 2 && Math.abs(suggested) >= 3) {
    suggested = clampLev(suggested > 0 ? 1 : suggested < 0 ? -1 : 0);
    max = suggested > 0 ? Math.max(suggested, 2) : max;
    min = suggested < 0 ? Math.min(suggested, -2) : min;
    risk_caps.push("RR 미달로 고배율을 저배율로 하향했습니다.");
  }

  const strength_ko =
    strength === "strong_buy"
      ? "강한 매수"
      : strength === "buy"
        ? "매수"
        : strength === "strong_sell"
          ? "강한 매도"
          : strength === "sell"
            ? "매도"
            : "중립";

  return {
    suggested,
    min,
    max,
    direction,
    strength,
    strength_ko,
    title,
    summary,
    instruments,
    risk_caps: risk_caps.slice(0, 5),
  };
}

function buildPlaybook(input: {
  buyRules: RuleEval[];
  sellRules: RuleEval[];
  close: number | null;
  sma20: number | null;
  sma50: number | null;
  atr: number | null;
  atrPct: number | null;
  swingLow: number | null;
  swingHigh: number | null;
  prior20High: number | null;
  usdkrwChg5: number | null;
  isFriday: boolean;
  leverageScale: number;
  metalId: MetalId;
  metalLabel: string;
}): MetalPlaybook {
  const buyNeeded = 3;
  const buyHits = input.buyRules.filter((r) => r.status === "pass").length;
  const sellHits = input.sellRules.filter(
    (r) => r.status === "pass" && r.weight > 0,
  ).length;
  const aboveSma50 =
    input.close != null && input.sma50 != null && input.close > input.sma50;
  const belowSma50 =
    input.close != null && input.sma50 != null && input.close < input.sma50;

  let action: MetalPlaybook["action"] = "hold";
  if (sellHits >= 2 || (sellHits >= 1 && buyHits < 2)) action = "sell";
  else if (buyHits >= buyNeeded && aboveSma50) action = "buy";

  const stopFromSwing = input.swingLow;
  const stopFromAtr =
    input.close != null && input.atr != null
      ? input.close - 1.75 * input.atr
      : null;
  const suggestedStop =
    stopFromSwing != null && stopFromAtr != null
      ? Math.min(stopFromSwing, stopFromAtr)
      : (stopFromSwing ?? stopFromAtr);

  // For shorts, mirror stop above
  const shortStop =
    input.close != null && input.atr != null
      ? input.close + 1.75 * input.atr
      : input.swingHigh;

  const longTarget =
    input.close != null && suggestedStop != null
      ? input.close + 2 * Math.max(input.close - suggestedStop, 0)
      : input.swingHigh;
  const shortTarget =
    input.close != null && shortStop != null
      ? input.close - 2 * Math.max(shortStop - input.close, 0)
      : input.swingLow;

  const useShort = action === "sell";
  const activeStop = useShort ? shortStop : suggestedStop;
  const activeTarget = useShort ? shortTarget : longTarget;

  const risk =
    input.close != null && activeStop != null
      ? Math.abs(input.close - activeStop)
      : null;
  const reward =
    input.close != null && activeTarget != null
      ? Math.abs(activeTarget - input.close)
      : null;
  const rr =
    risk != null && reward != null && risk > 0 ? reward / risk : null;

  const leverage = buildLeverageGuide({
    buyHits,
    sellHits,
    aboveSma50,
    belowSma50,
    rr,
    atrPct: input.atrPct,
    leverageScale: input.leverageScale,
    isFriday: input.isFriday,
    metalId: input.metalId,
    metalLabel: input.metalLabel,
  });

  const risk_notes: string[] = [
    "룰 기반 교육용 시나리오입니다. 투자 자문·매매 권유가 아닙니다.",
    "레버리지·공매도·인버스는 손실이 원금을 초과할 수 있습니다. 상한 ±10배는 가정일 뿐입니다.",
    "RSI 과매수 단독 매도는 사용하지 않습니다.",
  ];
  if (input.isFriday) {
    risk_notes.push("금요일 — 주말 갭으로 고배율 롱/숏을 축소하세요.");
  }
  if (input.usdkrwChg5 != null && Math.abs(input.usdkrwChg5) >= 1) {
    risk_notes.push(
      `원/달러 5일 ${fmtChg(input.usdkrwChg5, 1)}% — 달러 귀금속과 원화 상품을 분리 판단하세요.`,
    );
  }
  if (input.metalId === "silver") {
    risk_notes.push(
      "은은 금보다 변동성이 큽니다. 동일 신호라도 배율을 낮게(≈70%) 제시합니다.",
    );
  }

  const action_ko =
    action === "buy"
      ? leverage.strength === "strong_buy"
        ? "강한 매수·레버리지"
        : "매수 검토"
      : action === "sell"
        ? leverage.strength === "strong_sell"
          ? "강한 매도·공매도"
          : "청산/숏 검토"
        : "관망";

  let title = leverage.title;
  let summary = leverage.summary;
  let entry =
    input.close != null
      ? `관망. ${fmtPx(input.close)} 부근에서 방향·지지 확인`
      : "관망";
  let stop =
    activeStop != null
      ? `손절 참고 ${fmtPx(activeStop)}`
      : "스윙 저/고점 또는 ±1.5~2 ATR";
  const targets: string[] = [];
  let invalidation =
    input.sma50 != null
      ? `종가 SMA50(${fmtPx(input.sma50)}) 돌파/이탈 시 시나리오 재설정`
      : "추세 전환 시 폐기";

  if (action === "buy") {
    entry =
      input.sma20 != null && input.close != null
        ? `SMA20(${fmtPx(input.sma20)}) 눌림 또는 ${fmtPx(input.close)} 분할 롱 · 배율 ≈${leverage.suggested}×`
        : `분할 롱 · 배율 ≈${leverage.suggested}×`;
    if (input.prior20High != null) {
      targets.push(`돌파 기준 ${fmtPx(input.prior20High)}`);
    }
    if (activeTarget != null) targets.push(`1차(≈2R) ${fmtPx(activeTarget)}`);
    if (input.swingHigh != null) {
      targets.push(`확장 ${fmtPx(input.swingHigh)}`);
    }
    invalidation =
      input.sma50 != null
        ? `종가 SMA50(${fmtPx(input.sma50)}) 아래 → 롱·레버리지 청산`
        : invalidation;
  } else if (action === "sell") {
    entry =
      input.sma20 != null && input.close != null
        ? `SMA20(${fmtPx(input.sma20)}) 저항 반등 숏/인버스 · 배율 ≈${leverage.suggested}×`
        : `숏/인버스 분할 · 배율 ≈${leverage.suggested}×`;
    if (activeTarget != null) targets.push(`1차(≈2R) ${fmtPx(activeTarget)}`);
    if (input.swingLow != null) targets.push(`하방 ${fmtPx(input.swingLow)}`);
    invalidation =
      input.sma50 != null
        ? `종가 SMA50(${fmtPx(input.sma50)}) 위 복귀 → 숏/인버스 축소`
        : invalidation;
  } else {
    if (input.prior20High != null) {
      targets.push(`상단 ${fmtPx(input.prior20High)}`);
    }
    if (input.swingLow != null) targets.push(`하단 ${fmtPx(input.swingLow)}`);
  }

  const score = Math.max(
    0,
    Math.min(100, Math.round((100 * buyHits) / 7 - sellHits * 12)),
  );

  return {
    action,
    action_ko,
    score,
    buy_hits: buyHits,
    buy_needed: buyNeeded,
    sell_hits: sellHits,
    title,
    summary,
    entry,
    stop,
    targets: targets.slice(0, 3),
    invalidation,
    risk_notes: risk_notes.slice(0, 6),
    suggested_stop: activeStop,
    suggested_target: activeTarget,
    risk_per_unit: risk,
    reward_per_unit: reward,
    rr,
    leverage,
  };
}

function downsampleChart(chart: MetalCandle[], max = 120): MetalCandle[] {
  if (chart.length <= max) return chart;
  const step = Math.ceil(chart.length / max);
  const out: MetalCandle[] = [];
  for (let i = 0; i < chart.length; i += step) out.push(chart[i]!);
  const last = chart[chart.length - 1]!;
  if (out[out.length - 1]?.date !== last.date) out.push(last);
  return out;
}

function evaluateMetal(
  spec: (typeof METAL_SPECS)[number],
  bars: OhlcBar[],
  mm: { net: number | null; chg: number | null; as_of: string | null },
  macro: {
    realChg5: number | null;
    realChg10: number | null;
    dxy: number | null;
    dxySma20: number | null;
    dxyPrev5: number | null;
    usdkrwChg5: number | null;
  },
  isFriday: boolean,
): MetalPanel {
  const closes = bars.map((b) => b.close);
  const atrs = atrSeries(bars, 14);
  const chart: MetalCandle[] = bars.map((b, i) => ({
    date: b.date,
    close: b.close,
    high: b.high,
    low: b.low,
    sma20: smaAt(closes, i, 20),
    sma50: smaAt(closes, i, 50),
    atr14: atrs[i] ?? null,
  }));

  const lastIdx = chart.length - 1;
  const last = lastIdx >= 0 ? chart[lastIdx]! : null;
  const sma20Prev5 = lastIdx >= 5 ? chart[lastIdx - 5]!.sma20 : null;
  const lookback20 = chart.slice(Math.max(0, lastIdx - 20), lastIdx);
  const prior20High = lookback20.length
    ? Math.max(...lookback20.map((c) => c.high))
    : null;
  const broke20High =
    last != null && prior20High != null ? last.close > prior20High : null;
  const swingWindow = chart.slice(Math.max(0, lastIdx - 20), lastIdx);
  const swingLow = swingWindow.length
    ? Math.min(...swingWindow.map((c) => c.low))
    : null;
  const swingHigh = swingWindow.length
    ? Math.max(...swingWindow.map((c) => c.high))
    : null;

  let pullbackHeld: boolean | null = null;
  if (last != null && last.sma20 != null && lastIdx >= 5) {
    const recentLows = chart.slice(lastIdx - 5, lastIdx + 1).map((c) => c.low);
    const minLow = Math.min(...recentLows);
    pullbackHeld =
      minLow >= last.sma20 * 0.995 ||
      (swingLow != null && minLow >= swingLow);
  }

  const closeSeries = bars.map((b) => ({ date: b.date, value: b.close }));
  const atrPct =
    last?.close && last.atr14 != null
      ? (100 * last.atr14) / last.close
      : null;

  const snapshot: MetalSnapshot = {
    id: spec.id,
    label: spec.label,
    yahoo: spec.yahoo,
    price: last?.close ?? null,
    as_of: last?.date ?? null,
    sma20: last?.sma20 ?? null,
    sma50: last?.sma50 ?? null,
    atr14: last?.atr14 ?? null,
    atr_pct: atrPct,
    swing_low: swingLow,
    swing_high: swingHigh,
    prior_20d_high: prior20High,
    mm_net: mm.net,
    mm_chg: mm.chg,
    mm_as_of: mm.as_of,
    chg_5d_pct: pctChangeOver(closeSeries, 5),
  };

  const buy_rules = buildBuyRules({
    close: snapshot.price,
    sma20: snapshot.sma20,
    sma20Prev5,
    sma50: snapshot.sma50,
    realChg5: macro.realChg5,
    realChg10: macro.realChg10,
    dxy: macro.dxy,
    dxySma20: macro.dxySma20,
    mmChg: mm.chg,
    broke20High,
    pullbackHeld,
  });

  const sell_rules = buildSellRules({
    close: snapshot.price,
    sma20: snapshot.sma20,
    sma20Prev5,
    sma50: snapshot.sma50,
    swingLow,
    realChg5: macro.realChg5,
    dxy: macro.dxy,
    dxySma20: macro.dxySma20,
    dxyPrev5: macro.dxyPrev5,
  });

  const tactics = buildTactics({
    close: snapshot.price,
    sma50: snapshot.sma50,
    broke20High,
    atr: snapshot.atr14,
    isFriday,
    metalLabel: spec.label,
  });

  const playbook = buildPlaybook({
    buyRules: buy_rules,
    sellRules: sell_rules,
    close: snapshot.price,
    sma20: snapshot.sma20,
    sma50: snapshot.sma50,
    atr: snapshot.atr14,
    atrPct,
    swingLow,
    swingHigh,
    prior20High,
    usdkrwChg5: macro.usdkrwChg5,
    isFriday,
    leverageScale: spec.leverage_scale,
    metalId: spec.id,
    metalLabel: spec.label,
  });

  return {
    id: spec.id,
    label: spec.label,
    yahoo: spec.yahoo,
    snapshot,
    buy_rules,
    sell_rules,
    tactics,
    playbook,
    chart: downsampleChart(chart),
    position_presets: spec.presets,
  };
}

export function positionSizeContracts(input: {
  account: number;
  riskPct: number;
  entry: number;
  stop: number;
  multiplier: number;
}): { contracts: number; dollarRisk: number; perContractRisk: number } | null {
  const { account, riskPct, entry, stop, multiplier } = input;
  if (
    !(account > 0) ||
    !(riskPct > 0) ||
    !(entry > 0) ||
    !(stop > 0) ||
    !(multiplier > 0) ||
    entry === stop
  ) {
    return null;
  }
  const dollarRisk = account * (riskPct / 100);
  const perContractRisk = Math.abs(entry - stop) * multiplier;
  if (!(perContractRisk > 0)) return null;
  return {
    contracts: dollarRisk / perContractRisk,
    dollarRisk,
    perContractRisk,
  };
}

/** Effective notional with leverage: contracts already size risk; leverage is directional bias. */
export function leverageNotionalNote(
  suggested: number,
  account: number,
): string {
  if (!(account > 0) || suggested === 0) return "배율 0 — 신규 레버리지 없음";
  const notional = account * Math.abs(suggested);
  const side = suggested > 0 ? "롱" : "숏/인버스";
  return `${side} ${Math.abs(suggested)}× 가정 시 명목 ≈ $${Math.round(notional).toLocaleString("en-US")} (계좌 $${Math.round(account).toLocaleString("en-US")})`;
}

export async function buildPreciousMetalsPayload(): Promise<PreciousMetalsPayload> {
  const [gcBars, siBars, dxyBars, krwBars, dfii, dgs10, t10yie, mmGold, mmSilver] =
    await Promise.all([
      fetchYahooOhlc("GC=F", 420),
      fetchYahooOhlc("SI=F", 420),
      fetchYahooOhlc("DX-Y.NYB", 420),
      fetchYahooOhlc("KRW=X", 120),
      fetchFredSeries("DFII10", 420),
      fetchFredSeries("DGS10", 420),
      fetchFredSeries("T10YIE", 420),
      fetchMmSnapshot("gold"),
      fetchMmSnapshot("silver"),
    ]);

  let realSeries = dfii;
  let realSource = "FRED DFII10 (10Y TIPS real yield)";
  if (realSeries.length < 20) {
    const approx = subtractSeries(dgs10, t10yie);
    if (approx.length > realSeries.length) {
      realSeries = approx;
      realSource = "FRED DGS10 − T10YIE (근사 실질금리)";
    }
  }

  const dxyCloses = dxyBars.map((b) => b.close);
  const dxyLast = dxyBars.at(-1) || null;
  const dxySma20 =
    dxyCloses.length >= 20
      ? smaAt(dxyCloses, dxyCloses.length - 1, 20)
      : null;
  const dxyPrev5 =
    dxyCloses.length >= 6 ? dxyCloses[dxyCloses.length - 6]! : null;
  const dxySeries = dxyBars.map((b) => ({ date: b.date, value: b.close }));
  const krwSeries = krwBars.map((b) => ({ date: b.date, value: b.close }));
  const krwLast = krwSeries.at(-1) || null;

  const goldLast = gcBars.at(-1)?.close ?? null;
  const silverLast = siBars.at(-1)?.close ?? null;

  const macro: SharedMacro = {
    real_yield: realSeries.at(-1)?.value ?? null,
    real_yield_as_of: realSeries.at(-1)?.date ?? null,
    real_yield_chg_5d: changeOver(realSeries, 5),
    real_yield_chg_10d: changeOver(realSeries, 10),
    real_yield_source: realSource,
    dxy: dxyLast?.close ?? null,
    dxy_sma20: dxySma20,
    dxy_as_of: dxyLast?.date ?? null,
    dxy_chg_5d: changeOver(dxySeries, 5),
    usdkrw: krwLast?.value ?? null,
    usdkrw_as_of: krwLast?.date ?? null,
    usdkrw_chg_5d_pct: pctChangeOver(krwSeries, 5),
    gold_silver_ratio:
      goldLast != null && silverLast != null && silverLast > 0
        ? goldLast / silverLast
        : null,
  };

  const isFriday = new Date().getUTCDay() === 5;
  const macroCtx = {
    realChg5: macro.real_yield_chg_5d,
    realChg10: macro.real_yield_chg_10d,
    dxy: macro.dxy,
    dxySma20: macro.dxy_sma20,
    dxyPrev5,
    usdkrwChg5: macro.usdkrw_chg_5d_pct,
  };

  const barsById: Record<MetalId, OhlcBar[]> = {
    gold: gcBars,
    silver: siBars,
  };
  const mmById: Record<MetalId, typeof mmGold> = {
    gold: mmGold,
    silver: mmSilver,
  };

  const metals = METAL_SPECS.map((spec) =>
    evaluateMetal(spec, barsById[spec.id], mmById[spec.id], macroCtx, isFriday),
  );

  const ok = metals.some((m) => m.chart.length >= 50);
  const focus_default =
    metals.find((m) => m.playbook.leverage.strength.startsWith("strong"))?.id ||
    metals.find((m) => m.playbook.action !== "hold")?.id ||
    "gold";

  return {
    ok,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    source: `Yahoo GC=F·SI=F·DXY·KRW · ${realSource} · CFTC Disagg MM(금·은)`,
    schedule_note: PRECIOUS_METALS_SCHEDULE,
    note: PRECIOUS_METALS_NOTE,
    feasibility: {
      verdict:
        "금·은 선물 타이밍은 일봉 추세+실질금리+DXY+손절로 공통 평가. " +
        "강한 매수→레버리지 롱(+10 한도), 강한 매도→공매도/인버스(−10 한도). " +
        "은은 변동성 헤어컷(≈0.7×) 적용.",
      ready: [
        "GC=F / SI=F SMA·돌파·ATR·스윙",
        "실질금리·DXY 공유 매크로",
        "CFTC MM 수요 대용",
        "레버리지 밴드 −10…+10 + 포지션 사이징",
        "원/달러·금은비",
      ],
      deferred: [
        "GLD/SLV 실물 보유량",
        "CPI·FOMC·고용 자동 캘린더",
        "브로커별 실제 마진·인버스 ETF 추적오차",
      ],
      rejected: ["RSI 70 무조건 매도"],
    },
    macro,
    metals,
    focus_default,
    krw_framing: {
      usdkrw: macro.usdkrw,
      gold_usd: goldLast,
      silver_usd: silverLast,
      gold_krw_oz:
        goldLast != null && macro.usdkrw != null
          ? goldLast * macro.usdkrw
          : null,
      silver_krw_oz:
        silverLast != null && macro.usdkrw != null
          ? silverLast * macro.usdkrw
          : null,
      note:
        "달러 금·은과 원화 환산·국내 ETF는 환율 때문에 방향이 갈릴 수 있습니다. " +
        "귀금속 방향과 원/달러를 분리해서 수단을 고르세요.",
    },
    event_risk: {
      is_friday: isFriday,
      note: isFriday
        ? "금요일(UTC) — 주말 갭으로 고배율 롱/숏·인버스를 축소하세요."
        : "CPI·FOMC·고용 직전에도 레버리지·숏 배율을 줄이세요.",
    },
    leverage_policy: {
      max_long: 10,
      max_short: -10,
      note:
        "가정: 선물/CFD/인버스 등으로 롱 최대 +10배, 숏·인버스 최대 −10배. " +
        "강한 매수 신호에서만 고배율 롱, 강한 매도 신호에서만 고배율 숏. " +
        "배율과 무관하게 1회 계좌 손실 한도(0.5~1%)를 지킵니다.",
    },
    error: ok ? undefined : "귀금속 일봉 부족",
  };
}

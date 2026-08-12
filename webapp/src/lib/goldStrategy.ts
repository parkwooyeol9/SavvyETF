/**
 * Gold day-trend strategy checklist (education / rule engine).
 *
 * Combines:
 * - GC=F price structure (SMA20/50, 20d breakout, ATR, swing levels)
 * - FRED 10Y real yield (DFII10; fallback DGS10 − T10YIE)
 * - DXY (DX-Y.NYB) vs SMA20
 * - USD/KRW (KRW=X) for KR investor framing
 * - CFTC gold Managed Money WoW as ETF-holdings proxy until SPDR ounces are wired
 *
 * Not investment advice. RSI>70 alone is intentionally NOT a sell rule.
 */

import { CFTC_MARKET_SPECS } from "@/lib/cftc";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export const GOLD_STRATEGY_NOTE =
  "교육용 룰 엔진 · 투자 자문 아님 · RSI 과매수 단독 매도 규칙 없음 · " +
  "일봉 추세 + 실질금리 + DXY + 손절/손익비 + 원/달러 분리 판단";

export const GOLD_STRATEGY_SCHEDULE =
  "페이지 로드 시 계산 · FRED·Yahoo·CFTC 공개 소스(키 불필요) · " +
  "ETF 실물 보유량(GLD ounces)은 후속 연동 예정(현재 MM 대용)";

type OhlcBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type GoldRuleStatus = "pass" | "fail" | "neutral" | "unavailable";

export type GoldRuleEval = {
  id: string;
  kind: "buy" | "sell" | "tactic";
  label: string;
  detail: string;
  status: GoldRuleStatus;
  weight: number;
};

export type GoldCandle = {
  date: string;
  close: number;
  high: number;
  low: number;
  sma20: number | null;
  sma50: number | null;
  atr14: number | null;
};

export type GoldMacroSnapshot = {
  gc: number | null;
  gc_as_of: string | null;
  sma20: number | null;
  sma50: number | null;
  atr14: number | null;
  swing_low: number | null;
  swing_high: number | null;
  prior_20d_high: number | null;
  real_yield: number | null;
  real_yield_as_of: string | null;
  real_yield_chg_5d: number | null;
  real_yield_chg_10d: number | null;
  real_yield_source: string;
  dxy: number | null;
  dxy_sma20: number | null;
  dxy_as_of: string | null;
  usdkrw: number | null;
  usdkrw_as_of: string | null;
  usdkrw_chg_5d_pct: number | null;
  mm_net: number | null;
  mm_chg: number | null;
  mm_as_of: string | null;
};

export type GoldPositionPreset = {
  id: "mgc" | "gc" | "gld_share";
  label: string;
  multiplier: number;
  unit: string;
  note: string;
};

export type GoldPlaybook = {
  action: "buy" | "hold" | "sell";
  action_ko: string;
  score: number;
  buy_hits: number;
  buy_needed: number;
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
};

export type GoldStrategyPayload = {
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
  macro: GoldMacroSnapshot;
  buy_rules: GoldRuleEval[];
  sell_rules: GoldRuleEval[];
  tactics: GoldRuleEval[];
  playbook: GoldPlaybook;
  chart: GoldCandle[];
  position_presets: GoldPositionPreset[];
  krw_framing: {
    usd_gold: number | null;
    usdkrw: number | null;
    implied_krw_per_oz: number | null;
    note: string;
  };
  event_risk: {
    is_friday: boolean;
    note: string;
  };
  error?: string;
};

const POSITION_PRESETS: GoldPositionPreset[] = [
  {
    id: "mgc",
    label: "Micro Gold (MGC)",
    multiplier: 10,
    unit: "트로이온스/계약",
    note: "온스당 $1 움직임 → 계약당 $10. 초보자 권장.",
  },
  {
    id: "gc",
    label: "Gold (GC)",
    multiplier: 100,
    unit: "트로이온스/계약",
    note: "온스당 $1 움직임 → 계약당 $100. 변동성이 커서 초보에게는 과대.",
  },
  {
    id: "gld_share",
    label: "GLD ETF (1주)",
    multiplier: 1,
    unit: "주당 ≈0.09 oz 상당(근사)",
    note: "현물·ETF 매매용. 승수 1달러≈주당 손익(가격 단위).",
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
    if (i + 1 < period) {
      out[i] = null;
      continue;
    }
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
  const last = series[series.length - 1]!.value;
  const prev = series[series.length - 1 - lookback]!.value;
  return last - prev;
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

/** Align two FRED series by date and compute a − b. */
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

async function fetchGoldMmSnapshot(): Promise<{
  net: number | null;
  chg: number | null;
  as_of: string | null;
}> {
  const gold = CFTC_MARKET_SPECS.find((s) => s.id === "gold");
  if (!gold) return { net: null, chg: null, as_of: null };
  try {
    const url =
      "https://publicreporting.cftc.gov/resource/72hh-3qpy.json?" +
      new URLSearchParams({
        $where: `market_and_exchange_names='${gold.market_name.replace(/'/g, "''")}'`,
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
}): GoldRuleEval[] {
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
  const dxyBelow =
    dxy != null && dxySma20 != null ? dxy < dxySma20 : null;

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
      id: "gold_demand_proxy",
      kind: "buy",
      label: "금 ETF 보유량 증가 (현재: CFTC MM 대용)",
      detail:
        mmChg != null
          ? `Managed Money 순매수 WoW ${fmtChg(mmChg, 0)}계약 · GLD ounces 미연동`
          : "MM·ETF 보유량 모두 없음",
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
            ? "직전 20일 최고가 종가 돌파 확인"
            : "20일 고점 미돌파 또는 종가 미확인",
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
          ? "스윙/이평 데이터 부족"
          : pullbackHeld
            ? "최근 저점이 SMA20 위이거나 스윙 저점 붕괴 없음"
            : "조정 중 저점·SMA20 지지 약화",
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
}): GoldRuleEval[] {
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
  const dxyRising =
    dxy != null && dxyPrev5 != null ? dxy > dxyPrev5 : null;
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
          : "금리/달러 데이터 부족",
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
      label: "호재에도 전고점 미돌파 (수동 확인)",
      detail: "뉴스·이벤트 해석은 자동화하지 않음 — 차트 전고점과 함께 수동 점검",
      status: "unavailable",
      weight: 0,
    },
    {
      id: "stop_or_rr",
      kind: "sell",
      label: "손절 도달 / 목표수익 ≥ 위험의 2배",
      detail: "포지션 사이징 계산기·플레이북의 손절·목표가 참고",
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
}): GoldRuleEval[] {
  const { close, sma50, broke20High, atr, isFriday } = input;
  const aboveSma50 =
    close != null && sma50 != null ? close > sma50 : null;
  return [
    {
      id: "only_long_above_sma50",
      kind: "tactic",
      label: "일봉이 50일선 위일 때만 매수",
      detail:
        aboveSma50 == null
          ? "데이터 부족"
          : aboveSma50
            ? "추세 필터 통과"
            : "50일선 아래 — 신규 롱 보류",
      status:
        aboveSma50 == null ? "unavailable" : aboveSma50 ? "pass" : "fail",
      weight: 1,
    },
    {
      id: "breakout_candidate",
      kind: "tactic",
      label: "직전 20일 최고가 종가 돌파 = 진입 후보",
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
      label: "돌파 다음 날 추격 금지 · 되돌림 대기",
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
      label: "1회 최대 손실 = 자금의 0.5~1%",
      detail: "포지션 수량 = (계좌×허용손실률) / (|진입−손절|×승수)",
      status: "neutral",
      weight: 0,
    },
    {
      id: "min_rr",
      kind: "tactic",
      label: "손익비 최소 1:2 미달 시 미진입",
      detail: "목표 − 진입 ≥ 2 × (진입 − 손절)",
      status: "neutral",
      weight: 0,
    },
    {
      id: "event_leverage",
      kind: "tactic",
      label: "CPI·FOMC·고용보고서 직전 레버리지 축소",
      detail: "경제지표 캘린더는 후속 연동 — 수동으로 일정 확인",
      status: "unavailable",
      weight: 0,
    },
    {
      id: "friday_gap",
      kind: "tactic",
      label: "금요일 늦은 시간 주말 갭 위험",
      detail: isFriday
        ? "오늘(UTC 기준) 금요일 — 포지션 축소 검토"
        : "오늘은 금요일 아님 — 주말 갭 규칙 대기",
      status: isFriday ? "pass" : "neutral",
      weight: 0,
    },
  ];
}

function buildPlaybook(input: {
  buyRules: GoldRuleEval[];
  sellRules: GoldRuleEval[];
  close: number | null;
  sma20: number | null;
  sma50: number | null;
  atr: number | null;
  swingLow: number | null;
  swingHigh: number | null;
  prior20High: number | null;
  usdkrwChg5: number | null;
  isFriday: boolean;
}): GoldPlaybook {
  const buyNeeded = 3;
  const buyHits = input.buyRules.filter((r) => r.status === "pass").length;
  const sellHits = input.sellRules.filter(
    (r) => r.status === "pass" && r.weight > 0,
  ).length;
  const aboveSma50 =
    input.close != null && input.sma50 != null && input.close > input.sma50;

  let action: GoldPlaybook["action"] = "hold";
  if (sellHits >= 2 || (sellHits >= 1 && buyHits < 2)) {
    action = "sell";
  } else if (buyHits >= buyNeeded && aboveSma50) {
    action = "buy";
  }

  const stopFromSwing = input.swingLow;
  const stopFromAtr =
    input.close != null && input.atr != null
      ? input.close - 1.75 * input.atr
      : null;
  const suggestedStop =
    stopFromSwing != null && stopFromAtr != null
      ? Math.min(stopFromSwing, stopFromAtr)
      : (stopFromSwing ?? stopFromAtr);

  const suggestedTarget =
    input.close != null && suggestedStop != null
      ? input.close + 2 * Math.max(input.close - suggestedStop, 0)
      : input.swingHigh;

  const risk =
    input.close != null && suggestedStop != null
      ? Math.max(input.close - suggestedStop, 0)
      : null;
  const reward =
    input.close != null && suggestedTarget != null
      ? Math.max(suggestedTarget - input.close, 0)
      : null;
  const rr =
    risk != null && reward != null && risk > 0 ? reward / risk : null;

  const risk_notes: string[] = [
    "룰 기반 교육용 시나리오입니다. 투자 자문·매매 권유가 아닙니다.",
    "RSI 과매수 단독으로 매도하지 않습니다 — 강한 상승에서는 장기 과매수가 가능합니다.",
  ];
  if (input.isFriday) {
    risk_notes.push("금요일 — 주말 갭 위험을 고려해 레버리지·포지션을 축소하세요.");
  }
  if (input.usdkrwChg5 != null && Math.abs(input.usdkrwChg5) >= 1) {
    risk_notes.push(
      `원/달러 5일 ${fmtChg(input.usdkrwChg5, 1)}% — 달러 금과 원화 금·국내 ETF를 분리해서 봅니다.`,
    );
  }
  if (rr != null && rr < 2) {
    risk_notes.push(
      `현재 추정 손익비 ${rr.toFixed(2)} < 2 — 전술상 신규 진입을 보류하는 편이 낫습니다.`,
    );
  }

  const action_ko =
    action === "buy" ? "매수 검토" : action === "sell" ? "청산/축소 검토" : "관망";

  let title = "관망 · 조건 대기";
  let summary = `매수 체크 ${buyHits}/${buyNeeded} · 매도 신호 ${sellHits}. 3개 이상 충족 + 50일선 위에서만 롱을 검토합니다.`;
  let entry =
    input.close != null
      ? `관망. ${fmtPx(input.close)} 부근에서 돌파 후 되돌림·지지 확인`
      : "관망";
  let stop =
    suggestedStop != null
      ? `손절 참고 ${fmtPx(suggestedStop)} (스윙저점·1.75ATR 보수값)`
      : "스윙 저점 또는 진입가 − 1.5~2 ATR";
  const targets: string[] = [];
  let invalidation =
    input.sma50 != null
      ? `종가가 SMA50(${fmtPx(input.sma50)}) 아래 마감 시 롱 시나리오 약화`
      : "추세 전환 시 시나리오 폐기";

  if (action === "buy") {
    title = "추세 롱 검토 · 되돌림 진입";
    summary = `매수 조건 ${buyHits}개 충족. 고점 추격보다 돌파→되돌림→SMA20/저점 지지 확인 후 분할 진입을 권장합니다.`;
    entry =
      input.sma20 != null && input.close != null
        ? `SMA20(${fmtPx(input.sma20)}) 근처 눌림 또는 ${fmtPx(input.close)} 분할 · 돌파 다음날 추격 금지`
        : `현재가 분할 롱 · 되돌림 우선`;
    if (input.prior20High != null) {
      targets.push(`돌파 기준 ${fmtPx(input.prior20High)} (20일 고점)`);
    }
    if (suggestedTarget != null) {
      targets.push(`1차 목표 ${fmtPx(suggestedTarget)} (≈2R)`);
    }
    if (input.swingHigh != null) {
      targets.push(`확장 ${fmtPx(input.swingHigh)} (최근 스윙 고점)`);
    }
  } else if (action === "sell") {
    title = "청산·축소 검토";
    summary = `매도 룰 ${sellHits}개 활성. 실질금리·달러 동시 강세 또는 이평/저점 이탈이면 비중을 줄입니다.`;
    entry =
      input.sma20 != null
        ? `반등 시 SMA20(${fmtPx(input.sma20)}) 저항 매도·축소`
        : "반등 매도·현금 비중 확대";
    stop =
      input.swingHigh != null
        ? `숏/축소 무효 참고: ${fmtPx(input.swingHigh)} 종가 돌파`
        : stop;
    if (input.swingLow != null) {
      targets.push(`하방 ${fmtPx(input.swingLow)}`);
    }
    if (input.close != null && input.atr != null) {
      targets.push(`확장 ${fmtPx(input.close - 2 * input.atr)}`);
    }
    invalidation =
      input.sma50 != null
        ? `종가가 SMA50(${fmtPx(input.sma50)}) 위로 복귀하면 약세 시나리오 재평가`
        : invalidation;
  } else {
    if (input.prior20High != null) {
      targets.push(`상단 돌파 관찰 ${fmtPx(input.prior20High)}`);
    }
    if (input.swingLow != null) {
      targets.push(`하단 이탈 관찰 ${fmtPx(input.swingLow)}`);
    }
  }

  // Score: buy hits scaled, penalize sell hits
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
    title,
    summary,
    entry,
    stop,
    targets: targets.slice(0, 3),
    invalidation,
    risk_notes: risk_notes.slice(0, 5),
    suggested_stop: suggestedStop,
    suggested_target: suggestedTarget,
    risk_per_unit: risk,
    reward_per_unit: reward,
    rr,
  };
}

export function positionSizeContracts(input: {
  account: number;
  riskPct: number; // 0.5 ~ 1
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

export async function buildGoldStrategyPayload(): Promise<GoldStrategyPayload> {
  const [gcBars, dxyBars, krwBars, dfii, dgs10, t10yie, mm] = await Promise.all([
    fetchYahooOhlc("GC=F", 420),
    fetchYahooOhlc("DX-Y.NYB", 420),
    fetchYahooOhlc("KRW=X", 120),
    fetchFredSeries("DFII10", 420),
    fetchFredSeries("DGS10", 420),
    fetchFredSeries("T10YIE", 420),
    fetchGoldMmSnapshot(),
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

  const closes = gcBars.map((b) => b.close);
  const atrs = atrSeries(gcBars, 14);
  const chart: GoldCandle[] = gcBars.map((b, i) => ({
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
  const sma20Prev5 =
    lastIdx >= 5 ? chart[lastIdx - 5]!.sma20 : null;

  const lookback20 = chart.slice(Math.max(0, lastIdx - 20), lastIdx); // exclude today
  const prior20High = lookback20.length
    ? Math.max(...lookback20.map((c) => c.high))
    : null;
  const broke20High =
    last != null && prior20High != null
      ? last.close > prior20High
      : null;

  // Swing low/high: last 20 bars excluding current
  const swingWindow = chart.slice(Math.max(0, lastIdx - 20), lastIdx);
  const swingLow = swingWindow.length
    ? Math.min(...swingWindow.map((c) => c.low))
    : null;
  const swingHigh = swingWindow.length
    ? Math.max(...swingWindow.map((c) => c.high))
    : null;

  // Pullback hold: recent 5-day low stays above SMA20 or above prior swing mid
  let pullbackHeld: boolean | null = null;
  if (last != null && last.sma20 != null && lastIdx >= 5) {
    const recentLows = chart.slice(lastIdx - 5, lastIdx + 1).map((c) => c.low);
    const minLow = Math.min(...recentLows);
    pullbackHeld = minLow >= last.sma20 * 0.995 || (swingLow != null && minLow >= swingLow);
  }

  const dxyCloses = dxyBars.map((b) => b.close);
  const dxyLast = dxyBars.at(-1) || null;
  const dxySma20 =
    dxyCloses.length >= 20
      ? smaAt(dxyCloses, dxyCloses.length - 1, 20)
      : null;
  const dxyPrev5 =
    dxyCloses.length >= 6 ? dxyCloses[dxyCloses.length - 6]! : null;

  const krwSeries = krwBars.map((b) => ({ date: b.date, value: b.close }));
  const krwLast = krwSeries.at(-1) || null;

  const macro: GoldMacroSnapshot = {
    gc: last?.close ?? null,
    gc_as_of: last?.date ?? null,
    sma20: last?.sma20 ?? null,
    sma50: last?.sma50 ?? null,
    atr14: last?.atr14 ?? null,
    swing_low: swingLow,
    swing_high: swingHigh,
    prior_20d_high: prior20High,
    real_yield: realSeries.at(-1)?.value ?? null,
    real_yield_as_of: realSeries.at(-1)?.date ?? null,
    real_yield_chg_5d: changeOver(realSeries, 5),
    real_yield_chg_10d: changeOver(realSeries, 10),
    real_yield_source: realSource,
    dxy: dxyLast?.close ?? null,
    dxy_sma20: dxySma20,
    dxy_as_of: dxyLast?.date ?? null,
    usdkrw: krwLast?.value ?? null,
    usdkrw_as_of: krwLast?.date ?? null,
    usdkrw_chg_5d_pct: pctChangeOver(krwSeries, 5),
    mm_net: mm.net,
    mm_chg: mm.chg,
    mm_as_of: mm.as_of,
  };

  const buy_rules = buildBuyRules({
    close: macro.gc,
    sma20: macro.sma20,
    sma20Prev5,
    sma50: macro.sma50,
    realChg5: macro.real_yield_chg_5d,
    realChg10: macro.real_yield_chg_10d,
    dxy: macro.dxy,
    dxySma20: macro.dxy_sma20,
    mmChg: macro.mm_chg,
    broke20High,
    pullbackHeld,
  });

  const sell_rules = buildSellRules({
    close: macro.gc,
    sma20: macro.sma20,
    sma20Prev5,
    sma50: macro.sma50,
    swingLow,
    realChg5: macro.real_yield_chg_5d,
    dxy: macro.dxy,
    dxySma20: macro.dxy_sma20,
    dxyPrev5,
  });

  const isFriday = new Date().getUTCDay() === 5;
  const tactics = buildTactics({
    close: macro.gc,
    sma50: macro.sma50,
    broke20High,
    atr: macro.atr14,
    isFriday,
  });

  const playbook = buildPlaybook({
    buyRules: buy_rules,
    sellRules: sell_rules,
    close: macro.gc,
    sma20: macro.sma20,
    sma50: macro.sma50,
    atr: macro.atr14,
    swingLow,
    swingHigh,
    prior20High,
    usdkrwChg5: macro.usdkrw_chg_5d_pct,
    isFriday,
  });

  const ok = chart.length >= 50;
  const chartDownsampled = (() => {
    if (chart.length <= 120) return chart;
    const step = Math.ceil(chart.length / 120);
    const out: GoldCandle[] = [];
    for (let i = 0; i < chart.length; i += step) out.push(chart[i]!);
    const lastBar = chart[chart.length - 1]!;
    if (out[out.length - 1]?.date !== lastBar.date) out.push(lastBar);
    return out;
  })();

  return {
    ok,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    source: `Yahoo GC=F·DXY·KRW · ${realSource} · CFTC Disagg gold MM`,
    schedule_note: GOLD_STRATEGY_SCHEDULE,
    note: GOLD_STRATEGY_NOTE,
    feasibility: {
      verdict:
        "핵심 조합(일봉 추세 + 실질금리 + DXY + 손절/손익비 + 원/달러)은 공개 데이터로 구현 가능. " +
        "GLD 실물 보유량·경제지표 캘린더·뉴스 실패 돌파는 후속.",
      ready: [
        "GC=F SMA20/50 · 20일 돌파 · ATR(14) · 스윙 저고점",
        "FRED 10Y 실질금리(DFII10 또는 DGS10−T10YIE)",
        "DXY vs SMA20",
        "원/달러(KRW=X) 분리 프레이밍",
        "MGC/GC 포지션 사이징(승수 10/100)",
        "매수 3/7 체크리스트 · 매도 룰 · 플레이북",
      ],
      deferred: [
        "SPDR GLD 일별 실물 보유량(ounces) — 현재 CFTC Managed Money WoW 대용",
        "CPI·FOMC·고용보고서 자동 캘린더",
        "호재 뉴스 후 전고점 실패(정성 룰)",
      ],
      rejected: [
        "RSI 70 무조건 매도 — 강한 추세에서 장기 과매수 가능(의도적으로 미채택)",
      ],
    },
    macro,
    buy_rules,
    sell_rules,
    tactics,
    playbook,
    chart: chartDownsampled,
    position_presets: POSITION_PRESETS,
    krw_framing: {
      usd_gold: macro.gc,
      usdkrw: macro.usdkrw,
      implied_krw_per_oz:
        macro.gc != null && macro.usdkrw != null
          ? macro.gc * macro.usdkrw
          : null,
      note:
        "국제 금(달러)과 원화 환산·국내 금 ETF는 환율 때문에 방향이 갈릴 수 있습니다. " +
        "금 방향과 원/달러 방향을 분리해서 투자수단을 고르세요.",
    },
    event_risk: {
      is_friday: isFriday,
      note: isFriday
        ? "금요일(UTC) — 주말 갭 위험으로 레버리지·포지션 축소를 권장합니다."
        : "주말 갭 규칙은 금요일에 강조됩니다. CPI·FOMC·고용 직전에도 레버리지를 줄이세요.",
    },
    error: ok ? undefined : "GC=F 일봉 부족",
  };
}

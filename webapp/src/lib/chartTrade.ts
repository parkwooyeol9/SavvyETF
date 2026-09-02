import { withServerCache } from "@/lib/apiCache";
import { fetchDailyOhlc, type OhlcPoint } from "@/lib/simulate";

export const ROUNDS = 5;
export const LOOKBACK = 60;
export const HORIZON = 5;
export const START_EQUITY = 100_000_000;
export const WEIGHT_MIN = -200;
export const WEIGHT_MAX = 200;
export const WEIGHT_STEP = 10;
export const WEIGHT_PRESETS = [-200, -100, 0, 100, 200] as const;

export type Side = "buy" | "sell" | "flat";

export type CandlePoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ChartTradeRound = {
  id: string;
  ticker: string;
  name: string;
  seen: CandlePoint[];
  next: CandlePoint[];
  fwd_pct: number;
};

export type ChartTradePayload = {
  ok: boolean;
  error?: string;
  date: string;
  horizon: number;
  start_equity: number;
  generated_at: string;
  rounds: ChartTradeRound[];
};

export type TradePick = {
  roundId: string;
  side: Side;
  weight_pct: number;
  pnl_pct: number;
  ticker: string;
  name: string;
  fwd_pct: number;
};

const POOL: Array<{ ticker: string; name: string }> = [
  { ticker: "QQQ", name: "Nasdaq-100" },
  { ticker: "TLT", name: "장기국채" },
  { ticker: "GLD", name: "금" },
  { ticker: "SMH", name: "반도체" },
  { ticker: "ARKK", name: "혁신" },
  { ticker: "XLE", name: "에너지" },
  { ticker: "IWM", name: "러셀2000" },
  { ticker: "EEM", name: "신흥국" },
  { ticker: "VNQ", name: "리츠" },
  { ticker: "USO", name: "원유" },
  { ticker: "HYG", name: "하이일드" },
  { ticker: "SLV", name: "은" },
];

export function isoTodayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function shiftIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function fmtPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtKrw(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}₩${Math.abs(rounded).toLocaleString("ko-KR")}`;
}

export function clampWeight(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const stepped = Math.round(n / WEIGHT_STEP) * WEIGHT_STEP;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, stepped));
}

export function sideFromWeight(weightPct: number): Side {
  if (weightPct > 0) return "buy";
  if (weightPct < 0) return "sell";
  return "flat";
}

export function sideLabel(side: Side): string {
  if (side === "buy") return "매수";
  if (side === "sell") return "매도";
  return "관망";
}

export function weightLabel(weightPct: number): string {
  const w = clampWeight(weightPct);
  if (w === 0) return "현금 0%";
  const lever = Math.abs(w) > 100 ? "레버리지 " : "";
  return `${lever}${sideLabel(sideFromWeight(w))} ${fmtPct(w, 0)}`;
}

export function pnlForWeight(weightPct: number, fwdPct: number): number {
  return (clampWeight(weightPct) / 100) * fwdPct;
}

export function applyPnl(equity: number, pnlPct: number): number {
  return Math.max(0, equity * (1 + pnlPct / 100));
}

export function equityFromPicks(
  picks: TradePick[],
  start = START_EQUITY,
): number {
  return picks.reduce((eq, p) => applyPnl(eq, p.pnl_pct), start);
}

export function totalPnlPct(picks: TradePick[], start = START_EQUITY): number {
  const eq = equityFromPicks(picks, start);
  return start ? (100 * (eq / start - 1)) : 0;
}

export function resultTitle(pnlPct: number): string {
  if (pnlPct >= 25) return "한 판으로 전설";
  if (pnlPct >= 12) return "오늘 시장은 네 편";
  if (pnlPct >= 6) return "손맛 좋았음";
  if (pnlPct >= 2) return "플러스 컷";
  if (pnlPct > -2) return "본전 근처";
  if (pnlPct > -8) return "한 대 맞음";
  if (pnlPct > -20) return "레버리지가 물었다";
  return "리셋이 답";
}

export function shareText(date: string, picks: TradePick[]): string {
  const equity = equityFromPicks(picks);
  const total = totalPnlPct(picks);
  const lines = [
    `SavvyETF 모의투자  ${date}`,
    `${fmtKrw(equity)}  ·  ${fmtPct(total)}  ·  ${resultTitle(total)}`,
    `원금 ${fmtKrw(START_EQUITY)} · 캔들 ${ROUNDS}판`,
    "",
    ...picks.map(
      (p) =>
        `${sideLabel(p.side).padEnd(2)} ${String(p.weight_pct).padStart(4)}%  ${p.ticker.padEnd(4)}  ${fmtPct(p.pnl_pct)}`,
    ),
    "",
    "https://savvyetf.com/play",
  ];
  return lines.join("\n");
}

function hashDate(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function indexCandle(bar: OhlcPoint, base: number): CandlePoint {
  const k = base > 0 ? 100 / base : 1;
  return {
    date: bar.date,
    open: bar.open * k,
    high: bar.high * k,
    low: bar.low * k,
    close: bar.close * k,
  };
}

export function scoreRound(round: ChartTradeRound, weightPct: number): TradePick {
  const weight = clampWeight(weightPct);
  return {
    roundId: round.id,
    side: sideFromWeight(weight),
    weight_pct: weight,
    pnl_pct: pnlForWeight(weight, round.fwd_pct),
    ticker: round.ticker,
    name: round.name,
    fwd_pct: round.fwd_pct,
  };
}

export function scoreRun(
  rounds: ChartTradeRound[],
  weights: number[],
): { picks: TradePick[]; equity: number; pnl_pct: number } {
  if (weights.length !== rounds.length) {
    throw new Error("라운드 수와 비중이 맞지 않습니다.");
  }
  const picks = rounds.map((round, i) => scoreRound(round, weights[i] ?? 0));
  return {
    picks,
    equity: equityFromPicks(picks),
    pnl_pct: totalPnlPct(picks),
  };
}

export async function buildChartTrade(date: string): Promise<ChartTradePayload> {
  const rand = mulberry32(hashDate(`chart-trade:v2:${date}`));
  const start = isoDaysAgo(420);
  const end = date;

  const fetched = await Promise.all(
    POOL.map(async (item) => {
      try {
        const points = await fetchDailyOhlc(item.ticker, start, end);
        return { ...item, points };
      } catch {
        return { ...item, points: [] as OhlcPoint[] };
      }
    }),
  );

  const usable = fetched.filter(
    (row) => row.points.length >= LOOKBACK + HORIZON + 8,
  );
  if (usable.length < ROUNDS) {
    return {
      ok: false,
      error: "오늘 차트를 충분히 못 만들었습니다.",
      date,
      horizon: HORIZON,
      start_equity: START_EQUITY,
      generated_at: new Date().toISOString(),
      rounds: [],
    };
  }

  const picked = shuffle(usable, rand).slice(0, ROUNDS);
  const rounds: ChartTradeRound[] = picked.map((row, i) => {
    const pts = row.points;
    const minCut = LOOKBACK - 1;
    const maxCut = pts.length - 1 - HORIZON;
    const cut = minCut + Math.floor(rand() * (maxCut - minCut + 1));
    const window = pts.slice(cut - LOOKBACK + 1, cut + HORIZON + 1);
    const base = window[0]!.close;
    const seenRaw = window.slice(0, LOOKBACK);
    const nextRaw = window.slice(LOOKBACK - 1);
    const entry = pts[cut]!.close;
    const exit = pts[cut + HORIZON]!.close;
    const fwd_pct = entry ? 100 * (exit / entry - 1) : 0;
    return {
      id: `${date}-${i}-${row.ticker}`,
      ticker: row.ticker,
      name: row.name,
      seen: seenRaw.map((p) => indexCandle(p, base)),
      next: nextRaw.map((p) => indexCandle(p, base)),
      fwd_pct,
    };
  });

  return {
    ok: true,
    date,
    horizon: HORIZON,
    start_equity: START_EQUITY,
    generated_at: new Date().toISOString(),
    rounds,
  };
}

export function getChartTrade(date: string): Promise<ChartTradePayload> {
  return withServerCache(
    `chart-trade:v2:${date}`,
    110_000,
    300_000,
    () => buildChartTrade(date),
  );
}

import { fetchDailyCloses } from "@/lib/simulate";

export const ROUNDS = 5;
export const LOOKBACK = 80;
export const HORIZON = 5;

export type Side = "buy" | "sell";

export type ChartPoint = {
  date: string;
  idx: number;
};

export type ChartTradeRound = {
  id: string;
  ticker: string;
  name: string;
  seen: ChartPoint[];
  next: ChartPoint[];
  fwd_pct: number;
};

export type ChartTradePayload = {
  ok: boolean;
  error?: string;
  date: string;
  horizon: number;
  generated_at: string;
  rounds: ChartTradeRound[];
};

export type TradePick = {
  roundId: string;
  side: Side;
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

export function fmtPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function pnlForSide(side: Side, fwdPct: number): number {
  return side === "buy" ? fwdPct : -fwdPct;
}

export function sumPnl(picks: TradePick[]): number {
  return picks.reduce((acc, p) => acc + p.pnl_pct, 0);
}

export function resultTitle(total: number): string {
  if (total >= 12) return "오늘 시장은 네 편";
  if (total >= 6) return "손맛 좋았음";
  if (total >= 2) return "플러스 컷";
  if (total > -2) return "본전 근처";
  if (total > -6) return "한 대 맞음";
  return "리셋이 답";
}

export function shareText(date: string, picks: TradePick[]): string {
  const total = sumPnl(picks);
  const lines = [
    `SavvyETF 모의투자  ${date}`,
    `합산 ${fmtPct(total)}  ·  ${resultTitle(total)}`,
    "",
    ...picks.map(
      (p) =>
        `${p.side === "buy" ? "매수" : "매도"}  ${p.ticker.padEnd(4)}  ${fmtPct(p.pnl_pct)}`,
    ),
    "",
    "https://savvyetf.com",
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

export function scoreRound(round: ChartTradeRound, side: Side): TradePick {
  return {
    roundId: round.id,
    side,
    pnl_pct: pnlForSide(side, round.fwd_pct),
    ticker: round.ticker,
    name: round.name,
    fwd_pct: round.fwd_pct,
  };
}

export async function buildChartTrade(date: string): Promise<ChartTradePayload> {
  const rand = mulberry32(hashDate(`chart-trade:v1:${date}`));
  const start = isoDaysAgo(420);
  const end = date;

  const fetched = await Promise.all(
    POOL.map(async (item) => {
      try {
        const points = await fetchDailyCloses(item.ticker, start, end);
        return { ...item, points };
      } catch {
        return { ...item, points: [] as Array<{ date: string; close: number }> };
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
    const fwd_pct = entry ? (100 * (exit / entry - 1)) : 0;
    return {
      id: `${date}-${i}-${row.ticker}`,
      ticker: row.ticker,
      name: row.name,
      seen: seenRaw.map((p) => ({
        date: p.date,
        idx: (100 * p.close) / base,
      })),
      next: nextRaw.map((p) => ({
        date: p.date,
        idx: (100 * p.close) / base,
      })),
      fwd_pct,
    };
  });

  return {
    ok: true,
    date,
    horizon: HORIZON,
    generated_at: new Date().toISOString(),
    rounds,
  };
}

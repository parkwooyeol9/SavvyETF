/**
 * US market snapshot — Yahoo daily closes already used elsewhere in the webapp.
 * No new crawlers / DB tables; thin payload for 미국시황 tab hero.
 */

import { computeTechnicals, type KrTechnicals } from "@/lib/krMarket";
import { fetchDailyCloses } from "@/lib/simulate";

export type UsCandle = { time: string; close: number };

export type UsQuoteCard = {
  symbol: string;
  name: string;
  last: number | null;
  change: number | null;
  change_pct: number | null;
  change_5d_pct: number | null;
  change_20d_pct: number | null;
};

export type UsBoard = UsQuoteCard & {
  daily: UsCandle[];
  technicals: KrTechnicals | null;
};

export type UsMarketPayload = {
  ok: boolean;
  generated_at: string;
  as_of: string | null;
  note: string;
  disclaimer: string;
  boards: UsBoard[];
  snaps: UsQuoteCard[];
  error?: string;
};

export const US_BOARD_SPECS = [
  { symbol: "SPY", name: "S&P 500 (SPY)" },
  { symbol: "QQQ", name: "나스닥100 (QQQ)" },
] as const;

export const US_SNAP_SPECS = [
  { symbol: "DIA", name: "다우 (DIA)" },
  { symbol: "IWM", name: "러셀2000 (IWM)" },
  { symbol: "^VIX", name: "VIX" },
  { symbol: "TLT", name: "미국채20Y+ (TLT)" },
  { symbol: "HYG", name: "하이일드 (HYG)" },
  { symbol: "UUP", name: "달러 (UUP)" },
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function pctFrom(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const last = closes[closes.length - 1]!;
  const prev = closes[closes.length - 1 - lookback]!;
  if (!prev) return null;
  return ((last - prev) / prev) * 100;
}

async function buildCard(
  symbol: string,
  name: string,
  withBoard: boolean,
): Promise<UsBoard | UsQuoteCard> {
  const start = isoDaysAgo(withBoard ? 220 : 40);
  const end = todayIso();
  let points: Awaited<ReturnType<typeof fetchDailyCloses>> = [];
  try {
    points = await fetchDailyCloses(symbol, start, end);
  } catch {
    points = [];
  }
  const closes = points.map((p) => p.close);
  const last = closes.length ? closes[closes.length - 1]! : null;
  const prev = closes.length >= 2 ? closes[closes.length - 2]! : null;
  const change =
    last != null && prev != null ? last - prev : null;
  const change_pct =
    last != null && prev != null && prev !== 0
      ? ((last - prev) / prev) * 100
      : null;

  const base: UsQuoteCard = {
    symbol,
    name,
    last,
    change,
    change_pct,
    change_5d_pct: pctFrom(closes, 5),
    change_20d_pct: pctFrom(closes, 20),
  };

  if (!withBoard) return base;

  const daily: UsCandle[] = points.slice(-90).map((p) => ({
    time: p.date,
    close: p.close,
  }));

  return {
    ...base,
    daily,
    technicals: closes.length >= 30 ? computeTechnicals(closes) : null,
  };
}

export async function buildUsMarketPayload(): Promise<UsMarketPayload> {
  const boardResults = await Promise.all(
    US_BOARD_SPECS.map((s) => buildCard(s.symbol, s.name, true)),
  );
  const snapResults = await Promise.all(
    US_SNAP_SPECS.map((s) => buildCard(s.symbol, s.name, false)),
  );

  const boards = boardResults as UsBoard[];
  const snaps = snapResults as UsQuoteCard[];
  const ok = boards.some((b) => b.last != null) || snaps.some((s) => s.last != null);
  const asOf =
    boards.find((b) => b.daily.length)?.daily.slice(-1)[0]?.time ||
    null;

  return {
    ok,
    generated_at: new Date().toISOString(),
    as_of: asOf,
    note: "Yahoo Finance 일봉 기반 요약 · 프로젝트 내 기존 시세 헬퍼 재사용",
    disclaimer: "투자 권유가 아닙니다. 지연·휴장일 반영 차이가 있을 수 있습니다.",
    boards,
    snaps,
    error: ok ? undefined : "미국 시세 데이터를 불러오지 못했습니다.",
  };
}

export function fmtUsPrice(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function fmtUsPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

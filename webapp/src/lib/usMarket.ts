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
  /** @deprecated use interpretation */
  note: string;
  /** 2–3 line market read from latest quote/TA/vol/rates snaps */
  interpretation: string[];
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

function snapBy(snaps: UsQuoteCard[], symbol: string): UsQuoteCard | undefined {
  return snaps.find((s) => s.symbol === symbol);
}

function boardBy(boards: UsBoard[], symbol: string): UsBoard | undefined {
  return boards.find((b) => b.symbol === symbol);
}

function fmtSigned(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function vixTone(level: number | null): string {
  if (level == null) return "확인 어려움";
  if (level < 14) return "낮은 편(안도)";
  if (level < 20) return "보통";
  if (level < 28) return "다소 높음";
  return "높은 편(경계)";
}

function rsiTone(rsi: number | null | undefined): string {
  if (rsi == null) return "";
  if (rsi >= 70) return "과매수 근접";
  if (rsi <= 30) return "과매도 근접";
  if (rsi >= 55) return "모멘텀 우세";
  if (rsi <= 45) return "모멘텀 약세";
  return "중립 구간";
}

/**
 * Rule-based 2–3 line read from boards + snaps (no external LLM).
 */
export function buildUsInterpretation(
  boards: UsBoard[],
  snaps: UsQuoteCard[],
): string[] {
  const spy = boardBy(boards, "SPY");
  const qqq = boardBy(boards, "QQQ");
  const vix = snapBy(snaps, "^VIX");
  const tlt = snapBy(snaps, "TLT");
  const hyg = snapBy(snaps, "HYG");
  const uup = snapBy(snaps, "UUP");
  const iwm = snapBy(snaps, "IWM");

  const lines: string[] = [];

  // 1) Equity technicals
  const spyRegime = spy?.technicals?.regime || "중립";
  const qqqRegime = qqq?.technicals?.regime || "중립";
  const spyRsi = spy?.technicals?.rsi14 ?? null;
  const qqqRsi = qqq?.technicals?.rsi14 ?? null;
  const techParts = [
    `SPY ${spyRegime}(RSI ${spyRsi != null ? spyRsi.toFixed(0) : "—"}, ${rsiTone(spyRsi) || "지표 부족"})`,
    `QQQ ${qqqRegime}(RSI ${qqqRsi != null ? qqqRsi.toFixed(0) : "—"}, ${rsiTone(qqqRsi) || "지표 부족"})`,
  ];
  const dayMove =
    spy?.change_pct != null || qqq?.change_pct != null
      ? ` 전일 대비 SPY ${fmtSigned(spy?.change_pct)} · QQQ ${fmtSigned(qqq?.change_pct)}.`
      : "";
  lines.push(`기술 지표: ${techParts.join(", ")}.${dayMove}`);

  // 2) Volatility + breadth proxy
  const vixLast = vix?.last ?? null;
  const vixChg = vix?.change_pct;
  let volLine = `변동성: VIX ${vixLast != null ? vixLast.toFixed(1) : "—"}로 ${vixTone(vixLast)}`;
  if (vixChg != null) volLine += `(전일 ${fmtSigned(vixChg)})`;
  if (iwm?.change_20d_pct != null && spy?.change_20d_pct != null) {
    const gap = iwm.change_20d_pct - spy.change_20d_pct;
    volLine +=
      gap >= 1
        ? `. 소형주(IWM)가 대형주 대비 20일 상대강세(+${gap.toFixed(1)}%p)입니다`
        : gap <= -1
          ? `. 소형주(IWM)가 대형주 대비 20일 상대약세(${gap.toFixed(1)}%p)입니다`
          : ". 소형·대형주 20일 흐름은 비슷한 편입니다";
  }
  lines.push(`${volLine}.`);

  // 3) Rates / credit / dollar
  const rateBits: string[] = [];
  if (tlt?.change_pct != null || tlt?.change_20d_pct != null) {
    const short = tlt.change_pct ?? 0;
    const mid = tlt.change_20d_pct;
    // TLT up ≈ yields down
    const yieldHint =
      short > 0.3
        ? "장기금리 하락 압력"
        : short < -0.3
          ? "장기금리 상승 압력"
          : "장기금리 횡보";
    rateBits.push(
      `국채(TLT) ${fmtSigned(tlt.change_pct)} → ${yieldHint}` +
        (mid != null ? `(20D ${fmtSigned(mid)})` : ""),
    );
  }
  if (hyg?.change_pct != null || hyg?.change_20d_pct != null) {
    const mid = hyg.change_20d_pct;
    const creditHint =
      (mid ?? hyg.change_pct ?? 0) > 0.5
        ? "신용스프레드 완화 쪽"
        : (mid ?? hyg.change_pct ?? 0) < -0.5
          ? "신용 경계 확대 쪽"
          : "신용 분위기 중립";
    rateBits.push(
      `하이일드(HYG) ${fmtSigned(hyg.change_pct)} · ${creditHint}`,
    );
  }
  if (uup?.change_pct != null || uup?.change_20d_pct != null) {
    const mid = uup.change_20d_pct;
    const dollarHint =
      (mid ?? uup.change_pct ?? 0) > 0.5
        ? "달러 강세"
        : (mid ?? uup.change_pct ?? 0) < -0.5
          ? "달러 약세"
          : "달러 혼조";
    rateBits.push(
      `달러(UUP) ${fmtSigned(uup.change_pct)} · ${dollarHint}` +
        (mid != null ? `(20D ${fmtSigned(mid)})` : ""),
    );
  }
  if (rateBits.length) {
    lines.push(`금리·신용·달러: ${rateBits.join(" / ")}.`);
  } else {
    lines.push(
      "금리·신용·달러: 보조 지표 데이터가 부족해 종합 평가를 보류합니다.",
    );
  }

  return lines.slice(0, 3);
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
  const interpretation = ok ? buildUsInterpretation(boards, snaps) : [];

  return {
    ok,
    generated_at: new Date().toISOString(),
    as_of: asOf,
    note: interpretation.join(" "),
    interpretation,
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

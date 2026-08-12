/**
 * 천만원 챌린지 — 업비트엔진 + 바이낸스엔진 + 김프차익 통합 뷰.
 */

import {
  buildBinancePaperPayload,
  CHALLENGE_BINANCE_ALLOC_USDT,
  type BinancePaperPayload,
} from "@/lib/binancePaperTrading";
import {
  buildCryptoPaperPayload,
  CHALLENGE_UPBIT_ALLOC_KRW,
  type CryptoPaperPayload,
} from "@/lib/cryptoPaperTrading";
import {
  evaluateKimchiArb,
  loadKimchiArbSignal,
  tickKimchiArb,
  type KimchiArbSignal,
} from "@/lib/kimchiArbEngine";

export const CHALLENGE_TOTAL_KRW = 10_000_000;
export const CHALLENGE_NAME = "가상자산 자동매매";

export type ChallengePayload = {
  ok: boolean;
  name: string;
  generated_at: string;
  generated_at_display: string;
  total_target_krw: number;
  upbit_alloc_krw: number;
  binance_alloc_usdt: number;
  usd_krw: number | null;
  upbit: CryptoPaperPayload;
  binance: BinancePaperPayload;
  kimchi_arb: KimchiArbSignal;
  combined_equity_krw: number | null;
  combined_return_pct: number | null;
  summary: string[];
  note: string;
  error?: string;
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

async function fetchUsdKrw(): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?period1=${Math.floor(Date.now() / 1000) - 86400}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`,
      { cache: "no-store", signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const fx = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return fx != null && fx > 0 ? fx : null;
  } catch {
    return null;
  }
}

export async function buildChallengePayload(options?: {
  forceTick?: boolean;
  refreshKimchi?: boolean;
}): Promise<ChallengePayload> {
  const [upbit, binance, fx] = await Promise.all([
    buildCryptoPaperPayload({ forceTick: options?.forceTick }),
    buildBinancePaperPayload({ forceTick: options?.forceTick }),
    fetchUsdKrw(),
  ]);

  let kimchi_arb: KimchiArbSignal;
  if (options?.forceTick || options?.refreshKimchi) {
    kimchi_arb = await tickKimchiArb();
  } else {
    kimchi_arb = (await loadKimchiArbSignal()) || (await evaluateKimchiArb());
    if (kimchi_arb.arb_action === "unavailable") {
      kimchi_arb = await evaluateKimchiArb();
    }
  }

  const binanceKrw =
    fx != null && binance.equity_usdt > 0 ? binance.equity_usdt * fx : null;
  const combined =
    binanceKrw != null ? upbit.equity_krw + binanceKrw : upbit.equity_krw;
  const combinedRet =
    CHALLENGE_TOTAL_KRW > 0
      ? (100 * (combined - CHALLENGE_TOTAL_KRW)) / CHALLENGE_TOTAL_KRW
      : null;

  const summary = [
    `업비트엔진: ${upbit.return_pct >= 0 ? "+" : ""}${upbit.return_pct.toFixed(2)}%`,
    `바이낸스엔진: ${binance.return_pct >= 0 ? "+" : ""}${binance.return_pct.toFixed(2)}%`,
    kimchi_arb.kimchi_pct != null
      ? `김프 BTC: ${kimchi_arb.kimchi_pct.toFixed(2)}% · ${kimchi_arb.arb_action_ko}`
      : "김프: 데이터 없음",
  ];

  return {
    ok: upbit.ok && binance.ok,
    name: CHALLENGE_NAME,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    total_target_krw: CHALLENGE_TOTAL_KRW,
    upbit_alloc_krw: CHALLENGE_UPBIT_ALLOC_KRW,
    binance_alloc_usdt: CHALLENGE_BINANCE_ALLOC_USDT,
    usd_krw: fx,
    upbit,
    binance,
    kimchi_arb,
    combined_equity_krw: combined,
    combined_return_pct: combinedRet,
    summary,
    note: "",
  };
}

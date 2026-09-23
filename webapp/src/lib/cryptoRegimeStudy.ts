/**
 * Regime study: BTC vs ETH return distributions across
 *   - Asia equity hours (UTC 00:00–08:00, weekdays)
 *   - US cash RTH (UTC 13:30–20:00, weekdays; DST-agnostic approx)
 *   - Weekend (Sat/Sun UTC) when traditional markets are closed
 *
 * Uses OKX USDT-M perpetual 5m candles (crypto trades 24/7).
 */

import {
  classifySessionRegime,
  LIVE_FETCH_MAX_PAGES,
  LIVE_FETCH_TARGET_BARS,
} from "@/lib/cryptoSessionRegime";

export type CryptoRegimeId = "asia" | "us" | "weekend";

export type RegimeStats = {
  id: CryptoRegimeId;
  label_ko: string;
  window_note: string;
  n_bars: number;
  mean_ret_pct: number;
  vol_pct: number;
  skew: number;
  kurtosis_excess: number;
  abs_mean_pct: number;
  p_up: number;
  q05_pct: number;
  q50_pct: number;
  q95_pct: number;
  density: Array<{ x_pct: number; density: number }>;
};

export type AssetRegimePanel = {
  id: "btc" | "eth";
  symbol: string;
  label: string;
  source: string;
  bars_used: number;
  lookback_days: number | null;
  regimes: RegimeStats[];
  summary_ko: string;
  error?: string;
};

export type CryptoRegimePayload = {
  ok: boolean;
  generated_at: string;
  bar: "5m";
  assets: AssetRegimePanel[];
  methodology: string[];
  headline_ko: string;
  error?: string;
};

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const REGIME_META: Record<
  CryptoRegimeId,
  { label_ko: string; window_note: string }
> = {
  asia: {
    label_ko: "아시아장",
    window_note: "평일 UTC 00:00–08:00 (도쿄·홍콩 주간 근사)",
  },
  us: {
    label_ko: "미국장",
    window_note: "평일 UTC 13:30–20:00 (NYSE RTH 근사, DST 단순화)",
  },
  weekend: {
    label_ko: "주말(정규장 휴장)",
    window_note: "토·일 UTC 전일 — 주식·상품 정규장 휴장, 크립토만 연속 거래",
  },
};

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(
    xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1),
  );
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = Math.max(0, Math.min(1, q)) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  const w = pos - lo;
  return s[lo]! * (1 - w) + s[hi]! * w;
}

function skewness(xs: number[]): number {
  if (xs.length < 3) return 0;
  const m = mean(xs);
  const s = std(xs) || 1e-12;
  const n = xs.length;
  const m3 = xs.reduce((a, b) => a + ((b - m) / s) ** 3, 0) / n;
  return m3;
}

function excessKurtosis(xs: number[]): number {
  if (xs.length < 4) return 0;
  const m = mean(xs);
  const s = std(xs) || 1e-12;
  const n = xs.length;
  const m4 = xs.reduce((a, b) => a + ((b - m) / s) ** 4, 0) / n;
  return m4 - 3;
}

function densityHist(retsPct: number[]): Array<{ x_pct: number; density: number }> {
  if (retsPct.length < 10) return [];
  const lo = quantile(retsPct, 0.02);
  const hi = quantile(retsPct, 0.98);
  const pad = Math.max((hi - lo) * 0.1, 0.02);
  const start = lo - pad;
  const end = hi + pad;
  const bins = 31;
  const width = (end - start) / bins;
  const counts = new Array(bins).fill(0);
  for (const x of retsPct) {
    if (x < start || x > end) continue;
    const i = Math.min(bins - 1, Math.max(0, Math.floor((x - start) / width)));
    counts[i] += 1;
  }
  const peak = Math.max(...counts, 1);
  return counts.map((c, i) => ({
    x_pct: Number((start + (i + 0.5) * width).toFixed(4)),
    density: Number((c / peak).toFixed(4)),
  }));
}

/** Shared x-grid so overlay PDFs align (avoids jagged per-regime histograms). */
function sharedDensityAxis(series: number[][], points = 81): number[] {
  const pooled = series.flat().filter((x) => Number.isFinite(x));
  if (pooled.length < 20) return [];
  const lo = quantile(pooled, 0.01);
  const hi = quantile(pooled, 0.99);
  const pad = Math.max((hi - lo) * 0.12, 0.03);
  const start = lo - pad;
  const end = hi + pad;
  if (!(end > start)) return [];
  const xs: number[] = [];
  for (let i = 0; i < points; i++) {
    xs.push(start + ((end - start) * i) / (points - 1));
  }
  return xs;
}

/** Gaussian KDE on a fixed axis; peak-normalized to 1 for shape compare. */
function kdeOnAxis(
  retsPct: number[],
  xs: number[],
): Array<{ x_pct: number; density: number }> {
  if (retsPct.length < 10 || xs.length < 5) return [];
  // Cap kernel sum cost on deep archives.
  let sample = retsPct;
  if (retsPct.length > 4_000) {
    const step = Math.ceil(retsPct.length / 4_000);
    sample = retsPct.filter((_, i) => i % step === 0);
  }
  const s = std(sample) || 1e-6;
  // Silverman-ish bandwidth, floored so curves stay smooth on 5m noise.
  const h = Math.max(
    0.015,
    1.06 * s * Math.pow(sample.length, -0.2) * 1.15,
  );
  const inv = 1 / (h * Math.sqrt(2 * Math.PI));
  const dens = xs.map((x) => {
    let acc = 0;
    for (const r of sample) {
      const z = (x - r) / h;
      if (Math.abs(z) > 4) continue;
      acc += Math.exp(-0.5 * z * z);
    }
    return acc * inv;
  });
  const peak = Math.max(...dens, 1e-12);
  return xs.map((x, i) => ({
    x_pct: Number(x.toFixed(4)),
    density: Number((dens[i]! / peak).toFixed(4)),
  }));
}

type Bar = { ts: number; close: number };

function regimeOf(ts: number): CryptoRegimeId | null {
  const reg = classifySessionRegime(ts);
  if (reg === "other") return null; // weekday off-hours — excluded from a/b/c
  return reg;
}

async function fetchOkx5m(
  instId: string,
  target = LIVE_FETCH_TARGET_BARS,
): Promise<Bar[]> {
  const out: Bar[] = [];
  let after: string | undefined;
  for (
    let page = 0;
    page < LIVE_FETCH_MAX_PAGES && out.length < target;
    page++
  ) {
    const qs = new URLSearchParams({
      instId,
      bar: "5m",
      limit: "300",
    });
    if (after) qs.set("after", after);
    const path = page === 0 && !after ? "candles" : "history-candles";
    const res = await fetch(
      `https://www.okx.com/api/v5/market/${path}?${qs.toString()}`,
      { headers: { "User-Agent": UA }, cache: "no-store" },
    );
    if (!res.ok) {
      if (path === "history-candles") break;
      continue;
    }
    const json = (await res.json()) as { data?: string[][] };
    const rows = json.data || [];
    if (!rows.length) break;
    for (const row of rows) {
      const ts = Number(row[0]);
      const c = Number(row[4]);
      const confirm = row[8] != null ? Number(row[8]) : 1;
      if (!Number.isFinite(ts) || !(c > 0) || confirm === 0) continue;
      out.push({ ts, close: c });
    }
    after = String(rows[rows.length - 1]![0]);
    if (rows.length < 50) break;
  }
  out.sort((a, b) => a.ts - b.ts);
  const seen = new Set<number>();
  const now = Date.now();
  return out.filter((b) => {
    if (seen.has(b.ts)) return false;
    seen.add(b.ts);
    return b.ts + 5 * 60_000 <= now;
  });
}

function statsFor(
  rets: number[],
  id: CryptoRegimeId,
  density: Array<{ x_pct: number; density: number }>,
): RegimeStats {
  const meta = REGIME_META[id];
  const pct = rets.map((r) => r * 100);
  return {
    id,
    label_ko: meta.label_ko,
    window_note: meta.window_note,
    n_bars: rets.length,
    mean_ret_pct: Number(mean(pct).toFixed(5)),
    vol_pct: Number(std(pct).toFixed(5)),
    skew: Number(skewness(pct).toFixed(3)),
    kurtosis_excess: Number(excessKurtosis(pct).toFixed(3)),
    abs_mean_pct: Number(mean(pct.map(Math.abs)).toFixed(5)),
    p_up: Number(
      (rets.filter((r) => r > 0).length / Math.max(rets.length, 1)).toFixed(4),
    ),
    q05_pct: Number(quantile(pct, 0.05).toFixed(4)),
    q50_pct: Number(quantile(pct, 0.5).toFixed(4)),
    q95_pct: Number(quantile(pct, 0.95).toFixed(4)),
    density,
  };
}

function summarizeAsset(
  symbol: string,
  byRegime: Record<CryptoRegimeId, RegimeStats>,
): string {
  const a = byRegime.asia;
  const u = byRegime.us;
  const w = byRegime.weekend;
  if (!a.n_bars || !u.n_bars || !w.n_bars) {
    return `${symbol}: 레짐별 표본이 부족합니다.`;
  }
  const vols = [
    { k: "아시아장", v: a.vol_pct },
    { k: "미국장", v: u.vol_pct },
    { k: "주말", v: w.vol_pct },
  ].sort((x, y) => y.v - x.v);
  const quiet = [...vols].sort((x, y) => x.v - y.v)[0]!;
  const wild = vols[0]!;
  const fat =
    w.kurtosis_excess > u.kurtosis_excess && w.kurtosis_excess > a.kurtosis_excess
      ? "주말에 꼬리(초과첨도)가 두꺼워지는 편"
      : u.kurtosis_excess >= a.kurtosis_excess
        ? "미국장에서 꼬리가 상대적으로 두꺼운 편"
        : "아시아장에서 꼬리가 상대적으로 두꺼운 편";
  return (
    `${symbol}: 5분 변동성(σ)은 ${wild.k}(${wild.v.toFixed(3)}%) > ` +
    `${vols[1]!.k}(${vols[1]!.v.toFixed(3)}%) > ${quiet.k}(${quiet.v.toFixed(3)}%). ` +
    `주말 P(상승)=${(w.p_up * 100).toFixed(0)}% · 미국 ${(u.p_up * 100).toFixed(0)}% · 아시아 ${(a.p_up * 100).toFixed(0)}%. ` +
    `${fat}. ` +
    `정규장 휴장(주말)에도 연속 거래되지만, 유동성·이벤트 밀도가 달라 분포 폭·꼬리가 평일과 어긋납니다.`
  );
}

async function analyzeAsset(
  id: "btc" | "eth",
  instId: string,
  symbol: string,
  label: string,
): Promise<AssetRegimePanel> {
  try {
    const bars = await fetchOkx5m(instId);
    if (bars.length < 200) {
      return {
        id,
        symbol,
        label,
        source: `OKX ${instId}`,
        bars_used: bars.length,
        lookback_days: null,
        regimes: [],
        summary_ko: "",
        error: "분봉 부족",
      };
    }
    const buckets: Record<CryptoRegimeId, number[]> = {
      asia: [],
      us: [],
      weekend: [],
    };
    for (let i = 1; i < bars.length; i++) {
      const reg = regimeOf(bars[i]!.ts);
      if (!reg) continue;
      const prev = bars[i - 1]!.close;
      const cur = bars[i]!.close;
      if (!(prev > 0 && cur > 0)) continue;
      buckets[reg].push(Math.log(cur / prev));
    }
    const ids = ["asia", "us", "weekend"] as CryptoRegimeId[];
    const pctBuckets = Object.fromEntries(
      ids.map((rid) => [rid, buckets[rid].map((r) => r * 100)]),
    ) as Record<CryptoRegimeId, number[]>;
    const axis = sharedDensityAxis(ids.map((rid) => pctBuckets[rid]));
    const regimes = ids.map((rid) =>
      statsFor(
        buckets[rid],
        rid,
        axis.length
          ? kdeOnAxis(pctBuckets[rid], axis)
          : densityHist(pctBuckets[rid]),
      ),
    );
    const by = Object.fromEntries(regimes.map((r) => [r.id, r])) as Record<
      CryptoRegimeId,
      RegimeStats
    >;
    const span =
      bars.length >= 2
        ? (bars[bars.length - 1]!.ts - bars[0]!.ts) / 86_400_000
        : null;
    return {
      id,
      symbol,
      label,
      source: `OKX ${instId} 5m`,
      bars_used: bars.length,
      lookback_days: span != null ? Number(span.toFixed(1)) : null,
      regimes,
      summary_ko: summarizeAsset(symbol, by),
    };
  } catch (exc) {
    return {
      id,
      symbol,
      label,
      source: instId,
      bars_used: 0,
      lookback_days: null,
      regimes: [],
      summary_ko: "",
      error: exc instanceof Error ? exc.message : String(exc),
    };
  }
}

export const CRYPTO_REGIME_METHODOLOGY: string[] = [
  "대상: OKX BTC-USDT-SWAP · ETH-USDT-SWAP 5분 로그수익률 (무기한 선물, 현물 아님).",
  "레짐 A 아시아장: 평일 UTC 00:00–08:00.",
  "레짐 B 미국장: 평일 UTC 13:30–20:00 (NYSE RTH 근사).",
  "레짐 C 주말: 토·일 UTC — 주식·상품 정규장 휴장, 크립토만 24/7.",
  "평일 그 외 시간(유럽 단독 구간 등)은 a/b/c 비교에서 제외.",
  "지표: 평균·σ·왜도·초과첨도·|r|평균·P(상승)·q05/50/95 · 공통축 Gaussian KDE(피크=1).",
];

export async function computeCryptoRegimeStudy(): Promise<CryptoRegimePayload> {
  const [btc, eth] = await Promise.all([
    analyzeAsset("btc", "BTC-USDT-SWAP", "BTCUSDT.P", "Bitcoin"),
    analyzeAsset("eth", "ETH-USDT-SWAP", "ETHUSDT.P", "Ethereum (알트 대표)"),
  ]);
  const ok = btc.regimes.length > 0 || eth.regimes.length > 0;
  const headline = [
    btc.summary_ko,
    eth.summary_ko,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ok,
    generated_at: new Date().toISOString(),
    bar: "5m",
    assets: [btc, eth],
    methodology: CRYPTO_REGIME_METHODOLOGY,
    headline_ko:
      headline ||
      "레짐별 분포를 계산하지 못했습니다. 잠시 후 다시 시도하세요.",
    error: ok ? undefined : "레짐 분석 실패",
  };
}

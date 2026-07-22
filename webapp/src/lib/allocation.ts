/** Portfolio weight engines for the ETF allocation tab. */

import {
  CATALOG_BY_SYMBOL,
  DIVIDEND_STYLE_LABELS,
  type AllocMethod,
  type AssetClass,
  type DividendStyle,
} from "@/lib/etfCatalog";

export const DEFAULT_ASSET_TARGETS: Record<AssetClass, number> = {
  equity: 60,
  bond: 30,
  alt: 10,
};

export const DEFAULT_REGION_TARGETS: Record<
  "us" | "europe" | "japan" | "china" | "korea",
  number
> = {
  us: 60,
  europe: 10,
  japan: 10,
  china: 10,
  korea: 10,
};

/** Quality / high / intl / monthly income mix for 배당투자. */
export const DEFAULT_DIVIDEND_TARGETS: Record<DividendStyle, number> = {
  quality_div: 40,
  high_div: 25,
  intl_div: 20,
  monthly_income: 15,
};

export type RegionBucket = keyof typeof DEFAULT_REGION_TARGETS;

export const ASSET_LABELS: Record<AssetClass, string> = {
  equity: "주식",
  bond: "채권",
  alt: "대안",
};

export const REGION_LABELS: Record<RegionBucket, string> = {
  us: "미국",
  europe: "유럽",
  japan: "일본",
  china: "중국",
  korea: "한국",
};

export const DIVIDEND_LABELS = DIVIDEND_STYLE_LABELS;

function normalize(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 1 / Math.max(weights.length, 1));
  return weights.map((w) => w / sum);
}

function pctToFraction(targetsPct: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(targetsPct)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum <= 0) return {};
  // Allow 99–101 rounding drift; otherwise keep relative proportions.
  for (const k of Object.keys(out)) out[k] = out[k] / sum;
  return out;
}

export function equalWeights(tickers: string[]): number[] {
  const n = tickers.length || 1;
  return tickers.map(() => 1 / n);
}

export type VolDiag = {
  ticker: string;
  daily_vol: number;
  annual_vol_pct: number;
  inv_vol_weight: number;
};

/** Sample daily σ per ticker, then w_i ∝ 1/σ_i (inverse volatility). */
export function invVolWeights(
  tickers: string[],
  legReturns: Record<string, number[]>,
): { weights: number[]; diagnostics: VolDiag[] } {
  const diags: VolDiag[] = tickers.map((t) => {
    const rets = (legReturns[t] || []).slice(1).filter((r) => Number.isFinite(r));
    if (rets.length < 5) {
      return { ticker: t, daily_vol: 0, annual_vol_pct: 0, inv_vol_weight: 0 };
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance =
      rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
    const dailyVol = Math.sqrt(Math.max(variance, 0));
    return {
      ticker: t,
      daily_vol: dailyVol,
      annual_vol_pct: dailyVol * Math.sqrt(252) * 100,
      inv_vol_weight: dailyVol > 1e-8 ? 1 / dailyVol : 0,
    };
  });

  if (diags.every((d) => d.inv_vol_weight <= 0)) {
    const eq = equalWeights(tickers);
    return {
      weights: eq,
      diagnostics: diags.map((d, i) => ({ ...d, inv_vol_weight: eq[i] })),
    };
  }

  const weights = normalize(diags.map((d) => d.inv_vol_weight));
  return {
    weights,
    diagnostics: diags.map((d, i) => ({ ...d, inv_vol_weight: weights[i] })),
  };
}

/**
 * Bucket allocation: each positive target bucket must have ≥1 ETF.
 * Within a bucket, weight is split equally (or by optional withinBucket).
 * Targets are percents (e.g. 60) and are normalized to sum to 1.
 */
export function bucketWeights(
  tickers: string[],
  bucketOf: (symbol: string) => string | null,
  targetsPct: Record<string, number>,
): { weights: number[]; note?: string; error?: string } {
  const byBucket: Record<string, string[]> = {};
  const unknown: string[] = [];
  for (const t of tickers) {
    const b = bucketOf(t);
    if (!b) {
      unknown.push(t);
      continue;
    }
    (byBucket[b] ||= []).push(t);
  }

  const fractions = pctToFraction(targetsPct);
  const activeBuckets = Object.keys(fractions);
  if (!activeBuckets.length) {
    return { weights: [], error: "배분 비중을 하나 이상 0보다 크게 설정하세요." };
  }

  const empty = activeBuckets.filter((b) => !(byBucket[b] || []).length);
  if (empty.length) {
    return {
      weights: [],
      error: `비중이 있는 버킷에 ETF가 없습니다: ${empty.join(", ")}`,
    };
  }

  const weightMap: Record<string, number> = {};
  for (const b of activeBuckets) {
    const members = byBucket[b];
    const slice = fractions[b];
    for (const t of members) weightMap[t] = slice / members.length;
  }

  let note: string | undefined;
  const unused = Object.keys(byBucket).filter((b) => !fractions[b]);
  if (unused.length) {
    note = `비중 0인 버킷 ETF는 제외됨: ${unused.join(", ")}`;
  }
  if (unknown.length) {
    note = `${note ? `${note} · ` : ""}버킷 밖 티커 제외: ${unknown.join(", ")}`;
  }

  // Only include tickers that received weight (drop zero buckets).
  const ordered = tickers.filter((t) => (weightMap[t] || 0) > 0);
  if (!ordered.length) {
    return { weights: [], error: "유효한 배분 비중이 없습니다." };
  }

  return {
    weights: normalize(tickers.map((t) => weightMap[t] || 0)),
    note,
  };
}

export function assetClassWeights(
  tickers: string[],
  targetsPct: Record<AssetClass, number> = DEFAULT_ASSET_TARGETS,
): { weights: number[]; note?: string; error?: string } {
  return bucketWeights(
    tickers,
    (sym) => CATALOG_BY_SYMBOL[sym]?.assetClass ?? null,
    targetsPct,
  );
}

export function regionBucketWeights(
  tickers: string[],
  targetsPct: Record<RegionBucket, number> = DEFAULT_REGION_TARGETS,
): { weights: number[]; note?: string; error?: string } {
  const regionKeys = new Set(Object.keys(DEFAULT_REGION_TARGETS));
  return bucketWeights(
    tickers,
    (sym) => {
      const r = CATALOG_BY_SYMBOL[sym]?.region;
      if (!r || !regionKeys.has(r)) return null;
      return r;
    },
    targetsPct,
  );
}

export function dividendBucketWeights(
  tickers: string[],
  targetsPct: Record<DividendStyle, number> = DEFAULT_DIVIDEND_TARGETS,
): { weights: number[]; note?: string; error?: string } {
  const r = bucketWeights(
    tickers,
    (sym) => CATALOG_BY_SYMBOL[sym]?.dividendStyle ?? null,
    targetsPct,
  );
  if (r.error) {
    // Friendlier labels in Korean for empty buckets.
    const pretty = r.error.replace(
      /: (.+)$/,
      (_, keys: string) =>
        `: ${keys
          .split(", ")
          .map((k) => DIVIDEND_LABELS[k as DividendStyle] || k)
          .join(", ")}`,
    );
    return { ...r, error: pretty };
  }
  return r;
}

export type ResolveOpts = {
  method: AllocMethod;
  tickers: string[];
  legReturns?: Record<string, number[]>;
  assetTargets?: Record<AssetClass, number>;
  regionTargets?: Record<RegionBucket, number>;
  dividendTargets?: Record<DividendStyle, number>;
};

export function resolveMethodWeights(opts: ResolveOpts): {
  weights: number[];
  method: AllocMethod;
  note?: string;
  error?: string;
  volDiagnostics?: VolDiag[];
  /** Tickers that actually received weight (zeros dropped for clarity). */
  activeTickers?: string[];
} {
  const {
    method,
    tickers,
    legReturns,
    assetTargets,
    regionTargets,
    dividendTargets,
  } = opts;

  if (method === "inv_vol") {
    if (!legReturns) {
      return {
        weights: equalWeights(tickers),
        method: "equal",
        note: "변동성 데이터가 없어 동일가중으로 대체했습니다.",
      };
    }
    const { weights, diagnostics } = invVolWeights(tickers, legReturns);
    return { weights, method, volDiagnostics: diagnostics };
  }

  if (method === "asset") {
    const r = assetClassWeights(tickers, assetTargets || DEFAULT_ASSET_TARGETS);
    if (r.error) return { weights: [], method, error: r.error };
    return { weights: r.weights, method, note: r.note };
  }

  if (method === "region") {
    const r = regionBucketWeights(tickers, regionTargets || DEFAULT_REGION_TARGETS);
    if (r.error) return { weights: [], method, error: r.error };
    return { weights: r.weights, method, note: r.note };
  }

  if (method === "dividend") {
    const r = dividendBucketWeights(
      tickers,
      dividendTargets || DEFAULT_DIVIDEND_TARGETS,
    );
    if (r.error) return { weights: [], method, error: r.error };
    return { weights: r.weights, method, note: r.note };
  }

  return { weights: equalWeights(tickers), method: "equal" };
}

/** @deprecated alias — older method id */
export function asset631Weights(tickers: string[]) {
  return assetClassWeights(tickers, DEFAULT_ASSET_TARGETS);
}

export function regionWeights(tickers: string[]) {
  return regionBucketWeights(tickers, DEFAULT_REGION_TARGETS);
}

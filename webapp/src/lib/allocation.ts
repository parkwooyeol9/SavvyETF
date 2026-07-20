/** Portfolio weight engines for the simulation tab. */

import {
  CATALOG_BY_SYMBOL,
  type AllocMethod,
  type AssetClass,
  type Region,
} from "@/lib/etfCatalog";

const ASSET_TARGETS: Record<AssetClass, number> = {
  equity: 0.6,
  bond: 0.3,
  alt: 0.1,
};

const REGION_TARGETS: Partial<Record<Region, number>> = {
  us: 0.6,
  europe: 0.1,
  japan: 0.1,
  china: 0.1,
  korea: 0.1,
};

function normalize(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 1 / Math.max(weights.length, 1));
  return weights.map((w) => w / sum);
}

function redistributeTargets(
  targets: Record<string, number>,
  presentKeys: string[],
): Record<string, number> {
  const present = presentKeys.filter((k) => (targets[k] || 0) > 0);
  if (!present.length) return {};
  const kept = present.reduce((a, k) => a + (targets[k] || 0), 0);
  const out: Record<string, number> = {};
  for (const k of present) out[k] = (targets[k] || 0) / kept;
  return out;
}

export function equalWeights(tickers: string[]): number[] {
  const n = tickers.length || 1;
  return tickers.map(() => 1 / n);
}

/** Inverse-volatility weights from aligned daily return series (skip index 0). */
export function invVolWeights(
  tickers: string[],
  legReturns: Record<string, number[]>,
): number[] {
  const raw = tickers.map((t) => {
    const rets = (legReturns[t] || []).slice(1).filter((r) => Number.isFinite(r));
    if (rets.length < 5) return 0;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance =
      rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
    const vol = Math.sqrt(Math.max(variance, 0));
    return vol > 1e-8 ? 1 / vol : 0;
  });
  if (raw.every((w) => w <= 0)) return equalWeights(tickers);
  return normalize(raw);
}

export function asset631Weights(tickers: string[]): {
  weights: number[];
  note?: string;
} {
  const byClass: Record<AssetClass, string[]> = {
    equity: [],
    bond: [],
    alt: [],
  };
  const unknown: string[] = [];
  for (const t of tickers) {
    const meta = CATALOG_BY_SYMBOL[t];
    if (!meta) {
      unknown.push(t);
      continue;
    }
    byClass[meta.assetClass].push(t);
  }

  const present = (Object.keys(byClass) as AssetClass[]).filter(
    (k) => byClass[k].length > 0,
  );
  if (!present.length) {
    return {
      weights: equalWeights(tickers),
      note: "자산군 태그가 없어 동일가중으로 대체했습니다.",
    };
  }

  const targets = redistributeTargets(
    ASSET_TARGETS as unknown as Record<string, number>,
    present,
  );
  const weightMap: Record<string, number> = {};
  for (const cls of present) {
    const members = byClass[cls];
    const slice = targets[cls] || 0;
    for (const t of members) weightMap[t] = slice / members.length;
  }
  for (const t of unknown) weightMap[t] = 0;

  const missing = (Object.keys(ASSET_TARGETS) as AssetClass[]).filter(
    (k) => !byClass[k].length,
  );
  let note: string | undefined;
  if (missing.length) {
    note = `선택에 없는 자산군(${missing.join(", ")}) 비중은 나머지에 재배분했습니다.`;
  }
  if (unknown.length) {
    note = `${note ? `${note} ` : ""}카탈로그 밖 티커는 제외: ${unknown.join(", ")}`;
  }

  return { weights: normalize(tickers.map((t) => weightMap[t] || 0)), note };
}

export function regionWeights(tickers: string[]): {
  weights: number[];
  note?: string;
} {
  const byRegion: Partial<Record<Region, string[]>> = {};
  const skipped: string[] = [];
  for (const t of tickers) {
    const meta = CATALOG_BY_SYMBOL[t];
    if (!meta || !(meta.region in REGION_TARGETS)) {
      skipped.push(t);
      continue;
    }
    const list = byRegion[meta.region] || [];
    list.push(t);
    byRegion[meta.region] = list;
  }

  const present = Object.keys(byRegion) as Region[];
  if (!present.length) {
    return {
      weights: equalWeights(tickers),
      note: "국가 배분 대상(미국·유럽·일본·중국·한국) ETF가 없어 동일가중으로 대체했습니다.",
    };
  }

  const targets = redistributeTargets(
    REGION_TARGETS as Record<string, number>,
    present,
  );
  const weightMap: Record<string, number> = {};
  for (const region of present) {
    const members = byRegion[region] || [];
    const slice = targets[region] || 0;
    for (const t of members) weightMap[t] = slice / members.length;
  }

  let note: string | undefined;
  const expected = Object.keys(REGION_TARGETS) as Region[];
  const missing = expected.filter((r) => !(byRegion[r] || []).length);
  if (missing.length) {
    note = `없는 국가(${missing.join(", ")}) 비중은 나머지에 재배분했습니다.`;
  }
  if (skipped.length) {
    note = `${note ? `${note} ` : ""}국가 배분에서 제외: ${skipped.join(", ")}`;
  }

  return { weights: normalize(tickers.map((t) => weightMap[t] || 0)), note };
}

export function resolveMethodWeights(
  method: AllocMethod,
  tickers: string[],
  legReturns?: Record<string, number[]>,
): { weights: number[]; method: AllocMethod; note?: string } {
  if (method === "inv_vol") {
    if (!legReturns) {
      return {
        weights: equalWeights(tickers),
        method: "equal",
        note: "변동성 데이터가 없어 동일가중으로 대체했습니다.",
      };
    }
    return { weights: invVolWeights(tickers, legReturns), method };
  }
  if (method === "asset_631") {
    const r = asset631Weights(tickers);
    return { weights: r.weights, method, note: r.note };
  }
  if (method === "region") {
    const r = regionWeights(tickers);
    return { weights: r.weights, method, note: r.note };
  }
  return { weights: equalWeights(tickers), method: "equal" };
}

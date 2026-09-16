/** Persisted multi-ETF holdings basket for 편입비 메인 (compare + track). */

export type EtfHoldingsMarket = "KR" | "US";

export type HoldingSnap = {
  code: string;
  name: string;
  weight_pct: number | null;
  change_pct?: number | null;
};

export type FundStats = {
  holding_count?: number;
  top5_weight_pct?: number | null;
  top10_weight_pct?: number | null;
  max_weight_pct?: number | null;
  coverage_weight_pct?: number | null;
};

export type BasketItem = {
  ticker: string;
  market: EtfHoldingsMarket;
  name: string;
};

export type FundSnapshot = {
  ticker: string;
  market: EtfHoldingsMarket;
  name: string;
  type?: string | null;
  region?: string | null;
  as_of?: string | null;
  aum_label?: string | null;
  source?: string;
  source_note?: string;
  fetched_at: string;
  holdings: HoldingSnap[];
  stats?: FundStats;
};

export type BasketStore = {
  items: BasketItem[];
  snapshots: Record<string, FundSnapshot>;
  prev: Record<string, FundSnapshot>;
};

export const ETF_HOLDINGS_BASKET_KEY = "savvyetf:etf-holdings-basket:v1";
export const MAX_HOLDINGS_BASKET = 5;

export function fundKey(market: EtfHoldingsMarket, ticker: string): string {
  return `${market}:${ticker.trim().toUpperCase()}`;
}

export function holdingKey(row: { code?: string | null; name?: string | null }): string {
  const code = String(row.code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (code) return code;
  return String(row.name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function emptyBasket(): BasketStore {
  return { items: [], snapshots: {}, prev: {} };
}

export function loadBasket(): BasketStore {
  if (typeof window === "undefined") return emptyBasket();
  try {
    const raw = window.localStorage.getItem(ETF_HOLDINGS_BASKET_KEY);
    if (!raw) return emptyBasket();
    const parsed = JSON.parse(raw) as Partial<BasketStore>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items.slice(0, MAX_HOLDINGS_BASKET) : [],
      snapshots: parsed.snapshots && typeof parsed.snapshots === "object" ? parsed.snapshots : {},
      prev: parsed.prev && typeof parsed.prev === "object" ? parsed.prev : {},
    };
  } catch {
    return emptyBasket();
  }
}

export function saveBasket(store: BasketStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ETF_HOLDINGS_BASKET_KEY,
      JSON.stringify({
        items: store.items.slice(0, MAX_HOLDINGS_BASKET),
        snapshots: store.snapshots,
        prev: store.prev,
      }),
    );
  } catch {
    /* quota */
  }
}

export const ETF_HOLDINGS_SETS_KEY = "savvyetf:etf-holdings-sets:v1";
export const MAX_COMPARE_SETS = 12;

export type CompareSet = {
  id: string;
  name: string;
  items: BasketItem[];
};

export type HoldingsLibrary = {
  activeId: string;
  sets: CompareSet[];
  snapshots: Record<string, FundSnapshot>;
  prev: Record<string, FundSnapshot>;
};

export const COMPARE_TEMPLATES: Array<{ id: string; name: string; items: BasketItem[] }> = [
  {
    id: "kr-kospi",
    name: "국내 대표",
    items: [
      { ticker: "069500", market: "KR", name: "KODEX 200" },
      { ticker: "102110", market: "KR", name: "TIGER 200" },
    ],
  },
  {
    id: "semi",
    name: "반도체",
    items: [
      { ticker: "091160", market: "KR", name: "KODEX 반도체" },
      { ticker: "SOXX", market: "US", name: "iShares Semiconductor" },
    ],
  },
  {
    id: "us-large",
    name: "미국 대형",
    items: [
      { ticker: "SPY", market: "US", name: "SPDR S&P 500" },
      { ticker: "VOO", market: "US", name: "Vanguard S&P 500" },
      { ticker: "QQQ", market: "US", name: "Invesco QQQ" },
    ],
  },
  {
    id: "battery",
    name: "2차전지",
    items: [
      { ticker: "305720", market: "KR", name: "KODEX 2차전지산업" },
      { ticker: "305540", market: "KR", name: "TIGER 2차전지테마" },
    ],
  },
];

export function newSetId(): string {
  return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyLibrary(): HoldingsLibrary {
  const id = "set-default";
  return {
    activeId: id,
    sets: [{ id, name: "비교군 1", items: [] }],
    snapshots: {},
    prev: {},
  };
}

function sanitizeSet(row: Partial<CompareSet>, idx: number): CompareSet | null {
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `set-${idx}`;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 24) : `비교군 ${idx + 1}`;
  const items = Array.isArray(row.items)
    ? row.items
        .filter((it): it is BasketItem => Boolean(it && typeof it.ticker === "string" && it.market))
        .slice(0, MAX_HOLDINGS_BASKET)
        .map((it) => {
          const market: EtfHoldingsMarket = it.market === "US" ? "US" : "KR";
          return {
            ticker: String(it.ticker).trim().toUpperCase(),
            market,
            name: String(it.name || it.ticker).trim(),
          };
        })
    : [];
  return { id, name, items };
}

export function loadLibrary(): HoldingsLibrary {
  if (typeof window === "undefined") return emptyLibrary();
  try {
    const raw = window.localStorage.getItem(ETF_HOLDINGS_SETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HoldingsLibrary>;
      const sets = (Array.isArray(parsed.sets) ? parsed.sets : [])
        .map((row, i) => sanitizeSet(row || {}, i))
        .filter((s): s is CompareSet => Boolean(s))
        .slice(0, MAX_COMPARE_SETS);
      if (sets.length) {
        const activeId = sets.some((s) => s.id === parsed.activeId) ? String(parsed.activeId) : sets[0]!.id;
        return {
          activeId,
          sets,
          snapshots:
            parsed.snapshots && typeof parsed.snapshots === "object" ? parsed.snapshots : {},
          prev: parsed.prev && typeof parsed.prev === "object" ? parsed.prev : {},
        };
      }
    }
    const legacy = loadBasket();
    if (legacy.items.length) {
      const lib = emptyLibrary();
      lib.sets[0] = { id: lib.activeId, name: "비교군 1", items: legacy.items };
      lib.snapshots = legacy.snapshots;
      lib.prev = legacy.prev;
      return lib;
    }
  } catch {
    /* ignore */
  }
  return emptyLibrary();
}

function pruneSnapshots(lib: HoldingsLibrary): HoldingsLibrary {
  const keep = new Set<string>();
  for (const set of lib.sets) {
    for (const item of set.items) keep.add(fundKey(item.market, item.ticker));
  }
  const snapshots: Record<string, FundSnapshot> = {};
  const prev: Record<string, FundSnapshot> = {};
  for (const key of keep) {
    if (lib.snapshots[key]) snapshots[key] = lib.snapshots[key]!;
    if (lib.prev[key]) prev[key] = lib.prev[key]!;
  }
  return { ...lib, snapshots, prev };
}

export function saveLibrary(lib: HoldingsLibrary): void {
  if (typeof window === "undefined") return;
  const payload = pruneSnapshots({
    ...lib,
    sets: lib.sets.slice(0, MAX_COMPARE_SETS).map((s) => ({
      ...s,
      name: s.name.trim().slice(0, 24) || "비교군",
      items: s.items.slice(0, MAX_HOLDINGS_BASKET),
    })),
  });
  try {
    window.localStorage.setItem(ETF_HOLDINGS_SETS_KEY, JSON.stringify(payload));
  } catch {
    try {
      window.localStorage.setItem(
        ETF_HOLDINGS_SETS_KEY,
        JSON.stringify({ ...payload, prev: {}, snapshots: {} }),
      );
    } catch {
      /* quota */
    }
  }
}

export function activeSet(lib: HoldingsLibrary): CompareSet {
  return lib.sets.find((s) => s.id === lib.activeId) || lib.sets[0]!;
}

export function patchActiveSet(
  lib: HoldingsLibrary,
  patch: (set: CompareSet) => CompareSet,
): HoldingsLibrary {
  return {
    ...lib,
    sets: lib.sets.map((s) => (s.id === lib.activeId ? patch(s) : s)),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type FundConcentration = {
  n: number;
  top5: number | null;
  top10: number | null;
  maxW: number | null;
  coverage: number | null;
  hhi: number | null;
  effectiveN: number | null;
  label: "집중" | "보통" | "분산";
};

export function fundConcentration(fund: FundSnapshot): FundConcentration {
  const weights = fund.holdings
    .map((h) => h.weight_pct)
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  const sum = weights.reduce((a, b) => a + b, 0);
  const top5 = weights.length ? weights.slice(0, 5).reduce((a, b) => a + b, 0) : null;
  const top10 = weights.length ? weights.slice(0, 10).reduce((a, b) => a + b, 0) : null;
  const maxW = weights[0] ?? null;
  const hhi =
    sum > 0 ? weights.reduce((a, w) => a + (w / 100) * (w / 100), 0) : null;
  const effectiveN = hhi && hhi > 0 ? 1 / hhi : null;
  const top = top5 ?? 0;
  const label: FundConcentration["label"] = top >= 45 ? "집중" : top >= 25 ? "보통" : "분산";
  return {
    n: fund.stats?.holding_count || fund.holdings.length,
    top5: top5 != null ? round2(top5) : fund.stats?.top5_weight_pct ?? null,
    top10: top10 != null ? round2(top10) : fund.stats?.top10_weight_pct ?? null,
    maxW: maxW != null ? round2(maxW) : fund.stats?.max_weight_pct ?? null,
    coverage: sum ? round2(sum) : fund.stats?.coverage_weight_pct ?? null,
    hhi: hhi != null ? round2(hhi) : null,
    effectiveN: effectiveN != null ? round1(effectiveN) : null,
    label,
  };
}

export type PairOverlap = {
  aKey: string;
  bKey: string;
  aLabel: string;
  bLabel: string;
  overlapPct: number;
  commonN: number;
  unionN: number;
};

function fundLabel(fund: FundSnapshot): string {
  return fund.ticker;
}

export function pairOverlap(a: FundSnapshot, b: FundSnapshot): PairOverlap {
  const aMap = new Map<string, number>();
  const bMap = new Map<string, number>();
  for (const h of a.holdings) {
    const k = holdingKey(h);
    if (k && h.weight_pct != null) aMap.set(k, h.weight_pct);
  }
  for (const h of b.holdings) {
    const k = holdingKey(h);
    if (k && h.weight_pct != null) bMap.set(k, h.weight_pct);
  }
  const keys = new Set([...aMap.keys(), ...bMap.keys()]);
  let overlap = 0;
  let commonN = 0;
  for (const k of keys) {
    const wa = aMap.get(k);
    const wb = bMap.get(k);
    if (wa != null && wb != null) {
      commonN += 1;
      overlap += Math.min(wa, wb);
    }
  }
  return {
    aKey: fundKey(a.market, a.ticker),
    bKey: fundKey(b.market, b.ticker),
    aLabel: fundLabel(a),
    bLabel: fundLabel(b),
    overlapPct: round1(overlap),
    commonN,
    unionN: keys.size,
  };
}

export type CompareInsight = {
  headline: string;
  bullets: string[];
  metrics: Array<{ label: string; value: string; note?: string }>;
  pairs: PairOverlap[];
  gaps: Array<{
    name: string;
    code: string;
    highLabel: string;
    lowLabel: string;
    highW: number;
    lowW: number;
    diff: number;
  }>;
  uniques: Array<{ fundLabel: string; name: string; code: string; weight: number }>;
};

function overlapRead(n: number): string {
  if (n >= 70) return "거의 같은 바구니";
  if (n >= 40) return "비슷한 유니버스, 운용 차이 있음";
  if (n >= 15) return "일부만 겹침";
  return "다른 유니버스일 가능성";
}

export function buildCompareInsights(
  funds: FundSnapshot[],
  rows: CompareRow[],
): CompareInsight | null {
  if (funds.length < 2) return null;
  const mixed = funds.some((f) => f.market === "KR") && funds.some((f) => f.market === "US");
  const pairs: PairOverlap[] = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      pairs.push(pairOverlap(funds[i]!, funds[j]!));
    }
  }
  pairs.sort((a, b) => b.overlapPct - a.overlapPct);
  const closest = pairs[0]!;
  const farthest = pairs[pairs.length - 1]!;
  const conc = funds.map((f) => ({ fund: f, c: fundConcentration(f) }));
  const mostConc = [...conc].sort((a, b) => (b.c.top5 || 0) - (a.c.top5 || 0))[0];
  const leastConc = [...conc].sort((a, b) => (a.c.top5 || 0) - (b.c.top5 || 0))[0];

  const gaps: CompareInsight["gaps"] = [];
  for (const row of rows) {
    if (row.present < 2) continue;
    const vals = funds
      .map((f) => {
        const w = row.weights[fundKey(f.market, f.ticker)];
        return w != null ? { label: f.ticker, w } : null;
      })
      .filter((x): x is { label: string; w: number } => Boolean(x));
    if (vals.length < 2) continue;
    const high = vals.reduce((a, b) => (b.w > a.w ? b : a));
    const low = vals.reduce((a, b) => (b.w < a.w ? b : a));
    const diff = high.w - low.w;
    if (diff < 1) continue;
    gaps.push({
      name: row.name,
      code: row.code,
      highLabel: high.label,
      lowLabel: low.label,
      highW: high.w,
      lowW: low.w,
      diff: round2(diff),
    });
  }
  gaps.sort((a, b) => b.diff - a.diff);

  const uniques: CompareInsight["uniques"] = [];
  for (const row of rows) {
    if (row.present !== 1) continue;
    const fund = funds.find((f) => {
      const w = row.weights[fundKey(f.market, f.ticker)];
      return w != null;
    });
    const w = fund ? row.weights[fundKey(fund.market, fund.ticker)] : null;
    if (!fund || w == null || w < 1.2) continue;
    uniques.push({ fundLabel: fund.ticker, name: row.name, code: row.code, weight: w });
  }
  uniques.sort((a, b) => b.weight - a.weight);

  const commonN = rows.filter((r) => r.present >= 2).length;
  const headline =
    funds.length === 2
      ? `${closest.aLabel}–${closest.bLabel} 겹침 비중은 ${closest.overlapPct}%입니다. ${overlapRead(closest.overlapPct)}.`
      : `가장 비슷한 쌍은 ${closest.aLabel}–${closest.bLabel} (겹침 ${closest.overlapPct}%), 가장 다른 쌍은 ${farthest.aLabel}–${farthest.bLabel} (${farthest.overlapPct}%)입니다.`;

  const bullets: string[] = [];
  if (mixed) {
    bullets.push(
      "국내·미국 상품이 섞여 있으면 종목 코드가 달라 같은 기업도 공통 종목으로 안 잡힐 수 있습니다. 겹침이 낮다고 바로 다른 테마로 보지 마세요.",
    );
  }
  if (mostConc && leastConc && mostConc.fund.ticker !== leastConc.fund.ticker) {
    bullets.push(
      `${mostConc.fund.ticker}는 Top5 ${mostConc.c.top5 ?? "—"}%로 ${mostConc.c.label}형, ${leastConc.fund.ticker}는 Top5 ${leastConc.c.top5 ?? "—"}%로 ${leastConc.c.label}형입니다.`,
    );
  } else if (mostConc) {
    bullets.push(
      `${mostConc.fund.ticker} Top5 비중은 ${mostConc.c.top5 ?? "—"}% (${mostConc.c.label}). 높을수록 개별 종목 한 방의 영향이 큽니다.`,
    );
  }
  const topGap = gaps[0];
  if (topGap) {
    bullets.push(
      `가장 큰 비중 차이는 ${topGap.name}: ${topGap.highLabel} ${topGap.highW.toFixed(1)}% vs ${topGap.lowLabel} ${topGap.lowW.toFixed(1)}% (${topGap.diff.toFixed(1)}pp).`,
    );
  }
  const topUnique = uniques[0];
  if (topUnique) {
    bullets.push(
      `${topUnique.fundLabel}만 담은 큰 종목은 ${topUnique.name} (${topUnique.weight.toFixed(1)}%)입니다. 테마·국가 차이를 볼 때 이 쪽이 먼저입니다.`,
    );
  }
  for (const f of funds) {
    const cov = fundConcentration(f).coverage;
    if (cov != null && cov < 85) {
      bullets.push(
        `${f.ticker} 공개 편입비 합이 ${cov.toFixed(0)}%라 상위 종목만 비교 중일 수 있습니다.`,
      );
    }
  }

  const avgOverlap =
    pairs.reduce((s, p) => s + p.overlapPct, 0) / Math.max(pairs.length, 1);

  return {
    headline,
    bullets: bullets.slice(0, 5),
    metrics: [
      {
        label: "평균 겹침 비중",
        value: `${round1(avgOverlap)}%`,
        note: overlapRead(avgOverlap),
      },
      {
        label: "공통 종목",
        value: `${commonN}종`,
        note: `유니온 ${rows.length}종`,
      },
      {
        label: "가장 비슷한 쌍",
        value: `${closest.aLabel}·${closest.bLabel}`,
        note: `${closest.overlapPct}% · 공통 ${closest.commonN}종`,
      },
      {
        label: "가장 다른 쌍",
        value: `${farthest.aLabel}·${farthest.bLabel}`,
        note: `${farthest.overlapPct}% · 공통 ${farthest.commonN}종`,
      },
    ],
    pairs,
    gaps: gaps.slice(0, 6),
    uniques: uniques.slice(0, 6),
  };
}

export type CompareRow = {
  key: string;
  code: string;
  name: string;
  present: number;
  maxWeight: number;
  weights: Record<string, number | null>;
  deltas: Record<string, number | null>;
};

export function buildCompareRows(
  funds: FundSnapshot[],
  prevByKey: Record<string, FundSnapshot>,
): CompareRow[] {
  const names = new Map<string, { code: string; name: string }>();
  const weightsByHolding = new Map<string, Record<string, number | null>>();

  for (const fund of funds) {
    const fk = fundKey(fund.market, fund.ticker);
    for (const h of fund.holdings) {
      const hk = holdingKey(h);
      if (!hk) continue;
      if (!names.has(hk)) {
        names.set(hk, { code: h.code || hk, name: h.name || h.code || hk });
      } else if (h.name && (names.get(hk)?.name.length || 0) < h.name.length) {
        names.set(hk, { code: h.code || names.get(hk)!.code, name: h.name });
      }
      const row = weightsByHolding.get(hk) || {};
      row[fk] = h.weight_pct ?? null;
      weightsByHolding.set(hk, row);
    }
  }

  const rows: CompareRow[] = [];
  for (const [hk, meta] of names) {
    const weights = weightsByHolding.get(hk) || {};
    const deltas: Record<string, number | null> = {};
    let present = 0;
    let maxWeight = -1;
    for (const fund of funds) {
      const fk = fundKey(fund.market, fund.ticker);
      const cur = weights[fk];
      if (cur != null && Number.isFinite(cur)) {
        present += 1;
        maxWeight = Math.max(maxWeight, cur);
      }
      const prevH = (prevByKey[fk]?.holdings || []).find((h) => holdingKey(h) === hk);
      const prevW = prevH?.weight_pct;
      deltas[fk] =
        cur != null && prevW != null && Number.isFinite(prevW) ? cur - prevW : null;
    }
    rows.push({
      key: hk,
      code: meta.code,
      name: meta.name,
      present,
      maxWeight,
      weights,
      deltas,
    });
  }

  rows.sort(
    (a, b) => b.present - a.present || b.maxWeight - a.maxWeight || a.name.localeCompare(b.name),
  );
  return rows;
}

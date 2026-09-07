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

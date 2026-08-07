/**
 * Multi-portfolio localStorage for ETF 배분 (simulate) tab.
 * Mirrors usPortfolio library pattern without trade ledger.
 */

import {
  DEFAULT_ASSET_TARGETS,
  DEFAULT_DIVIDEND_TARGETS,
  DEFAULT_REGION_TARGETS,
  type RegionBucket,
} from "@/lib/allocation";
import {
  ASSET_631_BASKET,
  BENCHMARK_OPTIONS,
  DEFAULT_CAPITAL,
  DIVIDEND_BASKET,
  REGION_BASKET,
  type AllocMethod,
  type AssetClass,
  type DividendStyle,
  type ListingMarket,
} from "@/lib/etfCatalog";
import type { RiskCompareMetrics } from "@/lib/usPortfolio";
import type { SimulateResult } from "@/lib/simulate";

const STORAGE_KEY = "savvyetf:etf-alloc:v1";

export type EtfAllocHistoryEntry = {
  as_of: string;
  cumulative_return_pct: number;
  excess_vs_benchmark_pct: number;
  week_return_pct: number | null;
  final_value: number;
  max_drawdown_pct: number;
  volatility_pct: number | null;
  method: AllocMethod;
  telegram_brief: string;
};

export type StoredEtfAlloc = {
  portfolio_id: string;
  name: string;
  listing: ListingMarket;
  method: AllocMethod;
  freeSelected: string[];
  /** Percent weights keyed by ticker — used when method === "custom" */
  customWeights: Record<string, number>;
  assetTargets: Record<AssetClass, number>;
  assetPicks: Record<AssetClass, string[]>;
  regionTargets: Record<RegionBucket, number>;
  regionPicks: Record<RegionBucket, string[]>;
  dividendTargets: Record<DividendStyle, number>;
  dividendPicks: Record<DividendStyle, string[]>;
  start_date: string;
  initial_capital: number;
  benchmark: string;
  history: EtfAllocHistoryEntry[];
  updated_at: string;
};

export type EtfAllocLibrary = {
  active_id: string;
  portfolios: StoredEtfAlloc[];
};

function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function defaultAssetPicks(listing: ListingMarket): Record<AssetClass, string[]> {
  const [eq, bond, alt] = ASSET_631_BASKET[listing];
  return { equity: [eq], bond: [bond], alt: [alt] };
}

function defaultRegionPicks(listing: ListingMarket): Record<RegionBucket, string[]> {
  const [us, europe, japan, china, korea] = REGION_BASKET[listing];
  return { us: [us], europe: [europe], japan: [japan], china: [china], korea: [korea] };
}

function defaultDividendPicks(
  listing: ListingMarket,
): Record<DividendStyle, string[]> {
  const [quality, high, intl, monthly, bond] = DIVIDEND_BASKET[listing];
  return {
    quality_div: [quality],
    high_div: [high],
    intl_div: [intl],
    monthly_income: [monthly],
    bond_income: [bond],
  };
}

function defaultFreeSelected(listing: ListingMarket): string[] {
  if (listing === "kr") {
    return ["360750.KS", "133690.KS", "453850.KS", "411060.KS"];
  }
  return ["SPY", "QQQ", "TLT", "GLD"];
}

export function newEtfAllocId(): string {
  return `ea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultStoredEtfAlloc(
  name = "포트폴리오 1",
  listing: ListingMarket = "us",
): StoredEtfAlloc {
  const free = defaultFreeSelected(listing);
  const customWeights: Record<string, number> = {};
  const eq = 100 / Math.max(free.length, 1);
  for (const t of free) customWeights[t] = Math.round(eq * 10) / 10;
  return {
    portfolio_id: newEtfAllocId(),
    name,
    listing,
    method: "equal",
    freeSelected: free,
    customWeights,
    assetTargets: { ...DEFAULT_ASSET_TARGETS },
    assetPicks: defaultAssetPicks(listing),
    regionTargets: { ...DEFAULT_REGION_TARGETS },
    regionPicks: defaultRegionPicks(listing),
    dividendTargets: { ...DEFAULT_DIVIDEND_TARGETS },
    dividendPicks: defaultDividendPicks(listing),
    start_date: yearsAgo(3),
    initial_capital: DEFAULT_CAPITAL[listing],
    benchmark: BENCHMARK_OPTIONS[0]?.id || "^GSPC",
    history: [],
    updated_at: new Date().toISOString(),
  };
}

export function defaultEtfAllocLibrary(): EtfAllocLibrary {
  const first = defaultStoredEtfAlloc("포트폴리오 1");
  return { active_id: first.portfolio_id, portfolios: [first] };
}

export function loadEtfAllocLibrary(): EtfAllocLibrary {
  if (typeof window === "undefined") return defaultEtfAllocLibrary();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultEtfAllocLibrary();
    const parsed = JSON.parse(raw) as EtfAllocLibrary;
    if (!Array.isArray(parsed.portfolios) || !parsed.portfolios.length) {
      return defaultEtfAllocLibrary();
    }
    const active =
      parsed.portfolios.find((p) => p.portfolio_id === parsed.active_id)
        ?.portfolio_id || parsed.portfolios[0]!.portfolio_id;
    return { active_id: active, portfolios: parsed.portfolios };
  } catch {
    return defaultEtfAllocLibrary();
  }
}

export function saveEtfAllocLibrary(lib: EtfAllocLibrary): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
}

export function getActiveEtfAlloc(lib: EtfAllocLibrary): StoredEtfAlloc {
  return (
    lib.portfolios.find((p) => p.portfolio_id === lib.active_id) ||
    lib.portfolios[0] ||
    defaultStoredEtfAlloc()
  );
}

export function upsertActiveEtfAlloc(
  lib: EtfAllocLibrary,
  store: StoredEtfAlloc,
): EtfAllocLibrary {
  const exists = lib.portfolios.some((p) => p.portfolio_id === store.portfolio_id);
  const portfolios = exists
    ? lib.portfolios.map((p) => (p.portfolio_id === store.portfolio_id ? store : p))
    : [...lib.portfolios, store];
  return { active_id: store.portfolio_id, portfolios };
}

export function createEtfAllocInLibrary(
  lib: EtfAllocLibrary,
  name?: string,
): EtfAllocLibrary {
  const n = lib.portfolios.length + 1;
  const active = getActiveEtfAlloc(lib);
  const created = defaultStoredEtfAlloc(name || `포트폴리오 ${n}`, active.listing);
  return {
    active_id: created.portfolio_id,
    portfolios: [...lib.portfolios, created],
  };
}

export function duplicateEtfAllocInLibrary(
  lib: EtfAllocLibrary,
  sourceId: string,
): EtfAllocLibrary {
  const src = lib.portfolios.find((p) => p.portfolio_id === sourceId);
  if (!src) return lib;
  const copy: StoredEtfAlloc = {
    ...structuredClone(src),
    portfolio_id: newEtfAllocId(),
    name: `${src.name} 복사`,
    history: [],
    updated_at: new Date().toISOString(),
  };
  return {
    active_id: copy.portfolio_id,
    portfolios: [...lib.portfolios, copy],
  };
}

export function deleteEtfAllocInLibrary(
  lib: EtfAllocLibrary,
  id: string,
): EtfAllocLibrary {
  if (lib.portfolios.length <= 1) return lib;
  const portfolios = lib.portfolios.filter((p) => p.portfolio_id !== id);
  const active_id =
    lib.active_id === id ? portfolios[0]!.portfolio_id : lib.active_id;
  return { active_id, portfolios };
}

export function formatEtfAllocTelegramBrief(input: {
  name: string;
  as_of: string;
  method: AllocMethod;
  week_return_pct: number | null;
  cumulative_return_pct: number;
  excess_vs_benchmark_pct: number;
  max_drawdown_pct: number;
  contributions: Array<{ label: string; contribution_pct: number }>;
  bucket_attribution: Array<{ label: string; contribution_pct: number }>;
}): string {
  const fmt = (n: number | null | undefined) => {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  };
  return [
    `📊 ETF 배분 · ${input.name}`,
    `기준 ${input.as_of} · ${input.method}`,
    `주간 ${fmt(input.week_return_pct)} · 누적 ${fmt(input.cumulative_return_pct)}`,
    `벤치 대비 ${fmt(input.excess_vs_benchmark_pct)} · MDD ${input.max_drawdown_pct.toFixed(1)}%`,
    "",
    "버킷 기여 Top",
    ...input.bucket_attribution
      .slice(0, 5)
      .map((r) => `· ${r.label} ${fmt(r.contribution_pct)}`),
    "",
    "종목 기여 Top",
    ...input.contributions
      .slice(0, 5)
      .map((r) => `· ${r.label} ${fmt(r.contribution_pct)}`),
  ].join("\n");
}

export function appendEtfAllocHistory(
  store: StoredEtfAlloc,
  result: SimulateResult,
  risk: RiskCompareMetrics | null,
): StoredEtfAlloc {
  if (!result.ok || !result.metrics) return store;
  const as_of = result.end_date || new Date().toISOString().slice(0, 10);
  const telegram_brief = formatEtfAllocTelegramBrief({
    name: store.name,
    as_of,
    method: result.method || store.method,
    week_return_pct: result.week_return_pct ?? null,
    cumulative_return_pct: result.metrics.portfolio.total_return_pct,
    excess_vs_benchmark_pct: result.metrics.excess_vs_benchmark_pct,
    max_drawdown_pct: result.metrics.portfolio.max_drawdown_pct,
    contributions: (result.contributions || []).map((c) => ({
      label: c.name || c.ticker,
      contribution_pct: c.weighted_contribution_pct,
    })),
    bucket_attribution: (result.bucket_attribution || []).map((b) => ({
      label: b.label,
      contribution_pct: b.contribution_pct,
    })),
  });
  const entry: EtfAllocHistoryEntry = {
    as_of,
    cumulative_return_pct: result.metrics.portfolio.total_return_pct,
    excess_vs_benchmark_pct: result.metrics.excess_vs_benchmark_pct,
    week_return_pct: result.week_return_pct ?? null,
    final_value: result.metrics.portfolio.final_value,
    max_drawdown_pct: result.metrics.portfolio.max_drawdown_pct,
    volatility_pct: risk?.volatility_pct ?? result.metrics.portfolio.annual_vol_pct,
    method: result.method || store.method,
    telegram_brief,
  };
  const history = [...store.history.filter((h) => h.as_of !== entry.as_of), entry]
    .sort((a, b) => a.as_of.localeCompare(b.as_of))
    .slice(-120);
  return { ...store, history, updated_at: new Date().toISOString() };
}

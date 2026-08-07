"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import EquityChart from "@/components/EquityChart";
import {
  ASSET_LABELS,
  DEFAULT_ASSET_TARGETS,
  DEFAULT_DIVIDEND_TARGETS,
  DEFAULT_REGION_TARGETS,
  DIVIDEND_LABELS,
  REGION_LABELS,
  type RegionBucket,
} from "@/lib/allocation";
import {
  appendEtfAllocHistory,
  createEtfAllocInLibrary,
  defaultStoredEtfAlloc,
  deleteEtfAllocInLibrary,
  duplicateEtfAllocInLibrary,
  getActiveEtfAlloc,
  loadEtfAllocLibrary,
  saveEtfAllocLibrary,
  upsertActiveEtfAlloc,
  type EtfAllocLibrary,
  type StoredEtfAlloc,
} from "@/lib/etfAllocStore";
import {
  ALLOC_METHODS,
  ASSET_631_BASKET,
  BENCHMARK_OPTIONS,
  DEFAULT_CAPITAL,
  DIVIDEND_BASKET,
  LISTING_MARKETS,
  REGION_BASKET,
  benchmarkLabel,
  catalogForListing,
  etfDisplay,
  mapToListing,
  type AllocMethod,
  type AssetClass,
  type DividendStyle,
  type EtfMeta,
  type ListingMarket,
} from "@/lib/etfCatalog";
import type { SimulateResult } from "@/lib/simulate";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtMoney(n: number | null | undefined, listing: ListingMarket): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (listing === "kr") {
    return `₩${Math.round(n).toLocaleString("ko-KR")}`;
  }
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function retClass(n?: number | null): string {
  if (n == null) return "";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function mapList(symbols: string[], listing: ListingMarket): string[] {
  const out: string[] = [];
  for (const s of symbols) {
    const mapped = mapToListing(s, listing);
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

const METHOD_LABEL: Record<AllocMethod, string> = Object.fromEntries(
  ALLOC_METHODS.map((m) => [m.id, m.label]),
) as Record<AllocMethod, string>;

const ASSET_KEYS: AssetClass[] = ["equity", "bond", "alt"];
const REGION_KEYS: RegionBucket[] = ["us", "europe", "japan", "china", "korea"];
const DIVIDEND_KEYS: DividendStyle[] = [
  "quality_div",
  "high_div",
  "intl_div",
  "monthly_income",
  "bond_income",
];

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

function formatEtfChoice(symbol: string): string {
  const { code, name } = etfDisplay(symbol);
  return name && name !== code ? `${name} (${code})` : code;
}

function equalizeCustomWeights(tickers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const eq = 100 / Math.max(tickers.length, 1);
  for (const t of tickers) out[t] = Math.round(eq * 10) / 10;
  return out;
}

export default function SimulateTab() {
  const [lib, setLib] = useState<EtfAllocLibrary | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultCache, setResultCache] = useState<Record<string, SimulateResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [telegramPreview, setTelegramPreview] = useState("");

  useEffect(() => {
    setLib(loadEtfAllocLibrary());
  }, []);

  const store = lib ? getActiveEtfAlloc(lib) : null;
  const result = store ? resultCache[store.portfolio_id] || null : null;

  const persistLib = useCallback((next: EtfAllocLibrary) => {
    setLib(next);
    saveEtfAllocLibrary(next);
  }, []);

  const persistActive = useCallback(
    (next: StoredEtfAlloc) => {
      if (!lib) return;
      persistLib(upsertActiveEtfAlloc(lib, { ...next, updated_at: new Date().toISOString() }));
    },
    [lib, persistLib],
  );

  const listing = store?.listing || "us";
  const method = store?.method || "equal";
  const freeSelected = store?.freeSelected || [];
  const customWeights = store?.customWeights || {};
  const assetTargets = store?.assetTargets || DEFAULT_ASSET_TARGETS;
  const assetPicks = store?.assetPicks || defaultAssetPicks("us");
  const regionTargets = store?.regionTargets || DEFAULT_REGION_TARGETS;
  const regionPicks = store?.regionPicks || defaultRegionPicks("us");
  const dividendTargets = store?.dividendTargets || DEFAULT_DIVIDEND_TARGETS;
  const dividendPicks = store?.dividendPicks || defaultDividendPicks("us");
  const startDate = store?.start_date || "";
  const capital = store?.initial_capital || DEFAULT_CAPITAL.us;
  const benchmark = store?.benchmark || "^GSPC";

  const catalog = useMemo(() => catalogForListing(listing), [listing]);
  const featured = useMemo(() => catalog.filter((e) => e.featured), [catalog]);
  const extra = useMemo(() => catalog.filter((e) => !e.featured), [catalog]);
  const freeSet = useMemo(() => new Set(freeSelected), [freeSelected]);

  const filteredExtra = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return extra;
    return extra.filter(
      (e) =>
        e.symbol.toUpperCase().includes(q) ||
        e.name.toUpperCase().includes(q) ||
        e.group.includes(query.trim()),
    );
  }, [extra, query]);

  const extraGroups = useMemo(() => {
    const map = new Map<string, EtfMeta[]>();
    for (const e of filteredExtra) {
      const list = map.get(e.group) || [];
      list.push(e);
      map.set(e.group, list);
    }
    return [...map.entries()];
  }, [filteredExtra]);

  const methodMeta = ALLOC_METHODS.find((m) => m.id === method);
  const assetSum = ASSET_KEYS.reduce((a, k) => a + (Number(assetTargets[k]) || 0), 0);
  const regionSum = REGION_KEYS.reduce((a, k) => a + (Number(regionTargets[k]) || 0), 0);
  const dividendSum = DIVIDEND_KEYS.reduce(
    (a, k) => a + (Number(dividendTargets[k]) || 0),
    0,
  );
  const customSum = freeSelected.reduce(
    (a, t) => a + (Number(customWeights[t]) || 0),
    0,
  );

  const selectedTickers = useMemo(() => {
    if (method === "asset") {
      return ASSET_KEYS.flatMap((k) =>
        (Number(assetTargets[k]) || 0) > 0 ? assetPicks[k] : [],
      );
    }
    if (method === "region") {
      return REGION_KEYS.flatMap((k) =>
        (Number(regionTargets[k]) || 0) > 0 ? regionPicks[k] : [],
      );
    }
    if (method === "dividend") {
      return DIVIDEND_KEYS.flatMap((k) =>
        (Number(dividendTargets[k]) || 0) > 0 ? dividendPicks[k] : [],
      );
    }
    return freeSelected;
  }, [
    method,
    assetTargets,
    assetPicks,
    regionTargets,
    regionPicks,
    dividendTargets,
    dividendPicks,
    freeSelected,
  ]);

  function etfsForAsset(cls: AssetClass): EtfMeta[] {
    return catalog.filter((e) => e.assetClass === cls);
  }
  function etfsForRegion(region: RegionBucket): EtfMeta[] {
    return catalog.filter((e) => e.region === region);
  }
  function etfsForDividend(style: DividendStyle): EtfMeta[] {
    return catalog.filter((e) => e.dividendStyle === style);
  }

  function switchListing(next: ListingMarket) {
    if (!store || next === listing) return;
    const mappedFree = (() => {
      const mapped = mapList(freeSelected, next);
      return mapped.length ? mapped : defaultStoredEtfAlloc("x", next).freeSelected;
    })();
    persistActive({
      ...store,
      listing: next,
      initial_capital: DEFAULT_CAPITAL[next],
      freeSelected: mappedFree,
      customWeights: equalizeCustomWeights(mappedFree),
      assetPicks: (() => {
        const mapped: Record<AssetClass, string[]> = {
          equity: mapList(assetPicks.equity, next),
          bond: mapList(assetPicks.bond, next),
          alt: mapList(assetPicks.alt, next),
        };
        const fallback = defaultAssetPicks(next);
        for (const k of ASSET_KEYS) {
          if (!mapped[k].length) mapped[k] = fallback[k];
        }
        return mapped;
      })(),
      regionPicks: (() => {
        const mapped = {} as Record<RegionBucket, string[]>;
        const fallback = defaultRegionPicks(next);
        for (const k of REGION_KEYS) {
          mapped[k] = mapList(regionPicks[k], next);
          if (!mapped[k].length) mapped[k] = fallback[k];
        }
        return mapped;
      })(),
      dividendPicks: defaultDividendPicks(next),
      dividendTargets: { ...DEFAULT_DIVIDEND_TARGETS },
    });
    setError(null);
    setShowAll(false);
    setQuery("");
  }

  function toggleFree(symbol: string) {
    if (!store) return;
    let next = freeSelected;
    if (freeSelected.includes(symbol)) {
      next = freeSelected.filter((s) => s !== symbol);
    } else {
      if (freeSelected.length >= 20) {
        setError("최대 20개까지 선택할 수 있습니다.");
        return;
      }
      next = [...freeSelected, symbol];
    }
    const weights = { ...customWeights };
    for (const t of Object.keys(weights)) {
      if (!next.includes(t)) delete weights[t];
    }
    for (const t of next) {
      if (weights[t] == null) weights[t] = 0;
    }
    if (method === "custom" || Object.values(weights).every((v) => !v)) {
      Object.assign(weights, equalizeCustomWeights(next));
    }
    persistActive({ ...store, freeSelected: next, customWeights: weights });
    setError(null);
  }

  function toggleBucket(
    list: string[],
    symbol: string,
    apply: (next: string[]) => void,
  ) {
    if (list.includes(symbol)) apply(list.filter((s) => s !== symbol));
    else apply([...list, symbol]);
  }

  async function run() {
    if (!store) return;
    if (!selectedTickers.length) {
      setError("ETF를 하나 이상 선택하세요.");
      return;
    }
    if (method === "custom" && Math.abs(customSum - 100) > 0.5) {
      setError(`직접 비중 합계가 100%가 되어야 합니다 (현재 ${customSum.toFixed(1)}%).`);
      return;
    }
    if (method === "asset" && Math.abs(assetSum - 100) > 0.5) {
      setError(`자산군 비중 합계가 100%가 되어야 합니다 (현재 ${assetSum.toFixed(1)}%).`);
      return;
    }
    if (method === "region" && Math.abs(regionSum - 100) > 0.5) {
      setError(`국가 비중 합계가 100%가 되어야 합니다 (현재 ${regionSum.toFixed(1)}%).`);
      return;
    }
    if (method === "dividend" && Math.abs(dividendSum - 100) > 0.5) {
      setError(
        `배당 유형 비중 합계가 100%가 되어야 합니다 (현재 ${dividendSum.toFixed(1)}%).`,
      );
      return;
    }
    if (method === "asset") {
      for (const k of ASSET_KEYS) {
        if ((Number(assetTargets[k]) || 0) > 0 && !assetPicks[k].length) {
          setError(`${ASSET_LABELS[k]} 비중이 있으면 ETF를 1개 이상 고르세요.`);
          return;
        }
      }
    }
    if (method === "region") {
      for (const k of REGION_KEYS) {
        if ((Number(regionTargets[k]) || 0) > 0 && !regionPicks[k].length) {
          setError(`${REGION_LABELS[k]} 비중이 있으면 ETF를 1개 이상 고르세요.`);
          return;
        }
      }
    }
    if (method === "dividend") {
      for (const k of DIVIDEND_KEYS) {
        if ((Number(dividendTargets[k]) || 0) > 0 && !dividendPicks[k].length) {
          setError(`${DIVIDEND_LABELS[k]} 비중이 있으면 ETF를 1개 이상 고르세요.`);
          return;
        }
      }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers: selectedTickers,
          method,
          start_date: startDate,
          initial_capital: capital,
          benchmark,
          ...(method === "custom"
            ? { weights: selectedTickers.map((t) => Number(customWeights[t]) || 0) }
            : {}),
          ...(method === "asset" ? { asset_targets: assetTargets } : {}),
          ...(method === "region" ? { region_targets: regionTargets } : {}),
          ...(method === "dividend" ? { dividend_targets: dividendTargets } : {}),
        }),
      });
      const data = (await res.json()) as SimulateResult;
      if (!data.ok) {
        setError(data.error || "시뮬레이션 실패");
        setResultCache((prev) => ({ ...prev, [store.portfolio_id]: data }));
      } else {
        setResultCache((prev) => ({ ...prev, [store.portfolio_id]: data }));
        const withHist = appendEtfAllocHistory(store, data, data.risk || null);
        persistActive(withHist);
        const last = withHist.history[withHist.history.length - 1];
        setTelegramPreview(last?.telegram_brief || "");
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "시뮬레이션 실패");
    } finally {
      setLoading(false);
    }
  }

  const chartSeries = useMemo(() => {
    if (!result?.series) return null;
    const benchName = benchmarkLabel(result.benchmark || benchmark);
    return {
      포트폴리오: result.series.portfolio as number[],
      [`벤치 (${benchName})`]: result.series.benchmark as number[],
      "균등비중": result.series.equal_weight as number[],
    };
  }, [result, benchmark]);

  const libraryCompare = useMemo(() => {
    if (!lib) return [];
    return lib.portfolios.map((p) => {
      const cached = resultCache[p.portfolio_id];
      const last = p.history.length ? p.history[p.history.length - 1] : null;
      return {
        id: p.portfolio_id,
        name: p.name,
        method: p.method,
        active: p.portfolio_id === lib.active_id,
        cumulative_return_pct:
          cached?.ok && cached.metrics
            ? cached.metrics.portfolio.total_return_pct
            : last?.cumulative_return_pct ?? null,
        excess_vs_benchmark_pct:
          cached?.ok && cached.metrics
            ? cached.metrics.excess_vs_benchmark_pct
            : last?.excess_vs_benchmark_pct ?? null,
        max_drawdown_pct:
          cached?.ok && cached.metrics
            ? cached.metrics.portfolio.max_drawdown_pct
            : last?.max_drawdown_pct ?? null,
        final_value:
          cached?.ok && cached.metrics
            ? cached.metrics.portfolio.final_value
            : last?.final_value ?? null,
      };
    });
  }, [lib, resultCache]);

  function renderChip(e: EtfMeta, on: boolean, onClick: () => void) {
    return (
      <button
        key={e.symbol}
        type="button"
        className={`etf-chip ${on ? "on" : ""}`}
        onClick={onClick}
        aria-pressed={on}
      >
        <span className="etf-sym">{e.symbol.replace(/\.KS$/i, "")}</span>
        <span className="etf-name">{e.name}</span>
      </button>
    );
  }

  if (!lib || !store) {
    return <p className="empty">포트폴리오 불러오는 중…</p>;
  }

  const currencyHint = listing === "kr" ? "원" : "$";

  return (
    <div className="sim-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">ETF 배분</h2>
          <p className="feature-lead">
            로그인 없이 다중 포트폴리오 저장 · 직접 편입비 · 벤치 대비 리스크·성과 분해.
            한국 상장 상품으로도 미국 포트와 유사한 구성을 만들 수 있습니다.
          </p>
        </div>

        <div className="us-pf-library" style={{ marginBottom: 12 }}>
          <label>
            활성 포트폴리오
            <select
              value={store.portfolio_id}
              onChange={(e) => {
                persistLib({ ...lib, active_id: e.target.value });
                setError(null);
              }}
            >
              {lib.portfolios.map((p, i) => (
                <option key={p.portfolio_id} value={p.portfolio_id}>
                  {p.name || `포트폴리오 ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="tab-btn"
            onClick={() => persistLib(createEtfAllocInLibrary(lib))}
          >
            새 포트폴리오
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => persistLib(duplicateEtfAllocInLibrary(lib, store.portfolio_id))}
          >
            복제
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={lib.portfolios.length <= 1}
            onClick={() => persistLib(deleteEtfAllocInLibrary(lib, store.portfolio_id))}
          >
            삭제
          </button>
          <span className="meta-soft">
            {lib.portfolios.length}개 저장 · 기록 {store.history.length}회
          </span>
        </div>

        <div className="sim-controls" style={{ marginBottom: 10 }}>
          <label className="field">
            <span>포트 이름</span>
            <input
              value={store.name}
              onChange={(e) => persistActive({ ...store, name: e.target.value })}
            />
          </label>
        </div>

        <h3 className="subhead">상장국가</h3>
        <div className="listing-grid" role="tablist" aria-label="상장국가">
          {LISTING_MARKETS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={listing === m.id}
              className={`listing-card ${listing === m.id ? "on" : ""}`}
              onClick={() => switchListing(m.id)}
            >
              <strong>{m.label}</strong>
              <span>{m.blurb}</span>
            </button>
          ))}
        </div>

        <div className="sim-controls">
          <label className="field">
            <span>시작일</span>
            <input
              type="date"
              value={startDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => persistActive({ ...store, start_date: e.target.value })}
            />
          </label>
          <label className="field">
            <span>초기 자본 ({currencyHint})</span>
            <input
              type="number"
              min={listing === "kr" ? 100_000 : 1000}
              step={listing === "kr" ? 100_000 : 1000}
              value={capital}
              onChange={(e) =>
                persistActive({
                  ...store,
                  initial_capital: Number(e.target.value) || DEFAULT_CAPITAL[listing],
                })
              }
            />
          </label>
          <label className="field">
            <span>벤치마크</span>
            <select
              value={benchmark}
              onChange={(e) => persistActive({ ...store, benchmark: e.target.value })}
            >
              {BENCHMARK_OPTIONS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field actions">
            <span>
              선택 {selectedTickers.length}개 · {methodMeta?.label}
            </span>
            <div className="btn-row">
              <button
                type="button"
                className="btn primary"
                onClick={() => void run()}
                disabled={loading}
              >
                {loading ? "계산 중…" : "시뮬레이션"}
              </button>
            </div>
          </div>
        </div>

        <h3 className="subhead">배분 방식</h3>
        <div className="method-grid">
          {ALLOC_METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`method-card ${method === m.id ? "on" : ""}`}
              onClick={() => {
                const patch: Partial<StoredEtfAlloc> = { method: m.id };
                if (m.id === "custom" && freeSelected.length) {
                  patch.customWeights = equalizeCustomWeights(freeSelected);
                }
                persistActive({ ...store, ...patch });
              }}
            >
              <strong>{m.label}</strong>
              <span>{m.blurb}</span>
            </button>
          ))}
        </div>

        {method === "equal" || method === "inv_vol" || method === "custom" ? (
          <>
            <h3 className="subhead">
              {method === "custom"
                ? "ETF 선택 · 직접 편입비"
                : method === "inv_vol"
                  ? "ETF 선택 (역변동성 가중)"
                  : "ETF 선택 (동일가중)"}
            </h3>
            <p className="meta-soft">
              {method === "custom"
                ? `각 ETF 목표 비중(%)을 입력하세요. 합계 ${customSum.toFixed(1)}%${
                    Math.abs(customSum - 100) > 0.5 ? " ← 100%로 맞춰 주세요" : " ✓"
                  }`
                : method === "inv_vol"
                  ? "선택한 각 ETF의 시뮬레이션 구간 일수익률 표준편차 σ를 구한 뒤, 비중 w_i = (1/σ_i) / Σ(1/σ_j) 로 둡니다."
                  : "선택 N개에 대해 w_i = 1/N."}
            </p>
            <div className="etf-chip-row">
              {featured.map((e) =>
                renderChip(e, freeSet.has(e.symbol), () => toggleFree(e.symbol)),
              )}
            </div>
            <div className="more-etf-bar">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "추가 ETF 접기" : `더 많은 ETF 보기 (${extra.length})`}
              </button>
              {showAll ? (
                <input
                  className="etf-search"
                  type="search"
                  placeholder="심볼·이름 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              ) : null}
            </div>
            {showAll ? (
              <div className="etf-picker">
                {extraGroups.map(([group, etfs]) => (
                  <div key={group} className="etf-group">
                    <h4 className="subhead">{group}</h4>
                    <div className="etf-chip-row">
                      {etfs.map((e) =>
                        renderChip(e, freeSet.has(e.symbol), () => toggleFree(e.symbol)),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {method === "custom" && freeSelected.length ? (
              <div className="bucket-stack" style={{ marginTop: 12 }}>
                {freeSelected.map((t) => {
                  const { code, name } = etfDisplay(t);
                  return (
                    <div className="bucket-row" key={t}>
                      <div className="bucket-head">
                        <strong>
                          {name} <span className="meta-soft">({code})</span>
                        </strong>
                        <label className="bucket-pct">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={customWeights[t] ?? 0}
                            onChange={(e) =>
                              persistActive({
                                ...store,
                                customWeights: {
                                  ...customWeights,
                                  [t]: Number(e.target.value) || 0,
                                },
                              })
                            }
                          />
                          %
                        </label>
                      </div>
                    </div>
                  );
                })}
                <div className="btn-row basket-row">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      persistActive({
                        ...store,
                        customWeights: equalizeCustomWeights(freeSelected),
                      })
                    }
                  >
                    균등 비중으로 맞추기
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {method === "asset" ? (
          <>
            <h3 className="subhead">자산군 목표 비중 · ETF</h3>
            <p className="meta-soft">
              목표 비중(%)을 맞춘 뒤, 각 군에서 ETF를 고르면 군 비중을 그 안에서 균등
              분할합니다. 합계 {assetSum.toFixed(1)}%
              {Math.abs(assetSum - 100) > 0.5 ? " ← 100%로 맞춰 주세요" : " ✓"}
            </p>
            <div className="bucket-stack">
              {ASSET_KEYS.map((k) => (
                <div className="bucket-row" key={k}>
                  <div className="bucket-head">
                    <strong>{ASSET_LABELS[k]}</strong>
                    <label className="bucket-pct">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={assetTargets[k]}
                        onChange={(e) =>
                          persistActive({
                            ...store,
                            assetTargets: {
                              ...assetTargets,
                              [k]: Number(e.target.value) || 0,
                            },
                          })
                        }
                      />
                      %
                    </label>
                  </div>
                  <div className="etf-chip-row">
                    {etfsForAsset(k)
                      .slice(0, 14)
                      .map((e) =>
                        renderChip(e, assetPicks[k].includes(e.symbol), () =>
                          toggleBucket(assetPicks[k], e.symbol, (next) =>
                            persistActive({
                              ...store,
                              assetPicks: { ...assetPicks, [k]: next },
                            }),
                          ),
                        ),
                      )}
                  </div>
                </div>
              ))}
            </div>
            <div className="btn-row basket-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  persistActive({
                    ...store,
                    assetTargets: { ...DEFAULT_ASSET_TARGETS },
                    assetPicks: defaultAssetPicks(listing),
                  })
                }
              >
                기본 6:3:1 복원
              </button>
            </div>
          </>
        ) : null}

        {method === "region" ? (
          <>
            <h3 className="subhead">국가 목표 비중 · ETF</h3>
            <p className="meta-soft">
              국가별 목표 비중(%)을 맞추고 대표 ETF를 고릅니다. 합계 {regionSum.toFixed(1)}%
              {Math.abs(regionSum - 100) > 0.5 ? " ← 100%로 맞춰 주세요" : " ✓"}
            </p>
            <div className="bucket-stack">
              {REGION_KEYS.map((k) => (
                <div className="bucket-row" key={k}>
                  <div className="bucket-head">
                    <strong>{REGION_LABELS[k]}</strong>
                    <label className="bucket-pct">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={regionTargets[k]}
                        onChange={(e) =>
                          persistActive({
                            ...store,
                            regionTargets: {
                              ...regionTargets,
                              [k]: Number(e.target.value) || 0,
                            },
                          })
                        }
                      />
                      %
                    </label>
                  </div>
                  <div className="etf-chip-row">
                    {etfsForRegion(k)
                      .slice(0, 10)
                      .map((e) =>
                        renderChip(e, regionPicks[k].includes(e.symbol), () =>
                          toggleBucket(regionPicks[k], e.symbol, (next) =>
                            persistActive({
                              ...store,
                              regionPicks: { ...regionPicks, [k]: next },
                            }),
                          ),
                        ),
                      )}
                  </div>
                </div>
              ))}
            </div>
            <div className="btn-row basket-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  persistActive({
                    ...store,
                    regionTargets: { ...DEFAULT_REGION_TARGETS },
                    regionPicks: defaultRegionPicks(listing),
                  })
                }
              >
                기본 60/10×4 복원
              </button>
            </div>
          </>
        ) : null}

        {method === "dividend" ? (
          <>
            <h3 className="subhead">배당 유형 목표 비중 · ETF</h3>
            <p className="meta-soft">
              합계 {dividendSum.toFixed(1)}%
              {Math.abs(dividendSum - 100) > 0.5 ? " ← 100%로 맞춰 주세요" : " ✓"}
            </p>
            <div className="bucket-stack">
              {DIVIDEND_KEYS.map((k) => (
                <div className="bucket-row" key={k}>
                  <div className="bucket-head">
                    <strong>{DIVIDEND_LABELS[k]}</strong>
                    <label className="bucket-pct">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={dividendTargets[k]}
                        onChange={(e) =>
                          persistActive({
                            ...store,
                            dividendTargets: {
                              ...dividendTargets,
                              [k]: Number(e.target.value) || 0,
                            },
                          })
                        }
                      />
                      %
                    </label>
                  </div>
                  <div className="etf-chip-row">
                    {etfsForDividend(k).map((e) =>
                      renderChip(e, dividendPicks[k].includes(e.symbol), () =>
                        toggleBucket(dividendPicks[k], e.symbol, (next) =>
                          persistActive({
                            ...store,
                            dividendPicks: { ...dividendPicks, [k]: next },
                          }),
                        ),
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="btn-row basket-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  persistActive({
                    ...store,
                    dividendTargets: { ...DEFAULT_DIVIDEND_TARGETS },
                    dividendPicks: defaultDividendPicks(listing),
                  })
                }
              >
                기본 30/20/15/15/20 복원
              </button>
            </div>
          </>
        ) : null}

        {selectedTickers.length ? (
          <p className="meta-soft">
            선택: {selectedTickers.map(formatEtfChoice).join(" · ")}
          </p>
        ) : null}

        {error ? <p className="empty warn">{error}</p> : null}
      </section>

      {result?.ok && result.metrics && chartSeries && result.series ? (
        <>
          <section className="feature-block">
            <div className="feature-head">
              <h2 className="feature-title">성과 요약</h2>
              <p className="feature-lead">
                {result.start_date} → {result.end_date} · {result.trading_days} 거래일 · 초기{" "}
                {fmtMoney(result.initial_capital, listing)} ·{" "}
                {METHOD_LABEL[result.method || "equal"] || result.method}
              </p>
              {result.method_note ? (
                <p className="meta-soft">{result.method_note}</p>
              ) : null}
            </div>

            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">최종 자산</span>
                <span className="stat-value">
                  {fmtMoney(result.metrics.portfolio.final_value, listing)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">총수익</span>
                <span
                  className={`stat-value ${retClass(result.metrics.portfolio.total_return_pct)}`}
                >
                  {fmtPct(result.metrics.portfolio.total_return_pct)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">주간</span>
                <span className={`stat-value ${retClass(result.week_return_pct)}`}>
                  {fmtPct(result.week_return_pct)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">연환산 수익 / 변동성</span>
                <span className="stat-value">
                  {fmtPct(result.metrics.portfolio.annual_return_pct)} /{" "}
                  {result.metrics.portfolio.annual_vol_pct.toFixed(1)}%
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Sharpe</span>
                <span className="stat-value">
                  {result.metrics.portfolio.sharpe.toFixed(2)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">최대낙폭</span>
                <span className="stat-value down">
                  {fmtPct(result.metrics.portfolio.max_drawdown_pct)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">벤치 대비 초과</span>
                <span
                  className={`stat-value ${retClass(result.metrics.excess_vs_benchmark_pct)}`}
                >
                  {fmtPct(result.metrics.excess_vs_benchmark_pct)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">배분 효과 (vs 균등)</span>
                <span
                  className={`stat-value ${retClass(result.metrics.allocation_effect_pct)}`}
                >
                  {fmtPct(result.metrics.allocation_effect_pct)}
                </span>
              </div>
            </div>

            <h3 className="subhead">자산 곡선 (시작=100)</h3>
            <p className="meta-soft">지수화 + Y축 타이트 스케일로 벤치·균등비중과 비교합니다.</p>
            <EquityChart
              dates={result.series.date}
              series={chartSeries}
              height={340}
              currency={listing === "kr" ? "KRW" : "USD"}
              indexed
            />
          </section>

          {result.risk ? (
            <section className="feature-block">
              <h3 className="subhead">벤치마크 대비 리스크·성과</h3>
              <p className="meta-soft">일간 수익률 기준 연환산(252일). Sharpe/IR은 무위험금리 0 가정.</p>
              <div className="contrib-table-wrap">
                <table className="contrib-table">
                  <thead>
                    <tr>
                      <th>지표</th>
                      <th>포트폴리오</th>
                      <th>벤치</th>
                      <th>차이/상대</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>누적 수익률</td>
                      <td className={retClass(result.metrics.portfolio.total_return_pct)}>
                        {fmtPct(result.metrics.portfolio.total_return_pct)}
                      </td>
                      <td className={retClass(result.metrics.benchmark.total_return_pct)}>
                        {fmtPct(result.metrics.benchmark.total_return_pct)}
                      </td>
                      <td className={retClass(result.metrics.excess_vs_benchmark_pct)}>
                        {fmtPct(result.metrics.excess_vs_benchmark_pct)}
                      </td>
                    </tr>
                    <tr>
                      <td>변동성(연)</td>
                      <td>{fmtPct(result.risk.volatility_pct)}</td>
                      <td>{fmtPct(result.risk.spy_volatility_pct)}</td>
                      <td>
                        {result.risk.volatility_pct != null &&
                        result.risk.spy_volatility_pct != null
                          ? fmtPct(result.risk.volatility_pct - result.risk.spy_volatility_pct)
                          : "—"}
                      </td>
                    </tr>
                    <tr>
                      <td>MDD</td>
                      <td>{fmtPct(result.risk.max_drawdown_pct)}</td>
                      <td>{fmtPct(result.risk.spy_max_drawdown_pct)}</td>
                      <td>
                        {fmtPct(
                          result.risk.max_drawdown_pct - result.risk.spy_max_drawdown_pct,
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td>Sharpe</td>
                      <td>{fmtNum(result.risk.sharpe)}</td>
                      <td>{fmtNum(result.risk.spy_sharpe)}</td>
                      <td>
                        {result.risk.sharpe != null && result.risk.spy_sharpe != null
                          ? fmtNum(result.risk.sharpe - result.risk.spy_sharpe)
                          : "—"}
                      </td>
                    </tr>
                    <tr>
                      <td>Beta</td>
                      <td colSpan={2}>{fmtNum(result.risk.beta)}</td>
                      <td className="meta-soft">vs 벤치</td>
                    </tr>
                    <tr>
                      <td>Alpha(연)</td>
                      <td className={retClass(result.risk.alpha_ann_pct)} colSpan={2}>
                        {fmtPct(result.risk.alpha_ann_pct)}
                      </td>
                      <td className="meta-soft">CAPM</td>
                    </tr>
                    <tr>
                      <td>Tracking Error</td>
                      <td colSpan={2}>{fmtPct(result.risk.tracking_error_pct)}</td>
                      <td className="meta-soft">연환산</td>
                    </tr>
                    <tr>
                      <td>Information Ratio</td>
                      <td className={retClass(result.risk.information_ratio)} colSpan={2}>
                        {fmtNum(result.risk.information_ratio)}
                      </td>
                      <td className="meta-soft">초과/TE</td>
                    </tr>
                    <tr>
                      <td>Calmar</td>
                      <td>{fmtNum(result.risk.calmar)}</td>
                      <td>{fmtNum(result.risk.spy_calmar)}</td>
                      <td>
                        {result.risk.calmar != null && result.risk.spy_calmar != null
                          ? fmtNum(result.risk.calmar - result.risk.spy_calmar)
                          : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="feature-block">
            <div className="us-pf-split">
              <div>
                <h3 className="subhead">종목 성과 분해</h3>
                <div className="contrib-table-wrap">
                  <table className="contrib-table">
                    <thead>
                      <tr>
                        <th>상품</th>
                        <th>비중</th>
                        {result.method === "inv_vol" ? <th>연환산 σ</th> : null}
                        <th>개별 수익</th>
                        <th>기여</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result.contributions || [])
                        .filter((c) => c.weight_pct > 0)
                        .map((c) => {
                          const { code, name } = etfDisplay(c.ticker);
                          return (
                            <tr key={c.ticker}>
                              <td>
                                <div className="etf-result-cell">
                                  <span className="etf-result-name">{name}</span>
                                  <span className="etf-result-code">{code}</span>
                                </div>
                              </td>
                              <td>{c.weight_pct.toFixed(1)}%</td>
                              {result.method === "inv_vol" ? (
                                <td>
                                  {c.annual_vol_pct != null
                                    ? `${c.annual_vol_pct.toFixed(1)}%`
                                    : "—"}
                                </td>
                              ) : null}
                              <td className={retClass(c.standalone_return_pct)}>
                                {fmtPct(c.standalone_return_pct)}
                              </td>
                              <td className={retClass(c.weighted_contribution_pct)}>
                                {fmtPct(c.weighted_contribution_pct)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="subhead">버킷 성과 분해</h3>
                <p className="meta-soft">
                  {result.method === "region"
                    ? "국가"
                    : result.method === "dividend"
                      ? "배당 유형"
                      : "자산군"}{" "}
                  기준으로 비중·기여를 집계합니다.
                </p>
                <div className="contrib-table-wrap">
                  <table className="contrib-table">
                    <thead>
                      <tr>
                        <th>버킷</th>
                        <th>비중</th>
                        <th>기여</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!(result.bucket_attribution || []).length ? (
                        <tr>
                          <td colSpan={3} className="empty">
                            —
                          </td>
                        </tr>
                      ) : (
                        (result.bucket_attribution || []).map((b) => (
                          <tr key={b.key}>
                            <td>{b.label}</td>
                            <td>{fmtPct(b.weight_pct, 1)}</td>
                            <td className={retClass(b.contribution_pct)}>
                              {fmtPct(b.contribution_pct)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="compare-note">
              <p>
                균등 비중 최종 {fmtMoney(result.metrics.equal_weight.final_value, listing)} (
                {fmtPct(result.metrics.equal_weight.total_return_pct)}, MDD{" "}
                {fmtPct(result.metrics.equal_weight.max_drawdown_pct)}) · 벤치마크{" "}
                {benchmarkLabel(result.benchmark || benchmark)} 최종{" "}
                {fmtMoney(result.metrics.benchmark.final_value, listing)} (
                {fmtPct(result.metrics.benchmark.total_return_pct)})
              </p>
            </div>
          </section>

          <section className="feature-block">
            <h3 className="subhead">저장된 포트폴리오 비교</h3>
            <div className="contrib-table-wrap">
              <table className="contrib-table">
                <thead>
                  <tr>
                    <th>포트폴리오</th>
                    <th>방식</th>
                    <th>누적</th>
                    <th>vs 벤치</th>
                    <th>MDD</th>
                    <th>평가액</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {libraryCompare.map((row) => (
                    <tr key={row.id} className={row.active ? "us-pf-row-active" : undefined}>
                      <td>
                        <strong>{row.name}</strong>
                        {row.active ? <span className="meta-soft"> · 활성</span> : null}
                      </td>
                      <td>{METHOD_LABEL[row.method] || row.method}</td>
                      <td className={retClass(row.cumulative_return_pct)}>
                        {fmtPct(row.cumulative_return_pct)}
                      </td>
                      <td className={retClass(row.excess_vs_benchmark_pct)}>
                        {fmtPct(row.excess_vs_benchmark_pct)}
                      </td>
                      <td>{fmtPct(row.max_drawdown_pct)}</td>
                      <td>{fmtMoney(row.final_value, listing)}</td>
                      <td>
                        {!row.active ? (
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => persistLib({ ...lib, active_id: row.id })}
                          >
                            열기
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {telegramPreview ? (
            <section className="feature-block">
              <h3 className="subhead">텔레그램 송출 미리보기</h3>
              <pre className="us-pf-tg">{telegramPreview}</pre>
            </section>
          ) : null}

          {store.history.length ? (
            <section className="feature-block">
              <h3 className="subhead">활성 포트 누적 기록</h3>
              <div className="contrib-table-wrap">
                <table className="contrib-table">
                  <thead>
                    <tr>
                      <th>기준일</th>
                      <th>방식</th>
                      <th>누적</th>
                      <th>주간</th>
                      <th>vs 벤치</th>
                      <th>MDD</th>
                      <th>평가액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...store.history].reverse().map((h) => (
                      <tr key={h.as_of}>
                        <td>{h.as_of}</td>
                        <td>{METHOD_LABEL[h.method] || h.method}</td>
                        <td className={retClass(h.cumulative_return_pct)}>
                          {fmtPct(h.cumulative_return_pct)}
                        </td>
                        <td className={retClass(h.week_return_pct)}>
                          {fmtPct(h.week_return_pct)}
                        </td>
                        <td className={retClass(h.excess_vs_benchmark_pct)}>
                          {fmtPct(h.excess_vs_benchmark_pct)}
                        </td>
                        <td>{fmtPct(h.max_drawdown_pct)}</td>
                        <td>{fmtMoney(h.final_value, listing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

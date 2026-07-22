"use client";

import { useMemo, useState } from "react";

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

function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtMoney(n: number | null | undefined, listing: ListingMarket): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (listing === "kr") {
    return `₩${Math.round(n).toLocaleString("ko-KR")}`;
  }
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function retClass(n: number): string {
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

function defaultFreeSelected(listing: ListingMarket): string[] {
  if (listing === "kr") {
    return ["360750.KS", "133690.KS", "453850.KS", "411060.KS"];
  }
  return ["SPY", "QQQ", "TLT", "GLD"];
}

export default function SimulateTab() {
  const [listing, setListing] = useState<ListingMarket>("us");
  const [method, setMethod] = useState<AllocMethod>("equal");
  const [freeSelected, setFreeSelected] = useState<string[]>(defaultFreeSelected("us"));
  const [assetTargets, setAssetTargets] =
    useState<Record<AssetClass, number>>(DEFAULT_ASSET_TARGETS);
  const [assetPicks, setAssetPicks] =
    useState<Record<AssetClass, string[]>>(defaultAssetPicks("us"));
  const [regionTargets, setRegionTargets] =
    useState<Record<RegionBucket, number>>(DEFAULT_REGION_TARGETS);
  const [regionPicks, setRegionPicks] =
    useState<Record<RegionBucket, string[]>>(defaultRegionPicks("us"));
  const [dividendTargets, setDividendTargets] =
    useState<Record<DividendStyle, number>>(DEFAULT_DIVIDEND_TARGETS);
  const [dividendPicks, setDividendPicks] =
    useState<Record<DividendStyle, string[]>>(defaultDividendPicks("us"));

  const [startDate, setStartDate] = useState(yearsAgo(3));
  const [capital, setCapital] = useState(DEFAULT_CAPITAL.us);
  const [benchmark, setBenchmark] = useState<string>(BENCHMARK_OPTIONS[0].id);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (next === listing) return;
    setListing(next);
    setResult(null);
    setError(null);
    setShowAll(false);
    setQuery("");
    setCapital(DEFAULT_CAPITAL[next]);
    // Keep the user's index benchmark across listing switches.

    setFreeSelected((prev) => {
      const mapped = mapList(prev, next);
      return mapped.length ? mapped : defaultFreeSelected(next);
    });
    setAssetPicks((prev) => {
      const mapped: Record<AssetClass, string[]> = {
        equity: mapList(prev.equity, next),
        bond: mapList(prev.bond, next),
        alt: mapList(prev.alt, next),
      };
      const fallback = defaultAssetPicks(next);
      for (const k of ASSET_KEYS) {
        if (!mapped[k].length) mapped[k] = fallback[k];
      }
      return mapped;
    });
    setRegionPicks((prev) => {
      const mapped = {} as Record<RegionBucket, string[]>;
      const fallback = defaultRegionPicks(next);
      for (const k of REGION_KEYS) {
        mapped[k] = mapList(prev[k], next);
        if (!mapped[k].length) mapped[k] = fallback[k];
      }
      return mapped;
    });
    // Dividend style taxonomy differs by listing (KR high-div ≈ domestic,
    // KR intl_div ≈ US high-yield listed locally), so reset to the market basket.
    setDividendPicks(defaultDividendPicks(next));
    setDividendTargets({ ...DEFAULT_DIVIDEND_TARGETS });
  }

  function toggleFree(symbol: string) {
    setFreeSelected((prev) => {
      if (prev.includes(symbol)) return prev.filter((s) => s !== symbol);
      if (prev.length >= 20) {
        setError("최대 20개까지 선택할 수 있습니다.");
        return prev;
      }
      setError(null);
      return [...prev, symbol];
    });
  }

  function toggleBucket(
    list: string[],
    symbol: string,
    setList: (next: string[]) => void,
  ) {
    if (list.includes(symbol)) setList(list.filter((s) => s !== symbol));
    else setList([...list, symbol]);
  }

  async function run() {
    if (!selectedTickers.length) {
      setError("ETF를 하나 이상 선택하세요.");
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
          ...(method === "asset" ? { asset_targets: assetTargets } : {}),
          ...(method === "region" ? { region_targets: regionTargets } : {}),
          ...(method === "dividend" ? { dividend_targets: dividendTargets } : {}),
        }),
      });
      const data = (await res.json()) as SimulateResult;
      if (!data.ok) {
        setResult(null);
        setError(data.error || "시뮬레이션 실패");
      } else {
        setResult(data);
      }
    } catch (exc) {
      setResult(null);
      setError(exc instanceof Error ? exc.message : "시뮬레이션 실패");
    } finally {
      setLoading(false);
    }
  }

  const chartSeries = useMemo(() => {
    if (!result?.series) return null;
    const benchName = benchmarkLabel(result.benchmark || benchmark);
    return {
      Portfolio: result.series.portfolio as number[],
      [`Benchmark (${benchName})`]: result.series.benchmark as number[],
      "Equal weight": result.series.equal_weight as number[],
    };
  }, [result, benchmark]);

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

  const currencyHint = listing === "kr" ? "원" : "$";

  return (
    <div className="sim-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">ETF 배분</h2>
          <p className="feature-lead">
            상장 국가를 고른 뒤 배분 방식과 ETF를 맞추면, 그 시점부터 지금까지의 성과를
            계산합니다. 한국 상장 상품으로도 미국 포트폴리오와 유사한 구성을 만들 수
            있습니다 (예: SPY → TIGER 미국S&P500).
          </p>
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
              onChange={(e) => setStartDate(e.target.value)}
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
                setCapital(Number(e.target.value) || DEFAULT_CAPITAL[listing])
              }
            />
          </label>
          <label className="field">
            <span>벤치마크</span>
            <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
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
              onClick={() => setMethod(m.id)}
            >
              <strong>{m.label}</strong>
              <span>{m.blurb}</span>
            </button>
          ))}
        </div>

        {method === "equal" || method === "inv_vol" ? (
          <>
            <h3 className="subhead">
              {method === "inv_vol"
                ? "ETF 선택 (역변동성 가중)"
                : "ETF 선택 (동일가중)"}
            </h3>
            <p className="meta-soft">
              {method === "inv_vol"
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
                          setAssetTargets((prev) => ({
                            ...prev,
                            [k]: Number(e.target.value) || 0,
                          }))
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
                            setAssetPicks((prev) => ({ ...prev, [k]: next })),
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
                onClick={() => {
                  setAssetTargets({ ...DEFAULT_ASSET_TARGETS });
                  setAssetPicks(defaultAssetPicks(listing));
                }}
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
                          setRegionTargets((prev) => ({
                            ...prev,
                            [k]: Number(e.target.value) || 0,
                          }))
                        }
                      />
                      %
                    </label>
                  </div>
                  <div className="etf-chip-row">
                    {etfsForRegion(k).map((e) =>
                      renderChip(e, regionPicks[k].includes(e.symbol), () =>
                        toggleBucket(regionPicks[k], e.symbol, (next) =>
                          setRegionPicks((prev) => ({ ...prev, [k]: next })),
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
                onClick={() => {
                  setRegionTargets({ ...DEFAULT_REGION_TARGETS });
                  setRegionPicks(defaultRegionPicks(listing));
                }}
              >
                기본 60/10/10/10/10 복원
              </button>
            </div>
          </>
        ) : null}

        {method === "dividend" ? (
          <>
            <h3 className="subhead">배당 유형 목표 비중 · ETF</h3>
            <p className="meta-soft">
              퀄리티 배당·고배당·해외배당·월배당(커버드콜)·채권 대표 유형으로 소득형
              포트폴리오를 구성합니다. 합계 {dividendSum.toFixed(1)}%
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
                          setDividendTargets((prev) => ({
                            ...prev,
                            [k]: Number(e.target.value) || 0,
                          }))
                        }
                      />
                      %
                    </label>
                  </div>
                  <div className="etf-chip-row">
                    {etfsForDividend(k).map((e) =>
                      renderChip(e, dividendPicks[k].includes(e.symbol), () =>
                        toggleBucket(dividendPicks[k], e.symbol, (next) =>
                          setDividendPicks((prev) => ({ ...prev, [k]: next })),
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
                onClick={() => {
                  setDividendTargets({ ...DEFAULT_DIVIDEND_TARGETS });
                  setDividendPicks(defaultDividendPicks(listing));
                }}
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
              <span className={`stat-value ${retClass(result.metrics.portfolio.total_return_pct)}`}>
                {fmtPct(result.metrics.portfolio.total_return_pct)}
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
              <span className="stat-value">{result.metrics.portfolio.sharpe.toFixed(2)}</span>
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

          <h3 className="subhead">자산 곡선</h3>
          <EquityChart
            dates={result.series.date}
            series={chartSeries}
            height={340}
            currency={listing === "kr" ? "KRW" : "USD"}
          />

          <h3 className="subhead">산출 비중 · 기여도</h3>
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
      ) : null}
    </div>
  );
}

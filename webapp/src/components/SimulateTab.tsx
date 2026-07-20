"use client";

import { useMemo, useState } from "react";

import EquityChart from "@/components/EquityChart";
import {
  ASSET_LABELS,
  DEFAULT_ASSET_TARGETS,
  DEFAULT_REGION_TARGETS,
  REGION_LABELS,
  type RegionBucket,
} from "@/lib/allocation";
import {
  ALLOC_METHODS,
  ETF_CATALOG,
  type AllocMethod,
  type AssetClass,
  type EtfMeta,
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

function fmtUsd(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function retClass(n: number): string {
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

const METHOD_LABEL: Record<AllocMethod, string> = Object.fromEntries(
  ALLOC_METHODS.map((m) => [m.id, m.label]),
) as Record<AllocMethod, string>;

const ASSET_KEYS: AssetClass[] = ["equity", "bond", "alt"];
const REGION_KEYS: RegionBucket[] = ["us", "europe", "japan", "china", "korea"];

const DEFAULT_ASSET_PICKS: Record<AssetClass, string[]> = {
  equity: ["VTI"],
  bond: ["BND"],
  alt: ["GLD"],
};

const DEFAULT_REGION_PICKS: Record<RegionBucket, string[]> = {
  us: ["SPY"],
  europe: ["VGK"],
  japan: ["EWJ"],
  china: ["MCHI"],
  korea: ["EWY"],
};

function etfsForAsset(cls: AssetClass): EtfMeta[] {
  return ETF_CATALOG.filter((e) => e.assetClass === cls);
}

function etfsForRegion(region: RegionBucket): EtfMeta[] {
  return ETF_CATALOG.filter((e) => e.region === region);
}

export default function SimulateTab() {
  const [method, setMethod] = useState<AllocMethod>("equal");
  const [freeSelected, setFreeSelected] = useState<string[]>(["SPY", "QQQ", "TLT", "GLD"]);
  const [assetTargets, setAssetTargets] =
    useState<Record<AssetClass, number>>(DEFAULT_ASSET_TARGETS);
  const [assetPicks, setAssetPicks] =
    useState<Record<AssetClass, string[]>>(DEFAULT_ASSET_PICKS);
  const [regionTargets, setRegionTargets] =
    useState<Record<RegionBucket, number>>(DEFAULT_REGION_TARGETS);
  const [regionPicks, setRegionPicks] =
    useState<Record<RegionBucket, string[]>>(DEFAULT_REGION_PICKS);

  const [startDate, setStartDate] = useState(yearsAgo(3));
  const [capital, setCapital] = useState(10_000);
  const [benchmark, setBenchmark] = useState("SPY");
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const featured = useMemo(() => ETF_CATALOG.filter((e) => e.featured), []);
  const extra = useMemo(() => ETF_CATALOG.filter((e) => !e.featured), []);
  const freeSet = useMemo(() => new Set(freeSelected), [freeSelected]);

  const filteredExtra = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return extra;
    return extra.filter(
      (e) =>
        e.symbol.includes(q) ||
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
    return freeSelected;
  }, [method, assetTargets, assetPicks, regionTargets, regionPicks, freeSelected]);

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
    return {
      Portfolio: result.series.portfolio as number[],
      [`Benchmark (${result.benchmark})`]: result.series.benchmark as number[],
      "Equal weight": result.series.equal_weight as number[],
    };
  }, [result]);

  function renderChip(
    e: EtfMeta,
    on: boolean,
    onClick: () => void,
  ) {
    return (
      <button
        key={e.symbol}
        type="button"
        className={`etf-chip ${on ? "on" : ""}`}
        onClick={onClick}
        aria-pressed={on}
      >
        <span className="etf-sym">{e.symbol}</span>
        <span className="etf-name">{e.name}</span>
      </button>
    );
  }

  return (
    <div className="sim-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">ETF 배분</h2>
          <p className="feature-lead">
            배분 방식을 고른 뒤 ETF(와 목표 비중)를 맞추면, 그 시점부터 지금까지의 성과를
            계산합니다.
          </p>
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
            <span>초기 자본 ($)</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value) || 10000)}
            />
          </label>
          <label className="field">
            <span>벤치마크</span>
            <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
              {["SPY", "QQQ", "VTI", "VOO"].map((s) => (
                <option key={s} value={s}>
                  {s}
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
            <div className="etf-chip-row">{featured.map((e) =>
              renderChip(e, freeSet.has(e.symbol), () => toggleFree(e.symbol)),
            )}</div>
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
                  setAssetPicks({ ...DEFAULT_ASSET_PICKS });
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
                  setRegionPicks({ ...DEFAULT_REGION_PICKS });
                }}
              >
                기본 60/10/10/10/10 복원
              </button>
            </div>
          </>
        ) : null}

        {selectedTickers.length ? (
          <p className="meta-soft">선택: {selectedTickers.join(", ")}</p>
        ) : null}

        {error ? <p className="empty warn">{error}</p> : null}
      </section>

      {result?.ok && result.metrics && chartSeries && result.series ? (
        <section className="feature-block">
          <div className="feature-head">
            <h2 className="feature-title">성과 요약</h2>
            <p className="feature-lead">
              {result.start_date} → {result.end_date} · {result.trading_days} 거래일 · 초기{" "}
              {fmtUsd(result.initial_capital)} ·{" "}
              {METHOD_LABEL[result.method || "equal"] || result.method}
            </p>
            {result.method_note ? (
              <p className="meta-soft">{result.method_note}</p>
            ) : null}
          </div>

          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">최종 자산</span>
              <span className="stat-value">{fmtUsd(result.metrics.portfolio.final_value)}</span>
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
          <EquityChart dates={result.series.date} series={chartSeries} height={340} />

          <h3 className="subhead">산출 비중 · 기여도</h3>
          <div className="contrib-table-wrap">
            <table className="contrib-table">
              <thead>
                <tr>
                  <th>ETF</th>
                  <th>비중</th>
                  {result.method === "inv_vol" ? <th>연환산 σ</th> : null}
                  <th>개별 수익</th>
                  <th>기여</th>
                </tr>
              </thead>
              <tbody>
                {(result.contributions || [])
                  .filter((c) => c.weight_pct > 0)
                  .map((c) => (
                    <tr key={c.ticker}>
                      <td>{c.ticker}</td>
                      <td>{c.weight_pct.toFixed(1)}%</td>
                      {result.method === "inv_vol" ? (
                        <td>{c.annual_vol_pct != null ? `${c.annual_vol_pct.toFixed(1)}%` : "—"}</td>
                      ) : null}
                      <td className={retClass(c.standalone_return_pct)}>
                        {fmtPct(c.standalone_return_pct)}
                      </td>
                      <td className={retClass(c.weighted_contribution_pct)}>
                        {fmtPct(c.weighted_contribution_pct)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="compare-note">
            <p>
              균등 비중 최종 {fmtUsd(result.metrics.equal_weight.final_value)} (
              {fmtPct(result.metrics.equal_weight.total_return_pct)}, MDD{" "}
              {fmtPct(result.metrics.equal_weight.max_drawdown_pct)}) · 벤치마크{" "}
              {result.benchmark} 최종 {fmtUsd(result.metrics.benchmark.final_value)} (
              {fmtPct(result.metrics.benchmark.total_return_pct)})
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

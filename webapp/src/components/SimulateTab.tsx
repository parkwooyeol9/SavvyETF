"use client";

import { useMemo, useState } from "react";

import EquityChart from "@/components/EquityChart";
import {
  ALLOC_METHODS,
  ASSET_631_BASKET,
  ETF_CATALOG,
  REGION_BASKET,
  type AllocMethod,
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

export default function SimulateTab() {
  const [selected, setSelected] = useState<string[]>(() =>
    ETF_CATALOG.filter((e) => e.featured).slice(0, 4).map((e) => e.symbol),
  );
  const [method, setMethod] = useState<AllocMethod>("equal");
  const [startDate, setStartDate] = useState(yearsAgo(3));
  const [capital, setCapital] = useState(10_000);
  const [benchmark, setBenchmark] = useState("SPY");
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const featured = useMemo(() => ETF_CATALOG.filter((e) => e.featured), []);
  const extra = useMemo(() => ETF_CATALOG.filter((e) => !e.featured), []);

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

  function toggle(symbol: string) {
    setSelected((prev) => {
      if (prev.includes(symbol)) return prev.filter((s) => s !== symbol);
      if (prev.length >= 20) {
        setError("최대 20개까지 선택할 수 있습니다.");
        return prev;
      }
      setError(null);
      return [...prev, symbol];
    });
  }

  function applyBasket(symbols: readonly string[], nextMethod: AllocMethod) {
    setMethod(nextMethod);
    setSelected([...symbols]);
    setError(null);
  }

  async function run() {
    if (!selected.length) {
      setError("ETF를 하나 이상 선택하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers: selected,
          method,
          start_date: startDate,
          initial_capital: capital,
          benchmark,
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

  function renderChip(e: EtfMeta) {
    const on = selectedSet.has(e.symbol);
    return (
      <button
        key={e.symbol}
        type="button"
        className={`etf-chip ${on ? "on" : ""}`}
        onClick={() => toggle(e.symbol)}
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
          <h2 className="feature-title">ETF 배분 시뮬레이션</h2>
          <p className="feature-lead">
            ETF를 고르고 배분 방식만 선택하면 됩니다. 비중 숫자는 방식에 따라 자동으로
            계산되며, 결과는 아래에서 확인합니다.
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
              선택 {selected.length}개 · {methodMeta?.label}
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
        <div className="btn-row basket-row">
          <button
            type="button"
            className="btn ghost"
            onClick={() => applyBasket(ASSET_631_BASKET, "asset_631")}
          >
            자산군 추천 바스켓
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => applyBasket(REGION_BASKET, "region")}
          >
            국가 추천 바스켓
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              setSelected(ETF_CATALOG.filter((e) => e.featured).map((e) => e.symbol))
            }
          >
            대표 ETF 전체
          </button>
          <button type="button" className="btn ghost" onClick={() => setSelected([])}>
            선택 해제
          </button>
        </div>

        <h3 className="subhead">대표 ETF</h3>
        <div className="etf-chip-row">{featured.map(renderChip)}</div>

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
                <div className="etf-chip-row">{etfs.map(renderChip)}</div>
              </div>
            ))}
            {!extraGroups.length ? (
              <p className="empty">검색 결과가 없습니다.</p>
            ) : null}
          </div>
        ) : null}

        {selected.length ? (
          <p className="meta-soft">
            선택: {selected.join(", ")}
            {methodMeta ? ` · ${methodMeta.blurb}` : ""}
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

          <h3 className="subhead">자동 산출 비중 · 기여도</h3>
          <div className="contrib-table-wrap">
            <table className="contrib-table">
              <thead>
                <tr>
                  <th>ETF</th>
                  <th>비중</th>
                  <th>개별 수익</th>
                  <th>기여</th>
                </tr>
              </thead>
              <tbody>
                {(result.contributions || []).map((c) => (
                  <tr key={c.ticker}>
                    <td>{c.ticker}</td>
                    <td>{c.weight_pct.toFixed(1)}%</td>
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

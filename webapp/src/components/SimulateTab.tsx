"use client";

import { useMemo, useState } from "react";

import EquityChart from "@/components/EquityChart";
import { ETF_CATALOG, type SimulateResult } from "@/lib/simulate";

type Row = { symbol: string; weight: number; selected: boolean };

function defaultRows(): Row[] {
  const picks = new Set(["SPY", "QQQ", "TLT", "GLD"]);
  return ETF_CATALOG.map((e) => ({
    symbol: e.symbol,
    weight: picks.has(e.symbol) ? 25 : 0,
    selected: picks.has(e.symbol),
  }));
}

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

export default function SimulateTab() {
  const [rows, setRows] = useState<Row[]>(defaultRows);
  const [startDate, setStartDate] = useState(yearsAgo(3));
  const [capital, setCapital] = useState(10_000);
  const [benchmark, setBenchmark] = useState("SPY");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => rows.filter((r) => r.selected), [rows]);
  const weightSum = selected.reduce((a, r) => a + (Number(r.weight) || 0), 0);

  function toggle(symbol: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.symbol !== symbol) return r;
        const selectedNext = !r.selected;
        return {
          ...r,
          selected: selectedNext,
          weight: selectedNext ? (r.weight || 25) : 0,
        };
      }),
    );
  }

  function setWeight(symbol: string, weight: number) {
    setRows((prev) =>
      prev.map((r) => (r.symbol === symbol ? { ...r, weight, selected: true } : r)),
    );
  }

  function equalize() {
    const n = selected.length || 1;
    const w = Math.round((100 / n) * 100) / 100;
    setRows((prev) =>
      prev.map((r) => (r.selected ? { ...r, weight: w } : r)),
    );
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
          tickers: selected.map((r) => r.symbol),
          weights: selected.map((r) => Number(r.weight) || 0),
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
    const series: Record<string, number[]> = {
      Portfolio: result.series.portfolio as number[],
      [`Benchmark (${result.benchmark})`]: result.series.benchmark as number[],
      "Equal weight": result.series.equal_weight as number[],
    };
    return series;
  }, [result]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof ETF_CATALOG>();
    for (const e of ETF_CATALOG) {
      const list = map.get(e.group) || [];
      list.push(e);
      map.set(e.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="sim-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">ETF 배분 시뮬레이션</h2>
          <p className="feature-lead">
            시작 시점과 ETF·비중을 고르면, 그때 배분했을 때 지금까지의 성과와 배분 효과를
            보여줍니다.
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
            <span>비중 합계 {weightSum.toFixed(1)}%</span>
            <div className="btn-row">
              <button type="button" className="btn ghost" onClick={equalize}>
                균등 비중
              </button>
              <button type="button" className="btn primary" onClick={() => void run()} disabled={loading}>
                {loading ? "계산 중…" : "시뮬레이션"}
              </button>
            </div>
          </div>
        </div>

        <div className="etf-picker">
          {groups.map(([group, etfs]) => (
            <div key={group} className="etf-group">
              <h4 className="subhead">{group}</h4>
              <div className="etf-grid">
                {etfs.map((e) => {
                  const row = rows.find((r) => r.symbol === e.symbol)!;
                  return (
                    <label key={e.symbol} className={`etf-item ${row.selected ? "on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={() => toggle(e.symbol)}
                      />
                      <span className="etf-sym">{e.symbol}</span>
                      <span className="etf-name">{e.name}</span>
                      <input
                        className="weight-input"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        disabled={!row.selected}
                        value={row.selected ? row.weight : ""}
                        placeholder="%"
                        onChange={(ev) => setWeight(e.symbol, Number(ev.target.value) || 0)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {error ? <p className="empty warn">{error}</p> : null}
      </section>

      {result?.ok && result.metrics && chartSeries && result.series ? (
        <section className="feature-block">
          <div className="feature-head">
            <h2 className="feature-title">성과 요약</h2>
            <p className="feature-lead">
              {result.start_date} → {result.end_date} · {result.trading_days} 거래일 · 초기{" "}
              {fmtUsd(result.initial_capital)}
            </p>
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

          <h3 className="subhead">기여도 (비중 × 개별 수익)</h3>
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

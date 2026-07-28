"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  HYPERSCALER_RANGES,
  earliestCommonDate,
  equalWeightRebased,
  rebaseTo100,
  type HyperscalerRange,
  type HyperscalerSeries,
} from "@/lib/macro";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

type ViewMode = "names" | "portfolio";

type Props = {
  rows: HyperscalerSeries[];
  hsRange: HyperscalerRange;
  onRangeChange: (range: HyperscalerRange) => void;
  loading?: boolean;
};

export default function HyperscalerPanel({
  rows,
  hsRange,
  onRangeChange,
  loading,
}: Props) {
  const [mode, setMode] = useState<ViewMode>("names");
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, true])),
  );

  const seriesList = useMemo(
    () => rows.map((r) => r.series).filter((s) => s.length > 0),
    [rows],
  );
  const minCommon = earliestCommonDate(seriesList);
  const maxDate =
    seriesList
      .flatMap((s) => s.map((p) => p.date))
      .sort()
      .at(-1) || "";

  const [startDate, setStartDate] = useState<string>("");
  const effectiveStart = startDate || minCommon || "";

  // Keep enabled map in sync when rows change (new symbols)
  const enabledSafe = useMemo(() => {
    const next = { ...enabled };
    for (const r of rows) {
      if (next[r.id] === undefined) next[r.id] = true;
    }
    return next;
  }, [rows, enabled]);

  const activeRows = rows.filter(
    (r) => enabledSafe[r.id] !== false && r.series.length > 0,
  );

  const chartData = useMemo(() => {
    if (!effectiveStart || !activeRows.length) return [];

    if (mode === "portfolio") {
      const portfolio = equalWeightRebased(
        activeRows.map((r) => r.series),
        effectiveStart,
      );
      return portfolio.map((p) => ({
        date: p.date,
        portfolio: Number(p.value.toFixed(2)),
      }));
    }

    const rebased = activeRows.map((r) => ({
      id: r.id,
      series: rebaseTo100(r.series, effectiveStart),
    }));
    const dateSet = new Set<string>();
    for (const r of rebased) {
      for (const p of r.series) dateSet.add(p.date);
    }
    const dates = [...dateSet].sort();
    const maps = Object.fromEntries(
      rebased.map((r) => [r.id, new Map(r.series.map((p) => [p.date, p.value]))]),
    );
    return dates.map((date) => {
      const row: Record<string, string | number> = { date };
      for (const r of activeRows) {
        const v = maps[r.id]?.get(date);
        if (v != null) row[r.id] = Number(v.toFixed(2));
      }
      return row;
    });
  }, [activeRows, effectiveStart, mode]);

  const returns = useMemo(() => {
    return activeRows.map((r) => {
      const reb = rebaseTo100(r.series, effectiveStart);
      const last = reb[reb.length - 1]?.value;
      const ret = last != null ? last - 100 : null;
      return { id: r.id, label: r.label, symbol: r.symbol, color: r.color, ret };
    });
  }, [activeRows, effectiveStart]);

  const portfolioRet = useMemo(() => {
    if (mode !== "portfolio" && !activeRows.length) return null;
    const portfolio = equalWeightRebased(
      activeRows.map((r) => r.series),
      effectiveStart,
    );
    const last = portfolio[portfolio.length - 1]?.value;
    return last != null ? last - 100 : null;
  }, [activeRows, effectiveStart, mode]);

  function toggle(id: string) {
    setEnabled((prev) => ({ ...prev, [id]: !(prev[id] !== false) }));
  }

  return (
    <section className="geo-section geo-featured macro-hs">
      <div className="geo-featured-head">
        <div>
          <h3 className="geo-section-title">Hyperscaler 주가 (rebase=100)</h3>
          <p className="geo-thesis">
            MSFT·AMZN·GOOGL·META·ORCL — 시작일 종가=100으로 재기준. 신용 CDS 대신
            주가 추이로 AI 캡엑스 센티먼트 모니터.
          </p>
        </div>
        <div className="macro-hs-controls">
          <div className="chip-row" role="group" aria-label="조회 기간">
            {HYPERSCALER_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`chip ${hsRange === r.id ? "active" : ""}`}
                onClick={() => onRangeChange(r.id)}
                disabled={loading}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="chip-row" role="group" aria-label="표시 모드">
            <button
              type="button"
              className={`chip ${mode === "names" ? "active" : ""}`}
              onClick={() => setMode("names")}
            >
              개별 종목
            </button>
            <button
              type="button"
              className={`chip ${mode === "portfolio" ? "active" : ""}`}
              onClick={() => setMode("portfolio")}
            >
              동일가중 포트폴리오
            </button>
          </div>
          <label className="macro-hs-date">
            시작일
            <input
              type="date"
              value={effectiveStart}
              min={minCommon || undefined}
              max={maxDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="macro-hs-legend">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`macro-hs-chip ${enabledSafe[r.id] === false ? "off" : ""}`}
            style={{ ["--hs-color" as string]: r.color }}
            onClick={() => toggle(r.id)}
            title={`${r.label} (${r.symbol})`}
          >
            <span className="macro-hs-dot" />
            <strong>{r.symbol}</strong>
            <em className={retClass(r.change_1d_pct)}>
              1D {fmtPct(r.change_1d_pct)}
            </em>
          </button>
        ))}
      </div>

      {!chartData.length ? (
        <div className="geo-chart-empty">
          {loading ? "하이퍼스케일러 차트 로딩…" : "선택한 구간·종목 데이터 없음"}
        </div>
      ) : (
        <div className="geo-chart-wrap" style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#93a4c3", fontSize: 11 }}
                minTickGap={40}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "#93a4c3", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  background: "#121b2d",
                  border: "1px solid #243049",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend />
              {mode === "portfolio" ? (
                <Line
                  type="monotone"
                  dataKey="portfolio"
                  name="Equal-weight"
                  stroke="#fbbf24"
                  strokeWidth={2.2}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : (
                activeRows.map((r) => (
                  <Line
                    key={r.id}
                    type="monotone"
                    dataKey={r.id}
                    name={r.symbol}
                    stroke={r.color}
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="macro-hs-rets">
        {mode === "portfolio" ? (
          <div className="macro-hs-ret-card portfolio">
            <span>동일가중 포트폴리오</span>
            <strong className={retClass(portfolioRet)}>
              {portfolioRet != null
                ? `${portfolioRet >= 0 ? "+" : ""}${portfolioRet.toFixed(2)}%`
                : "—"}
            </strong>
            <em>시작일 대비 · 선택 종목 균등</em>
          </div>
        ) : (
          returns.map((r) => (
            <div key={r.id} className="macro-hs-ret-card">
              <span style={{ color: r.color }}>{r.symbol}</span>
              <strong className={retClass(r.ret)}>
                {r.ret != null
                  ? `${r.ret >= 0 ? "+" : ""}${r.ret.toFixed(2)}%`
                  : "—"}
              </strong>
              <em>{r.label}</em>
            </div>
          ))
        )}
      </div>
      <p className="meta-soft">
        시작 {effectiveStart || "—"} = 100 · 조회 구간 {hsRange} · Yahoo 일봉
      </p>
    </section>
  );
}

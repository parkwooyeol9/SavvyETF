"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  CORRIDOR_DEFAULTS,
  DEFAULT_SCENARIOS,
  type CorridorPayload,
  type CorridorScenarioConfig,
  type RebalanceTargetMode,
} from "@/lib/corridor";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

const LINE_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa"];
const BUY_HOLD_COLOR = "#94a3b8";

const DELAY_OPTIONS = [0, 1, 3, 5, 10, 20];

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtKrw(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function rebalanceToLabel(mode: RebalanceTargetMode, cushion: number): string {
  if (mode === "target") return "목표비중";
  if (mode === "cushion") return `여유 ${cushion}%p`;
  return "밴드시";
}

function newScenario(index: number, targetPct: number): CorridorScenarioConfig {
  const lower = Math.max(0, Math.min(targetPct - 5, 20 + index * 5));
  return {
    id: `c${Date.now()}-${index}`,
    label: `Corridor ${index + 1}`,
    lower_pct: lower,
    upper_pct: Math.max(lower + 10, Math.min(100, 50)),
    delay_days: index === 0 ? 0 : 5,
    rebalance_to: "band",
    cushion_pct: 5,
  };
}

export default function CorridorTab() {
  const [target, setTarget] = useState<number>(CORRIDOR_DEFAULTS.target_equity_pct);
  const [scenarios, setScenarios] = useState<CorridorScenarioConfig[]>(() =>
    DEFAULT_SCENARIOS.map((s) => ({ ...s })),
  );
  const [data, setData] = useState<CorridorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weightFocus, setWeightFocus] = useState(0);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/corridor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equity_symbol: CORRIDOR_DEFAULTS.equity_symbol,
          bond_symbol: CORRIDOR_DEFAULTS.bond_symbol,
          target_equity_pct: target,
          start_date: CORRIDOR_DEFAULTS.start_date,
          scenarios,
        }),
      });
      const json = (await res.json()) as CorridorPayload;
      setData(json);
      if (!json.ok) setError(json.error || "시뮬레이션 실패");
      else if (weightFocus >= json.scenarios.length) setWeightFocus(0);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, [target, scenarios, weightFocus]);

  useEffect(() => {
    void run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial defaults only

  const updateScenario = (index: number, patch: Partial<CorridorScenarioConfig>) => {
    setScenarios((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  };

  const valueChart = useMemo(() => {
    if (!data?.ok) return [];
    const byDate = new Map<string, Record<string, number | string>>();
    const add = (label: string, series: { date: string; value: number }[]) => {
      const v0 = series[0]?.value || 1;
      for (const p of series) {
        const row = byDate.get(p.date) || { t: p.date.slice(0, 7) };
        row[label] = Math.round((p.value / v0) * 10000) / 100;
        byDate.set(p.date, row);
      }
    };
    for (const s of data.scenarios) add(s.label, s.series);
    add(data.buy_hold.label, data.buy_hold.series);
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [data]);

  const weightChart = useMemo(() => {
    if (!data?.ok || !data.scenarios.length) return [];
    const focus = data.scenarios[Math.min(weightFocus, data.scenarios.length - 1)]!;
    return focus.series.map((p) => ({
      t: p.date.slice(0, 7),
      주식비중: Math.round(p.equity_pct * 10) / 10,
      상단: focus.upper_pct ?? 0,
      하단: focus.lower_pct ?? 0,
      목표: data.target_equity_pct,
    }));
  }, [data, weightFocus]);

  const focusScenario = data?.ok
    ? data.scenarios[Math.min(weightFocus, data.scenarios.length - 1)]
    : null;

  return (
    <div className="panel-stack corridor-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">비중 한도</h2>
            <p className="kr-hero-sub">
              여러 corridor 설정(상·하단, 터치 후 지연 일수, 리밸 목표)을 동시에
              비교합니다. 밴드 이탈이 N거래일 유지된 뒤에만 리밸런싱합니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <button
              type="button"
              className="tab-btn"
              disabled={loading}
              onClick={() => void run()}
            >
              {loading ? "계산 중…" : "분석 실행"}
            </button>
          </div>
        </div>
        <p className="meta-soft">
          기본: {CORRIDOR_DEFAULTS.start_date}~ ·{" "}
          {data?.equity.name || "KODEX 200"} {target}% +{" "}
          {data?.bond.name || "KODEX 단기채권"} {100 - target}% · 초기{" "}
          {fmtKrw(CORRIDOR_DEFAULTS.initial_value)}
        </p>
        {data?.ok ? (
          <p className="meta-soft">
            실제 구간 {data.start_date} ~ {data.end_date} · 거래일{" "}
            {data.trading_days.toLocaleString()}일
          </p>
        ) : null}
      </section>

      <section className="geo-section" style={{ marginTop: 12 }}>
        <h3 className="geo-section-title">공통 설정</h3>
        <div className="corridor-controls">
          <label>
            목표 주식%
            <input
              type="number"
              min={1}
              max={99}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </label>
        </div>
      </section>

      <section className="geo-section" style={{ marginTop: 12 }}>
        <div className="corridor-scenario-head">
          <h3 className="geo-section-title" style={{ margin: 0 }}>
            Corridor 시나리오 비교
          </h3>
          <button
            type="button"
            className="tab-btn"
            disabled={scenarios.length >= CORRIDOR_DEFAULTS.max_scenarios}
            onClick={() =>
              setScenarios((prev) =>
                prev.length >= CORRIDOR_DEFAULTS.max_scenarios
                  ? prev
                  : [...prev, newScenario(prev.length, target)],
              )
            }
          >
            시나리오 추가
          </button>
        </div>
        <p className="meta-soft" style={{ marginTop: 6 }}>
          리밸 목표: 밴드시 = 상·하한선까지 / 여유 = 밴드 안쪽으로 N%p 더 /
          목표비중 = 초기 목표까지
        </p>
        <div className="corridor-scenario-list">
          {scenarios.map((s, index) => (
            <div key={s.id || index} className="corridor-scenario-card">
              <div className="corridor-scenario-card-top">
                <input
                  className="corridor-scenario-name"
                  value={s.label || ""}
                  onChange={(e) => updateScenario(index, { label: e.target.value })}
                  aria-label={`시나리오 ${index + 1} 이름`}
                />
                <button
                  type="button"
                  className="tab-btn"
                  disabled={scenarios.length <= 1}
                  onClick={() =>
                    setScenarios((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  삭제
                </button>
              </div>
              <div className="corridor-controls">
                <label>
                  하단%
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={s.lower_pct}
                    onChange={(e) =>
                      updateScenario(index, { lower_pct: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  상단%
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={s.upper_pct}
                    onChange={(e) =>
                      updateScenario(index, { upper_pct: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  지연(거래일)
                  <select
                    value={s.delay_days}
                    onChange={(e) =>
                      updateScenario(index, { delay_days: Number(e.target.value) })
                    }
                  >
                    {DELAY_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d === 0 ? "당일(0)" : `${d}일`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  리밸 목표
                  <select
                    value={s.rebalance_to}
                    onChange={(e) =>
                      updateScenario(index, {
                        rebalance_to: e.target.value as RebalanceTargetMode,
                      })
                    }
                  >
                    <option value="band">밴드시</option>
                    <option value="cushion">여유(안쪽)</option>
                    <option value="target">목표비중</option>
                  </select>
                </label>
                {s.rebalance_to === "cushion" ? (
                  <label>
                    여유 %p
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={s.cushion_pct ?? 5}
                      onChange={(e) =>
                        updateScenario(index, { cushion_pct: Number(e.target.value) })
                      }
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <p className="meta-soft" style={{ marginTop: 8 }}>
          {data?.note}
        </p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {data?.ok ? (
        <>
          <section className="geo-section" style={{ marginTop: 16 }}>
            <h3 className="geo-section-title">성과 비교</h3>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>전략</th>
                    <th>밴드</th>
                    <th>지연</th>
                    <th>리밸 목표</th>
                    <th className="num">누적</th>
                    <th className="num">CAGR</th>
                    <th className="num">Vol</th>
                    <th className="num">Sharpe</th>
                    <th className="num">MDD</th>
                    <th className="num">리밸</th>
                    <th className="num">평균주식%</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.scenarios, data.buy_hold].map((s) => (
                    <tr key={s.id}>
                      <td>{s.label}</td>
                      <td>
                        {s.lower_pct != null && s.upper_pct != null
                          ? `${s.lower_pct}–${s.upper_pct}%`
                          : "—"}
                      </td>
                      <td>
                        {s.delay_days == null
                          ? "—"
                          : s.delay_days === 0
                            ? "당일"
                            : `${s.delay_days}일`}
                      </td>
                      <td>
                        {s.rebalance_to
                          ? rebalanceToLabel(s.rebalance_to, s.cushion_pct ?? 5)
                          : "—"}
                      </td>
                      <td className={`num ${tone(s.metrics.total_return_pct)}`}>
                        {fmtPct(s.metrics.total_return_pct)}
                      </td>
                      <td className={`num ${tone(s.metrics.cagr_pct)}`}>
                        {fmtPct(s.metrics.cagr_pct)}
                      </td>
                      <td className="num">{fmtPct(s.metrics.annual_vol_pct)}</td>
                      <td className="num">{s.metrics.sharpe.toFixed(2)}</td>
                      <td className="num">{fmtPct(s.metrics.max_drawdown_pct)}</td>
                      <td className="num">{s.metrics.rebalance_count}</td>
                      <td className="num">{s.metrics.avg_equity_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="geo-section" style={{ marginTop: 16 }}>
            <h3 className="geo-section-title">지수화 성과 (시작=100)</h3>
            <div className="kr-chart" style={{ height: 300, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={valueChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
                  <YAxis
                    tick={{ fill: "#8fa3b8", fontSize: 10 }}
                    width={48}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  {data.scenarios.map((s, i) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.label}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={i === 0 ? 2.2 : 1.7}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey={data.buy_hold.label}
                    stroke={BUY_HOLD_COLOR}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {focusScenario ? (
            <section className="geo-section" style={{ marginTop: 16 }}>
              <div className="corridor-scenario-head">
                <h3 className="geo-section-title" style={{ margin: 0 }}>
                  주식 비중 경로
                </h3>
                <select
                  value={weightFocus}
                  onChange={(e) => setWeightFocus(Number(e.target.value))}
                  aria-label="비중 경로 시나리오"
                >
                  {data.scenarios.map((s, i) => (
                    <option key={s.id} value={i}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="kr-chart" style={{ height: 240, marginTop: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weightChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
                    <YAxis
                      tick={{ fill: "#8fa3b8", fontSize: 10 }}
                      width={40}
                      domain={[
                        Math.max(
                          0,
                          Math.min(
                            focusScenario.lower_pct ?? 0,
                            focusScenario.metrics.min_equity_pct,
                          ) - 5,
                        ),
                        Math.min(
                          100,
                          Math.max(
                            focusScenario.upper_pct ?? 100,
                            focusScenario.metrics.max_equity_pct,
                          ) + 5,
                        ),
                      ]}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="주식비중"
                      stroke={LINE_COLORS[weightFocus % LINE_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="상단"
                      stroke="#f87171"
                      strokeDasharray="4 4"
                      strokeWidth={1.2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="하단"
                      stroke="#fbbf24"
                      strokeDasharray="4 4"
                      strokeWidth={1.2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="목표"
                      stroke="#94a3b8"
                      strokeDasharray="2 4"
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="meta-soft" style={{ marginTop: 6 }}>
                실현 주식비중 평균 {focusScenario.metrics.avg_equity_pct}% · 최저{" "}
                {focusScenario.metrics.min_equity_pct}% · 최고{" "}
                {focusScenario.metrics.max_equity_pct}% · 리밸{" "}
                {focusScenario.metrics.rebalance_count}회
              </p>
              <p className="meta-soft" style={{ marginTop: 8 }}>
                {data.disclaimer}
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

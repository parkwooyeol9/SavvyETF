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
  type CorridorPayload,
} from "@/lib/corridor";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

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

export default function CorridorTab() {
  const [upper, setUpper] = useState<number>(CORRIDOR_DEFAULTS.upper_pct);
  const [lower, setLower] = useState<number>(CORRIDOR_DEFAULTS.lower_pct);
  const [target, setTarget] = useState<number>(CORRIDOR_DEFAULTS.target_equity_pct);
  const [data, setData] = useState<CorridorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          upper_pct: upper,
          lower_pct: lower,
          start_date: CORRIDOR_DEFAULTS.start_date,
        }),
      });
      const json = (await res.json()) as CorridorPayload;
      setData(json);
      if (!json.ok) setError(json.error || "시뮬레이션 실패");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, [upper, lower, target]);

  useEffect(() => {
    void run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial defaults only

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
    add("Corridor", data.primary.series);
    for (const b of data.baselines) add(b.label.includes("Hold") ? "Buy&Hold" : "월간리밸", b.series);
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [data]);

  const weightChart = useMemo(() => {
    if (!data?.ok) return [];
    return data.primary.series.map((p) => ({
      t: p.date.slice(0, 7),
      주식비중: Math.round(p.equity_pct * 10) / 10,
      상단: data.upper_pct,
      하단: data.lower_pct,
      목표: data.target_equity_pct,
    }));
  }, [data]);

  const m = data?.primary.metrics;

  return (
    <div className="panel-stack corridor-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">비중 한도</h2>
            <p className="kr-hero-sub">
              자산배분형 펀드의 corridor(상·하단) 한도가 성과에 미치는 영향을
              분석합니다. 주식 비중이 상단을 넘으면 상단까지 매도, 하단을 깨면
              하단까지 매수합니다.
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
        <h3 className="geo-section-title">Corridor 설정</h3>
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
          <label>
            하단%
            <input
              type="number"
              min={0}
              max={99}
              value={lower}
              onChange={(e) => setLower(Number(e.target.value))}
            />
          </label>
          <label>
            상단%
            <input
              type="number"
              min={1}
              max={100}
              value={upper}
              onChange={(e) => setUpper(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="meta-soft" style={{ marginTop: 8 }}>
          {data?.note}
        </p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {data?.ok && m ? (
        <>
          <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
            <h3 className="geo-section-title">
              Corridor {data.lower_pct}–{data.upper_pct}% 성과
            </h3>
            <div className="us-pf-stats">
              <div>
                <span className="meta-soft">누적 수익률</span>
                <strong className={tone(m.total_return_pct)}>
                  {fmtPct(m.total_return_pct)}
                </strong>
              </div>
              <div>
                <span className="meta-soft">CAGR</span>
                <strong className={tone(m.cagr_pct)}>{fmtPct(m.cagr_pct)}</strong>
              </div>
              <div>
                <span className="meta-soft">연 변동성</span>
                <strong>{fmtPct(m.annual_vol_pct)}</strong>
              </div>
              <div>
                <span className="meta-soft">Sharpe</span>
                <strong>{m.sharpe.toFixed(2)}</strong>
              </div>
              <div>
                <span className="meta-soft">MDD</span>
                <strong>{fmtPct(m.max_drawdown_pct)}</strong>
              </div>
              <div>
                <span className="meta-soft">리밸런싱</span>
                <strong>{m.rebalance_count.toLocaleString()}회</strong>
              </div>
            </div>
          </section>

          <section className="geo-section" style={{ marginTop: 16 }}>
            <h3 className="geo-section-title">지수화 성과 (시작=100)</h3>
            <div className="kr-chart" style={{ height: 280, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={valueChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
                  <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={48} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  <Line type="monotone" dataKey="Corridor" stroke="#60a5fa" strokeWidth={2.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Buy&Hold" stroke="#94a3b8" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="월간리밸" stroke="#34d399" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="geo-section" style={{ marginTop: 16 }}>
            <h3 className="geo-section-title">주식 비중 경로 · Corridor 밴드</h3>
            <div className="kr-chart" style={{ height: 240, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weightChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
                  <YAxis
                    tick={{ fill: "#8fa3b8", fontSize: 10 }}
                    width={40}
                    domain={[
                      Math.max(0, Math.min(data.lower_pct, m.min_equity_pct) - 5),
                      Math.min(100, Math.max(data.upper_pct, m.max_equity_pct) + 5),
                    ]}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  <Line type="monotone" dataKey="주식비중" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="상단" stroke="#f87171" strokeDasharray="4 4" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="하단" stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="목표" stroke="#94a3b8" strokeDasharray="2 4" strokeWidth={1} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="meta-soft" style={{ marginTop: 6 }}>
              실현 주식비중 평균 {m.avg_equity_pct}% · 최저 {m.min_equity_pct}% · 최고{" "}
              {m.max_equity_pct}%
            </p>
          </section>

          <section className="geo-section" style={{ marginTop: 16 }}>
            <h3 className="geo-section-title">벤치마크 대비</h3>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>전략</th>
                    <th className="num">누적</th>
                    <th className="num">CAGR</th>
                    <th className="num">Vol</th>
                    <th className="num">Sharpe</th>
                    <th className="num">MDD</th>
                    <th className="num">리밸</th>
                  </tr>
                </thead>
                <tbody>
                  {[data.primary, ...data.baselines].map((s) => (
                    <tr key={s.id}>
                      <td>{s.label}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="geo-section" style={{ marginTop: 16 }}>
            <h3 className="geo-section-title">상·하단 민감도 (Sharpe 순)</h3>
            <p className="meta-soft">
              같은 목표 {data.target_equity_pct}%에서 corridor 폭만 바꾼 결과입니다.
            </p>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>하단–상단</th>
                    <th className="num">누적</th>
                    <th className="num">CAGR</th>
                    <th className="num">Vol</th>
                    <th className="num">Sharpe</th>
                    <th className="num">MDD</th>
                    <th className="num">리밸</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sensitivity.map((s) => (
                    <tr
                      key={`${s.lower_pct}-${s.upper_pct}`}
                      className={
                        s.lower_pct === data.lower_pct && s.upper_pct === data.upper_pct
                          ? "corridor-row-active"
                          : undefined
                      }
                    >
                      <td>
                        {s.lower_pct}%–{s.upper_pct}%
                      </td>
                      <td className={`num ${tone(s.total_return_pct)}`}>
                        {fmtPct(s.total_return_pct)}
                      </td>
                      <td className={`num ${tone(s.cagr_pct)}`}>{fmtPct(s.cagr_pct)}</td>
                      <td className="num">{fmtPct(s.annual_vol_pct)}</td>
                      <td className="num">{s.sharpe.toFixed(2)}</td>
                      <td className="num">{fmtPct(s.max_drawdown_pct)}</td>
                      <td className="num">{s.rebalance_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="meta-soft" style={{ marginTop: 8 }}>
              {data.disclaimer}
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

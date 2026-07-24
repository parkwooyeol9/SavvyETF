"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
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
  ETF_FLOW_BUCKET_LABELS,
  fmtAumEok,
  fmtFlowEok,
  type EtfFlowBucket,
  type EtfFlowGroupSeries,
  type EtfFlowPayload,
} from "@/lib/etfFlow";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

type ViewMode = "daily" | "cum";
type BucketFilter = "all" | EtfFlowBucket;

function toneClass(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function buildWideSeries(
  groups: EtfFlowGroupSeries[],
  mode: ViewMode,
): Array<Record<string, string | number>> {
  const byDate = new Map<string, Record<string, string | number>>();
  for (const g of groups) {
    for (const pt of g.series) {
      const row = byDate.get(pt.date) || { t: pt.date.slice(5), date: pt.date };
      row[g.key] = Number(
        (mode === "cum" ? pt.flow_cum_eok : pt.flow_eok).toFixed(1),
      );
      byDate.set(pt.date, row);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, row]) => row);
}

export default function EtfFlowTab() {
  const [data, setData] = useState<EtfFlowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<BucketFilter>("all");
  const [mode, setMode] = useState<ViewMode>("cum");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/etf-flow?days=40", { cache: "no-store" });
      const json = (await res.json()) as EtfFlowPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "수급 데이터를 불러오지 못했습니다.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const all = data?.groups || [];
    if (bucket === "all") return all;
    return all.filter((g) => g.bucket === bucket);
  }, [data, bucket]);

  const chartData = useMemo(
    () => buildWideSeries(groups, mode),
    [groups, mode],
  );

  const ranked = useMemo(() => {
    return [...groups].sort((a, b) => {
      const av = mode === "cum" ? a.flow_cum_eok : a.latest_flow_eok;
      const bv = mode === "cum" ? b.flow_cum_eok : b.latest_flow_eok;
      return Math.abs(bv) - Math.abs(av);
    });
  }, [groups, mode]);

  return (
    <div className="kr-tab etf-flow-tab">
      <header className="kr-hero">
        <div>
          <h2 className="kr-hero-title">ETF 수급 유출입</h2>
          <p className="kr-hero-sub">
            국가·업종·테마별 추정 창출/환매 흐름. 공개 수급 계정이 없어{" "}
            <strong>전일 종가(NAV 대용) × 상장좌수 증감</strong>으로 산출합니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <div className="kr-toggles">
            {(
              [
                ["all", "전체"],
                ["country", "국가"],
                ["sector", "업종"],
                ["theme", "테마"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={bucket === id ? "on" : ""}
                onClick={() => setBucket(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="kr-toggles">
            <button
              type="button"
              className={mode === "daily" ? "on" : ""}
              onClick={() => setMode("daily")}
            >
              일별
            </button>
            <button
              type="button"
              className={mode === "cum" ? "on" : ""}
              onClick={() => setMode("cum")}
            >
              누적
            </button>
          </div>
          <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
            {loading ? "갱신 중…" : "새로고침"}
          </button>
        </div>
      </header>

      {data?.note ? <p className="kr-note">{data.note}</p> : null}
      {data?.source || data?.formula ? (
        <p className="etf-flow-meta">
          {data.source ? <span>출처: {data.source}</span> : null}
          {data.formula ? <span>산식: {data.formula}</span> : null}
          {data.generated_at ? (
            <span>
              갱신{" "}
              {new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false })}
            </span>
          ) : null}
        </p>
      ) : null}

      {error ? <p className="empty">{error}</p> : null}
      {loading && !data ? <p className="empty">수급 시계열을 불러오는 중…</p> : null}

      {!loading && data && groups.length > 0 ? (
        <>
          <div className="etf-flow-rank">
            {ranked.map((g) => {
              const v = mode === "cum" ? g.flow_cum_eok : g.latest_flow_eok;
              return (
                <div key={g.key} className="etf-flow-rank-item">
                  <span className="etf-flow-rank-dot" style={{ background: g.color }} />
                  <div className="etf-flow-rank-text">
                    <strong>{g.label.replace(/^[^·]+·\s*/, "")}</strong>
                    <em>
                      {ETF_FLOW_BUCKET_LABELS[g.bucket]} · AUM {fmtAumEok(g.latest_aum_eok)}
                    </em>
                  </div>
                  <div className={`etf-flow-rank-val ${toneClass(v)}`}>
                    {fmtFlowEok(v, 0)}
                  </div>
                </div>
              );
            })}
          </div>

          <article className="kr-card">
            <div className="kr-card-head">
              <div>
                <h3 className="kr-card-title">
                  {mode === "cum" ? "누적 수급 추이" : "일별 수급"}
                </h3>
                <p className="kr-card-sub">
                  단위: 억 원 · {data.lookback_days ?? 40}거래일 · 그룹 합산(큐레이션 ETF)
                </p>
              </div>
            </div>
            <div className="kr-chart" style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                {mode === "daily" ? (
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={24} />
                    <YAxis
                      tick={{ fill: "#8fa3b8", fontSize: 10 }}
                      width={56}
                      tickFormatter={(v: number) =>
                        Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${v}`
                      }
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number, name: string) => {
                        const g = groups.find((x) => x.key === name);
                        return [fmtFlowEok(Number(value), 1), g?.label || name];
                      }}
                    />
                    <Legend
                      formatter={(value: string) =>
                        groups.find((g) => g.key === value)?.label.replace(/^[^·]+·\s*/, "") ||
                        value
                      }
                    />
                    {groups.map((g) => (
                      <Bar
                        key={g.key}
                        dataKey={g.key}
                        stackId="flow"
                        fill={g.color}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                ) : (
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={24} />
                    <YAxis
                      tick={{ fill: "#8fa3b8", fontSize: 10 }}
                      width={56}
                      tickFormatter={(v: number) =>
                        Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${v}`
                      }
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number, name: string) => {
                        const g = groups.find((x) => x.key === name);
                        return [fmtFlowEok(Number(value), 1), g?.label || name];
                      }}
                    />
                    <Legend
                      formatter={(value: string) =>
                        groups.find((g) => g.key === value)?.label.replace(/^[^·]+·\s*/, "") ||
                        value
                      }
                    />
                    {groups.map((g) => (
                      <Line
                        key={g.key}
                        type="monotone"
                        dataKey={g.key}
                        stroke={g.color}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          </article>

          <article className="kr-card">
            <div className="kr-card-head">
              <div>
                <h3 className="kr-card-title">구성 종목</h3>
                <p className="kr-card-sub">그룹별 합산에 포함된 국내 상장 ETF</p>
              </div>
            </div>
            <div className="etf-flow-members">
              {groups.map((g) => (
                <div key={g.key} className="etf-flow-member-group">
                  <strong style={{ color: g.color }}>{g.label}</strong>
                  <ul>
                    {g.members.map((m) => (
                      <li key={m.code}>
                        <code>{m.code}</code> {m.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </article>
        </>
      ) : null}

      {!loading && data && !error && groups.length === 0 ? (
        <p className="empty">표시할 수급 그룹이 없습니다.</p>
      ) : null}
    </div>
  );
}

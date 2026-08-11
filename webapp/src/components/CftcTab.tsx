"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CftcMarketId, CftcMarketSeries, CftcPayload } from "@/lib/cftc";

function fmtNet(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n).toLocaleString("en-US")}`;
}

function signedClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

const GROUP_ORDER = ["금속", "에너지", "농산물"] as const;

export default function CftcTab() {
  const [data, setData] = useState<CftcPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<CftcMarketId>("gold");
  const [groupFilter, setGroupFilter] = useState<"전체" | (typeof GROUP_ORDER)[number]>(
    "전체",
  );

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/cftc");
      const json = (await res.json()) as CftcPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(null);
      setFocus((prev) => {
        if (json.markets.some((m) => m.id === prev && m.latest)) return prev;
        return (
          json.markets.find((m) => m.watch && m.latest)?.id ||
          json.markets.find((m) => m.latest)?.id ||
          prev
        );
      });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markets = useMemo(() => {
    const list = data?.markets || [];
    if (groupFilter === "전체") return list;
    return list.filter((m) => m.group === groupFilter);
  }, [data, groupFilter]);

  const watchCards = useMemo(
    () => (data?.markets || []).filter((m) => m.watch && m.latest),
    [data],
  );

  const focusMarket: CftcMarketSeries | null = useMemo(() => {
    return data?.markets.find((m) => m.id === focus) || null;
  }, [data, focus]);

  const chartData = useMemo(() => {
    const series = focusMarket?.series || [];
    if (!series.length) return [];
    const step = Math.max(1, Math.ceil(series.length / 100));
    const out: Array<{ label: string; net: number; oi: number }> = [];
    for (let i = 0; i < series.length; i += step) {
      const p = series[i]!;
      out.push({
        label: p.date.slice(2),
        net: p.net_noncomm,
        oi: p.open_interest,
      });
    }
    const last = series[series.length - 1]!;
    if (out.length && out[out.length - 1]!.label !== last.date.slice(2)) {
      out.push({
        label: last.date.slice(2),
        net: last.net_noncomm,
        oi: last.open_interest,
      });
    }
    return out;
  }, [focusMarket]);

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">CFTC 투기적 순매수</h2>
          <p className="kr-note">
            Non-Commercial Long − Short (Legacy Futures Only). 금·은·원유를 포함한
            주요 원자재 주간 포지션. {data?.schedule_note}
          </p>
        </div>
        <div className="etfdb-hero-actions">
          <button type="button" className="tab-btn" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">CFTC 불러오는 중…</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}

      {data ? (
        <>
          <div className="etfdb-stats">
            <div>
              <div className="etfdb-stat-k">보고 기준일</div>
              <div className="etfdb-stat-v">{data.as_of || "—"}</div>
            </div>
            <div>
              <div className="etfdb-stat-k">스냅샷</div>
              <div className="etfdb-stat-v">{data.generated_at_display}</div>
            </div>
            <div>
              <div className="etfdb-stat-k">시장</div>
              <div className="etfdb-stat-v">
                {data.markets.filter((m) => m.latest).length}종
              </div>
            </div>
          </div>
          <p className="kr-note">
            {data.source}
            {data.from_cache ? " · R2 캐시" : " · 라이브"}
          </p>
          <p className="meta-soft">{data.note}</p>

          {watchCards.length ? (
            <div className="etfdbus-watch">
              {watchCards.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`etfdbus-watch-card ${focus === m.id ? "active" : ""}`}
                  onClick={() => setFocus(m.id)}
                >
                  <strong>{m.label}</strong>
                  <span className={signedClass(m.latest?.net_noncomm)}>
                    {fmtNet(m.latest?.net_noncomm)}
                  </span>
                  <span className={signedClass(m.latest?.net_chg)}>
                    WoW {fmtNet(m.latest?.net_chg)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="etfdbus-chart-head" style={{ marginTop: 12 }}>
            <h3 className="etfdb-detail-title" style={{ margin: 0 }}>
              {focusMarket?.label || "시장"} · 투기적 순매수
            </h3>
            <select
              className="etfdb-search"
              value={focus}
              onChange={(e) => setFocus(e.target.value as CftcMarketId)}
              aria-label="시장 선택"
            >
              {(data.markets || [])
                .filter((m) => m.series.length)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.group} · {m.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="etfdb-chart etfdbus-chart-lg">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
                >
                  <CartesianGrid stroke="rgba(43,54,72,0.8)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#8fa3b8", fontSize: 11 }}
                    minTickGap={28}
                  />
                  <YAxis
                    yAxisId="net"
                    tick={{ fill: "#8fa3b8", fontSize: 11 }}
                    width={72}
                    tickFormatter={(v) => Math.round(Number(v)).toLocaleString("en-US")}
                  />
                  <YAxis
                    yAxisId="oi"
                    orientation="right"
                    tick={{ fill: "#8fa3b8", fontSize: 11 }}
                    width={64}
                    tickFormatter={(v) =>
                      Math.abs(Number(v)) >= 1e6
                        ? `${(Number(v) / 1e6).toFixed(1)}M`
                        : Math.round(Number(v) / 1e3) + "k"
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#141d2b",
                      border: "1px solid #2b3648",
                    }}
                    formatter={(v, name) =>
                      String(name).includes("OI")
                        ? Math.round(Number(v)).toLocaleString("en-US")
                        : fmtNet(Number(v))
                    }
                  />
                  <Legend />
                  <Line
                    yAxisId="net"
                    type="monotone"
                    dataKey="net"
                    name="투기적 순매수"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="oi"
                    type="monotone"
                    dataKey="oi"
                    name="미결제약정(OI)"
                    stroke="#60a5fa"
                    strokeWidth={1.4}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty">시계열 없음</p>
            )}
          </div>

          <div className="etfdb-toolbar">
            <h3 className="etfdb-detail-title">시장별 최신 포지션</h3>
            <div className="etfdbus-series-tabs" role="tablist" aria-label="그룹">
              {(["전체", ...GROUP_ORDER] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`tab-btn sub ${groupFilter === g ? "active" : ""}`}
                  onClick={() => setGroupFilter(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="etfdb-table-wrap">
            <table className="etfdb-table">
              <thead>
                <tr>
                  <th>그룹</th>
                  <th>시장</th>
                  <th className="num">순매수</th>
                  <th className="num">WoW</th>
                  <th className="num">Long</th>
                  <th className="num">Short</th>
                  <th className="num">OI</th>
                  <th className="num">보고일</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr
                    key={m.id}
                    className={
                      m.id === focus
                        ? "etfdbus-watch-row etfdbus-focus-row"
                        : m.watch
                          ? "etfdbus-watch-row"
                          : undefined
                    }
                    onClick={() => {
                      if (m.series.length) setFocus(m.id);
                    }}
                    style={{ cursor: m.series.length ? "pointer" : undefined }}
                  >
                    <td className="meta-soft">{m.group}</td>
                    <td>{m.label}</td>
                    <td className={`num ${signedClass(m.latest?.net_noncomm)}`}>
                      {fmtNet(m.latest?.net_noncomm)}
                    </td>
                    <td className={`num ${signedClass(m.latest?.net_chg)}`}>
                      {fmtNet(m.latest?.net_chg)}
                    </td>
                    <td className="num">
                      {m.latest
                        ? Math.round(m.latest.long).toLocaleString("en-US")
                        : "—"}
                    </td>
                    <td className="num">
                      {m.latest
                        ? Math.round(m.latest.short).toLocaleString("en-US")
                        : "—"}
                    </td>
                    <td className="num">
                      {m.latest
                        ? Math.round(m.latest.open_interest).toLocaleString("en-US")
                        : "—"}
                    </td>
                    <td className="num meta-soft">{m.latest?.date || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

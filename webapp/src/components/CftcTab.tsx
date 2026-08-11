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

import type {
  CftcMarketId,
  CftcMarketSeries,
  CftcPayload,
  CftcSpreadSeries,
} from "@/lib/cftc";

function fmtNet(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtPx(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function signedClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function primaryNet(m: CftcMarketSeries | null | undefined): number | null {
  if (!m?.latest) return null;
  return m.latest.net_mm ?? m.latest.net_noncomm;
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
  const [spreadFocus, setSpreadFocus] = useState<string>("gold_silver");

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
      if (json.spreads?.length) {
        setSpreadFocus((prev) =>
          json.spreads.some((s) => s.id === prev) ? prev : json.spreads[0]!.id,
        );
      }
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

  const activeSpread: CftcSpreadSeries | null = useMemo(() => {
    return data?.spreads?.find((s) => s.id === spreadFocus) || null;
  }, [data, spreadFocus]);

  const chartData = useMemo(() => {
    const series = focusMarket?.series || [];
    if (!series.length) return [];
    const step = Math.max(1, Math.ceil(series.length / 100));
    const out: Array<{
      label: string;
      net_mm: number | null;
      net_nc: number | null;
      pct_oi: number | null;
      price: number | null;
    }> = [];
    for (let i = 0; i < series.length; i += step) {
      const p = series[i]!;
      out.push({
        label: p.date.slice(2),
        net_mm: p.net_mm,
        net_nc: p.net_noncomm,
        pct_oi: p.net_pct_oi,
        price: p.price,
      });
    }
    const last = series[series.length - 1]!;
    if (out.length && out[out.length - 1]!.label !== last.date.slice(2)) {
      out.push({
        label: last.date.slice(2),
        net_mm: last.net_mm,
        net_nc: last.net_noncomm,
        pct_oi: last.net_pct_oi,
        price: last.price,
      });
    }
    return out;
  }, [focusMarket]);

  const spreadChartData = useMemo(() => {
    const series = activeSpread?.series || [];
    if (!series.length) return [];
    const step = Math.max(1, Math.ceil(series.length / 100));
    const out: Array<{ label: string; value: number | null }> = [];
    for (let i = 0; i < series.length; i += step) {
      out.push({
        label: series[i]!.date.slice(2),
        value: series[i]!.value,
      });
    }
    return out;
  }, [activeSpread]);

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">CFTC 투기적 순매수</h2>
          <p className="kr-note">
            Managed Money(주) · Non-Commercial(보조) · %OI · 역사 퍼센타일 · Yahoo
            선물 가격. {data?.schedule_note}
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
              <div className="etfdb-stat-k">다음 COT(금)</div>
              <div className="etfdb-stat-v">{data.next_cot_friday || "—"}</div>
            </div>
            <div>
              <div className="etfdb-stat-k">VIX</div>
              <div className="etfdb-stat-v">{fmtPx(data.vix?.price)}</div>
            </div>
            <div>
              <div className="etfdb-stat-k">스냅샷</div>
              <div className="etfdb-stat-v" style={{ fontSize: "0.95rem" }}>
                {data.generated_at_display}
                {data.from_cache ? " · 캐시" : ""}
              </div>
            </div>
          </div>
          <p className="kr-note">{data.source}</p>
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
                  <strong>
                    {m.label}
                    {m.extreme ? ` · ${m.extreme}` : ""}
                  </strong>
                  <span className={signedClass(primaryNet(m))}>
                    MM {fmtNet(primaryNet(m))}
                  </span>
                  <span>
                    %OI {fmtPct(m.latest?.net_pct_oi)} · Pctl{" "}
                    {m.latest?.percentile != null ? `${m.latest.percentile}` : "—"}
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
              {focusMarket?.label || "시장"} · MM 순매수 + 가격
              {focusMarket?.extreme ? (
                <span className="etfdb-chart-mode">{focusMarket.extreme}</span>
              ) : null}
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
                    {m.extreme ? ` (${m.extreme})` : ""}
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
                    yAxisId="px"
                    orientation="right"
                    tick={{ fill: "#8fa3b8", fontSize: 11 }}
                    width={64}
                    tickFormatter={(v) => fmtPx(Number(v))}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#141d2b",
                      border: "1px solid #2b3648",
                    }}
                    formatter={(v, name) => {
                      const n = typeof v === "number" ? v : null;
                      if (String(name).includes("가격")) return fmtPx(n);
                      if (String(name).includes("%OI")) return fmtPct(n);
                      return fmtNet(n);
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="net"
                    type="monotone"
                    dataKey="net_mm"
                    name="Managed Money"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="net"
                    type="monotone"
                    dataKey="net_nc"
                    name="Non-Comm"
                    stroke="#a78bfa"
                    strokeWidth={1.3}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="px"
                    type="monotone"
                    dataKey="price"
                    name={`${focusMarket?.yahoo || ""} 가격`}
                    stroke="#34d399"
                    strokeWidth={1.6}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty">시계열 없음</p>
            )}
          </div>

          {data.spreads?.length ? (
            <>
              <div className="etfdbus-chart-head" style={{ marginTop: 14 }}>
                <h3 className="etfdb-detail-title" style={{ margin: 0 }}>
                  상대가치 스프레드
                </h3>
                <div className="etfdbus-series-tabs" role="tablist">
                  {data.spreads.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`tab-btn sub ${spreadFocus === s.id ? "active" : ""}`}
                      onClick={() => setSpreadFocus(s.id)}
                    >
                      {s.label}
                      {s.latest != null
                        ? ` · ${s.latest.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                        : ""}
                    </button>
                  ))}
                </div>
              </div>
              <div className="etfdb-chart" style={{ minHeight: 240, height: 260 }}>
                {spreadChartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={spreadChartData}>
                      <CartesianGrid stroke="rgba(43,54,72,0.8)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        minTickGap={28}
                      />
                      <YAxis
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        width={56}
                        tickFormatter={(v) =>
                          Number(v).toLocaleString("en-US", {
                            maximumFractionDigits: 2,
                          })
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#141d2b",
                          border: "1px solid #2b3648",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        name={activeSpread?.label || "spread"}
                        stroke="#38bdf8"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="empty">스프레드 없음</p>
                )}
              </div>
            </>
          ) : null}

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
                  <th className="num">MM 순매수</th>
                  <th className="num">NC 순매수</th>
                  <th className="num">%OI</th>
                  <th className="num">Pctl</th>
                  <th className="num">WoW</th>
                  <th className="num">가격</th>
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
                    <td>
                      {m.label}
                      {m.extreme ? (
                        <span className="meta-soft"> · {m.extreme}</span>
                      ) : null}
                    </td>
                    <td className={`num ${signedClass(m.latest?.net_mm)}`}>
                      {fmtNet(m.latest?.net_mm)}
                    </td>
                    <td className={`num ${signedClass(m.latest?.net_noncomm)}`}>
                      {fmtNet(m.latest?.net_noncomm)}
                    </td>
                    <td className="num">{fmtPct(m.latest?.net_pct_oi)}</td>
                    <td className="num">
                      {m.latest?.percentile != null ? m.latest.percentile : "—"}
                    </td>
                    <td className={`num ${signedClass(m.latest?.net_chg)}`}>
                      {fmtNet(m.latest?.net_chg)}
                    </td>
                    <td className="num">{fmtPx(m.latest?.price)}</td>
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

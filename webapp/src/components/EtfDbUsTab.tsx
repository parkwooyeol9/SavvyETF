"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fmtSignedUsdMn,
  fmtUsdMn,
  type EtfDbUsAggregate,
  type EtfDbUsDimension,
  type EtfDbUsHistory,
  type EtfDbUsPayload,
  type EtfDbUsRow,
} from "@/lib/etfDbUs";

/** Primary chart series (수급 is in the side panel). */
type SeriesKind = "turnover_cum" | "turnover_daily" | "aum";
type FlowKind = "flow_cum" | "flow_daily";

const DIM_LABEL: Record<EtfDbUsDimension, string> = {
  type: "유형",
  region: "지역",
  sector: "섹터",
  theme: "테마",
};

const SERIES_COLORS = [
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#facc15",
  "#60a5fa",
  "#c084fc",
  "#4ade80",
  "#e879f9",
];

const WATCH_THEMES = [
  "귀금속",
  "방산",
  "원전·우라늄",
  "희토류·전략금속",
  "원유·에너지",
  "전쟁·해운",
];

function signedClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function nowClock(): string {
  return new Date().toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function padDomain(values: Array<number | null | undefined>): [number, number] {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length) return [-1, 1];
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.08, 1);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

function downsampleHistory(
  hist: EtfDbUsHistory | undefined,
  keys: string[],
  singleKey?: string,
): Array<Record<string, string | number | null>> {
  const dates = hist?.dates || [];
  if (!dates.length) return [];
  const step = Math.max(1, Math.ceil(dates.length / 120));
  const indices: number[] = [];
  for (let i = 0; i < dates.length; i += step) indices.push(i);
  const lastIdx = dates.length - 1;
  if (lastIdx >= 0 && indices[indices.length - 1] !== lastIdx) indices.push(lastIdx);

  if (singleKey) {
    const vals = hist?.series?.[singleKey] || [];
    return indices.map((i) => ({
      label: dates[i]!.slice(5),
      value: vals[i] ?? null,
    }));
  }

  return indices.map((i) => {
    const row: Record<string, string | number | null> = {
      label: dates[i]!.slice(5),
    };
    for (const lab of keys) {
      row[lab] = hist?.series?.[lab]?.[i] ?? null;
    }
    return row;
  });
}

export default function EtfDbUsTab() {
  const [data, setData] = useState<EtfDbUsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<EtfDbUsDimension>("sector");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"turnover" | "aum" | "flow" | "name" | "change">(
    "turnover",
  );
  const [equityOnly, setEquityOnly] = useState(true);
  const [watchOnly, setWatchOnly] = useState(false);
  const [seriesKind, setSeriesKind] = useState<SeriesKind>("turnover_cum");
  const [showFlowPanel, setShowFlowPanel] = useState(false);
  const [flowKind, setFlowKind] = useState<FlowKind>("flow_cum");
  const [focusSymbol, setFocusSymbol] = useState<string>("SPY");
  const [intraday, setIntraday] = useState<Array<{ t: string; aum: number }>>([]);
  const seriesKeyRef = useRef("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (equityOnly) qs.set("equity", "1");
        if (watchOnly) qs.set("watch", "1");
        const res = await fetch(`/api/etf-db-us?${qs.toString()}`);
        const json = (await res.json()) as EtfDbUsPayload;
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        setData(json);
        setError(null);
        const symbols = Object.keys(json.ticker_series || {});
        setFocusSymbol((prev) => {
          if (symbols.includes(prev)) return prev;
          return (
            json.rows.find((r) => r.watch && symbols.includes(r.symbol))?.symbol ||
            symbols[0] ||
            prev
          );
        });
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "로드 실패");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [equityOnly, watchOnly],
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(true), 90_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    setSelected(null);
  }, [equityOnly, watchOnly]);

  const aggregates: EtfDbUsAggregate[] = useMemo(
    () => data?.aggregates?.[dim] || [],
    [data, dim],
  );
  const maxTurnover = Math.max(...aggregates.map((a) => a.turnover_mn || 0), 1);

  const totalFlow = useMemo(() => {
    if (!aggregates.some((a) => a.flow_available)) return null;
    return aggregates.reduce((s, a) => s + (a.flow_mn || 0), 0);
  }, [aggregates]);

  const selectedAum = useMemo(() => {
    if (!selected) return data?.total_aum_mn ?? null;
    return aggregates.find((a) => a.label === selected)?.aum_mn ?? null;
  }, [selected, aggregates, data]);

  const selectedTurnover = useMemo(() => {
    if (!selected) return data?.total_turnover_mn ?? null;
    return aggregates.find((a) => a.label === selected)?.turnover_mn ?? null;
  }, [selected, aggregates, data]);

  const chartKey = selected || "전체";
  const seriesKey = `${equityOnly ? "eq" : "all"}|${watchOnly ? "w" : "u"}|${dim}|${chartKey}`;

  useEffect(() => {
    if (selectedAum == null || Number.isNaN(selectedAum)) return;
    if (seriesKeyRef.current !== seriesKey) {
      seriesKeyRef.current = seriesKey;
      setIntraday([{ t: nowClock(), aum: selectedAum }]);
      return;
    }
    setIntraday((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.aum - selectedAum) < 1e-6) return prev;
      return [...prev, { t: nowClock(), aum: selectedAum }].slice(-180);
    });
  }, [selectedAum, seriesKey]);

  const filteredRows: EtfDbUsRow[] = useMemo(() => {
    let rows = data?.rows || [];
    if (selected) rows = rows.filter((r) => r[dim] === selected);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.symbol || "").toLowerCase().includes(q) ||
          (r.theme || "").toLowerCase().includes(q) ||
          (r.sector || "").toLowerCase().includes(q),
      );
    }
    rows = [...rows];
    if (sort === "turnover") {
      rows.sort((a, b) => (b.turnover_mn || 0) - (a.turnover_mn || 0));
    } else if (sort === "aum") rows.sort((a, b) => (b.aum_mn || 0) - (a.aum_mn || 0));
    else if (sort === "flow") {
      rows.sort((a, b) => (b.flow_mn ?? -1e99) - (a.flow_mn ?? -1e99));
    } else if (sort === "change") {
      rows.sort((a, b) => (b.change_rate ?? -1e99) - (a.change_rate ?? -1e99));
    } else rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "en"));
    return rows;
  }, [data, selected, dim, query, sort]);

  const activeHistory: EtfDbUsHistory | undefined = useMemo(() => {
    if (!data) return undefined;
    if (seriesKind === "turnover_cum") return data.turnover_history?.[dim];
    if (seriesKind === "turnover_daily") return data.turnover_daily_history?.[dim];
    return data.aum_history?.[dim];
  }, [data, dim, seriesKind]);

  const flowHistory: EtfDbUsHistory | undefined = useMemo(() => {
    if (!data) return undefined;
    return flowKind === "flow_cum"
      ? data.flow_history?.[dim]
      : data.flow_daily_history?.[dim];
  }, [data, dim, flowKind]);

  const multiMode =
    selected == null &&
    (seriesKind === "turnover_cum" || seriesKind === "turnover_daily");

  const multiFlowMode = selected == null;

  const multiLabels = useMemo(() => {
    if (!multiMode || !activeHistory) return [] as string[];
    const keys = Object.keys(activeHistory.series || {}).filter((k) => k !== "전체");
    const ordered = (aggregates || []).map((a) => a.label).filter((l) => keys.includes(l));
    const rest = keys.filter((k) => !ordered.includes(k));
    return [...ordered, ...rest].slice(0, 12);
  }, [multiMode, activeHistory, aggregates]);

  const flowMultiLabels = useMemo(() => {
    if (!multiFlowMode || !flowHistory) return [] as string[];
    const keys = Object.keys(flowHistory.series || {}).filter((k) => k !== "전체");
    const ordered = (aggregates || []).map((a) => a.label).filter((l) => keys.includes(l));
    const rest = keys.filter((k) => !ordered.includes(k));
    return [...ordered, ...rest].slice(0, 12);
  }, [multiFlowMode, flowHistory, aggregates]);

  const chartMode = useMemo<"daily" | "intraday">(() => {
    if (multiMode) {
      const has = multiLabels.some((lab) => {
        const vals = activeHistory?.series?.[lab] || [];
        return vals.filter((v) => v != null).length >= 2;
      });
      if ((activeHistory?.dates?.length || 0) >= 2 && has) return "daily";
      return "intraday";
    }
    const vals = activeHistory?.series?.[chartKey] || [];
    const nonempty = vals.filter((v) => v != null).length;
    if ((activeHistory?.dates?.length || 0) >= 2 && nonempty >= 2) return "daily";
    return "intraday";
  }, [activeHistory, chartKey, multiMode, multiLabels]);

  const chartData = useMemo(() => {
    if (chartMode === "intraday" && seriesKind === "aum") {
      const pts =
        intraday.length > 0
          ? intraday
          : selectedAum != null
            ? [{ t: nowClock(), aum: selectedAum }]
            : [];
      return pts.map((p) => ({ label: p.t, value: p.aum }));
    }
    if (multiMode) return downsampleHistory(activeHistory, multiLabels);
    const points = downsampleHistory(activeHistory, [], chartKey);
    if (seriesKind === "aum" && selectedAum != null && points.length) {
      (points[points.length - 1] as { value: number | null }).value = selectedAum;
    }
    return points;
  }, [
    chartMode,
    intraday,
    selectedAum,
    activeHistory,
    chartKey,
    seriesKind,
    multiMode,
    multiLabels,
  ]);

  const flowChartData = useMemo(() => {
    if (multiFlowMode) return downsampleHistory(flowHistory, flowMultiLabels);
    return downsampleHistory(flowHistory, [], chartKey);
  }, [flowHistory, multiFlowMode, flowMultiLabels, chartKey]);

  const categoryDomain = useMemo(() => {
    if (multiMode) {
      const vals: number[] = [];
      for (const row of chartData) {
        for (const lab of multiLabels) {
          const v = (row as Record<string, string | number | null>)[lab];
          if (typeof v === "number") vals.push(v);
        }
      }
      return padDomain(vals);
    }
    return padDomain(
      chartData.map((r) => {
        const v = (r as { value?: number | null }).value;
        return typeof v === "number" ? v : null;
      }),
    );
  }, [chartData, multiMode, multiLabels]);

  const flowDomain = useMemo(() => {
    if (multiFlowMode) {
      const vals: number[] = [];
      for (const row of flowChartData) {
        for (const lab of flowMultiLabels) {
          const v = (row as Record<string, string | number | null>)[lab];
          if (typeof v === "number") vals.push(v);
        }
      }
      return padDomain(vals);
    }
    return padDomain(
      flowChartData.map((r) => {
        const v = (r as { value?: number | null }).value;
        return typeof v === "number" ? v : null;
      }),
    );
  }, [flowChartData, multiFlowMode, flowMultiLabels]);

  const tickerChartData = useMemo(() => {
    const ts = data?.ticker_series?.[focusSymbol];
    if (!ts?.dates?.length) return [];
    const step = Math.max(1, Math.ceil(ts.dates.length / 140));
    const out: Array<{
      label: string;
      aum: number | null;
      turnover_cum: number | null;
    }> = [];
    for (let i = 0; i < ts.dates.length; i += step) {
      out.push({
        label: ts.dates[i]!.slice(5),
        aum: ts.aum_mn[i] ?? null,
        turnover_cum: ts.turnover_cum_mn?.[i] ?? null,
      });
    }
    const last = ts.dates.length - 1;
    if (last >= 0 && out.length) {
      out[out.length - 1] = {
        label: ts.dates[last]!.slice(5),
        aum: ts.aum_mn[last] ?? null,
        turnover_cum: ts.turnover_cum_mn?.[last] ?? null,
      };
    }
    return out;
  }, [data, focusSymbol]);

  const tickerAumDomain = useMemo(
    () => padDomain(tickerChartData.map((r) => r.aum)),
    [tickerChartData],
  );
  const tickerTurnDomain = useMemo(
    () => padDomain(tickerChartData.map((r) => r.turnover_cum)),
    [tickerChartData],
  );

  const focusOptions = useMemo(() => {
    const series = data?.ticker_series || {};
    return (data?.rows || [])
      .filter((r) => series[r.symbol])
      .map((r) => ({ symbol: r.symbol, name: r.name, watch: !!r.watch }));
  }, [data]);

  const valueFormatter = useCallback(
    (v: unknown) => {
      const n = typeof v === "number" ? v : null;
      if (n == null) return "—";
      return fmtUsdMn(n);
    },
    [],
  );

  const seriesTitle =
    seriesKind === "aum"
      ? "AUM"
      : seriesKind === "turnover_cum"
        ? "거래대금(누적)"
        : "거래대금(일별)";

  const chartHeading = multiMode
    ? `${seriesTitle} · ${DIM_LABEL[dim]}별 합산`
    : `${seriesTitle} · ${chartKey}`;

  const watchThemeAggs = useMemo(() => {
    const themeAggs = data?.aggregates?.theme || [];
    return WATCH_THEMES.map((label) => themeAggs.find((a) => a.label === label)).filter(
      Boolean,
    ) as EtfDbUsAggregate[];
  }, [data]);

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">ETF DB(US)</h2>
          <p className="kr-note">
            미국 주식형 ETF AUM 상위 약 1,000종. 주 지표는 거래대금(종가×거래량).
            유형·지역·섹터·테마로 분류하고, ETF 수급(NAV×Δ좌수)은 사이드에 유지합니다.
          </p>
        </div>
        <div className="etfdb-hero-actions">
          <label className="etfdb-toggle">
            <input
              type="checkbox"
              checked={watchOnly}
              onChange={(e) => setWatchOnly(e.target.checked)}
            />
            관심 테마만
          </label>
          <label className="etfdb-toggle">
            <input
              type="checkbox"
              checked={equityOnly}
              onChange={(e) => setEquityOnly(e.target.checked)}
            />
            주식형만
          </label>
          <button
            type="button"
            className={`tab-btn ${showFlowPanel ? "active" : ""}`}
            onClick={() => setShowFlowPanel((v) => !v)}
            title="스냅샷이 쌓이면 수급이 채워집니다"
          >
            수급(사이드)
          </button>
          <button type="button" className="tab-btn" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">미국 ETF 불러오는 중…</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}

      {data ? (
        <>
          {watchThemeAggs.length ? (
            <div className="etfdbus-watch">
              {watchThemeAggs.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`etfdbus-watch-card ${selected === a.label && dim === "theme" ? "active" : ""}`}
                  onClick={() => {
                    setDim("theme");
                    setSelected(a.label);
                  }}
                >
                  <strong>{a.label}</strong>
                  <span>
                    {a.count}종 · {fmtUsdMn(a.aum_mn)}
                  </span>
                  <span>거래 {fmtUsdMn(a.turnover_mn)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="etfdb-stats">
            <div>
              <div className="etfdb-stat-k">추적 ETF</div>
              <div className="etfdb-stat-v">{data.count.toLocaleString("en-US")}종</div>
            </div>
            <div>
              <div className="etfdb-stat-k">
                {selected ? `${selected} 거래대금` : "거래대금(당일)"}
              </div>
              <div className="etfdb-stat-v">{fmtUsdMn(selectedTurnover)}</div>
            </div>
            <div>
              <div className="etfdb-stat-k">
                {selected ? `${selected} AUM` : "AUM 합계"}
              </div>
              <div className="etfdb-stat-v">{fmtUsdMn(selectedAum)}</div>
            </div>
          </div>

          <p className="kr-note">
            {data.generated_at_display}
            {equityOnly ? " · 주식형 필터 ON" : " · 유니버스 전체"}
            {watchOnly ? " · 관심 테마만" : ""}
            {" · "}
            {chartMode === "intraday"
              ? "라이브 포인트"
              : `1년 시계열 · ${activeHistory?.dates?.length || chartData.length}거래일`}
            {" · "}
            {data.source}
          </p>
          <p className="meta-soft">{data.note}</p>
          <p className="meta-soft">{data.history_note}</p>

          <div className="tabs etfdb-dim-tabs" role="tablist" aria-label="분류">
            {(Object.keys(DIM_LABEL) as EtfDbUsDimension[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`tab-btn ${dim === id ? "active" : ""}`}
                onClick={() => {
                  setDim(id);
                  setSelected(null);
                }}
              >
                {DIM_LABEL[id]}
              </button>
            ))}
          </div>

          <div className={`etfdb-layout ${showFlowPanel ? "etfdbus-with-flow" : ""}`}>
            <aside className="etfdb-cats">
              <button
                type="button"
                className={`etfdb-cat ${selected == null ? "active" : ""}`}
                onClick={() => setSelected(null)}
              >
                <span className="etfdb-cat-name">전체</span>
                <span className="etfdb-cat-sub">
                  <span>{data.count}종</span>
                  <span>{fmtUsdMn(data.total_turnover_mn)}</span>
                </span>
              </button>
              {aggregates.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`etfdb-cat ${selected === a.label ? "active" : ""}`}
                  onClick={() => setSelected(a.label)}
                >
                  <span className="etfdb-cat-name">{a.label}</span>
                  <span className="etfdb-cat-sub">
                    <span>
                      {a.count}종 · 거래 {a.turnover_share_pct.toFixed(1)}%
                    </span>
                    <span>{fmtUsdMn(a.turnover_mn)}</span>
                  </span>
                  <span className="etfdb-bar">
                    <i style={{ width: `${(100 * a.turnover_mn) / maxTurnover}%` }} />
                  </span>
                </button>
              ))}
            </aside>

            <div className="etfdb-main">
              <div className="etfdbus-chart-head">
                <h3 className="etfdb-detail-title" style={{ margin: 0 }}>
                  {chartHeading}
                  <span className="etfdb-chart-mode">
                    {chartMode === "intraday" && seriesKind === "aum"
                      ? "라이브"
                      : `1년 · ${activeHistory?.dates?.length || 0}일`}
                  </span>
                </h3>
                <div className="etfdbus-series-tabs" role="tablist" aria-label="시계열">
                  {(
                    [
                      ["turnover_cum", "거래대금(누적)"],
                      ["turnover_daily", "거래대금(일별)"],
                      ["aum", "AUM"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`tab-btn sub ${seriesKind === id ? "active" : ""}`}
                      onClick={() => setSeriesKind(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="etfdb-chart etfdbus-chart-lg">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartData}
                      margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient id="aumUsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(43,54,72,0.8)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        minTickGap={28}
                      />
                      <YAxis
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        tickFormatter={(v) => String(valueFormatter(Number(v)))}
                        width={72}
                        domain={categoryDomain}
                        allowDataOverflow
                      />
                      <Tooltip
                        formatter={(v) => valueFormatter(v)}
                        contentStyle={{
                          background: "#141d2b",
                          border: "1px solid #2b3648",
                        }}
                      />
                      <Legend />
                      {multiMode ? (
                        multiLabels.map((lab, i) => (
                          <Line
                            key={lab}
                            type="monotone"
                            dataKey={lab}
                            name={lab}
                            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                            strokeWidth={1.8}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        ))
                      ) : (
                        <Area
                          type="monotone"
                          dataKey="value"
                          name={`${chartKey} ${seriesTitle}`}
                          stroke="#38bdf8"
                          fill="url(#aumUsFill)"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="empty">거래대금 시계열 불러오는 중…</p>
                )}
              </div>

              <div className="etfdbus-chart-head" style={{ marginTop: 14 }}>
                <h3 className="etfdb-detail-title" style={{ margin: 0 }}>
                  종목 AUM · 거래대금(누적)
                </h3>
                <select
                  className="etfdb-search"
                  value={focusSymbol}
                  onChange={(e) => setFocusSymbol(e.target.value)}
                  aria-label="종목 선택"
                >
                  {focusOptions.map((o) => (
                    <option key={o.symbol} value={o.symbol}>
                      {o.watch ? "★ " : ""}
                      {o.symbol} · {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="etfdb-chart etfdbus-chart-lg">
                {tickerChartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={tickerChartData}
                      margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient id="tickerAumFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(43,54,72,0.8)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        minTickGap={28}
                      />
                      <YAxis
                        yAxisId="aum"
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        width={68}
                        tickFormatter={(v) => fmtUsdMn(Number(v))}
                        domain={tickerAumDomain}
                        allowDataOverflow
                      />
                      <YAxis
                        yAxisId="turn"
                        orientation="right"
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        width={72}
                        tickFormatter={(v) => fmtUsdMn(Number(v))}
                        domain={tickerTurnDomain}
                        allowDataOverflow
                      />
                      <Tooltip
                        formatter={(v) => fmtUsdMn(typeof v === "number" ? v : null)}
                        contentStyle={{
                          background: "#141d2b",
                          border: "1px solid #2b3648",
                        }}
                      />
                      <Legend />
                      <Area
                        yAxisId="aum"
                        type="monotone"
                        dataKey="aum"
                        name={`${focusSymbol} AUM`}
                        stroke="#34d399"
                        fill="url(#tickerAumFill)"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="turn"
                        type="monotone"
                        dataKey="turnover_cum"
                        name={`${focusSymbol} 거래대금`}
                        stroke="#38bdf8"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="empty">종목 시계열 없음</p>
                )}
              </div>

              <div className="etfdb-toolbar">
                <h3 className="etfdb-detail-title">
                  {selected || "전체"} · {filteredRows.length}종
                </h3>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="심볼·종목·테마 검색"
                  className="etfdb-search"
                />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="etfdb-search"
                >
                  <option value="turnover">거래대금 큰순</option>
                  <option value="aum">AUM 큰순</option>
                  <option value="flow">수급 큰순</option>
                  <option value="change">등락 큰순</option>
                  <option value="name">이름순</option>
                </select>
              </div>

              <div className="etfdb-table-wrap">
                <table className="etfdb-table">
                  <thead>
                    <tr>
                      <th>심볼</th>
                      <th>종목</th>
                      <th>테마</th>
                      <th className="num">거래대금</th>
                      <th className="num">AUM</th>
                      <th className="num">가격</th>
                      <th className="num">수급</th>
                      <th className="num">등락</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 400).map((r) => (
                      <tr
                        key={r.symbol}
                        className={
                          r.symbol === focusSymbol
                            ? "etfdbus-watch-row etfdbus-focus-row"
                            : r.watch
                              ? "etfdbus-watch-row"
                              : undefined
                        }
                        onClick={() => {
                          if (data.ticker_series?.[r.symbol]) setFocusSymbol(r.symbol);
                        }}
                        style={{
                          cursor: data.ticker_series?.[r.symbol] ? "pointer" : undefined,
                        }}
                      >
                        <td>
                          <code>{r.symbol}</code>
                        </td>
                        <td>{r.name}</td>
                        <td className="meta-soft">{r.theme}</td>
                        <td className="num">{fmtUsdMn(r.turnover_mn)}</td>
                        <td className="num">{fmtUsdMn(r.aum_mn)}</td>
                        <td className="num">
                          {r.price == null
                            ? "—"
                            : r.price.toLocaleString("en-US", {
                                maximumFractionDigits: 2,
                              })}
                        </td>
                        <td className={`num ${signedClass(r.flow_mn)}`}>
                          {fmtSignedUsdMn(r.flow_mn)}
                        </td>
                        <td className={`num ${signedClass(r.change_rate)}`}>
                          {r.change_rate == null
                            ? "—"
                            : `${r.change_rate > 0 ? "+" : ""}${r.change_rate.toFixed(2)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {showFlowPanel ? (
              <aside className="etfdbus-flow-side" aria-label="ETF 수급 사이드">
                <div className="etfdbus-chart-head">
                  <h3 className="etfdb-detail-title" style={{ margin: 0 }}>
                    ETF 수급
                    <span className="etfdb-chart-mode">실험 · 스냅샷 대기</span>
                  </h3>
                  <button
                    type="button"
                    className="tab-btn sub"
                    onClick={() => setShowFlowPanel(false)}
                  >
                    닫기
                  </button>
                </div>
                <p className="meta-soft" style={{ margin: "0.35rem 0 0.6rem" }}>
                  NAV×Δ설정좌수. 현재 추정 수급{" "}
                  <span className={signedClass(totalFlow)}>
                    {totalFlow == null ? "대기중" : fmtSignedUsdMn(totalFlow)}
                  </span>
                  {data.prev_as_of ? ` · 전일 ${data.prev_as_of}` : ""}
                </p>
                <div className="etfdbus-series-tabs" role="tablist" aria-label="수급">
                  {(
                    [
                      ["flow_cum", "누적"],
                      ["flow_daily", "일별"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`tab-btn sub ${flowKind === id ? "active" : ""}`}
                      onClick={() => setFlowKind(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="etfdb-chart etfdbus-chart-side">
                  {flowChartData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={flowChartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid stroke="rgba(43,54,72,0.8)" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: "#8fa3b8", fontSize: 10 }}
                          minTickGap={36}
                        />
                        <YAxis
                          tick={{ fill: "#8fa3b8", fontSize: 10 }}
                          tickFormatter={(v) => fmtSignedUsdMn(Number(v))}
                          width={64}
                          domain={flowDomain}
                          allowDataOverflow
                        />
                        <Tooltip
                          formatter={(v) =>
                            fmtSignedUsdMn(typeof v === "number" ? v : null)
                          }
                          contentStyle={{
                            background: "#141d2b",
                            border: "1px solid #2b3648",
                          }}
                        />
                        <Legend />
                        {multiFlowMode ? (
                          flowMultiLabels.map((lab, i) => (
                            <Line
                              key={lab}
                              type="monotone"
                              dataKey={lab}
                              name={lab}
                              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                              strokeWidth={1.5}
                              dot={false}
                              connectNulls
                              isAnimationActive={false}
                            />
                          ))
                        ) : (
                          <Line
                            type="monotone"
                            dataKey="value"
                            name={`${chartKey} 수급`}
                            stroke="#fbbf24"
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="empty">수급 시계열 없음</p>
                  )}
                </div>
              </aside>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

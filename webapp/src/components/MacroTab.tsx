"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  MACRO_RANGES,
  type MacroAsset,
  type MacroMetric,
  type MacroPayload,
  type MacroPoint,
  type MacroRange,
} from "@/lib/macro";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtBps(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(0)}bp`;
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.02) return "up";
  if (n < -0.02) return "down";
  return "flat";
}

function stressLevel(score: number): "calm" | "caution" | "elevated" | "hot" {
  if (score >= 75) return "hot";
  if (score >= 55) return "elevated";
  if (score >= 35) return "caution";
  return "calm";
}

function componentLabel(key: string): string {
  switch (key) {
    case "curve":
      return "수익률 곡선";
    case "credit":
      return "신용";
    case "volatility":
      return "변동성";
    case "risk_appetite":
      return "리스크 온/오프";
    default:
      return key;
  }
}

function groupLabel(group: MacroAsset["group"]): string {
  switch (group) {
    case "equity":
      return "주식";
    case "rates":
      return "금리";
    case "credit":
      return "신용";
    case "commodity":
      return "원자재";
    case "fx":
      return "환율";
    default:
      return group;
  }
}

function MetricChart({
  series,
  height = 120,
  color = "#60a5fa",
  inverted = false,
}: {
  series?: MacroPoint[];
  height?: number;
  color?: string;
  inverted?: boolean;
}) {
  if (!series?.length) {
    return <div className="geo-chart-empty">시계열 없음</div>;
  }
  const data = series.map((p) => ({ date: p.date.slice(5), value: p.value }));
  const stroke = inverted ? "#f87171" : color;
  return (
    <div className="geo-chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`mg-${stroke.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis
            domain={["auto", "auto"]}
            width={36}
            tick={{ fill: "#93a4c3", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "#121b2d",
              border: "1px solid #243049",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#93a4c3" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            fill={`url(#mg-${stroke.replace("#", "")})`}
            strokeWidth={1.6}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function YieldCurveChart({
  curve,
}: {
  curve: MacroPayload["yield_curve"];
}) {
  const data = curve.filter((r) => r.value != null);
  if (!data.length) return <div className="geo-chart-empty">수익률 곡선 데이터 없음</div>;
  return (
    <div className="geo-chart-wrap" style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis
            dataKey="tenor"
            tick={{ fill: "#93a4c3", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#93a4c3", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
            unit="%"
          />
          <Tooltip
            formatter={(v) => [`${Number(v).toFixed(2)}%`, "수익률"]}
            contentStyle={{
              background: "#121b2d",
              border: "1px solid #243049",
              borderRadius: 8,
            }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((row) => (
              <Cell
                key={row.tenor}
                fill={row.tenor === "10Y" ? "#60a5fa" : "#2dd4bf"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ComponentBars({
  components,
}: {
  components: MacroPayload["stress"]["components"];
}) {
  const rows = Object.entries(components).map(([key, value]) => ({
    key,
    label: componentLabel(key),
    value: Math.round(value),
  }));
  return (
    <div className="macro-comp-bars">
      {rows.map((r) => (
        <div key={r.key} className="macro-comp-row">
          <div className="macro-comp-meta">
            <span>{r.label}</span>
            <strong>{r.value}</strong>
          </div>
          <div className="macro-comp-track">
            <div
              className="macro-comp-fill"
              data-level={stressLevel(r.value)}
              style={{ width: `${r.value}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function metricDelta(m: MacroMetric): string {
  if (m.unit === "ret" || m.id === "hyg_tlt") {
    return fmtPct(m.change_5d);
  }
  if (m.unit === "pct" && (m.group === "credit" || m.group === "curve")) {
    const d = m.change_5d;
    if (d == null) return "—";
    const sign = d > 0 ? "+" : "";
    return `${sign}${(d * 100).toFixed(0)}bp /5d`;
  }
  return m.change_5d != null ? `${m.change_5d > 0 ? "+" : ""}${m.change_5d.toFixed(2)} /5d` : "—";
}

export default function MacroTab() {
  const [range, setRange] = useState<MacroRange>("3mo");
  const [data, setData] = useState<MacroPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string>("hy_oas");

  const load = useCallback(async (nextRange: MacroRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/macro?range=${nextRange}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as MacroPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
    const id = window.setInterval(() => void load(range), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load, range]);

  const featured = useMemo(() => {
    if (!data?.metrics?.length) return null;
    return (
      data.metrics.find((m) => m.id === selectedMetric) ||
      data.metrics.find((m) => m.series?.length) ||
      data.metrics[0]
    );
  }, [data, selectedMetric]);

  const creditMetrics = data?.metrics.filter((m) => m.group === "credit") || [];
  const rateMetrics = data?.metrics.filter(
    (m) => m.group === "rates" || m.group === "policy" || m.group === "curve",
  ) || [];
  const volMetrics = data?.metrics.filter(
    (m) => m.group === "vol" || m.group === "market",
  ) || [];
  const rangeLabel = MACRO_RANGES.find((r) => r.id === range)?.label || range;

  const snapCards = data
    ? [
        {
          id: "dgs10",
          label: "10Y",
          value: fmtNum(data.snapshot.DGS10),
          sub: "Treasury %",
        },
        {
          id: "t10y2y",
          label: "10Y−2Y",
          value: fmtPct(data.snapshot.T10Y2Y),
          sub: "커브 스프레드",
        },
        {
          id: "hy",
          label: "HY OAS",
          value:
            data.snapshot.HY_OAS != null
              ? fmtBps(data.snapshot.HY_OAS)
              : "—",
          sub:
            data.snapshot.HY_OAS != null
              ? `${fmtNum(data.snapshot.HY_OAS)}%`
              : "FRED 필요",
        },
        {
          id: "ig",
          label: "IG OAS",
          value:
            data.snapshot.IG_OAS != null
              ? fmtBps(data.snapshot.IG_OAS)
              : "—",
          sub:
            data.snapshot.IG_OAS != null
              ? `${fmtNum(data.snapshot.IG_OAS)}%`
              : "FRED 필요",
        },
        {
          id: "vix",
          label: "VIX",
          value: fmtNum(data.snapshot.VIX, 1),
          sub: "변동성",
        },
        {
          id: "spy20",
          label: "SPY 20D",
          value: fmtPct(data.snapshot.SPY_20D),
          sub: "위험자산",
        },
      ]
    : [];

  return (
    <div className="geo-tab macro-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">경제 · Macro Risk Monitor</h2>
            <p className="macro-subhead">
              FRED 금리·신용 스프레드 · VIX · 크로스에셋 — 텔레그램{" "}
              <code>/macro</code> 모니터의 웹 버전
            </p>
          </div>
          <div className="chip-row geo-range-chips" role="group" aria-label="차트 기간">
            {MACRO_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`chip ${range === r.id ? "active" : ""}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading && !data ? <p className="empty">매크로 데이터 불러오는 중…</p> : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <>
            <div className="geo-composite macro-stress">
              <div
                className="geo-score-ring"
                data-level={
                  data.stress.score >= 55
                    ? "hot"
                    : data.stress.score >= 35
                      ? "warm"
                      : "cool"
                }
              >
                <span className="geo-score-num">{data.stress.score}</span>
                <span className="geo-score-label">스트레스</span>
              </div>
              <div className="geo-composite-body">
                <h3>
                  {data.stress.regime_ko}{" "}
                  <span className="macro-regime-en">{data.stress.regime}</span>
                </h3>
                <ul>
                  {data.stress.drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <ComponentBars components={data.stress.components} />
                <p className="meta-soft">
                  갱신{" "}
                  {new Date(data.generated_at).toLocaleString("ko-KR", {
                    hour12: false,
                  })}{" "}
                  · {rangeLabel} · {data.note}
                </p>
              </div>
            </div>

            <div className="macro-snap-grid">
              {snapCards.map((c) => (
                <article key={c.id} className="macro-snap-card">
                  <span className="macro-snap-label">{c.label}</span>
                  <strong className="macro-snap-value">{c.value}</strong>
                  <em className="macro-snap-sub">{c.sub}</em>
                </article>
              ))}
            </div>

            <div className="macro-two-col">
              <section className="geo-section geo-featured">
                <h3 className="geo-section-title">국채 수익률 곡선</h3>
                <YieldCurveChart curve={data.yield_curve} />
                <p className="meta-soft">
                  Fed Funds {fmtNum(data.snapshot.FED_FUNDS)}% · 3M{" "}
                  {fmtNum(data.snapshot.DGS3MO)}% · 2Y {fmtNum(data.snapshot.DGS2)}%
                </p>
              </section>

              <section className="geo-section geo-featured">
                <div className="geo-featured-head">
                  <div>
                    <h3 className="geo-section-title">
                      {featured?.label || "지표"}
                      {featured?.source ? (
                        <code className="geo-inline-code">{featured.source}</code>
                      ) : null}
                    </h3>
                    <p className="geo-thesis">
                      {featured?.note ||
                        "클릭한 지표의 시계열 · 스프레드 확대 = 위험 회피"}
                    </p>
                  </div>
                  <div className="geo-featured-stats">
                    <div className="geo-signal-price">
                      {featured?.unit === "pct"
                        ? `${fmtNum(featured.value)}%`
                        : fmtNum(featured?.value, featured?.unit === "index" ? 1 : 2)}
                    </div>
                    <div className="geo-signal-chgs">
                      <span className={retClass(featured?.change_5d)}>
                        {metricDelta(featured || ({} as MacroMetric))}
                      </span>
                    </div>
                  </div>
                </div>
                <MetricChart
                  series={featured?.series}
                  height={200}
                  color={
                    featured?.group === "credit"
                      ? "#fb923c"
                      : featured?.group === "vol"
                        ? "#a78bfa"
                        : "#60a5fa"
                  }
                  inverted={
                    featured?.group === "credit" || featured?.group === "vol"
                  }
                />
              </section>
            </div>

            <section className="geo-section">
              <h3 className="geo-section-title">금리 · 커브 · 정책</h3>
              <div className="macro-metric-grid">
                {rateMetrics.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`macro-metric-card ${
                      selectedMetric === m.id ? "active" : ""
                    }`}
                    onClick={() => setSelectedMetric(m.id)}
                  >
                    <div className="macro-metric-top">
                      <strong>{m.label}</strong>
                      <span className={retClass(m.change_5d)}>
                        {metricDelta(m)}
                      </span>
                    </div>
                    <div className="macro-metric-val">
                      {m.value != null ? `${fmtNum(m.value)}%` : "—"}
                    </div>
                    <MetricChart series={m.series} height={72} color="#2dd4bf" />
                  </button>
                ))}
              </div>
            </section>

            <section className="geo-section">
              <h3 className="geo-section-title">신용 스프레드 (HY / IG OAS)</h3>
              {!data.uses_fred && !creditMetrics.some((m) => m.series?.length) ? (
                <p className="empty warn">
                  HY·IG OAS는 FRED 시계열입니다. Vercel에{" "}
                  <code>FRED_API_KEY</code>를 설정하면 표시됩니다. (무료:{" "}
                  <a
                    href="https://fred.stlouisfed.org/docs/api/api_key.html"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    FRED API
                  </a>
                  )
                </p>
              ) : null}
              <div className="macro-metric-grid">
                {creditMetrics.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`macro-metric-card ${
                      selectedMetric === m.id ? "active" : ""
                    }`}
                    onClick={() => setSelectedMetric(m.id)}
                  >
                    <div className="macro-metric-top">
                      <strong>{m.label}</strong>
                      <span className={retClass(m.change_5d)}>
                        {metricDelta(m)}
                      </span>
                    </div>
                    <div className="macro-metric-val">
                      {m.value != null
                        ? `${fmtNum(m.value)}% · ${fmtBps(m.value)}`
                        : "—"}
                    </div>
                    <MetricChart
                      series={m.series}
                      height={72}
                      color="#fb923c"
                      inverted
                    />
                    {m.note ? <p className="geo-thesis">{m.note}</p> : null}
                  </button>
                ))}
              </div>
            </section>

            <section className="geo-section">
              <h3 className="geo-section-title">변동성 · 리스크 온/오프</h3>
              <div className="macro-metric-grid">
                {volMetrics.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`macro-metric-card ${
                      selectedMetric === m.id ? "active" : ""
                    }`}
                    onClick={() => setSelectedMetric(m.id)}
                  >
                    <div className="macro-metric-top">
                      <strong>{m.label}</strong>
                      <span className={retClass(m.change_5d ?? m.change_20d)}>
                        {m.id === "hyg_tlt"
                          ? `20D ${fmtPct(m.change_20d)}`
                          : metricDelta(m)}
                      </span>
                    </div>
                    <div className="macro-metric-val">{fmtNum(m.value, 2)}</div>
                    <MetricChart
                      series={m.series}
                      height={72}
                      color="#a78bfa"
                      inverted={m.id === "vix"}
                    />
                    {m.note ? <p className="geo-thesis">{m.note}</p> : null}
                  </button>
                ))}
              </div>
            </section>

            {(
              ["equity", "rates", "credit", "commodity", "fx"] as MacroAsset["group"][]
            ).map((group) => {
              const rows = data.assets.filter((a) => a.group === group);
              if (!rows.length) return null;
              return (
                <section key={group} className="geo-section">
                  <h3 className="geo-section-title">
                    크로스에셋 · {groupLabel(group)}
                  </h3>
                  <div className="geo-signal-grid geo-signal-grid-charts">
                    {rows.map((a) => (
                      <article key={a.id} className="geo-signal-card">
                        <div className="geo-signal-top">
                          <strong>{a.label}</strong>
                          <code>{a.symbol}</code>
                        </div>
                        <div className="geo-signal-price">
                          {a.price != null ? a.price.toFixed(2) : "—"}
                        </div>
                        <div className="geo-signal-chgs">
                          <span className={retClass(a.change_1d_pct)}>
                            1D {fmtPct(a.change_1d_pct)}
                          </span>
                          <span className={retClass(a.change_range_pct)}>
                            {rangeLabel} {fmtPct(a.change_range_pct)}
                          </span>
                        </div>
                        <MetricChart
                          series={a.series}
                          height={100}
                          color={
                            (a.change_range_pct ?? 0) >= 0 ? "#34d399" : "#f87171"
                          }
                        />
                        <p className="geo-thesis">{a.thesis}</p>
                        {a.error ? (
                          <p className="empty warn">{a.error}</p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}

            <section className="geo-section">
              <h3 className="geo-section-title">미국 고영향 경제지표 캘린더</h3>
              {!data.calendar.length ? (
                <p className="empty">
                  Finnhub 캘린더가 비어 있거나{" "}
                  <code>FINNHUB_API_KEY</code>가 없습니다. 텔레그램{" "}
                  <code>/macro</code>와 동일 키를 Vercel에 넣으면 표시됩니다.
                </p>
              ) : (
                <div className="macro-cal-table-wrap">
                  <table className="macro-cal-table">
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>지표</th>
                        <th>실제</th>
                        <th>예상</th>
                        <th>이전</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.calendar.map((e, i) => (
                        <tr key={`${e.date}-${e.event}-${i}`}>
                          <td>
                            {e.date}
                            {e.time ? ` ${e.time}` : ""}
                          </td>
                          <td>
                            <strong>{e.event}</strong>
                          </td>
                          <td>{e.actual ?? "—"}</td>
                          <td>{e.estimate ?? "—"}</td>
                          <td>{e.prev ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {data.error ? (
              <p className="empty warn">일부 소스 경고: {data.error}</p>
            ) : null}

            <button
              type="button"
              className="btn ghost"
              onClick={() => void load(range)}
              disabled={loading}
            >
              {loading ? "새로고침 중…" : "새로고침"}
            </button>
          </>
        ) : null}
      </section>
    </div>
  );
}

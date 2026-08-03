"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  YEN_CARRY_RANGES,
  componentLabel,
  type YenCarryPayload,
  type YenCarryPoint,
  type YenCarryRange,
  type YenCarryStressComponents,
} from "@/lib/yenCarry";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtPp(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}pp`;
}

function fmtContracts(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString();
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function stressLevel(score: number): "cool" | "warm" | "hot" {
  if (score >= 55) return "hot";
  if (score >= 35) return "warm";
  return "cool";
}

function SeriesChart({
  series,
  height = 160,
  color = "#0f766e",
  unit = "",
}: {
  series: YenCarryPoint[];
  height?: number;
  color?: string;
  unit?: string;
}) {
  if (!series.length) {
    return <div className="geo-chart-empty">시계열 없음</div>;
  }
  const data = series.map((p) => ({ date: p.date.slice(5), value: p.value }));
  const gid = `yc-${color.replace("#", "")}-${height}`;
  return (
    <div className="geo-chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis
            domain={["auto", "auto"]}
            width={44}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickFormatter={(v: number) =>
              unit === "%" || unit === "pp"
                ? v.toFixed(1)
                : Math.abs(v) >= 1000
                  ? `${(v / 1000).toFixed(0)}k`
                  : v.toFixed(1)
            }
          />
          <Tooltip
            formatter={(value) =>
              typeof value === "number"
                ? unit
                  ? `${value.toFixed(2)}${unit}`
                  : value.toFixed(2)
                : "—"
            }
            labelFormatter={(label) => String(label)}
            contentStyle={{
              background: "rgba(15,23,42,0.92)",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={`url(#${gid})`}
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ComponentBars({
  components,
}: {
  components: YenCarryStressComponents;
}) {
  const keys = Object.keys(components) as Array<keyof YenCarryStressComponents>;
  return (
    <div className="macro-comp-bars">
      {keys.map((key) => {
        const value = Math.round(components[key]);
        return (
          <div key={key} className="macro-comp-row">
            <div className="macro-comp-meta">
              <span>{componentLabel(key)}</span>
              <strong>{value}</strong>
            </div>
            <div className="macro-comp-track">
              <div
                className="macro-comp-fill"
                data-level={
                  value >= 75
                    ? "hot"
                    : value >= 55
                      ? "elevated"
                      : value >= 35
                        ? "caution"
                        : "calm"
                }
                style={{ width: `${value}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function YenCarryTab() {
  const [range, setRange] = useState<YenCarryRange>("1y");
  const [data, setData] = useState<YenCarryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: YenCarryRange) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/yen-carry?range=${encodeURIComponent(r)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as YenCarryPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const cftcChart = useMemo(() => {
    return (data?.cftc || []).map((p) => ({
      date: p.date.slice(5),
      net: p.net_noncomm,
    }));
  }, [data]);

  const snap = data?.snapshot;

  return (
    <div className="geo-tab macro-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">엔케리 모니터</h2>
            <p className="macro-subhead">
              엔 조달 캐리 청산 경로 — 금리차 · USD/JPY · VIX · CFTC 숏엔 ·
              크로스에셋
            </p>
          </div>
          <div
            className="chip-row geo-range-chips"
            role="group"
            aria-label="차트 기간"
          >
            {YEN_CARRY_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`chip ${range === r.id ? "active" : ""}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void load(range)}
              disabled={loading}
            >
              새로고침
            </button>
          </div>
        </div>

        {loading && !data ? (
          <p className="empty">엔케리 데이터 불러오는 중…</p>
        ) : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <>
            <p className="macro-schedule">{data.schedule_note}</p>

            <div className="geo-composite macro-stress">
              <div
                className="geo-score-ring"
                data-level={stressLevel(data.stress.score)}
              >
                <span className="geo-score-num">{data.stress.score}</span>
                <span className="geo-score-label">청산위험</span>
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
                  · {range} · {data.note}
                </p>
              </div>
            </div>

            <div className="macro-snap-grid macro-snap-grid-wide">
              <article className="macro-snap-card">
                <span className="macro-snap-label">USD/JPY</span>
                <strong className="macro-snap-value">
                  {fmtNum(snap?.usdjpy, 2)}
                </strong>
                <em className="macro-snap-sub">
                  5D {fmtPct(snap?.usdjpy_5d_pct)} · 20D{" "}
                  {fmtPct(snap?.usdjpy_20d_pct)}
                </em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">실현 vol (20D)</span>
                <strong className="macro-snap-value">
                  {fmtNum(snap?.usdjpy_realized_vol_20d, 1)}%
                </strong>
                <em className="macro-snap-sub">≳12–15%면 청산 구간과 겹침</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">미–일 10Y</span>
                <strong className="macro-snap-value">
                  {fmtNum(snap?.rate_spread_10y, 2)}pp
                </strong>
                <em className="macro-snap-sub">
                  US {fmtNum(snap?.us_10y)} · JP {fmtNum(snap?.jp_10y)} · 60D{" "}
                  {fmtPp(snap?.rate_spread_60d_chg)}
                </em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">Carry-to-risk</span>
                <strong className="macro-snap-value">
                  {fmtNum(snap?.carry_to_risk, 3)}
                </strong>
                <em className="macro-snap-sub">금리차 / USDJPY 실현 vol</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">VIX</span>
                <strong className="macro-snap-value">
                  {fmtNum(snap?.vix, 1)}
                </strong>
                <em className="macro-snap-sub">주식 변동성·마진</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">CFTC 순매도</span>
                <strong className="macro-snap-value">
                  {fmtContracts(snap?.cftc_net_noncomm)}
                </strong>
                <em className="macro-snap-sub">
                  비상업 순포지션 · as of {snap?.cftc_as_of || "—"}
                </em>
              </article>
            </div>

            <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
              <h3 className="geo-section-title">캐리 유인</h3>
              <p className="geo-thesis">
                미–일 10Y 스프레드와 carry-to-risk. 스프레드 급축·CTR 하락은 캐리
                유지 비용 상승을 뜻합니다.
              </p>
              <div className="macro-two-col">
                <div>
                  <p className="meta-soft" style={{ marginBottom: 6 }}>
                    미–일 10Y 스프레드 (pp)
                  </p>
                  <SeriesChart
                    series={data.series.rate_spread_10y}
                    color="#b45309"
                    unit="pp"
                    height={180}
                  />
                </div>
                <div>
                  <p className="meta-soft" style={{ marginBottom: 6 }}>
                    Carry-to-risk
                  </p>
                  <SeriesChart
                    series={data.series.carry_to_risk}
                    color="#0f766e"
                    height={180}
                  />
                </div>
              </div>
            </section>

            <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
              <h3 className="geo-section-title">USD/JPY 펄스</h3>
              <p className="geo-thesis">
                스팟 레벨·속도와 실현 변동성. 엔 급등(USD/JPY 급락) + vol 스파이크가
                숏엔 청산의 핵심 경로입니다.
              </p>
              <div className="macro-two-col">
                <div>
                  <p className="meta-soft" style={{ marginBottom: 6 }}>
                    USD/JPY
                  </p>
                  <SeriesChart
                    series={data.series.usdjpy}
                    color="#1d4ed8"
                    height={180}
                  />
                </div>
                <div>
                  <p className="meta-soft" style={{ marginBottom: 6 }}>
                    실현 vol 20D (%)
                  </p>
                  <SeriesChart
                    series={data.series.usdjpy_realized_vol}
                    color="#be123c"
                    unit="%"
                    height={180}
                  />
                </div>
              </div>
            </section>

            <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
              <h3 className="geo-section-title">포지션 · CFTC 엔 선물</h3>
              <p className="geo-thesis">
                비상업(투기) 순포지션. 음수 = 순매도(숏엔). 극단 숏에서 반전하면
                커버 매수가 엔 강세를 증폭합니다.
              </p>
              {cftcChart.length ? (
                <div className="geo-chart-wrap" style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={cftcChart}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke="rgba(148,163,184,0.12)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        minTickGap={28}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        width={52}
                        tickFormatter={(v: number) =>
                          `${(v / 1000).toFixed(0)}k`
                        }
                      />
                      <Tooltip
                        formatter={(value) =>
                          typeof value === "number"
                            ? Math.round(value).toLocaleString()
                            : "—"
                        }
                        contentStyle={{
                          background: "rgba(15,23,42,0.92)",
                          border: "none",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="net"
                        name="순포지션"
                        fill="#0f766e"
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="empty">CFTC 데이터가 없습니다.</p>
              )}
            </section>

            <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
              <h3 className="geo-section-title">크로스에셋 보드</h3>
              <p className="geo-thesis">
                청산이 주식·EM FX·크레딧으로 전파되는지 한눈에 봅니다.
              </p>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>자산</th>
                      <th>가격</th>
                      <th>1D</th>
                      <th>5D</th>
                      <th>20D</th>
                      <th>구간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.assets || []).map((a) => (
                      <tr key={a.id} title={a.thesis}>
                        <td>
                          <strong>{a.label}</strong>
                          <div className="meta-soft">{a.symbol}</div>
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {fmtNum(a.price, a.group === "equity" ? 0 : 3)}
                        </td>
                        <td className={retClass(a.change_1d_pct)}>
                          {fmtPct(a.change_1d_pct)}
                        </td>
                        <td className={retClass(a.change_5d_pct)}>
                          {fmtPct(a.change_5d_pct)}
                        </td>
                        <td className={retClass(a.change_20d_pct)}>
                          {fmtPct(a.change_20d_pct)}
                        </td>
                        <td className={retClass(a.change_range_pct)}>
                          {fmtPct(a.change_range_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {snap?.hy_oas != null ? (
                <p className="meta-soft" style={{ marginTop: 8 }}>
                  HY OAS {fmtNum(snap.hy_oas)}% — 신용 스프레드 확대는 위험선호
                  후퇴 신호
                </p>
              ) : null}
            </section>

            {(data.notes || []).length ? (
              <ul className="panel-sub" style={{ marginTop: 16 }}>
                {data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

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
  DERIV_GROUP_LABELS,
  DERIV_RANGES,
  type DerivContract,
  type DerivGroup,
  type DerivPayload,
  type DerivPoint,
  type DerivRange,
  type DerivSpread,
  type DerivVolTenor,
} from "@/lib/derivatives";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString("en-US", { maximumFractionDigits: digits });
  }
  return n.toFixed(digits);
}

function fmtVol(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.02) return "up";
  if (n < -0.02) return "down";
  return "flat";
}

function pulseLevel(score: number): "cool" | "warm" | "hot" {
  if (score >= 55) return "hot";
  if (score >= 35) return "warm";
  return "cool";
}

function componentLabel(key: string): string {
  switch (key) {
    case "equity_vol":
      return "주식 변동성";
    case "vol_term":
      return "VIX 기간구조";
    case "options":
      return "옵션 센티먼트";
    case "rates_vol":
      return "금리 변동성";
    default:
      return key;
  }
}

function spreadValue(s: DerivSpread): string {
  if (s.value == null) return "—";
  if (s.unit === "pct") return fmtPct(s.value);
  if (s.unit === "ratio") return fmtNum(s.value, 2);
  if (s.unit === "usd") return fmtNum(s.value, 2);
  return fmtNum(s.value, s.value >= 100 ? 1 : 2);
}

function VolCurveChart({ curve }: { curve: DerivVolTenor[] }) {
  const data = curve.filter((r) => r.value != null);
  if (!data.length) {
    return <div className="geo-chart-empty">변동성 기간구조 없음</div>;
  }
  return (
    <div className="geo-chart-wrap" style={{ height: 200 }}>
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
            width={36}
          />
          <Tooltip
            formatter={(v) => [Number(v).toFixed(2), "VIX"]}
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
                fill={row.tenor === "1M" ? "#a78bfa" : "#60a5fa"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Sparkline({
  series,
  height = 88,
  color = "#60a5fa",
  gid,
}: {
  series?: DerivPoint[];
  height?: number;
  color?: string;
  gid: string;
}) {
  if (!series?.length) {
    return <div className="geo-chart-empty">시계열 없음</div>;
  }
  const data = series.map((p) => ({ date: p.date.slice(5), value: p.value }));
  const gradId = `dg-${gid}`;
  return (
    <div className="geo-chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
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
            stroke={color}
            fill={`url(#${gradId})`}
            strokeWidth={1.6}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ContractCard({ c }: { c: DerivContract }) {
  return (
    <article className="geo-signal-card">
      <div className="geo-signal-top">
        <strong>
          {c.label}
          <span className="deriv-ko"> {c.label_ko}</span>
        </strong>
        <code>
          {c.venue} · {c.symbol}
        </code>
      </div>
      <div className="geo-signal-price">{fmtNum(c.price)}</div>
      <div className="geo-signal-chgs">
        <span className={retClass(c.change_1d_pct)}>1D {fmtPct(c.change_1d_pct)}</span>
        <span className={retClass(c.change_5d_pct)}>5D {fmtPct(c.change_5d_pct)}</span>
        <span className={retClass(c.change_range_pct)}>
          기간 {fmtPct(c.change_range_pct)}
        </span>
      </div>
      <Sparkline
        gid={c.id}
        series={c.series}
        height={96}
        color={(c.change_range_pct ?? 0) >= 0 ? "#34d399" : "#f87171"}
      />
      <p className="geo-thesis">{c.thesis}</p>
      {c.volume != null ? (
        <p className="meta-soft">거래량 {fmtVol(c.volume)}</p>
      ) : null}
      {c.error ? <p className="empty warn">{c.error}</p> : null}
    </article>
  );
}

const GROUP_ORDER: DerivGroup[] = [
  "vol",
  "equity",
  "rates",
  "fx",
  "commodity",
  "crypto",
];

export default function DerivativesTab() {
  const [range, setRange] = useState<DerivRange>("3mo");
  const [data, setData] = useState<DerivPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextRange: DerivRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/derivatives?range=${nextRange}`);
      const json = (await res.json()) as DerivPayload;
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
    const id = window.setInterval(() => void load(range), 120_000);
    return () => window.clearInterval(id);
  }, [load, range]);

  const contracts = data?.contracts || [];
  const featured = useMemo(
    () => (data?.contracts || []).filter((c) => c.featured && c.price != null),
    [data],
  );
  const spreads = data?.spreads || [];
  const rangeLabel = DERIV_RANGES.find((r) => r.id === range)?.label || range;

  return (
    <div className="geo-tab macro-tab deriv-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">Derivatives · 선물/옵션 모니터</h2>
            <p className="macro-subhead">
              주요 선물·옵션 시장 지표를 한눈에 봅니다. 실현변동성·상관은 Volatility
              Monitor, 귀금속·가상자산 전용 화면은 각 탭을 유지합니다.
            </p>
          </div>
          <div className="chip-row geo-range-chips" role="group" aria-label="차트 기간">
            {DERIV_RANGES.map((r) => (
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

        {loading && !data ? (
          <p className="empty">선물·옵션 데이터 불러오는 중…</p>
        ) : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <>
            <p className="macro-schedule">
              {data.note} · {rangeLabel} ·{" "}
              {new Date(data.generated_at).toLocaleString("ko-KR", {
                hour12: false,
              })}
            </p>

            <div className="geo-composite macro-stress">
                  <div
                    className="geo-score-ring"
                    data-level={pulseLevel(data.pulse.score)}
                  >
                    <span className="geo-score-num">{data.pulse.score}</span>
                    <span className="geo-score-label">펄스</span>
                  </div>
                  <div className="geo-composite-body">
                    <h3>
                      {data.pulse.regime_ko}{" "}
                      <span className="macro-regime-en">{data.pulse.regime}</span>
                    </h3>
                    <ul>
                      {data.pulse.drivers.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                    <div className="macro-comp-bars">
                      {Object.entries(data.pulse.components).map(([k, v]) => (
                        <div key={k} className="macro-comp-row">
                          <div className="macro-comp-meta">
                            <span>{componentLabel(k)}</span>
                            <strong>{v}</strong>
                          </div>
                          <div className="macro-comp-track">
                            <div
                              className="macro-comp-fill"
                              data-level={
                                v >= 75
                                  ? "hot"
                                  : v >= 55
                                    ? "elevated"
                                    : v >= 35
                                      ? "caution"
                                      : undefined
                              }
                              style={{ width: `${v}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="macro-snap-grid macro-snap-grid-wide">
                  {featured.map((c) => (
                    <article key={c.id} className="macro-snap-card">
                      <span className="macro-snap-label">
                        {c.label} · {c.label_ko}
                      </span>
                      <strong className="macro-snap-value">{fmtNum(c.price)}</strong>
                      <em className={`macro-snap-sub ${retClass(c.change_1d_pct)}`}>
                        1D {fmtPct(c.change_1d_pct)}
                      </em>
                    </article>
                  ))}
                </div>

                <div className="macro-two-col">
                  <section className="geo-section geo-featured">
                    <h3 className="geo-section-title">VIX 기간구조</h3>
                    <VolCurveChart curve={data.vol_curve || []} />
                    <p className="meta-soft">
                      단기 &gt; 장기 = 백워데이션(스트레스) · 1M 막대 강조
                    </p>
                  </section>
                  <section className="geo-section geo-featured">
                    <h3 className="geo-section-title">스프레드 · 옵션 지표</h3>
                    {!spreads.length ? (
                      <p className="empty">스프레드를 계산하지 못했습니다.</p>
                    ) : (
                      <div className="deriv-spread-list">
                        {spreads.map((s) => (
                          <div key={s.id} className="deriv-spread-row">
                            <div>
                              <strong>{s.label_ko}</strong>
                              <code data-tone={s.tone}>{s.label}</code>
                            </div>
                            <em>{spreadValue(s)}</em>
                            <span className={retClass(s.change_5d)}>
                              5D{" "}
                              {s.unit === "usd" || s.unit === "index"
                                ? fmtNum(s.change_5d)
                                : fmtPct(s.change_5d)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <section className="geo-section">
                  <h3 className="geo-section-title">한눈에 보기 · 전 시장</h3>
                  <div className="deriv-table-wrap">
                    <table className="deriv-table">
                      <thead>
                        <tr>
                          <th>시장</th>
                          <th>계약</th>
                          <th>가격</th>
                          <th>1D</th>
                          <th>5D</th>
                          <th>{rangeLabel}</th>
                          <th>거래량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contracts.map((c) => (
                          <tr key={c.id}>
                            <td>{DERIV_GROUP_LABELS[c.group]}</td>
                            <td>
                              <strong>{c.label}</strong>
                              <span className="deriv-ko"> {c.label_ko}</span>
                            </td>
                            <td>{fmtNum(c.price)}</td>
                            <td className={retClass(c.change_1d_pct)}>
                              {fmtPct(c.change_1d_pct)}
                            </td>
                            <td className={retClass(c.change_5d_pct)}>
                              {fmtPct(c.change_5d_pct)}
                            </td>
                            <td className={retClass(c.change_range_pct)}>
                              {fmtPct(c.change_range_pct)}
                            </td>
                            <td>{fmtVol(c.volume)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {spreads.length ? (
                  <section className="geo-section">
                    <h3 className="geo-section-title">스프레드 · 옵션 지표</h3>
                    <div className="geo-signal-grid geo-signal-grid-charts">
                      {spreads.map((s) => (
                        <article key={s.id} className="geo-signal-card">
                          <div className="geo-signal-top">
                            <strong>{s.label_ko}</strong>
                            <code data-tone={s.tone}>{s.label}</code>
                          </div>
                          <div className="geo-signal-price">{spreadValue(s)}</div>
                          <div className="geo-signal-chgs">
                            <span className={retClass(s.change_5d)}>
                              5D{" "}
                              {s.unit === "usd" || s.unit === "index"
                                ? fmtNum(s.change_5d)
                                : fmtPct(s.change_5d)}
                            </span>
                          </div>
                          <Sparkline
                            gid={s.id}
                            series={s.series}
                            height={96}
                            color={
                              s.tone === "hot" || s.tone === "elevated"
                                ? "#f87171"
                                : "#60a5fa"
                            }
                          />
                          <p className="geo-thesis">{s.note}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

            {GROUP_ORDER.map((group) => {
              const rows = contracts.filter((c) => c.group === group);
              if (!rows.length) return null;
              return (
                <section key={group} className="geo-section">
                  <h3 className="geo-section-title">{DERIV_GROUP_LABELS[group]}</h3>
                  <div className="geo-signal-grid geo-signal-grid-charts">
                    {rows.map((c) => (
                      <ContractCard key={c.id} c={c} />
                    ))}
                  </div>
                </section>
              );
            })}

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

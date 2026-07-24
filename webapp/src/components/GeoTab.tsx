"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  GEO_RANGES,
  type GeoChokepoint,
  type GeoHormuzCrisis,
  type GeoPayload,
  type GeoPoint,
  type GeoRange,
  type GeoSignal,
} from "@/lib/geo";

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtPrice(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1000) {
    return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  if (n >= 100) return n.toFixed(2);
  return n.toFixed(3);
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function groupLabel(group: GeoSignal["group"]): string {
  switch (group) {
    case "energy":
      return "에너지";
    case "metals":
      return "금속·원자재";
    case "risk":
      return "리스크·운임";
    case "region":
      return "지역·국가 ETF";
    case "etf":
      return "관련 ETF";
    default:
      return group;
  }
}

function chokeStatusClass(status: string): string {
  const s = status.toUpperCase();
  if (/SEVERE|CRITICAL|HIGH/.test(s)) return "severe";
  if (/ELEVATED/.test(s)) return "elevated";
  if (/WATCH|MONITORING/.test(s)) return "monitoring";
  return "normal";
}

function chokeStatusKo(status: string): string {
  const s = status.toUpperCase();
  if (/SEVERE|CRITICAL/.test(s)) return "심각";
  if (/HIGH/.test(s)) return "높음";
  if (/ELEVATED/.test(s)) return "경계";
  if (/WATCH|MONITORING/.test(s)) return "주시";
  if (/NORMAL|LOW/.test(s)) return "정상";
  return status;
}

function statusRank(status: string): number {
  const s = status.toUpperCase();
  if (/SEVERE|CRITICAL/.test(s)) return 0;
  if (/HIGH/.test(s)) return 1;
  if (/ELEVATED/.test(s)) return 2;
  if (/WATCH|MONITORING/.test(s)) return 3;
  return 4;
}

function sortChokepoints(list: GeoChokepoint[]): GeoChokepoint[] {
  return [...list].sort(
    (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      b.high_alerts_24h - a.high_alerts_24h,
  );
}

function fmtCompactUsd(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtRial(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n / 10).toLocaleString("en-US")} 토만/$`;
}

function hormuzLevel(h: GeoHormuzCrisis): "closed" | "restricted" | "open" {
  if (/closed/i.test(h.verdict_status || "")) return "closed";
  if (/restricted|disrupted|elevated/i.test(h.status || "")) return "restricted";
  return "open";
}

function HormuzPanel({ hormuz }: { hormuz: GeoHormuzCrisis }) {
  const level = hormuzLevel(hormuz);
  return (
    <section className="geo-section">
      <div className="geo-section-head">
        <h3 className="geo-section-title">이란 · 호르무즈 위기 모니터</h3>
        <p className="meta-soft geo-choke-attr">
          데이터{" "}
          <a href={hormuz.source.url} target="_blank" rel="noopener noreferrer">
            {hormuz.source.name}
          </a>
          {hormuz.source.mirror ? (
            <>
              {" "}
              ·{" "}
              <a
                href={hormuz.source.mirror}
                target="_blank"
                rel="noopener noreferrer"
              >
                공개 미러
              </a>
            </>
          ) : null}
          {hormuz.as_of
            ? ` · ${new Date(hormuz.as_of).toLocaleString("ko-KR", { hour12: false })}`
            : null}
        </p>
      </div>

      <div className={`geo-hormuz-hero ${level}`}>
        <div className="geo-hormuz-verdict">
          <span className="geo-hormuz-badge">
            {level === "closed"
              ? "사실상 봉쇄"
              : level === "restricted"
                ? "통항 제한"
                : "통항 가능"}
          </span>
          <h4>
            {hormuz.verdict_short
              ? `통항 가능? ${hormuz.verdict_short}`
              : `상태: ${hormuz.status || "—"}`}
          </h4>
          <p>{hormuz.verdict_long || "호르무즈 해협 상태 스냅샷"}</p>
        </div>
        <div className="geo-hormuz-metrics">
          <div>
            <span>위기압</span>
            <strong>
              {hormuz.crisis_pressure ?? "—"}
              {hormuz.crisis_band ? (
                <em> {hormuz.crisis_band}</em>
              ) : null}
            </strong>
          </div>
          <div>
            <span>고조 확률</span>
            <strong>
              {hormuz.escalation ?? "—"}
              {hormuz.escalation_band ? <em> {hormuz.escalation_band}</em> : null}
            </strong>
          </div>
          <div>
            <span>일일 통항</span>
            <strong>
              {hormuz.transit_count ?? "—"}
              {hormuz.transit_baseline != null
                ? ` / 기준 ${hormuz.transit_baseline}`
                : ""}
            </strong>
          </div>
          <div>
            <span>처리량</span>
            <strong>
              {hormuz.transit_throughput_pct != null
                ? `${hormuz.transit_throughput_pct}%`
                : "—"}
            </strong>
          </div>
          <div>
            <span>탱커</span>
            <strong>{hormuz.tanker_count ?? "—"}척</strong>
          </div>
          <div>
            <span>전쟁보험</span>
            <strong>
              {hormuz.insurance_multiple != null
                ? `×${hormuz.insurance_multiple}`
                : "—"}
            </strong>
          </div>
          <div>
            <span>세계 원유 위험</span>
            <strong>
              {hormuz.world_oil_at_risk_pct != null
                ? `${hormuz.world_oil_at_risk_pct}%`
                : "—"}
            </strong>
          </div>
          <div>
            <span>추정 일일 비용</span>
            <strong>{fmtCompactUsd(hormuz.daily_cost_usd)}</strong>
          </div>
          <div>
            <span>이란 리알</span>
            <strong>
              {fmtRial(hormuz.iran_usd_mid)}
              {hormuz.iran_delta_1d_pct != null ? (
                <em className={retClass(hormuz.iran_delta_1d_pct)}>
                  {" "}
                  1D {fmtPct(hormuz.iran_delta_1d_pct)}
                </em>
              ) : null}
            </strong>
          </div>
          <div>
            <span>AIS 존 내 선박</span>
            <strong>{hormuz.ais_in_zone ?? "—"}</strong>
          </div>
          <div>
            <span>우회 추가일</span>
            <strong>
              {hormuz.alt_route_extra_days != null
                ? `+${hormuz.alt_route_extra_days}일`
                : "—"}
            </strong>
          </div>
          <div>
            <span>VLCC 프리미엄</span>
            <strong>
              {hormuz.vlcc_premium_low != null && hormuz.vlcc_premium_high != null
                ? `${fmtCompactUsd(hormuz.vlcc_premium_low)}–${fmtCompactUsd(hormuz.vlcc_premium_high)}`
                : "—"}
            </strong>
          </div>
        </div>
      </div>

      {hormuz.lanes.length ? (
        <div className="geo-hormuz-lanes">
          {hormuz.lanes.map((lane) => {
            const pct =
              lane.pre_crisis_baseline && lane.n_total != null
                ? Math.round((lane.n_total / lane.pre_crisis_baseline) * 100)
                : null;
            return (
              <article key={lane.id} className="geo-lane-card">
                <strong>{lane.name}</strong>
                <div className="geo-lane-nums">
                  <span>{lane.n_total ?? "—"}척</span>
                  {pct != null ? <span>위기전 대비 {pct}%</span> : null}
                  {lane.delta_day != null ? (
                    <span className={retClass(lane.delta_day)}>
                      Δ1D {lane.delta_day > 0 ? "+" : ""}
                      {lane.delta_day}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {hormuz.carriers.length ? (
        <div className="geo-hormuz-carriers">
          <h4 className="geo-subhead">선사 우회·중단</h4>
          <ul>
            {hormuz.carriers.map((c) => (
              <li key={c.name}>
                <strong>{c.name}</strong>
                {c.notes ? <span>{c.notes}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hormuz.markets.length ? (
        <div className="geo-hormuz-markets">
          <h4 className="geo-subhead">예측시장 (이란 관련)</h4>
          <div className="geo-market-row">
            {hormuz.markets.map((m) => (
              <div key={m.title} className="geo-market-chip">
                {m.url ? (
                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                    {m.title}
                  </a>
                ) : (
                  <span>{m.title}</span>
                )}
                <strong>
                  {m.probability != null ? `${m.probability}%` : "—"}
                </strong>
                {m.venue ? <em>{m.venue}</em> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function chartStroke(change?: number | null): string {
  if (change == null) return "#4da3ff";
  if (change > 0.05) return "#3dd68c";
  if (change < -0.05) return "#f87171";
  return "#4da3ff";
}

function SignalChart({
  id,
  series,
  change,
  height = 140,
  compact = false,
}: {
  id: string;
  series?: GeoPoint[];
  change?: number | null;
  height?: number;
  compact?: boolean;
}) {
  const data = series || [];
  const stroke = chartStroke(change);
  const gradId = `geoFill-${id}`;
  if (data.length < 2) {
    return <div className="geo-chart-empty">차트 데이터 없음</div>;
  }
  return (
    <div className="geo-chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {!compact ? (
            <CartesianGrid stroke="rgba(43,54,72,0.7)" strokeDasharray="3 3" />
          ) : null}
          <XAxis
            dataKey="date"
            hide={compact}
            tick={{ fill: "#8fa3b8", fontSize: 10 }}
            minTickGap={28}
            tickFormatter={(v: string) => (v ? v.slice(5) : "")}
          />
          <YAxis
            hide={compact}
            domain={["auto", "auto"]}
            width={48}
            tick={{ fill: "#8fa3b8", fontSize: 10 }}
            tickFormatter={(v: number) =>
              Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
            }
          />
          <Tooltip
            contentStyle={{
              background: "#141d2b",
              border: "1px solid #2b3648",
              borderRadius: 8,
              color: "#e8eef5",
              fontSize: 12,
            }}
            labelStyle={{ color: "#8fa3b8" }}
            formatter={(value: number) => [fmtPrice(Number(value)), "종가"]}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function GeoTab() {
  const [range, setRange] = useState<GeoRange>("3mo");
  const [selectedId, setSelectedId] = useState<string>("wti");
  const [data, setData] = useState<GeoPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextRange: GeoRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/geo?range=${nextRange}`, { cache: "no-store" });
      const json = (await res.json()) as GeoPayload;
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

  const selected = useMemo(() => {
    if (!data?.signals?.length) return null;
    return data.signals.find((s) => s.id === selectedId) || data.signals[0];
  }, [data, selectedId]);

  const groups: GeoSignal["group"][] = [
    "energy",
    "metals",
    "risk",
    "region",
    "etf",
  ];
  const rangeLabel = GEO_RANGES.find((r) => r.id === range)?.label || range;
  const chokepoints = useMemo(
    () => sortChokepoints(data?.chokepoints || []),
    [data?.chokepoints],
  );

  return (
    <div className="geo-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <h2 className="feature-title">지정학 · 이란 전쟁 레이더</h2>
          <div className="chip-row geo-range-chips" role="group" aria-label="차트 기간">
            {GEO_RANGES.map((r) => (
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

        {loading && !data ? <p className="empty">시그널·차트 불러오는 중…</p> : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <>
            <div className="geo-composite">
              <div
                className="geo-score-ring"
                data-level={data.composite.score >= 55 ? "hot" : "cool"}
              >
                <span className="geo-score-num">{data.composite.score}</span>
                <span className="geo-score-label">리스크 압력</span>
              </div>
              <div className="geo-composite-body">
                <h3>{data.composite.label}</h3>
                <ul>
                  {(data.composite.drivers.length
                    ? data.composite.drivers
                    : ["주요 일간 변동이 크지 않습니다."]
                  ).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <p className="meta-soft">
                  갱신{" "}
                  {new Date(data.generated_at).toLocaleString("ko-KR", {
                    hour12: false,
                  })}{" "}
                  · 차트 {rangeLabel} · {data.note}
                </p>
              </div>
            </div>

            {data.hormuz ? <HormuzPanel hormuz={data.hormuz} /> : null}

            {chokepoints.length ? (
              <section className="geo-section">
                <div className="geo-section-head">
                  <h3 className="geo-section-title">해운 병목 (Chokepoints)</h3>
                  {data.chokepoint_source ? (
                    <p className="meta-soft geo-choke-attr">
                      데이터{" "}
                      <a
                        href={data.chokepoint_source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {data.chokepoint_source.name}
                      </a>{" "}
                      (CC BY 4.0)
                    </p>
                  ) : null}
                </div>
                <div className="geo-choke-grid">
                  {chokepoints.map((c) => (
                    <article
                      key={c.id}
                      className={`geo-choke-card ${chokeStatusClass(c.status)}`}
                    >
                      <div className="geo-choke-top">
                        <strong>{c.name}</strong>
                        <span className="geo-choke-badge">
                          {chokeStatusKo(c.status)}
                        </span>
                      </div>
                      <div className="geo-choke-stats">
                        <span>24h 시그널 {c.signals_24h}</span>
                        <span>고위험 {c.high_alerts_24h}</span>
                        <span>7일 {c.signals_7d}</span>
                      </div>
                      {c.latest_headline ? (
                        c.page_url ? (
                          <a
                            className="geo-choke-hl"
                            href={c.page_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {c.latest_headline}
                          </a>
                        ) : (
                          <p className="geo-choke-hl">{c.latest_headline}</p>
                        )
                      ) : (
                        <p className="geo-choke-hl muted">최근 고위험 헤드라인 없음</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {selected ? (
              <section className="geo-section geo-featured">
                <div className="geo-featured-head">
                  <div>
                    <h3 className="geo-section-title">
                      {selected.label}{" "}
                      <code className="geo-inline-code">{selected.symbol}</code>
                    </h3>
                    <p className="geo-thesis">{selected.thesis}</p>
                  </div>
                  <div className="geo-featured-stats">
                    <div className="geo-signal-price">{fmtPrice(selected.price)}</div>
                    <div className="geo-signal-chgs">
                      <span className={retClass(selected.change_1d_pct)}>
                        1D {fmtPct(selected.change_1d_pct)}
                      </span>
                      <span className={retClass(selected.change_5d_pct)}>
                        5D {fmtPct(selected.change_5d_pct)}
                      </span>
                      <span className={retClass(selected.change_range_pct)}>
                        {rangeLabel} {fmtPct(selected.change_range_pct)}
                      </span>
                    </div>
                  </div>
                </div>
                <SignalChart
                  id={`feat-${selected.id}`}
                  series={selected.series}
                  change={selected.change_range_pct}
                  height={280}
                />
              </section>
            ) : null}

            {groups.map((group) => {
              const rows = data.signals.filter((s) => s.group === group);
              if (!rows.length) return null;
              return (
                <section key={group} className="geo-section">
                  <h3 className="geo-section-title">{groupLabel(group)}</h3>
                  <div className="geo-signal-grid geo-signal-grid-charts">
                    {rows.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`geo-signal-card geo-signal-card-btn ${
                          selected?.id === s.id ? "active" : ""
                        }`}
                        onClick={() => setSelectedId(s.id)}
                      >
                        <div className="geo-signal-top">
                          <strong>{s.label}</strong>
                          <code>{s.symbol}</code>
                        </div>
                        <div className="geo-signal-price">
                          {fmtPrice(s.price)}
                          {s.currency ? (
                            <span className="geo-ccy">{s.currency}</span>
                          ) : null}
                        </div>
                        <div className="geo-signal-chgs">
                          <span className={retClass(s.change_1d_pct)}>
                            1D {fmtPct(s.change_1d_pct)}
                          </span>
                          <span className={retClass(s.change_range_pct)}>
                            {rangeLabel} {fmtPct(s.change_range_pct)}
                          </span>
                        </div>
                        <SignalChart
                          id={`card-${s.id}`}
                          series={s.series}
                          change={s.change_range_pct}
                          height={110}
                          compact
                        />
                        <p className="geo-thesis">{s.thesis}</p>
                        {s.error ? <p className="empty warn">{s.error}</p> : null}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}

            <section className="geo-section">
              <h3 className="geo-section-title">관련 ETF 각도</h3>
              <div className="geo-etf-row">
                {data.related_etfs.map((e) => (
                  <div key={e.symbol} className="geo-etf-chip">
                    <strong>{e.symbol}</strong>
                    <span>{e.name}</span>
                    <em>{e.angle}</em>
                  </div>
                ))}
              </div>
            </section>

            <section className="geo-section">
              <h3 className="geo-section-title">글로벌 헤드라인 (RSS)</h3>
              {!data.headlines.length ? (
                <p className="empty">헤드라인을 가져오지 못했습니다.</p>
              ) : (
                <ul className="geo-headlines">
                  {data.headlines.map((h) => (
                    <li key={`${h.source}-${h.title}`}>
                      <span className="geo-hl-source">{h.source}</span>
                      {h.link ? (
                        <a href={h.link} target="_blank" rel="noopener noreferrer">
                          {h.title}
                        </a>
                      ) : (
                        <span>{h.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

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

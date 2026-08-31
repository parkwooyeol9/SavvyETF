"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  LABOR_COMPANIES,
  STAGE_META,
  type LaborCompanyId,
  type LaborEventResult,
  type LaborHorizon,
  type LaborRiskPayload,
  type LaborStage,
} from "@/lib/laborRisk";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function toneClass(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function heatBg(pct: number | null, cap = 8): string {
  if (pct == null || Number.isNaN(pct)) return "transparent";
  const t = Math.max(-1, Math.min(1, pct / cap));
  if (t >= 0) return `rgba(61, 214, 140, ${0.1 + 0.58 * t})`;
  return `rgba(248, 113, 113, ${0.1 + 0.58 * -t})`;
}

function windowOf(row: LaborEventResult, h: LaborHorizon) {
  return row.windows.find((w) => w.horizon === h);
}

export default function LaborRiskPanel() {
  const [data, setData] = useState<LaborRiskPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<LaborCompanyId | "all">("all");
  const [stage, setStage] = useState<LaborStage | "all">("all");
  const [metric, setMetric] = useState<"excess" | "raw">("excess");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/labor-risk");
        const payload = (await res.json()) as LaborRiskPayload;
        if (cancelled) return;
        if (!payload.ok) {
          setError(payload.error || "분석을 불러오지 못했습니다.");
          return;
        }
        setData(payload);
      } catch (exc) {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "네트워크 오류");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const events = useMemo(() => {
    const rows = data?.events || [];
    return rows.filter((r) => {
      if (company !== "all" && r.company !== company) return false;
      if (stage !== "all" && r.stage !== stage) return false;
      return true;
    });
  }, [data, company, stage]);

  const barData = useMemo(() => {
    return (data?.stage_stats || []).map((s) => ({
      name: s.label.replace("·", "\n"),
      full: s.label,
      d0: metric === "excess" ? s.mean_xs_d0 : s.mean_d0,
      d5: metric === "excess" ? s.mean_xs_d5 : s.mean_d5,
      d20: metric === "excess" ? s.mean_xs_d20 : s.mean_d20,
    }));
  }, [data, metric]);

  const valueKey = metric === "excess" ? "excess_pct" : "return_pct";

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">기준일 캘린더</h3>
            <p className="macro-subhead">
              일자 있는 공신력 보도만 넣었습니다. 요구안 공개 → 쟁의권·결렬 → 파업 또는 타결. 주가는 직전
              거래일 종가 대비 D / D+5 / D+20 거래일이며, 기본 표시는 코스피 초과수익률입니다.
            </p>
          </div>
        </div>

        <div className="eventstudy-cat-row labor-filter-row">
          <button
            type="button"
            className={`eventstudy-cat ${company === "all" ? "active" : ""}`}
            onClick={() => setCompany("all")}
          >
            전 종목
          </button>
          {LABOR_COMPANIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`eventstudy-cat ${company === c.id ? "active" : ""}`}
              onClick={() => setCompany(c.id)}
              title={c.note}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="eventstudy-cat-row labor-filter-row">
          <button
            type="button"
            className={`eventstudy-cat ${stage === "all" ? "active" : ""}`}
            onClick={() => setStage("all")}
          >
            전 단계
          </button>
          {STAGE_META.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`eventstudy-cat ${stage === s.id ? "active" : ""}`}
              onClick={() => setStage(s.id)}
              title={s.detail}
            >
              {s.label}
            </button>
          ))}
          <span className="labor-metric-toggle">
            <button
              type="button"
              className={`eventstudy-cat ${metric === "excess" ? "active" : ""}`}
              onClick={() => setMetric("excess")}
            >
              코스피 초과
            </button>
            <button
              type="button"
              className={`eventstudy-cat ${metric === "raw" ? "active" : ""}`}
              onClick={() => setMetric("raw")}
            >
              절대 수익률
            </button>
          </span>
        </div>
        {error ? <p className="empty err">{error}</p> : null}
      </section>

      {loading && !data ? <p className="empty">기준일 주가 반응을 계산하는 중…</p> : null}

      {data?.ok ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">1) 전반적인 특징</h3>
                <p className="macro-subhead">
                  단계별 평균 {metric === "excess" ? "코스피 초과" : "절대"}수익률. 막대는 전체 표본 기준입니다.
                </p>
              </div>
            </div>
            <p className="eventstudy-summary">{data.overall_ko}</p>
            <div className="eventstudy-snap-grid">
              {(data.stage_stats || []).map((s) => (
                <article key={s.stage} className="macro-snap-card">
                  <span className="macro-snap-label">{s.label}</span>
                  <div className="eventstudy-snap-line">
                    <em>D</em>
                    <strong className={toneClass(metric === "excess" ? s.mean_xs_d0 : s.mean_d0)}>
                      {fmtPct(metric === "excess" ? s.mean_xs_d0 : s.mean_d0)}
                    </strong>
                  </div>
                  <div className="eventstudy-snap-line">
                    <em>D+5</em>
                    <strong className={toneClass(metric === "excess" ? s.mean_xs_d5 : s.mean_d5)}>
                      {fmtPct(metric === "excess" ? s.mean_xs_d5 : s.mean_d5)}
                    </strong>
                  </div>
                  <div className="eventstudy-snap-line">
                    <em>D+20</em>
                    <strong className={toneClass(metric === "excess" ? s.mean_xs_d20 : s.mean_d20)}>
                      {fmtPct(metric === "excess" ? s.mean_xs_d20 : s.mean_d20)}
                    </strong>
                  </div>
                  <em className="macro-snap-sub">
                    n={s.n}
                    {s.win_xs_d5 != null ? ` · D+5 승률 ${s.win_xs_d5.toFixed(0)}%` : ""}
                  </em>
                </article>
              ))}
            </div>
            <div className="eventstudy-chart eventstudy-chart-lg">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.full || ""}
                    formatter={(value: number, name: string) => [
                      fmtPct(value),
                      name === "d0" ? "D" : name === "d5" ? "D+5" : "D+20",
                    ]}
                  />
                  <Legend
                    formatter={(value) => (value === "d0" ? "D" : value === "d5" ? "D+5" : "D+20")}
                  />
                  <Bar dataKey="d0" name="d0" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="d5" name="d5" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="d20" name="d20" fill="#c084fc" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">2) 기업별 차별화</h3>
                <p className="macro-subhead">
                  같은 노동 헤드라인이라도 생산이 멈췄는지, 미타결로 남았는지, 업황 뉴스와 겹쳤는지에 따라
                  주가 반응이 갈립니다.
                </p>
              </div>
            </div>
            <p className="eventstudy-summary">{data.differentiation_ko}</p>
            <div className="labor-diff-grid">
              {(data.company_stats || []).map((c) => (
                <article key={c.id} className="labor-diff-card">
                  <header>
                    <strong>{c.label}</strong>
                    <span className={toneClass(c.mean_xs_d5)}>{fmtPct(c.mean_xs_d5)} D+5초과</span>
                  </header>
                  <p>{c.news}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">기업 × 창 평균 초과수익률</h3>
                <p className="macro-subhead">행은 종목, 열은 D / D+5 / D+20. 필터는 위 종목·단계 버튼을 따릅니다.</p>
              </div>
            </div>
            <div className="eventstudy-table-wrap">
              <table className="eventstudy-table eventstudy-heat">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>D</th>
                    <th>D+5</th>
                    <th>D+20</th>
                    <th>표본</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.company_stats || [])
                    .filter((c) => company === "all" || c.id === company)
                    .map((c) => {
                      const subset = events.filter((e) => e.company === c.id);
                      const avg = (h: LaborHorizon) => {
                        const vals = subset
                          .map((e) => windowOf(e, h)?.[valueKey])
                          .filter((n): n is number => n != null && !Number.isNaN(n));
                        if (!vals.length) return null;
                        return vals.reduce((a, b) => a + b, 0) / vals.length;
                      };
                      const show0 = avg(0);
                      const show5 = avg(5);
                      const show20 = avg(20);
                      return (
                        <tr key={c.id}>
                          <td>
                            <span className="eventstudy-asset-name">{c.label}</span>
                            <span className="eventstudy-asset-note">{c.ticker}</span>
                          </td>
                          <td className={toneClass(show0)} style={{ background: heatBg(show0) }}>
                            {fmtPct(show0)}
                          </td>
                          <td className={toneClass(show5)} style={{ background: heatBg(show5) }}>
                            {fmtPct(show5)}
                          </td>
                          <td className={toneClass(show20)} style={{ background: heatBg(show20) }}>
                            {fmtPct(show20)}
                          </td>
                          <td>{subset.length}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">이벤트별 수익률</h3>
                <p className="macro-subhead">
                  {events.length}건. 날짜 옆 거래일은 휴일 정렬 후 첫 거래일, 수익률은 {metric === "excess" ? "코스피 초과" : "종목 절대"}입니다.
                </p>
              </div>
            </div>
            <div className="eventstudy-table-wrap">
              <table className="eventstudy-table labor-event-table">
                <thead>
                  <tr>
                    <th>기준일</th>
                    <th>종목</th>
                    <th>단계</th>
                    <th>이벤트</th>
                    <th>D</th>
                    <th>D+5</th>
                    <th>D+20</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => {
                    const d0 = windowOf(ev, 0);
                    const d5 = windowOf(ev, 5);
                    const d20 = windowOf(ev, 20);
                    return (
                      <tr key={ev.id}>
                        <td>
                          <span className="eventstudy-asset-name">{ev.date}</span>
                          {ev.trading_date && ev.trading_date !== ev.date ? (
                            <span className="eventstudy-asset-note">거래 {ev.trading_date}</span>
                          ) : null}
                        </td>
                        <td>{ev.company_label}</td>
                        <td>{STAGE_META.find((s) => s.id === ev.stage)?.label}</td>
                        <td className="labor-event-cell">
                          <strong>{ev.label}</strong>
                          <span>{ev.summary}</span>
                          <em>{ev.news}</em>
                        </td>
                        <td
                          className={toneClass(d0?.[valueKey])}
                          style={{ background: heatBg(d0?.[valueKey] ?? null) }}
                          title={d0?.truncated ? "창이 아직 끝나지 않음" : d0?.end_date}
                        >
                          {fmtPct(d0?.[valueKey])}
                          {d0?.truncated ? "*" : ""}
                        </td>
                        <td
                          className={toneClass(d5?.[valueKey])}
                          style={{ background: heatBg(d5?.[valueKey] ?? null) }}
                          title={d5?.truncated ? "창이 아직 끝나지 않음" : d5?.end_date}
                        >
                          {fmtPct(d5?.[valueKey])}
                          {d5?.truncated ? "*" : ""}
                        </td>
                        <td
                          className={toneClass(d20?.[valueKey])}
                          style={{ background: heatBg(d20?.[valueKey] ?? null, 12) }}
                          title={d20?.truncated ? "창이 아직 끝나지 않음" : d20?.end_date}
                        >
                          {fmtPct(d20?.[valueKey])}
                          {d20?.truncated ? "*" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.note ? <p className="eventstudy-foot">{data.note}</p> : null}
          </section>
        </>
      ) : null}
    </>
  );
}

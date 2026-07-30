"use client";

import { useCallback, useMemo, useState } from "react";
import {
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
  DEFAULT_FOCUS_MONTHS,
  EXAMPLE_TICKERS,
  LOOKBACK_YEARS,
  MONTH_OPTIONS,
  type SeasonalityPayload,
} from "@/lib/seasonality";

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

function toneClass(tone?: string): string {
  switch (tone) {
    case "positive":
      return "up";
    case "negative":
      return "down";
    case "caution":
      return "flat";
    default:
      return "flat";
  }
}

export default function EventStudyTab() {
  const [ticker, setTicker] = useState("");
  const [focusMonths, setFocusMonths] = useState<number[]>([...DEFAULT_FOCUS_MONTHS]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SeasonalityPayload | null>(null);

  const chartData = useMemo(() => {
    if (!data?.monthly_stats?.length) return [];
    return data.monthly_stats.map((row) => ({
      name: row.label_ko,
      mean: row.mean_pct,
      winRate: row.win_rate_pct,
      inFocus: row.in_focus,
    }));
  }, [data]);

  const runAnalysis = useCallback(async () => {
    const q = ticker.trim();
    if (!q) {
      setError("티커를 입력해 주세요.");
      return;
    }
    if (!focusMonths.length) {
      setError("집중 시즌 월을 1개 이상 선택해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const months = focusMonths.slice().sort((a, b) => a - b).join(",");
      const res = await fetch(
        `/api/seasonality?ticker=${encodeURIComponent(q)}&months=${months}`,
      );
      const payload = (await res.json()) as SeasonalityPayload;
      if (!payload.ok) {
        setError(payload.error || "분석에 실패했습니다.");
        setData(null);
        return;
      }
      setData(payload);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "네트워크 오류");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker, focusMonths]);

  function toggleMonth(month: number) {
    setFocusMonths((prev) => {
      if (prev.includes(month)) {
        const next = prev.filter((m) => m !== month);
        return next.length ? next : prev;
      }
      return [...prev, month].sort((a, b) => a - b);
    });
  }

  function applyExample(exampleTicker: string) {
    setTicker(exampleTicker);
    setFocusMonths([...DEFAULT_FOCUS_MONTHS]);
  }

  return (
    <div className="geo-tab macro-tab eventstudy-tab">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">이벤트 스터디 — 월별 수익률 계절성</h2>
            <p className="macro-subhead">
              특정 종목의 과거 {LOOKBACK_YEARS}년 월별 수익률을 분석해, 여름 시즌(기본
              6·7·8·9월) 등 집중 시즌에 다른 달보다 수익률이 높은 계절성이 있었는지
              Welch t-검정으로 검증합니다. 주가 데이터는 Yahoo Finance API에서
              가져옵니다.
            </p>
          </div>
        </div>

        <div className="eventstudy-form">
          <label className="eventstudy-field">
            <span>티커</span>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="005180, 빙그레, CARR …"
              onKeyDown={(e) => {
                if (e.key === "Enter") void runAnalysis();
              }}
            />
          </label>

          <div className="eventstudy-months">
            <span className="eventstudy-months-label">집중 시즌 (월)</span>
            <div className="eventstudy-month-grid">
              {MONTH_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`eventstudy-month-btn ${focusMonths.includes(m.value) ? "active" : ""}`}
                  onClick={() => toggleMonth(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="eventstudy-actions">
            <button
              type="button"
              className="btn primary"
              disabled={loading}
              onClick={() => void runAnalysis()}
            >
              {loading ? "분석 중…" : "계절성 검증"}
            </button>
          </div>

          <div className="eventstudy-examples">
            <span>예시:</span>
            {EXAMPLE_TICKERS.map((ex) => (
              <button
                key={ex.ticker}
                type="button"
                className="eventstudy-example-btn"
                onClick={() => applyExample(ex.ticker)}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="empty err">{error}</p> : null}
      </section>

      {data?.ok ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  {data.display || data.symbol}
                  <span className="slot-badge">{data.symbol}</span>
                </h3>
                <p className="macro-subhead">
                  {data.start_date} ~ {data.end_date} · {data.n_months}개월 ·
                  집중 시즌 {data.focus_label_ko}
                  {data.source ? ` · ${data.source}` : ""}
                </p>
              </div>
              <span className={`slot-badge ${toneClass(data.verdict?.tone)}`}>
                {data.verdict?.label || "—"}
              </span>
            </div>

            <p className="eventstudy-summary">{data.verdict?.summary_ko}</p>

            <div className="macro-snap-grid">
              <article className="macro-snap-card">
                <span className="macro-snap-label">집중 시즌 평균</span>
                <strong className={`macro-snap-value ${toneClass("positive")}`}>
                  {fmtPct(data.focus_mean_pct)}
                </strong>
                <em className="macro-snap-sub">n={data.focus_n}</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">나머지 달 평균</span>
                <strong className="macro-snap-value">
                  {fmtPct(data.other_mean_pct)}
                </strong>
                <em className="macro-snap-sub">n={data.other_n}</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">차이 (집중−기타)</span>
                <strong
                  className={`macro-snap-value ${toneClass(
                    (data.diff_focus_minus_other_pct ?? 0) > 0 ? "positive" : "negative",
                  )}`}
                >
                  {fmtPct(data.diff_focus_minus_other_pct)}
                </strong>
                <em className="macro-snap-sub">
                  p={data.ttest_p != null && !Number.isNaN(data.ttest_p) ? data.ttest_p.toFixed(3) : "—"}
                  {data.verdict?.significant ? " · 유의" : ""}
                </em>
              </article>
            </div>
          </section>

          <section className="panel">
            <h3 className="panel-title">월별 평균 수익률</h3>
            <div className="eventstudy-chart">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number, name: string) => {
                      if (name === "mean") return [fmtPct(value), "평균 수익률"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="mean" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.inFocus ? "#f59e0b" : "#60a5fa"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="macro-subhead">
              주황색 막대 = 집중 시즌 · 파란색 = 나머지 달
            </p>
          </section>

          <section className="panel">
            <h3 className="panel-title">월별 상세</h3>
            <div className="eventstudy-table-wrap">
              <table className="eventstudy-table">
                <thead>
                  <tr>
                    <th>월</th>
                    <th>평균</th>
                    <th>중앙값</th>
                    <th>승률</th>
                    <th>표본</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.monthly_stats || []).map((row) => (
                    <tr key={row.month} className={row.in_focus ? "focus" : ""}>
                      <td>
                        {row.in_focus ? "★ " : ""}
                        {row.label_ko}
                      </td>
                      <td className={toneClass(row.mean_pct > 0 ? "positive" : row.mean_pct < 0 ? "negative" : "neutral")}>
                        {fmtPct(row.mean_pct)}
                      </td>
                      <td>{fmtPct(row.median_pct)}</td>
                      <td>{row.win_rate_pct != null && !Number.isNaN(row.win_rate_pct) ? `${row.win_rate_pct.toFixed(0)}%` : "—"}</td>
                      <td>{row.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {(data.yearly_focus?.length ?? 0) > 0 ? (
            <section className="panel">
              <h3 className="panel-title">연도별 집중 시즌 누적 수익률</h3>
              <div className="eventstudy-year-grid">
                {data.yearly_focus!.map((row) => (
                  <div
                    key={row.year}
                    className={`eventstudy-year-card ${row.return_pct > 0 ? "up" : row.return_pct < 0 ? "down" : "flat"}`}
                  >
                    <span className="eventstudy-year">{row.year}</span>
                    <strong>{fmtPct(row.return_pct)}</strong>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

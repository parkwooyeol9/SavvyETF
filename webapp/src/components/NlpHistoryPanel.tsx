"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  nlpHistoryTone,
  type NlpHistoryDay,
  type NlpHistorySeries,
} from "@/lib/nlpHistory";

function fmtScore(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}`;
}

function toneClass(score: number): string {
  const tone = nlpHistoryTone(score);
  if (tone === "bull") return "up";
  if (tone === "bear") return "down";
  return "flat";
}

function dayLabel(date: string): string {
  return date.slice(5).replace("-", ".");
}

type ChartRow = NlpHistoryDay & { label: string };

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

export default function NlpHistoryPanel({
  series,
  loading,
  selectedDate,
  onSelectDate,
}: {
  series: NlpHistorySeries | null;
  loading: boolean;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const chartRows: ChartRow[] = useMemo(() => {
    return (series?.days || []).map((d) => ({ ...d, label: dayLabel(d.date) }));
  }, [series]);

  const selectedDay = useMemo(() => {
    if (!series?.days.length) return null;
    const want = selectedDate || series.days[series.days.length - 1]!.date;
    return series.days.find((d) => d.date === want) || series.days[series.days.length - 1]!;
  }, [series, selectedDate]);

  if (!series && !loading) return null;

  return (
    <>
      <section className="geo-section">
        <div className="nlp-hist-head">
          <h3 className="geo-section-title">
            {series?.name || "종목"} 1년 뉴스 점수
            {series?.last_score != null ? (
              <span className={toneClass(series.last_score)}> {fmtScore(series.last_score)}</span>
            ) : null}
          </h3>
          <p className="macro-subhead">
            {loading
              ? "1년 뉴스 시계열을 불러오는 중…"
              : series
                ? `${series.n_days}일 · 기사 ${series.n_headlines}건 · 점 = 그날 제목 평균, 막대 = 기사 수. 점을 누르면 그날 기사가 열립니다.`
                : "이 종목의 1년 아카이브가 없습니다."}
          </p>
        </div>
        {!chartRows.length ? (
          <p className="empty">{loading ? "수집 중…" : series?.error || "저장된 뉴스가 없습니다."}</p>
        ) : (
          <div className="geo-chart-wrap nlp-hist-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartRows}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                onClick={(state) => {
                  const row = state?.activePayload?.[0]?.payload as ChartRow | undefined;
                  if (row?.date) onSelectDate(row.date);
                }}
              >
                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#93a4c3", fontSize: 10 }} minTickGap={24} />
                <YAxis
                  yAxisId="score"
                  domain={[-100, 100]}
                  tick={{ fill: "#93a4c3", fontSize: 10 }}
                  width={36}
                />
                <YAxis yAxisId="n" orientation="right" hide domain={[0, "auto"]} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) => {
                    const n = typeof value === "number" ? value : Number(value);
                    if (name === "score") return [fmtScore(n), "점수"];
                    return [n, "기사 수"];
                  }}
                  labelFormatter={(_, pts) => {
                    const row = pts?.[0]?.payload as ChartRow | undefined;
                    return row?.date || "";
                  }}
                />
                <Bar yAxisId="n" dataKey="n" fill="rgba(77,163,255,0.28)" maxBarSize={8} />
                <Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="score"
                  stroke="#4da3ff"
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="geo-section">
        <h3 className="geo-section-title">
          {selectedDay ? `${selectedDay.date} 뉴스` : "그날의 뉴스"}
          {selectedDay ? (
            <span className={toneClass(selectedDay.score)}>
              {" "}
              {fmtScore(selectedDay.score)} · {selectedDay.n}건
            </span>
          ) : null}
        </h3>
        <p className="macro-subhead">위 점수 차트에서 날짜를 고르면 제목이 바뀝니다.</p>
        {!selectedDay?.headlines.length ? (
          <p className="empty">{loading ? "불러오는 중…" : "이 날짜에 저장된 기사가 없습니다."}</p>
        ) : (
          <ul className="nlp-feed">
            {selectedDay.headlines.map((row, i) => (
              <li
                key={`${selectedDay.date}-${i}-${row.title.slice(0, 24)}`}
                className={`nlp-feed-item nlp-${nlpHistoryTone(row.score)}`}
              >
                <div className="nlp-feed-top">
                  <span className="nlp-src">{row.source}</span>
                  <span className={toneClass(row.score)}>{fmtScore(row.score)}</span>
                </div>
                {row.url ? (
                  <a href={row.url} target="_blank" rel="noreferrer">
                    {row.title}
                  </a>
                ) : (
                  <span>{row.title}</span>
                )}
                {row.matched.length ? <p className="nlp-matched">{row.matched.join(" · ")}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

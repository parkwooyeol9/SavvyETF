"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

import NlpPriceChart from "@/components/NlpPriceChart";
import {
  emptyNlpHistoryIndex,
  emptyNlpHistorySeries,
  nlpHistoryTone,
  type NlpHistoryDay,
  type NlpHistoryIndex,
  type NlpHistoryMarket,
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

export default function NlpHistoryTab() {
  const [index, setIndex] = useState<NlpHistoryIndex | null>(null);
  const [series, setSeries] = useState<NlpHistorySeries | null>(null);
  const [market, setMarket] = useState<NlpHistoryMarket>("kospi");
  const [picked, setPicked] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [loadingSeries, setLoadingSeries] = useState(false);

  const loadIndex = useCallback(async () => {
    setLoadingIndex(true);
    try {
      const res = await fetch("/api/nlp-history", { cache: "no-store" });
      const json = (await res.json()) as NlpHistoryIndex;
      setIndex(json);
    } catch (exc) {
      setIndex(emptyNlpHistoryIndex(exc instanceof Error ? exc.message : "로드 실패"));
    } finally {
      setLoadingIndex(false);
    }
  }, []);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  const names = useMemo(() => {
    return (index?.names || []).filter((n) => n.market === market);
  }, [index, market]);

  useEffect(() => {
    if (!names.length) return;
    if (picked && names.some((n) => n.code === picked)) return;
    setPicked(names[0]!.code);
    setSelectedDate(null);
  }, [names, picked]);

  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    setLoadingSeries(true);
    setSelectedDate(null);
    void (async () => {
      try {
        const res = await fetch(`/api/nlp-history?code=${encodeURIComponent(picked)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as NlpHistorySeries;
        if (!cancelled) setSeries(json);
      } catch (exc) {
        if (!cancelled) {
          setSeries(emptyNlpHistorySeries(picked, exc instanceof Error ? exc.message : "로드 실패"));
        }
      } finally {
        if (!cancelled) setLoadingSeries(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [picked]);

  const chartRows: ChartRow[] = useMemo(() => {
    return (series?.days || []).map((d) => ({ ...d, label: dayLabel(d.date) }));
  }, [series]);

  const selectedDay = useMemo(() => {
    if (!series?.days.length) return null;
    const want = selectedDate || series.days[series.days.length - 1]!.date;
    return series.days.find((d) => d.date === want) || series.days[series.days.length - 1]!;
  }, [series, selectedDate]);

  return (
    <div className="geo-tab nlp-tab nlp-history-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">뉴스 투심 히스토리</h2>
            <p className="kr-hero-sub">
              코스피·코스닥 시총 상위 10종목의 1년 뉴스 제목 점수입니다. 날짜를 누르면 그날
              기사가 열립니다. 지금은 20종으로 시작하고, 이후 종목을 늘릴 수 있습니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="ghost-btn" onClick={() => void loadIndex()} disabled={loadingIndex}>
              {loadingIndex ? "불러오는 중…" : "새로고침"}
            </button>
          </div>
        </div>
        <div className="nlp-filters">
          {(
            [
              ["kospi", "코스피 상위 10"],
              ["kosdaq", "코스닥 상위 10"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tab-btn sub ${market === id ? "active" : ""}`}
              onClick={() => {
                setMarket(id);
                setPicked(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {index?.generated_at ? (
          <p className="meta-soft">
            아카이브 {index.generated_at.slice(0, 16).replace("T", " ")} · 룩백 {index.lookback_days}일
          </p>
        ) : null}
        {index?.error ? <p className="meta-soft">{index.error}</p> : null}
      </section>

      <section className="geo-section">
        <h3 className="geo-section-title">종목</h3>
        {!names.length ? (
          <p className="empty">{loadingIndex ? "유니버스 불러오는 중…" : "표시할 종목이 없습니다."}</p>
        ) : (
          <div className="nlp-chip-grid">
            {names.map((card) => (
              <button
                key={card.code}
                type="button"
                className={`nlp-chip ${picked === card.code ? "active" : ""} ${
                  card.last_score != null ? `nlp-${nlpHistoryTone(card.last_score)}` : ""
                }`}
                onClick={() => setPicked(card.code)}
              >
                <span>{card.name}</span>
                {card.last_score != null ? (
                  <strong className={toneClass(card.last_score)}>{fmtScore(card.last_score)}</strong>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </section>

      {series ? (
        <section className="geo-section">
          <div className="nlp-hist-head">
            <h3 className="geo-section-title">
              {series.name} 뉴스 점수
              {series.last_score != null ? (
                <span className={toneClass(series.last_score)}> {fmtScore(series.last_score)}</span>
              ) : null}
            </h3>
            <p className="macro-subhead">
              {loadingSeries
                ? "시계열 불러오는 중…"
                : `${series.n_days}일 · 기사 ${series.n_headlines}건 · 점 = 그날 제목 평균, 막대 = 기사 수`}
            </p>
          </div>
          {!chartRows.length ? (
            <p className="empty">{loadingSeries ? "수집 중…" : series.error || "저장된 뉴스가 없습니다."}</p>
          ) : (
            <div className="geo-chart-wrap nlp-hist-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartRows}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  onClick={(state) => {
                    const row = state?.activePayload?.[0]?.payload as ChartRow | undefined;
                    if (row?.date) setSelectedDate(row.date);
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
      ) : null}

      {series ? <NlpPriceChart key={series.yahoo} ticker={series.yahoo} name={series.name} /> : null}

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
        <p className="macro-subhead">차트 한 점을 누르면 해당 일자의 제목이 바뀝니다.</p>
        {!selectedDay?.headlines.length ? (
          <p className="empty">{loadingSeries ? "불러오는 중…" : "이 날짜에 저장된 기사가 없습니다."}</p>
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
    </div>
  );
}

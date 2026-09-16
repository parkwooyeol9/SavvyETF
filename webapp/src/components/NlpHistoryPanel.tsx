"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { NlpChartPayload } from "@/lib/nlpChart";
import {
  mergeScoreAndPrice,
  nlpCorrLabel,
  nlpHistoryTone,
  nlpPearson,
  type NlpHistorySeries,
  type NlpOverlayRow,
} from "@/lib/nlpHistory";

function fmtScore(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}`;
}

function fmtPrice(n: number, currency: "KRW" | "USD"): string {
  if (currency === "KRW") {
    return n >= 1000 ? n.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) : n.toFixed(2);
  }
  return n >= 100 ? n.toFixed(2) : n.toFixed(n >= 10 ? 2 : 3);
}

function toneClass(score: number): string {
  const tone = nlpHistoryTone(score);
  if (tone === "bull") return "up";
  if (tone === "bear") return "down";
  return "flat";
}

type ChartRow = NlpOverlayRow;

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function OverlayTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  currency: "KRW" | "USD";
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  return (
    <div className="deriv-tt">
      <strong>{row.date}</strong>
      {row.close != null ? (
        <div>종가 {currency === "KRW" ? "₩" : "$"}{fmtPrice(row.close, currency)}</div>
      ) : null}
      {row.score != null ? <div>뉴스 점수 {fmtScore(row.score)}</div> : null}
      {row.news && row.n != null ? <div>기사 {row.n}건</div> : <div className="meta-soft">뉴스 없는 날 · 직전 점수 유지</div>}
      {row.dart && row.dartTitles?.length ? (
        <div>DART {row.dartTitles.slice(0, 2).join(" · ")}</div>
      ) : null}
    </div>
  );
}

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
  const [price, setPrice] = useState<NlpChartPayload | null>(null);
  const [loadingPx, setLoadingPx] = useState(false);
  const [dartByDay, setDartByDay] = useState<Map<string, string[]>>(new Map());
  const [dartEvents, setDartEvents] = useState<Array<{ date: string; title: string; url?: string | null }>>([]);
  const yahoo = series?.yahoo;

  useEffect(() => {
    if (!yahoo) {
      setPrice(null);
      return;
    }
    let cancelled = false;
    setLoadingPx(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/nlp-chart?symbol=${encodeURIComponent(yahoo)}&range=1y`,
        );
        const json = (await res.json()) as NlpChartPayload;
        if (!cancelled) setPrice(json);
      } catch {
        if (!cancelled) setPrice(null);
      } finally {
        if (!cancelled) setLoadingPx(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [yahoo]);

  useEffect(() => {
    const code = series?.code;
    if (!code || !/^\d{6}$/.test(code)) {
      setDartByDay(new Map());
      setDartEvents([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/nlp-dart?code=${encodeURIComponent(code)}`);
        const json = (await res.json()) as {
          ok?: boolean;
          events?: Array<{ date?: string; title?: string; url?: string | null }>;
        };
        if (cancelled) return;
        const byDay = new Map<string, string[]>();
        const rows: Array<{ date: string; title: string; url?: string | null }> = [];
        for (const ev of json.events || []) {
          const date = (ev.date || "").slice(0, 10);
          const title = (ev.title || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) continue;
          const list = byDay.get(date) || [];
          if (!list.includes(title)) list.push(title);
          byDay.set(date, list);
          rows.push({ date, title, url: ev.url });
        }
        setDartByDay(byDay);
        setDartEvents(rows);
      } catch {
        if (!cancelled) {
          setDartByDay(new Map());
          setDartEvents([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [series?.code]);

  const chartRows: ChartRow[] = useMemo(() => {
    return mergeScoreAndPrice(series?.days || [], price?.bars || [], dartByDay);
  }, [series, price, dartByDay]);

  const corr = useMemo(() => nlpPearson(chartRows), [chartRows]);
  const currency = price?.currency || (yahoo?.includes(".KS") || yahoo?.includes(".KQ") ? "KRW" : "USD");
  const pxDomain = useMemo<[number, number]>(() => {
    const closes = chartRows.map((r) => r.close).filter((n): n is number => n != null);
    if (!closes.length) return [0, 1];
    let lo = Math.min(...closes);
    let hi = Math.max(...closes);
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
    return [lo - pad, hi + pad];
  }, [chartRows]);

  const selectedDay = useMemo(() => {
    if (!series?.days.length) return null;
    const want = selectedDate || series.days[series.days.length - 1]!.date;
    return series.days.find((d) => d.date === want) || series.days[series.days.length - 1]!;
  }, [series, selectedDate]);

  if (!series && !loading) return null;

  const hasPrice = chartRows.some((r) => r.close != null);
  const corrText =
    corr == null
      ? nlpCorrLabel(null)
      : `r ${corr >= 0 ? "+" : ""}${corr.toFixed(2)} · ${nlpCorrLabel(corr)}`;

  return (
    <>
      <section className="geo-section">
        <div className="nlp-hist-head">
          <h3 className="geo-section-title">
            {series?.name || "종목"} 뉴스 점수 · 주가
            {series?.last_score != null ? (
              <span className={toneClass(series.last_score)}> {fmtScore(series.last_score)}</span>
            ) : null}
          </h3>
          <p className="macro-subhead">
            {loading
              ? "1년 뉴스 시계열을 불러오는 중…"
              : series
                ? `${series.n_days}일 뉴스 · 기사 ${series.n_headlines}건 · 파란선 점수 · 노란선 종가 · 분홍 점은 DART 이벤트. 점을 누르면 그날 기사가 열립니다.`
                : "이 종목의 1년 아카이브가 없습니다."}
          </p>
          {hasPrice ? (
            <p className="nlp-corr-badge">
              {loadingPx ? "주가 정렬 중…" : corrText}
            </p>
          ) : loadingPx ? (
            <p className="nlp-corr-badge">주가를 겹치는 중…</p>
          ) : null}
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
                {hasPrice ? (
                  <YAxis
                    yAxisId="px"
                    orientation="left"
                    domain={pxDomain}
                    width={58}
                    tick={{ fill: "#fbbf24", fontSize: 10 }}
                    tickFormatter={(v) => fmtPrice(Number(v), currency)}
                  />
                ) : null}
                <YAxis
                  yAxisId="score"
                  orientation="right"
                  domain={[-100, 100]}
                  tick={{ fill: "#4da3ff", fontSize: 10 }}
                  width={36}
                />
                <Tooltip
                  content={(props) => (
                    <OverlayTooltip
                      active={props.active}
                      payload={props.payload as Array<{ payload: ChartRow }>}
                      currency={currency}
                    />
                  )}
                />
                <Legend
                  wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }}
                  formatter={(value) =>
                    value === "close" ? "종가" : value === "dartMark" ? "DART" : "뉴스 점수"
                  }
                />
                <ReferenceLine yAxisId="score" y={0} stroke="rgba(148,163,184,0.28)" />
                {hasPrice ? (
                  <Line
                    yAxisId="px"
                    type="monotone"
                    dataKey="close"
                    name="close"
                    stroke="#fbbf24"
                    strokeWidth={1.8}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ) : null}
                <Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="score"
                  name="score"
                  stroke="#4da3ff"
                  strokeWidth={1.8}
                  connectNulls
                  isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; payload?: ChartRow }) => {
                    if (!props.payload?.news || props.cx == null || props.cy == null) {
                      return <g key={props.payload?.date || "empty"} />;
                    }
                    return (
                      <circle
                        key={props.payload.date}
                        cx={props.cx}
                        cy={props.cy}
                        r={selectedDay && props.payload.date === selectedDay.date ? 4 : 2.2}
                        fill="#4da3ff"
                      />
                    );
                  }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="dartMark"
                  name="dartMark"
                  stroke="#f472b6"
                  strokeWidth={0}
                  connectNulls={false}
                  isAnimationActive={false}
                  legendType="circle"
                  dot={(props: { cx?: number; cy?: number; payload?: ChartRow }) => {
                    if (!props.payload?.dart || props.cx == null || props.cy == null) {
                      return <g key={`dart-${props.payload?.date || "x"}`} />;
                    }
                    return (
                      <circle
                        key={`dart-${props.payload.date}`}
                        cx={props.cx}
                        cy={props.cy}
                        r={4}
                        fill="#f472b6"
                        stroke="#0b1220"
                        strokeWidth={1}
                      />
                    );
                  }}
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
        <p className="macro-subhead">위 차트에서 날짜를 고르면 제목이 바뀝니다. 파란 점은 뉴스가 있던 날입니다.</p>
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

      {dartEvents.length ? (
        <section className="geo-section">
          <h3 className="geo-section-title">DART 이벤트</h3>
          <p className="macro-subhead">
            차트 분홍 점. {selectedDate ? `${selectedDate} 공시` : "최근 이벤트 공시"}입니다.
          </p>
          <ul className="nlp-feed">
            {(selectedDate
              ? dartEvents.filter((e) => e.date === selectedDate)
              : dartEvents.slice(0, 8)
            ).map((ev, i) => (
              <li key={`${ev.date}-${i}-${ev.title.slice(0, 20)}`} className="nlp-feed-item">
                <div className="nlp-feed-top">
                  <span className="nlp-date">{ev.date}</span>
                  <span className="nlp-src">DART</span>
                </div>
                {ev.url ? (
                  <a href={ev.url} target="_blank" rel="noreferrer">
                    {ev.title}
                  </a>
                ) : (
                  <span>{ev.title}</span>
                )}
              </li>
            ))}
          </ul>
          {selectedDate && !dartEvents.some((e) => e.date === selectedDate) ? (
            <p className="empty">이 날짜에 필터된 DART 이벤트는 없습니다.</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

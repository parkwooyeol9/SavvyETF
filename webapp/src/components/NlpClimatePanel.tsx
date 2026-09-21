"use client";

import { useEffect, useMemo, useState } from "react";

import {
  emptyNlpClimatePayload,
  nlpClimateHeadlinesForName,
  nlpClimateSeriesForView,
  nlpClimateSliceForView,
  type NlpClimateHeadline,
  type NlpClimateNameDay,
  type NlpClimatePayload,
  type NlpClimatePoint,
  type NlpClimateSlice,
} from "@/lib/nlpClimate";
import { nlpHistoryTone } from "@/lib/nlpHistory";
import type { NlpMapView } from "@/lib/nlpHistory";
import type { NlpMarketPulse, NlpTone } from "@/lib/nlpPulse";

function fmtScore(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}`;
}

function toneClass(tone: NlpTone | number): string {
  if (typeof tone === "number") {
    if (tone >= 12) return "up";
    if (tone <= -12) return "down";
    return "flat";
  }
  if (tone === "bull") return "up";
  if (tone === "bear") return "down";
  return "flat";
}

function sliceToPulse(slice: NlpClimateSlice): NlpMarketPulse {
  return {
    market: "kospi200",
    label: slice.label,
    score: slice.score,
    tone: slice.tone,
    verdict: slice.verdict,
    verdict_ko: slice.verdict_ko,
    comment: slice.comment,
    news_n: slice.headline_n,
    event_n: 0,
    bull_n: slice.bull_n,
    bear_n: slice.bear_n,
    names: [],
  };
}

function Gauge({ pulse }: { pulse: NlpMarketPulse }) {
  const pct = Math.max(0, Math.min(100, (pulse.score + 100) / 2));
  return (
    <article className={`nlp-gauge nlp-${pulse.tone}`}>
      <header>
        <span className="nlp-gauge-label">{pulse.label}</span>
        <strong className={toneClass(pulse.tone)}>{fmtScore(pulse.score)}</strong>
      </header>
      <div className="nlp-gauge-track" aria-hidden>
        <span className="nlp-gauge-fill" style={{ left: `${pct}%` }} />
        <span className="nlp-gauge-mid" />
      </div>
      <p className="nlp-gauge-meta">
        {pulse.verdict_ko} · 제목 {pulse.news_n}건 · 호조 {pulse.bull_n}종 · 경계 {pulse.bear_n}종
      </p>
      <p className="nlp-gauge-comment">{pulse.comment}</p>
    </article>
  );
}

function Spark({
  series,
  date,
  onPick,
}: {
  series: NlpClimatePoint[];
  date: string;
  onPick: (next: string) => void;
}) {
  const maxAbs = Math.max(20, ...series.map((p) => Math.abs(p.score)));
  const recent = series.slice(-45);
  if (!recent.length) return null;
  return (
    <div className="nlp-climate-spark" role="list">
      {recent.map((p) => {
        const h = Math.max(8, (Math.abs(p.score) / maxAbs) * 100);
        return (
          <button
            key={p.date}
            type="button"
            role="listitem"
            className={`nlp-climate-bar nlp-${nlpHistoryTone(p.score)} ${p.date === date ? "active" : ""}`}
            style={{ height: `${h}%` }}
            title={`${p.date} ${fmtScore(p.score)} · ${p.name_n}종 ${p.headline_n}건`}
            onClick={() => onPick(p.date)}
          />
        );
      })}
    </div>
  );
}

function neighborDate(dates: string[], current: string, delta: number): string | null {
  const i = dates.indexOf(current);
  if (i < 0) return dates[delta > 0 ? dates.length - 1 : 0] || null;
  return dates[i + delta] || null;
}

export default function NlpClimatePanel({
  view,
  onPickName,
}: {
  view: NlpMapView;
  onPickName: (code: string, date: string) => void;
}) {
  const [data, setData] = useState<NlpClimatePayload | null>(null);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [nameNews, setNameNews] = useState<NlpClimateHeadline[] | null>(null);
  const [loadingNews, setLoadingNews] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const qs = date ? `?date=${encodeURIComponent(date)}` : "";
        const res = await fetch(`/api/nlp-climate${qs}`);
        const json = (await res.json()) as NlpClimatePayload;
        if (cancelled) return;
        setData(json);
      } catch (exc) {
        if (!cancelled) {
          setData(emptyNlpClimatePayload(exc instanceof Error ? exc.message : "로드 실패"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const slice = nlpClimateSliceForView(data, view === "kosdaq100" ? "kosdaq100" : "kospi200");
  const series = nlpClimateSeriesForView(data, view === "kosdaq100" ? "kosdaq100" : "kospi200");
  const dates = data?.dates || [];
  const prev = neighborDate(dates, data?.date || date, -1);
  const next = neighborDate(dates, data?.date || date, 1);
  const chosenDate = slice?.date || data?.date || date;

  const coverage = useMemo(() => {
    if (!slice) return "";
    return `${slice.name_n}/${slice.universe_n}종`;
  }, [slice]);

  const polarHeadlines = useMemo(() => {
    if (!slice) return [] as NlpClimateHeadline[];
    if (slice.headlines.length) return slice.headlines;
    return [...slice.movers_up, ...slice.movers_down]
      .flatMap((row) =>
        row.headlines.length
          ? row.headlines
          : row.title
            ? [
                {
                  code: row.code,
                  name: row.name,
                  title: row.title,
                  source: "news",
                  score: row.score,
                } satisfies NlpClimateHeadline,
              ]
            : [],
      )
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 10);
  }, [slice]);

  const pickedMover = useMemo(() => {
    if (!slice || !openCode) return null;
    return [...slice.movers_up, ...slice.movers_down].find((row) => row.code === openCode) || null;
  }, [slice, openCode]);

  useEffect(() => {
    setOpenCode(null);
    setNameNews(null);
  }, [view]);

  useEffect(() => {
    if (!openCode || !chosenDate) {
      setNameNews(null);
      return;
    }
    const local = slice ? nlpClimateHeadlinesForName(slice, openCode) : [];
    if (local.length) {
      setNameNews(local);
      setLoadingNews(false);
      return;
    }
    let cancelled = false;
    setLoadingNews(true);
    setNameNews(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/nlp-climate?date=${encodeURIComponent(chosenDate)}&code=${encodeURIComponent(openCode)}`,
        );
        const json = (await res.json()) as NlpClimateNameDay;
        if (!cancelled) setNameNews(json.headlines || []);
      } catch {
        if (!cancelled) setNameNews([]);
      } finally {
        if (!cancelled) setLoadingNews(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openCode, chosenDate, slice]);

  if (view === "sp500") return null;

  const isLatest = Boolean(data?.max_date && slice?.date === data.max_date);
  const gaugePulse = slice
    ? sliceToPulse({
        ...slice,
        label: isLatest ? `오늘의 ${slice.label}` : `${slice.label} ${slice.date}`,
      })
    : null;

  function pick(code: string) {
    if (!chosenDate) return;
    setOpenCode(code);
    onPickName(code, chosenDate);
  }

  const shownNews = nameNews;
  const pickedName = pickedMover?.name || shownNews?.[0]?.name || openCode;

  return (
    <div className="nlp-climate">
      <div className="nlp-climate-head">
        <div>
          <h3 className="geo-section-title">오늘의 뉴스 분위기</h3>
          <p className="macro-subhead">
            코스피 200·코스닥 100을 매일 조회한 일별 단면입니다. 유니버스는 약{" "}
            {data?.all.universe_n || 298}종이지만, 뉴스가 나온 종목만 쌓입니다. 날짜를 고르고
            종목을 누르면 그 날짜의 제목을 봅니다.
          </p>
        </div>
        <div className="nlp-climate-controls">
          <button type="button" className="ghost-btn" disabled={!prev} onClick={() => prev && setDate(prev)}>
            이전
          </button>
          <input
            type="date"
            className="nlp-climate-date"
            value={data?.date || date}
            min={data?.min_date || undefined}
            max={data?.max_date || undefined}
            onChange={(e) => setDate(e.target.value)}
            aria-label="뉴스 분위기 날짜"
          />
          <button type="button" className="ghost-btn" disabled={!next} onClick={() => next && setDate(next)}>
            다음
          </button>
        </div>
      </div>

      {loading && !data?.ok ? <p className="meta-soft">일별 단면을 모으는 중…</p> : null}
      {data?.error ? <p className="meta-soft">{data.error}</p> : null}

      {slice && gaugePulse ? (
        <>
          <div className="nlp-gauge-row">
            <Gauge pulse={gaugePulse} />
          </div>
          <p className="nlp-climate-cov">
            {slice.date} · 뉴스 있는 종목 {coverage} · 제목 {slice.headline_n}건
            {loading ? " · 갱신 중" : ""}
          </p>
          <Spark series={series} date={slice.date} onPick={setDate} />

          <div className="nlp-verdict-board">
            <section className="geo-section nlp-verdict-col nlp-friendly">
              <h3 className="geo-section-title">호조</h3>
              {!slice.movers_up.length ? (
                <p className="empty">호조로 기울인 종목이 없습니다.</p>
              ) : (
                <ul className="nlp-verdict-list">
                  {slice.movers_up.map((row) => (
                    <li key={row.code}>
                      <button
                        type="button"
                        className={openCode === row.code ? "active" : ""}
                        onClick={() => pick(row.code)}
                      >
                        <strong>{row.name}</strong>
                        <span className="up">{fmtScore(row.score)}</span>
                      </button>
                      <p>
                        제목 {row.n}건{row.title ? ` · ${row.title}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="geo-section nlp-verdict-col nlp-cautious">
              <h3 className="geo-section-title">경계</h3>
              {!slice.movers_down.length ? (
                <p className="empty">경계로 기울인 종목이 없습니다.</p>
              ) : (
                <ul className="nlp-verdict-list">
                  {slice.movers_down.map((row) => (
                    <li key={row.code}>
                      <button
                        type="button"
                        className={openCode === row.code ? "active" : ""}
                        onClick={() => pick(row.code)}
                      >
                        <strong>{row.name}</strong>
                        <span className="down">{fmtScore(row.score)}</span>
                      </button>
                      <p>
                        제목 {row.n}건{row.title ? ` · ${row.title}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="nlp-climate-daynews" id="nlp-day-news">
            <h3 className="geo-section-title">
              {openCode && pickedName ? `${slice.date} ${pickedName} 뉴스` : "극성 제목"}
            </h3>
            {openCode ? (
              loadingNews && !shownNews?.length ? (
                <p className="meta-soft">{pickedName} 제목을 찾는 중…</p>
              ) : shownNews?.length ? (
                <ul className="nlp-feed">
                  {shownNews.map((row, i) => (
                    <li
                      key={`${row.code}-${i}-${row.title.slice(0, 24)}`}
                      className={`nlp-feed-item nlp-${row.score >= 12 ? "bull" : row.score <= -12 ? "bear" : "flat"}`}
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
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">
                  {slice.date} {pickedName}의 저장된 제목이 없습니다. 점수는 있어도 제목 아카이브가 비어 있을 수
                  있습니다.
                </p>
              )
            ) : !polarHeadlines.length ? (
              <p className="empty">호조·경계 종목을 누르면 해당 날짜의 제목이 여기에 열립니다.</p>
            ) : (
              <ul className="nlp-feed">
                {polarHeadlines.map((row, i) => (
                  <li
                    key={`${row.code}-${i}-${row.title.slice(0, 24)}`}
                    className={`nlp-feed-item nlp-${row.score >= 12 ? "bull" : row.score <= -12 ? "bear" : "flat"}`}
                  >
                    <div className="nlp-feed-top">
                      <button type="button" className="nlp-climate-name" onClick={() => pick(row.code)}>
                        {row.name}
                      </button>
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
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

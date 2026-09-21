"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import NlpClimatePanel from "@/components/NlpClimatePanel";
import NlpHistoryPanel from "@/components/NlpHistoryPanel";
import NlpPriceChart from "@/components/NlpPriceChart";
import {
  NLP_KOSDAQ100,
  NLP_KOSPI200,
  emptyNlpHistoryIndex,
  emptyNlpHistorySeries,
  mergeHistoryNames,
  nlpHistoryTone,
  nlpMapScore,
  nlpScoreIsStale,
  type NlpHistoryIndex,
  type NlpHistoryName,
  type NlpHistorySeries,
  type NlpMapView,
} from "@/lib/nlpHistory";
import type {
  NlpHeadline,
  NlpMarketPulse,
  NlpNameCard,
  NlpPulsePayload,
  NlpTone,
} from "@/lib/nlpPulse";
import { emptyNlpPayload } from "@/lib/nlpPulse";

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

function historyPulse(label: string, names: NlpHistoryName[]): NlpMarketPulse {
  const mapScores = names.map((n) => nlpMapScore(n)).filter((s): s is number => typeof s === "number");
  const fallback = names.map((n) => n.last_score).filter((s): s is number => typeof s === "number");
  const scores = mapScores.length ? mapScores : fallback;
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const bull = scores.filter((s) => s >= 12).length;
  const bear = scores.filter((s) => s <= -12).length;
  const tone: NlpTone = avg >= 12 ? "bull" : avg <= -12 ? "bear" : "flat";
  const verdict = avg >= 18 ? "friendly" : avg <= -18 ? "cautious" : "neutral";
  return {
    market: "kospi200",
    label,
    score: avg,
    tone,
    verdict,
    verdict_ko: verdict === "friendly" ? "우호" : verdict === "cautious" ? "경계" : "중립",
    comment: mapScores.length
      ? `최근 7일 점수 평균입니다. 수집 ${mapScores.length}/${names.length}.`
      : fallback.length
        ? "최근 7일 뉴스가 없어 마지막 뉴스일 점수를 참고합니다."
        : "이 유니버스의 뉴스 점수가 아직 없습니다.",
    news_n: names.reduce((s, n) => s + (n.recent_n || 0), 0),
    event_n: 0,
    bull_n: bull,
    bear_n: bear,
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
        {pulse.verdict_ko} · 뉴스 {pulse.news_n} · 공시 {pulse.event_n} · 호조 {pulse.bull_n} · 경계 {pulse.bear_n}
      </p>
      <p className="nlp-gauge-comment">{pulse.comment}</p>
    </article>
  );
}

function NameChip({ card, onPick, active }: { card: NlpNameCard; onPick: (id: string) => void; active: boolean }) {
  return (
    <button
      type="button"
      className={`nlp-chip nlp-${card.tone} ${active ? "active" : ""}`}
      onClick={() => onPick(card.id)}
      title={card.comment}
    >
      <span>{card.name}</span>
      <strong className={toneClass(card.tone)}>{fmtScore(card.score)}</strong>
      <em className="nlp-chip-n">{card.news_n}건</em>
      <em className={`nlp-verdict-tag nlp-${card.verdict}`}>{card.verdict_ko}</em>
      {card.event_n ? <em>공시 {card.event_n}</em> : null}
      {card.call_n ? <em>콜 {card.call_n}</em> : null}
    </button>
  );
}

function HeadlineList({
  rows,
  empty,
}: {
  rows: NlpHeadline[];
  empty: string;
}) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="nlp-feed">
      {rows.map((row) => (
        <li key={row.id} className={`nlp-feed-item nlp-${row.score >= 12 ? "bull" : row.score <= -12 ? "bear" : "flat"}`}>
          <div className="nlp-feed-top">
            <span className="nlp-date">{row.date}</span>
            <span className="nlp-src">{row.source}</span>
            <span className={`nlp-kind k-${row.kind}`}>{row.kind}</span>
          </div>
          {row.url ? (
            <a href={row.url} target="_blank" rel="noreferrer">
              <strong>{row.name}</strong> {row.title}
            </a>
          ) : (
            <span>
              <strong>{row.name}</strong> {row.title}
            </span>
          )}
          {row.matched.length ? (
            <p className="nlp-matched">{row.matched.join(" · ")}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function NlpPulseTab() {
  const [data, setData] = useState<NlpPulsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<NlpMapView>("kospi200");
  const [mapQuery, setMapQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [histIndex, setHistIndex] = useState<NlpHistoryIndex | null>(null);
  const [histSeries, setHistSeries] = useState<NlpHistorySeries | null>(null);
  const [histDate, setHistDate] = useState<string | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/nlp-pulse");
      const json = (await res.json()) as NlpPulsePayload;
      setData(json);
    } catch (exc) {
      setData(emptyNlpPayload(exc instanceof Error ? exc.message : "로드 실패"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/nlp-history");
        const json = (await res.json()) as NlpHistoryIndex;
        if (!cancelled) setHistIndex(json);
      } catch (exc) {
        if (!cancelled) {
          setHistIndex(emptyNlpHistoryIndex(exc instanceof Error ? exc.message : "로드 실패"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pulseNames = useMemo(() => {
    if (market === "sp500") return data?.spx.names || [];
    if (market === "kospi200") return data?.kospi.names || [];
    return [] as NlpNameCard[];
  }, [data, market]);

  const mapNames = useMemo(() => {
    const indexed = histIndex?.names || [];
    if (market === "kosdaq100") {
      return mergeHistoryNames(
        NLP_KOSDAQ100,
        indexed.filter((n) => n.market === "kosdaq"),
      );
    }
    if (market === "kospi200") {
      return mergeHistoryNames(
        NLP_KOSPI200,
        indexed.filter((n) => n.market === "kospi"),
      );
    }
    return [] as NlpHistoryName[];
  }, [data, histIndex, market]);

  const visibleMap = useMemo(() => {
    const q = mapQuery.trim().toLowerCase();
    const rows = q
      ? mapNames.filter(
          (n) => n.name.toLowerCase().includes(q) || n.code.includes(q),
        )
      : mapNames;
    return [...rows].sort((a, b) => {
      const as = nlpMapScore(a);
      const bs = nlpMapScore(b);
      const aStale = as == null && typeof a.last_score === "number";
      const bStale = bs == null && typeof b.last_score === "number";
      if (as == null && bs == null) {
        if (aStale !== bStale) return aStale ? 1 : -1;
        return a.name.localeCompare(b.name, "ko");
      }
      if (as == null) return 1;
      if (bs == null) return -1;
      return bs - as;
    });
  }, [mapNames, mapQuery]);

  const pulseMarket = market === "sp500" ? "sp500" : "kospi200";

  const events = useMemo(() => {
    let rows = data?.events || [];
    rows = rows.filter((r) => r.market === pulseMarket);
    if (picked) rows = rows.filter((r) => r.name_id === picked);
    return rows;
  }, [data, pulseMarket, picked]);

  const calls = useMemo(() => {
    let rows = data?.calls || [];
    rows = rows.filter((r) => r.market === pulseMarket);
    if (picked) rows = rows.filter((r) => r.name_id === picked);
    return rows;
  }, [data, pulseMarket, picked]);

  const feed = useMemo(() => {
    let rows = data?.feed || [];
    rows = rows.filter((r) => r.market === pulseMarket);
    if (picked) rows = rows.filter((r) => r.name_id === picked);
    return rows;
  }, [data, pulseMarket, picked]);

  const pickedCard = pulseNames.find((n) => n.id === picked);
  const pickedHistoryMeta = mapNames.find((n) => n.code === picked) || (histIndex?.names || []).find((n) => n.code === picked);
  const historyCode = /^\d{6}$/.test(picked || "") ? picked : null;
  const chartTicker = pickedCard?.ticker || pickedHistoryMeta?.yahoo || histSeries?.yahoo;
  const chartName = pickedCard?.name || pickedHistoryMeta?.name || histSeries?.name;
  const readyN = mapNames.filter((n) => nlpMapScore(n) != null || (n.n_days || 0) > 0 || n.last_score != null).length;
  const friendlyPulse = market === "sp500" ? pulseNames.filter((n) => n.verdict === "friendly").slice(0, 8) : [];
  const cautiousPulse = market === "sp500" ? pulseNames.filter((n) => n.verdict === "cautious").slice(0, 8) : [];
  const friendlyHist =
    market === "sp500"
      ? []
      : [...mapNames]
          .filter((n) => (nlpMapScore(n) ?? 0) >= 12)
          .sort((a, b) => (nlpMapScore(b) ?? 0) - (nlpMapScore(a) ?? 0))
          .slice(0, 8);
  const cautiousHist =
    market === "sp500"
      ? []
      : [...mapNames]
          .filter((n) => (nlpMapScore(n) ?? 0) <= -12)
          .sort((a, b) => (nlpMapScore(a) ?? 0) - (nlpMapScore(b) ?? 0))
          .slice(0, 8);
  const hasFriendly = market === "sp500" ? friendlyPulse.length > 0 : friendlyHist.length > 0;
  const hasCautious = market === "sp500" ? cautiousPulse.length > 0 : cautiousHist.length > 0;

  useEffect(() => {
    const okPulse = Boolean(picked && pulseNames.some((n) => n.id === picked));
    const okHist = Boolean(picked && mapNames.some((n) => n.code === picked));
    if (okPulse || okHist) return;
    setPicked(mapNames[0]?.code || pulseNames[0]?.id || null);
  }, [mapNames, pulseNames, picked]);

  useEffect(() => {
    if (!historyCode) {
      setHistSeries(null);
      setHistDate(null);
      return;
    }
    let cancelled = false;
    setLoadingHist(true);
    setHistDate(null);
    void (async () => {
      try {
        const res = await fetch(`/api/nlp-history?code=${encodeURIComponent(historyCode)}`);
        const json = (await res.json()) as NlpHistorySeries;
        if (!cancelled) setHistSeries(json);
      } catch (exc) {
        if (!cancelled) {
          setHistSeries(
            emptyNlpHistorySeries(historyCode, exc instanceof Error ? exc.message : "로드 실패"),
          );
        }
      } finally {
        if (!cancelled) setLoadingHist(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyCode]);

  return (
    <div className="geo-tab nlp-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">NLP 투심 모니터</h2>
            <p className="kr-hero-sub">
              맨 위는 오늘의 뉴스 분위기입니다. 코스피 200과 코스닥 100을 나누고, 종목을 고르면
              쌓인 뉴스 점수와 주가를 겹쳐 상관을 비교합니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
              {loading ? "수집 중…" : "새로고침"}
            </button>
          </div>
        </div>

        <div className="nlp-filters">
          {(
            [
              ["kospi200", "코스피 200"],
              ["kosdaq100", "코스닥 100"],
              ["sp500", "해외 기업"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tab-btn sub ${market === id ? "active" : ""}`}
              onClick={() => {
                setMarket(id);
                setPicked(null);
                setMapQuery("");
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {market !== "sp500" ? <NlpClimatePanel view={market} onPickName={setPicked} /> : null}

        {market !== "sp500" ? (
          <div className="nlp-gauge-row">
            <Gauge
              pulse={historyPulse(
                market === "kosdaq100" ? "코스닥 100 투심" : "코스피 200 투심",
                mapNames,
              )}
            />
          </div>
        ) : data?.ok ? (
          <div className="nlp-gauge-row">
            <Gauge pulse={data.spx} />
          </div>
        ) : null}
        {data?.error && market === "sp500" ? <p className="meta-soft">{data.error}</p> : null}
      </section>

      <section className="geo-section">
        <h3 className="geo-section-title">종목 투심 맵</h3>
        <p className="macro-subhead">
          {market === "kosdaq100"
            ? `코스닥 100 ${mapNames.length}종목 · 아카이브 수집 ${readyN}개. 칩 점수는 최근 7일 기사 가중 평균입니다. 흐린 칩은 7일 뉴스가 없어도, 종목을 누르면 더 긴 아카이브가 보입니다.`
            : market === "kospi200"
              ? `코스피 200 ${mapNames.length}종목 · 아카이브 수집 ${readyN}개. 칩 점수는 최근 7일 기사 가중 평균입니다. 흐린 칩은 7일 뉴스가 없어도, 종목을 누르면 더 긴 아카이브가 보입니다.`
              : "해외 대표주의 오늘 뉴스·공시 기울기입니다."}
        </p>
        {market !== "sp500" ? (
          <input
            className="nlp-map-search"
            value={mapQuery}
            onChange={(e) => setMapQuery(e.target.value)}
            placeholder="종목명·코드 검색"
            aria-label="종목 검색"
          />
        ) : null}
        {market === "sp500" ? (
          !pulseNames.length ? (
            <p className="empty">{loading ? "뉴스 수집 중…" : "표시할 종목이 없습니다."}</p>
          ) : (
            <div className="nlp-chip-grid">
              {pulseNames.map((card) => (
                <NameChip
                  key={card.id}
                  card={card}
                  active={picked === card.id}
                  onPick={(id) => setPicked(id)}
                />
              ))}
            </div>
          )
        ) : !visibleMap.length ? (
          <p className="empty">{histIndex ? "검색 결과가 없습니다." : "유니버스를 불러오는 중…"}</p>
        ) : (
          <div className="nlp-chip-grid nlp-chip-grid-dense">
            {visibleMap.map((card) => {
              const mapScore = nlpMapScore(card);
              const stale = nlpScoreIsStale(card);
              const displayScore = mapScore ?? (typeof card.last_score === "number" ? card.last_score : null);
              return (
              <button
                key={card.code}
                type="button"
                className={`nlp-chip ${picked === card.code ? "active" : ""} ${
                  displayScore != null ? `nlp-${nlpHistoryTone(displayScore)}` : ""
                } ${stale && displayScore != null ? "nlp-stale" : ""}`}
                onClick={() => setPicked(card.code)}
                title={
                  displayScore != null
                    ? stale
                      ? `${card.last_date || "이전"} 마지막 뉴스 점수 · 최근 7일 기사 없음`
                      : `최근 7일 점수 · 7일 ${card.recent_n ?? 0}건${card.last_date ? ` · 마지막 ${card.last_date}` : ""}`
                    : "뉴스 대기"
                }
              >
                <span>{card.name}</span>
                {displayScore != null ? (
                  <strong className={toneClass(displayScore)}>{fmtScore(displayScore)}</strong>
                ) : (
                  <em>대기</em>
                )}
                {typeof card.recent_n === "number" || typeof card.last_n === "number" ? (
                  <em className="nlp-chip-n">
                    {typeof card.recent_n === "number" ? `7일 ${card.recent_n}건` : `${card.last_n}건`}
                  </em>
                ) : null}
              </button>
              );
            })}
          </div>
        )}
        {pickedCard ? (
          <article className={`nlp-verdict nlp-${pickedCard.verdict}`}>
            <header>
              <strong>{pickedCard.name}</strong>
              <span className={toneClass(pickedCard.tone)}>
                {pickedCard.verdict_ko} {fmtScore(pickedCard.score)}
              </span>
            </header>
            <p>{pickedCard.comment}</p>
            <p className="nlp-picked">
              뉴스 {pickedCard.news_n} · 공시 {pickedCard.event_n} · 컨콜 {pickedCard.call_n}
              {pickedCard.top_url ? (
                <>
                  {" · "}
                  <a href={pickedCard.top_url} target="_blank" rel="noreferrer">
                    {pickedCard.top_title}
                  </a>
                </>
              ) : pickedCard.top_title ? (
                <> · {pickedCard.top_title}</>
              ) : null}
            </p>
          </article>
        ) : pickedHistoryMeta ? (
          <article className="nlp-verdict">
            <header>
              <strong>{pickedHistoryMeta.name}</strong>
              {nlpMapScore(pickedHistoryMeta) != null || pickedHistoryMeta.last_score != null ? (
                <span className={toneClass(nlpMapScore(pickedHistoryMeta) ?? pickedHistoryMeta.last_score ?? 0)}>
                  {fmtScore(nlpMapScore(pickedHistoryMeta) ?? pickedHistoryMeta.last_score ?? 0)}
                </span>
              ) : (
                <span className="meta-soft">수집 대기</span>
              )}
            </header>
            <p className="nlp-picked">
              {pickedHistoryMeta.n_days
                ? `뉴스 ${pickedHistoryMeta.n_days}일 · 기사 ${pickedHistoryMeta.n_headlines || 0}건`
                : "이 종목의 뉴스 아카이브를 수집하는 중입니다."}
              {typeof pickedHistoryMeta.recent_n === "number"
                ? ` · 최근 7일 ${pickedHistoryMeta.recent_n}건`
                : ""}
              {nlpScoreIsStale(pickedHistoryMeta)
                ? " · 최근 7일 뉴스 없음"
                : nlpMapScore(pickedHistoryMeta) != null
                  ? " · 최근 7일 점수"
                  : ""}
              {pickedHistoryMeta.last_date ? ` · 마지막 ${pickedHistoryMeta.last_date}` : ""}
            </p>
          </article>
        ) : null}
      </section>

      {historyCode ? (
        <NlpHistoryPanel
          series={histSeries}
          loading={loadingHist}
          selectedDate={histDate}
          onSelectDate={setHistDate}
        />
      ) : null}

      {chartTicker && (!historyCode || (!loadingHist && !(histSeries?.days?.length))) ? (
        <NlpPriceChart key={chartTicker} ticker={chartTicker} name={chartName || chartTicker} />
      ) : null}

      <div className="nlp-verdict-board">
        <section className="geo-section nlp-verdict-col nlp-friendly">
          <h3 className="geo-section-title">우호적으로 본 종목</h3>
          {!hasFriendly ? (
            <p className="empty">뚜렷한 우호 기울기 종목이 없습니다.</p>
          ) : (
            <ul className="nlp-verdict-list">
              {friendlyPulse.map((card) => (
                <li key={card.id}>
                  <button type="button" onClick={() => setPicked(card.id)}>
                    <strong>{card.name}</strong>
                    <span className="up">{fmtScore(card.score)}</span>
                  </button>
                  <p>{card.comment}</p>
                </li>
              ))}
              {friendlyHist.map((card) => (
                <li key={card.code}>
                  <button type="button" onClick={() => setPicked(card.code)}>
                    <strong>{card.name}</strong>
                    <span className="up">{fmtScore(nlpMapScore(card) || 0)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="geo-section nlp-verdict-col nlp-cautious">
          <h3 className="geo-section-title">경계로 본 종목</h3>
          {!hasCautious ? (
            <p className="empty">뚜렷한 경계 기울기 종목이 없습니다.</p>
          ) : (
            <ul className="nlp-verdict-list">
              {cautiousPulse.map((card) => (
                <li key={card.id}>
                  <button type="button" onClick={() => setPicked(card.id)}>
                    <strong>{card.name}</strong>
                    <span className="down">{fmtScore(card.score)}</span>
                  </button>
                  <p>{card.comment}</p>
                </li>
              ))}
              {cautiousHist.map((card) => (
                <li key={card.code}>
                  <button type="button" onClick={() => setPicked(card.code)}>
                    <strong>{card.name}</strong>
                    <span className="down">{fmtScore(nlpMapScore(card) || 0)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {market === "sp500" ? (
      <div className="nlp-three">
        <section className="geo-section">
          <h3 className="geo-section-title">극성 뉴스</h3>
          <HeadlineList rows={feed} empty="최근 2일 극성 뉴스가 없습니다." />
        </section>
        <section className="geo-section">
          <h3 className="geo-section-title">DART · SEC 공시</h3>
          <HeadlineList rows={events} empty="최근 이벤트 공시가 없습니다." />
        </section>
        <section className="geo-section">
          <h3 className="geo-section-title">컨콜 · 실적</h3>
          <HeadlineList rows={calls} empty="예정·관련 컨콜 신호가 없습니다." />
        </section>
      </div>
      ) : null}

      <section className="geo-section">
        <h3 className="geo-section-title">방법론</h3>
        <ul className="ideas-summary">
          {market !== "sp500"
            ? [
                "유니버스: 코스닥 100 · 코스피 200 구성종목(약 298종). 매일 전 종목을 조회하지만, 기사가 있는 종목·날짜만 적재",
                "오늘의 뉴스 분위기: 일별 단면의 제목 수 가중 평균. 300건이 매일 쌓이는 것이 아니라, 그날 뉴스가 있는 종목 수(보통 수십 종)입니다",
                "뉴스: 네이버 일자 검색 '{종목} 주가'. 매일 당일을 쌓고, 시계열은 지우지 않음. 최근 7일은 시총 상위 30종 최대 12건, 나머지 최대 8건",
                "차트: 파란선은 그날 제목 점수, 노란선은 종가, 분홍 점은 DART 이벤트. r는 뉴스가 있던 날의 점수·종가 상관",
                "점수: 호재−악재 키워드 순점수 (−100~+100). 증시 종합기사·방향어는 제외",
              ].map((m) => (
                <li key={m}>{m}</li>
              ))
            : (data?.methodology || []).map((m) => (
                <li key={m}>{m}</li>
              ))}
        </ul>
      </section>

      <p className="kr-foot">
        {data?.note} · {(data?.sources || []).join(" · ") || "소스 대기"}
        {data?.generated_at
          ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" })}`
          : ""}
        {typeof data?.lookback_days === "number" ? ` · 최근 ${data.lookback_days}일` : ""}
        {data?.disclaimer ? ` · ${data.disclaimer}` : ""}
      </p>
    </div>
  );
}

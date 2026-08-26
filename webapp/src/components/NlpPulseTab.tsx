"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import NlpPriceChart from "@/components/NlpPriceChart";
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
  const [market, setMarket] = useState<"kospi200" | "sp500">("kospi200");
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/nlp-pulse", { cache: "no-store" });
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

  const names = useMemo(() => {
    const all = [...(data?.kospi.names || []), ...(data?.spx.names || [])];
    return all.filter((n) => n.market === market);
  }, [data, market]);

  const events = useMemo(() => {
    let rows = data?.events || [];
    rows = rows.filter((r) => r.market === market);
    if (picked) rows = rows.filter((r) => r.name_id === picked);
    return rows;
  }, [data, market, picked]);

  const calls = useMemo(() => {
    let rows = data?.calls || [];
    rows = rows.filter((r) => r.market === market);
    if (picked) rows = rows.filter((r) => r.name_id === picked);
    return rows;
  }, [data, market, picked]);

  const feed = useMemo(() => {
    let rows = data?.feed || [];
    rows = rows.filter((r) => r.market === market);
    if (picked) rows = rows.filter((r) => r.name_id === picked);
    return rows;
  }, [data, market, picked]);

  const pickedCard = names.find((n) => n.id === picked);
  const friendly = names.filter((n) => n.verdict === "friendly").slice(0, 8);
  const cautious = names.filter((n) => n.verdict === "cautious").slice(0, 8);

  useEffect(() => {
    if (!names.length) return;
    if (picked && names.some((n) => n.id === picked)) return;
    setPicked(names[0]!.id);
  }, [names, picked]);

  return (
    <div className="geo-tab nlp-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">NLP 투심 모니터</h2>
            <p className="kr-hero-sub">
              국내·해외 대표주의 뉴스 텍스트, DART·SEC 이벤트 공시, 실적·컨콜을 보고
              종목 결론과 라이브 캔들 차트를 한 화면에서 봅니다.
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
              ["kospi200", "국내 기업"],
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
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {data?.ok ? (
          <div className="nlp-gauge-row">
            <Gauge pulse={market === "kospi200" ? data.kospi : data.spx} />
          </div>
        ) : null}
        {data?.error ? <p className="meta-soft">{data.error}</p> : null}
      </section>

      <section className="geo-section">
        <h3 className="geo-section-title">종목 투심 맵</h3>
        <p className="macro-subhead">종목을 누르면 결론·차트·뉴스가 그 기업만 보여 줍니다.</p>
        {!names.length ? (
          <p className="empty">{loading ? "뉴스 수집 중…" : "표시할 종목이 없습니다."}</p>
        ) : (
          <div className="nlp-chip-grid">
            {names.map((card) => (
              <NameChip
                key={card.id}
                card={card}
                active={picked === card.id}
                onPick={(id) => setPicked(id)}
              />
            ))}
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
        ) : null}
      </section>

      {pickedCard ? (
        <NlpPriceChart key={pickedCard.ticker} ticker={pickedCard.ticker} name={pickedCard.name} />
      ) : null}

      <div className="nlp-verdict-board">
        <section className="geo-section nlp-verdict-col nlp-friendly">
          <h3 className="geo-section-title">우호적으로 본 종목</h3>
          {!friendly.length ? (
            <p className="empty">뚜렷한 우호 기울기 종목이 없습니다.</p>
          ) : (
            <ul className="nlp-verdict-list">
              {friendly.map((card) => (
                <li key={card.id}>
                  <button type="button" onClick={() => setPicked(card.id)}>
                    <strong>{card.name}</strong>
                    <span className="up">{fmtScore(card.score)}</span>
                  </button>
                  <p>{card.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="geo-section nlp-verdict-col nlp-cautious">
          <h3 className="geo-section-title">경계로 본 종목</h3>
          {!cautious.length ? (
            <p className="empty">뚜렷한 경계 기울기 종목이 없습니다.</p>
          ) : (
            <ul className="nlp-verdict-list">
              {cautious.map((card) => (
                <li key={card.id}>
                  <button type="button" onClick={() => setPicked(card.id)}>
                    <strong>{card.name}</strong>
                    <span className="down">{fmtScore(card.score)}</span>
                  </button>
                  <p>{card.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

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

      <section className="geo-section">
        <h3 className="geo-section-title">방법론</h3>
        <ul className="ideas-summary">
          {(data?.methodology || []).map((m) => (
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fmtPct,
  retTone,
  rippleHitsFor,
  type ChainPayload,
  type ChainQuote,
  type RippleEvent,
  type RippleHit,
} from "@/lib/chainGraph";
import { emptyNlpPayload, type NlpHeadline, type NlpPulsePayload } from "@/lib/nlpPulse";

function asEvents(feed: NlpHeadline[], quotes: Map<string, ChainQuote>): RippleEvent[] {
  const rows: RippleEvent[] = [];
  for (const h of feed) {
    const hits = rippleHitsFor(h.name_id, h.title, quotes, 7);
    rows.push({
      id: h.id,
      date: h.date,
      title: h.title,
      source: h.source,
      url: h.url,
      kind: h.kind,
      score: h.score,
      origin_id: h.name_id,
      origin_name: h.name,
      hits,
    });
  }
  return rows
    .slice()
    .sort((a, b) => b.hits.length - a.hits.length || Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 18);
}

function satStyle(i: number, n: number, w: number, h: number): { left: number; top: number } {
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.min(w, h) * 0.38;
  const ry = Math.min(w, h) * 0.34;
  const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
  return {
    left: cx + Math.cos(angle) * rx,
    top: cy + Math.sin(angle) * ry,
  };
}

export default function RippleTab() {
  const [nlp, setNlp] = useState<NlpPulsePayload | null>(null);
  const [chain, setChain] = useState<ChainPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nlpRes, chainRes] = await Promise.all([
        fetch("/api/nlp-pulse", { cache: "no-store" }),
        fetch("/api/chain", { cache: "no-store" }),
      ]);
      const nlpJson = (await nlpRes.json()) as NlpPulsePayload;
      const chainJson = (await chainRes.json()) as ChainPayload;
      setNlp(nlpJson);
      setChain(chainJson);
    } catch (exc) {
      setNlp(emptyNlpPayload(exc instanceof Error ? exc.message : "로드 실패"));
      setChain(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const quotes = useMemo(() => {
    const m = new Map<string, ChainQuote>();
    for (const n of chain?.nodes || []) {
      m.set(n.id, { price: n.price, ret1d: n.ret1d, ret5d: n.ret5d });
    }
    return m;
  }, [chain]);

  const events = useMemo(() => {
    const feed = [...(nlp?.feed || []), ...(nlp?.events || []), ...(nlp?.calls || [])];
    return asEvents(feed, quotes);
  }, [nlp, quotes]);

  const fallbackHits: RippleHit[] = useMemo(() => {
    if (events.some((e) => e.hits.length)) return [];
    return rippleHitsFor("NVDA", "NVIDIA GPU supply TSMC SK hynix Microsoft", quotes, 7);
  }, [events, quotes]);

  const active =
    events.find((e) => e.id === picked) ||
    events.find((e) => e.hits.length >= 2) ||
    events[0] ||
    null;

  const hits = active?.hits.length ? active.hits : fallbackHits;
  const stageW = 640;
  const stageH = 420;
  const hub = { left: stageW / 2, top: stageH / 2 };

  return (
    <div className="geo-tab ripple-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">Ripple</h2>
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
              {loading ? "수집 중…" : "새로고침"}
            </button>
          </div>
        </div>
        <p className="quant-comment">
          뉴스·공시 한 건이 시드 그래프의 이웃을 얼마나 건드리는지 봅니다. 헤드라인에 이름이 없으면 1홉 공급·고객을
          붙입니다.
        </p>
        {nlp?.error ? <p className="meta-soft">{nlp.error}</p> : null}
      </section>

      <div className="ripple-split">
        <section className="geo-section ripple-stage-col">
          <h3 className="geo-section-title">파급 맵</h3>
          <div className="ripple-stage" style={{ width: "100%", minHeight: stageH }}>
            <svg className="ripple-lines" viewBox={`0 0 ${stageW} ${stageH}`} aria-hidden>
              {hits.map((hit, i) => {
                const p = satStyle(i, hits.length, stageW, stageH);
                return (
                  <line
                    key={hit.id}
                    x1={hub.left}
                    y1={hub.top}
                    x2={p.left}
                    y2={p.top}
                    className={`ripple-spoke ripple-via-${hit.via}`}
                  />
                );
              })}
            </svg>
            <div className="ripple-hub">
              <em>{active?.origin_name || "NVIDIA"}</em>
              <strong>
                {active
                  ? active.title.length > 72
                    ? `${active.title.slice(0, 72)}…`
                    : active.title
                  : "뉴스 없음 · GPU 시드 1홉"}
              </strong>
              {active?.url ? (
                <a href={active.url} target="_blank" rel="noreferrer">
                  원문
                </a>
              ) : null}
            </div>
            {hits.map((hit, i) => {
              const p = satStyle(i, hits.length, stageW, stageH);
              return (
                <div
                  key={hit.id}
                  className={`ripple-sat nlp-${retTone(hit.ret1d) === "up" ? "bull" : retTone(hit.ret1d) === "down" ? "bear" : "flat"}`}
                  style={{ left: `${(p.left / stageW) * 100}%`, top: `${(p.top / stageH) * 100}%` }}
                  title={hit.note}
                >
                  <span>{hit.short}</span>
                  <strong className={retTone(hit.ret1d)}>{fmtPct(hit.ret1d)}</strong>
                  <em>
                    {hit.via === "mention"
                      ? "언급"
                      : hit.via === "supply"
                        ? "공급"
                        : hit.via === "peer"
                          ? "동종"
                          : "보완"}
                  </em>
                </div>
              );
            })}
          </div>
          {!hits.length ? <p className="empty">이 헤드라인에서 연결할 시드 이웃이 없습니다.</p> : null}
        </section>

        <section className="geo-section ripple-list-col">
          <h3 className="geo-section-title">이벤트</h3>
          {!events.length ? (
            <p className="empty">{loading ? "NLP 피드 수집 중…" : "최근 헤드라인이 없습니다. 맵은 GPU 시드 파급입니다."}</p>
          ) : (
            <ul className="ripple-event-list">
              {events.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={active?.id === e.id ? "active" : ""}
                    onClick={() => setPicked(e.id)}
                  >
                    <span className="ripple-event-top">
                      <em>{e.origin_name}</em>
                      <span>{e.date}</span>
                      <span>{e.kind}</span>
                      <strong>{e.hits.length}파급</strong>
                    </span>
                    <span className="ripple-event-title">{e.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="geo-section">
        <h3 className="geo-section-title">방법</h3>
        <ul className="ideas-summary">
          <li>피드: 기존 NLP 뉴스·DART·SEC·컨콜. 새 크롤러를 두지 않습니다.</li>
          <li>언급: 시드 노드의 한글·영문 별칭과 티커.</li>
          <li>이웃: Chain 시드 1홉. LLM 분류는 쓰지 않습니다.</li>
          <li>등락: Chain 탭과 같은 Yahoo 1일 수익률.</li>
        </ul>
        {nlp?.generated_at ? (
          <p className="meta-soft">{new Date(nlp.generated_at).toLocaleString("ko-KR")}</p>
        ) : null}
      </section>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  EsgRegEvent,
  EsgRegJurisdictionScore,
  EsgRegPayload,
  EsgRegStatus,
} from "@/lib/esgReg";
import { ESG_REG_STATUS_LABELS } from "@/lib/esgReg";

function deltaClass(d: number): string {
  if (d > 0) return "up";
  if (d < 0) return "down";
  return "flat";
}

function fmtDelta(d: number): string {
  return d > 0 ? `+${d}` : String(d);
}

function StatusChip({ status }: { status: EsgRegStatus }) {
  const label = ESG_REG_STATUS_LABELS[status];
  return (
    <span className={`esg-reg-chip status-${status}`}>
      {label.ko}
      <em>{label.en}</em>
    </span>
  );
}

function ScoreCard({ score }: { score: EsgRegJurisdictionScore }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="esg-reg-score-card">
      <header>
        <div>
          <h4>
            {score.label_ko}
            <span className="esg-reg-en"> · {score.label_en}</span>
          </h4>
          <p className="esg-reg-meta">
            근거 이벤트 {score.event_count}건 · lookback 포함 합산
          </p>
        </div>
        <div className={`esg-reg-score ${deltaClass(score.score)}`}>
          {fmtDelta(score.score)}
        </div>
      </header>
      <p className="esg-reg-note">{score.note}</p>
      <button type="button" className="ghost-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "근거 접기" : "근거 이벤트 보기"}
      </button>
      {open ? (
        <ul className="esg-reg-evidence">
          {score.evidence.map((e) => (
            <li key={e.event_id}>
              <div className="esg-reg-evidence-top">
                <StatusChip status={e.status} />
                <strong className={deltaClass(e.delta)}>{fmtDelta(e.delta)}</strong>
                <span className="esg-reg-meta">{e.date}</span>
              </div>
              <div className="esg-reg-title">{e.title_ko}</div>
              <div className="esg-reg-rationale">{e.rationale_ko}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function EventRow({ event }: { event: EsgRegEvent }) {
  return (
    <article className="esg-reg-event">
      <div className="esg-reg-event-top">
        <StatusChip status={event.status} />
        <span className="esg-reg-meta">
          {event.date} · {event.jurisdiction} · {event.framework}
        </span>
        <strong className={deltaClass(event.momentum_delta)}>
          {fmtDelta(event.momentum_delta)}
        </strong>
      </div>
      <h4>
        {event.title_ko}
        <span className="esg-reg-en"> · {event.title_en}</span>
      </h4>
      <p className="esg-reg-summary">{event.summary_ko}</p>
      <p className="esg-reg-rationale">근거: {event.momentum_rationale_ko}</p>
      <p className="esg-reg-meta">
        {event.source_name}
        {" · "}
        <a href={event.source_url} target="_blank" rel="noreferrer">
          원문
        </a>
      </p>
    </article>
  );
}

export default function EsgRegTab() {
  const [data, setData] = useState<EsgRegPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<EsgRegStatus | "all">("all");
  const [jurisdictionFilter, setJurisdictionFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/esg-reg");
      const json = (await res.json()) as EsgRegPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        note: "",
        timezone_display: "Asia/Seoul",
        statuses: [],
        events: [],
        scores: [],
        headlines: [],
        provenance: {
          cadence: "event",
          fetched_at: new Date().toISOString(),
          collected_today: true,
          newly_published_today: false,
          source_name: "n/a",
          methodology: "",
        },
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 10 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const jurisdictions = useMemo(() => {
    if (!data?.events) return [];
    return [...new Set(data.events.map((e) => e.jurisdiction))];
  }, [data]);

  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];
    return data.events.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (jurisdictionFilter !== "all" && e.jurisdiction !== jurisdictionFilter) {
        return false;
      }
      return true;
    });
  }, [data, statusFilter, jurisdictionFilter]);

  return (
    <div className="esg-themes-tab esg-reg-tab">
      <div className="kr-hero esg-themes-hero">
        <div>
          <h2 className="kr-hero-title">ESG 규제 모니터</h2>
          <p className="kr-hero-sub">
            ISSB · EU(CSRD/ESRS/SFDR/Taxonomy/CBAM/CSDDD/ESMA) · 미국 · 한국 · 아시아
            지속가능금융 규제를 이벤트 단위로 추적합니다. 모멘텀 점수는 관할권별이며, 근거
            이벤트를 함께 공개합니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            {loading ? "갱신 중…" : "새로고침"}
          </button>
        </div>
      </div>

      {data?.provenance ? (
        <div className="ai-infra-summary">
          <div className="ai-infra-summary-card">
            <strong>오늘 수집</strong>
            <span>{data.provenance.collected_today ? "예" : "아니오"}</span>
            <em>fetched_at (KST)</em>
          </div>
          <div className="ai-infra-summary-card">
            <strong>오늘 신규 마일스톤</strong>
            <span>{data.provenance.newly_published_today ? "있음" : "없음"}</span>
            <em>event.date = 오늘</em>
          </div>
          <div className="ai-infra-summary-card">
            <strong>데이터 성격</strong>
            <span>event</span>
            <em>일간 시계열이 아님</em>
          </div>
        </div>
      ) : null}

      {loading && !data ? <p className="empty">규제 모니터 불러오는 중…</p> : null}
      {data?.error ? <p className="empty warn">{data.error}</p> : null}

      {data?.ok ? (
        <>
          <section className="ai-infra-section">
            <div className="esg-carbon-support-head">
              <div>
                <h3 className="esg-carbon-support-title">
                  Regulatory Momentum Score (관할권별)
                </h3>
                <p className="esg-carbon-support-sub">
                  +2 신규 의무 시행 · +1 제안/협의/범위 확대 · 0 해석·기술 업데이트 · -1
                  연기/축소 · -2 철회/중대 무효화. 국가 간 단일 랭킹으로 쓰지 마세요.
                </p>
              </div>
            </div>
            <div className="esg-reg-score-grid">
              {data.scores.map((s) => (
                <ScoreCard key={s.jurisdiction} score={s} />
              ))}
            </div>
          </section>

          <section className="ai-infra-section">
            <div className="esg-carbon-support-head">
              <div>
                <h3 className="esg-carbon-support-title">규제 이벤트 카탈로그</h3>
                <p className="esg-carbon-support-sub">
                  편집 검토 마일스톤. 상태·출처·모멘텀 근거를 함께 표시합니다.
                </p>
              </div>
            </div>

            <div className="esg-reg-filters">
              <label>
                상태
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as EsgRegStatus | "all")
                  }
                >
                  <option value="all">전체</option>
                  {(data.statuses || []).map((s) => (
                    <option key={s} value={s}>
                      {ESG_REG_STATUS_LABELS[s].ko} ({s})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                관할
                <select
                  value={jurisdictionFilter}
                  onChange={(e) => setJurisdictionFilter(e.target.value)}
                >
                  <option value="all">전체</option>
                  {jurisdictions.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="esg-reg-event-list">
              {filteredEvents.length ? (
                filteredEvents.map((ev) => <EventRow key={ev.id} event={ev} />)
              ) : (
                <p className="empty">필터에 맞는 이벤트 없음</p>
              )}
            </div>
          </section>

          <section className="ai-infra-section">
            <div className="esg-carbon-support-head">
              <div>
                <h3 className="esg-carbon-support-title">보조 헤드라인 (RSS)</h3>
                <p className="esg-carbon-support-sub">
                  Google News RSS — API 키 불필요. 카탈로그를 대체하지 않으며 참고용입니다.
                </p>
              </div>
            </div>
            {!data.headlines.length ? (
              <p className="empty">헤드라인 N/A</p>
            ) : (
              <ul className="ai-gov-list">
                {data.headlines.map((h, i) => (
                  <li key={`${h.headline}-${i}`}>
                    <span className="ai-gov-meta">
                      {h.source}
                      {h.published ? ` · ${h.published}` : ""}
                    </span>
                    <span className="ai-gov-title">
                      {h.url ? (
                        <a href={h.url} target="_blank" rel="noreferrer">
                          {h.headline}
                        </a>
                      ) : (
                        h.headline
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="kr-foot esg-themes-foot">
            {data.note}
            {data.generated_at
              ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR", {
                  hour12: false,
                })}`
              : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}

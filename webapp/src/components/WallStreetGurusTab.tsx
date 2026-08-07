"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  GuruDesk,
  GuruHeadline,
  WallStreetGurusPayload,
} from "@/lib/wallStreetGurus";

function fmtAum(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `~$${n.toFixed(0)}B`;
}

function fmtWhen(published?: string, ms?: number | null): string {
  const t = ms ?? (published ? Date.parse(published) : NaN);
  if (!Number.isFinite(t)) return published?.slice(0, 16) || "—";
  return new Date(t).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function IdeaLink({ idea }: { idea: GuruHeadline }) {
  const inner = (
    <>
      <strong className="guru-idea-title">{idea.title}</strong>
      <span className="meta-soft">
        {idea.source} · {fmtWhen(idea.published, idea.published_ms)} · 주목{" "}
        {idea.attention_score}
        {idea.why ? ` · ${idea.why}` : ""}
      </span>
    </>
  );
  if (idea.link) {
    return (
      <a className="guru-idea" href={idea.link} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  return <div className="guru-idea">{inner}</div>;
}

function DeskCard({ desk }: { desk: GuruDesk }) {
  const g = desk.guru;
  return (
    <article className="guru-card">
      <header className="guru-card-head">
        <div>
          <h3 className="guru-card-name">
            {g.name_ko}
            <span className="meta-soft"> · {g.name}</span>
          </h3>
          <p className="meta-soft">
            {g.firm} · {g.style_ko}
            {g.aum_usd_bn != null ? ` · AUM ${fmtAum(g.aum_usd_bn)}` : ""}
          </p>
        </div>
        {g.aum_usd_bn != null ? (
          <div className="guru-aum" title={g.aum_note}>
            {fmtAum(g.aum_usd_bn)}
          </div>
        ) : null}
      </header>
      {!desk.ideas.length ? (
        <p className="empty">최근 7일 공개 헤드라인 없음</p>
      ) : (
        <ul className="guru-idea-list">
          {desk.ideas.map((idea) => (
            <li key={idea.id}>
              <IdeaLink idea={idea} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function WallStreetGurusTab() {
  const [data, setData] = useState<WallStreetGurusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wall-street-gurus", { cache: "no-store" });
      const json = (await res.json()) as WallStreetGurusPayload;
      setData(json);
      if (!json.ok) setError(json.error || "구루 브리핑 로드 실패");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const guruName = (id: string) => {
    const fromRoster = data?.roster.find((g) => g.id === id);
    if (fromRoster) return fromRoster.name_ko;
    const fromWatch = data?.watchlist?.find((d) => d.guru.id === id)?.guru;
    return fromWatch?.name_ko || id;
  };

  return (
    <div className="panel-stack wall-street-gurus">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">월가 구루</h2>
            <p className="kr-hero-sub">
              한국시간 매일 아침 7시 기준으로, 유명 구루·헷지펀드 매니저의 공개
              투자 아이디어·발언 중 트래픽·주목도가 높은 보도를 한눈에 정리합니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? "수집 중…" : "새로고침"}
            </button>
          </div>
        </div>
        <p className="meta-soft">
          {data?.schedule_note || "—"}
          {data?.as_of_kst ? ` · 브리핑일 ${data.as_of_kst} (KST)` : ""}
          {data?.generated_at
            ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR", {
                hour12: false,
                timeZone: "Asia/Seoul",
              })}`
            : ""}
        </p>
        {data?.summary?.length ? (
          <ul className="ideas-summary">
            {data.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {data?.highlighted?.length ? (
        <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">오늘의 주목 아이디어</h3>
          <p className="meta-soft">주목 점수 = 최신성 + 매체 권위 + 투자 키워드</p>
          <ol className="guru-highlight-list">
            {data.highlighted.map((idea, idx) => (
              <li key={idea.id} className="guru-highlight">
                <span className="guru-rank">{idx + 1}</span>
                <div>
                  <span className="guru-chip">{guruName(idea.guru_id)}</span>
                  <IdeaLink idea={idea} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">헷지펀드 데스크 · AUM 내림차순</h3>
        <p className="meta-soft">
          운용자산(추정) 기준으로 정렬한 뒤, 최근 공개 발언·보도를 정리합니다.
          AUM은 공개 추정치입니다.
        </p>
        <div className="guru-grid">
          {(data?.hedge_funds || []).map((desk) => (
            <DeskCard key={desk.guru.id} desk={desk} />
          ))}
        </div>
      </section>

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">유명 투자자</h3>
        <div className="guru-grid">
          {(data?.investors || []).map((desk) => (
            <DeskCard key={desk.guru.id} desk={desk} />
          ))}
        </div>
      </section>

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">파이낸스 워치리스트</h3>
        <p className="meta-soft">
          펀드매니저가 아닌 매크로·밸류에이션·시장구조 공개 코멘테이터입니다.
          공개 경력(대학·기관·매체)을 확인한 뒤 등재했습니다. Howard Marks는
          Oaktree 공동창업자이지만, 이 섹션에서는 Memo·리스크 코멘트 추적용으로
          포함합니다.
        </p>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>전문</th>
                <th>팔로우 이유</th>
                <th>주요 소스</th>
                <th>빈도</th>
              </tr>
            </thead>
            <tbody>
              {(data?.watchlist || []).map((desk) => {
                const g = desk.guru;
                return (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.name_ko}</strong>
                      <div className="meta-soft">{g.name}</div>
                      <div className="meta-soft">{g.firm}</div>
                    </td>
                    <td className="meta-soft">
                      {g.expertise_ko || g.expertise || g.style_ko}
                    </td>
                    <td className="meta-soft">
                      {g.why_follow_ko || g.why_follow || "—"}
                    </td>
                    <td className="meta-soft">{g.best_source || "—"}</td>
                    <td className="meta-soft">
                      {g.frequency_ko || g.frequency || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="guru-grid" style={{ marginTop: 12 }}>
          {(data?.watchlist || []).map((desk) => (
            <article key={desk.guru.id} className="guru-card">
              <header className="guru-card-head">
                <div>
                  <h3 className="guru-card-name">
                    {desk.guru.name_ko}
                    <span className="meta-soft"> · {desk.guru.name}</span>
                  </h3>
                  <p className="meta-soft">
                    {desk.guru.best_source || desk.guru.firm}
                    {desk.guru.frequency_ko
                      ? ` · ${desk.guru.frequency_ko}`
                      : ""}
                  </p>
                  {desk.guru.verified_note ? (
                    <p className="meta-soft">{desk.guru.verified_note}</p>
                  ) : null}
                </div>
              </header>
              {!desk.ideas.length ? (
                <p className="empty">최근 7일 공개 헤드라인 없음</p>
              ) : (
                <ul className="guru-idea-list">
                  {desk.ideas.map((idea) => (
                    <li key={idea.id}>
                      <IdeaLink idea={idea} />
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">구루 명단</h3>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>펌</th>
                <th>유형</th>
                <th className="num">AUM(추정)</th>
                <th>스타일</th>
              </tr>
            </thead>
            <tbody>
              {(data?.roster || []).map((g) => (
                <tr key={g.id}>
                  <td>
                    <strong>{g.name_ko}</strong>
                    <div className="meta-soft">{g.name}</div>
                  </td>
                  <td>{g.firm}</td>
                  <td>
                    {g.category === "hedge_fund"
                      ? "헷지펀드"
                      : g.category === "analyst"
                        ? "워치리스트"
                        : "투자자"}
                  </td>
                  <td className="num" title={g.aum_note}>
                    {fmtAum(g.aum_usd_bn)}
                  </td>
                  <td className="meta-soft">{g.style_ko}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="ideas-summary" style={{ marginTop: 12 }}>
          {(data?.methodology || []).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="meta-soft" style={{ marginTop: 8 }}>
          {data?.disclaimer}
        </p>
      </section>
    </div>
  );
}

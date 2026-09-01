"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  EsgEventCategory,
  EsgEventHit,
  EsgEventPillar,
  EsgEventsPayload,
} from "@/lib/esgEvents";

function fmtWhen(iso?: string, display?: string): string {
  if (display) return display;
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
}

function HitRow({ item }: { item: EsgEventHit }) {
  const code = (item.stock_code || "").trim();
  return (
    <li className="esg-events-hit">
      <div className="esg-events-hit-top">
        <span className="esg-events-date">{item.date || "—"}</span>
        {item.fresh ? <span className="esg-events-fresh">신규</span> : null}
        <span className="esg-events-src">{item.source}</span>
      </div>
      <div className="esg-events-hit-body">
        {item.corp_name ? (
          <strong>
            {item.corp_name}
            {code ? <code>{code}</code> : null}
          </strong>
        ) : null}
        {item.source_url ? (
          <a href={item.source_url} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        ) : (
          <span>{item.title}</span>
        )}
      </div>
    </li>
  );
}

function CategoryCard({ cat }: { cat: EsgEventCategory }) {
  const count = (cat.hits?.length || 0) + (cat.news?.length || 0);
  return (
    <article className={`esg-events-card pillar-${cat.pillar}`}>
      <header>
        <div>
          <span className={`esg-events-pillar p-${cat.pillar}`}>{cat.pillar}</span>
          <h3>{cat.title}</h3>
        </div>
        <span
          className={`esg-events-imp ${cat.importance === "매우 높음" ? "crit" : "high"}`}
        >
          {cat.importance}
        </span>
      </header>
      <p className="esg-events-check">{cat.check}</p>
      <p className="esg-events-meta">
        {cat.sources_note} · {count}건
      </p>
      {cat.error ? <p className="empty warn">{cat.error}</p> : null}
      {!count ? (
        <p className="esg-events-empty">해당 기간 신규 건 없음</p>
      ) : (
        <>
          {cat.hits?.length ? (
            <ul className="esg-events-list">
              {cat.hits.map((h) => (
                <HitRow key={h.id || h.title} item={h} />
              ))}
            </ul>
          ) : null}
          {cat.news?.length ? (
            <>
              <p className="esg-events-news-label">관련 보도</p>
              <ul className="esg-events-list news">
                {cat.news.map((h) => (
                  <HitRow key={h.id || h.title} item={h} />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </article>
  );
}

export default function EsgEventsMonitor() {
  const [data, setData] = useState<EsgEventsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/esg-events");
      const json = (await res.json()) as EsgEventsPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        categories: [],
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const by = data?.summary?.by_pillar || {};
  const channel = data?.channel;

  return (
    <section className="esg-events-monitor">
      <div className="kr-hero esg-events-hero">
        <div>
          <h2 className="kr-hero-title">ESG 시황 모니터</h2>
          <p className="kr-hero-sub">
            매일 09:00 KST 갱신 · 중대재해·환경 위반·거버넌스 사건을 KIND·DART·보도로
            스크리닝합니다.{" "}
            <a
              href={channel?.href || "https://t.me/SavvyESG"}
              target="_blank"
              rel="noreferrer"
            >
              {channel?.handle || "@SavvyESG"}
            </a>
            에는 고중요도·당일 건만 하루 최대 5건 송출됩니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            {loading ? "갱신 중…" : "새로고침"}
          </button>
        </div>
      </div>

      <div className="esg-events-summary" aria-label="영역별 건수">
        {(["S", "E", "G"] as EsgEventPillar[]).map((p) => (
          <div key={p} className={`esg-events-sum-chip p-${p}`}>
            <span>{p}</span>
            <strong>{by[p] ?? 0}</strong>
          </div>
        ))}
        <div className="esg-events-sum-chip">
          <span>24h 신규</span>
          <strong>{data?.summary?.fresh ?? 0}</strong>
        </div>
      </div>

      {loading && !data ? <p className="empty">ESG 시황 불러오는 중…</p> : null}
      {data && !data.ok && data.error ? (
        <p className="empty warn">{data.error}</p>
      ) : null}

      {data?.categories?.length ? (
        <div className="esg-events-grid">
          {data.categories.map((cat) => (
            <CategoryCard key={cat.id} cat={cat} />
          ))}
        </div>
      ) : null}

      <p className="kr-foot esg-events-foot">
        {data?.note || "KIND · Open DART · 뉴스. 법적·투자 자문이 아닙니다."}
        {data?.generated_at || data?.generated_at_display
          ? ` · ${fmtWhen(data.generated_at, data.generated_at_display)}`
          : ""}
        {data?.source ? ` · ${data.source}` : ""}
        {typeof data?.lookback_days === "number" ? ` · 최근 ${data.lookback_days}일` : ""}
      </p>
    </section>
  );
}

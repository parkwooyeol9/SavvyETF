"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAdminSession } from "@/components/AdminSession";
import AcwiData from "@/components/acwi/AcwiData";
import AcwiDetail from "@/components/acwi/AcwiDetail";
import AcwiMarket from "@/components/acwi/AcwiMarket";
import AcwiMsci from "@/components/acwi/AcwiMsci";
import AcwiScreener from "@/components/acwi/AcwiScreener";
import { Sg } from "@/components/acwi/parts";
import { ddayFrom, fmt, isNum, type AcwiApiResponse, type AcwiSeries, type AcwiSummary } from "@/lib/acwiAnalyzer";
import { adminAuthHeaders } from "@/lib/adminSession";

type View = "market" | "screen" | "detail" | "msci" | "data";
const VIEWS: [View, string][] = [
  ["market", "시장 개요"],
  ["screen", "스크리너"],
  ["detail", "종목 상세"],
  ["msci", "MSCI 편출입"],
  ["data", "데이터·방법"],
];

export default function AcwiAnalyzerTab() {
  const { secret, unlocked, ready } = useAdminSession();
  const [A, setA] = useState<AcwiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("market");
  const [code, setCode] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<View>>(() => new Set(["market"]));
  if (!visited.has(view)) setVisited(new Set(visited).add(view));
  const seriesCache = useRef(new Map<string, AcwiSeries>());
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready || !unlocked || !secret) return;
    let live = true;
    fetch("/api/acwi-analyzer?part=summary", { cache: "no-store", headers: adminAuthHeaders(secret) })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as AcwiApiResponse<AcwiSummary>;
        if (!res.ok || !json.ok || !json.data) throw new Error(json.error || `HTTP ${res.status}`);
        if (live) setA(json.data);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "불러오기 실패"));
    return () => {
      live = false;
    };
  }, [ready, unlocked, secret]);

  const loadSeries = useCallback(
    async (c: string) => {
      const hit = seriesCache.current.get(c);
      if (hit) return hit;
      const res = await fetch(`/api/acwi-analyzer?part=series&code=${encodeURIComponent(c)}`, {
        cache: "no-store",
        headers: adminAuthHeaders(secret),
      });
      const json = (await res.json().catch(() => ({}))) as AcwiApiResponse<AcwiSeries>;
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const data = json.data ?? {};
      seriesCache.current.set(c, data);
      return data;
    },
    [secret],
  );

  const pick = useCallback((c: string) => {
    setCode(c);
    setView("detail");
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const facts = useMemo(() => {
    if (!A) return null;
    const M = A.meta;
    const all = A.stocks.filter((s) => !s.xr);
    const ma = all.filter((s) => isNum(s.ma200));
    const above = ma.length ? (ma.filter((s) => (s.ma200 as number) > 0).length / ma.length) * 100 : NaN;
    const rev = all.filter((s) => isNum(s.erd));
    const revB = rev.length ? (rev.reduce((a, s) => a + (s.erd as number), 0) / rev.length) * 100 : NaN;
    const nr = (M.next_reviews ?? []).find((r) => r.announce >= M.as_of);
    return { M, above, revB, nr };
  }, [A]);

  if (!unlocked) return null;

  return (
    <div className="panel-stack acwi" ref={top}>
      <section className="geo-section">
        <header className="aa-head">
          <div>
            <p className="aa-eyebrow">포트폴리오 · 관리자 전용</p>
            <h2 className="aa-title">ACWI 종목 분석기</h2>
            <p className="meta-soft">
              Datastream 유니버스 {A ? `${A.stocks.length.toLocaleString()}종목` : ""}의 팩터·기술적·이익추정치와 MSCI 편출입 이력을 한 화면에서 봅니다.
              {facts ? ` 원자료 ${facts.M.source} · 빌드 ${facts.M.built_at.replace("T", " ")}` : ""}
            </p>
          </div>
        </header>
        {error ? <p className="empty">{error}</p> : null}
        {!A && !error ? <p className="empty">불러오는 중…</p> : null}
        {A && facts ? (
          <div className="aa-facts">
            <div className="aa-fact">
              <span>기준일</span>
              <b>{facts.M.ri_last}</b>
            </div>
            <div className="aa-fact">
              <span>종목</span>
              <b>
                {A.stocks.length.toLocaleString()} <small className="meta-soft">(점수 {A.quality.n_scored.toLocaleString()})</small>
              </b>
            </div>
            <div className="aa-fact">
              <span>벤치마크 3M / 12M</span>
              <b>
                <Sg v={facts.M.bench_r3m} /> / <Sg v={facts.M.bench_r12m} />
              </b>
            </div>
            <div className="aa-fact">
              <span>MA200 위 비율</span>
              <b>{fmt(facts.above, 0, "%")}</b>
            </div>
            <div className="aa-fact">
              <span>EPS 리비전 브레드스(3M)</span>
              <b>
                <Sg v={facts.revB} d={0} suf="%p" />
              </b>
            </div>
            <div className="aa-fact">
              <span>다음 MSCI 리뷰</span>
              <b>
                {facts.nr ? (
                  <>
                    {facts.nr.review}{" "}
                    <small className="meta-soft">
                      발표 {facts.nr.announce.slice(5)} (D-{ddayFrom(facts.M.as_of, facts.nr.announce)})
                    </small>
                  </>
                ) : (
                  "–"
                )}
              </b>
            </div>
          </div>
        ) : null}
        {A ? (
          <nav className="aa-tabs" role="tablist" aria-label="ACWI 분석 보기">
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className={`chip${view === id ? " active" : ""}`}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : null}
      </section>
      {A
        ? VIEWS.filter(([id]) => visited.has(id)).map(([id]) => (
            <div key={id} hidden={view !== id}>
              {id === "market" ? (
                <AcwiMarket A={A} onPick={pick} />
              ) : id === "screen" ? (
                <AcwiScreener A={A} onPick={pick} />
              ) : id === "detail" ? (
                <AcwiDetail A={A} code={code} onPick={pick} loadSeries={loadSeries} />
              ) : id === "msci" ? (
                <AcwiMsci A={A} onPick={pick} />
              ) : (
                <AcwiData A={A} />
              )}
            </div>
          ))
        : null}
    </div>
  );
}

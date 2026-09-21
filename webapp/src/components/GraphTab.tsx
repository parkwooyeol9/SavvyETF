"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CHAIN_CLUSTERS,
  GRAPH_NODE_H,
  GRAPH_NODE_W,
  PRIMARY_CHAIN_IDS,
  clusterHeat,
  fmtPct,
  layoutNeighborhood,
  meanRet,
  retTone,
  supplyChainFromFocus,
  supplyChainToFocus,
  type ChainPayload,
} from "@/lib/chainGraph";
import type { NlpClimateNameDay } from "@/lib/nlpClimate";
import {
  emptyNlpHistoryIndex,
  nlpHistoryTone,
  nlpMapScore,
  type NlpHistoryIndex,
} from "@/lib/nlpHistory";
import { emptyNlpPayload, type NlpHeadline, type NlpPulsePayload } from "@/lib/nlpPulse";

function fillForRet(ret: number | null, focus: boolean): string {
  if (focus) return "var(--accent)";
  if (ret == null) return "var(--panel-2)";
  if (ret >= 1.2) return "rgba(61, 214, 140, 0.35)";
  if (ret <= -1.2) return "rgba(248, 113, 113, 0.32)";
  return "var(--panel-2)";
}

function relKo(rel: string): string {
  if (rel === "supply") return "공급";
  if (rel === "peer") return "동종";
  return "보완";
}

function fmtNews(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  const sign = n > 0 ? "+" : "";
  return `뉴스 ${sign}${n.toFixed(0)}`;
}

function isKrCode(id: string): boolean {
  return /^\d{6}$/.test(id);
}

function openNlpTab(code: string) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  params.set("tab", "nlp");
  params.set("code", code);
  window.history.replaceState(null, "", `/?${params.toString()}`);
  window.dispatchEvent(new CustomEvent("savvyetf-nav-tab", { detail: { tab: "nlp", code } }));
}

export default function GraphTab() {
  const [data, setData] = useState<ChainPayload | null>(null);
  const [nlp, setNlp] = useState<NlpPulsePayload | null>(null);
  const [histIndex, setHistIndex] = useState<NlpHistoryIndex | null>(null);
  const [nameNews, setNameNews] = useState<NlpClimateNameDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState("NVDA");
  const [clusterId, setClusterId] = useState("gpu");
  const [booted, setBooted] = useState(false);
  const [supplyOnly, setSupplyOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [showMore, setShowMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const chainRes = await fetch("/api/chain");
      setData((await chainRes.json()) as ChainPayload);
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : "로드 실패";
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        comment: "",
        methodology: [],
        disclaimer: "",
        clusters: CHAIN_CLUSTERS,
        nodes: [],
        edges: [],
        errors: [msg],
        error: msg,
      });
    } finally {
      setLoading(false);
    }
    try {
      const [nlpRes, histRes] = await Promise.all([
        fetch("/api/nlp-pulse"),
        fetch("/api/nlp-history"),
      ]);
      setNlp((await nlpRes.json()) as NlpPulsePayload);
      setHistIndex((await histRes.json()) as NlpHistoryIndex);
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : "로드 실패";
      setNlp(emptyNlpPayload(msg));
      setHistIndex(emptyNlpHistoryIndex(msg));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nlpByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of histIndex?.names || []) {
      const score = nlpMapScore(n) ?? n.last_score;
      if (score != null) m.set(n.code, score);
    }
    return m;
  }, [histIndex]);

  const heat = useMemo(() => clusterHeat(data?.nodes || []), [data]);
  const primaryHeat = heat.filter((h) => (PRIMARY_CHAIN_IDS as readonly string[]).includes(h.id));
  const extraHeat = heat.filter((h) => !(PRIMARY_CHAIN_IDS as readonly string[]).includes(h.id));

  useEffect(() => {
    if (booted || !data?.nodes.length) return;
    const ranked = [...primaryHeat].sort(
      (a, b) => Math.abs(b.avg1d || 0) - Math.abs(a.avg1d || 0),
    );
    const top = ranked[0];
    if (top) {
      setClusterId(top.id);
      setFocusId(top.hub);
    }
    setBooted(true);
  }, [booted, data, primaryHeat]);

  const pickCluster = (id: string) => {
    setClusterId(id);
    const hub = (data?.clusters || CHAIN_CLUSTERS).find((c) => c.id === id)?.hub;
    if (hub) setFocusId(hub);
  };

  const pickNode = (id: string) => {
    setFocusId(id);
    const cluster = (data?.clusters || CHAIN_CLUSTERS).find((c) => c.hub === id);
    if (cluster) setClusterId(cluster.id);
  };

  const layout = useMemo(() => {
    if (!data?.nodes.length) return null;
    const id = data.nodes.some((n) => n.id === focusId) ? focusId : data.nodes[0]!.id;
    const raw = layoutNeighborhood(id, data.nodes, 2);
    if (!supplyOnly) return raw;
    return { ...raw, edges: raw.edges.filter((e) => e.rel === "supply") };
  }, [data, focusId, supplyOnly]);

  const focus = data?.nodes.find((n) => n.id === focusId) || data?.nodes[0] || null;
  const inbound = (data?.edges || []).filter((e) => e.to === focusId && (!supplyOnly || e.rel === "supply"));
  const outbound = (data?.edges || []).filter((e) => e.from === focusId && (!supplyOnly || e.rel === "supply"));
  const activeHeat = heat.find((h) => h.id === clusterId) || null;
  const neighAvg = meanRet((layout?.nodes || []).map((n) => n.ret1d));
  const focusNews = focus && isKrCode(focus.id) ? nlpByCode.get(focus.id) ?? null : null;

  useEffect(() => {
    if (!focus || !isKrCode(focus.id)) {
      setNameNews(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/nlp-climate?code=${encodeURIComponent(focus.id)}`);
        const json = (await res.json()) as NlpClimateNameDay;
        if (!cancelled) setNameNews(json);
      } catch {
        if (!cancelled) setNameNews(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focus]);

  const usHeadlines = useMemo(() => {
    if (!focus || isKrCode(focus.id)) return [] as NlpHeadline[];
    const aliases = new Set(focus.aliases.map((a) => a.toUpperCase()));
    aliases.add(focus.short.toUpperCase());
    aliases.add(focus.name.toUpperCase());
    const feed = [...(nlp?.feed || []), ...(nlp?.events || []), ...(nlp?.calls || [])];
    return feed
      .filter((h) => {
        const blob = `${h.title} ${h.name}`.toUpperCase();
        return [...aliases].some((a) => a.length >= 2 && blob.includes(a));
      })
      .slice(0, 8);
  }, [focus, nlp]);

  const krHeadlines = nameNews?.headlines || [];
  const newsCount = isKrCode(focusId) ? krHeadlines.length : usHeadlines.length;

  const upPath = useMemo(() => supplyChainToFocus(focusId), [focusId]);
  const downPath = useMemo(() => supplyChainFromFocus(focusId), [focusId]);

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return (data?.nodes || [])
      .filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.short.toLowerCase().includes(q) ||
          n.ticker.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [data, query]);

  const comment = data?.comment || "";

  return (
    <div className="geo-tab graph-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">밸류체인</h2>
            <p className="macro-subhead">공개 관계 지도 + 오늘 등락. 체인을 고르거나 종목을 검색하세요.</p>
          </div>
          <div className="kr-hero-actions">
            <label className="graph-search">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="종목·티커 검색"
                aria-label="종목 검색"
              />
            </label>
            <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
              {loading ? "수집 중…" : "새로고침"}
            </button>
          </div>
        </div>
        {searchHits.length ? (
          <ul className="graph-search-hits">
            {searchHits.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    pickNode(n.id);
                    setQuery("");
                  }}
                >
                  {n.name} <em>{n.short}</em>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {comment ? <p className="quant-comment">{comment}</p> : null}
        {data?.error ? <p className="meta-soft">{data.error}</p> : null}

        <div className="graph-kpi">
          <article>
            <span>체인 평균 1일</span>
            <strong className={retTone(activeHeat?.avg1d ?? neighAvg)}>
              {fmtPct(activeHeat?.avg1d ?? neighAvg)}
            </strong>
          </article>
          <article>
            <span>포커스 1일</span>
            <strong className={retTone(focus?.ret1d)}>{focus ? `${focus.short} ${fmtPct(focus.ret1d)}` : "—"}</strong>
          </article>
          <article>
            <span>뉴스 점수</span>
            <strong className={focusNews == null ? "flat" : nlpHistoryTone(focusNews) === "bull" ? "up" : nlpHistoryTone(focusNews) === "bear" ? "down" : "flat"}>
              {focusNews == null ? (isKrCode(focusId) ? "없음" : "해외") : fmtNews(focusNews)}
            </strong>
          </article>
          <article>
            <span>관련 뉴스</span>
            <strong>{newsCount}건</strong>
          </article>
        </div>

        <div className="graph-heat-row">
          {primaryHeat.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`graph-heat-chip ${clusterId === h.id ? "active" : ""}`}
              onClick={() => pickCluster(h.id)}
              style={{
                background:
                  h.avg1d == null
                    ? undefined
                    : h.avg1d >= 0
                      ? `rgba(61, 214, 140, ${Math.min(0.45, 0.08 + Math.abs(h.avg1d) / 20)})`
                      : `rgba(248, 113, 113, ${Math.min(0.45, 0.08 + Math.abs(h.avg1d) / 20)})`,
              }}
            >
              <span>{h.label}</span>
              <strong className={retTone(h.avg1d)}>{fmtPct(h.avg1d)}</strong>
              <em>{h.n}종</em>
            </button>
          ))}
          <button
            type="button"
            className={`tab-btn sub ${supplyOnly ? "active" : ""}`}
            onClick={() => setSupplyOnly((v) => !v)}
          >
            공급만
          </button>
        </div>
        {extraHeat.length ? (
          <div className="graph-heat-row graph-heat-extra">
            {extraHeat.map((h) => (
              <button
                key={h.id}
                type="button"
                className={`graph-heat-chip quiet ${clusterId === h.id ? "active" : ""}`}
                onClick={() => pickCluster(h.id)}
              >
                <span>{h.label}</span>
                <strong className={retTone(h.avg1d)}>{fmtPct(h.avg1d)}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <div className="graph-stage">
        <section className="geo-section chain-stage-section">
          <div className="geo-section-head">
            <h3 className="geo-section-title">
              {activeHeat?.label || "체인"} · {focus?.name || "포커스"}
            </h3>
            <p className="macro-subhead">왼쪽이 공급, 오른쪽이 고객. 노드를 누르면 서랍이 바뀝니다.</p>
          </div>
          {!layout || !layout.nodes.length ? (
            <p className="empty">{loading ? "관계 지도 준비 중…" : "표시할 간선이 없습니다."}</p>
          ) : (
            <div className="chain-stage-wrap">
              <svg
                className="chain-svg"
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label={`${focus?.name || "포커스"} 밸류체인`}
              >
                <defs>
                  <marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                  </marker>
                </defs>
                {layout.bands.map((b) => (
                  <text key={`band-${b.rank}`} x={b.x} y={16} className="graph-rank-lab">
                    {b.label}
                  </text>
                ))}
                {layout.edges.map((e) => {
                  const dx = Math.max(36, (e.x2 - e.x1) / 2);
                  const dash = e.rel === "peer" ? "5 4" : e.rel === "complement" ? "2 3" : undefined;
                  const hot = e.from === focusId || e.to === focusId;
                  return (
                    <path
                      key={`${e.from}-${e.to}-${e.rel}`}
                      className={`chain-link chain-link-${e.rel} ${hot ? "hot" : ""}`}
                      d={`M ${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - dx} ${e.y2}, ${e.x2} ${e.y2}`}
                      fill="none"
                      strokeDasharray={dash}
                      markerEnd={e.rel === "peer" ? undefined : "url(#graph-arrow)"}
                    />
                  );
                })}
                {layout.nodes.map((n) => {
                  const isFocus = n.id === focusId;
                  const news = isKrCode(n.id) ? nlpByCode.get(n.id) : undefined;
                  return (
                    <g
                      key={n.id}
                      className="chain-node"
                      transform={`translate(${n.x}, ${n.y})`}
                      opacity={isFocus ? 1 : n.hop === 1 ? 0.92 : 0.68}
                      onClick={() => pickNode(n.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          pickNode(n.id);
                        }
                      }}
                    >
                      <rect
                        width={GRAPH_NODE_W}
                        height={GRAPH_NODE_H}
                        rx={8}
                        fill={fillForRet(n.ret1d, isFocus)}
                        stroke={isFocus ? "var(--accent)" : "var(--border)"}
                        strokeWidth={isFocus ? 2.2 : 1}
                      />
                      <text x={10} y={18} className={`chain-node-name ${isFocus ? "on-accent" : ""}`}>
                        {n.short}
                      </text>
                      <text x={10} y={34} className={`chain-node-meta ${isFocus ? "on-accent" : ""}`}>
                        {n.role}
                      </text>
                      <text x={10} y={48} className={`chain-node-meta ${isFocus ? "on-accent" : ""}`}>
                        1일 {fmtPct(n.ret1d)}
                        {news != null ? ` N${news > 0 ? "+" : ""}${Math.round(news)}` : ""}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          <div className="chain-legend">
            <span><i className="chain-swatch supply" /> 공급</span>
            <span><i className="chain-swatch peer" /> 동종</span>
            <span><i className="chain-swatch complement" /> 보완</span>
            <span>녹색·빨강 = 1일 ±1.2% 이상</span>
          </div>
          <p className="graph-path">
            <span>상류</span>
            {upPath.map((id, i) => {
              const n = data?.nodes.find((x) => x.id === id);
              return (
                <span key={`up-${id}`}>
                  {i ? " → " : ""}
                  <button type="button" onClick={() => pickNode(id)}>
                    {n?.short || id}
                  </button>
                </span>
              );
            })}
            <span className="graph-path-gap">하류</span>
            {downPath.map((id, i) => {
              const n = data?.nodes.find((x) => x.id === id);
              return (
                <span key={`dn-${id}`}>
                  {i ? " → " : ""}
                  <button type="button" onClick={() => pickNode(id)}>
                    {n?.short || id}
                  </button>
                </span>
              );
            })}
          </p>
        </section>

        <aside className="geo-section graph-drawer">
          <h3 className="geo-section-title">{focus?.name || "포커스"}</h3>
          <p className="macro-subhead">
            1일 {fmtPct(focus?.ret1d)} · 5일 {fmtPct(focus?.ret5d)}
            {focusNews != null ? ` · ${fmtNews(focusNews)}` : ""}
          </p>
          {focus && isKrCode(focus.id) ? (
            <p className="graph-nlp-jump">
              <button type="button" className="ghost-btn" onClick={() => openNlpTab(focus.id)}>
                NLP에서 이 종목 보기
              </button>
            </p>
          ) : null}

          <h4 className="graph-drawer-h">상류 · 공급</h4>
          {!inbound.length ? (
            <p className="empty">공급 간선이 없습니다.</p>
          ) : (
            <ul className="chain-edge-list">
              {inbound.map((e) => {
                const src = data?.nodes.find((n) => n.id === e.from);
                return (
                  <li key={`in-${e.from}-${e.rel}`}>
                    <button type="button" onClick={() => pickNode(e.from)}>
                      <strong>{src?.name || e.from}</strong>
                      <em className={retTone(src?.ret1d)}>{fmtPct(src?.ret1d)}</em>
                    </button>
                    <p>
                      {relKo(e.rel)} · {e.note}
                    </p>
                    <span className="chain-src">{e.source}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <h4 className="graph-drawer-h">하류 · 고객</h4>
          {!outbound.length ? (
            <p className="empty">고객 간선이 없습니다.</p>
          ) : (
            <ul className="chain-edge-list">
              {outbound.map((e) => {
                const dst = data?.nodes.find((n) => n.id === e.to);
                return (
                  <li key={`out-${e.to}-${e.rel}`}>
                    <button type="button" onClick={() => pickNode(e.to)}>
                      <strong>{dst?.name || e.to}</strong>
                      <em className={retTone(dst?.ret1d)}>{fmtPct(dst?.ret1d)}</em>
                    </button>
                    <p>
                      {relKo(e.rel)} · {e.note}
                    </p>
                    <span className="chain-src">{e.source}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <h4 className="graph-drawer-h">관련 뉴스</h4>
          {isKrCode(focusId) ? (
            !krHeadlines.length ? (
              <p className="empty">{nameNews?.error || "이 날짜에 저장된 제목이 없습니다."}</p>
            ) : (
              <ul className="nlp-feed">
                {krHeadlines.map((row, i) => (
                  <li key={`${row.title}-${i}`} className="nlp-feed-item">
                    <div className="nlp-feed-top">
                      <span className="nlp-src">{row.source}</span>
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
            )
          ) : !usHeadlines.length ? (
            <p className="empty">{loading ? "헤드라인 수집 중…" : "헤드라인에 이 이름이 없습니다."}</p>
          ) : (
            <ul className="nlp-feed">
              {usHeadlines.map((row) => (
                <li key={row.id} className="nlp-feed-item">
                  <div className="nlp-feed-top">
                    <span className="nlp-src">{row.source}</span>
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
        </aside>
      </div>

      <section className="geo-section">
        <button type="button" className="graph-more-toggle" onClick={() => setShowMore((v) => !v)}>
          {showMore ? "자세히 접기" : "방법 · 출처"}
        </button>
        {showMore ? (
          <>
            <ul className="ideas-summary">
              {(data?.methodology || []).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {data?.disclaimer ? <p className="meta-soft">{data.disclaimer}</p> : null}
            {data?.generated_at ? (
              <p className="meta-soft">{new Date(data.generated_at).toLocaleString("ko-KR")}</p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

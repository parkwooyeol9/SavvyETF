"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CHAIN_CLUSTERS,
  GRAPH_NODE_H,
  GRAPH_NODE_W,
  clusterHeat,
  fmtPct,
  layoutNeighborhood,
  meanRet,
  nodeDegrees,
  retTone,
  rippleHitsFor,
  supplyChainFromFocus,
  supplyChainToFocus,
  type ChainPayload,
  type ChainQuote,
  type RippleEvent,
} from "@/lib/chainGraph";
import { emptyNlpPayload, type NlpHeadline, type NlpPulsePayload } from "@/lib/nlpPulse";

function fillForRet(ret: number | null, focus: boolean): string {
  if (focus) return "var(--accent)";
  if (ret == null) return "var(--panel-2)";
  if (ret >= 1.2) return "rgba(61, 214, 140, 0.35)";
  if (ret <= -1.2) return "rgba(248, 113, 113, 0.32)";
  return "var(--panel-2)";
}

function asEvents(feed: NlpHeadline[], quotes: Map<string, ChainQuote>): RippleEvent[] {
  const rows: RippleEvent[] = [];
  for (const h of feed) {
    const hits = rippleHitsFor(h.name_id, h.title, quotes, 8);
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
    .slice(0, 16);
}

function relKo(rel: string): string {
  if (rel === "mention") return "언급";
  if (rel === "supply") return "공급";
  if (rel === "peer") return "동종";
  return "보완";
}

export default function GraphTab() {
  const [data, setData] = useState<ChainPayload | null>(null);
  const [nlp, setNlp] = useState<NlpPulsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState("NVDA");
  const [clusterId, setClusterId] = useState("gpu");
  const [supplyOnly, setSupplyOnly] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [chainRes, nlpRes] = await Promise.all([
        fetch("/api/chain", { cache: "no-store" }),
        fetch("/api/nlp-pulse", { cache: "no-store" }),
      ]);
      setData((await chainRes.json()) as ChainPayload);
      setNlp((await nlpRes.json()) as NlpPulsePayload);
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
      setNlp(emptyNlpPayload(msg));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const quotes = useMemo(() => {
    const m = new Map<string, ChainQuote>();
    for (const n of data?.nodes || []) {
      m.set(n.id, { price: n.price, ret1d: n.ret1d, ret5d: n.ret5d });
    }
    return m;
  }, [data]);

  const events = useMemo(() => {
    const feed = [...(nlp?.feed || []), ...(nlp?.events || []), ...(nlp?.calls || [])];
    return asEvents(feed, quotes);
  }, [nlp, quotes]);

  const active = events.find((e) => e.id === picked) || null;
  const hitIds = useMemo(() => new Set(active?.hits.map((h) => h.id) || []), [active]);

  const pickCluster = (id: string) => {
    setClusterId(id);
    setPicked(null);
    const hub = (data?.clusters || CHAIN_CLUSTERS).find((c) => c.id === id)?.hub;
    if (hub) setFocusId(hub);
  };

  const pickNode = (id: string) => {
    setFocusId(id);
    const related = events.find((e) => e.origin_id === id || e.hits.some((h) => h.id === id));
    setPicked(related?.id || null);
  };

  const pickEvent = (ev: RippleEvent) => {
    setPicked(ev.id);
    if ((data?.nodes || []).some((n) => n.id === ev.origin_id)) setFocusId(ev.origin_id);
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
  const degrees = useMemo(() => nodeDegrees(), []);
  const heat = useMemo(() => clusterHeat(data?.nodes || []), [data]);
  const neighAvg = meanRet((layout?.nodes || []).map((n) => n.ret1d));
  const hottest = useMemo(() => {
    const rows = (data?.nodes || []).filter((n) => n.ret1d != null);
    if (!rows.length) return null;
    return rows.slice().sort((a, b) => (b.ret1d || 0) - (a.ret1d || 0))[0]!;
  }, [data]);
  const coldest = useMemo(() => {
    const rows = (data?.nodes || []).filter((n) => n.ret1d != null);
    if (!rows.length) return null;
    return rows.slice().sort((a, b) => (a.ret1d || 0) - (b.ret1d || 0))[0]!;
  }, [data]);
  const hubs = useMemo(() => {
    const byId = new Map((data?.nodes || []).map((n) => [n.id, n]));
    return [...degrees.entries()]
      .map(([id, d]) => ({ id, deg: d.all, node: byId.get(id) }))
      .filter((r) => r.node)
      .sort((a, b) => b.deg - a.deg)
      .slice(0, 8);
  }, [data, degrees]);

  const upPath = useMemo(() => supplyChainToFocus(focusId), [focusId]);
  const downPath = useMemo(() => supplyChainFromFocus(focusId), [focusId]);

  const shockRows = (layout?.nodes || [])
    .slice()
    .sort((a, b) => a.hop - b.hop || Math.abs(b.ret1d || 0) - Math.abs(a.ret1d || 0));

  const newsForFocus = events.filter(
    (e) => e.origin_id === focusId || e.hits.some((h) => h.id === focusId),
  );

  const comment =
    data?.comment && events.length
      ? `${data.comment} 뉴스 ${events.length}건이 시드 이웃과 연결됩니다.`
      : data?.comment || "";

  return (
    <div className="geo-tab graph-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">그래프</h2>
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
              {loading ? "수집 중…" : "새로고침"}
            </button>
          </div>
        </div>
        {comment ? <p className="quant-comment">{comment}</p> : null}
        {data?.error ? <p className="meta-soft">{data.error}</p> : null}
        {nlp?.error ? <p className="meta-soft">{nlp.error}</p> : null}

        <div className="graph-kpi">
          <article>
            <span>시드 노드</span>
            <strong>{data?.nodes.length || 0}</strong>
          </article>
          <article>
            <span>간선</span>
            <strong>{data?.edges.length || 0}</strong>
          </article>
          <article>
            <span>이웃 평균 1일</span>
            <strong className={retTone(neighAvg)}>{fmtPct(neighAvg)}</strong>
          </article>
          <article>
            <span>1일 최강</span>
            <strong className="up">{hottest ? `${hottest.short} ${fmtPct(hottest.ret1d)}` : "—"}</strong>
          </article>
          <article>
            <span>1일 최약</span>
            <strong className="down">{coldest ? `${coldest.short} ${fmtPct(coldest.ret1d)}` : "—"}</strong>
          </article>
          <article>
            <span>파급 뉴스</span>
            <strong>{events.length}</strong>
          </article>
        </div>

        <div className="nlp-filters">
          {(data?.clusters || CHAIN_CLUSTERS).map((c) => (
            <button
              key={c.id}
              type="button"
              className={`tab-btn sub ${clusterId === c.id ? "active" : ""}`}
              onClick={() => pickCluster(c.id)}
            >
              {c.label}
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

        <div className="graph-heat-row">
          {heat.map((h) => (
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
              <em>{h.n}노드</em>
            </button>
          ))}
        </div>
      </section>

      <section className="geo-section chain-stage-section">
        <div className="geo-section-head">
          <h3 className="geo-section-title">
            공급망 · {focus?.name || "포커스"}
            {active ? ` · 파급 ${active.hits.length}` : ""}
          </h3>
          <p className="macro-subhead">
            노드를 누르면 상·하류가 다시 그려집니다. 뉴스를 고르면 언급·1홉이 노란 테두리로 표시됩니다.
          </p>
        </div>
        {!layout || !layout.nodes.length ? (
          <p className="empty">{loading ? "그래프 준비 중…" : "표시할 간선이 없습니다."}</p>
        ) : (
          <div className="chain-stage-wrap">
            <svg
              className="chain-svg"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label={`${focus?.name || "포커스"} 공급망`}
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
                const hot = e.from === focusId || e.to === focusId || hitIds.has(e.from) || hitIds.has(e.to);
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
                const isHit = hitIds.has(n.id);
                return (
                  <g
                    key={n.id}
                    className="chain-node"
                    transform={`translate(${n.x}, ${n.y})`}
                    opacity={isFocus || isHit ? 1 : n.hop === 1 ? 0.92 : 0.68}
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
                      stroke={isFocus ? "var(--accent)" : isHit ? "var(--warn)" : "var(--border)"}
                      strokeWidth={isFocus || isHit ? 2.2 : 1}
                    />
                    <text x={10} y={18} className={`chain-node-name ${isFocus ? "on-accent" : ""}`}>
                      {n.short}
                    </text>
                    <text x={10} y={34} className={`chain-node-meta ${isFocus ? "on-accent" : ""}`}>
                      {n.role}
                    </text>
                    <text x={10} y={48} className={`chain-node-meta ${isFocus ? "on-accent" : ""}`}>
                      1일 {fmtPct(n.ret1d)} · 5일 {fmtPct(n.ret5d)}
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
          <span><i className="chain-swatch hit" /> 뉴스 파급</span>
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

      <div className="graph-split">
        <section className="geo-section">
          <h3 className="geo-section-title">뉴스 파급</h3>
          {active ? (
            <p className="macro-subhead">
              {active.origin_name} · {active.hits.map((h) => `${h.short}(${relKo(h.via)})`).join(" · ")}
              {active.url ? (
                <>
                  {" "}
                  <a href={active.url} target="_blank" rel="noreferrer">
                    원문
                  </a>
                </>
              ) : null}
            </p>
          ) : (
            <p className="macro-subhead">헤드라인을 누르면 DAG에 파급 노드가 표시됩니다.</p>
          )}
          {!events.length ? (
            <p className="empty">{loading ? "NLP 피드 수집 중…" : "최근 헤드라인이 없습니다."}</p>
          ) : (
            <ul className="ripple-event-list">
              {events.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={active?.id === e.id ? "active" : ""}
                    onClick={() => pickEvent(e)}
                  >
                    <span className="ripple-event-top">
                      <em>{e.origin_name}</em>
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

        <section className="geo-section">
          <h3 className="geo-section-title">쇼크 보드 · 2홉</h3>
          {!shockRows.length ? (
            <p className="empty">포커스 이웃이 없습니다.</p>
          ) : (
            <div className="deriv-table-wrap">
              <table className="deriv-table">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>홉</th>
                    <th>1일</th>
                    <th>5일</th>
                    <th>차수</th>
                  </tr>
                </thead>
                <tbody>
                  {shockRows.map((n) => (
                    <tr
                      key={n.id}
                      className={n.id === focusId ? "quant-hot" : hitIds.has(n.id) ? "quant-drawn" : ""}
                      onClick={() => pickNode(n.id)}
                    >
                      <td>{n.name}</td>
                      <td>{n.hop === 0 ? "포커스" : n.hop}</td>
                      <td className={retTone(n.ret1d)}>{fmtPct(n.ret1d)}</td>
                      <td className={retTone(n.ret5d)}>{fmtPct(n.ret5d)}</td>
                      <td>{degrees.get(n.id)?.all ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {newsForFocus.length ? (
            <p className="macro-subhead" style={{ marginTop: 10 }}>
              이 포커스 관련 뉴스 {newsForFocus.length}건
            </p>
          ) : null}
        </section>
      </div>

      <div className="chain-detail-grid">
        <section className="geo-section">
          <h3 className="geo-section-title">{focus?.name || "포커스"} 상류</h3>
          {!inbound.length ? (
            <p className="empty">시드에 공급 간선이 없습니다.</p>
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
        </section>
        <section className="geo-section">
          <h3 className="geo-section-title">{focus?.name || "포커스"} 하류</h3>
          {!outbound.length ? (
            <p className="empty">시드에 고객 간선이 없습니다.</p>
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
        </section>
      </div>

      <section className="geo-section">
        <h3 className="geo-section-title">연결 허브</h3>
        <div className="chain-hop-row">
          {hubs.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`chain-hop-chip ${h.id === focusId ? "active" : ""}`}
              onClick={() => pickNode(h.id)}
            >
              <span>{h.node?.short}</span>
              <strong className={retTone(h.node?.ret1d)}>{fmtPct(h.node?.ret1d)}</strong>
              <em>차수 {h.deg}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="geo-section">
        <h3 className="geo-section-title">방법</h3>
        <ul className="ideas-summary">
          {(data?.methodology || []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {data?.disclaimer ? <p className="meta-soft">{data.disclaimer}</p> : null}
        {data?.generated_at ? (
          <p className="meta-soft">{new Date(data.generated_at).toLocaleString("ko-KR")}</p>
        ) : null}
      </section>
    </div>
  );
}

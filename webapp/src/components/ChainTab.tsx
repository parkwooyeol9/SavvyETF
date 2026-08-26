"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CHAIN_CLUSTERS,
  fmtPct,
  layoutNeighborhood,
  retTone,
  type ChainPayload,
} from "@/lib/chainGraph";

const NODE_W = 128;
const NODE_H = 52;

function fillForRet(ret: number | null, focus: boolean): string {
  if (focus) return "var(--accent)";
  if (ret == null) return "var(--panel-2)";
  if (ret >= 1.2) return "rgba(61, 214, 140, 0.35)";
  if (ret <= -1.2) return "rgba(248, 113, 113, 0.32)";
  return "var(--panel-2)";
}

export default function ChainTab() {
  const [data, setData] = useState<ChainPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState("NVDA");
  const [clusterId, setClusterId] = useState("gpu");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/chain", { cache: "no-store" });
      const json = (await res.json()) as ChainPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        comment: "",
        methodology: [],
        disclaimer: "",
        clusters: CHAIN_CLUSTERS,
        nodes: [],
        edges: [],
        errors: [exc instanceof Error ? exc.message : "로드 실패"],
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickCluster = (id: string) => {
    setClusterId(id);
    const hub = (data?.clusters || CHAIN_CLUSTERS).find((c) => c.id === id)?.hub;
    if (hub) setFocusId(hub);
  };

  const layout = useMemo(() => {
    if (!data?.nodes.length) return null;
    const id = data.nodes.some((n) => n.id === focusId) ? focusId : data.nodes[0]!.id;
    return layoutNeighborhood(id, data.nodes, 2);
  }, [data, focusId]);

  const focus = data?.nodes.find((n) => n.id === focusId) || data?.nodes[0] || null;
  const inbound = (data?.edges || []).filter((e) => e.to === focusId);
  const outbound = (data?.edges || []).filter((e) => e.from === focusId);
  const laidFocus = layout?.nodes.find((n) => n.id === focusId);

  return (
    <div className="geo-tab chain-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">Chain</h2>
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
              {loading ? "시세 수집…" : "새로고침"}
            </button>
          </div>
        </div>
        {data?.comment ? <p className="quant-comment">{data.comment}</p> : null}
        {data?.error ? <p className="meta-soft">{data.error}</p> : null}
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
        </div>
      </section>

      <section className="geo-section chain-stage-section">
        <div className="geo-section-head">
          <h3 className="geo-section-title">공급 → 포커스 → 고객</h3>
          <p className="macro-subhead">노드를 누르면 그 기업이 가운데 열로 옵니다. 색은 1일 등락.</p>
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
                <marker id="chain-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                </marker>
              </defs>
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
                    markerEnd={e.rel === "peer" ? undefined : "url(#chain-arrow)"}
                  />
                );
              })}
              {layout.nodes.map((n) => {
                const isFocus = n.id === focusId;
                return (
                  <g
                    key={n.id}
                    className="chain-node"
                    transform={`translate(${n.x}, ${n.y})`}
                    opacity={n.hop === 0 ? 1 : n.hop === 1 ? 0.95 : 0.72}
                    onClick={() => setFocusId(n.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setFocusId(n.id);
                      }
                    }}
                  >
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={8}
                      fill={fillForRet(n.ret1d, isFocus)}
                      stroke={isFocus ? "var(--accent)" : "var(--border)"}
                      strokeWidth={isFocus ? 2 : 1}
                    />
                    <text x={10} y={20} className={`chain-node-name ${isFocus ? "on-accent" : ""}`}>
                      {n.short}
                    </text>
                    <text x={10} y={38} className={`chain-node-meta ${isFocus ? "on-accent" : ""}`}>
                      {n.role} · {fmtPct(n.ret1d)}
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
          <span>녹색·빨강 배경 = 1일 +/- 1.2% 이상</span>
        </div>
      </section>

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
                    <button type="button" onClick={() => setFocusId(e.from)}>
                      <strong>{src?.name || e.from}</strong>
                      <em className={retTone(src?.ret1d)}>{fmtPct(src?.ret1d)}</em>
                    </button>
                    <p>
                      {e.rel === "supply" ? "공급" : e.rel === "peer" ? "동종" : "보완"} · {e.note}
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
                    <button type="button" onClick={() => setFocusId(e.to)}>
                      <strong>{dst?.name || e.to}</strong>
                      <em className={retTone(dst?.ret1d)}>{fmtPct(dst?.ret1d)}</em>
                    </button>
                    <p>
                      {e.rel === "supply" ? "공급" : e.rel === "peer" ? "동종" : "보완"} · {e.note}
                    </p>
                    <span className="chain-src">{e.source}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {laidFocus ? (
        <section className="geo-section">
          <h3 className="geo-section-title">2홉 등락</h3>
          <div className="chain-hop-row">
            {layout?.nodes
              .slice()
              .sort((a, b) => a.hop - b.hop || Math.abs(b.ret1d || 0) - Math.abs(a.ret1d || 0))
              .map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`chain-hop-chip ${n.id === focusId ? "active" : ""}`}
                  onClick={() => setFocusId(n.id)}
                >
                  <span>{n.short}</span>
                  <strong className={retTone(n.ret1d)}>{fmtPct(n.ret1d)}</strong>
                  <em>{n.hop === 0 ? "포커스" : `${n.hop}홉`}</em>
                </button>
              ))}
          </div>
        </section>
      ) : null}

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

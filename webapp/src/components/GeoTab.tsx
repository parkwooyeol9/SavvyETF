"use client";

import { useCallback, useEffect, useState } from "react";

import type { GeoPayload, GeoSignal } from "@/lib/geo";

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtPrice(n?: number | null, currency?: string): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1000) return `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  if (n >= 100) return n.toFixed(2);
  return n.toFixed(3);
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function groupLabel(group: GeoSignal["group"]): string {
  switch (group) {
    case "energy":
      return "에너지";
    case "metals":
      return "금속·원자재";
    case "risk":
      return "리스크·운임";
    case "etf":
      return "관련 ETF";
    default:
      return group;
  }
}

export default function GeoTab() {
  const [data, setData] = useState<GeoPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/geo", { cache: "no-store" });
      const json = (await res.json()) as GeoPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const groups: GeoSignal["group"][] = ["energy", "metals", "risk", "etf"];

  return (
    <div className="geo-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">지정학 · 매크로 레이더</h2>
        </div>

        {loading && !data ? <p className="empty">시그널 불러오는 중…</p> : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <>
            <div className="geo-composite">
              <div className="geo-score-ring" data-level={data.composite.score >= 55 ? "hot" : "cool"}>
                <span className="geo-score-num">{data.composite.score}</span>
                <span className="geo-score-label">리스크 압력</span>
              </div>
              <div className="geo-composite-body">
                <h3>{data.composite.label}</h3>
                <ul>
                  {(data.composite.drivers.length
                    ? data.composite.drivers
                    : ["주요 일간 변동이 크지 않습니다."]
                  ).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <p className="meta-soft">
                  갱신 {new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false })} ·{" "}
                  {data.note}
                </p>
              </div>
            </div>

            {groups.map((group) => {
              const rows = data.signals.filter((s) => s.group === group);
              if (!rows.length) return null;
              return (
                <section key={group} className="geo-section">
                  <h3 className="geo-section-title">{groupLabel(group)}</h3>
                  <div className="geo-signal-grid">
                    {rows.map((s) => (
                      <article key={s.id} className="geo-signal-card">
                        <div className="geo-signal-top">
                          <strong>{s.label}</strong>
                          <code>{s.symbol}</code>
                        </div>
                        <div className="geo-signal-price">
                          {fmtPrice(s.price)}
                          {s.currency ? (
                            <span className="geo-ccy">{s.currency}</span>
                          ) : null}
                        </div>
                        <div className="geo-signal-chgs">
                          <span className={retClass(s.change_1d_pct)}>
                            1D {fmtPct(s.change_1d_pct)}
                          </span>
                          <span className={retClass(s.change_5d_pct)}>
                            5D {fmtPct(s.change_5d_pct)}
                          </span>
                        </div>
                        <p className="geo-thesis">{s.thesis}</p>
                        {s.error ? <p className="empty warn">{s.error}</p> : null}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}

            <section className="geo-section">
              <h3 className="geo-section-title">관련 ETF 각도</h3>
              <div className="geo-etf-row">
                {data.related_etfs.map((e) => (
                  <div key={e.symbol} className="geo-etf-chip">
                    <strong>{e.symbol}</strong>
                    <span>{e.name}</span>
                    <em>{e.angle}</em>
                  </div>
                ))}
              </div>
            </section>

            <section className="geo-section">
              <h3 className="geo-section-title">글로벌 헤드라인 (RSS)</h3>
              {!data.headlines.length ? (
                <p className="empty">헤드라인을 가져오지 못했습니다.</p>
              ) : (
                <ul className="geo-headlines">
                  {data.headlines.map((h) => (
                    <li key={`${h.source}-${h.title}`}>
                      <span className="geo-hl-source">{h.source}</span>
                      {h.link ? (
                        <a href={h.link} target="_blank" rel="noopener noreferrer">
                          {h.title}
                        </a>
                      ) : (
                        <span>{h.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <button type="button" className="btn ghost" onClick={() => void load()} disabled={loading}>
              {loading ? "새로고침 중…" : "새로고침"}
            </button>
          </>
        ) : null}
      </section>
    </div>
  );
}

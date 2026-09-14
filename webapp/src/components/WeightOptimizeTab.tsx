"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { OptimizedSleeve, WeightOptimizePayload } from "@/lib/weightOptimize";

const LAST_KEY = "savvyetf.weightopt.last";

type LastSnap = { as_of: string; weights: Record<string, number> };

function fmtPct(n?: number | null, digits = 1, signed = false): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function tone(n?: number | null): string {
  if (n == null || Math.abs(n) < 0.05) return "";
  return n > 0 ? "up" : "down";
}

function DualBar({ pick, opt }: { pick: number; opt: number }) {
  const max = Math.max(28, pick, opt);
  return (
    <div className="wopt-dual" aria-hidden>
      <span className="wopt-dual-track">
        <span className="wopt-dual-pick" style={{ width: `${(pick / max) * 100}%` }} />
      </span>
      <span className="wopt-dual-track">
        <span className="wopt-dual-opt" style={{ width: `${(opt / max) * 100}%` }} />
      </span>
    </div>
  );
}

function ViewChips({ row }: { row: OptimizedSleeve }) {
  const chips: Array<{ k: string; v: number }> = [
    { k: "시그널", v: row.views.signal },
    { k: "NLP", v: row.views.nlp },
    { k: "그래프", v: row.views.graph },
    { k: "수급", v: row.views.flow },
  ].filter((c) => Math.abs(c.v) >= 0.004);
  if (!chips.length) return <span className="meta-soft">—</span>;
  return (
    <span className="wopt-chips">
      {chips.map((c) => (
        <span key={c.k} className={`wopt-chip ${c.v > 0 ? "up" : "down"}`}>
          {c.k} {c.v > 0 ? "+" : ""}
          {(c.v * 100).toFixed(1)}%
        </span>
      ))}
    </span>
  );
}

function loadLast(): LastSnap | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastSnap;
  } catch {
    return null;
  }
}

function saveLast(data: WeightOptimizePayload) {
  if (!data.ok || !data.as_of) return;
  const weights: Record<string, number> = {};
  for (const s of data.sleeves) weights[s.symbol] = s.opt_pct;
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ as_of: data.as_of, weights }));
  } catch {
    /* ignore quota */
  }
}

export default function WeightOptimizeTab() {
  const [data, setData] = useState<WeightOptimizePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<LastSnap | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/weight-optimize", { cache: "no-store" });
      const json = (await res.json()) as WeightOptimizePayload;
      setData(json);
      if (!json.ok) setError(json.error || "최적화 실패");
      else saveLast(json);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLast(loadLast());
    void load();
  }, [load]);

  const rows = data?.sleeves || [];
  const risky = rows.filter((r) => r.asset_class !== "cash");
  const cash = rows.find((r) => r.asset_class === "cash");

  const vsPrev = useMemo(() => {
    if (!last || !data?.as_of || last.as_of === data.as_of) return null;
    let t = 0;
    const syms = new Set([...Object.keys(last.weights), ...rows.map((r) => r.symbol)]);
    for (const s of syms) {
      const a = last.weights[s] || 0;
      const b = rows.find((r) => r.symbol === s)?.opt_pct || 0;
      t += Math.abs(a - b);
    }
    return { as_of: last.as_of, turnover: t / 2 };
  }, [last, data?.as_of, rows]);

  return (
    <div className="panel-stack trading-ideas wopt-page">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">비중 최적화</h2>
            <p className="kr-hero-sub">
              AI Pick을 사전으로 두고, 시그널·NLP·그래프·수급 뷰로 기대수익을 보정한 뒤
              현금·종목 상한·턴오버를 제약으로 풉니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? "계산 중…" : "새로고침"}
            </button>
            <button
              type="button"
              className="tab-btn"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("savvyetf-nav-tab", { detail: "ideas" }),
                );
              }}
            >
              AI Pick 보기
            </button>
          </div>
        </div>
        <p className="meta-soft">
          {data?.schedule_note || "—"}
          {data?.as_of ? ` · 기준 ${data.as_of}` : ""}
          {data?.generated_at
            ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false })}`
            : ""}
        </p>
        {data?.comment ? <p className="quant-comment">{data.comment}</p> : null}
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {data?.ok ? (
        <section className="geo-section" style={{ marginTop: 12 }}>
          <div className="wopt-stats">
            <div>
              <em>위험회피 λ</em>
              <strong>{data.lambda.toFixed(1)}</strong>
              <span>{data.regime_ko || "—"}</span>
            </div>
            <div>
              <em>현금</em>
              <strong>{data.cash_pct.toFixed(0)}%</strong>
              <span>AI Pick {data.pick_cash_pct.toFixed(0)}%</span>
            </div>
            <div>
              <em>추정 변동성</em>
              <strong>{data.port_vol_pct != null ? `${data.port_vol_pct.toFixed(0)}%` : "—"}</strong>
              <span>
                Pick {data.pick_vol_pct != null ? `${data.pick_vol_pct.toFixed(0)}%` : "—"}
              </span>
            </div>
            <div>
              <em>vs AI Pick 회전율</em>
              <strong>{data.turnover_vs_pick_pct.toFixed(1)}%p</strong>
              <span>½ Σ |Δw|</span>
            </div>
            <div>
              <em>사후 초과수익 μ</em>
              <strong>{fmtPct(data.expected_excess_pct, 1, true)}</strong>
              <span>연율 환산 뷰</span>
            </div>
            {data.flow_regime_ko ? (
              <div>
                <em>수급 레짐</em>
                <strong>{data.flow_regime_ko}</strong>
                <span>Money Flow 1개월</span>
              </div>
            ) : null}
          </div>
          {data.summary.length ? (
            <ul className="ideas-summary">
              {data.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : null}
          {vsPrev ? (
            <p className="meta-soft" style={{ marginTop: 8 }}>
              이전 스냅샷({vsPrev.as_of}) 대비 회전율 {vsPrev.turnover.toFixed(1)}%p · 브라우저에만 저장
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">목표 비중 · AI Pick 대비</h3>
        <p className="wopt-legend meta-soft">
          <span className="wopt-swatch pick" /> AI Pick
          <span className="wopt-swatch opt" /> 최적화
        </p>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table wopt-table">
            <thead>
              <tr>
                <th>종목</th>
                <th>유형</th>
                <th className="num">Pick</th>
                <th className="num">최적</th>
                <th className="num">Δ</th>
                <th>비교</th>
                <th className="num">μ</th>
                <th className="num">σ</th>
                <th>뷰</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr>
                  <td colSpan={9} className="empty">
                    {loading ? "불러오는 중…" : "—"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.symbol} className={r.asset_class === "cash" ? "wopt-cash" : ""}>
                    <td>
                      <strong>{r.symbol}</strong>
                      <div className="meta-soft">{r.name}</div>
                    </td>
                    <td>
                      {r.asset_class === "cash"
                        ? "현금"
                        : r.asset_class === "stock"
                          ? "주식"
                          : r.group}
                    </td>
                    <td className="num">{r.pick_pct.toFixed(1)}</td>
                    <td className="num">
                      <strong>{r.opt_pct.toFixed(1)}</strong>
                    </td>
                    <td className={`num ${tone(r.delta_pct)}`}>
                      {fmtPct(r.delta_pct, 1, true)}
                    </td>
                    <td>
                      <DualBar pick={r.pick_pct} opt={r.opt_pct} />
                    </td>
                    <td className={`num ${tone(r.mu_pct)}`}>
                      {r.asset_class === "cash" ? "—" : fmtPct(r.mu_pct, 1, true)}
                    </td>
                    <td className="num">
                      {r.asset_class === "cash" ? "—" : r.vol_pct.toFixed(0)}
                    </td>
                    <td>
                      {r.asset_class === "cash" ? (
                        <span className="meta-soft">{r.rationale.join(" · ")}</span>
                      ) : (
                        <ViewChips row={r} />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {cash ? (
          <p className="meta-soft" style={{ marginTop: 8 }}>
            투자 {data?.invested_pct.toFixed(0)}% · ETF 상한 22% · 주식 상한 6% · 턴오버 축소 32%
          </p>
        ) : null}
      </section>

      {risky.length ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">뷰 근거</h3>
          <ul className="ideas-summary">
            {risky
              .filter((r) => r.rationale.length)
              .slice(0, 8)
              .map((r) => (
                <li key={`why-${r.symbol}`}>
                  <strong>{r.symbol}</strong> — {r.rationale.join(" · ")}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {data?.sells?.length ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">매도·회피 (비중 0)</h3>
          <p className="meta-soft">
            {data.sells
              .slice(0, 10)
              .map((s) => s.symbol)
              .join(" · ")}
          </p>
        </section>
      ) : null}

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">방법론</h3>
        <ul className="ideas-summary">
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

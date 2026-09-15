"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { OptimizedSleeve, WeightOptimizePayload } from "@/lib/weightOptimize";

const LAST_KEY = "savvyetf.weightopt.last";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

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
      const res = await fetch("/api/weight-optimize");
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

  const chartPack = useMemo(() => {
    const series = data?.sim?.series || [];
    if (!series.length) return { data: [] as Array<Record<string, string | number>>, domain: [95, 105] as [number, number] };
    const mapped = series.map((p) => ({
      t: p.date.slice(2),
      최적화: p.opt,
      "AI Pick": p.pick,
      SPY: p.spy,
    }));
    let min = Infinity;
    let max = -Infinity;
    for (const d of mapped) {
      min = Math.min(min, d.최적화, d["AI Pick"], d.SPY);
      max = Math.max(max, d.최적화, d["AI Pick"], d.SPY);
    }
    if (!(max > min)) return { data: mapped, domain: [min - 1, max + 1] as [number, number] };
    const pad = Math.max((max - min) * 0.06, 0.4);
    return { data: mapped, domain: [min - pad, max + pad] as [number, number] };
  }, [data?.sim?.series]);

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

      {data?.ok && data.sim ? (
        <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">5년 배분 시뮬레이션</h3>
          <p className="meta-soft">{data.sim.note || data.sim.error || "—"}</p>
          {data.sim.ok ? (
            <>
              <div className="wopt-stats" style={{ marginTop: 10 }}>
                <div>
                  <em>최적화 누적</em>
                  <strong className={tone(data.sim.opt_total_pct)}>
                    {fmtPct(data.sim.opt_total_pct, 1, true)}
                  </strong>
                  <span>
                    {data.sim.start} → {data.sim.end}
                  </span>
                </div>
                <div>
                  <em>AI Pick 누적</em>
                  <strong className={tone(data.sim.pick_total_pct)}>
                    {fmtPct(data.sim.pick_total_pct, 1, true)}
                  </strong>
                  <span>같은 종목 · 다른 비중</span>
                </div>
                <div>
                  <em>SPY 누적</em>
                  <strong className={tone(data.sim.spy_total_pct)}>
                    {fmtPct(data.sim.spy_total_pct, 1, true)}
                  </strong>
                  <span>벤치마크</span>
                </div>
                <div>
                  <em>최적화 MDD</em>
                  <strong>{fmtPct(data.sim.opt_mdd_pct, 1)}</strong>
                  <span>
                    Pick {fmtPct(data.sim.pick_mdd_pct, 1)} · SPY{" "}
                    {fmtPct(data.sim.spy_mdd_pct, 1)}
                  </span>
                </div>
                <div>
                  <em>시뮬 현금</em>
                  <strong>{data.sim.cash_opt_pct.toFixed(0)}%</strong>
                  <span>수익률 0 · Pick {data.sim.cash_pick_pct.toFixed(0)}%</span>
                </div>
              </div>
              <p className="wopt-legend meta-soft" style={{ marginTop: 10 }}>
                <span className="wopt-swatch opt" /> 최적화
                <span className="wopt-swatch pick" /> AI Pick
                <span className="wopt-swatch spy" /> SPY
                <span>시작=100 · 리밸런스 없음</span>
              </p>
              <div className="kr-chart" style={{ height: 300, marginTop: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartPack.data}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
                    <YAxis
                      domain={chartPack.domain}
                      allowDataOverflow
                      tick={{ fill: "#8fa3b8", fontSize: 10 }}
                      width={52}
                      tickFormatter={(v: number) => v.toFixed(0)}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number) => [`${Number(v).toFixed(1)}`, undefined]}
                    />
                    <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="최적화"
                      stroke="#60a5fa"
                      strokeWidth={2.2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="AI Pick"
                      stroke="#94a3b8"
                      strokeWidth={1.6}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="SPY"
                      stroke="#64748b"
                      strokeWidth={1.4}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {data.sim.dropped.length ? (
                <p className="meta-soft" style={{ marginTop: 8 }}>
                  이력 부족(현금 처리):{" "}
                  {data.sim.dropped.map((d) => `${d.symbol} ${d.reason}`).join(" · ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="empty" style={{ marginTop: 8 }}>
              {data.sim.error || "시뮬레이션을 만들지 못했습니다."}
            </p>
          )}
        </section>
      ) : null}

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

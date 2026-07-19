"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import EquityChart from "@/components/EquityChart";
import type { SimulateResult } from "@/lib/simulate";

type HeatmapCell = {
  ticker: string;
  size: number;
  daily_return_pct: number;
};

type HeatmapPayload = {
  ok: boolean;
  error?: string;
  universe?: string;
  label?: string;
  size_label?: string;
  session_label?: string;
  generated_at?: string;
  stats?: {
    avg_return_pct: number;
    best: { ticker: string; daily_return_pct: number };
    worst: { ticker: string; daily_return_pct: number };
    up_count: number;
    down_count: number;
  };
  cells?: HeatmapCell[];
  image_png_base64?: string;
  caption?: string;
};

type WhyPayload = {
  ok: boolean;
  error?: string;
  start_date?: string;
  end_date?: string;
  narrative?: Array<{ heading: string; body: string }>;
  presets?: Array<{
    id: string;
    title: string;
    blurb: string;
    tickers: string[];
    weights: number[];
    benchmark: string;
    simulation: SimulateResult;
  }>;
};

const UNIVERSES = [
  { id: "etf", label: "US ETF" },
  { id: "sp", label: "S&P 500" },
  { id: "nas", label: "Nasdaq 100" },
] as const;

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function retClass(n: number): string {
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

export default function MainTab() {
  const [universe, setUniverse] = useState<(typeof UNIVERSES)[number]["id"]>("etf");
  const [heatmap, setHeatmap] = useState<HeatmapPayload | null>(null);
  const [why, setWhy] = useState<WhyPayload | null>(null);
  const [heatLoading, setHeatLoading] = useState(true);
  const [whyLoading, setWhyLoading] = useState(true);

  const loadHeatmap = useCallback(async (u: string) => {
    setHeatLoading(true);
    try {
      const res = await fetch(`/api/heatmap?universe=${u}&top_n=30&image=1`, {
        cache: "no-store",
      });
      const data = (await res.json()) as HeatmapPayload;
      setHeatmap(data);
    } catch (exc) {
      setHeatmap({
        ok: false,
        error: exc instanceof Error ? exc.message : "Heatmap load failed",
      });
    } finally {
      setHeatLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHeatmap(universe);
  }, [universe, loadHeatmap]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWhyLoading(true);
      try {
        const res = await fetch("/api/why-etf", { cache: "no-store" });
        const data = (await res.json()) as WhyPayload;
        if (!cancelled) setWhy(data);
      } catch (exc) {
        if (!cancelled) {
          setWhy({
            ok: false,
            error: exc instanceof Error ? exc.message : "Insights load failed",
          });
        }
      } finally {
        if (!cancelled) setWhyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const movers = useMemo(() => {
    const cells = heatmap?.cells || [];
    const sorted = [...cells].sort((a, b) => b.daily_return_pct - a.daily_return_pct);
    return { top: sorted.slice(0, 5), bottom: sorted.slice(-5).reverse() };
  }, [heatmap]);

  return (
    <div className="main-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">ETF 히트맵</h2>
          <p className="feature-lead">
            시가총액·AUM 기준 상위 종목의 하루 수익률을 Finviz 스타일로 보여줍니다.
          </p>
        </div>

        <div className="chip-row" role="tablist" aria-label="히트맵 유니버스">
          {UNIVERSES.map((u) => (
            <button
              key={u.id}
              type="button"
              className={`chip ${universe === u.id ? "active" : ""}`}
              onClick={() => setUniverse(u.id)}
            >
              {u.label}
            </button>
          ))}
        </div>

        {heatLoading ? <p className="empty">히트맵 불러오는 중…</p> : null}

        {!heatLoading && heatmap && !heatmap.ok ? (
          <p className="empty warn">
            {heatmap.error || "히트맵을 아직 준비하지 못했습니다. 봇 랭킹 캐시가 채워지면 표시됩니다."}
          </p>
        ) : null}

        {!heatLoading && heatmap?.ok ? (
          <>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">평균</span>
                <span className={`stat-value ${retClass(heatmap.stats?.avg_return_pct || 0)}`}>
                  {fmtPct(heatmap.stats?.avg_return_pct)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">상승 / 하락</span>
                <span className="stat-value">
                  {heatmap.stats?.up_count ?? "—"} / {heatmap.stats?.down_count ?? "—"}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">최고</span>
                <span className="stat-value up">
                  {heatmap.stats?.best.ticker} {fmtPct(heatmap.stats?.best.daily_return_pct)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">최저</span>
                <span className="stat-value down">
                  {heatmap.stats?.worst.ticker} {fmtPct(heatmap.stats?.worst.daily_return_pct)}
                </span>
              </div>
            </div>

            {heatmap.image_png_base64 ? (
              <img
                className="heatmap-img"
                alt={heatmap.caption || `${heatmap.label} heatmap`}
                src={`data:image/png;base64,${heatmap.image_png_base64}`}
              />
            ) : null}

            <p className="meta-soft">
              {heatmap.session_label || heatmap.label}
              {heatmap.generated_at
                ? ` · ${new Date(heatmap.generated_at).toLocaleString("ko-KR", { hour12: false })}`
                : ""}
            </p>

            <div className="movers-grid">
              <div>
                <h4 className="subhead">상승 Top</h4>
                <ul className="mover-list">
                  {movers.top.map((c) => (
                    <li key={`t-${c.ticker}`}>
                      <span>{c.ticker}</span>
                      <span className="up">{fmtPct(c.daily_return_pct)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="subhead">하락 Top</h4>
                <ul className="mover-list">
                  {movers.bottom.map((c) => (
                    <li key={`b-${c.ticker}`}>
                      <span>{c.ticker}</span>
                      <span className="down">{fmtPct(c.daily_return_pct)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : null}
      </section>

      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">왜 ETF에 투자할까</h2>
          <p className="feature-lead">
            분산·비용·배분 효과를 최근 5년 실데이터로 풀어봅니다.
          </p>
        </div>

        {(why?.narrative || []).map((block) => (
          <article className="narrative" key={block.heading}>
            <h3>{block.heading}</h3>
            <p>{block.body}</p>
          </article>
        ))}

        {whyLoading ? <p className="empty">비교 차트 계산 중…</p> : null}
        {!whyLoading && why && !why.ok ? (
          <p className="empty warn">{why.error || "인사이트 로드 실패"}</p>
        ) : null}

        <div className="preset-stack">
          {(why?.presets || []).map((preset) => {
            const sim = preset.simulation;
            if (!sim?.ok || !sim.series || !sim.metrics) return null;
            const chartSeries: Record<string, number[]> = {
              Portfolio: sim.series.portfolio as number[],
              [sim.benchmark || "Benchmark"]: sim.series.benchmark as number[],
            };
            return (
              <article className="preset-card" key={preset.id}>
                <h3>{preset.title}</h3>
                <p className="feature-lead">{preset.blurb}</p>
                <div className="stat-row compact">
                  <div className="stat">
                    <span className="stat-label">포트 총수익</span>
                    <span className={`stat-value ${retClass(sim.metrics.portfolio.total_return_pct)}`}>
                      {fmtPct(sim.metrics.portfolio.total_return_pct)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">벤치마크</span>
                    <span className={`stat-value ${retClass(sim.metrics.benchmark.total_return_pct)}`}>
                      {fmtPct(sim.metrics.benchmark.total_return_pct)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">포트 MDD</span>
                    <span className="stat-value down">
                      {fmtPct(sim.metrics.portfolio.max_drawdown_pct)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">벤치 MDD</span>
                    <span className="stat-value down">
                      {fmtPct(sim.metrics.benchmark.max_drawdown_pct)}
                    </span>
                  </div>
                </div>
                <EquityChart dates={sim.series.date} series={chartSeries} height={260} />
                <p className="meta-soft">
                  {sim.start_date} → {sim.end_date} · 초기 $10,000
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

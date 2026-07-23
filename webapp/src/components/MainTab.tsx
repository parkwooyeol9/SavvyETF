"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import EquityChart from "@/components/EquityChart";
import TreemapHeatmap from "@/components/TreemapHeatmap";
import type { HeatmapCell } from "@/lib/heatmap";
import type { SimulateResult } from "@/lib/simulate";

type HeatmapPayload = {
  ok: boolean;
  error?: string;
  source?: string;
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

const TELEGRAM_CHANNELS = [
  {
    id: "us",
    title: "미국시황",
    handle: "@SavvyETF02",
    href: "https://t.me/SavvyETF02",
    accent: "us",
    lines: [
      "07:00 — 미국장 마감 시황",
      "21:00 — WSB 핫토픽",
      "21:50 — 미국 프리마켓 시황",
    ],
  },
  {
    id: "kr",
    title: "국내시황",
    handle: "@SavvyETF01",
    href: "https://t.me/SavvyETF01",
    accent: "kr",
    lines: [
      "08:30 — NXT 거래 흐름",
      "11:00 — 장중 거래대금",
      "15:40 — 장마감 시황",
    ],
  },
  {
    id: "etf",
    title: "ETF시황",
    handle: "@SavvyETF",
    href: "https://t.me/SavvyETF",
    accent: "etf",
    lines: [
      "07:00 — 미국 업종·테마 ETF",
      "07:20 — 미국 신규 상장 ETF",
      "15:40 — 국내 신규 ETF·수급",
      "수시 — ETF 정기변경·편입비",
    ],
  },
  {
    id: "esg",
    title: "ESG에이전트",
    handle: "@SavvyESG",
    href: "https://t.me/SavvyESG",
    accent: "esg",
    lines: [
      "유럽 이상기후·지진 모니터",
      "DART 기반 기업 ESG 모니터",
    ],
  },
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
      const res = await fetch(`/api/heatmap?universe=${u}&top_n=30`, {
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
          <button
            type="button"
            className="chip"
            onClick={() => void loadHeatmap(universe)}
            disabled={heatLoading}
          >
            새로고침
          </button>
        </div>

        {heatLoading ? (
          <div className="skeleton-block" aria-busy>
            <div className="skeleton treemap-skeleton" />
            <p className="empty">히트맵 불러오는 중…</p>
          </div>
        ) : null}

        {!heatLoading && heatmap && !heatmap.ok ? (
          <p className="empty warn">{heatmap.error || "히트맵을 불러오지 못했습니다."}</p>
        ) : null}

        {!heatLoading && heatmap?.ok && heatmap.cells?.length ? (
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

            <TreemapHeatmap cells={heatmap.cells} />

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
                      <span>
                        {c.ticker}
                        <span className="mover-name"> {c.name}</span>
                      </span>
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
                      <span>
                        {c.ticker}
                        <span className="mover-name"> {c.name}</span>
                      </span>
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

      <section className="feature-block tg-channels" aria-labelledby="tg-channels-title">
        <div className="feature-head">
          <h2 className="feature-title" id="tg-channels-title">
            텔레그램 채널
          </h2>
          <p className="feature-lead">
            텔레그램으로 시황을 받아보세요, 업데이트 내용은 본 홈페이지에 실시간
            적재됩니다.
          </p>
        </div>

        <div className="tg-channel-grid">
          {TELEGRAM_CHANNELS.map((ch) => (
            <a
              key={ch.id}
              className={`tg-channel tg-channel--${ch.accent}`}
              href={ch.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="tg-channel-top">
                <span className="tg-channel-title">{ch.title}</span>
                <span className="tg-channel-handle">{ch.handle}</span>
              </div>
              <ul className="tg-channel-lines">
                {ch.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <span className="tg-channel-cta">채널 입장 →</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

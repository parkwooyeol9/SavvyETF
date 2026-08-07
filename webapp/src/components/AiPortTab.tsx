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

import {
  appendAiPortHistory,
  applyIdeasToAiPort,
  defaultAiPort,
  loadAiPort,
  saveAiPort,
  tradesFromAiPortSnapshots,
  type StoredAiPort,
} from "@/lib/aiPortStore";
import { buildIndexedChartSeries } from "@/lib/usPortfolio";
import type { UsPortfolioResult } from "@/lib/usPortfolio";
import type { TradingIdeasPayload } from "@/lib/tradingIdeas";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtUsd(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

export default function AiPortTab() {
  const [store, setStore] = useState<StoredAiPort | null>(null);
  const [ideas, setIdeas] = useState<TradingIdeasPayload | null>(null);
  const [result, setResult] = useState<UsPortfolioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStore(loadAiPort() || defaultAiPort());
  }, []);

  const persist = useCallback((next: StoredAiPort) => {
    setStore(next);
    saveAiPort(next);
  }, []);

  const fetchIdeas = useCallback(async () => {
    const res = await fetch("/api/trading-ideas", { cache: "no-store" });
    return (await res.json()) as TradingIdeasPayload;
  }, []);

  const runSim = useCallback(
    async (s: StoredAiPort) => {
      const trades = tradesFromAiPortSnapshots(s.snapshots);
      if (!trades.length) {
        setError("추종할 아이디어 스냅샷이 없습니다. 먼저 오늘 아이디어를 반영하세요.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/us-portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolio_id: s.portfolio_id,
            name: s.name,
            initial_cash: s.initial_cash,
            trades,
          }),
        });
        const json = (await res.json()) as UsPortfolioResult;
        setResult(json);
        if (!json.ok) {
          setError(json.error || "시뮬레이션 실패");
          return;
        }
        persist(appendAiPortHistory(s, json));
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        setLoading(false);
      }
    },
    [persist],
  );

  const applyToday = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchIdeas();
      setIdeas(payload);
      if (!payload.ok) {
        setError(payload.error || "아이디어 로드 실패");
        return;
      }
      const next = applyIdeasToAiPort(store, payload);
      if (next.snapshots.length === store.snapshots.length) {
        setError("오늘 기준일 아이디어는 이미 반영되어 있습니다. 성과를 다시 계산합니다.");
      }
      persist(next);
      const trades = tradesFromAiPortSnapshots(next.snapshots);
      if (!trades.length) {
        setError("추종할 아이디어 스냅샷이 없습니다. 먼저 오늘 아이디어를 반영하세요.");
        return;
      }
      const res = await fetch("/api/us-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id: next.portfolio_id,
          name: next.name,
          initial_cash: next.initial_cash,
          trades,
        }),
      });
      const json = (await res.json()) as UsPortfolioResult;
      setResult(json);
      if (!json.ok) {
        setError(json.error || "시뮬레이션 실패");
        return;
      }
      persist(appendAiPortHistory(next, json));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, [store, fetchIdeas, persist]);

  const resetPort = () => {
    const fresh = defaultAiPort();
    persist(fresh);
    setResult(null);
    setError(null);
  };

  useEffect(() => {
    void fetchIdeas()
      .then(setIdeas)
      .catch(() => undefined);
  }, [fetchIdeas]);

  const chartPack = useMemo(
    () => buildIndexedChartSeries(result?.series || []),
    [result],
  );

  const latestSnap = store?.snapshots.length
    ? store.snapshots[store.snapshots.length - 1]
    : null;

  if (!store) {
    return <p className="empty">AI포트 불러오는 중…</p>;
  }

  return (
    <div className="panel-stack ai-port">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">AI포트</h2>
            <p className="kr-hero-sub">
              「오늘의 트레이딩 아이디어」를 일자별로 누적 추종했을 때의 성과입니다.
              매일 리밸런싱(전량 교체 후 목표 비중 편입)으로 시뮬레이션합니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <button
              type="button"
              className="tab-btn"
              disabled={loading}
              onClick={() => void applyToday()}
            >
              {loading ? "계산 중…" : "오늘 아이디어 반영·성과"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={loading || !store.snapshots.length}
              onClick={() => void runSim(store)}
            >
              재계산
            </button>
            <button type="button" className="ghost-btn" onClick={resetPort}>
              초기화
            </button>
          </div>
        </div>
        <p className="meta-soft">
          스냅샷 {store.snapshots.length}일 · 기록 {store.history.length}회
          {latestSnap ? ` · 최근 반영 ${latestSnap.as_of}` : ""}
          {ideas?.as_of ? ` · 아이디어 기준 ${ideas.as_of}` : ""}
        </p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {latestSnap ? (
        <section className="geo-section" style={{ marginTop: 12 }}>
          <h3 className="geo-section-title">최근 추종 비중 ({latestSnap.as_of})</h3>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="num">비중</th>
                </tr>
              </thead>
              <tbody>
                {latestSnap.targets.map((t) => (
                  <tr key={t.symbol}>
                    <td>
                      <strong>{t.symbol}</strong>
                      <span className="meta-soft"> · {t.name}</span>
                    </td>
                    <td className="num">{t.weight_pct.toFixed(1)}%</td>
                  </tr>
                ))}
                <tr>
                  <td>현금</td>
                  <td className="num">{latestSnap.cash_pct.toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="geo-section" style={{ marginTop: 12 }}>
          <p className="empty">
            아직 반영된 아이디어가 없습니다. 「오늘 아이디어 반영·성과」를 눌러
            추적을 시작하세요.
          </p>
        </section>
      )}

      {result?.ok ? (
        <>
          <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
            <div className="us-pf-stats">
              <div>
                <span className="meta-soft">누적 수익률</span>
                <strong className={tone(result.cumulative_return_pct)}>
                  {fmtPct(result.cumulative_return_pct)}
                </strong>
              </div>
              <div>
                <span className="meta-soft">SPY 대비</span>
                <strong className={tone(result.excess_vs_spy_pct)}>
                  {fmtPct(result.excess_vs_spy_pct)}
                </strong>
              </div>
              <div>
                <span className="meta-soft">주간</span>
                <strong className={tone(result.week_return_pct)}>
                  {fmtPct(result.week_return_pct)}
                </strong>
              </div>
              <div>
                <span className="meta-soft">MDD</span>
                <strong>{fmtPct(result.max_drawdown_pct)}</strong>
              </div>
              <div>
                <span className="meta-soft">최종 평가액</span>
                <strong>{fmtUsd(result.final_value)}</strong>
              </div>
              <div>
                <span className="meta-soft">현금</span>
                <strong>{fmtUsd(result.cash)}</strong>
              </div>
            </div>
            <p className="meta-soft" style={{ marginTop: 8 }}>
              차트 시작=100 · SPY 매수·보유 대비
            </p>
            <div className="kr-chart" style={{ height: 280, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartPack.data}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={24} />
                  <YAxis
                    domain={chartPack.domain}
                    allowDataOverflow
                    tick={{ fill: "#8fa3b8", fontSize: 10 }}
                    width={52}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="포트폴리오"
                    stroke="#60a5fa"
                    strokeWidth={2.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="SPY"
                    stroke="#94a3b8"
                    strokeWidth={1.6}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {result.risk ? (
            <section className="geo-section" style={{ marginTop: 16 }}>
              <h3 className="geo-section-title">벤치 대비 리스크</h3>
              <div className="us-pf-stats">
                <div>
                  <span className="meta-soft">Vol(연)</span>
                  <strong>{fmtPct(result.risk.volatility_pct)}</strong>
                </div>
                <div>
                  <span className="meta-soft">Beta</span>
                  <strong>
                    {result.risk.beta != null ? result.risk.beta.toFixed(2) : "—"}
                  </strong>
                </div>
                <div>
                  <span className="meta-soft">Alpha(연)</span>
                  <strong className={tone(result.risk.alpha_ann_pct)}>
                    {fmtPct(result.risk.alpha_ann_pct)}
                  </strong>
                </div>
                <div>
                  <span className="meta-soft">IR</span>
                  <strong>
                    {result.risk.information_ratio != null
                      ? result.risk.information_ratio.toFixed(2)
                      : "—"}
                  </strong>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {store.history.length ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">누적 성과 기록</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>기준일</th>
                  <th>누적</th>
                  <th>주간</th>
                  <th>vs SPY</th>
                  <th>Vol</th>
                  <th>MDD</th>
                  <th>평가액</th>
                </tr>
              </thead>
              <tbody>
                {[...store.history].reverse().map((h) => (
                  <tr key={h.as_of}>
                    <td>{h.as_of}</td>
                    <td className={tone(h.cumulative_return_pct)}>
                      {fmtPct(h.cumulative_return_pct)}
                    </td>
                    <td className={tone(h.week_return_pct)}>
                      {fmtPct(h.week_return_pct)}
                    </td>
                    <td className={tone(h.excess_vs_spy_pct)}>
                      {fmtPct(h.excess_vs_spy_pct)}
                    </td>
                    <td>{fmtPct(h.volatility_pct)}</td>
                    <td>{fmtPct(h.max_drawdown_pct)}</td>
                    <td>{fmtUsd(h.final_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {store.snapshots.length ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">반영된 아이디어 일자</h3>
          <p className="meta-soft">
            {store.snapshots.map((s) => s.as_of).join(" · ")}
          </p>
        </section>
      ) : null}
    </div>
  );
}

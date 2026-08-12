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

import type { CryptoPaperPayload } from "@/lib/cryptoPaperTrading";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function fmtKrw(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function actionTone(a: string): string {
  if (a === "buy" || a === "매수") return "up";
  if (a === "sell" || a === "매도") return "down";
  return "";
}

export default function CryptoAiTradingPanel() {
  const [data, setData] = useState<CryptoPaperPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/crypto-paper${q}`);
      const json = (await res.json()) as CryptoPaperPayload;
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
  }, [load]);

  const chartData = useMemo(() => {
    return (data?.equity_curve || []).map((p) => ({
      label: p.date_kst.slice(5),
      portfolio: p.return_pct,
      btc: p.btc_benchmark_return_pct,
    }));
  }, [data]);

  return (
    <section className="geo-section geo-featured" style={{ marginTop: 24 }}>
      <div className="kr-hero">
        <div>
          <h2 className="kr-hero-title">업비트엔진 · 가상자산 AI 트레이딩</h2>
          <p className="kr-hero-sub">
            Upbit KRW 시세·김프·거래량 룰 시그널에 따라 <strong>페이퍼(가상)</strong>{" "}
            매매를 시뮬레이션합니다. 천만원 챌린지 업비트 배분 ₩500만 · 메이저
            BTC/ETH · 김프·USDT · 알트 급등.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button
            type="button"
            className="tab-btn"
            disabled={loading}
            onClick={() => void load(true)}
          >
            {loading ? "갱신 중…" : "시그널·성과 갱신"}
          </button>
        </div>
      </div>

      {data ? (
        <p className="meta-soft">
          {data.schedule_note} · {data.generated_at_display}
          {data.from_cache ? " · 캐시" : " · 틱 반영"}
        </p>
      ) : null}
      {data?.note ? <p className="meta-soft">{data.note}</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}
      {loading && !data ? <p className="empty">불러오는 중…</p> : null}

      {data ? (
        <>
          <div className="us-pf-stats" style={{ marginTop: 12 }}>
            <div>
              <span className="meta-soft">페이퍼 수익률</span>
              <strong className={tone(data.return_pct)}>
                {fmtPct(data.return_pct)}
              </strong>
            </div>
            <div>
              <span className="meta-soft">BTC 보유(벤치)</span>
              <strong className={tone(data.btc_benchmark_return_pct)}>
                {fmtPct(data.btc_benchmark_return_pct)}
              </strong>
            </div>
            <div>
              <span className="meta-soft">BTC 대비</span>
              <strong className={tone(data.excess_vs_btc_pct)}>
                {fmtPct(data.excess_vs_btc_pct)}
              </strong>
            </div>
            <div>
              <span className="meta-soft">MDD</span>
              <strong>{fmtPct(data.max_drawdown_pct)}</strong>
            </div>
            <div>
              <span className="meta-soft">평가액</span>
              <strong>{fmtKrw(data.equity_krw)}</strong>
            </div>
            <div>
              <span className="meta-soft">현금</span>
              <strong>{fmtKrw(data.cash_krw)}</strong>
            </div>
          </div>

          <div className="kr-chart" style={{ height: 260, marginTop: 12 }}>
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="rgba(43,54,72,0.85)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#8fa3b8", fontSize: 10 }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: "#8fa3b8", fontSize: 10 }}
                    width={48}
                    tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="portfolio"
                    name="페이퍼 포트"
                    stroke="#60a5fa"
                    strokeWidth={2.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="btc"
                    name="BTC 벤치"
                    stroke="#fbbf24"
                    strokeWidth={1.6}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty">
                아직 성과 곡선이 없습니다. 「시그널·성과 갱신」을 눌러 첫 틱을
                실행하세요.
              </p>
            )}
          </div>

          <h3 className="geo-section-title" style={{ marginTop: 16 }}>
            전략별 최신 시그널
          </h3>
          <div className="etfdbus-watch">
            {data.signals.map((s) => (
              <article key={s.id} className="etfdbus-watch-card">
                <strong>
                  {s.label} ·{" "}
                  <span className={actionTone(s.action_ko)}>{s.action_ko}</span>
                </strong>
                <span>
                  {s.market} · 목표 {s.target_weight_pct}% / 현재{" "}
                  {s.current_weight_pct}%
                  {s.score != null ? ` · 점수 ${s.score}` : ""}
                </span>
                <span className="meta-soft">{s.reason}</span>
              </article>
            ))}
          </div>

          {data.positions.length ? (
            <>
              <h3 className="geo-section-title" style={{ marginTop: 14 }}>
                보유 포지션 (페이퍼)
              </h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>전략</th>
                      <th>마켓</th>
                      <th>수량</th>
                      <th>평단</th>
                      <th>현재가</th>
                      <th>평가</th>
                      <th>손익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p) => (
                      <tr key={`${p.strategy}-${p.market}`}>
                        <td>{p.strategy}</td>
                        <td>{p.market_label}</td>
                        <td>{p.quantity.toFixed(6)}</td>
                        <td>{fmtKrw(p.avg_price)}</td>
                        <td>{fmtKrw(p.current_price)}</td>
                        <td>{fmtKrw(p.value_krw)}</td>
                        <td className={tone(p.pnl_pct)}>
                          {fmtPct(p.pnl_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {data.recent_trades.length ? (
            <>
              <h3 className="geo-section-title" style={{ marginTop: 14 }}>
                최근 페이퍼 체결 ({data.trade_count}건)
              </h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>시각</th>
                      <th>전략</th>
                      <th>구분</th>
                      <th>마켓</th>
                      <th>가격</th>
                      <th>금액</th>
                      <th>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_trades.map((t) => (
                      <tr key={t.id}>
                        <td className="meta-soft">
                          {t.ts.replace("T", " ").slice(0, 16)}
                        </td>
                        <td>{t.strategy}</td>
                        <td className={actionTone(t.side)}>{t.side}</td>
                        <td>{t.market.replace("KRW-", "")}</td>
                        <td>{fmtKrw(t.price)}</td>
                        <td>{fmtKrw(t.krw)}</td>
                        <td className="meta-soft">{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

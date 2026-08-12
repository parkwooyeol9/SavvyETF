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

import type { ChallengePayload } from "@/lib/challengeEngine";

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

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function actionTone(a: string): string {
  if (a === "buy" || a === "매수") return "up";
  if (a === "sell" || a === "매도") return "down";
  return "";
}

export default function ChallengeTradingPanel() {
  const [data, setData] = useState<ChallengePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/challenge${q}`);
      const json = (await res.json()) as ChallengePayload;
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

  const upbitChart = useMemo(
    () =>
      (data?.upbit.equity_curve || []).map((p) => ({
        label: p.date_kst.slice(5),
        upbit: p.return_pct,
      })),
    [data],
  );

  return (
    <section className="geo-section geo-featured" style={{ marginTop: 24 }}>
      <div className="kr-hero">
        <div>
          <h2 className="kr-hero-title">가상자산 자동매매</h2>
          <p className="kr-hero-sub">
            <strong>업비트엔진</strong> · <strong>바이낸스엔진</strong> · 김프 차익 ·
            TradeFi(XAU/XAG/EWY/MU) · 현재 <strong>페이퍼</strong> 시뮬레이션.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button
            type="button"
            className="tab-btn"
            disabled={loading}
            onClick={() => void load(true)}
          >
            {loading ? "갱신 중…" : "전체 갱신"}
          </button>
        </div>
      </div>

      {data ? (
        <p className="meta-soft">
          {data.note} · {data.generated_at_display}
        </p>
      ) : null}
      {error ? <p className="empty">오류: {error}</p> : null}
      {loading && !data ? <p className="empty">불러오는 중…</p> : null}

      {data ? (
        <>
          <div className="us-pf-stats" style={{ marginTop: 12 }}>
            <div>
              <span className="meta-soft">업비트 수익률</span>
              <strong className={tone(data.upbit.return_pct)}>
                {fmtPct(data.upbit.return_pct)}
              </strong>
            </div>
            <div>
              <span className="meta-soft">바이낸스 수익률</span>
              <strong className={tone(data.binance.return_pct)}>
                {fmtPct(data.binance.return_pct)}
              </strong>
            </div>
            <div>
              <span className="meta-soft">김프 (BTC)</span>
              <strong>{fmtPct(data.kimchi_arb.kimchi_pct)}</strong>
            </div>
            <div>
              <span className="meta-soft">김프 차익</span>
              <strong>{data.kimchi_arb.arb_action_ko}</strong>
            </div>
          </div>

          <div className="kr-grid-2" style={{ marginTop: 16, gap: 16 }}>
            <div className="geo-card">
              <h3>업비트엔진</h3>
              <p className="meta-soft">
                수익률 <strong className={tone(data.upbit.return_pct)}>{fmtPct(data.upbit.return_pct)}</strong>
              </p>
              <ul className="kr-list compact">
                {data.upbit.signals.map((s) => (
                  <li key={s.id}>
                    <span className={actionTone(s.action_ko)}>{s.label}</span>{" "}
                    {s.action_ko} · {s.reason}
                  </li>
                ))}
              </ul>
            </div>
            <div className="geo-card">
              <h3>바이낸스엔진</h3>
              <p className="meta-soft">
                수익률 <strong className={tone(data.binance.return_pct)}>{fmtPct(data.binance.return_pct)}</strong>
              </p>
              <ul className="kr-list compact">
                {data.binance.signals.map((s) => (
                  <li key={s.id}>
                    <span className={actionTone(s.action_ko)}>{s.label}</span>{" "}
                    {s.action_ko} · {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {data.kimchi_arb.legs.length > 0 ? (
            <div className="geo-card" style={{ marginTop: 12 }}>
              <h3>김프 차익 레그 (라이브 시 동시 실행)</h3>
              <ul className="kr-list compact">
                {data.kimchi_arb.legs.map((leg, i) => (
                  <li key={i}>
                    {leg.engine === "upbit" ? "업비트" : "바이낸스"} · {leg.side_ko} ·{" "}
                    {leg.symbol}
                  </li>
                ))}
              </ul>
              <p className="meta-soft">{data.kimchi_arb.reason}</p>
            </div>
          ) : null}

          <div className="kr-chart" style={{ height: 220, marginTop: 12 }}>
            {upbitChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={upbitChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={48} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="upbit"
                    name="업비트엔진 %"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

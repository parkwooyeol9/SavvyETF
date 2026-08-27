"use client";

import { useCallback, useEffect, useState } from "react";

import type { TradingIdea, TradingIdeasPayload } from "@/lib/tradingIdeas";

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function tone(n?: number | null): string {
  if (n == null || Math.abs(n) < 0.05) return "";
  return n > 0 ? "up" : "down";
}

function WeightBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="ka-weight-cell">
      <span>{pct.toFixed(1)}</span>
      <span className="ka-weight-bar" style={{ width: `${Math.min(100, w * 3)}%` }} />
    </div>
  );
}

export default function TradingIdeasTab() {
  const [data, setData] = useState<TradingIdeasPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trading-ideas", { cache: "no-store" });
      const json = (await res.json()) as TradingIdeasPayload;
      setData(json);
      if (!json.ok) setError(json.error || "아이디어 로드 실패");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buys = data?.buys || [];
  const sells = data?.sells || [];
  const cash = data?.ideas.find((i) => i.asset_class === "cash");

  return (
    <div className="panel-stack trading-ideas">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">AI Pick</h2>
            <p className="kr-hero-sub">
              그래프·NLP 시황과 시그널 레짐을 합쳐 매수/매도 후보와 목표 비중을 제안합니다.
              AI포트에서 미국 슬리브 추종 성과를 추적할 수 있습니다.
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
                  new CustomEvent("savvyetf-nav-tab", { detail: "aiport" }),
                );
              }}
            >
              AI포트에서 추종
            </button>
          </div>
        </div>
        <p className="meta-soft">
          {data?.schedule_note || "—"}
          {data?.as_of ? ` · 기준 ${data.as_of}` : ""}
          {data?.generated_at
            ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR", {
                hour12: false,
              })}`
            : ""}
        </p>
        {data?.comment ? <p className="quant-comment">{data.comment}</p> : null}
        {data?.summary?.length ? (
          <ul className="ideas-summary">
            {data.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {data?.risk ? (
        <section className="geo-section" style={{ marginTop: 12 }}>
          <h3 className="geo-section-title">
            리스크 레짐 · {data.risk.regime_ko}
          </h3>
          <p className="meta-soft">
            점수 {data.risk.score} · VIX {data.risk.vix?.toFixed(1) ?? "—"} · HY OAS{" "}
            {data.risk.hy_oas?.toFixed(0) ?? "—"} · SPY 20D{" "}
            {fmtPct(data.risk.spy_20d_pct)} · 제안 현금 {data.cash_pct.toFixed(0)}% ·
            투자 {data.invested_pct.toFixed(0)}%
          </p>
          <p className="meta-soft">{data.risk.drivers.slice(0, 3).join(" · ")}</p>
        </section>
      ) : null}

      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">매수 제안 · 목표 비중</h3>
        <IdeaTable rows={buys} showWeight />
        {cash ? (
          <p className="meta-soft" style={{ marginTop: 8 }}>
            현금 버퍼 <strong>{cash.weight_pct.toFixed(1)}%</strong> —{" "}
            {cash.rationale.join(" · ")}
          </p>
        ) : null}
      </section>

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">매도·회피 후보</h3>
        <IdeaTable rows={sells} showWeight={false} />
      </section>

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

function IdeaTable({
  rows,
  showWeight,
}: {
  rows: TradingIdea[];
  showWeight: boolean;
}) {
  return (
    <div className="table-wrap" style={{ marginTop: 8 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>종목</th>
            <th>유형</th>
            <th>신호</th>
            <th className="num">점수</th>
            {showWeight ? <th className="num">비중</th> : null}
            <th className="num">20D</th>
            <th className="num">vs SPY</th>
            <th>근거</th>
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={showWeight ? 8 : 7} className="empty">
                —
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.action}-${r.symbol}`}>
                <td>
                  <strong>{r.symbol}</strong>
                  <div className="meta-soft">{r.name}</div>
                </td>
                <td>{r.asset_class === "stock" ? "주식" : r.group}</td>
                <td>{r.action_ko}</td>
                <td className="num">{r.score.toFixed(0)}</td>
                {showWeight ? (
                  <td className="num">
                    <WeightBar pct={r.weight_pct} />
                  </td>
                ) : null}
                <td className={`num ${tone(r.change_20d_pct)}`}>
                  {fmtPct(r.change_20d_pct)}
                </td>
                <td className={`num ${tone(r.excess_20d_vs_spy)}`}>
                  {fmtPct(r.excess_20d_vs_spy)}
                </td>
                <td className="meta-soft">{r.rationale.slice(0, 2).join(" · ")}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

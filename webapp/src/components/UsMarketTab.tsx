"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fmtUsPct,
  fmtUsPrice,
  type UsBoard,
  type UsMarketPayload,
  type UsQuoteCard,
} from "@/lib/usMarket";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function toneClass(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function SnapCard({ card }: { card: UsQuoteCard }) {
  return (
    <div className="us-snap">
      <span className="meta-soft">{card.name}</span>
      <strong>{fmtUsPrice(card.last)}</strong>
      <span className={toneClass(card.change_pct)}>
        {fmtUsPct(card.change_pct)}
      </span>
      <span className="meta-soft">
        5D {fmtUsPct(card.change_5d_pct)} · 20D {fmtUsPct(card.change_20d_pct)}
      </span>
    </div>
  );
}

function BoardCard({ board }: { board: UsBoard }) {
  const data = useMemo(
    () =>
      board.daily.map((c) => ({
        t: c.time.slice(5),
        close: c.close,
      })),
    [board.daily],
  );
  const ta = board.technicals;
  const stroke =
    (board.change_pct || 0) >= 0 ? "#34d399" : "#f87171";

  return (
    <article className="kr-card">
      <div className="kr-card-head">
        <div>
          <h3 className="kr-card-title">{board.name}</h3>
          <p className="kr-card-sub">{board.symbol} · Yahoo 일봉</p>
        </div>
        <div className={`kr-quote ${toneClass(board.change_pct)}`}>
          <div className="kr-last">{fmtUsPrice(board.last)}</div>
          <div className="kr-chg">
            {fmtUsPrice(board.change)} ({fmtUsPct(board.change_pct)})
          </div>
        </div>
      </div>

      <div className="kr-chart" style={{ height: 180 }}>
        {!data.length ? (
          <p className="empty">차트 데이터 없음</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tick={{ fill: "#8fa3b8", fontSize: 10 }}
                minTickGap={28}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "#8fa3b8", fontSize: 10 }}
                width={52}
                tickFormatter={(v: number) => fmtUsPrice(v, 0)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: "#8fa3b8" }}
                formatter={(value: number) => [fmtUsPrice(value), "종가"]}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={stroke}
                fill={stroke}
                fillOpacity={0.12}
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="kr-ta-grid">
        <div>
          <span className="kr-ta-label">추세</span>
          <strong>{ta?.regime || "—"}</strong>
        </div>
        <div>
          <span className="kr-ta-label">RSI</span>
          <strong>{ta?.rsi14 != null ? ta.rsi14.toFixed(1) : "—"}</strong>
        </div>
        <div>
          <span className="kr-ta-label">5D</span>
          <strong className={toneClass(board.change_5d_pct)}>
            {fmtUsPct(board.change_5d_pct)}
          </strong>
        </div>
        <div>
          <span className="kr-ta-label">20D</span>
          <strong className={toneClass(board.change_20d_pct)}>
            {fmtUsPct(board.change_20d_pct)}
          </strong>
        </div>
      </div>
    </article>
  );
}

export default function UsMarketTab() {
  const [data, setData] = useState<UsMarketPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/us-market", { cache: "no-store" });
      const json = (await res.json()) as UsMarketPayload;
      if (!json.ok) setError(json.error || "불러오기 실패");
      else setError(null);
      setData(json);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 90_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="kr-tab us-tab">
      <div className="kr-hero">
        <div>
          <h2 className="kr-hero-title">미국 시황 모니터</h2>
          <p className="kr-hero-sub">
            SPY · QQQ 추세와 VIX·금리·달러 등 핵심 자산을 가볍게 정리합니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            disabled={loading}
          >
            {loading ? "불러오는 중…" : "새로고침"}
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">미국 시황 불러오는 중…</p> : null}
      {error ? <p className="empty">{error}</p> : null}

      {data?.ok ? (
        <>
          {(data.interpretation?.length
            ? data.interpretation
            : data.note
              ? [data.note]
              : []
          ).map((line) => (
            <p key={line} className="geo-thesis us-interp-line">
              {line}
            </p>
          ))}

          <div className="us-snap-grid">
            {(data.snaps || []).map((card) => (
              <SnapCard key={card.symbol} card={card} />
            ))}
          </div>

          <div className="kr-grid-2" style={{ marginTop: 12 }}>
            {(data.boards || []).map((board) => (
              <BoardCard key={board.symbol} board={board} />
            ))}
          </div>

          <p className="kr-foot">
            {data.disclaimer}
            {data.as_of ? ` · 기준일 ${data.as_of}` : ""}
            {data.generated_at
              ? ` · 조회 ${new Date(data.generated_at).toLocaleString("ko-KR", {
                  hour12: false,
                })}`
              : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}

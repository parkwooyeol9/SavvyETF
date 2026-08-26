"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Customized,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  NLP_CHART_RANGES,
  type NlpChartBar,
  type NlpChartPayload,
  type NlpChartRange,
} from "@/lib/nlpChart";

function fmtPrice(n: number, currency: "KRW" | "USD"): string {
  if (currency === "KRW") {
    return n >= 1000 ? n.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) : n.toFixed(2);
  }
  return n >= 100 ? n.toFixed(2) : n.toFixed(n >= 10 ? 2 : 3);
}

function fmtVol(n: number, currency: "KRW" | "USD"): string {
  if (currency === "KRW") {
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(1)}만`;
    return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  }
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function OhlcTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: NlpChartBar }>;
  currency: "KRW" | "USD";
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="deriv-tt">
      <strong>{d.label}</strong>
      <div>시 {fmtPrice(d.open, currency)}</div>
      <div>고 {fmtPrice(d.high, currency)}</div>
      <div>저 {fmtPrice(d.low, currency)}</div>
      <div>종 {fmtPrice(d.close, currency)}</div>
      {d.volume != null ? <div>거래량 {fmtVol(d.volume, currency)}</div> : null}
    </div>
  );
}

function makeCandleLayer(rows: NlpChartBar[]) {
  return function CandleLayer(props: {
    offset?: { top: number; left: number; width: number; height: number };
    yAxisMap?: Record<string, { yAxisId?: string | number; scale?: (v: number) => number }>;
  }) {
    const offset = props.offset;
    if (!offset || !rows.length) return null;
    const axes = Object.values(props.yAxisMap || {});
    const yAxis = axes.find((a) => a.yAxisId === "px") || axes[0];
    const yScale = yAxis?.scale;
    const y = (v: number) =>
      yScale
        ? yScale(v)
        : offset.top +
          (1 - (v - rows[0]!.low) / Math.max(rows[0]!.high - rows[0]!.low, 1e-9)) * offset.height;
    const slot = offset.width / rows.length;
    const bodyW = Math.max(1.2, Math.min(9, slot * 0.62));
    return (
      <g className="nlp-candles">
        {rows.map((d, i) => {
          const cx = offset.left + slot * i + slot / 2;
          const up = d.close >= d.open;
          const color = up ? "#34d399" : "#f87171";
          const yO = y(d.open);
          const yC = y(d.close);
          return (
            <g key={`${d.date}-${i}`}>
              <line x1={cx} x2={cx} y1={y(d.high)} y2={y(d.low)} stroke={color} strokeWidth={1} />
              <rect
                x={cx - bodyW / 2}
                y={Math.min(yO, yC)}
                width={bodyW}
                height={Math.max(Math.abs(yC - yO), 1)}
                fill={up ? color : "#1b2738"}
                stroke={color}
                strokeWidth={1}
              />
            </g>
          );
        })}
      </g>
    );
  };
}

export default function NlpPriceChart({
  ticker,
  name,
}: {
  ticker: string;
  name: string;
}) {
  const [range, setRange] = useState<NlpChartRange>("3mo");
  const [data, setData] = useState<NlpChartPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextRange: NlpChartRange, nextTicker: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/nlp-chart?symbol=${encodeURIComponent(nextTicker)}&range=${nextRange}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as NlpChartPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        symbol: nextTicker,
        yahoo_symbol: nextTicker,
        currency: nextTicker.includes(".KS") ? "KRW" : "USD",
        range: nextRange,
        interval_label: "",
        price: null,
        change_pct: null,
        volume: null,
        bars: [],
        range_pct: null,
        error: exc instanceof Error ? exc.message : "차트 로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    void load(range, ticker);
    const ms = range === "1d" || range === "5d" ? 60_000 : 180_000;
    const id = window.setInterval(() => void load(range, ticker), ms);
    return () => window.clearInterval(id);
  }, [load, range, ticker]);

  const bars = data?.bars || [];
  const CandleLayer = useMemo(() => makeCandleLayer(bars), [bars]);
  const currency = data?.currency || (ticker.includes(".KS") ? "KRW" : "USD");
  const maxVol = Math.max(0, ...bars.map((b) => b.volume || 0));
  const volDomain: [number, number] = [0, maxVol > 0 ? maxVol * 3.4 : 1];
  const pxDomain = useMemo<[number, number]>(() => {
    if (!bars.length) return [0, 1];
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of bars) {
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
    }
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1;
    return [lo - pad, hi + pad];
  }, [bars]);

  const chg = data?.change_pct;
  const rng = data?.range_pct;
  const chgClass = chg == null ? "flat" : chg >= 0 ? "up" : "down";
  const rngClass = rng == null ? "flat" : rng >= 0 ? "up" : "down";
  const volTicks = maxVol > 0 ? [0, maxVol / 2, maxVol] : [0];

  return (
    <section className="geo-section nlp-chart-panel">
      <div className="nlp-chart-head">
        <div>
          <h3 className="geo-section-title">
            {name} 라이브 차트
            {data?.interval_label ? <span className="nlp-chart-iv">{data.interval_label}</span> : null}
          </h3>
          <p className="macro-subhead">좌축 주가 · 우축 거래량 · Yahoo 시세</p>
          <p className="nlp-chart-quote">
            {data?.price != null ? (
              <>
                <strong>{currency === "KRW" ? "₩" : "$"}{fmtPrice(data.price, currency)}</strong>
                {chg != null ? (
                  <span className={chgClass}>
                    {chg >= 0 ? "+" : ""}
                    {chg.toFixed(2)}% 일
                  </span>
                ) : null}
                {range !== "1d" && rng != null ? (
                  <span className={rngClass}>
                    {rng >= 0 ? "+" : ""}
                    {rng.toFixed(2)}% 기간
                  </span>
                ) : null}
                {data.volume != null ? (
                  <span className="meta-soft">거래량 {fmtVol(data.volume, currency)}</span>
                ) : null}
              </>
            ) : (
              <span className="meta-soft">{loading ? "시세 불러오는 중…" : "시세 없음"}</span>
            )}
          </p>
        </div>
        <div className="nlp-filters nlp-chart-ranges">
          {NLP_CHART_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`tab-btn sub ${range === r.id ? "active" : ""}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!bars.length ? (
        <p className="empty">{loading ? "차트 수집 중…" : data?.error || "봉 데이터가 없습니다."}</p>
      ) : (
        <div className="geo-chart-wrap nlp-live-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#93a4c3", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                yAxisId="px"
                orientation="left"
                domain={pxDomain}
                width={58}
                tick={{ fill: "#93a4c3", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => fmtPrice(Number(v), currency)}
              />
              <YAxis
                yAxisId="vol"
                orientation="right"
                domain={volDomain}
                ticks={volTicks}
                width={48}
                tick={{ fill: "#93a4c3", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => fmtVol(Number(v), currency)}
              />
              <Tooltip
                content={(props) => (
                  <OhlcTooltip
                    active={props.active}
                    payload={props.payload as Array<{ payload: NlpChartBar }>}
                    currency={currency}
                  />
                )}
              />
              <Bar
                yAxisId="vol"
                dataKey="volume"
                isAnimationActive={false}
              >
                {bars.map((b, i) => (
                  <Cell
                    key={`${b.date}-${i}`}
                    fill={b.close >= b.open ? "rgba(52,211,153,0.32)" : "rgba(248,113,113,0.32)"}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="px"
                type="monotone"
                dataKey="close"
                stroke="transparent"
                strokeWidth={0}
                dot={false}
                activeDot={{ r: 3, fill: "#e8eef5" }}
                isAnimationActive={false}
              />
              <Customized component={CandleLayer} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

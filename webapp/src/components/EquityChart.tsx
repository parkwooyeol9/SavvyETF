"use client";

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

const COLORS = ["#4da3ff", "#fb923c", "#34d399", "#a78bfa", "#f472b6", "#fbbf24", "#94a3b8"];

type Props = {
  dates: string[];
  series: Record<string, number[]>;
  height?: number;
  currency?: "USD" | "KRW";
  /** Index to 100 at start and tighten Y domain for comparison. */
  indexed?: boolean;
};

function formatAxis(v: number, currency: "USD" | "KRW", indexed: boolean): string {
  if (indexed) return v.toFixed(1);
  if (currency === "KRW") {
    if (v >= 1_000_000) return `₩${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
    if (v >= 1000) return `₩${(v / 1000).toFixed(0)}k`;
    return `₩${v}`;
  }
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `$${v}`;
}

function formatTooltip(v: number, currency: "USD" | "KRW", indexed: boolean): string {
  if (indexed) return Number(v).toFixed(2);
  if (currency === "KRW") {
    return `₩${Math.round(v).toLocaleString("ko-KR")}`;
  }
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function EquityChart({
  dates,
  series,
  height = 320,
  currency = "USD",
  indexed = false,
}: Props) {
  const keys = Object.keys(series);
  const bases: Record<string, number> = {};
  for (const k of keys) {
    bases[k] = indexed && series[k]?.[0] ? series[k][0]! : 1;
  }

  const data = dates.map((date, i) => {
    const row: Record<string, string | number> = { date };
    for (const k of keys) {
      const raw = series[k]?.[i] ?? 0;
      row[k] = indexed
        ? Math.round((raw / (bases[k] || 1)) * 10000) / 100
        : raw;
    }
    return row;
  });

  let domain: [number, number] | undefined;
  if (indexed && data.length) {
    let min = Infinity;
    let max = -Infinity;
    for (const row of data) {
      for (const k of keys) {
        const v = Number(row[k]);
        if (Number.isFinite(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    }
    if (max > min) {
      const pad = Math.max((max - min) * 0.06, 0.4);
      domain = [min - pad, max + pad];
    }
  }

  return (
    <div className="chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#8fa3b8", fontSize: 11 }}
            minTickGap={40}
            tickFormatter={(v: string) => (v ? v.slice(2, 7) : "")}
          />
          <YAxis
            domain={domain}
            allowDataOverflow={Boolean(indexed)}
            tick={{ fill: "#8fa3b8", fontSize: 11 }}
            width={indexed ? 52 : currency === "KRW" ? 72 : 64}
            tickFormatter={(v: number) => formatAxis(v, currency, indexed)}
          />
          <Tooltip
            contentStyle={{
              background: "#141d2b",
              border: "1px solid #2b3648",
              borderRadius: 8,
              color: "#e8eef5",
            }}
            labelStyle={{ color: "#8fa3b8" }}
            formatter={(value: number, name: string) => [
              formatTooltip(Number(value), currency, indexed),
              name,
            ]}
          />
          <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
          {keys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              name={k}
              stroke={COLORS[i % COLORS.length]}
              dot={false}
              strokeWidth={k === "portfolio" || k === "Portfolio" || k === "포트폴리오" ? 2.4 : 1.6}
              isAnimationActive={!indexed}
              animationDuration={700}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

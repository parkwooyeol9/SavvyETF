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
};

export default function EquityChart({ dates, series, height = 320 }: Props) {
  const keys = Object.keys(series);
  const data = dates.map((date, i) => {
    const row: Record<string, string | number> = { date };
    for (const k of keys) row[k] = series[k][i];
    return row;
  });

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
            tick={{ fill: "#8fa3b8", fontSize: 11 }}
            width={64}
            tickFormatter={(v: number) =>
              v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${v}`
            }
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
              `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
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
              strokeWidth={k === "portfolio" || k === "Portfolio" ? 2.4 : 1.6}
              isAnimationActive
              animationDuration={700}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

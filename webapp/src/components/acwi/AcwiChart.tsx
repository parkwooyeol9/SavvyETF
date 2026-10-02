"use client";

import { useEffect, useRef, useState } from "react";

import { fmt, isNum } from "@/lib/acwiAnalyzer";

export type ChartSeries = { y: (number | null)[]; color: string; name?: string; w?: number; dash?: string };
export type ChartRef = { y?: number | null; x?: number; label?: string; color?: string };

type Props = {
  x: (string | number)[];
  series: ChartSeries[];
  h?: number;
  yfmt?: (v: number) => string;
  xfmt?: (v: string | number) => string;
  refs?: ChartRef[];
  zeroLine?: boolean;
};

const P = { l: 46, r: 12, t: 10, b: 22 };

/** Dependency-free line chart ported from Claude_DB/web/analyzer.html (hover crosshair + tooltip). */
export default function AcwiChart({ x, series, h = 220, yfmt = (v) => fmt(v, 1), xfmt = (v) => String(v), refs = [], zeroLine = false }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth || 600)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ys = series.flatMap((s) => s.y.filter(isNum));
  refs.forEach((r) => isNum(r.y) && ys.push(r.y));
  if (!ys.length || !x.length) {
    return (
      <div ref={box} className="aa-chart">
        <p className="aa-empty">데이터 없음</p>
      </div>
    );
  }
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (zeroLine) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const H = h;
  const X = (i: number) => P.l + (W - P.l - P.r) * (x.length <= 1 ? 0.5 : i / (x.length - 1));
  const Y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  const nx = Math.min(6, x.length);
  const xTicks = Array.from({ length: nx }, (_, k) => Math.round(((x.length - 1) * k) / Math.max(1, nx - 1)));

  const pathOf = (y: (number | null)[]) => {
    let d = "";
    let pen = false;
    y.forEach((v, i) => {
      if (isNum(v)) {
        d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      } else pen = false;
    });
    return d;
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    setHover(Math.max(0, Math.min(x.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (x.length - 1)))));
  };

  return (
    <div ref={box} className="aa-chart">
      <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 5 }, (_, k) => {
          const v = lo + ((hi - lo) * k) / 4;
          return (
            <g key={k}>
              <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
              <text x={P.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">
                {yfmt(v)}
              </text>
            </g>
          );
        })}
        {zeroLine ? <line x1={P.l} x2={W - P.r} y1={Y(0)} y2={Y(0)} stroke="var(--muted)" /> : null}
        {refs.map((r, i) =>
          isNum(r.y) ? (
            <g key={i}>
              <line x1={P.l} x2={W - P.r} y1={Y(r.y)} y2={Y(r.y)} stroke={r.color ?? "var(--muted)"} strokeDasharray="4 3" />
              <text x={W - P.r} y={Y(r.y) - 3} textAnchor="end" fontSize="10" fill={r.color ?? "var(--muted)"}>
                {r.label}
              </text>
            </g>
          ) : isNum(r.x) ? (
            <g key={i}>
              <line x1={X(r.x)} x2={X(r.x)} y1={P.t} y2={H - P.b} stroke={r.color ?? "var(--muted)"} strokeDasharray="3 3" />
              <text x={X(r.x) + 3} y={P.t + 10} fontSize="10" fill={r.color ?? "var(--muted)"}>
                {r.label}
              </text>
            </g>
          ) : null,
        )}
        {series.map((s, i) => (
          <path
            key={i}
            d={pathOf(s.y)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.w ?? 1.6}
            strokeDasharray={s.dash}
            strokeLinejoin="round"
          />
        ))}
        {xTicks.map((i, k) => (
          <text
            key={k}
            x={X(i)}
            y={H - 6}
            textAnchor={k === 0 ? "start" : k === nx - 1 ? "end" : "middle"}
            fontSize="10"
            fill="var(--muted)"
          >
            {xfmt(x[i])}
          </text>
        ))}
        {hover !== null ? <line x1={X(hover)} x2={X(hover)} y1={P.t} y2={H - P.b} stroke="var(--muted)" /> : null}
      </svg>
      {hover !== null ? (
        <div className="aa-tip" style={{ left: `min(calc(100% - 140px), ${(X(hover) / W) * 100}% + 10px)` }}>
          <div>{xfmt(x[hover])}</div>
          {series.map((s, i) => (
            <div key={i} style={{ color: s.color }}>
              {s.name ?? ""} {isNum(s.y[hover]) ? yfmt(s.y[hover] as number) : "–"}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import {
  finvizColor,
  layoutTreemap,
  type HeatmapCell,
} from "@/lib/heatmap";

type Props = {
  cells: HeatmapCell[];
};

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export default function TreemapHeatmap({ cells }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const rects = useMemo(() => layoutTreemap(cells), [cells]);
  const cap = useMemo(() => {
    const maxAbs = Math.max(...cells.map((c) => Math.abs(c.daily_return_pct)), 0.5);
    return Math.min(6, Math.max(2, maxAbs * 1.05));
  }, [cells]);

  return (
    <div className="treemap-shell">
      <div className="treemap" role="img" aria-label="Market heatmap">
        {rects.map((r) => {
          const area = r.w * r.h;
          const showPct = area > 90;
          const showName = area > 160;
          const active = hover === r.ticker;
          return (
            <button
              key={r.ticker}
              type="button"
              className={`treemap-tile ${active ? "active" : ""}`}
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                width: `${Math.max(r.w - 0.25, 0)}%`,
                height: `${Math.max(r.h - 0.25, 0)}%`,
                background: finvizColor(r.daily_return_pct, cap),
              }}
              title={`${r.ticker} ${r.name} ${fmtPct(r.daily_return_pct)}`}
              onMouseEnter={() => setHover(r.ticker)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.ticker)}
              onBlur={() => setHover(null)}
            >
              <span className="tile-ticker">{r.ticker}</span>
              {showPct ? <span className="tile-pct">{fmtPct(r.daily_return_pct)}</span> : null}
              {showName ? <span className="tile-name">{r.name}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="treemap-legend" aria-hidden>
        <span>−{cap.toFixed(1)}%</span>
        <div className="treemap-legend-bar" />
        <span>+{cap.toFixed(1)}%</span>
      </div>
      {hover ? (
        <p className="treemap-hover">
          {(() => {
            const c = cells.find((x) => x.ticker === hover);
            if (!c) return null;
            return (
              <>
                <strong>{c.ticker}</strong> {c.name} · {fmtPct(c.daily_return_pct)}
              </>
            );
          })()}
        </p>
      ) : (
        <p className="treemap-hover muted">타일에 마우스를 올리면 상세가 보입니다.</p>
      )}
    </div>
  );
}

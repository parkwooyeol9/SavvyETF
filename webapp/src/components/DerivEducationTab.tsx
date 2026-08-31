"use client";

import { useId, type ReactNode } from "react";

import {
  DERIV_EDU_DISCLAIMER,
  DERIV_EDU_SECTIONS,
  PAYOFF_INK,
  type PayoffFigure,
  type PayoffPt,
} from "@/lib/derivPayoff";

const VW = 700;
const VH = 420;
const PAD = { l: 58, r: 16, t: 16, b: 40 };

function ticks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const err = raw / pow;
  const step = (err <= 1.5 ? 1 : err <= 3 ? 2 : err <= 7 ? 5 : 10) * pow;
  const start = Math.ceil((min - 1e-9) / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-8; v += step) out.push(Number(v.toFixed(8)));
  return out;
}

function linePath(
  pts: PayoffPt[],
  x: (v: number) => number,
  y: (v: number) => number,
): string {
  return pts
    .map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`)
    .join(" ");
}

function signedFills(
  pts: PayoffPt[],
  x: (v: number) => number,
  y: (v: number) => number,
): { pos: string; neg: string } {
  const pos: string[] = [];
  const neg: string[] = [];
  const quad = (x0: number, y0: number, x1: number, y1: number) =>
    `M${x(x0).toFixed(2)},${y(0).toFixed(2)} L${x(x0).toFixed(2)},${y(y0).toFixed(2)} L${x(x1).toFixed(2)},${y(y1).toFixed(2)} L${x(x1).toFixed(2)},${y(0).toFixed(2)} Z`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.y === 0 && b.y === 0) continue;
    if (a.y >= 0 && b.y >= 0) {
      pos.push(quad(a.x, a.y, b.x, b.y));
    } else if (a.y <= 0 && b.y <= 0) {
      neg.push(quad(a.x, a.y, b.x, b.y));
    } else {
      const t = a.y / (a.y - b.y);
      const zx = a.x + t * (b.x - a.x);
      if (a.y > 0) {
        pos.push(quad(a.x, a.y, zx, 0));
        neg.push(quad(zx, 0, b.x, b.y));
      } else {
        neg.push(quad(a.x, a.y, zx, 0));
        pos.push(quad(zx, 0, b.x, b.y));
      }
    }
  }
  return { pos: pos.join(" "), neg: neg.join(" ") };
}

function PayoffChart({ figure }: { figure: PayoffFigure }) {
  const uid = useId().replace(/:/g, "");
  const clip = `payoff-clip-${uid}`;
  const plotW = VW - PAD.l - PAD.r;
  const plotH = VH - PAD.t - PAD.b;
  const x = (v: number) =>
    PAD.l + ((v - figure.xMin) / (figure.xMax - figure.xMin)) * plotW;
  const y = (v: number) =>
    PAD.t + (1 - (v - figure.yMin) / (figure.yMax - figure.yMin)) * plotH;
  const xt = ticks(figure.xMin, figure.xMax, 4);
  const yt = ticks(figure.yMin, figure.yMax, 4);
  const yZero = figure.yMin < 0 && figure.yMax > 0 ? 0 : null;
  const legend = figure.legend
    ? figure.series.filter((s) => s.label)
    : [];

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`${figure.title_en}. ${figure.caption}`}
    >
      <rect width={VW} height={VH} fill={PAYOFF_INK.paper} />
      <defs>
        <clipPath id={clip}>
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} />
        </clipPath>
      </defs>

      {figure.bands?.map((b) => {
        const x0 = x(Math.max(b.x0, figure.xMin));
        const x1 = x(Math.min(b.x1, figure.xMax));
        return (
          <g key={`${b.x0}-${b.x1}`}>
            <rect
              x={x0}
              y={PAD.t}
              width={Math.max(0, x1 - x0)}
              height={plotH}
              fill={b.fill}
              clipPath={`url(#${clip})`}
            />
            {b.label ? (
              <text
                x={(x0 + x1) / 2}
                y={PAD.t + 16}
                textAnchor="middle"
                fill={PAYOFF_INK.muted}
                fontSize={18}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {b.label}
              </text>
            ) : null}
          </g>
        );
      })}

      <g clipPath={`url(#${clip})`}>
        {figure.series.map((s) => {
          const fills = s.fill ? signedFills(s.points, x, y) : null;
          return (
          <g key={s.id}>
            {fills ? (
              <>
                <path d={fills.pos} fill="rgba(37, 99, 235, 0.12)" />
                <path d={fills.neg} fill="rgba(17, 17, 17, 0.06)" />
              </>
            ) : null}
            <path
              d={linePath(s.points, x, y)}
              fill="none"
              stroke={s.color}
              strokeWidth={(s.width ?? 1.8) * 1.7}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
          );
        })}
      </g>

      {yZero != null ? (
        <line
          x1={PAD.l}
          x2={PAD.l + plotW}
          y1={y(0)}
          y2={y(0)}
          stroke="#c5c9d1"
          strokeWidth={1.2}
        />
      ) : null}

      <rect
        x={PAD.l}
        y={PAD.t}
        width={plotW}
        height={plotH}
        fill="none"
        stroke={PAYOFF_INK.axis}
        strokeWidth={1.15}
      />

      {xt.map((v) => (
        <text
          key={`tx-${v}`}
          x={x(v)}
          y={PAD.t + plotH + 22}
          textAnchor="middle"
          fill={PAYOFF_INK.muted}
          fontSize={18}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {v}
        </text>
      ))}
      {yt.map((v) => (
        <text
          key={`ty-${v}`}
          x={PAD.l - 8}
          y={y(v) + 6}
          textAnchor="end"
          fill={PAYOFF_INK.muted}
          fontSize={18}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {v}
        </text>
      ))}

      <text
        x={PAD.l + plotW / 2}
        y={VH - 6}
        textAnchor="middle"
        fill={PAYOFF_INK.muted}
        fontSize={18}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {figure.xLabel}
      </text>
      <text
        x={16}
        y={PAD.t + plotH / 2}
        textAnchor="middle"
        fill={PAYOFF_INK.muted}
        fontSize={18}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        transform={`rotate(-90 16 ${PAD.t + plotH / 2})`}
      >
        {figure.yLabel}
      </text>

      {figure.marks?.map((m, i) => {
        if (m.x != null) {
          const px = x(m.x);
          const top = m.edge === "bottom";
          return (
            <g key={`mx-${i}`}>
              <line
                x1={px}
                x2={px}
                y1={PAD.t}
                y2={PAD.t + plotH}
                stroke="#c5c9d1"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={px + 4}
                y={top ? PAD.t + plotH - 8 : PAD.t + 16}
                fill={PAYOFF_INK.muted}
                fontSize={16}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {m.label}
              </text>
            </g>
          );
        }
        if (m.y != null) {
          const py = y(m.y);
          const right = m.edge === "right";
          return (
            <g key={`my-${i}`}>
              <line
                x1={PAD.l}
                x2={PAD.l + plotW}
                y1={py}
                y2={py}
                stroke="#c5c9d1"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={right ? PAD.l + plotW - 6 : PAD.l + 6}
                y={py - 5}
                textAnchor={right ? "end" : "start"}
                fill={PAYOFF_INK.muted}
                fontSize={16}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {m.label}
              </text>
            </g>
          );
        }
        return null;
      })}

      {legend.length ? (
        <g transform={`translate(${PAD.l + 10}, ${PAD.t + 12})`}>
          {legend.map((s, i) => (
            <g key={s.id} transform={`translate(0, ${i * 20})`}>
              <line
                x1={0}
                x2={22}
                y1={8}
                y2={8}
                stroke={s.color}
                strokeWidth={3.2}
                strokeDasharray={s.dash}
              />
              <text
                x={28}
                y={12}
                fill={PAYOFF_INK.axis}
                fontSize={17}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {s.label}
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  );
}

function ElsBarrierSchematic() {
  const pad = { l: 52, r: 18, t: 22, b: 38 };
  const plotW = VW - pad.l - pad.r;
  const plotH = VH - pad.t - pad.b;
  const tMax = 36;
  const yMin = 42;
  const yMax = 118;
  const tx = (m: number) => pad.l + (m / tMax) * plotW;
  const ty = (p: number) => pad.t + (1 - (p - yMin) / (yMax - yMin)) * plotH;
  const obs = [6, 12, 18, 24, 30, 36];
  const ac = [90, 90, 85, 80, 75, 70];
  const pathA = [
    [0, 100],
    [4, 97],
    [8, 99],
    [12, 103],
  ];
  const pathB = [
    [0, 100],
    [5, 86],
    [9, 70],
    [13, 52],
    [18, 58],
    [26, 66],
    [36, 73],
  ];
  const d = (pts: number[][]) =>
    pts
      .map((p, i) => `${i ? "L" : "M"}${tx(p[0]).toFixed(1)},${ty(p[1]).toFixed(1)}`)
      .join(" ");

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      height="100%"
      role="img"
      aria-label="ELS step-down autocall barrier schematic with knock-in path"
    >
      <rect width={VW} height={VH} fill={PAYOFF_INK.paper} />
      <rect
        x={pad.l}
        y={ty(55)}
        width={plotW}
        height={ty(yMin) - ty(55)}
        fill={PAYOFF_INK.bandWine}
      />
      <text
        x={pad.l + 8}
        y={ty(48)}
        fill={PAYOFF_INK.wine}
        fontSize={16}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Knock-in 55%
      </text>

      {[55, 100].map((p) => (
        <text
          key={p}
          x={pad.l - 8}
          y={ty(p) + 5}
          textAnchor="end"
          fill={PAYOFF_INK.muted}
          fontSize={18}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {p}
        </text>
      ))}

      {obs.map((m, i) => (
        <g key={m}>
          <line
            x1={i === 0 ? tx(0) : tx(obs[i - 1])}
            x2={tx(m)}
            y1={ty(ac[i])}
            y2={ty(ac[i])}
            stroke={PAYOFF_INK.navy}
            strokeWidth={1.7}
          />
          <text
            x={tx(m) - 4}
            y={ty(ac[i]) - 6}
            textAnchor="end"
            fill={PAYOFF_INK.navy}
            fontSize={15}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            AC {ac[i]}
          </text>
          <text
            x={tx(m)}
            y={pad.t + plotH + 22}
            textAnchor="middle"
            fill={PAYOFF_INK.muted}
            fontSize={18}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            {m === 36 ? "T" : `${m}m`}
          </text>
        </g>
      ))}

      <path
        d={d(pathB)}
        fill="none"
        stroke={PAYOFF_INK.wine}
        strokeWidth={2.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={d(pathA)}
        fill="none"
        stroke={PAYOFF_INK.navy}
        strokeWidth={2.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={tx(12)} cy={ty(103)} r={5} fill={PAYOFF_INK.navy} />
      <text
        x={tx(12) + 8}
        y={ty(103) - 8}
        fill={PAYOFF_INK.navy}
        fontSize={16}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Autocall
      </text>
      <circle cx={tx(13)} cy={ty(52)} r={4.5} fill={PAYOFF_INK.wine} />
      <text
        x={tx(16)}
        y={ty(52) + 16}
        fill={PAYOFF_INK.wine}
        fontSize={16}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        KI
      </text>

      <rect
        x={pad.l}
        y={pad.t}
        width={plotW}
        height={plotH}
        fill="none"
        stroke={PAYOFF_INK.axis}
        strokeWidth={1.35}
      />
      <text
        x={pad.l + plotW / 2}
        y={VH - 6}
        textAnchor="middle"
        fill={PAYOFF_INK.muted}
        fontSize={18}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        관측 시점 (월)
      </text>
      <text
        x={14}
        y={pad.t + plotH / 2}
        textAnchor="middle"
        fill={PAYOFF_INK.muted}
        fontSize={18}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        transform={`rotate(-90 14 ${pad.t + plotH / 2})`}
      >
        S / S₀ (%)
      </text>
      <g transform={`translate(${pad.l + 10}, ${pad.t + 10})`}>
        <line x1={0} x2={20} y1={7} y2={7} stroke={PAYOFF_INK.navy} strokeWidth={3} />
        <text x={26} y={11} fill={PAYOFF_INK.axis} fontSize={16} fontFamily="ui-sans-serif, system-ui, sans-serif">
          조기상환 경로
        </text>
        <line x1={0} x2={20} y1={27} y2={27} stroke={PAYOFF_INK.wine} strokeWidth={3} />
        <text x={26} y={31} fill={PAYOFF_INK.axis} fontSize={16} fontFamily="ui-sans-serif, system-ui, sans-serif">
          KI 후 만기
        </text>
      </g>
    </svg>
  );
}

function FigurePlate({
  fig,
  title,
  titleEn,
  caption,
  children,
}: {
  fig: string;
  title: string;
  titleEn: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="deriv-edu-fig">
      <div className="deriv-edu-fig-head">
        <span className="deriv-edu-fig-no">Fig. {fig}</span>
        <div>
          <h4>{title}</h4>
          <em>{titleEn}</em>
        </div>
      </div>
      <div className="deriv-edu-plate">{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default function DerivEducationTab() {
  return (
    <div className="edu-tab deriv-edu-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">파생 페이오프 도판</h2>
          <p className="feature-lead">
            보고서용 규격(7.0 × 4.2 cm)으로 만기 손익을 그렸습니다. 커버드콜 ETF
            세대부터 버퍼, 오토콜·ELS, 옵션 블록, 선물 헤지 순입니다. 가로축은
            기초자산 가격(S₀=100), 세로축은 포인트 손익입니다.
          </p>
        </div>
        <p className="edu-disclaimer">{DERIV_EDU_DISCLAIMER}</p>
        <nav className="chip-row deriv-edu-toc" aria-label="도판 목차">
          {DERIV_EDU_SECTIONS.map((s) => (
            <a key={s.id} className="chip" href={`#${s.id}`}>
              {s.kicker}. {s.title.split("·")[0].trim()}
            </a>
          ))}
        </nav>
      </section>

      {DERIV_EDU_SECTIONS.map((section) => (
        <section className="feature-block deriv-edu-section" key={section.id} id={section.id}>
          <div className="feature-head">
            <p className="deriv-edu-kicker">Section {section.kicker}</p>
            <h2 className="feature-title">{section.title}</h2>
            <p className="feature-lead">{section.lead}</p>
          </div>

          {section.table ? (
            <div className="contrib-table-wrap">
              <table className="contrib-table edu-table">
                <thead>
                  <tr>
                    {section.table.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.table.rows.map((row, i) => (
                    <tr key={`${section.id}-r${i}`}>
                      {row.map((cell, j) => (
                        <td key={`${section.id}-${i}-${j}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="deriv-edu-atlas">
            {section.figures.map((figure) => (
              <FigurePlate
                key={figure.id}
                fig={figure.fig}
                title={figure.title}
                titleEn={figure.title_en}
                caption={figure.caption}
              >
                <PayoffChart figure={figure} />
              </FigurePlate>
            ))}
            {section.schematic === "els-barrier" ? (
              <FigurePlate
                fig="09"
                title="스텝다운 배리어 경로"
                titleEn="Step-down autocall · barrier paths"
                caption="수평선은 관측일마다 내려가는 조기상환 장벽. 청록 경로는 12개월에 상환, 적갈 경로는 배리어를 깨고 만기 73으로 1:1 정산된다."
              >
                <ElsBarrierSchematic />
              </FigurePlate>
            ) : null}
          </div>

          {section.bullets?.length ? (
            <ul className="edu-list">
              {section.bullets.map((b) => (
                <li key={b.slice(0, 48)}>{b}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

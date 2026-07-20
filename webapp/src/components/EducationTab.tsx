"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  EDUCATION_DISCLAIMER,
  EDUCATION_SECTIONS,
} from "@/lib/educationContent";

type FxPayload = {
  ok: boolean;
  error?: string;
  label?: string;
  range?: string;
  spot?: number;
  day_change_pct?: number;
  range_change_pct?: number;
  high?: number;
  low?: number;
  generated_at?: string;
  series?: Array<{ date: string; close: number }>;
};

const RANGES = [
  { id: "1mo", label: "1개월" },
  { id: "3mo", label: "3개월" },
  { id: "6mo", label: "6개월" },
  { id: "1y", label: "1년" },
  { id: "5y", label: "5년" },
] as const;

function fmtPct(n?: number): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function retClass(n?: number): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

export default function EducationTab() {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1y");
  const [fx, setFx] = useState<FxPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/fx?range=${range}`, { cache: "no-store" });
        const data = (await res.json()) as FxPayload;
        if (!cancelled) setFx(data);
      } catch (exc) {
        if (!cancelled) {
          setFx({
            ok: false,
            error: exc instanceof Error ? exc.message : "환율 로드 실패",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const mid = useMemo(() => {
    if (!fx?.high || !fx?.low) return null;
    return (fx.high + fx.low) / 2;
  }, [fx]);

  return (
    <div className="edu-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">한국 투자자를 위한 ETF 교육</h2>
          <p className="feature-lead">
            세금·계좌·환율을 한곳에서 정리했습니다. 원화·달러 계좌를 같이 운용할 때
            환전 타이밍이 배분의 일부가 됩니다.
          </p>
        </div>
        <p className="edu-disclaimer">{EDUCATION_DISCLAIMER}</p>
      </section>

      <section className="feature-block" id="fx-chart">
        <div className="feature-head">
          <h2 className="feature-title">원/달러 환율</h2>
          <p className="feature-lead">
            달러가 비싸지면(원/달러 ↑) 원화 쪽 국내상장 해외ETF·분할 환전을, 달러가
            싸지면(원/달러 ↓) 달러 환전 후 해당국 ETF 적립을 검토하는 식으로 활용하세요.
          </p>
        </div>

        <div className="chip-row">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`chip ${range === r.id ? "active" : ""}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {loading ? <p className="empty">환율 불러오는 중…</p> : null}
        {!loading && fx && !fx.ok ? (
          <p className="empty warn">{fx.error || "환율을 불러오지 못했습니다."}</p>
        ) : null}

        {!loading && fx?.ok && fx.series ? (
          <>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">현재</span>
                <span className="stat-value">
                  {fx.spot?.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">전일 대비</span>
                <span className={`stat-value ${retClass(fx.day_change_pct)}`}>
                  {fmtPct(fx.day_change_pct)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">기간 변화</span>
                <span className={`stat-value ${retClass(fx.range_change_pct)}`}>
                  {fmtPct(fx.range_change_pct)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">기간 고가 / 저가</span>
                <span className="stat-value">
                  {fx.high?.toFixed(1)} / {fx.low?.toFixed(1)}
                </span>
              </div>
            </div>

            <div className="chart-wrap" style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={fx.series}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#8fa3b8", fontSize: 11 }}
                    minTickGap={40}
                    tickFormatter={(v: string) => (v ? v.slice(2, 7) : "")}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fill: "#8fa3b8", fontSize: 11 }}
                    width={56}
                    tickFormatter={(v: number) => `${Math.round(v)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#141d2b",
                      border: "1px solid #2b3648",
                      borderRadius: 8,
                      color: "#e8eef5",
                    }}
                    formatter={(value: number) => [
                      `${Number(value).toLocaleString("ko-KR", {
                        maximumFractionDigits: 2,
                      })}원`,
                      "원/달러",
                    ]}
                  />
                  {mid ? (
                    <ReferenceLine
                      y={mid}
                      stroke="#8fa3b8"
                      strokeDasharray="4 4"
                      label={{
                        value: "기간 중간",
                        fill: "#8fa3b8",
                        fontSize: 11,
                        position: "insideTopRight",
                      }}
                    />
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="close"
                    name="원/달러"
                    stroke="#4da3ff"
                    dot={false}
                    strokeWidth={2.2}
                    isAnimationActive
                    animationDuration={700}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="meta-soft">
              Yahoo Finance · USDKRW=X
              {fx.generated_at
                ? ` · ${new Date(fx.generated_at).toLocaleString("ko-KR", { hour12: false })}`
                : ""}
            </p>

            <div className="fx-playbook">
              <article>
                <h4>달러 고평가 구간 (원/달러 높음)</h4>
                <p>
                  급환전을 줄이고, 원화로 매수 가능한 국내상장 해외ETF나 환헤지(H)
                  비중·분할 환전을 검토합니다.
                </p>
              </article>
              <article>
                <h4>달러 저평가 구간 (원/달러 낮음)</h4>
                <p>
                  여유 원화를 달러로 나눠 환전해 미국 등 해당국 ETF 적립 여력을
                  확보합니다.
                </p>
              </article>
            </div>
          </>
        ) : null}
      </section>

      {EDUCATION_SECTIONS.map((section) => (
        <section className="feature-block" key={section.id} id={section.id}>
          <div className="feature-head">
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

          {section.bullets?.length ? (
            <ul className="edu-list">
              {section.bullets.map((b) => (
                <li key={b.slice(0, 48)}>{b}</li>
              ))}
            </ul>
          ) : null}

          {section.callout ? <p className="edu-callout">{section.callout}</p> : null}
        </section>
      ))}
    </div>
  );
}

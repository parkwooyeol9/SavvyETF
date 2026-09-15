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

import {
  AI_ETF_KIND_KO,
  emptyAiEtfPayload,
  type AiEtfKind,
  type AiEtfPayload,
  type AiEtfQuote,
} from "@/lib/aiEtf";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
  fontSize: 11,
};

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtAum(mn: number): string {
  if (mn >= 1000) return `$${(mn / 1000).toFixed(1)}B`;
  return `$${mn.toFixed(0)}M`;
}

function fmtVol(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M주`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K주`;
  return `${Math.round(n)}주`;
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function kindClass(kind: AiEtfKind): string {
  if (kind === "nlp") return "aietf-k-nlp";
  if (kind === "factor_ml") return "aietf-k-ml";
  if (kind === "value_ai") return "aietf-k-val";
  return "aietf-k-theme";
}

function verdict(excess?: number | null): { label: string; cls: string } {
  if (excess == null) return { label: "데이터 없음", cls: "flat" };
  if (excess >= 1) return { label: "벤치 상회", cls: "up" };
  if (excess <= -1) return { label: "벤치 하회", cls: "down" };
  return { label: "벤치 근접", cls: "flat" };
}

function overlaySeries(row: AiEtfQuote) {
  const benchByDate = new Map(row.bench_series.map((p) => [p.date, p.close]));
  const points: { label: string; fund: number; bench: number }[] = [];
  let fund0: number | undefined;
  let bench0: number | undefined;
  for (const p of row.series) {
    const bClose = benchByDate.get(p.date);
    if (bClose == null) continue;
    if (fund0 == null) {
      fund0 = p.close;
      bench0 = bClose;
    }
    if (!fund0 || !bench0) continue;
    points.push({
      label: p.label,
      fund: Math.round((p.close / fund0) * 10000) / 100,
      bench: Math.round((bClose / bench0) * 10000) / 100,
    });
  }
  return points;
}

export default function AiEtfTab() {
  const [data, setData] = useState<AiEtfPayload>(() => emptyAiEtfPayload());
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string>("buzz");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-etf");
      const json = (await res.json()) as AiEtfPayload;
      setData(json);
    } catch (exc) {
      setData(emptyAiEtfPayload(exc instanceof Error ? exc.message : "로드 실패"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = useMemo(() => [...data.process, ...data.theme], [data]);
  const selected =
    all.find((r) => r.id === picked) ||
    data.process.find((r) => r.id === "buzz") ||
    data.process[0];

  const chartRows = useMemo(() => (selected ? overlaySeries(selected) : []), [selected]);

  return (
    <div className="themeetf-tab poli-tab aietf-tab">
      <section className="feature-block">
        <div className="feature-head">
          <div>
            <h2 className="feature-title">AI ETF</h2>
            <p className="feature-lead">
              BUZZ처럼 텍스트 감성으로 종목을 고르거나, QRFT처럼 딥러닝으로 대형주를 피킹한다고
              내세우는 상품을 모았습니다. AI 반도체·로봇을 담는 테마 ETF는 아래 비교표에만
              두었습니다.
            </p>
          </div>
          <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
            {loading ? "시세 중…" : "새로고침"}
          </button>
        </div>
        <p className="themeetf-note">{data.note}</p>
        {data.error ? <p className="empty warn">{data.error}</p> : null}
      </section>

      <section className="feature-block">
        <h3 className="feature-title">프로세스형 — NLP · AI 종목피킹</h3>
        <p className="feature-lead">
          AUM 큰 순, 같으면 당일 거래량. 1년 초과는 각 상품이 내세운 벤치 대비 Yahoo 종가입니다.
          QRFT는 2026-07 청산됐지만 대표 사례라 남겨 두었습니다.
        </p>
        <FundTable rows={data.process} picked={picked} onPick={setPicked} showBench />
      </section>

      <section className="feature-block">
        <h3 className="feature-title">한눈에 보는 기술 · 벤치 대비 성과</h3>
        <p className="feature-lead">
          같은 ‘AI ETF’라도 엔진이 다릅니다. 1년 초과 ±1%p를 상회/하회 기준으로 봤습니다.
        </p>
        <div className="poli-pipe-table-wrap">
          <table className="poli-pipe-table themeetf-compare aietf-table">
            <thead>
              <tr>
                <th>티커</th>
                <th>활용 기술</th>
                <th>벤치</th>
                <th>1년</th>
                <th>벤치 1년</th>
                <th>초과</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              {data.process.map((row) => {
                const v = verdict(row.excess_1y_pct);
                return (
                  <tr
                    key={`score-${row.id}`}
                    data-active={picked === row.id ? "1" : "0"}
                    onClick={() => setPicked(row.id)}
                  >
                    <td>
                      <strong>{row.symbol}</strong>
                      {row.closed ? <div className="themeetf-sub">청산</div> : null}
                    </td>
                    <td>
                      <span className={`aietf-tag ${kindClass(row.kind)}`}>{AI_ETF_KIND_KO[row.kind]}</span>
                      <div className="themeetf-sub">{row.tech_ko}</div>
                    </td>
                    <td>{row.bench}</td>
                    <td className={retClass(row.change_1y_pct)}>{fmtPct(row.change_1y_pct)}</td>
                    <td className={retClass(row.bench_1y_pct)}>{fmtPct(row.bench_1y_pct)}</td>
                    <td className={retClass(row.excess_1y_pct)}>{fmtPct(row.excess_1y_pct)}</td>
                    <td className={v.cls}>{v.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="aietf-lenses">
          {data.lenses.map((lens) => (
            <article key={lens.id} className={`aietf-lens ${kindClass(lens.kind)}`}>
              <header>
                <em>{AI_ETF_KIND_KO[lens.kind]}</em>
                <h4>{lens.title}</h4>
              </header>
              <p>{lens.summary}</p>
              <div className="aietf-lens-funds">
                {lens.funds.map((sym) => {
                  const row = all.find((r) => r.symbol === sym);
                  return (
                    <button
                      key={sym}
                      type="button"
                      className={picked === row?.id ? "active" : ""}
                      onClick={() => row && setPicked(row.id)}
                    >
                      {sym}
                      {row?.excess_1y_pct != null ? (
                        <span className={retClass(row.excess_1y_pct)}>
                          {fmtPct(row.excess_1y_pct)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="aietf-lens-score">{lens.score_ko}</p>
            </article>
          ))}
        </div>
      </section>

      {selected ? (
        <section className="feature-block">
          <h3 className="feature-title">
            {selected.symbol} · {selected.name_ko}
            {selected.closed ? <span className="aietf-closed"> 청산</span> : null}
            {selected.change_1y_pct != null ? (
              <span className={retClass(selected.change_1y_pct)}> {fmtPct(selected.change_1y_pct)} 1년</span>
            ) : null}
          </h3>
          <p className="feature-lead">
            {selected.method_ko} 벤치 {selected.bench}
            {selected.excess_1y_pct != null
              ? ` · 1년 초과 ${fmtPct(selected.excess_1y_pct)}`
              : ""}
            . 차트는 겹치는 첫날=100.
          </p>
          <p className="aietf-tech">
            <strong>기술</strong> {selected.tech_ko}
          </p>
          <p className="aietf-tech">
            <strong>읽기</strong> {selected.read_ko}
          </p>
          {selected.closed_note ? <p className="aietf-tech">{selected.closed_note}</p> : null}
          {chartRows.length < 2 ? (
            <p className="empty">{loading ? "차트 불러오는 중…" : "1년 시세가 없습니다."}</p>
          ) : (
            <div className="geo-chart-wrap aietf-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#93a4c3", fontSize: 10 }} minTickGap={28} />
                  <YAxis
                    tick={{ fill: "#93a4c3", fontSize: 10 }}
                    width={42}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) => [
                      typeof value === "number" ? value.toFixed(1) : value,
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="fund"
                    name={`${selected.symbol} (100)`}
                    stroke="#4da3ff"
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bench"
                    name={`${selected.bench} (100)`}
                    stroke="#94a3b8"
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      ) : null}

      <section className="feature-block">
        <h3 className="feature-title">참고 — AI를 담는 테마 ETF</h3>
        <p className="feature-lead">
          운용에 NLP가 들어가지 않습니다. 규모·거래만 보면 ‘유명한 AI ETF’는 대개 이쪽입니다.
        </p>
        <FundTable rows={data.theme} picked={picked} onPick={setPicked} showBench />
      </section>

      <section className="feature-block">
        <h3 className="feature-title">결론</h3>
        <ul className="ideas-summary">
          {data.takeaways.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="kr-foot">
          {data.generated_at
            ? new Date(data.generated_at).toLocaleString("ko-KR", {
                hour12: false,
                timeZone: "Asia/Seoul",
              })
            : ""}
          {data.process[0]?.aum_as_of ? ` · AUM 기준 ${data.process[0].aum_as_of}` : ""}
          · 투자 권유가 아닙니다
        </p>
      </section>
    </div>
  );
}

function FundTable({
  rows,
  picked,
  onPick,
  showBench,
}: {
  rows: AiEtfQuote[];
  picked: string;
  onPick: (id: string) => void;
  showBench?: boolean;
}) {
  if (!rows.length) return <p className="empty">표시할 종목이 없습니다.</p>;
  return (
    <div className="poli-pipe-table-wrap">
      <table className="poli-pipe-table themeetf-compare aietf-table">
        <thead>
          <tr>
            <th>티커</th>
            <th>상품</th>
            <th>유형</th>
            <th>AUM</th>
            <th>보수</th>
            <th>거래량</th>
            <th>1년</th>
            {showBench ? <th>벤치 1년</th> : null}
            {showBench ? <th>초과</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-active={picked === row.id ? "1" : "0"}
              onClick={() => onPick(row.id)}
            >
              <td>
                <strong>{row.symbol}</strong>
                <div className="themeetf-sub">{row.closed ? "청산" : row.issuer}</div>
              </td>
              <td>
                {row.name_ko}
                <div className="themeetf-sub">{row.name}</div>
              </td>
              <td>
                <span className={`aietf-tag ${kindClass(row.kind)}`}>{AI_ETF_KIND_KO[row.kind]}</span>
              </td>
              <td>
                {fmtAum(row.aum_usd_mn)}
                <div className="themeetf-sub">{row.aum_as_of}</div>
              </td>
              <td>{row.expense}</td>
              <td>{fmtVol(row.volume)}</td>
              <td className={retClass(row.change_1y_pct)}>{fmtPct(row.change_1y_pct)}</td>
              {showBench ? (
                <td className={retClass(row.bench_1y_pct)}>
                  {fmtPct(row.bench_1y_pct)}
                  <div className="themeetf-sub">{row.bench}</div>
                </td>
              ) : null}
              {showBench ? (
                <td className={retClass(row.excess_1y_pct)}>{fmtPct(row.excess_1y_pct)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

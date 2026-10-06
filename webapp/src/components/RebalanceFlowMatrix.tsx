"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ExcelButton from "@/components/ExcelButton";
import { unverifiedText, type RebalancePayload } from "@/lib/rebalance";
import { buildFlowMatrix, nextCycleRange } from "@/lib/rebalanceMatrix";

const DATE_COLORS = ["#4f9cf7", "#f5a524", "#3dd68c", "#c084fc", "#ff6b6b", "#22c3d6"];
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

function md(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const w = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${iso.slice(5).replace("-", "/")}(${WEEK[w]})`;
}

function eok(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  if (r === 0) return "0";
  return `${signed && r > 0 ? "+" : ""}${r.toLocaleString("ko-KR")}`;
}

function tone(v: number | null | undefined): string {
  if (v == null || Math.abs(v) < 0.5) return "";
  return v > 0 ? "tone-up" : "tone-down";
}

function ratioClass(r: number | null): string {
  if (r == null) return "meta-soft";
  if (r >= 0.1) return "tone-down";
  if (r >= 0.03) return "rb-warn";
  return "";
}

type Props = {
  data: RebalancePayload;
  choice: Record<string, string>;
  today: string;
  onExcel: () => Promise<void>;
};

/** 일자 × ETF × 종목 예상 수급: 차트 2개 + 종목×일자 표 + ETF×일자 표 + 일정 단계 표. */
export default function RebalanceFlowMatrix({ data, choice, today, onExcel }: Props) {
  const [topN, setTopN] = useState(15);
  const [splitDays, setSplitDays] = useState(1);
  const [scope, setScope] = useState<"cycle" | "all">("cycle");
  const cycle = useMemo(() => nextCycleRange(data, today), [data, today]);
  const m = useMemo(
    () => buildFlowMatrix(data, choice, scope === "cycle" && cycle ? cycle : { from: today }),
    [data, choice, today, scope, cycle],
  );
  const broker = data.broker_estimates?.[0];
  const dates = m.dates;
  const color = (i: number) => DATE_COLORS[i % DATE_COLORS.length];

  const top = m.stocks.slice(0, topN);
  const stockChart = top.map((s) => ({
    name: s.name,
    ...Object.fromEntries(dates.map((d) => [d, Math.round(s.byDate[d] || 0)])),
  }));
  const etfChart = m.etfs.map((e) => ({
    name: `${e.name.replace(/^(TIGER|SOL|KODEX|RISE|ACE|PLUS|HANARO)\s*/, "")}${e.split ? ` ${e.split}` : ""}`,
    date: e.date,
    매수: Math.round(e.buy),
    매도: Math.round(e.sell),
  }));
  const etfMeta = new Map(data.etfs.map((e) => [e.code, e]));
  const stageRows = data.etfs
    .filter((e) => e.next_trade_date && e.next_trade_date >= today && e.kind === "etf")
    .sort((a, b) => (a.next_trade_date as string).localeCompare(b.next_trade_date as string) || (b.aum_eok ?? 0) - (a.aum_eok ?? 0));

  if (!dates.length) {
    return (
      <section className="geo-section geo-featured">
        <h3 className="geo-section-title">일자·ETF·종목별 예상 수급</h3>
        <p className="empty">앞으로 계산된 정기변경 매매가 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="geo-section geo-featured rb-matrix">
      <div className="ka-hero">
        <div>
          <h3 className="geo-section-title">일자·ETF·종목별 예상 수급</h3>
          <p className="geo-thesis">
            앞으로의 매매일 {dates.map(md).join(" · ")} 를 한 번에 봅니다. 금액 = ETF 순자산 × (목표 − 현재 비중), 억원.
            지수 방법론 원문(선정일·비중 확정일·개편일)과 위에서 고른 시나리오 기준.
          </p>
        </div>
        <ExcelButton onClick={onExcel} />
      </div>

      <div className="rb-scen rb-matrix-ctl">
        <label title="이번 정기변경 = 오늘 이후 첫 매매일부터 30일">
          기간{" "}
          <select value={scope} onChange={(e: ChangeEvent<HTMLSelectElement>) => setScope(e.target.value as "cycle" | "all")}>
            <option value="cycle">이번 정기변경</option>
            <option value="all">전체 일정</option>
          </select>
        </label>
        <label>
          종목 수{" "}
          <select value={topN} onChange={(e: ChangeEvent<HTMLSelectElement>) => setTopN(Number(e.target.value))}>
            {[10, 15, 20, 30].map((n) => (
              <option key={n} value={n}>
                상위 {n}
              </option>
            ))}
          </select>
        </label>
        <label title="운용사가 여러 날에 나눠 매매한다고 가정하면 하루 충격은 1/n">
          분할 매매일수{" "}
          <select value={splitDays} onChange={(e: ChangeEvent<HTMLSelectElement>) => setSplitDays(Number(e.target.value))}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}일
              </option>
            ))}
          </select>
        </label>
        <span className="meta-soft">
          {dates.map((d) => {
            const t = m.totalsByDate[d];
            return `${md(d)} ETF ${t.etfs}개 매수 ${eok(t.buy)}억`;
          }).join(" · ")}
        </span>
      </div>

      <h4 className="rb-sub">종목별 순매매 (매매일별 누적)</h4>
      <div className="rb-matrix-chart" style={{ height: Math.max(260, top.length * 26 + 60) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stockChart} layout="vertical" stackOffset="sign" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="#2b3648" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => `${v.toLocaleString("ko-KR")}`} />
            <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 12 }} />
            <ReferenceLine x={0} stroke="#8fa3b8" />
            <Tooltip
              formatter={(v: number, key: string) => [`${eok(v)}억`, md(key)]}
              contentStyle={{ background: "#141c27", border: "1px solid #2b3648" }}
            />
            <Legend formatter={(key: string) => `${md(key)} 매매`} />
            {dates.map((d, i) => (
              <Bar key={d} dataKey={d} stackId="s" fill={color(i)} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="table-wrap">
        <table className="data-table rb-num-table rb-matrix-table">
          <thead>
            <tr>
              <th>종목</th>
              {dates.map((d, i) => (
                <th key={d} style={{ borderBottom: `2px solid ${color(i)}` }}>
                  {md(d)}
                </th>
              ))}
              <th>합계</th>
              <th title="20일 평균 거래대금">거래대금</th>
              <th title={`매매일 중 최대 |순매매| ÷ 20일 평균 거래대금 ÷ 분할일수(${splitDays}일)`}>최대 충격</th>
              {broker ? <th title={`${broker.source} (${broker.date})`}>증권사 추정</th> : null}
            </tr>
          </thead>
          <tbody>
            {top.map((s) => {
              const r = s.maxRatio == null ? null : s.maxRatio / splitDays;
              return (
                <tr key={s.code}>
                  <td>
                    {s.name} <span className="meta-soft">{s.code}</span>
                  </td>
                  {dates.map((d) => (
                    <td key={d} className={tone(s.byDate[d])}>
                      {s.byDate[d] ? eok(s.byDate[d]) : ""}
                    </td>
                  ))}
                  <td className={tone(s.total)}>
                    <strong>{eok(s.total)}</strong>
                  </td>
                  <td className="meta-soft">{s.adv ? Math.round(s.adv).toLocaleString("ko-KR") : "—"}</td>
                  <td className={ratioClass(r)}>{r == null ? "—" : `${(r * 100).toFixed(0)}%`}</td>
                  {broker ? <td className={tone(s.broker)}>{s.broker == null ? "" : eok(s.broker)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {broker ? (
        <p className="meta-soft">
          증권사 추정: {broker.source} ({broker.date}) · {broker.basis}. 우리 추정과 기준일·가정이 달라 합산하지 마세요. 특히
          TIGER 반도체TOP10 을 '종목당 Cap 25%'로 본 보고서와 달리 우리는 방법론의 'TOP2 각 25% 고정'을 적용해 SK하이닉스
          매수가 크고 소부장은 매수가 아닌 매도로 나옵니다.
        </p>
      ) : null}

      <h4 className="rb-sub">ETF별 매수·매도 규모</h4>
      <div className="rb-matrix-chart" style={{ height: Math.max(220, etfChart.length * 34 + 60) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={etfChart} layout="vertical" stackOffset="sign" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="#2b3648" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => `${v.toLocaleString("ko-KR")}`} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
            <ReferenceLine x={0} stroke="#8fa3b8" />
            <Tooltip
              formatter={(v: number, key: string) => [`${eok(v)}억`, key]}
              labelFormatter={(label: string, p: { payload?: { date?: string } }[]) =>
                `${label} · ${p?.[0]?.payload?.date ? md(p[0].payload.date) : ""}`
              }
              contentStyle={{ background: "#141c27", border: "1px solid #2b3648" }}
            />
            <Legend />
            <Bar dataKey="매수" stackId="e" fill="#3dd68c" />
            <Bar dataKey="매도" stackId="e" fill="#ff6b6b" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h4 className="rb-sub">일정 단계 · 방법론 근거</h4>
      <div className="table-wrap">
        <table className="data-table rb-num-table">
          <thead>
            <tr>
              <th>ETF</th>
              <th>순자산</th>
              <th>종목 선정</th>
              <th>비중 확정</th>
              <th>매매(종가)</th>
              <th>개편(효력)</th>
              <th title="AUM × 1%p — 규칙을 몰라도 규모 감">1%p 민감도</th>
              <th>예상 매수</th>
              <th>근거</th>
            </tr>
          </thead>
          <tbody>
            {stageRows.map((e) => {
              const f = m.etfs.filter((x) => x.code === e.code);
              const buy = f.reduce((a, x) => a + x.buy, 0);
              const cycleExpiry = data.events.find(
                (ev) => ev.etf_code === e.code && ev.trade_date === e.next_trade_date,
              )?.expiry;
              const split = data.events.filter(
                (ev) => ev.etf_code === e.code && ev.split && cycleExpiry && ev.expiry === cycleExpiry,
              );
              return (
                <tr key={e.code}>
                  <td>
                    {e.name} <span className="meta-soft">{e.code}</span>
                    {e.unverified?.length ? <div className="meta-soft">확인 필요: {unverifiedText(e.unverified)}</div> : null}
                  </td>
                  <td>{e.aum_eok ? `${Math.round(e.aum_eok).toLocaleString("ko-KR")}억` : "—"}</td>
                  <td>{e.selection_date ? md(e.selection_date) : <span className="meta-soft">미확인</span>}</td>
                  <td>{e.weight_fix_date ? md(e.weight_fix_date) : <span className="meta-soft">미확인</span>}</td>
                  <td>
                    {split.length > 1 ? split.map((x) => md(x.trade_date)).join(" + ") : md(e.next_trade_date as string)}
                  </td>
                  <td>{e.next_effective ? md(e.next_effective) : "—"}</td>
                  <td className="meta-soft">{e.aum_eok ? `${Math.round(e.aum_eok / 100).toLocaleString("ko-KR")}억` : "—"}</td>
                  <td>{f.length ? `${eok(buy, false)}억` : <span className="meta-soft">미계산</span>}</td>
                  <td>
                    {e.method_source ? (
                      <a href={e.method_source.url} target="_blank" rel="noreferrer">
                        {e.method_source.label}
                      </a>
                    ) : (
                      <span className="meta-soft">{etfMeta.get(e.code)?.rule_label || "규칙 추정"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="meta-soft">
        비중 확정일 종가로 목표 비중이 정해지고 매매일 종가에 집행된다고 봅니다. 계산은 최근 보유비중(PDF) 기준이라 비중 확정일까지
        주가가 움직인 만큼 금액이 달라집니다. 종목 편입·편출은 반영하지 않았습니다(편출 종목은 보유분 전량 매도). 레버리지·커버드콜·액티브
        ETF와 규칙 미확인 ETF는 계산하지 않습니다. 추정치이며 투자 권유가 아닙니다.
      </p>
    </section>
  );
}

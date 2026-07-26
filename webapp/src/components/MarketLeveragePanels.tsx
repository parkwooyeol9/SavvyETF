"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fmtKrwEok,
  fmtPct,
  fmtValueEok,
  type SingleStockLevBoard,
} from "@/lib/krMarket";
import type { MarketLeveragePayload } from "@/lib/marketLeverage";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function CreditPanel({
  credit,
}: {
  credit: NonNullable<MarketLeveragePayload["credit"]>;
}) {
  const chartData = useMemo(
    () =>
      credit.rows.slice(-40).map((r) => ({
        t: r.date.slice(5),
        예탁금: r.customer_deposit,
        신용잔고: r.credit_balance,
        신용비율: r.credit_ratio ?? null,
      })),
    [credit.rows],
  );
  const deltaData = useMemo(
    () =>
      credit.rows.slice(-40).map((r) => ({
        t: r.date.slice(5),
        신용증감: r.credit_balance_delta ?? 0,
        예탁증감: r.customer_deposit_delta ?? 0,
      })),
    [credit.rows],
  );
  const latest = credit.latest;

  return (
    <article className="kr-card">
      <div className="kr-card-head">
        <div>
          <h3 className="kr-card-title">신용 · 증시자금</h3>
          <p className="kr-card-sub">
            좌축 고객예탁금 · 우축 신용융자잔고 (억원) — 단위 차이 반영
          </p>
        </div>
        {latest ? (
          <div className="kr-credit-kpis">
            <div>
              <span>예탁금</span>
              <strong>
                {fmtKrwEok(latest.customer_deposit).replace("+", "")}
              </strong>
            </div>
            <div>
              <span>신용잔고</span>
              <strong>
                {fmtKrwEok(latest.credit_balance).replace("+", "")}
              </strong>
            </div>
            <div>
              <span>신용/예탁</span>
              <strong>{fmtPct(credit.credit_ratio_proxy, 2)}</strong>
            </div>
            <div>
              <span>신용 전일비</span>
              <strong
                className={
                  (latest.credit_balance_delta ?? 0) > 0
                    ? "up"
                    : (latest.credit_balance_delta ?? 0) < 0
                      ? "down"
                      : "flat"
                }
              >
                {fmtKrwEok(latest.credit_balance_delta)}
              </strong>
            </div>
          </div>
        ) : null}
      </div>

      <div className="kr-chart" style={{ height: 260 }}>
        {!chartData.length ? (
          <p className="empty">신용 데이터가 없습니다.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
              <YAxis
                yAxisId="left"
                orientation="left"
                tick={{ fill: "#a78bfa", fontSize: 10 }}
                width={58}
                tickFormatter={(v: number) =>
                  v >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${Math.round(v / 1000)}천`
                }
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "#f472b6", fontSize: 10 }}
                width={52}
                tickFormatter={(v: number) => `${Math.round(v / 1000)}천`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [
                  `${Number(value).toLocaleString("ko-KR")}억`,
                  name === "예탁금" ? "예탁금 (좌)" : "신용잔고 (우)",
                ]}
              />
              <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="예탁금"
                name="예탁금 (좌)"
                stroke="#a78bfa"
                strokeWidth={2.2}
                dot={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="신용잔고"
                name="신용잔고 (우)"
                stroke="#f472b6"
                strokeWidth={2.2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="kr-card-head" style={{ marginTop: 12 }}>
        <div>
          <h4 className="kr-card-title" style={{ fontSize: 14 }}>
            신용잔고 · 예탁금 일별 증감
          </h4>
          <p className="kr-card-sub">전일 대비 증감 (억원) — 레버리지 유입·유출 속도</p>
        </div>
      </div>
      <div className="kr-chart" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={deltaData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
            <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={48} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number, name: string) => [
                `${Number(value).toLocaleString("ko-KR")}억`,
                name,
              ]}
            />
            <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
            <Bar dataKey="신용증감" fill="#f472b6" radius={[2, 2, 0, 0]} />
            <Bar dataKey="예탁증감" fill="#a78bfa" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="kr-card-head" style={{ marginTop: 12 }}>
        <div>
          <h4 className="kr-card-title" style={{ fontSize: 14 }}>
            신용/예탁 비율
          </h4>
          <p className="kr-card-sub">신용융자잔고 ÷ 고객예탁금 (%)</p>
        </div>
      </div>
      <div className="kr-chart" style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
            <YAxis
              tick={{ fill: "#8fa3b8", fontSize: 10 }}
              width={40}
              tickFormatter={(v: number) => `${v.toFixed(1)}`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number) => [`${Number(value).toFixed(2)}%`, "신용/예탁"]}
            />
            <Line
              type="monotone"
              dataKey="신용비율"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {latest ? (
        <div className="kr-fund-row">
          <span>주식형 펀드 {fmtKrwEok(latest.fund_stock).replace("+", "")}</span>
          <span>혼합형 {fmtKrwEok(latest.fund_mixed).replace("+", "")}</span>
          <span>채권형 {fmtKrwEok(latest.fund_bond).replace("+", "")}</span>
          <span>기준일 {latest.date}</span>
        </div>
      ) : null}
    </article>
  );
}

function ProgramPanel({
  program,
}: {
  program: NonNullable<MarketLeveragePayload["program_kospi"]>;
}) {
  const chartData = useMemo(
    () =>
      program.rows.slice(-40).map((r) => ({
        t: r.date.slice(5),
        차익: r.arb_net,
        비차익: r.nonarb_net,
        전체: r.total_net,
      })),
    [program.rows],
  );
  const latest = program.latest;

  return (
    <article className="kr-card">
      <div className="kr-card-head">
        <div>
          <h3 className="kr-card-title">코스피 프로그램매매</h3>
          <p className="kr-card-sub">
            차익·비차익·전체 순매수 (억원) — 선물·현물 연동 레버리지성 수급
          </p>
        </div>
        {latest ? (
          <div className="kr-credit-kpis">
            <div>
              <span>전체 순매수</span>
              <strong
                className={
                  latest.total_net > 0 ? "up" : latest.total_net < 0 ? "down" : "flat"
                }
              >
                {fmtKrwEok(latest.total_net)}
              </strong>
            </div>
            <div>
              <span>차익</span>
              <strong className={latest.arb_net > 0 ? "up" : latest.arb_net < 0 ? "down" : "flat"}>
                {fmtKrwEok(latest.arb_net)}
              </strong>
            </div>
            <div>
              <span>비차익</span>
              <strong
                className={
                  latest.nonarb_net > 0 ? "up" : latest.nonarb_net < 0 ? "down" : "flat"
                }
              >
                {fmtKrwEok(latest.nonarb_net)}
              </strong>
            </div>
            <div>
              <span>기준일</span>
              <strong>{latest.date}</strong>
            </div>
          </div>
        ) : null}
      </div>
      <div className="kr-chart" style={{ height: 260 }}>
        {!chartData.length ? (
          <p className="empty">프로그램매매 데이터가 없습니다.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
              <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={52} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [
                  `${Number(value).toLocaleString("ko-KR")}억`,
                  name,
                ]}
              />
              <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
              <Bar dataKey="차익" fill="#60a5fa" radius={[2, 2, 0, 0]} />
              <Bar dataKey="비차익" fill="#34d399" radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="전체" stroke="#fbbf24" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="kr-table-note">
        출처: 네이버 증권 프로그램매매 일별(코스피). 단위 억원.
      </p>
    </article>
  );
}

function SingleStockLevPanel({ board }: { board: SingleStockLevBoard }) {
  const [valueMode, setValueMode] = useState<"cum" | "daily">("cum");

  const aumChart = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const g of board.groups) {
      for (const pt of g.series) {
        const row = byDate.get(pt.date) || { t: pt.date.slice(5) };
        row[g.key] = Math.round(pt.aum_eok);
        byDate.set(pt.date, row);
      }
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, row]) => row);
  }, [board.groups]);

  const valueChart = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const g of board.groups) {
      for (const pt of g.series) {
        const row = byDate.get(pt.date) || { t: pt.date.slice(5) };
        row[g.key] = Math.round(
          valueMode === "cum" ? pt.value_cum_eok : pt.value_eok,
        );
        byDate.set(pt.date, row);
      }
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, row]) => row);
  }, [board.groups, valueMode]);

  return (
    <article className="kr-card">
      <div className="kr-card-head">
        <div>
          <h3 className="kr-card-title">단일종목 레버리지 · 4유형 합산</h3>
          <p className="kr-card-sub">
            전자 2x · 전자 -2x · 닉스 -2x · 닉스 2x · {board.listing_date} 상장~
            누적 AUM·거래대금 추이
            {board.as_of
              ? ` · ${new Date(board.as_of).toLocaleString("ko-KR", { hour12: false })}`
              : ""}
          </p>
        </div>
      </div>

      <div className="kr-flow-summary kr-lev-group-summary">
        {board.groups.map((g) => (
          <div key={g.key}>
            <span style={{ color: g.color }}>{g.label}</span>
            <strong>{fmtValueEok(g.latest_aum_eok)}</strong>
            <em>
              당일 {fmtValueEok(g.latest_value_eok)} · 누적{" "}
              {fmtValueEok(g.value_cum_eok)}
            </em>
          </div>
        ))}
      </div>

      <div className="kr-flow-summary">
        <div>
          <span>합산 AUM</span>
          <strong>{fmtValueEok(board.total_aum_eok)}</strong>
        </div>
        <div>
          <span>당일 거래대금</span>
          <strong>{fmtValueEok(board.total_value_eok)}</strong>
        </div>
        <div>
          <span>상장일~ 누적 거래대금</span>
          <strong>{fmtValueEok(board.total_value_cum_eok)}</strong>
        </div>
      </div>

      <div className="kr-card-head" style={{ marginTop: 8 }}>
        <div>
          <h4 className="kr-card-title" style={{ fontSize: 14 }}>
            유형별 AUM 추이
          </h4>
          <p className="kr-card-sub">좌축 2x · 우축 -2x (단위: 억)</p>
        </div>
      </div>
      <div className="kr-chart" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={aumChart} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={24} />
            <YAxis
              yAxisId="left"
              tick={{ fill: "#8fa3b8", fontSize: 10 }}
              width={52}
              tickFormatter={(v: number) =>
                v >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${v}`
              }
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#c4a574", fontSize: 10 }}
              width={48}
              tickFormatter={(v: number) =>
                v >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${v}`
              }
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number, name: string) => {
                const g = board.groups.find((x) => x.key === name);
                return [`${Number(value).toLocaleString("ko-KR")}억`, g?.label || name];
              }}
            />
            <Legend
              formatter={(value: string) =>
                board.groups.find((g) => g.key === value)?.label || value
              }
            />
            {board.groups.map((g) => (
              <Line
                key={g.key}
                yAxisId={g.direction === "inv" ? "right" : "left"}
                type="monotone"
                dataKey={g.key}
                stroke={g.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="kr-card-head" style={{ marginTop: 12 }}>
        <h4 className="kr-card-title" style={{ fontSize: 14 }}>
          유형별 거래대금 추이
        </h4>
        <div className="kr-toggles">
          <div className="seg">
            <button
              type="button"
              className={valueMode === "cum" ? "active" : ""}
              onClick={() => setValueMode("cum")}
            >
              누적
            </button>
            <button
              type="button"
              className={valueMode === "daily" ? "active" : ""}
              onClick={() => setValueMode("daily")}
            >
              일별
            </button>
          </div>
        </div>
      </div>
      <div className="kr-chart" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={valueChart} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={24} />
            <YAxis
              tick={{ fill: "#8fa3b8", fontSize: 10 }}
              width={52}
              tickFormatter={(v: number) =>
                v >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${v}`
              }
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number, name: string) => {
                const g = board.groups.find((x) => x.key === name);
                const label = valueMode === "cum" ? "누적 거래대금" : "일별 거래대금";
                return [
                  `${Number(value).toLocaleString("ko-KR")}억`,
                  `${g?.label || name} ${label}`,
                ];
              }}
            />
            <Legend
              formatter={(value: string) =>
                board.groups.find((g) => g.key === value)?.label || value
              }
            />
            {board.groups.map((g) => (
              <Line
                key={g.key}
                type="monotone"
                dataKey={g.key}
                stroke={g.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="kr-table-note">
        {board.note ||
          "16개 상품을 4유형으로 합산한 추이입니다. AUM은 시가총액 기준입니다."}
      </p>
    </article>
  );
}

export default function MarketLeveragePanels({
  data,
  loading,
  error,
}: {
  data: MarketLeveragePayload | null;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <section className="lev-market-leverage">
      <div className="kr-card-head" style={{ marginBottom: 8 }}>
        <div>
          <h3 className="kr-card-title">시장 레버리지 현황</h3>
          <p className="kr-card-sub">
            신용융자·증시자금 · 프로그램매매 · 단일종목 레버리지 ETF 합산 · KRX
            거래일 16:00 스냅샷
          </p>
        </div>
      </div>

      {loading && !data ? (
        <p className="empty">시장 레버리지 지표 불러오는 중…</p>
      ) : null}
      {error ? <p className="empty">레버리지 지표: {error}</p> : null}
      {data && !data.ok ? (
        <p className="empty">레버리지 지표 로드 실패: {data.error || "unknown"}</p>
      ) : null}

      {data?.ok ? (
        <>
          {data.credit ? <CreditPanel credit={data.credit} /> : null}
          {data.program_kospi ? (
            <ProgramPanel program={data.program_kospi} />
          ) : null}
          {data.single_stock_lev ? (
            <SingleStockLevPanel board={data.single_stock_lev} />
          ) : null}
          {data.note ? <p className="kr-table-note">{data.note}</p> : null}
        </>
      ) : null}
    </section>
  );
}

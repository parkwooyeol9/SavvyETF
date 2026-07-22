"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
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
  fmtNum,
  fmtPct,
  type KrMarketPayload,
} from "@/lib/krMarket";

type ChartMode = "intraday" | "daily";
type FlowMarket = "kospi" | "kosdaq";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function toneClass(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function IndexCard({
  title,
  subtitle,
  board,
  mode,
}: {
  title: string;
  subtitle?: string;
  board: NonNullable<KrMarketPayload["kospi200"]>;
  mode: ChartMode;
}) {
  const q = board.quote;
  const series = useMemo(() => {
    if (mode === "intraday") {
      return board.intraday.map((c) => ({
        t: c.time.slice(11, 16) || c.time,
        close: c.close,
      }));
    }
    return board.daily.slice(-90).map((c) => ({
      t: c.time.slice(5),
      close: c.close,
      sma20: null as number | null,
    }));
  }, [board, mode]);

  // Overlay SMA20 on daily
  const dailyWithMa = useMemo(() => {
    if (mode !== "daily") return series;
    const closes = board.daily.slice(-90).map((c) => c.close);
    return board.daily.slice(-90).map((c, i, arr) => {
      const start = Math.max(0, i - 19);
      const window = closes.slice(start, i + 1);
      const sma20 =
        window.length >= 20
          ? window.reduce((a, b) => a + b, 0) / window.length
          : null;
      return { t: c.time.slice(5), close: c.close, sma20 };
    });
  }, [board, mode, series]);

  const data = mode === "daily" ? dailyWithMa : series;
  const ta = board.technicals;

  return (
    <article className="kr-card">
      <div className="kr-card-head">
        <div>
          <h3 className="kr-card-title">{title}</h3>
          {subtitle ? <p className="kr-card-sub">{subtitle}</p> : null}
        </div>
        <div className={`kr-quote ${toneClass(q.change)}`}>
          <div className="kr-last">{fmtNum(q.last, 2)}</div>
          <div className="kr-chg">
            {fmtNum(q.change, 2)} ({fmtPct(q.change_pct)})
          </div>
          {q.market_status ? (
            <div className="kr-status">{q.market_status}</div>
          ) : null}
        </div>
      </div>

      <div className="kr-chart" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fill: "#8fa3b8", fontSize: 10 }}
              width={56}
              tickFormatter={(v: number) => fmtNum(v, v >= 1000 ? 0 : 1)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: "#8fa3b8" }}
              formatter={(value: number, name: string) => [
                fmtNum(value, 2),
                name === "sma20" ? "SMA20" : "종가",
              ]}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke="#4da3ff"
              fill="rgba(77,163,255,0.12)"
              strokeWidth={2}
              dot={false}
              isAnimationActive
              animationDuration={600}
            />
            {mode === "daily" ? (
              <Line
                type="monotone"
                dataKey="sma20"
                stroke="#fb923c"
                strokeWidth={1.4}
                dot={false}
                connectNulls
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="kr-ta-grid">
        <div>
          <span className="kr-ta-label">추세</span>
          <strong>{ta.regime || "—"}</strong>
        </div>
        <div>
          <span className="kr-ta-label">RSI(14)</span>
          <strong className={toneClass((ta.rsi14 ?? 50) - 50)}>
            {fmtNum(ta.rsi14, 1)}
          </strong>
        </div>
        <div>
          <span className="kr-ta-label">MACD</span>
          <strong className={toneClass(ta.macd_hist)}>
            {fmtNum(ta.macd, 2)}
          </strong>
        </div>
        <div>
          <span className="kr-ta-label">SMA20/60</span>
          <strong>
            {fmtNum(ta.sma20, 1)} / {fmtNum(ta.sma60, 1)}
          </strong>
        </div>
      </div>
    </article>
  );
}

function FlowPanel({
  data,
  market,
  mode,
  onMarket,
  onMode,
}: {
  data: NonNullable<KrMarketPayload["flows"]>;
  market: FlowMarket;
  mode: ChartMode;
  onMarket: (m: FlowMarket) => void;
  onMode: (m: ChartMode) => void;
}) {
  const points = useMemo(() => {
    if (mode === "intraday") {
      const src =
        market === "kospi" ? data.kospi_intraday : data.kosdaq_intraday;
      return src.map((p) => ({
        t: p.time,
        개인: p.individual,
        외국인: p.foreign,
        기관: p.institution,
      }));
    }
    const src = market === "kospi" ? data.kospi_daily : data.kosdaq_daily;
    return src.slice(-20).map((p) => ({
      t: p.date.slice(5),
      개인: p.individual,
      외국인: p.foreign,
      기관: p.institution,
    }));
  }, [data, market, mode]);

  const latest = points[points.length - 1];

  return (
    <article className="kr-card">
      <div className="kr-card-head">
        <div>
          <h3 className="kr-card-title">투자자 수급</h3>
          <p className="kr-card-sub">
            외국인 · 기관 · 개인 순매수 (억원)
            {data.as_of ? ` · 기준 ${data.as_of}` : ""}
          </p>
        </div>
        <div className="kr-toggles">
          <div className="seg">
            <button
              type="button"
              className={market === "kospi" ? "active" : ""}
              onClick={() => onMarket("kospi")}
            >
              코스피
            </button>
            <button
              type="button"
              className={market === "kosdaq" ? "active" : ""}
              onClick={() => onMarket("kosdaq")}
            >
              코스닥
            </button>
          </div>
          <div className="seg">
            <button
              type="button"
              className={mode === "intraday" ? "active" : ""}
              onClick={() => onMode("intraday")}
            >
              당일
            </button>
            <button
              type="button"
              className={mode === "daily" ? "active" : ""}
              onClick={() => onMode("daily")}
            >
              일별
            </button>
          </div>
        </div>
      </div>

      {latest ? (
        <div className="kr-flow-summary">
          <div className={toneClass(latest.외국인)}>
            <span>외국인</span>
            <strong>{fmtKrwEok(latest.외국인)}</strong>
          </div>
          <div className={toneClass(latest.기관)}>
            <span>기관</span>
            <strong>{fmtKrwEok(latest.기관)}</strong>
          </div>
          <div className={toneClass(latest.개인)}>
            <span>개인</span>
            <strong>{fmtKrwEok(latest.개인)}</strong>
          </div>
        </div>
      ) : null}

      <div className="kr-chart" style={{ height: 260 }}>
        {!points.length ? (
          <p className="empty">수급 데이터가 없습니다.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={24} />
              <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={48} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [
                  `${Number(value).toLocaleString("ko-KR")}억`,
                  name,
                ]}
              />
              <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
              <Bar dataKey="외국인" fill="#4da3ff" radius={[3, 3, 0, 0]} />
              <Bar dataKey="기관" fill="#34d399" radius={[3, 3, 0, 0]} />
              <Bar dataKey="개인" fill="#fb923c" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </article>
  );
}

function CreditPanel({ credit }: { credit: NonNullable<KrMarketPayload["credit"]> }) {
  const chartData = useMemo(
    () =>
      credit.rows.slice(-30).map((r) => ({
        t: r.date.slice(5),
        예탁금: r.customer_deposit,
        신용잔고: r.credit_balance,
      })),
    [credit.rows],
  );
  const latest = credit.latest;

  return (
    <article className="kr-card">
      <div className="kr-card-head">
        <div>
          <h3 className="kr-card-title">신용 · 증시자금</h3>
          <p className="kr-card-sub">고객예탁금 · 신용잔고 · 펀드 자금 (억원)</p>
        </div>
        {latest ? (
          <div className="kr-credit-kpis">
            <div>
              <span>예탁금</span>
              <strong>{fmtKrwEok(latest.customer_deposit).replace("+", "")}</strong>
            </div>
            <div>
              <span>신용잔고</span>
              <strong>{fmtKrwEok(latest.credit_balance).replace("+", "")}</strong>
            </div>
            <div>
              <span>신용/예탁</span>
              <strong>{fmtPct(credit.credit_ratio_proxy, 2)}</strong>
            </div>
          </div>
        ) : null}
      </div>

      <div className="kr-chart" style={{ height: 240 }}>
        {!chartData.length ? (
          <p className="empty">신용 데이터가 없습니다.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={28} />
              <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={56} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [
                  `${Number(value).toLocaleString("ko-KR")}억`,
                  name,
                ]}
              />
              <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="예탁금"
                stroke="#a78bfa"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="신용잔고"
                stroke="#f472b6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
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

export default function KrMarketTab() {
  const [data, setData] = useState<KrMarketPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartMode, setChartMode] = useState<ChartMode>("intraday");
  const [flowMarket, setFlowMarket] = useState<FlowMarket>("kospi");
  const [flowMode, setFlowMode] = useState<ChartMode>("intraday");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kr-market", { cache: "no-store" });
      const json = (await res.json()) as KrMarketPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 45_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="kr-tab">
      <div className="kr-hero">
        <div>
          <h2 className="kr-hero-title">국내 시황 모니터</h2>
          <p className="kr-hero-sub">
            코스피200 · 코스닥 라이브 차트, 수급, 신용, 기술적 지표를 한눈에 봅니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <div className="seg">
            <button
              type="button"
              className={chartMode === "intraday" ? "active" : ""}
              onClick={() => setChartMode("intraday")}
            >
              분봉
            </button>
            <button
              type="button"
              className={chartMode === "daily" ? "active" : ""}
              onClick={() => setChartMode("daily")}
            >
              일봉
            </button>
          </div>
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">국내 시황 불러오는 중…</p> : null}
      {data && !data.ok ? (
        <p className="empty">시황 로드 실패: {data.error || "unknown"}</p>
      ) : null}

      {data?.ok ? (
        <>
          {data.note ? <p className="kr-note">{data.note}</p> : null}

          <div className="kr-grid-2">
            {data.kospi200 ? (
              <IndexCard
                title="코스피200"
                subtitle="KPI200 · Naver 실시간"
                board={data.kospi200}
                mode={chartMode}
              />
            ) : null}
            {data.kosdaq ? (
              <IndexCard
                title="코스닥 종합"
                subtitle="舊 코스닥100 대체 시황 · 수급 연동"
                board={data.kosdaq}
                mode={chartMode}
              />
            ) : null}
          </div>

          {data.kosdaq150 ? (
            <article className="kr-card kr-card-compact">
              <div className="kr-card-head">
                <div>
                  <h3 className="kr-card-title">코스닥150 (舊 코스닥100 후속)</h3>
                  <p className="kr-card-sub">KODEX 코스닥150 ETF 프록시 · 대형주 추세</p>
                </div>
                <div className={`kr-quote ${toneClass(data.kosdaq150.quote.change)}`}>
                  <div className="kr-last">
                    {fmtNum(data.kosdaq150.quote.last, 0)}원
                  </div>
                  <div className="kr-chg">
                    {fmtNum(data.kosdaq150.quote.change, 0)} (
                    {fmtPct(data.kosdaq150.quote.change_pct)})
                  </div>
                </div>
              </div>
              <div className="kr-ta-grid">
                <div>
                  <span className="kr-ta-label">추세</span>
                  <strong>{data.kosdaq150.technicals.regime}</strong>
                </div>
                <div>
                  <span className="kr-ta-label">RSI</span>
                  <strong>{fmtNum(data.kosdaq150.technicals.rsi14, 1)}</strong>
                </div>
                <div>
                  <span className="kr-ta-label">MACD hist</span>
                  <strong className={toneClass(data.kosdaq150.technicals.macd_hist)}>
                    {fmtNum(data.kosdaq150.technicals.macd_hist, 2)}
                  </strong>
                </div>
                <div>
                  <span className="kr-ta-label">SMA20</span>
                  <strong>{fmtNum(data.kosdaq150.technicals.sma20, 0)}</strong>
                </div>
              </div>
            </article>
          ) : null}

          {data.flows ? (
            <FlowPanel
              data={data.flows}
              market={flowMarket}
              mode={flowMode}
              onMarket={setFlowMarket}
              onMode={setFlowMode}
            />
          ) : null}

          {data.credit ? <CreditPanel credit={data.credit} /> : null}

          <p className="kr-foot">
            출처: Naver Finance (지수·수급·증시자금) · 약 45초마다 갱신 ·{" "}
            {data.generated_at
              ? new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false })
              : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}

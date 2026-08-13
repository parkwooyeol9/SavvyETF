"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  MetricCell,
  MetricKind,
  MoneyFlowPayload,
  MoneyFlowPeriod,
} from "@/lib/moneyFlow";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function kindClass(kind: MetricKind): string {
  if (kind === "flow") return "mf-flow";
  if (kind === "position") return "mf-position";
  if (kind === "activity") return "mf-activity";
  if (kind === "liquidity") return "mf-liquidity";
  return "";
}

function fmtNum(cell: MetricCell | null | undefined): string {
  if (!cell || cell.value == null || Number.isNaN(cell.value)) {
    return "Data unavailable";
  }
  const v = cell.value;
  const abs = Math.abs(v);
  const body =
    abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${body}${cell.unit ? ` ${cell.unit}` : ""}`;
}

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function fmtChg(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function CellView({ cell }: { cell: MetricCell }) {
  const tip = [
    cell.label,
    cell.estimated ? "추정(Inferred)" : null,
    cell.source,
    cell.method,
    cell.as_of ? `as_of ${cell.as_of}` : null,
    cell.zscore_1m != null ? `z1m ${cell.zscore_1m.toFixed(2)}` : null,
    cell.percentile_1m != null ? `pctl ${cell.percentile_1m.toFixed(0)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const unavailable = cell.value == null;
  return (
    <td
      className={`${kindClass(cell.kind)} ${unavailable ? "mf-na" : tone(cell.value)}`}
      title={tip}
    >
      {fmtNum(cell)}
      {!unavailable && cell.estimated ? (
        <span className="mf-z"> 추정</span>
      ) : null}
      {!unavailable && cell.zscore_1m != null ? (
        <span className="mf-z"> z{cell.zscore_1m.toFixed(1)}</span>
      ) : null}
    </td>
  );
}

export default function MoneyFlowTab() {
  const [period, setPeriod] = useState<MoneyFlowPeriod>("1m");
  const [data, setData] = useState<MoneyFlowPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: MoneyFlowPeriod, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/money-flow?period=${p}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as MoneyFlowPayload;
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        setData(json);
        setError(null);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "로드 실패");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(period);
    const id = setInterval(() => void load(period, true), 180_000);
    return () => clearInterval(id);
  }, [load, period]);

  const ratesChart = useMemo(() => {
    const us = data?.charts.rates?.us10y || [];
    const dx = data?.charts.rates?.dxy || [];
    const byDate = new Map<string, { date: string; us10y?: number; dxy?: number }>();
    for (const p of us) {
      byDate.set(p.date, { date: p.date, us10y: p.value });
    }
    for (const p of dx) {
      const row = byDate.get(p.date) || { date: p.date };
      row.dxy = p.value;
      byDate.set(p.date, row);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const familyCompare = useMemo(
    () =>
      (data?.charts.family_compare || []).map((r) => ({
        name: r.asset,
        Flow: r.flow_z,
        Position: r.position_z,
        Activity: r.activity_z,
      })),
    [data],
  );

  return (
    <section className="geo-section geo-featured geo-tab macro-tab">
      <div className="kr-hero">
        <div>
          <h2 className="kr-hero-title">Global Money Flow Monitor</h2>
          <p className="kr-hero-sub">
            ETF·펀드 Flow / 파생 Position / 거래 Activity / 유동성 Liquidity를{" "}
            <strong>합산하지 않고</strong> 비교합니다 · USD · 시각 KST · 공개
            데이터만
          </p>
        </div>
        <div className="kr-hero-actions">
          {(["1w", "1m", "3m"] as MoneyFlowPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`tab-btn sub ${period === p ? "active" : ""}`}
              onClick={() => setPeriod(p)}
            >
              {p === "1w" ? "1주" : p === "1m" ? "1개월" : "3개월"}
            </button>
          ))}
          <button
            type="button"
            className="tab-btn"
            disabled={loading}
            onClick={() => void load(period)}
          >
            {loading ? "갱신 중…" : "갱신"}
          </button>
        </div>
      </div>

      {error ? <p className="empty">오류: {error}</p> : null}
      {loading && !data ? <p className="empty">불러오는 중…</p> : null}

      {data ? (
        <>
          <p className="meta-soft">
            {data.note} · 기준일 {data.as_of_kst} · {data.generated_at_display}
          </p>

          <div className="us-pf-stats" style={{ marginTop: 12 }}>
            <div>
              <span className="meta-soft">Risk regime</span>
              <strong>{data.risk_summary.regime_ko}</strong>
            </div>
            <div>
              <span className="meta-soft">최대 유입(Flow系)</span>
              <strong>
                {data.top_inflow
                  ? `${data.top_inflow.asset} · ${data.top_inflow.value_label}`
                  : "Data unavailable"}
              </strong>
            </div>
            <div>
              <span className="meta-soft">최대 유출(Flow系)</span>
              <strong>
                {data.top_outflow
                  ? `${data.top_outflow.asset} · ${data.top_outflow.value_label}`
                  : "Data unavailable"}
              </strong>
            </div>
            <div>
              <span className="meta-soft">기간</span>
              <strong>{period}</strong>
            </div>
          </div>

          {data.risk_summary.drivers.length ? (
            <ul className="kr-list compact" style={{ marginTop: 8 }}>
              {data.risk_summary.drivers.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}

          <div className="mf-legend" style={{ marginTop: 12 }}>
            <span className="mf-flow">Flow</span>
            <span className="mf-position">Position</span>
            <span className="mf-activity">Activity</span>
            <span className="mf-liquidity">Liquidity</span>
          </div>

          <div className="mf-table-wrap" style={{ marginTop: 12, overflowX: "auto" }}>
            <table className="mf-table">
              <thead>
                <tr>
                  <th>자산</th>
                  <th className="mf-flow">ETF·펀드 Flow</th>
                  <th className="mf-flow">Flow/AUM</th>
                  <th className="mf-position">OI 변화</th>
                  <th className="mf-position">CFTC 포지션</th>
                  <th className="mf-activity">거래량 변화</th>
                  <th>가격수익률</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.label_ko}</strong>
                      <div className="meta-soft">{r.label_en}</div>
                    </td>
                    <CellView cell={r.etf_flow} />
                    <CellView cell={r.flow_aum} />
                    <CellView cell={r.oi_change} />
                    <CellView cell={r.cftc} />
                    <CellView cell={r.volume_change} />
                    <CellView cell={r.price_return} />
                    <td>{r.status_ko}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.inferences.length ? (
            <div className="geo-card" style={{ marginTop: 12 }}>
              <h3>추정 (Inferred)</h3>
              <ul className="kr-list compact">
                {data.inferences.map((inf) => (
                  <li key={inf.text}>
                    <strong>추정</strong> · {inf.text}
                    <div className="meta-soft">{inf.basis}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="kr-grid-2" style={{ marginTop: 16, gap: 16 }}>
            <div className="geo-card">
              <h3>채권·달러 · US 10Y / DXY</h3>
              <p className="meta-soft" style={{ marginBottom: 8 }}>
                10Y{" "}
                {data.charts.rates.us10y_latest != null
                  ? `${data.charts.rates.us10y_latest.toFixed(2)}%`
                  : "—"}{" "}
                (
                <span className={tone(data.charts.rates.us10y_chg)}>
                  {fmtChg(data.charts.rates.us10y_chg)}
                </span>
                )
                {" · "}
                DXY{" "}
                {data.charts.rates.dxy_latest != null
                  ? data.charts.rates.dxy_latest.toFixed(2)
                  : "—"}{" "}
                (
                <span className={tone(data.charts.rates.dxy_chg)}>
                  {fmtChg(data.charts.rates.dxy_chg)}
                </span>
                )
                {" · "}
                {data.charts.rates.source}
              </p>
              <div style={{ height: 240 }}>
                {ratesChart.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={ratesChart}
                      margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid
                        stroke="rgba(43,54,72,0.85)"
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "#8fa3b8", fontSize: 10 }}
                        minTickGap={28}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: "#8fa3b8", fontSize: 10 }}
                        width={42}
                        domain={["auto", "auto"]}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fill: "#8fa3b8", fontSize: 10 }}
                        width={42}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend
                        wrapperStyle={{ color: "#8fa3b8", fontSize: 11 }}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="us10y"
                        name="US 10Y %"
                        stroke="#fbbf24"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="dxy"
                        name="DXY"
                        stroke="#60a5fa"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="empty">Rates 데이터 없음</p>
                )}
              </div>
            </div>
            <div className="geo-card">
              <h3>Family z-score 비교</h3>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={familyCompare}
                    margin={{ top: 8, right: 8, left: 0, bottom: 40 }}
                  >
                    <CartesianGrid
                      stroke="rgba(43,54,72,0.85)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "#8fa3b8", fontSize: 10 }}
                      angle={-25}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={36} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend
                      wrapperStyle={{ color: "#8fa3b8", fontSize: 11 }}
                    />
                    <Bar dataKey="Flow" fill="#34d399" />
                    <Bar dataKey="Position" fill="#60a5fa" />
                    <Bar dataKey="Activity" fill="#fbbf24" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="kr-grid-2" style={{ marginTop: 16, gap: 16 }}>
            <div className="geo-card">
              <h3>BTC·ETH OI / 펀딩비</h3>
              <ul className="kr-list compact">
                <li>
                  BTC OI:{" "}
                  {data.charts.crypto_derivatives.btc_oi_usd != null
                    ? `$${(data.charts.crypto_derivatives.btc_oi_usd / 1e9).toFixed(2)} bn`
                    : "Data unavailable"}
                </li>
                <li>
                  ETH OI:{" "}
                  {data.charts.crypto_derivatives.eth_oi_usd != null
                    ? `$${(data.charts.crypto_derivatives.eth_oi_usd / 1e9).toFixed(2)} bn`
                    : "Data unavailable"}
                </li>
                <li>
                  BTC funding:{" "}
                  {data.charts.crypto_derivatives.btc_funding != null
                    ? `${data.charts.crypto_derivatives.btc_funding.toFixed(4)}%`
                    : "Data unavailable"}
                </li>
                <li>
                  ETH funding:{" "}
                  {data.charts.crypto_derivatives.eth_funding != null
                    ? `${data.charts.crypto_derivatives.eth_funding.toFixed(4)}%`
                    : "Data unavailable"}
                </li>
                <li className="meta-soft">
                  {data.charts.crypto_derivatives.source}
                  {data.charts.crypto_derivatives.as_of
                    ? ` · ${data.charts.crypto_derivatives.as_of}`
                    : ""}
                </li>
              </ul>
            </div>
            <div className="geo-card">
              <h3>CFTC 포지션 변화</h3>
              {data.charts.cftc_changes.length ? (
                <ul className="kr-list compact">
                  {data.charts.cftc_changes.map((c) => (
                    <li key={c.market}>
                      {c.market}: net{" "}
                      {c.mm_net != null ? c.mm_net.toLocaleString() : "—"}
                      {c.mm_net_chg != null ? (
                        <span className={tone(c.mm_net_chg)}>
                          {" "}
                          (Δ {c.mm_net_chg > 0 ? "+" : ""}
                          {c.mm_net_chg.toLocaleString()})
                        </span>
                      ) : null}
                      <span className="meta-soft">
                        {" "}
                        · {c.as_of || "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">Data unavailable</p>
              )}
            </div>
          </div>

          <div className="geo-card" style={{ marginTop: 12 }}>
            <h3>데이터 출처 · 오류</h3>
            <ul className="kr-list compact">
              {data.sources.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong> — {s.used_for}{" "}
                  <a href={s.url} target="_blank" rel="noreferrer">
                    link
                  </a>
                </li>
              ))}
            </ul>
            {data.errors.length ? (
              <ul className="kr-list compact" style={{ marginTop: 8 }}>
                {data.errors.map((e) => (
                  <li key={e} className="down">
                    {e}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta-soft">업데이트 오류 없음</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

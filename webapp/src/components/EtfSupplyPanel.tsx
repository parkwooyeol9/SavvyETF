"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type EtfSupplyRankRow = {
  rank: number;
  code: string;
  name: string;
  value: number | null;
  price: number | null;
  change_pct: number | null;
  yield_pct: number | null;
  prev_price: number | null;
};

type EtfSupplyBoard = {
  period: "10D" | "5D" | "D" | "BD" | "W" | "M" | "3M";
  period_label: string;
  as_of: string | null;
  rows: EtfSupplyRankRow[];
};

type InflowPeriod = "W" | "M" | "3M";

type EtfSupplyPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  us_inflow: Record<InflowPeriod, EtfSupplyBoard>;
  inflow: Record<InflowPeriod, EtfSupplyBoard>;
  notes: string[];
  error?: string;
};

const INFLOW_PERIODS: Array<{ id: InflowPeriod; label: string }> = [
  { id: "W", label: "1주" },
  { id: "M", label: "1개월" },
  { id: "3M", label: "3개월" },
];

function emptyBoard(period: EtfSupplyBoard["period"], label: string): EtfSupplyBoard {
  return { period, period_label: label, as_of: null, rows: [] };
}

function emptyInflow(): Record<InflowPeriod, EtfSupplyBoard> {
  return {
    W: emptyBoard("W", "1주"),
    M: emptyBoard("M", "1개월"),
    "3M": emptyBoard("3M", "3개월"),
  };
}

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function fmtKrwDelta(n?: number | null, signed = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const eok = n / 1e8;
  const sign = signed ? (eok > 0 ? "+" : "") : "";
  if (Math.abs(eok) >= 10_000) {
    return `${sign}${(eok / 10_000).toFixed(2)}조`;
  }
  if (Math.abs(eok) >= 100) {
    return `${sign}${Math.round(eok).toLocaleString("ko-KR")}억`;
  }
  if (Math.abs(eok) >= 10) return `${sign}${eok.toFixed(1)}억`;
  return `${sign}${eok.toFixed(2)}억`;
}

function fmtUsdDelta(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) {
    const digits = abs >= 1e11 ? 0 : abs >= 1e10 ? 1 : 2;
    return `${sign}$${(abs / 1e9).toFixed(digits)}B`;
  }
  if (abs >= 1e6) {
    const digits = abs >= 1e8 ? 0 : 1;
    return `${sign}$${(abs / 1e6).toFixed(digits)}M`;
  }
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function RankBar({
  value,
  max,
  positive,
}: {
  value: number | null;
  max: number;
  positive?: boolean;
}) {
  if (value == null || max <= 0) return null;
  const pct = Math.max(4, Math.min(100, (Math.abs(value) / max) * 100));
  const down = positive === false || (positive == null && value < 0);
  return (
    <span
      className={`etf-supply-bar ${down ? "down" : "up"}`}
      style={{ width: `${pct}%` }}
    />
  );
}

function RankTable({
  rows,
  valueLabel,
  formatValue,
  extraLabel,
  extraValue,
  extraTone,
  loading,
}: {
  rows: EtfSupplyRankRow[];
  valueLabel: string;
  formatValue: (n?: number | null) => string;
  extraLabel: string;
  extraValue: (row: EtfSupplyRankRow) => string;
  extraTone?: (row: EtfSupplyRankRow) => string;
  loading: boolean;
}) {
  const max = useMemo(
    () => Math.max(0, ...rows.map((r) => Math.abs(r.value || 0))),
    [rows],
  );

  return (
    <div className="table-wrap">
      <table className="kr-table etf-supply-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>종목</th>
            <th className="num">{valueLabel}</th>
            <th className="num">{extraLabel}</th>
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={4} className="empty">
                {loading ? "불러오는 중…" : "조회 결과 없음"}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${row.rank}-${row.code}`}>
                <td className="num">
                  <span
                    className={`etf-supply-rank ${row.rank <= 3 ? `top${row.rank}` : ""}`}
                  >
                    {row.rank}
                  </span>
                </td>
                <td>
                  <code>{row.code}</code>
                  <div className="etf-supply-name" title={row.name}>
                    {row.name}
                  </div>
                </td>
                <td className="num etf-supply-val">
                  <strong className={tone(row.value)}>{formatValue(row.value)}</strong>
                  <RankBar value={row.value} max={max} />
                </td>
                <td className={`num ${extraTone ? extraTone(row) : ""}`}>
                  {extraValue(row)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function EtfSupplyPanel() {
  const [data, setData] = useState<EtfSupplyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [usPeriod, setUsPeriod] = useState<InflowPeriod>("M");
  const [inflowPeriod, setInflowPeriod] = useState<InflowPeriod>("M");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/etf-supply");
      const json = (await res.json()) as EtfSupplyPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        generated_at_display: "",
        source: "etfcheck",
        us_inflow: emptyInflow(),
        inflow: emptyInflow(),
        notes: [],
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const usBoard = data?.us_inflow?.[usPeriod];
  const inflowBoard = data?.inflow?.[inflowPeriod];

  return (
    <section className="panel etf-supply-panel">
      <div className="panel-head">
        <div>
          <h2>ETF 수급</h2>
          <p className="kr-note">
            미국상장 ETF · 국내 ETF 자금유입 Top10
            {data?.generated_at_display ? ` · ${data.generated_at_display}` : ""}
          </p>
        </div>
        <button type="button" className="chip" onClick={() => void load()} disabled={loading}>
          {loading ? "로딩…" : "새로고침"}
        </button>
      </div>

      {!data?.ok && data?.error ? (
        <p className="empty">{data.error}</p>
      ) : null}

      <div className="etf-supply-grid">
        <div className="etf-supply-block">
          <div className="etf-supply-block-head">
            <h3>미국상장 ETF 자금유입 Top10</h3>
            <div className="chip-row" role="group" aria-label="미국 자금유입 기간">
              {INFLOW_PERIODS.map((period) => (
                <button
                  key={period.id}
                  type="button"
                  className={`chip ${usPeriod === period.id ? "active" : ""}`}
                  onClick={() => setUsPeriod(period.id)}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>
          <RankTable
            rows={usBoard?.rows || []}
            valueLabel="자금유입"
            formatValue={fmtUsdDelta}
            extraLabel="기간수익률"
            extraValue={(row) => fmtPct(row.yield_pct)}
            extraTone={(row) => tone(row.yield_pct)}
            loading={loading}
          />
        </div>

        <div className="etf-supply-block">
          <div className="etf-supply-block-head">
            <h3>국내 ETF 자금유입 Top10</h3>
            <div className="chip-row" role="group" aria-label="자금유입 기간">
              {INFLOW_PERIODS.map((period) => (
                <button
                  key={period.id}
                  type="button"
                  className={`chip ${inflowPeriod === period.id ? "active" : ""}`}
                  onClick={() => setInflowPeriod(period.id)}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>
          <RankTable
            rows={inflowBoard?.rows || []}
            valueLabel="자금유입"
            formatValue={fmtKrwDelta}
            extraLabel="기간수익률"
            extraValue={(row) => fmtPct(row.yield_pct)}
            extraTone={(row) => tone(row.yield_pct)}
            loading={loading}
          />
        </div>
      </div>
    </section>
  );
}

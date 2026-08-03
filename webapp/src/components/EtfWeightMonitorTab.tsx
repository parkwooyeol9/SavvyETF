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

type Holding = {
  ticker?: string;
  name?: string;
  cusip?: string;
  weight_pct?: number | null;
  market_value?: number | null;
};

type Economic = {
  id: string;
  label: string;
  weight_pct: number;
  legs?: Holding[];
};

type History = {
  dates: string[];
  labels: Record<string, string>;
  series: Record<string, Array<number | null>>;
  snapshot_count?: number;
};

type UniverseEntry = {
  ticker: string;
  name?: string;
  issuer?: string;
  as_of?: string | null;
  aum_usd?: number | null;
};

type Payload = {
  ok: boolean;
  error?: string;
  ticker?: string;
  name?: string;
  issuer?: string;
  as_of?: string | null;
  csv_date?: string | null;
  file_day?: string | null;
  aum_usd?: number | null;
  generated_at_display?: string;
  source_note?: string;
  source_url?: string;
  holdings?: Holding[];
  economic?: Economic[];
  history?: History;
  universe?: { tickers?: UniverseEntry[] };
  notes?: string[];
};

const LINE_COLORS = [
  "#0f766e",
  "#b45309",
  "#1d4ed8",
  "#be123c",
  "#7c3aed",
  "#047857",
  "#c2410c",
  "#0e7490",
  "#a16207",
  "#4338ca",
];

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtAum(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

export default function EtfWeightMonitorTab() {
  const [ticker, setTicker] = useState("DRAM");
  const [universe, setUniverse] = useState<UniverseEntry[]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUniverse = useCallback(async () => {
    try {
      const res = await fetch("/api/etf-weights?universe=1", { cache: "no-store" });
      const json = (await res.json()) as Payload;
      const list = json.universe?.tickers || [];
      if (list.length) setUniverse(list);
    } catch {
      /* ignore — detail load may still work */
    }
  }, []);

  const load = useCallback(async (sym: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/etf-weights?ticker=${encodeURIComponent(sym)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as Payload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      if (json.universe?.tickers?.length) {
        setUniverse(json.universe.tickers);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUniverse();
  }, [loadUniverse]);

  useEffect(() => {
    void load(ticker);
  }, [load, ticker]);

  const groupedUniverse = useMemo(() => {
    const rh = universe.filter((u) => u.issuer === "Roundhill");
    const ish = universe.filter((u) => u.issuer === "iShares");
    const other = universe.filter(
      (u) => u.issuer !== "Roundhill" && u.issuer !== "iShares",
    );
    return { rh, ish, other };
  }, [universe]);

  const chartRows = useMemo(() => {
    const hist = data?.history;
    if (!hist?.dates?.length) return [];
    const ids = Object.keys(hist.series || {});
    return hist.dates.map((date, i) => {
      const row: Record<string, string | number | null> = { date };
      for (const id of ids) {
        const label = hist.labels[id] || id;
        row[label] = hist.series[id]?.[i] ?? null;
      }
      return row;
    });
  }, [data]);

  const seriesKeys = useMemo(() => {
    if (!chartRows.length) return [] as string[];
    return Object.keys(chartRows[0]).filter((k) => k !== "date");
  }, [chartRows]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">ETF 편입비 모니터</h2>
          <p className="panel-sub">
            Roundhill 전 상품(Filepoint) · iShares AUM Top15 — 일자별 스냅샷 시계열
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void load(ticker)}>
          새로고침
        </button>
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          티커{" "}
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            style={{ minWidth: 220, marginLeft: 6 }}
          >
            {groupedUniverse.rh.length ? (
              <optgroup label={`Roundhill (${groupedUniverse.rh.length})`}>
                {groupedUniverse.rh.map((u) => (
                  <option key={u.ticker} value={u.ticker}>
                    {u.ticker} — {(u.name || "").slice(0, 40)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {groupedUniverse.ish.length ? (
              <optgroup label={`iShares Top AUM (${groupedUniverse.ish.length})`}>
                {groupedUniverse.ish.map((u) => (
                  <option key={u.ticker} value={u.ticker}>
                    {u.ticker} — {fmtAum(u.aum_usd)} — {(u.name || "").slice(0, 32)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {groupedUniverse.other.map((u) => (
              <option key={u.ticker} value={u.ticker}>
                {u.ticker}
              </option>
            ))}
            {!universe.length ? <option value={ticker}>{ticker}</option> : null}
          </select>
        </label>
        <span className="meta-line">
          유니버스 {universe.length}종 · Roundhill {groupedUniverse.rh.length} ·
          iShares {groupedUniverse.ish.length}
        </span>
      </div>

      {loading ? <p className="empty">불러오는 중…</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}

      {data?.ok ? (
        <>
          <p className="meta-line" style={{ marginBottom: 12 }}>
            {data.name} · {data.issuer} · holdings as of {data.as_of || "—"}
            {data.csv_date ? ` (CSV Date ${data.csv_date})` : ""}
            {data.file_day ? ` · file ${data.file_day}` : ""} · AUM{" "}
            {fmtAum(data.aum_usd)} · 스냅샷 {data.history?.snapshot_count ?? 0}일
          </p>
          {data.source_note ? (
            <p className="panel-sub" style={{ marginBottom: 16 }}>
              {data.source_note}
              {data.source_url ? (
                <>
                  {" "}
                  <a href={data.source_url} target="_blank" rel="noreferrer">
                    원천
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          <h3 className="kr-card-title">
            {data.ticker === "DRAM" ? "경제 노출 (현물 + TRS)" : "Top holdings"}
          </h3>
          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th>비중</th>
                  <th>세부</th>
                </tr>
              </thead>
              <tbody>
                {(data.economic || []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{fmtPct(row.weight_pct)}</td>
                    <td>
                      {(row.legs || [])
                        .map((leg) => `${leg.ticker || "?"} ${fmtPct(leg.weight_pct)}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="kr-card-title">편입비 시계열</h3>
          {chartRows.length < 2 ? (
            <p className="empty">
              시계열이 아직 짧습니다. 스케줄러가 일자별 스냅샷을 쌓으면 늘어납니다.
              Roundhill은 백필로 여러 날이 한 번에 들어올 수 있고, iShares는 앞으로
              매일 축적됩니다.
            </p>
          ) : (
            <div style={{ width: "100%", height: 360, marginBottom: 20 }}>
              <ResponsiveContainer>
                <LineChart data={chartRows} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" width={48} domain={["auto", "auto"]} />
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? fmtPct(value) : "—"
                    }
                  />
                  <Legend />
                  {seriesKeys.map((key, idx) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <h3 className="kr-card-title">원천 보유 목록</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {(data.holdings || []).slice(0, 40).map((row, idx) => (
                  <tr key={`${row.ticker}-${idx}`}>
                    <td>{idx + 1}</td>
                    <td>{row.ticker || "—"}</td>
                    <td>{row.name || "—"}</td>
                    <td>{fmtPct(row.weight_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(data.notes || []).length ? (
            <ul className="panel-sub" style={{ marginTop: 16 }}>
              {data.notes!.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

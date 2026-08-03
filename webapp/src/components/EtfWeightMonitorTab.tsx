"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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

function fmtDelta(n?: number | null): string {
  if (n == null || Number.isNaN(n) || Math.abs(n) < 0.005) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}pp`;
}

function WeightBar({ pct }: { pct?: number | null }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 120,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: "rgba(15, 23, 42, 0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${w}%`,
            height: "100%",
            borderRadius: 3,
            background: "linear-gradient(90deg, #0f766e, #14b8a6)",
          }}
        />
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 52, textAlign: "right" }}>
        {fmtPct(pct)}
      </span>
    </div>
  );
}

export default function EtfWeightMonitorTab() {
  const [ticker, setTicker] = useState("DRAM");
  const [universe, setUniverse] = useState<UniverseEntry[]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [daySnap, setDaySnap] = useState<Payload | null>(null);
  const [prevSnap, setPrevSnap] = useState<Payload | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

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
    setDaySnap(null);
    setPrevSnap(null);
    try {
      const res = await fetch(`/api/etf-weights?ticker=${encodeURIComponent(sym)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as Payload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      const dates = json.history?.dates || [];
      const latest =
        json.as_of && dates.includes(json.as_of)
          ? json.as_of
          : dates[dates.length - 1] || json.as_of || null;
      setSelectedDate(latest);
      if (json.universe?.tickers?.length) {
        setUniverse(json.universe.tickers);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
      setSelectedDate(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDay = useCallback(async (sym: string, day: string, dates: string[]) => {
    setDayLoading(true);
    try {
      const idx = dates.indexOf(day);
      const prevDay = idx > 0 ? dates[idx - 1] : null;
      const urls = [
        `/api/etf-weights?ticker=${encodeURIComponent(sym)}&as_of=${encodeURIComponent(day)}`,
      ];
      if (prevDay) {
        urls.push(
          `/api/etf-weights?ticker=${encodeURIComponent(sym)}&as_of=${encodeURIComponent(prevDay)}`,
        );
      }
      const responses = await Promise.all(
        urls.map((u) => fetch(u, { cache: "no-store" }).then((r) => r.json() as Promise<Payload>)),
      );
      const cur = responses[0];
      const prev = responses[1];
      setDaySnap(cur?.ok ? cur : null);
      setPrevSnap(prev?.ok ? prev : null);
    } catch {
      setDaySnap(null);
      setPrevSnap(null);
    } finally {
      setDayLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUniverse();
  }, [loadUniverse]);

  useEffect(() => {
    void load(ticker);
  }, [load, ticker]);

  useEffect(() => {
    if (!selectedDate || !ticker) return;
    const dates = data?.history?.dates || [];
    // Latest day is already in main payload — reuse until user picks another date
    if (selectedDate === data?.as_of && data.holdings?.length) {
      setDaySnap(data);
      const idx = dates.indexOf(selectedDate);
      const prevDay = idx > 0 ? dates[idx - 1] : null;
      if (prevDay) {
        void (async () => {
          try {
            const res = await fetch(
              `/api/etf-weights?ticker=${encodeURIComponent(ticker)}&as_of=${encodeURIComponent(prevDay)}`,
              { cache: "no-store" },
            );
            const json = (await res.json()) as Payload;
            setPrevSnap(json?.ok ? json : null);
          } catch {
            setPrevSnap(null);
          }
        })();
      } else {
        setPrevSnap(null);
      }
      return;
    }
    void loadDay(ticker, selectedDate, dates);
  }, [selectedDate, ticker, data, loadDay]);

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

  const historyDates = data?.history?.dates || [];
  const view = daySnap?.ok ? daySnap : data;
  const activeDate = selectedDate || data?.as_of || null;
  const markerDate = hoverDate || activeDate;

  const prevWeightByTicker = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const h of prevSnap?.holdings || []) {
      const key = (h.ticker || h.cusip || h.name || "").toUpperCase();
      if (key) map.set(key, h.weight_pct ?? null);
    }
    return map;
  }, [prevSnap]);

  const holdingsRows = useMemo(() => {
    const list = [...(view?.holdings || [])];
    list.sort((a, b) => (b.weight_pct ?? -1) - (a.weight_pct ?? -1));
    return list.slice(0, 50).map((row, idx) => {
      const key = (row.ticker || row.cusip || row.name || "").toUpperCase();
      const prev = key ? prevWeightByTicker.get(key) : undefined;
      const cur = row.weight_pct ?? null;
      const delta =
        cur != null && prev != null && Number.isFinite(prev) ? cur - prev : null;
      return { row, idx, delta };
    });
  }, [view, prevWeightByTicker]);

  const economicRows = useMemo(() => {
    const list = view?.economic || [];
    const prevMap = new Map(
      (prevSnap?.economic || []).map((e) => [e.id, e.weight_pct] as const),
    );
    return list.map((row) => {
      const prev = prevMap.get(row.id);
      const delta =
        prev != null && Number.isFinite(prev) ? row.weight_pct - prev : null;
      return { row, delta };
    });
  }, [view, prevSnap]);

  const selectChartDate = useCallback(
    (date: string | undefined | null) => {
      if (!date || !historyDates.includes(date)) return;
      setSelectedDate(date);
    },
    [historyDates],
  );

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

      <div
        style={{
          marginBottom: 16,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
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
            {data.name} · {data.issuer} · latest holdings as of {data.as_of || "—"}
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

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <h3 className="kr-card-title" style={{ margin: 0 }}>
              편입비 시계열
            </h3>
            {historyDates.length ? (
              <label className="meta-line" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                기준일
                <select
                  value={activeDate || ""}
                  onChange={(e) => selectChartDate(e.target.value)}
                  style={{ minWidth: 140 }}
                >
                  {[...historyDates].reverse().map((d) => (
                    <option key={d} value={d}>
                      {d}
                      {d === data.as_of ? " (latest)" : ""}
                    </option>
                  ))}
                </select>
                <span style={{ opacity: 0.7 }}>차트 클릭·호버로도 선택</span>
              </label>
            ) : null}
          </div>

          {chartRows.length < 2 ? (
            <p className="empty" style={{ marginBottom: 20 }}>
              시계열이 아직 짧습니다. 스케줄러가 일자별 스냅샷을 쌓으면 늘어납니다.
              Roundhill은 백필로 여러 날이 한 번에 들어올 수 있고, iShares는 앞으로
              매일 축적됩니다.
            </p>
          ) : (
            <div style={{ width: "100%", height: 360, marginBottom: 24 }}>
              <ResponsiveContainer>
                <LineChart
                  data={chartRows}
                  margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  onClick={(state) => {
                    const d = (state as { activeLabel?: string } | null)?.activeLabel;
                    selectChartDate(d);
                  }}
                  onMouseMove={(state) => {
                    const d = (state as { activeLabel?: string } | null)?.activeLabel;
                    setHoverDate(d || null);
                  }}
                  onMouseLeave={() => setHoverDate(null)}
                  style={{ cursor: "crosshair" }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    unit="%"
                    width={48}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? fmtPct(value) : "—"
                    }
                    labelFormatter={(label) => `기준일 ${label}`}
                  />
                  <Legend />
                  {markerDate ? (
                    <ReferenceLine
                      x={markerDate}
                      stroke={hoverDate && hoverDate !== activeDate ? "#94a3b8" : "#0f766e"}
                      strokeDasharray={hoverDate && hoverDate !== activeDate ? "4 4" : "2 2"}
                      strokeWidth={hoverDate && hoverDate !== activeDate ? 1 : 1.5}
                      label={{
                        value: markerDate,
                        position: "insideTopRight",
                        fill: "#64748b",
                        fontSize: 11,
                      }}
                    />
                  ) : null}
                  {seriesKeys.map((key, idx) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                      dot={false}
                      activeDot={{ r: 5 }}
                      strokeWidth={2}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <h3 className="kr-card-title" style={{ margin: 0 }}>
              {data.ticker === "DRAM" ? "경제 노출 (현물 + TRS)" : "Top holdings"}
              {activeDate ? (
                <span className="meta-line" style={{ marginLeft: 10, fontWeight: 400 }}>
                  as of {activeDate}
                  {dayLoading ? " · 불러오는 중…" : ""}
                </span>
              ) : null}
            </h3>
            {activeDate && activeDate !== data.as_of ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => selectChartDate(data.as_of)}
              >
                latest로 돌아가기
              </button>
            ) : null}
          </div>
          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th>비중</th>
                  <th>전일 대비</th>
                  <th>세부</th>
                </tr>
              </thead>
              <tbody>
                {economicRows.map(({ row, delta }) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>
                      <WeightBar pct={row.weight_pct} />
                    </td>
                    <td
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        color:
                          delta != null && delta > 0.005
                            ? "#047857"
                            : delta != null && delta < -0.005
                              ? "#be123c"
                              : undefined,
                      }}
                    >
                      {fmtDelta(delta)}
                    </td>
                    <td>
                      {(row.legs || [])
                        .map((leg) => `${leg.ticker || "?"} ${fmtPct(leg.weight_pct)}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
                {!economicRows.length ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      이 날짜의 경제 노출 데이터가 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <h3 className="kr-card-title" style={{ margin: 0 }}>
              원천 보유 목록
              {activeDate ? (
                <span className="meta-line" style={{ marginLeft: 10, fontWeight: 400 }}>
                  as of {activeDate}
                  {view?.holdings?.length ? ` · ${view.holdings.length}종` : ""}
                </span>
              ) : null}
            </h3>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Weight</th>
                  <th>전일 대비</th>
                </tr>
              </thead>
              <tbody>
                {holdingsRows.map(({ row, idx, delta }) => (
                  <tr key={`${row.ticker || row.cusip || "row"}-${idx}`}>
                    <td>{idx + 1}</td>
                    <td style={{ fontWeight: 600 }}>{row.ticker || "—"}</td>
                    <td>{row.name || "—"}</td>
                    <td>
                      <WeightBar pct={row.weight_pct} />
                    </td>
                    <td
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        color:
                          delta != null && delta > 0.005
                            ? "#047857"
                            : delta != null && delta < -0.005
                              ? "#be123c"
                              : undefined,
                      }}
                    >
                      {fmtDelta(delta)}
                    </td>
                  </tr>
                ))}
                {!holdingsRows.length ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      {dayLoading
                        ? "해당 일자 보유 목록을 불러오는 중…"
                        : "이 날짜의 보유 목록이 없습니다."}
                    </td>
                  </tr>
                ) : null}
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fmtEok,
  fmtSignedEok,
  type EtfDbAggregate,
  type EtfDbDimension,
  type EtfDbPayload,
  type EtfDbRow,
} from "@/lib/etfDb";

const DIM_LABEL: Record<EtfDbDimension, string> = {
  type: "유형",
  country: "국가",
  sector: "업종(GICS)",
};

function signedClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function nowClock(): string {
  return new Date().toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function EtfDbTab() {
  const [data, setData] = useState<EtfDbPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<EtfDbDimension>("type");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"aum" | "flow" | "name">("aum");
  const [equityOnly, setEquityOnly] = useState(true);
  const [intraday, setIntraday] = useState<Array<{ t: string; aum: number }>>([]);
  const seriesKeyRef = useRef("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = equityOnly ? "?equity=1" : "";
        const res = await fetch(`/api/etf-db${qs}`, { cache: "no-store" });
        const json = (await res.json()) as EtfDbPayload;
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
    [equityOnly],
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  // Reset category selection when universe filter changes.
  useEffect(() => {
    setSelected(null);
  }, [equityOnly]);

  const aggregates: EtfDbAggregate[] = data?.aggregates?.[dim] || [];
  const maxAum = Math.max(...aggregates.map((a) => a.aum_eok || 0), 1);

  const totalFlow = useMemo(() => {
    if (!aggregates.some((a) => a.flow_available)) return null;
    return aggregates.reduce((s, a) => s + (a.flow_eok || 0), 0);
  }, [aggregates]);

  const selectedAum = useMemo(() => {
    if (!selected) return data?.total_aum_eok ?? null;
    return aggregates.find((a) => a.label === selected)?.aum_eok ?? null;
  }, [selected, aggregates, data]);

  const chartKey = selected || "전체";
  const seriesKey = `${equityOnly ? "eq" : "all"}|${dim}|${chartKey}`;

  // Intraday live buffer — builds a real time series even with 1 daily snapshot.
  useEffect(() => {
    if (selectedAum == null || Number.isNaN(selectedAum)) return;
    if (seriesKeyRef.current !== seriesKey) {
      seriesKeyRef.current = seriesKey;
      setIntraday([{ t: nowClock(), aum: selectedAum }]);
      return;
    }
    setIntraday((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.aum - selectedAum) < 1e-6) {
        return prev;
      }
      return [...prev, { t: nowClock(), aum: selectedAum }].slice(-180);
    });
  }, [selectedAum, seriesKey]);

  const filteredRows: EtfDbRow[] = useMemo(() => {
    let rows = data?.rows || [];
    if (selected) rows = rows.filter((r) => r[dim] === selected);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.code || "").toLowerCase().includes(q),
      );
    }
    rows = [...rows];
    if (sort === "aum") rows.sort((a, b) => (b.aum_eok || 0) - (a.aum_eok || 0));
    else if (sort === "flow") {
      rows.sort((a, b) => (b.flow_eok ?? -1e99) - (a.flow_eok ?? -1e99));
    } else rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
    return rows;
  }, [data, selected, dim, query, sort]);

  const chartMode = useMemo<"daily" | "intraday">(() => {
    const hist = data?.aum_history?.[dim];
    const vals = hist?.series?.[chartKey] || [];
    const nonempty = vals.filter((v) => v != null).length;
    if ((hist?.dates?.length || 0) >= 2 && nonempty >= 2) return "daily";
    return "intraday";
  }, [data, dim, chartKey]);

  const chartData = useMemo(() => {
    if (chartMode === "intraday") {
      const pts =
        intraday.length > 0
          ? intraday
          : selectedAum != null
            ? [{ t: nowClock(), aum: selectedAum }]
            : [];
      return pts.map((p) => ({ label: p.t, aum: p.aum }));
    }

    const hist = data?.aum_history?.[dim];
    const dates = hist?.dates || [];
    const vals = hist?.series?.[chartKey] || [];
    const today = data?.as_of;
    const points = dates.map((date, i) => ({
      label: date,
      aum: vals[i] ?? null,
    }));

    if (selectedAum != null && today) {
      if (points.length && points[points.length - 1].label === today) {
        points[points.length - 1].aum = selectedAum;
      } else {
        points.push({ label: today, aum: selectedAum });
      }
    } else if (selectedAum != null && !points.length) {
      points.push({ label: today || "live", aum: selectedAum });
    }

    return points;
  }, [chartMode, intraday, selectedAum, data, dim, chartKey]);

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">ETF DB</h2>
          <p className="kr-note">
            국내 상장 ETF · 유형/국가/GICS 업종(+바이오·헬스케어·배당·커버드콜·액티브) ·
            AUM 일별 시계열 · 수급(NAV×Δ설정좌수)
          </p>
        </div>
        <div className="etfdb-hero-actions">
          <label className="etfdb-toggle">
            <input
              type="checkbox"
              checked={equityOnly}
              onChange={(e) => setEquityOnly(e.target.checked)}
            />
            주식형 ETF만
          </label>
          <button type="button" className="tab-btn" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">ETF 전종목 불러오는 중…</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}

      {data ? (
        <>
          <div className="etfdb-stats">
            <div>
              <div className="etfdb-stat-k">
                {equityOnly ? "주식형 ETF" : "상장 ETF"}
              </div>
              <div className="etfdb-stat-v">
                {data.count.toLocaleString("ko-KR")}종
              </div>
            </div>
            <div>
              <div className="etfdb-stat-k">
                {selected ? `${selected} AUM` : "AUM 합계"}
              </div>
              <div className="etfdb-stat-v">{fmtEok(selectedAum)}</div>
            </div>
            <div>
              <div className="etfdb-stat-k">추정 수급</div>
              <div className={`etfdb-stat-v ${signedClass(totalFlow)}`}>
                {totalFlow == null
                  ? data.prev_as_of
                    ? "부분"
                    : "대기중"
                  : fmtSignedEok(totalFlow)}
              </div>
            </div>
          </div>
          <p className="kr-note">
            {data.generated_at_display}
            {equityOnly ? " · 주식형만 (채권·원자재·기타 제외)" : " · 전체 ETF"}
            {" · "}
            {chartMode === "intraday"
              ? "AUM 라이브(당일 포인트) — 일별 히스토리 로딩 전"
              : "AUM 일별 추정(가격×설정좌수 근사) + 당일 라이브"}
            {data.prev_as_of ? ` · 수급 전일 ${data.prev_as_of}` : ""}
          </p>

          <div className="tabs etfdb-dim-tabs" role="tablist" aria-label="분류">
            {(Object.keys(DIM_LABEL) as EtfDbDimension[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`tab-btn ${dim === id ? "active" : ""}`}
                onClick={() => {
                  setDim(id);
                  setSelected(null);
                }}
              >
                {DIM_LABEL[id]}
              </button>
            ))}
          </div>

          <div className="etfdb-layout">
            <aside className="etfdb-cats">
              <button
                type="button"
                className={`etfdb-cat ${selected == null ? "active" : ""}`}
                onClick={() => setSelected(null)}
              >
                <span className="etfdb-cat-name">전체</span>
                <span className="etfdb-cat-sub">
                  <span>{data.count}종</span>
                  <span>{fmtEok(data.total_aum_eok)}</span>
                </span>
              </button>
              {aggregates.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`etfdb-cat ${selected === a.label ? "active" : ""}`}
                  onClick={() => setSelected(a.label)}
                >
                  <span className="etfdb-cat-name">{a.label}</span>
                  <span className="etfdb-cat-sub">
                    <span>
                      {a.count}종 · {a.aum_share_pct.toFixed(1)}%
                    </span>
                    <span className={signedClass(a.flow_eok)}>
                      {a.flow_available ? fmtSignedEok(a.flow_eok) : "—"}
                    </span>
                  </span>
                  <span className="etfdb-bar">
                    <i style={{ width: `${(100 * a.aum_eok) / maxAum}%` }} />
                  </span>
                </button>
              ))}
            </aside>

            <div className="etfdb-main">
              <h3 className="etfdb-detail-title" style={{ marginBottom: "0.5rem" }}>
                AUM 합산 · {chartKey}
                <span className="etfdb-chart-mode">
                  {chartMode === "intraday" ? "라이브" : `일별 · ${chartData.length}일`}
                </span>
              </h3>
              <div className="etfdb-chart">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={chartData}>
                      <defs>
                        <linearGradient id="aumFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4da3ff" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#4da3ff" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(43,54,72,0.8)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} minTickGap={28} />
                      <YAxis
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        tickFormatter={(v) => fmtEok(Number(v))}
                        width={58}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        formatter={(v) => fmtEok(typeof v === "number" ? v : null)}
                        contentStyle={{
                          background: "#141d2b",
                          border: "1px solid #2b3648",
                        }}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="aum"
                        name={`${chartKey} AUM`}
                        stroke="#4da3ff"
                        fill="url(#aumFill)"
                        strokeWidth={2}
                        dot={{ r: chartData.length < 3 ? 4 : 2 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="empty">AUM 데이터를 불러오는 중…</p>
                )}
              </div>

              <div className="etfdb-toolbar">
                <h3 className="etfdb-detail-title">
                  {selected || "전체"} · {filteredRows.length}종
                </h3>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="종목명·코드 검색"
                  className="etfdb-search"
                />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="etfdb-search"
                >
                  <option value="aum">AUM 큰순</option>
                  <option value="flow">수급 큰순</option>
                  <option value="name">이름순</option>
                </select>
              </div>

              <div className="etfdb-table-wrap">
                <table className="etfdb-table">
                  <thead>
                    <tr>
                      <th>코드</th>
                      <th>종목</th>
                      <th className="num">AUM</th>
                      <th className="num">NAV</th>
                      <th className="num">설정좌수</th>
                      <th className="num">수급</th>
                      <th className="num">등락</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 400).map((r) => (
                      <tr key={r.code}>
                        <td>
                          <code>{r.code}</code>
                        </td>
                        <td>{r.name}</td>
                        <td className="num">{fmtEok(r.aum_eok)}</td>
                        <td className="num">
                          {r.nav == null
                            ? "—"
                            : r.nav.toLocaleString("ko-KR", {
                                maximumFractionDigits: 2,
                              })}
                        </td>
                        <td className="num">
                          {r.units == null
                            ? "—"
                            : Math.round(r.units).toLocaleString("ko-KR")}
                        </td>
                        <td className={`num ${signedClass(r.flow_eok)}`}>
                          {fmtSignedEok(r.flow_eok)}
                        </td>
                        <td className={`num ${signedClass(r.change_rate)}`}>
                          {r.change_rate == null
                            ? "—"
                            : `${r.change_rate > 0 ? "+" : ""}${r.change_rate.toFixed(2)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

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

const COLORS = [
  "#4da3ff",
  "#3dd68c",
  "#fbbf24",
  "#ff6b6b",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#84cc16",
];

function signedClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

export default function EtfDbTab() {
  const [data, setData] = useState<EtfDbPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<EtfDbDimension>("type");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"aum" | "flow" | "name">("aum");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/etf-db", { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

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

  const chartData = useMemo(() => {
    const hist = data?.aum_history?.[dim];
    if (!hist?.dates?.length) return [];
    const key = selected || "전체";
    const vals = hist.series[key];
    if (!vals) return [];
    return hist.dates.map((date, i) => ({
      date,
      [key]: vals[i] ?? null,
    }));
  }, [data, dim, selected]);

  const chartKey = selected || "전체";

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">ETF DB</h2>
          <p className="kr-note">
            국내 상장 ETF 전종목 · 유형/국가/GICS 업종(+헬스케어·배당·커버드콜·액티브) ·
            AUM 합산 시계열(라이브) · 수급(NAV×Δ설정좌수)
          </p>
        </div>
        <button type="button" className="tab-btn" onClick={() => void load()}>
          새로고침
        </button>
      </div>

      {loading && !data ? <p className="empty">ETF 전종목 불러오는 중…</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}

      {data ? (
        <>
          <div className="etfdb-stats">
            <div>
              <div className="etfdb-stat-k">상장 ETF</div>
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
            {data.generated_at_display} · AUM 차트 60초 라이브 갱신
            {data.prev_as_of
              ? ` · 수급 기준 전일 스냅샷 ${data.prev_as_of}`
              : " · 수급은 Render 봇 일별 스냅샷 축적 후 표시"}
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
                AUM 시계열 · {chartKey}
              </h3>
              <div className="etfdb-chart">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="rgba(43,54,72,0.8)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: "#8fa3b8", fontSize: 11 }} />
                      <YAxis
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        tickFormatter={(v) => fmtEok(Number(v))}
                        width={56}
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
                      <Line
                        type="monotone"
                        dataKey={chartKey}
                        name={`${chartKey} AUM`}
                        stroke={COLORS[0]}
                        dot={{ r: 2 }}
                        strokeWidth={2}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="empty">AUM 시계열을 준비 중입니다…</p>
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

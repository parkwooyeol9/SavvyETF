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
  fmtSignedUsdMn,
  fmtUsdMn,
  type EtfDbUsAggregate,
  type EtfDbUsDimension,
  type EtfDbUsPayload,
  type EtfDbUsRow,
} from "@/lib/etfDbUs";

const DIM_LABEL: Record<EtfDbUsDimension, string> = {
  type: "유형",
  region: "지역",
  sector: "업종",
  theme: "테마",
};

const WATCH_THEMES = [
  "귀금속",
  "방산",
  "원전·우라늄",
  "희토류·전략금속",
  "원유·에너지",
  "전쟁·해운",
];

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

export default function EtfDbUsTab() {
  const [data, setData] = useState<EtfDbUsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<EtfDbUsDimension>("theme");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"aum" | "flow" | "name" | "change">("aum");
  const [equityOnly, setEquityOnly] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [intraday, setIntraday] = useState<Array<{ t: string; aum: number }>>([]);
  const seriesKeyRef = useRef("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (equityOnly) qs.set("equity", "1");
        if (watchOnly) qs.set("watch", "1");
        const res = await fetch(`/api/etf-db-us?${qs.toString()}`);
        const json = (await res.json()) as EtfDbUsPayload;
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
    [equityOnly, watchOnly],
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(true), 90_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    setSelected(null);
  }, [equityOnly, watchOnly]);

  const aggregates: EtfDbUsAggregate[] = useMemo(
    () => data?.aggregates?.[dim] || [],
    [data, dim],
  );
  const maxAum = Math.max(...aggregates.map((a) => a.aum_mn || 0), 1);

  const totalFlow = useMemo(() => {
    if (!aggregates.some((a) => a.flow_available)) return null;
    return aggregates.reduce((s, a) => s + (a.flow_mn || 0), 0);
  }, [aggregates]);

  const selectedAum = useMemo(() => {
    if (!selected) return data?.total_aum_mn ?? null;
    return aggregates.find((a) => a.label === selected)?.aum_mn ?? null;
  }, [selected, aggregates, data]);

  const chartKey = selected || "전체";
  const seriesKey = `${equityOnly ? "eq" : "all"}|${watchOnly ? "w" : "u"}|${dim}|${chartKey}`;

  useEffect(() => {
    if (selectedAum == null || Number.isNaN(selectedAum)) return;
    if (seriesKeyRef.current !== seriesKey) {
      seriesKeyRef.current = seriesKey;
      setIntraday([{ t: nowClock(), aum: selectedAum }]);
      return;
    }
    setIntraday((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.aum - selectedAum) < 1e-6) return prev;
      return [...prev, { t: nowClock(), aum: selectedAum }].slice(-180);
    });
  }, [selectedAum, seriesKey]);

  const filteredRows: EtfDbUsRow[] = useMemo(() => {
    let rows = data?.rows || [];
    if (selected) rows = rows.filter((r) => r[dim] === selected);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.symbol || "").toLowerCase().includes(q) ||
          (r.theme || "").toLowerCase().includes(q) ||
          (r.sector || "").toLowerCase().includes(q),
      );
    }
    rows = [...rows];
    if (sort === "aum") rows.sort((a, b) => (b.aum_mn || 0) - (a.aum_mn || 0));
    else if (sort === "flow") {
      rows.sort((a, b) => (b.flow_mn ?? -1e99) - (a.flow_mn ?? -1e99));
    } else if (sort === "change") {
      rows.sort((a, b) => (b.change_rate ?? -1e99) - (a.change_rate ?? -1e99));
    } else rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "en"));
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
      if (points.length && points[points.length - 1]!.label === today) {
        points[points.length - 1]!.aum = selectedAum;
      } else {
        points.push({ label: today, aum: selectedAum });
      }
    }
    return points;
  }, [chartMode, intraday, selectedAum, data, dim, chartKey]);

  const watchThemeAggs = useMemo(() => {
    const themeAggs = data?.aggregates?.theme || [];
    return WATCH_THEMES.map((label) => themeAggs.find((a) => a.label === label)).filter(
      Boolean,
    ) as EtfDbUsAggregate[];
  }, [data]);

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">ETF DB(US)</h2>
          <p className="kr-note">
            미국 상장 ETF · 유형/지역/업종/테마 · AUM · 수급(NAV×Δ설정좌수, KR ETF DB와
            동일 산출). 귀금속·방산·원전·희토류(REMX)·원유·BWET 등 전략·지정학 테마
            우선 추적.
          </p>
        </div>
        <div className="etfdb-hero-actions">
          <label className="etfdb-toggle">
            <input
              type="checkbox"
              checked={watchOnly}
              onChange={(e) => setWatchOnly(e.target.checked)}
            />
            관심 테마만
          </label>
          <label className="etfdb-toggle">
            <input
              type="checkbox"
              checked={equityOnly}
              onChange={(e) => setEquityOnly(e.target.checked)}
            />
            주식형만
          </label>
          <button type="button" className="tab-btn" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">미국 ETF 불러오는 중…</p> : null}
      {error ? <p className="empty">오류: {error}</p> : null}

      {data ? (
        <>
          {watchThemeAggs.length ? (
            <div className="etfdbus-watch">
              {watchThemeAggs.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`etfdbus-watch-card ${selected === a.label && dim === "theme" ? "active" : ""}`}
                  onClick={() => {
                    setDim("theme");
                    setSelected(a.label);
                  }}
                >
                  <strong>{a.label}</strong>
                  <span>
                    {a.count}종 · {fmtUsdMn(a.aum_mn)}
                  </span>
                  <span className={signedClass(a.flow_mn)}>
                    {a.flow_available ? fmtSignedUsdMn(a.flow_mn) : "수급 대기"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="etfdb-stats">
            <div>
              <div className="etfdb-stat-k">추적 ETF</div>
              <div className="etfdb-stat-v">{data.count.toLocaleString("en-US")}종</div>
            </div>
            <div>
              <div className="etfdb-stat-k">
                {selected ? `${selected} AUM` : "AUM 합계"}
              </div>
              <div className="etfdb-stat-v">{fmtUsdMn(selectedAum)}</div>
            </div>
            <div>
              <div className="etfdb-stat-k">추정 수급</div>
              <div className={`etfdb-stat-v ${signedClass(totalFlow)}`}>
                {totalFlow == null
                  ? data.prev_as_of
                    ? "부분"
                    : "대기중"
                  : fmtSignedUsdMn(totalFlow)}
              </div>
            </div>
          </div>

          <p className="kr-note">
            {data.generated_at_display}
            {equityOnly ? " · 주식형만" : " · 전체(채권·원자재 포함)"}
            {watchOnly ? " · 관심 테마만" : ""}
            {" · "}
            {chartMode === "intraday"
              ? "AUM 라이브 — 일별 히스토리 축적 전"
              : `AUM 일별 · ${chartData.length}일`}
            {data.prev_as_of ? ` · 수급 전일 ${data.prev_as_of}` : " · 수급은 익일부터 산출"}
            {" · "}
            {data.source}
          </p>
          <p className="meta-soft">{data.note}</p>

          <div className="tabs etfdb-dim-tabs" role="tablist" aria-label="분류">
            {(Object.keys(DIM_LABEL) as EtfDbUsDimension[]).map((id) => (
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
                  <span>{fmtUsdMn(data.total_aum_mn)}</span>
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
                    <span className={signedClass(a.flow_mn)}>
                      {a.flow_available ? fmtSignedUsdMn(a.flow_mn) : "—"}
                    </span>
                  </span>
                  <span className="etfdb-bar">
                    <i style={{ width: `${(100 * a.aum_mn) / maxAum}%` }} />
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
                        <linearGradient id="aumUsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(43,54,72,0.8)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        minTickGap={28}
                      />
                      <YAxis
                        tick={{ fill: "#8fa3b8", fontSize: 11 }}
                        tickFormatter={(v) => fmtUsdMn(Number(v))}
                        width={64}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        formatter={(v) => fmtUsdMn(typeof v === "number" ? v : null)}
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
                        stroke="#34d399"
                        fill="url(#aumUsFill)"
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
                  placeholder="심볼·종목·테마 검색"
                  className="etfdb-search"
                />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="etfdb-search"
                >
                  <option value="aum">AUM 큰순</option>
                  <option value="flow">수급 큰순</option>
                  <option value="change">등락 큰순</option>
                  <option value="name">이름순</option>
                </select>
              </div>

              <div className="etfdb-table-wrap">
                <table className="etfdb-table">
                  <thead>
                    <tr>
                      <th>심볼</th>
                      <th>종목</th>
                      <th>테마</th>
                      <th className="num">AUM</th>
                      <th className="num">가격</th>
                      <th className="num">설정좌수</th>
                      <th className="num">수급</th>
                      <th className="num">등락</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 400).map((r) => (
                      <tr key={r.symbol} className={r.watch ? "etfdbus-watch-row" : undefined}>
                        <td>
                          <code>{r.symbol}</code>
                        </td>
                        <td>{r.name}</td>
                        <td className="meta-soft">{r.theme}</td>
                        <td className="num">{fmtUsdMn(r.aum_mn)}</td>
                        <td className="num">
                          {r.price == null
                            ? "—"
                            : r.price.toLocaleString("en-US", {
                                maximumFractionDigits: 2,
                              })}
                        </td>
                        <td className="num">
                          {r.units == null
                            ? "—"
                            : Math.round(r.units).toLocaleString("en-US")}
                        </td>
                        <td className={`num ${signedClass(r.flow_mn)}`}>
                          {fmtSignedUsdMn(r.flow_mn)}
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

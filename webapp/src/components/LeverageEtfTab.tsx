"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from "recharts";

import {
  LEV_GROUP_METAS,
  fmtPct,
  fmtShares,
  fmtValueEok,
  type LevDeleverBucket,
  type LevInvestorDay,
  type SingleStockLevBoard,
  type SingleStockLevRow,
} from "@/lib/krMarket";

type Panel = "groups" | "products" | "investors" | "dealers";
type UnderlyingFilter = "all" | "samsung" | "hynix";

type ApiPayload = {
  ok: boolean;
  error?: string;
  generated_at?: string;
  board?: SingleStockLevBoard;
};

function toneClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="lev-progress-track" aria-hidden>
      <div
        className="lev-progress-fill"
        style={{ width: `${w}%`, background: color || "#38bdf8" }}
      />
    </div>
  );
}

function DeleverKpi({ bucket }: { bucket: LevDeleverBucket }) {
  return (
    <div>
      <span style={bucket.color ? { color: bucket.color } : undefined}>
        {bucket.label}
      </span>
      <strong>{bucket.progress_pct.toFixed(0)}%</strong>
      <em>
        잔여 {bucket.remaining_pct.toFixed(0)}% · AUM{" "}
        {fmtValueEok(bucket.current_aum_eok)} / 피크{" "}
        {fmtValueEok(bucket.peak_aum_eok)}
      </em>
      <ProgressBar pct={bucket.progress_pct} color={bucket.color} />
    </div>
  );
}

export default function LeverageEtfTab() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>("groups");
  const [filter, setFilter] = useState<UnderlyingFilter>("all");
  const [valueMode, setValueMode] = useState<"cum" | "daily">("cum");
  const [selectedCode, setSelectedCode] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kr-leverage");
      const json = (await res.json()) as ApiPayload;
      setData(json);
      setSelectedCode((prev) => {
        if (prev) return prev;
        return json.board?.products?.[0]?.code || "";
      });
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
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const board = data?.board;
  const products = useMemo(() => {
    const rows = board?.products || [];
    if (filter === "all") return rows;
    return rows.filter((r) => r.underlying === filter);
  }, [board?.products, filter]);

  const selected = useMemo(
    () => products.find((p) => p.code === selectedCode) || products[0] || null,
    [products, selectedCode],
  );

  const groupAumChart = useMemo(() => {
    if (!board?.groups?.length) return [];
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
  }, [board?.groups]);

  const groupValueChart = useMemo(() => {
    if (!board?.groups?.length) return [];
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
  }, [board?.groups, valueMode]);

  const investorSeries: LevInvestorDay[] = useMemo(() => {
    if (!board || !selected) return [];
    return board.investors_by_code?.[selected.code] || [];
  }, [board, selected]);

  const investorChart = useMemo(
    () =>
      investorSeries.map((d) => ({
        t: d.date.slice(5),
        volume: Math.round(d.volume / 1000) / 10, // 만주
        foreign: Math.round(d.foreign_net / 1000) / 10,
        institution: Math.round(d.institution_net / 1000) / 10,
        individual: Math.round(d.individual_net / 1000) / 10,
      })),
    [investorSeries],
  );

  const dealer = selected
    ? board?.dealers_by_code?.[selected.code]
    : undefined;

  const brokerAgg = useMemo(() => {
    const sellMap = new Map<string, number>();
    const buyMap = new Map<string, number>();
    for (const row of products) {
      const d = board?.dealers_by_code?.[row.code];
      if (!d) continue;
      for (const s of d.sell) sellMap.set(s.name, (sellMap.get(s.name) || 0) + s.volume);
      for (const b of d.buy) buyMap.set(b.name, (buyMap.get(b.name) || 0) + b.volume);
    }
    const sell = [...sellMap.entries()]
      .map(([name, volume]) => ({ name, volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 8);
    const buy = [...buyMap.entries()]
      .map(([name, volume]) => ({ name, volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 8);
    return { sell, buy };
  }, [board?.dealers_by_code, products]);

  const delever = board?.deleveraging;
  const deleverChart = useMemo(() => {
    if (!delever) return [];
    const byDate = new Map<string, Record<string, number | string>>();
    const seriesList: { key: string; points: LevDeleverBucket["series"] }[] = [
      { key: "all", points: delever.total.series },
      { key: "lev", points: delever.lev.series },
      { key: "inv", points: delever.inv.series },
    ];
    for (const { key, points } of seriesList) {
      for (const pt of points) {
        const row = byDate.get(pt.date) || { t: pt.date.slice(5) };
        row[key] = Math.round(pt.progress_pct * 10) / 10;
        byDate.set(pt.date, row);
      }
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, row]) => row);
  }, [delever]);

  return (
    <div className="kr-tab lev-tab">
      <div className="kr-hero">
        <div>
          <h2 className="kr-hero-title">레버리지 ETF</h2>
          <p className="kr-hero-sub">
            삼성전자·SK하이닉스 단일종목 레버리지/인버스 16종 · 유형 합산 · 투자자
            순매매 · 거래원 · 청산 프록시
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">레버리지 ETF 불러오는 중…</p> : null}
      {data && !data.ok ? (
        <p className="empty">로드 실패: {data.error || "unknown"}</p>
      ) : null}

      {board ? (
        <>
          <nav className="tabs tabs-secondary lev-panels" aria-label="레버리지 분석 패널">
            {(
              [
                ["groups", "유형 추이"],
                ["products", "종목 테이블"],
                ["investors", "투자자"],
                ["dealers", "거래원"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`tab-btn sub ${panel === id ? "active" : ""}`}
                onClick={() => setPanel(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="seg lev-filter">
            {(
              [
                ["all", "전체"],
                ["samsung", "삼성전자"],
                ["hynix", "SK하이닉스"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {panel === "groups" ? (
            <article className="kr-card">
              <div className="kr-card-head">
                <div>
                  <h3 className="kr-card-title">단일종목 레버리지 · 4유형 합산</h3>
                  <p className="kr-card-sub">
                    전자 2x · 전자 -2x · 닉스 -2x · 닉스 2x · {board.listing_date} 상장~
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
              </div>
              <h4 className="kr-mini-title">유형별 AUM 추이</h4>
              <p className="kr-card-sub">좌축 2x · 우축 -2x (단위: 억)</p>
              <div className="kr-chart">
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={groupAumChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
                    <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis
                      yAxisId="lev"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      width={48}
                    />
                    <YAxis
                      yAxisId="inv"
                      orientation="right"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      width={48}
                    />
                    <Tooltip />
                    <Legend />
                    {LEV_GROUP_METAS.map((g) => (
                      <Line
                        key={g.key}
                        yAxisId={g.direction === "lev" ? "lev" : "inv"}
                        type="monotone"
                        dataKey={g.key}
                        name={g.label}
                        stroke={g.color}
                        dot={false}
                        strokeWidth={2}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="seg" style={{ marginTop: "1rem" }}>
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
              <h4 className="kr-mini-title">유형별 거래대금 추이</h4>
              <div className="kr-chart">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={groupValueChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
                    <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} width={48} />
                    <Tooltip />
                    <Legend />
                    {LEV_GROUP_METAS.map((g) => (
                      <Line
                        key={g.key}
                        type="monotone"
                        dataKey={g.key}
                        name={g.label}
                        stroke={g.color}
                        dot={false}
                        strokeWidth={2}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </article>
          ) : null}

          {panel === "products" ? (
            <article className="kr-card">
              <div className="kr-card-head">
                <div>
                  <h3 className="kr-card-title">16종 종목 테이블</h3>
                  <p className="kr-card-sub">
                    당일 거래대금 순 · 외인/기관/개인 순매매(주)
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="kr-table">
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>유형</th>
                      <th className="num">현재가</th>
                      <th className="num">등락</th>
                      <th className="num">거래대금</th>
                      <th className="num">외인</th>
                      <th className="num">기관</th>
                      <th className="num">개인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((r: SingleStockLevRow) => (
                      <tr
                        key={r.code}
                        className={selected?.code === r.code ? "selected" : ""}
                        onClick={() => setSelectedCode(r.code)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <strong>{r.name.replace(/단일종목|선물/g, "")}</strong>
                          <div className="muted">{r.code}</div>
                        </td>
                        <td>{r.group_label}</td>
                        <td className="num">{r.last.toLocaleString("ko-KR")}</td>
                        <td className={`num ${toneClass(r.change_pct)}`}>
                          {fmtPct(r.change_pct)}
                        </td>
                        <td className="num">{fmtValueEok(r.value_eok)}</td>
                        <td className={`num ${toneClass(r.foreign_net)}`}>
                          {fmtShares(r.foreign_net)}
                        </td>
                        <td className={`num ${toneClass(r.institution_net)}`}>
                          {fmtShares(r.institution_net)}
                        </td>
                        <td className={`num ${toneClass(r.individual_net)}`}>
                          {fmtShares(r.individual_net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ) : null}

          {panel === "investors" && selected ? (
            <article className="kr-card">
              <div className="kr-card-head">
                <div>
                  <h3 className="kr-card-title">투자자별 매매동향 · {selected.name}</h3>
                  <p className="kr-card-sub">
                    일별 거래량 + 외국인·기관·개인 순매매량 (단위 차트: 만주)
                  </p>
                </div>
                <select
                  className="lev-select"
                  value={selected.code}
                  onChange={(e) => setSelectedCode(e.target.value)}
                >
                  {products.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.group_label} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="kr-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={investorChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
                    <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis
                      yAxisId="net"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      width={48}
                    />
                    <YAxis
                      yAxisId="vol"
                      orientation="right"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      width={48}
                    />
                    <Tooltip />
                    <Legend />
                    <Bar
                      yAxisId="vol"
                      dataKey="volume"
                      name="거래량"
                      fill="#64748b"
                      opacity={0.35}
                    />
                    <Line
                      yAxisId="net"
                      type="monotone"
                      dataKey="foreign"
                      name="외인"
                      stroke="#3b82f6"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="net"
                      type="monotone"
                      dataKey="institution"
                      name="기관"
                      stroke="#10b981"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="net"
                      type="monotone"
                      dataKey="individual"
                      name="개인"
                      stroke="#f59e0b"
                      dot={false}
                      strokeWidth={2}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="table-wrap" style={{ marginTop: "1rem" }}>
                <table className="kr-table">
                  <thead>
                    <tr>
                      <th>일자</th>
                      <th className="num">거래량</th>
                      <th className="num">외인</th>
                      <th className="num">기관</th>
                      <th className="num">개인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...investorSeries].reverse().slice(0, 20).map((d) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td className="num">{d.volume.toLocaleString("ko-KR")}</td>
                        <td className={`num ${toneClass(d.foreign_net)}`}>
                          {fmtShares(d.foreign_net)}
                        </td>
                        <td className={`num ${toneClass(d.institution_net)}`}>
                          {fmtShares(d.institution_net)}
                        </td>
                        <td className={`num ${toneClass(d.individual_net)}`}>
                          {fmtShares(d.individual_net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ) : null}

          {panel === "dealers" && selected ? (
            <article className="kr-card">
              <div className="kr-card-head">
                <div>
                  <h3 className="kr-card-title">거래원 정보 · {selected.name}</h3>
                  <p className="kr-card-sub">
                    매도상위·매수상위 증권사 및 거래량 (네이버 일별 상위, 20분 지연)
                  </p>
                </div>
                <select
                  className="lev-select"
                  value={selected.code}
                  onChange={(e) => setSelectedCode(e.target.value)}
                >
                  {products.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.group_label} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {dealer && (dealer.sell.length || dealer.buy.length) ? (
                <div className="lev-dealer-grid">
                  <div>
                    <h4 className="kr-mini-title">매도상위</h4>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={dealer.sell} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
                        <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={72}
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                        />
                        <Tooltip />
                        <Bar dataKey="volume" name="거래량" fill="#ef4444" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <h4 className="kr-mini-title">매수상위</h4>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={dealer.buy} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
                        <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={72}
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                        />
                        <Tooltip />
                        <Bar dataKey="volume" name="거래량" fill="#3b82f6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <p className="empty">
                  {dealer?.note ||
                    "현재 거래원 상위가 비어 있습니다. 장중·지연 반영 후 다시 새로고침하세요."}
                </p>
              )}

              <h4 className="kr-mini-title" style={{ marginTop: "1.25rem" }}>
                필터 종목 합산 증권사 순위
              </h4>
              {brokerAgg.sell.length || brokerAgg.buy.length ? (
                <div className="lev-dealer-grid">
                  <div className="table-wrap">
                    <table className="kr-table">
                      <thead>
                        <tr>
                          <th>매도 합산</th>
                          <th className="num">거래량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brokerAgg.sell.map((r) => (
                          <tr key={`s-${r.name}`}>
                            <td>{r.name}</td>
                            <td className="num">{r.volume.toLocaleString("ko-KR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-wrap">
                    <table className="kr-table">
                      <thead>
                        <tr>
                          <th>매수 합산</th>
                          <th className="num">거래량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brokerAgg.buy.map((r) => (
                          <tr key={`b-${r.name}`}>
                            <td>{r.name}</td>
                            <td className="num">{r.volume.toLocaleString("ko-KR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="empty">합산할 거래원 데이터가 없습니다.</p>
              )}
            </article>
          ) : null}

          {delever ? (
            <article className="kr-card lev-delever-card">
              <div className="kr-card-head">
                <div>
                  <h3 className="kr-card-title">디레버리징 프록시 · 청산 진행도</h3>
                  <p className="kr-card-sub">{delever.note}</p>
                </div>
              </div>

              <div className="kr-flow-summary">
                <div>
                  <span>전체 청산 진행도</span>
                  <strong>{delever.total.progress_pct.toFixed(0)}%</strong>
                  <em>
                    잔여 좌수 {delever.total.remaining_pct.toFixed(0)}% · 피크{" "}
                    {delever.total.peak_units_date}
                  </em>
                  <ProgressBar pct={delever.total.progress_pct} />
                </div>
                <div>
                  <span>AUM 피크 대비 하락</span>
                  <strong>{delever.total.aum_drawdown_pct.toFixed(0)}%</strong>
                  <em>
                    {fmtValueEok(delever.total.current_aum_eok)} / 피크{" "}
                    {fmtValueEok(delever.total.peak_aum_eok)} (
                    {delever.total.peak_aum_date})
                  </em>
                </div>
                <DeleverKpi bucket={delever.lev} />
                <DeleverKpi bucket={delever.inv} />
              </div>

              <div className="kr-flow-summary kr-lev-group-summary">
                {delever.by_group.map((g) => (
                  <DeleverKpi key={g.key} bucket={g} />
                ))}
              </div>

              <h4 className="kr-mini-title">청산 진행도 추이 (좌수 피크 대비)</h4>
              <div className="kr-chart">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={deleverChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#243044" />
                    <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      width={40}
                      domain={[0, 100]}
                      unit="%"
                    />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="all"
                      name="전체"
                      stroke="#e2e8f0"
                      dot={false}
                      strokeWidth={2.5}
                    />
                    <Line
                      type="monotone"
                      dataKey="lev"
                      name="레버리지"
                      stroke="#3b82f6"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="inv"
                      name="인버스"
                      stroke="#f59e0b"
                      dot={false}
                      strokeWidth={2}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="table-wrap" style={{ marginTop: "1rem" }}>
                <table className="kr-table">
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th className="num">진행도</th>
                      <th className="num">잔여</th>
                      <th className="num">현재 AUM</th>
                      <th className="num">피크 AUM</th>
                      <th>좌수 피크일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[delever.total, delever.lev, delever.inv, ...delever.by_group].map(
                      (b) => (
                        <tr key={b.key}>
                          <td style={b.color ? { color: b.color } : undefined}>
                            {b.label}
                          </td>
                          <td className="num">{b.progress_pct.toFixed(1)}%</td>
                          <td className="num">{b.remaining_pct.toFixed(1)}%</td>
                          <td className="num">{fmtValueEok(b.current_aum_eok)}</td>
                          <td className="num">{fmtValueEok(b.peak_aum_eok)}</td>
                          <td>{b.peak_units_date}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          ) : null}

          <p className="kr-footnote">
            {board.note} · 약 60초마다 갱신
            {data.generated_at
              ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false })}`
              : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}

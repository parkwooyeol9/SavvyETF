"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  filterByMonths,
  fmtNum,
  fmtPct,
  heatStyle,
  HEAT_METRICS,
  normalizeIndex,
  num,
  SAVVYDB_EXTERNAL,
  SECTOR_METRICS,
  seriesForChart,
  toneClass,
  type SavvyCountryRow,
  type SavvyMeta,
  type SavvyPoint,
  type SavvySectorRow,
  type SavvyStockRow,
  type SavvyThemeRow,
} from "@/lib/savvyDb";

type ViewId = "sectors" | "stocks" | "countries" | "longval" | "themes";

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "sectors", label: "업종 · 스타일" },
  { id: "stocks", label: "미국 주식" },
  { id: "countries", label: "국가 모델" },
  { id: "longval", label: "장기 밸류에이션" },
  { id: "themes", label: "ETF 비교" },
];

const tip = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
  fontSize: 11,
};

async function loadFile<T>(file: string): Promise<T> {
  const res = await fetch(`/api/savvydb?file=${encodeURIComponent(file)}`);
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok || json.data == null) {
    throw new Error(json.error || `${file} 로드 실패`);
  }
  return json.data;
}

function mergeSeries(
  a: Array<{ t: string; v: number | null }>,
  b: Array<{ t: string; v: number | null }> | null,
  nameA: string,
  nameB: string,
): Array<Record<string, string | number | null>> {
  const map = new Map<string, Record<string, string | number | null>>();
  for (const p of a) {
    map.set(p.t, { t: p.t.slice(5), [nameA]: p.v });
  }
  if (b) {
    for (const p of b) {
      const row = map.get(p.t) || { t: p.t.slice(5) };
      row[nameB] = p.v;
      map.set(p.t, row);
    }
  }
  return [...map.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([, v]) => v);
}

function RangeChips({
  months,
  onChange,
}: {
  months: number;
  onChange: (m: number) => void;
}) {
  return (
    <div className="seg">
      {(
        [
          [3, "3M"],
          [6, "6M"],
          [12, "1Y"],
          [0, "전체"],
        ] as const
      ).map(([m, label]) => (
        <button
          key={label}
          type="button"
          className={months === m ? "active" : ""}
          onClick={() => onChange(m)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function LinePanel({
  series,
  nameA,
  nameB,
}: {
  series: Array<Record<string, string | number | null>>;
  nameA: string;
  nameB?: string;
}) {
  if (!series.length) {
    return <p className="empty">선택한 항목의 시계열이 원본에 없습니다.</p>;
  }
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={series}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
          <XAxis
            dataKey="t"
            tick={{ fill: "#8b9bb4", fontSize: 10 }}
            minTickGap={28}
          />
          <YAxis tick={{ fill: "#8b9bb4", fontSize: 10 }} width={48} />
          <Tooltip contentStyle={tip} />
          <Legend />
          <Line
            type="monotone"
            dataKey={nameA}
            stroke="#5b9fd4"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {nameB ? (
            <Line
              type="monotone"
              dataKey={nameB}
              stroke="#e8c547"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SectorsView({ meta }: { meta: SavvyMeta | null }) {
  const [rows, setRows] = useState<SavvySectorRow[]>([]);
  const [daily, setDaily] = useState<Record<string, SavvyPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("미국");
  const [id, setId] = useState("XLK");
  const [heat, setHeat] = useState("E");
  const [metric, setMetric] = useState("H");
  const [compare, setCompare] = useState("");
  const [months, setMonths] = useState(0);
  const [sortKey, setSortKey] = useState("E");
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, d] = await Promise.all([
          loadFile<SavvySectorRow[]>("sectors"),
          loadFile<Record<string, SavvyPoint[]>>("sector-daily"),
        ]);
        if (cancelled) return;
        setRows(s);
        setDaily(d);
      } catch (exc) {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : String(exc));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pool = useMemo(
    () => rows.filter((r) => r.group === group),
    [rows, group],
  );
  const selected = pool.find((r) => r.id === id) || pool[0] || null;
  const selectedId = selected?.id || "";

  useEffect(() => {
    if (selected && selected.id !== id) setId(selected.id);
  }, [selected, id]);

  const sorted = useMemo(() => {
    const list = [...pool];
    list.sort((a, b) => {
      const av = num(a.values[sortKey]);
      const bv = num(b.values[sortKey]);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * (asc ? 1 : -1);
    });
    return list;
  }, [pool, sortKey, asc]);

  const metricSeries = useMemo(() => {
    if (!selected) return [];
    const a = seriesForChart(selected.history?.[metric], months);
    const comp = pool.find((x) => x.id === compare);
    const b = comp ? seriesForChart(comp.history?.[metric], months) : null;
    return mergeSeries(a, b, selected.name, comp?.name || "비교");
  }, [selected, metric, months, compare, pool]);

  const dailySeries = useMemo(() => {
    if (!selected || group !== "미국") return [];
    const key = selected.name === "미국" ? "Market" : selected.name;
    let a = filterByMonths(daily[key], months);
    let b = filterByMonths(daily.Market, months);
    a = normalizeIndex(a);
    b = normalizeIndex(b);
    return mergeSeries(
      a.map(([t, v]) => ({ t, v })),
      b.map(([t, v]) => ({ t, v })),
      selected.name,
      "S&P 500",
    );
  }, [selected, group, daily, months]);

  function toggleSort(key: string) {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  }

  function downloadCsv() {
    const cols = ["D", "E", "F", "H", "G", "S"] as const;
    const header = ["시장", "업종", "ETF", "1W", "1M", "3M", "PER", "PBR", "ERR"];
    const body = pool.map((x) =>
      [
        x.group,
        x.name,
        x.ticker,
        ...cols.map((c) => x.values[c] ?? ""),
      ].join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "savvyetf-sectors.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) return <p className="empty">업종 스냅샷 불러오는 중…</p>;
  if (error) return <p className="empty warn">{error}</p>;
  if (!selected) return <p className="empty">업종 데이터가 없습니다.</p>;

  const v = selected.values;

  return (
    <>
      <div className="feature-head geo-head-row">
        <div>
          <p className="eyebrow">01 / SECTOR EXPLORER</p>
          <h3 className="geo-section-title">업종의 흐름을 읽다</h3>
          <p className="macro-subhead">
            미국·일본 업종 성과·이익 전망·밸류에이션 비교
            {meta?.snapshotDate ? ` · 스냅샷 ${meta.snapshotDate}` : ""}
          </p>
        </div>
        <div className="kr-hero-actions">
          <label className="sdb-field">
            시장
            <select
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setId("");
                setCompare("");
              }}
            >
              <option value="미국">미국</option>
              <option value="일본">일본</option>
            </select>
          </label>
          <label className="sdb-field">
            업종
            <select value={selectedId} onChange={(e) => setId(e.target.value)}>
              {pool.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.ticker}
                </option>
              ))}
            </select>
          </label>
          <label className="sdb-field">
            히트맵
            <select value={heat} onChange={(e) => setHeat(e.target.value)}>
              {HEAT_METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="nxt-stat-grid">
        <div className="geo-featured">
          <div className="meta-soft">1개월 수익률</div>
          <strong className={`nxt-stat-val ${toneClass(v.E)}`}>
            {fmtPct(v.E)}
          </strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">12개월 선행 PER</div>
          <strong className="nxt-stat-val">{fmtNum(v.H)}배</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">EPS 1Y 성장률</div>
          <strong className={`nxt-stat-val ${toneClass(v.M)}`}>
            {fmtPct(v.M)}
          </strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">애널리스트 ERR</div>
          <strong className={`nxt-stat-val ${toneClass(v.S)}`}>
            {fmtNum(v.S)}%
          </strong>
        </div>
      </div>

      <p className="meta-soft" style={{ marginBottom: 6 }}>
        업종 퍼포먼스
      </p>
      <div className="sdb-heat">
        {pool.map((x) => {
          const z = x.values[heat];
          const st = heatStyle(z);
          return (
            <button
              key={x.id}
              type="button"
              className={`sdb-heat-btn${x.id === selectedId ? " selected" : ""}`}
              style={st}
              onClick={() => setId(x.id)}
            >
              <b>{x.name}</b>
              <span>{fmtPct(z)}</span>
              <small>{x.ticker}</small>
            </button>
          );
        })}
      </div>

      <div className="nxt-chart-grid" style={{ marginTop: 14 }}>
        <div>
          <div className="kr-hero-actions" style={{ marginBottom: 8 }}>
            <label className="sdb-field">
              차트 지표
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              >
                {Object.entries(SECTOR_METRICS).map(([k, lab]) => (
                  <option key={k} value={k}>
                    {lab}
                  </option>
                ))}
              </select>
            </label>
            <label className="sdb-field">
              비교
              <select
                value={compare}
                onChange={(e) => setCompare(e.target.value)}
              >
                <option value="">비교 없음</option>
                {pool
                  .filter((x) => x.id !== selectedId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            <RangeChips months={months} onChange={setMonths} />
          </div>
          <LinePanel
            series={metricSeries}
            nameA={selected.name}
            nameB={compare ? pool.find((x) => x.id === compare)?.name : undefined}
          />
          <p className="meta-soft" style={{ marginTop: 6 }}>
            출처: 업종·테마·스타일 스냅샷 · 관측일 지표 (누적 수익률 아님)
          </p>
        </div>
        <div>
          <p className="meta-soft" style={{ marginBottom: 8 }}>
            선택 업종 · {selected.ticker} / {selected.group}
          </p>
          <h3 className="geo-section-title" style={{ marginTop: 0 }}>
            {selected.name}
          </h3>
          <dl className="sdb-dl">
            <div>
              <dt>PBR</dt>
              <dd>{fmtNum(v.G)}배</dd>
            </div>
            <div>
              <dt>ROE</dt>
              <dd>{fmtNum(v.K)}%</dd>
            </div>
            <div>
              <dt>EPS 3M 변화</dt>
              <dd className={toneClass(v.L)}>{fmtPct(v.L)}</dd>
            </div>
            <div>
              <dt>RSI</dt>
              <dd>{fmtNum(v.O)}</dd>
            </div>
            <div>
              <dt>MACD</dt>
              <dd>{fmtNum(v.P)}</dd>
            </div>
            <div>
              <dt>추세 / 심리</dt>
              <dd>
                {String(v.Q ?? "—")} / {String(v.R ?? "—")}
              </dd>
            </div>
            <div>
              <dt>ERR 전월차</dt>
              <dd>{fmtNum(v.U)}%p</dd>
            </div>
            <div>
              <dt>원본 순위</dt>
              <dd>{fmtNum(v.V, 0)}</dd>
            </div>
          </dl>
          <p className="meta-soft" style={{ marginTop: 8 }}>
            RSI 과매도 기준은 원본 모델의 40 미만. 순위·추세는 원본 저장값입니다.
          </p>
        </div>
      </div>

      {group === "미국" ? (
        <div style={{ marginTop: 12 }}>
          <p className="meta-soft" style={{ marginBottom: 6 }}>
            업종 지수 추이 (구간 시작 = 100)
          </p>
          <LinePanel
            series={dailySeries}
            nameA={selected.name}
            nameB="S&P 500"
          />
        </div>
      ) : null}

      <div className="feature-head geo-head-row" style={{ marginTop: 14 }}>
        <p className="meta-soft">업종 비교표</p>
        <button type="button" className="ghost-btn" onClick={downloadCsv}>
          CSV ↓
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>이름 / 티커</th>
              {(
                [
                  ["D", "1W"],
                  ["E", "1M"],
                  ["F", "3M"],
                  ["H", "PER"],
                  ["G", "PBR"],
                  ["S", "ERR"],
                ] as const
              ).map(([k, lab]) => (
                <th key={k}>
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ padding: "0 4px", fontSize: 11 }}
                    onClick={() => toggleSort(k)}
                  >
                    {lab}
                    {sortKey === k ? (asc ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.id}
                className={r.id === selectedId ? "sdb-row-active" : undefined}
                onClick={() => setId(r.id)}
                style={{ cursor: "pointer" }}
              >
                <td>
                  <strong>{r.ticker}</strong>{" "}
                  <span className="meta-soft">{r.name}</span>
                </td>
                <td className={toneClass(r.values.D)}>{fmtPct(r.values.D)}</td>
                <td className={toneClass(r.values.E)}>{fmtPct(r.values.E)}</td>
                <td className={toneClass(r.values.F)}>{fmtPct(r.values.F)}</td>
                <td>{fmtNum(r.values.H)}</td>
                <td>{fmtNum(r.values.G)}</td>
                <td className={toneClass(r.values.S)}>{fmtNum(r.values.S)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StocksView() {
  const [rows, setRows] = useState<SavvyStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("");
  const [id, setId] = useState("");
  const [sortKey, setSortKey] = useState("E");
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const s = await loadFile<SavvyStockRow[]>("stocks");
        if (cancelled) return;
        setRows(s);
        setId(s.find((r) => r.ticker === "NVDA")?.id || s[0]?.id || "");
      } catch (exc) {
        if (!cancelled) setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sectors = useMemo(
    () => [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort(),
    [rows],
  );

  const pool = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (sector && r.sector !== sector) return false;
      if (!qq) return true;
      return (
        r.ticker.toLowerCase().includes(qq) ||
        r.name.toLowerCase().includes(qq)
      );
    });
  }, [rows, q, sector]);

  const sorted = useMemo(() => {
    const list = [...pool];
    list.sort((a, b) => {
      const av = num(a.values[sortKey]);
      const bv = num(b.values[sortKey]);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * (asc ? 1 : -1);
    });
    return list.slice(0, 80);
  }, [pool, sortKey, asc]);

  const selected = pool.find((r) => r.id === id) || sorted[0] || null;

  if (loading) return <p className="empty">미국 주식 유니버스 불러오는 중…</p>;
  if (error) return <p className="empty warn">{error}</p>;
  if (!selected) return <p className="empty">종목이 없습니다.</p>;
  const v = selected.values;

  return (
    <>
      <div className="feature-head geo-head-row">
        <div>
          <p className="eyebrow">02 / EQUITY SCREENER</p>
          <h3 className="geo-section-title">미국 주식</h3>
          <p className="macro-subhead">
            {rows.length.toLocaleString()}개 원본 레코드 · 스냅샷 값
          </p>
        </div>
        <div className="kr-hero-actions">
          <input
            className="sdb-search"
            placeholder="티커 · 회사명"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">전체 섹터</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="nxt-stat-grid">
        <div className="geo-featured">
          <div className="meta-soft">{selected.ticker} · 원본가</div>
          <strong className="nxt-stat-val">{fmtNum(v.D)}</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">1개월 수익률</div>
          <strong className={`nxt-stat-val ${toneClass(v.F)}`}>
            {fmtPct(v.F)}
          </strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">선행 PER</div>
          <strong className="nxt-stat-val">{fmtNum(v.AA)}배</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">팩터 종합</div>
          <strong className="nxt-stat-val">{fmtNum(v.AI, 3)}</strong>
        </div>
      </div>
      <div className="nxt-chart-grid">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>종목</th>
                <th>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      setSortKey("E");
                      setAsc((a) => (sortKey === "E" ? !a : false));
                    }}
                  >
                    시가총액
                  </button>
                </th>
                <th>1M</th>
                <th>PER</th>
                <th>ROE</th>
                <th>점수</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  className={r.id === selected.id ? "sdb-row-active" : undefined}
                  style={{ cursor: "pointer" }}
                  onClick={() => setId(r.id)}
                >
                  <td>
                    <strong>{r.ticker}</strong>{" "}
                    <span className="meta-soft">{r.name}</span>
                  </td>
                  <td>{fmtNum(r.values.E, 0)}</td>
                  <td className={toneClass(r.values.F)}>{fmtPct(r.values.F)}</td>
                  <td>{fmtNum(r.values.AA)}</td>
                  <td>{fmtNum(r.values.K)}</td>
                  <td>{fmtNum(r.values.AI, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">{selected.ticker}</div>
          <h3 className="geo-section-title" style={{ marginTop: 4 }}>
            {selected.name}
          </h3>
          <p className="meta-soft">
            {selected.sector}
            {selected.industry ? ` · ${selected.industry}` : ""}
          </p>
          <dl className="sdb-dl">
            <div>
              <dt>선행 EPS</dt>
              <dd>{fmtNum(v.I)}</dd>
            </div>
            <div>
              <dt>선행 PBR</dt>
              <dd>{fmtNum(v.AB)}배</dd>
            </div>
            <div>
              <dt>배당수익률</dt>
              <dd>{fmtNum(v.W)}%</dd>
            </div>
            <div>
              <dt>부채/자기자본</dt>
              <dd>{fmtNum(v.T)}%</dd>
            </div>
          </dl>
        </div>
      </div>
    </>
  );
}

function CountriesView() {
  const [rows, setRows] = useState<SavvyCountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState("SPY");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const c = await loadFile<SavvyCountryRow[]>("countries");
        if (cancelled) return;
        setRows(c);
        setId(c.find((r) => r.id === "SPY")?.id || c[0]?.id || "");
      } catch (exc) {
        if (!cancelled) setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = rows.find((r) => r.id === id) || rows[0] || null;
  if (loading) return <p className="empty">국가 모델 불러오는 중…</p>;
  if (error) return <p className="empty warn">{error}</p>;
  if (!selected) return <p className="empty">국가 데이터가 없습니다.</p>;
  const v = selected.values;

  return (
    <>
      <div className="feature-head geo-head-row">
        <div>
          <p className="eyebrow">03 / COUNTRY MONITOR</p>
          <h3 className="geo-section-title">국가 모델</h3>
        </div>
        <select value={selected.id} onChange={(e) => setId(e.target.value)}>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.ticker}
            </option>
          ))}
        </select>
      </div>
      <div className="nxt-stat-grid">
        <div className="geo-featured">
          <div className="meta-soft">1년 수익률</div>
          <strong className={`nxt-stat-val ${toneClass(v.T)}`}>
            {fmtPct(v.T)}
          </strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">선행 PER</div>
          <strong className="nxt-stat-val">{fmtNum(v.V)}배</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">경기 국면</div>
          <strong className="nxt-stat-val">{String(v.K ?? "—")}</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">ERR</div>
          <strong className={`nxt-stat-val ${toneClass(v.AA)}`}>
            {fmtNum(v.AA)}%
          </strong>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>국가</th>
              <th>1M</th>
              <th>3M</th>
              <th>1Y</th>
              <th>PER</th>
              <th>PBR</th>
              <th>국면</th>
              <th>RSI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.id === selected.id ? "sdb-row-active" : undefined}
                style={{ cursor: "pointer" }}
                onClick={() => setId(r.id)}
              >
                <td>
                  <strong>{r.name}</strong>{" "}
                  <span className="meta-soft">{r.ticker}</span>
                </td>
                <td className={toneClass(r.values.R)}>{fmtPct(r.values.R)}</td>
                <td className={toneClass(r.values.S)}>{fmtPct(r.values.S)}</td>
                <td className={toneClass(r.values.T)}>{fmtPct(r.values.T)}</td>
                <td>{fmtNum(r.values.V)}</td>
                <td>{fmtNum(r.values.U)}</td>
                <td>{String(r.values.K ?? "—")}</td>
                <td>{fmtNum(r.values.AE)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LongValView() {
  const [data, setData] = useState<Record<
    string,
    Record<string, SavvyPoint[]>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("한국");
  const [metric, setMetric] = useState("per");
  const [months, setMonths] = useState(0);

  const metrics: Record<string, string> = {
    per: "12개월 선행 PER",
    pbr: "12개월 선행 PBR",
    roe: "선행 ROE",
    yield: "선행 배당수익률",
    erp: "ASR 주식위험프리미엄",
    rsi: "국가 ETF RSI",
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const v = await loadFile<Record<string, Record<string, SavvyPoint[]>>>(
          "valuation",
        );
        if (cancelled) return;
        setData(v);
        setName((prev) => (v[prev] ? prev : Object.keys(v)[0] || "한국"));
      } catch (exc) {
        if (!cancelled) setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const countries = useMemo(() => (data ? Object.keys(data).sort() : []), [data]);
  const series = useMemo(() => {
    if (!data?.[name]?.[metric]) return [];
    return seriesForChart(data[name][metric], months).map((p) => ({
      t: p.t.slice(0, 7),
      [metrics[metric]]: p.v,
    }));
  }, [data, name, metric, months]);

  if (loading) return <p className="empty">장기 밸류에이션 불러오는 중…</p>;
  if (error) return <p className="empty warn">{error}</p>;

  return (
    <>
      <div className="feature-head geo-head-row">
        <div>
          <p className="eyebrow">04 / VALUATION LAB</p>
          <h3 className="geo-section-title">장기 밸류에이션</h3>
        </div>
        <div className="kr-hero-actions">
          <select value={name} onChange={(e) => setName(e.target.value)}>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {Object.entries(metrics).map(([k, lab]) => (
              <option key={k} value={k}>
                {lab}
              </option>
            ))}
          </select>
          <RangeChips months={months} onChange={setMonths} />
        </div>
      </div>
      <LinePanel series={series} nameA={metrics[metric]} />
    </>
  );
}

function ThemesView() {
  const [rows, setRows] = useState<SavvyThemeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [id, setId] = useState("SPY");
  const [sortKey, setSortKey] = useState("ret");
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Original savvyDB #themes loads data/etfs.json (not themes.json).
        const t = await loadFile<SavvyThemeRow[]>("etfs");
        if (cancelled) return;
        setRows(t);
        setId(
          t.find((r) => r.id === "ACWI.O" || r.ticker === "ACWI")?.id ||
            t.find((r) => r.id === "SPY")?.id ||
            t[0]?.id ||
            "",
        );
      } catch (exc) {
        if (!cancelled) setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pool = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter(
      (r) =>
        r.ticker.toLowerCase().includes(qq) ||
        r.name.toLowerCase().includes(qq) ||
        r.group.toLowerCase().includes(qq),
    );
  }, [rows, q]);

  const sorted = useMemo(() => {
    const list = [...pool];
    list.sort((a, b) => {
      const av = num(a.values[sortKey]);
      const bv = num(b.values[sortKey]);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * (asc ? 1 : -1);
    });
    return list;
  }, [pool, sortKey, asc]);

  const selected = pool.find((r) => r.id === id) || sorted[0] || null;

  const scatter = useMemo(
    () =>
      pool
        .map((r) => ({
          id: r.id,
          ticker: r.ticker,
          vol: num(r.values.vol),
          ret: num(r.values.ret),
          selected: r.id === (selected?.id || ""),
        }))
        .filter((r) => r.vol != null && r.ret != null),
    [pool, selected],
  );

  if (loading) return <p className="empty">ETF 비교 불러오는 중…</p>;
  if (error) return <p className="empty warn">{error}</p>;
  if (!selected) return <p className="empty">ETF가 없습니다.</p>;
  const v = selected.values;

  return (
    <>
      <div className="feature-head geo-head-row">
        <div>
          <p className="eyebrow">05 / ETF COMPARISON</p>
          <h3 className="geo-section-title">ETF 비교</h3>
          <p className="macro-subhead">
            중복 제거 · {rows.length}개 ETF · 수익률·변동성·보수·평가점수
          </p>
        </div>
        <input
          className="sdb-search"
          placeholder="ETF · 국가 · 업종"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="nxt-stat-grid">
        <div className="geo-featured">
          <div className="meta-soft">{selected.ticker} · 1Y</div>
          <strong className={`nxt-stat-val ${toneClass(v.ret)}`}>
            {fmtPct(v.ret)}
          </strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">총보수</div>
          <strong className="nxt-stat-val">{fmtNum(v.fee)}%</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">변동성</div>
          <strong className="nxt-stat-val">{fmtNum(v.vol)}%</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">샤프</div>
          <strong className="nxt-stat-val">{fmtNum(v.sharpe, 3)}</strong>
        </div>
      </div>

      <div className="nxt-chart-grid">
        <div>
          <p className="meta-soft" style={{ marginBottom: 6 }}>
            위험과 수익률 (가로: 1Y 변동성 · 세로: 1Y 총수익률)
          </p>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
                <XAxis
                  type="number"
                  dataKey="vol"
                  name="변동성"
                  tick={{ fill: "#8b9bb4", fontSize: 10 }}
                  unit="%"
                />
                <YAxis
                  type="number"
                  dataKey="ret"
                  name="수익률"
                  tick={{ fill: "#8b9bb4", fontSize: 10 }}
                  unit="%"
                  width={44}
                />
                <Tooltip
                  contentStyle={tip}
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(value: number | string, name: string) => [
                    typeof value === "number" ? value.toFixed(2) : value,
                    name === "ret" ? "1Y 수익률" : name === "vol" ? "변동성" : name,
                  ]}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as
                      | { ticker?: string }
                      | undefined;
                    return p?.ticker || "";
                  }}
                />
                <Scatter
                  data={scatter.filter((d) => !d.selected)}
                  fill="#5b9fd4"
                  fillOpacity={0.55}
                  onClick={(d) => {
                    const row = d as { id?: string };
                    if (row.id) setId(row.id);
                  }}
                />
                <Scatter
                  data={scatter.filter((d) => d.selected)}
                  fill="#e8c547"
                  onClick={(d) => {
                    const row = d as { id?: string };
                    if (row.id) setId(row.id);
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="meta-soft">
            출처: 업종·테마·스타일 → ETF매칭 / 기타 (savvyDB etfs.json)
          </p>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">
            {selected.ticker} · {selected.group}
          </div>
          <h3 className="geo-section-title" style={{ marginTop: 4 }}>
            {selected.name}
          </h3>
          <dl className="sdb-dl">
            <div>
              <dt>종합</dt>
              <dd>{fmtNum(v.overall, 0)}</dd>
            </div>
            <div>
              <dt>성과</dt>
              <dd>{fmtNum(v.performance, 0)}</dd>
            </div>
            <div>
              <dt>리스크</dt>
              <dd>{fmtNum(v.risk, 0)}</dd>
            </div>
            <div>
              <dt>비용</dt>
              <dd>{fmtNum(v.cost, 0)}</dd>
            </div>
            <div>
              <dt>펀더멘털</dt>
              <dd>{fmtNum(v.fundamental, 0)}</dd>
            </div>
            <div>
              <dt>밸류에이션</dt>
              <dd>{fmtNum(v.valuation, 0)}</dd>
            </div>
            <div>
              <dt>테크니컬</dt>
              <dd>{fmtNum(v.technical, 0)}</dd>
            </div>
            <div>
              <dt>센티먼트</dt>
              <dd>{fmtNum(v.sentiment, 0)}</dd>
            </div>
          </dl>
          <p className="meta-soft" style={{ marginTop: 8 }}>
            {selected.sheet ? `${selected.sheet}!${selected.row}:${selected.row}` : ""}
            · 평가점수는 원본 TR.ETF Score 저장값
          </p>
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>ETF</th>
              <th>분류</th>
              {(
                [
                  ["fee", "TER"],
                  ["ret", "1Y"],
                  ["vol", "변동성"],
                  ["sharpe", "샤프"],
                  ["overall", "종합"],
                ] as const
              ).map(([k, lab]) => (
                <th key={k}>
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ padding: "0 4px", fontSize: 11 }}
                    onClick={() => {
                      if (sortKey === k) setAsc((a) => !a);
                      else {
                        setSortKey(k);
                        setAsc(false);
                      }
                    }}
                  >
                    {lab}
                    {sortKey === k ? (asc ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.id}
                className={r.id === selected.id ? "sdb-row-active" : undefined}
                style={{ cursor: "pointer" }}
                onClick={() => setId(r.id)}
              >
                <td>
                  <strong>{r.ticker}</strong>{" "}
                  <span className="meta-soft">{r.name}</span>
                </td>
                <td>{r.group}</td>
                <td>{fmtNum(r.values.fee)}</td>
                <td className={toneClass(r.values.ret)}>
                  {fmtPct(r.values.ret)}
                </td>
                <td>{fmtNum(r.values.vol)}</td>
                <td>{fmtNum(r.values.sharpe, 3)}</td>
                <td>{fmtNum(r.values.overall, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ValuationTab() {
  const [view, setView] = useState<ViewId>("sectors");
  const [meta, setMeta] = useState<SavvyMeta | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const m = await loadFile<SavvyMeta>("meta");
      setMeta(m);
    } catch {
      setMeta(null);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  return (
    <section className="sdb-tab geo-section">
      <div className="kr-hero">
        <div>
          <h2 className="kr-hero-title">밸류에이션</h2>
          <p className="kr-hero-sub">
            savvyDB Excel 스냅샷 기반 리서치 · 실시간 시세 아님
            {meta?.snapshotDate ? ` · 기준 ${meta.snapshotDate}` : ""}
          </p>
        </div>
        <div className="kr-hero-actions">
          <a
            className="ghost-btn"
            href={SAVVYDB_EXTERNAL}
            target="_blank"
            rel="noreferrer"
          >
            원본 savvyDB 열기 ↗
          </a>
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 14 }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={view === v.id ? "active" : ""}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "sectors" ? <SectorsView meta={meta} /> : null}
      {view === "stocks" ? <StocksView /> : null}
      {view === "countries" ? <CountriesView /> : null}
      {view === "longval" ? <LongValView /> : null}
      {view === "themes" ? <ThemesView /> : null}
    </section>
  );
}

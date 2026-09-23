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

import {
  fmtNum,
  fmtPct,
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
  opts?: { shortLabel?: boolean },
): Array<Record<string, string | number | null>> {
  const short = opts?.shortLabel !== false;
  const map = new Map<string, Record<string, string | number | null>>();
  for (const p of a) {
    map.set(p.t, { t: short ? p.t.slice(5) : p.t, [nameA]: p.v });
  }
  if (b) {
    for (const p of b) {
      const row = map.get(p.t) || { t: short ? p.t.slice(5) : p.t };
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("미국");
  const [id, setId] = useState("XLK");
  const [metric, setMetric] = useState("H");
  const [compare, setCompare] = useState("");
  const [months, setMonths] = useState(0);
  const [sortKey, setSortKey] = useState("H");
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = await loadFile<SavvySectorRow[]>("sectors");
        if (cancelled) return;
        setRows(s);
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

  function toggleSort(key: string) {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  }

  function downloadCsv() {
    const cols = ["H", "G", "K", "S", "L", "M", "O"] as const;
    const header = [
      "시장",
      "업종",
      "ETF",
      "PER",
      "PBR",
      "ROE",
      "ERR",
      "EPS3M",
      "EPS1Y",
      "RSI",
    ];
    const body = pool.map((x) =>
      [x.group, x.name, x.ticker, ...cols.map((c) => x.values[c] ?? "")].join(
        ",",
      ),
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
            미국·일본 업종 밸류에이션·이익 전망·ERR 비교
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
        </div>
      </div>

      <div className="nxt-stat-grid">
        <div className="geo-featured">
          <div className="meta-soft">12개월 선행 PER</div>
          <strong className="nxt-stat-val">{fmtNum(v.H)}배</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">선행 PBR</div>
          <strong className="nxt-stat-val">{fmtNum(v.G)}배</strong>
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
        업종 선택 · 선행 PER
      </p>
      <div className="sdb-heat">
        {pool.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`sdb-heat-btn${x.id === selectedId ? " selected" : ""}`}
            onClick={() => setId(x.id)}
          >
            <b>{x.name}</b>
            <span>{fmtNum(x.values.H)}배</span>
            <small>{x.ticker}</small>
          </button>
        ))}
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
            nameB={
              compare ? pool.find((x) => x.id === compare)?.name : undefined
            }
          />
          <p className="meta-soft" style={{ marginTop: 6 }}>
            출처: 업종·테마·스타일 스냅샷 · 관측일 밸류·이익 지표
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
                  ["H", "PER"],
                  ["G", "PBR"],
                  ["K", "ROE"],
                  ["S", "ERR"],
                  ["L", "EPS3M"],
                  ["O", "RSI"],
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
                <td>{fmtNum(r.values.H)}</td>
                <td>{fmtNum(r.values.G)}</td>
                <td>{fmtNum(r.values.K)}</td>
                <td className={toneClass(r.values.S)}>{fmtNum(r.values.S)}</td>
                <td className={toneClass(r.values.L)}>{fmtPct(r.values.L)}</td>
                <td>{fmtNum(r.values.O)}</td>
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
            {rows.length.toLocaleString()}개 원본 레코드 · 밸류·팩터 스냅샷
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
          <div className="meta-soft">선행 PER</div>
          <strong className="nxt-stat-val">{fmtNum(v.AA)}배</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">선행 PBR</div>
          <strong className="nxt-stat-val">{fmtNum(v.AB)}배</strong>
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
              <dt>ROE</dt>
              <dd>{fmtNum(v.K)}%</dd>
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
          <p className="macro-subhead">밸류에이션 · 경기 국면 · ERR</p>
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
          <div className="meta-soft">선행 PER</div>
          <strong className="nxt-stat-val">{fmtNum(v.V)}배</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">선행 PBR</div>
          <strong className="nxt-stat-val">{fmtNum(v.U)}배</strong>
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
              <th>PER</th>
              <th>PBR</th>
              <th>ERR</th>
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
                <td>{fmtNum(r.values.V)}</td>
                <td>{fmtNum(r.values.U)}</td>
                <td className={toneClass(r.values.AA)}>{fmtNum(r.values.AA)}</td>
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
  const METRICS: Record<string, string> = {
    per: "12개월 선행 PER",
    pbr: "12개월 선행 PBR",
    roe: "선행 ROE",
    yield: "선행 배당수익률",
    erp: "ASR 주식위험프리미엄",
    rsi: "국가 ETF RSI",
  };

  const [data, setData] = useState<Record<
    string,
    Record<string, SavvyPoint[]>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("한국");
  const [metric, setMetric] = useState("per");
  const [compare, setCompare] = useState("");
  const [months, setMonths] = useState(0);
  const [sortKey, setSortKey] = useState<"last" | "avg" | "name">("last");
  const [asc, setAsc] = useState(false);

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

  const unit =
    metric === "per" || metric === "pbr"
      ? "배"
      : metric === "roe" || metric === "yield"
        ? "%"
        : "";

  const names = useMemo(() => {
    if (!data) return [];
    return Object.keys(data)
      .filter((n) =>
        (data[n]?.[metric] || []).some((p) => num(p[1]) != null),
      )
      .sort((a, b) => a.localeCompare(b, "ko"));
  }, [data, metric]);

  useEffect(() => {
    if (!names.length) return;
    if (!names.includes(name)) setName(names[0]);
    if (compare && !names.includes(compare)) setCompare("");
  }, [names, name, compare]);

  const rawSeries = data?.[name]?.[metric] || [];
  const validAll = useMemo(
    () => rawSeries.filter((p) => num(p[1]) != null) as Array<[string, number]>,
    [rawSeries],
  );
  const last = validAll[validAll.length - 1] || null;
  const valuesAll = validAll.map((p) => p[1]);
  const avgAll =
    valuesAll.length > 0
      ? valuesAll.reduce((a, b) => a + b, 0) / valuesAll.length
      : null;
  const minAll = valuesAll.length ? Math.min(...valuesAll) : null;
  const maxAll = valuesAll.length ? Math.max(...valuesAll) : null;
  const percentile =
    last && valuesAll.length
      ? (100 * valuesAll.filter((x) => x < last[1]).length) / valuesAll.length
      : null;

  const chartSeries = useMemo(() => {
    if (!data) return [];
    const a = seriesForChart(data[name]?.[metric], months);
    const b =
      compare && data[compare]?.[metric]
        ? seriesForChart(data[compare][metric], months)
        : null;
    // Downsample dense ERP/RSI for readable charts.
    const thin = (pts: Array<{ t: string; v: number | null }>) => {
      if (pts.length <= 720) return pts;
      const step = Math.ceil(pts.length / 720);
      const out = pts.filter((_, i) => i % step === 0);
      const tail = pts[pts.length - 1];
      if (out[out.length - 1]?.t !== tail.t) out.push(tail);
      return out;
    };
    return mergeSeries(thin(a), b ? thin(b) : null, name, compare || "비교", {
      shortLabel: false,
    });
  }, [data, name, metric, months, compare]);

  const countryRows = useMemo(() => {
    if (!data) return [];
    const rows = names.map((n) => {
      const pts = (data[n]?.[metric] || []).filter((p) => num(p[1]) != null);
      const l = pts[pts.length - 1];
      const nums = pts.map((p) => num(p[1])!);
      const avg =
        nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      const pct =
        l && nums.length
          ? (100 * nums.filter((x) => x < (num(l[1]) as number)).length) /
            nums.length
          : null;
      return {
        name: n,
        last: num(l?.[1]),
        asOf: l?.[0] || null,
        avg,
        pct,
        n: nums.length,
      };
    });
    rows.sort((a, b) => {
      if (sortKey === "name") {
        return a.name.localeCompare(b.name, "ko") * (asc ? 1 : -1);
      }
      const av = sortKey === "avg" ? a.avg : a.last;
      const bv = sortKey === "avg" ? b.avg : b.last;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * (asc ? 1 : -1);
    });
    return rows;
  }, [data, names, metric, sortKey, asc]);

  const sourceNote = useMemo(() => {
    if (metric === "erp") return "출처: 업종·테마·스타일 → ERP · 원본 저장값";
    if (metric === "rsi") return "출처: 업종·테마·스타일 → 국가RSI_5Y · 원본 저장값";
    const sheet =
      metric === "per"
        ? "시계열_PER"
        : metric === "pbr"
          ? "시계열_PBR"
          : metric === "roe"
            ? "시계열_ROE"
            : "시계열_배당수익률";
    return `출처: 국가 밸류에이션 → ${sheet} · ROE는 원본 PBR/PER 기반 계산값, PER·PBR·배당은 선행 지표`;
  }, [metric]);

  function downloadCsv() {
    const rows = [["date", name], ...rawSeries.map((p) => [p[0], p[1] ?? ""])];
    if (compare && data?.[compare]?.[metric]) {
      rows[0].push(compare);
      const map = new Map(
        data[compare][metric].map((p) => [p[0], p[1]] as const),
      );
      for (let i = 1; i < rows.length; i++) {
        rows[i].push(map.get(String(rows[i][0])) ?? "");
      }
    }
    const csv =
      "\uFEFF" +
      rows
        .map((r) =>
          r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","),
        )
        .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `savvyetf-${name}-${metric}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function toggleSort(key: "last" | "avg" | "name") {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(key === "name");
    }
  }

  if (loading) return <p className="empty">장기 밸류에이션 불러오는 중…</p>;
  if (error) return <p className="empty warn">{error}</p>;
  if (!names.length) return <p className="empty">해당 지표의 국가 데이터가 없습니다.</p>;

  const fmtUnit = (v: unknown, d = 2) => {
    const n = num(v);
    if (n == null) return "—";
    return `${fmtNum(n, d)}${unit}`;
  };

  return (
    <>
      <div className="feature-head geo-head-row">
        <div>
          <p className="eyebrow">04 / VALUATION LAB</p>
          <h3 className="geo-section-title">지금의 가격, 과거의 맥락</h3>
          <p className="macro-subhead">
            국가별 장기 시계열에서 밸류에이션의 상대 위치를 확인합니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <label className="sdb-field">
            지표
            <select
              value={metric}
              onChange={(e) => {
                setMetric(e.target.value);
                setCompare("");
              }}
            >
              {Object.entries(METRICS).map(([k, lab]) => (
                <option key={k} value={k}>
                  {lab}
                </option>
              ))}
            </select>
          </label>
          <label className="sdb-field">
            국가
            <select value={name} onChange={(e) => setName(e.target.value)}>
              {names.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="sdb-field">
            비교
            <select value={compare} onChange={(e) => setCompare(e.target.value)}>
              <option value="">비교 없음</option>
              {names
                .filter((c) => c !== name)
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </label>
          <RangeChips months={months} onChange={setMonths} />
        </div>
      </div>

      <div className="nxt-stat-grid">
        <div className="geo-featured">
          <div className="meta-soft">최근 관측값</div>
          <strong className="nxt-stat-val">{fmtUnit(last?.[1])}</strong>
          <div className="meta-soft">{last?.[0] || "데이터 없음"}</div>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">전체 이력 평균</div>
          <strong className="nxt-stat-val">{fmtUnit(avgAll)}</strong>
          <div className="meta-soft">선택 구간과 무관한 전체 평균</div>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">이력 내 백분위</div>
          <strong className="nxt-stat-val">
            {percentile == null ? "—" : `${fmtNum(percentile, 1)}%`}
          </strong>
          <div className="meta-soft">최근값보다 낮은 관측 비율</div>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">유효 관측치</div>
          <strong className="nxt-stat-val">
            {valuesAll.length.toLocaleString("ko-KR")}
          </strong>
          <div className="meta-soft">결측·오류 제외</div>
        </div>
      </div>

      <p className="meta-soft" style={{ marginBottom: 6 }}>
        {name} · {METRICS[metric]}
        {compare ? ` vs ${compare}` : ""}
        {avgAll != null ? ` · 점선 = 전체 평균 ${fmtUnit(avgAll)}` : ""}
      </p>
      <div style={{ width: "100%", height: 300 }}>
        {chartSeries.length ? (
          <ResponsiveContainer>
            <LineChart data={chartSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
              <XAxis
                dataKey="t"
                tick={{ fill: "#8b9bb4", fontSize: 10 }}
                minTickGap={36}
              />
              <YAxis
                tick={{ fill: "#8b9bb4", fontSize: 10 }}
                width={52}
                tickFormatter={(v: number) =>
                  Number.isFinite(v) ? v.toFixed(unit === "배" ? 1 : 1) : ""
                }
              />
              <Tooltip
                contentStyle={tip}
                formatter={(value: number | string, key: string) => [
                  typeof value === "number"
                    ? `${value.toFixed(2)}${unit}`
                    : value,
                  key,
                ]}
              />
              <Legend />
              {avgAll != null ? (
                <ReferenceLine
                  y={avgAll}
                  stroke="#8b9bb4"
                  strokeDasharray="4 4"
                  label={{
                    value: "평균",
                    fill: "#8b9bb4",
                    fontSize: 10,
                    position: "insideTopRight",
                  }}
                />
              ) : null}
              <Line
                type="monotone"
                dataKey={name}
                stroke="#5b9fd4"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              {compare ? (
                <Line
                  type="monotone"
                  dataKey={compare}
                  stroke="#e8c547"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="empty">선택한 구간에 유효한 시계열이 없습니다.</p>
        )}
      </div>
      <p className="meta-soft" style={{ marginTop: 6 }}>
        {sourceNote}
      </p>

      <div className="nxt-chart-grid" style={{ marginTop: 14 }}>
        <div>
          <div className="feature-head geo-head-row">
            <p className="meta-soft">국가별 최근값 비교 · {METRICS[metric]}</p>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ padding: "0 4px", fontSize: 11 }}
                      onClick={() => toggleSort("name")}
                    >
                      국가{sortKey === "name" ? (asc ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ padding: "0 4px", fontSize: 11 }}
                      onClick={() => toggleSort("last")}
                    >
                      최근값{sortKey === "last" ? (asc ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                  <th>기준일</th>
                  <th>
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ padding: "0 4px", fontSize: 11 }}
                      onClick={() => toggleSort("avg")}
                    >
                      전체 평균{sortKey === "avg" ? (asc ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                  <th>백분위</th>
                </tr>
              </thead>
              <tbody>
                {countryRows.map((r) => (
                  <tr
                    key={r.name}
                    className={r.name === name ? "sdb-row-active" : undefined}
                    style={{ cursor: "pointer" }}
                    onClick={() => setName(r.name)}
                  >
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>{fmtUnit(r.last)}</td>
                    <td className="meta-soft">{r.asOf || "—"}</td>
                    <td>{fmtUnit(r.avg)}</td>
                    <td>
                      {r.pct == null ? "—" : `${fmtNum(r.pct, 1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="geo-featured">
          <p className="meta-soft" style={{ marginBottom: 6 }}>
            해석 기준
          </p>
          <p className="macro-subhead" style={{ marginTop: 0 }}>
            백분위가 높을수록 해당 국가의 과거 관측치 대비 높은 값입니다. 지표마다
            의미가 다르므로 높은 값을 일괄적인 고평가·매도 신호로 해석하지
            않습니다.
          </p>
          <dl className="sdb-dl">
            <div>
              <dt>최저 관측값</dt>
              <dd>{fmtUnit(minAll)}</dd>
            </div>
            <div>
              <dt>최고 관측값</dt>
              <dd>{fmtUnit(maxAll)}</dd>
            </div>
            <div>
              <dt>이력 시작</dt>
              <dd>{validAll[0]?.[0] || "—"}</dd>
            </div>
            <div>
              <dt>이력 종료</dt>
              <dd>{last?.[0] || "—"}</dd>
            </div>
            <div>
              <dt>최근 − 평균</dt>
              <dd className={toneClass((last?.[1] ?? 0) - (avgAll ?? 0))}>
                {last && avgAll != null
                  ? `${last[1] - avgAll > 0 ? "+" : ""}${fmtNum(last[1] - avgAll)}${unit}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>국가 수</dt>
              <dd>{names.length}</dd>
            </div>
          </dl>
          <div className="callout" style={{ marginTop: 10 }}>
            국가별 산업 구성과 성장률 차이를 함께 고려해야 합니다. 차트의 결측치는
            보간하지 않고 끊어서 표시합니다.
          </div>
          <button
            type="button"
            className="ghost-btn"
            style={{ marginTop: 12 }}
            onClick={downloadCsv}
          >
            현재 시계열 CSV ↓
          </button>
        </div>
      </div>
    </>
  );
}

function ThemesView() {
  const [rows, setRows] = useState<SavvyThemeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [id, setId] = useState("SPY");
  const [sortKey, setSortKey] = useState("overall");
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
            중복 제거 · {rows.length}개 ETF · 보수·평가점수
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
          <div className="meta-soft">{selected.ticker} · 종합</div>
          <strong className="nxt-stat-val">{fmtNum(v.overall, 0)}</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">총보수</div>
          <strong className="nxt-stat-val">{fmtNum(v.fee)}%</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">밸류에이션 점수</div>
          <strong className="nxt-stat-val">{fmtNum(v.valuation, 0)}</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">펀더멘털 점수</div>
          <strong className="nxt-stat-val">{fmtNum(v.fundamental, 0)}</strong>
        </div>
      </div>

      <div className="nxt-chart-grid">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ETF</th>
                <th>분류</th>
                {(
                  [
                    ["fee", "TER"],
                    ["overall", "종합"],
                    ["valuation", "밸류"],
                    ["fundamental", "펀더"],
                    ["cost", "비용"],
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
                  <td>{fmtNum(r.values.overall, 0)}</td>
                  <td>{fmtNum(r.values.valuation, 0)}</td>
                  <td>{fmtNum(r.values.fundamental, 0)}</td>
                  <td>{fmtNum(r.values.cost, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
            {selected.sheet
              ? `${selected.sheet}!${selected.row}:${selected.row}`
              : ""}
            · 평가점수는 원본 TR.ETF Score 저장값
          </p>
        </div>
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
            주간 수동 업로드 스냅샷 · 수익률은 시황·포트폴리오 탭 참고
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

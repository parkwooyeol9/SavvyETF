"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
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
  type SavvyFundThemeRow,
  type SavvyHoldingRow,
  type SavvyMeta,
  type SavvyPoint,
  type SavvySectorRow,
  type SavvyStockRow,
  type SavvyThemeRow,
} from "@/lib/savvyDb";

type ViewId =
  | "sectors"
  | "stocks"
  | "countries"
  | "longval"
  | "themes"
  | "fundamentals";

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "sectors", label: "업종 · 스타일" },
  { id: "fundamentals", label: "테마 펀더멘털" },
  { id: "stocks", label: "미국 주식" },
  { id: "countries", label: "국가 모델" },
  { id: "longval", label: "장기 밸류에이션" },
  { id: "themes", label: "ETF 비교" },
];

const FUND_METRICS: Record<string, [string, string]> = {
  per: ["선행 PER", "배"],
  perAvg: ["PER 5Y 평균", "배"],
  perPremium: ["PER 평균 대비", "%"],
  rev1w: ["EPS 조정심리 1W", "%"],
  rev2w: ["EPS 조정심리 2W", "%"],
  rev1m: ["EPS 조정심리 1M", "%"],
  rev3m: ["EPS 조정심리 3M", "%"],
  rev6m: ["EPS 조정심리 6M", "%"],
  epsGrowth: ["선행 EPS 성장", "%"],
  roe: ["ROE", "%"],
  roeGap: ["ROE 평균 대비", "%p"],
  salesGrowth: ["매출 성장률", "%"],
  salesGap: ["매출 성장률 차이", "%p"],
  ev: ["EV/EBITDA", "배"],
  pbr: ["PBR", "배"],
  psr: ["PSR", "배"],
  peg: ["PEG", "배"],
};

const LAG_COLORS = ["#5eead4", "#5b9fd4", "#e8c547", "#bd5663"];

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

const STOCK_FACTORS: Array<{ key: string; label: string }> = [
  { key: "AC", label: "가치" },
  { key: "AD", label: "사이즈" },
  { key: "AE", label: "배당" },
  { key: "AF", label: "성장" },
  { key: "AG", label: "모멘텀" },
  { key: "AH", label: "퀄리티" },
];

function FactorBars({ values }: { values: Record<string, unknown> }) {
  return (
    <div className="sdb-factors">
      {STOCK_FACTORS.map(({ key, label }) => {
        const z = num(values[key]);
        const w = z == null ? 0 : Math.min(50, (Math.abs(z) / 3) * 50);
        const left = z != null && z < 0 ? 50 - w : 50;
        return (
          <div key={key} className="sdb-factor">
            <span>{label}</span>
            <div className="sdb-factor-track">
              <i
                style={{
                  left: `${left}%`,
                  width: `${w}%`,
                  background:
                    z != null && z < 0
                      ? "rgba(201,123,132,0.85)"
                      : "rgba(91,159,212,0.9)",
                }}
              />
            </div>
            <b>{fmtNum(z, 2)}</b>
          </div>
        );
      })}
      <p className="meta-soft" style={{ marginTop: 8 }}>
        원본 표준화 팩터 · 막대 범위 ±3 · 종합은 원본 가중치 적용값
      </p>
    </div>
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
          <h3 className="geo-section-title">미국 주식, 한 종목 더 깊이</h3>
          <p className="macro-subhead">
            {rows.length.toLocaleString()}개 원본 레코드 · 가격·이익·팩터
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
          <div className="meta-soft">{selected.ticker} · 원본 현재가</div>
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
          <div className="meta-soft">원본 팩터 종합</div>
          <strong className="nxt-stat-val">{fmtNum(v.AI, 3)}</strong>
          <div className="meta-soft">원본 순위 {fmtNum(v.AJ, 0)}위</div>
        </div>
      </div>
      <div className="nxt-chart-grid">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>종목</th>
                {(
                  [
                    ["E", "시가총액"],
                    ["AA", "PER"],
                    ["K", "ROE"],
                    ["AI", "종합"],
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
                  <td>{fmtNum(r.values.E, 0)}</td>
                  <td>{fmtNum(r.values.AA)}</td>
                  <td>{fmtNum(r.values.K)}</td>
                  <td>{fmtNum(r.values.AI, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="geo-featured">
            <div className="meta-soft">종목 프로필 · {selected.ticker}</div>
            <h3 className="geo-section-title" style={{ marginTop: 4 }}>
              {selected.name}
            </h3>
            <p className="meta-soft">
              {selected.sector}
              {selected.industry ? ` · ${selected.industry}` : ""}
            </p>
            <dl className="sdb-dl">
              <div>
                <dt>시가총액¹</dt>
                <dd>{fmtNum(v.E, 0)}</dd>
              </div>
              <div>
                <dt>선행 EPS</dt>
                <dd>{fmtNum(v.I)}</dd>
              </div>
              <div>
                <dt>선행 PBR</dt>
                <dd>{fmtNum(v.AB)}배</dd>
              </div>
              <div>
                <dt>선행 ROE</dt>
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
              <div>
                <dt>FCF 수익률</dt>
                <dd>{fmtNum(v.V)}%</dd>
              </div>
            </dl>
            <p className="meta-soft" style={{ marginTop: 8 }}>
              ¹ 시가총액은 MARKET VALUE 원본 단위 · UNIVERSE!
              {selected.row ?? "—"}
            </p>
          </div>
          <div className="geo-featured" style={{ marginTop: 12 }}>
            <div className="meta-soft">팩터 점수</div>
            <FactorBars values={v} />
          </div>
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

function LagBarPanel({
  series,
  unit,
}: {
  series: Array<{ name: string; points: SavvyPoint[] }>;
  unit: string;
}) {
  const cats = [
    ...new Set(series.flatMap((s) => s.points.map((p) => p[0]))),
  ];
  const data = cats.map((cat) => {
    const row: Record<string, string | number | null> = { t: cat };
    for (const s of series) {
      const pt = s.points.find((p) => p[0] === cat);
      row[s.name] = num(pt?.[1]);
    }
    return row;
  });
  const hasVal = data.some((d) =>
    series.some((s) => num(d[s.name]) != null),
  );
  if (!hasVal) {
    return <p className="empty">유효한 원본 관측값이 없습니다.</p>;
  }
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
          <XAxis dataKey="t" tick={{ fill: "#8b9bb4", fontSize: 10 }} />
          <YAxis
            width={44}
            tick={{ fill: "#8b9bb4", fontSize: 10 }}
            tickFormatter={(v: number) => `${fmtNum(v, 1)}${unit === "%" || unit === "%p" ? "" : ""}`}
          />
          <Tooltip
            contentStyle={tip}
            formatter={(value: number | string, name: string) => [
              typeof value === "number"
                ? `${fmtNum(value)}${unit}`
                : value,
              name,
            ]}
          />
          <Legend />
          {series.map((s, i) => (
            <Bar
              key={s.name}
              dataKey={s.name}
              fill={LAG_COLORS[i % LAG_COLORS.length]}
              radius={[3, 3, 0, 0]}
              maxBarSize={36}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function revPoints(row: SavvyFundThemeRow): SavvyPoint[] {
  const v = row.values;
  return [
    ["1주", num(v.rev1w)],
    ["2주", num(v.rev2w)],
    ["1개월", num(v.rev1m)],
    ["3개월", num(v.rev3m)],
    ["6개월", num(v.rev6m)],
  ];
}

function FundamentalsView() {
  const [rows, setRows] = useState<SavvyFundThemeRow[]>([]);
  const [holdings, setHoldings] = useState<SavvyHoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [id, setId] = useState("SOXX");
  const [compare, setCompare] = useState("");
  const [lag, setLag] = useState<"roe" | "ev" | "pbr" | "psr">("roe");
  const [holdingId, setHoldingId] = useState("");
  const [hmetric, setHmetric] = useState<"per" | "eps" | "price">("per");
  const [sortKey, setSortKey] = useState("rev1m");
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const t = await loadFile<SavvyFundThemeRow[]>("fundamentals");
        if (cancelled) return;
        setRows(t);
        setId(
          t.find((r) => r.id === "SOXX")?.id || t[0]?.id || "",
        );
      } catch (exc) {
        if (!cancelled)
          setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setHoldingsLoading(true);
      try {
        const h = await loadFile<SavvyHoldingRow[]>(`holdings-${id}`);
        if (cancelled) return;
        setHoldings(h);
        const top = [...h].sort(
          (a, b) => (num(b.values.weight) ?? 0) - (num(a.values.weight) ?? 0),
        )[0];
        setHoldingId(top?.id || "");
      } catch {
        if (!cancelled) {
          setHoldings([]);
          setHoldingId("");
        }
      } finally {
        if (!cancelled) setHoldingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const pool = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter(
      (r) =>
        r.ticker.toLowerCase().includes(qq) ||
        r.name.toLowerCase().includes(qq) ||
        r.id.toLowerCase().includes(qq),
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

  const selected =
    pool.find((r) => r.id === id) ||
    rows.find((r) => r.id === id) ||
    sorted[0] ||
    null;
  const compareRow = compare
    ? rows.find((r) => r.id === compare) || null
    : null;
  const holding =
    holdings.find((h) => h.id === holdingId) ||
    [...holdings].sort(
      (a, b) => (num(b.values.weight) ?? 0) - (num(a.values.weight) ?? 0),
    )[0] ||
    null;

  const coverageKey: "roe" | "per" | "ev" | "pbr" | "psr" | "rev1m" = [
    "roe",
    "per",
    "ev",
    "pbr",
    "psr",
    "rev1m",
  ].includes(lag)
    ? lag
    : "roe";
  const coveragePct =
    selected && selected.weightSum
      ? ((selected.coverage?.[coverageKey] ?? 0) / selected.weightSum) * 100
      : 0;
  const maxWeight = Math.max(
    ...holdings.map((h) => num(h.values.weight) ?? 0),
    0,
  );

  const downloadCsv = () => {
    const keys = Object.keys(FUND_METRICS);
    const header = [
      "ETF",
      "테마",
      ...keys.map((k) => FUND_METRICS[k].join(" ")),
    ];
    const body = rows.map((r) =>
      [r.id, r.name, ...keys.map((k) => r.values[k] ?? "")].join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "savvyDB-thematic-fundamentals.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <p className="empty">테마 펀더멘털 불러오는 중…</p>;
  if (error && !selected) return <p className="empty warn">{error}</p>;
  if (!selected) return <p className="empty">테마 ETF가 없습니다.</p>;
  const v = selected.values;

  return (
    <>
      <div className="feature-head geo-head-row">
        <div>
          <p className="eyebrow">THEMATIC FUNDAMENTALS / KBAM</p>
          <h3 className="geo-section-title">테마를 구성종목까지 들여다보다</h3>
          <p className="macro-subhead">
            {rows.length}개 테마 ETF의 편입종목, 이익 조정심리와 밸류에이션을
            연결합니다.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="sdb-search"
            placeholder="반도체, 전력, SOXX…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="sdb-select"
            value={selected.id}
            onChange={(e) => {
              setId(e.target.value);
              setHoldingId("");
            }}
          >
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.ticker} · {r.name}
              </option>
            ))}
          </select>
          <select
            className="sdb-select"
            value={compare}
            onChange={(e) => setCompare(e.target.value)}
          >
            <option value="">비교 없음</option>
            {rows
              .filter((r) => r.id !== selected.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.ticker} · {r.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="nxt-stat-grid">
        <div className="geo-featured">
          <div className="meta-soft">{selected.ticker} · 선행 PER</div>
          <strong className="nxt-stat-val">{fmtNum(v.per)}배</strong>
          <div className="meta-soft">원본 구성종목 가중합</div>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">EPS 조정심리 · 1M</div>
          <strong className={`nxt-stat-val ${toneClass(v.rev1m)}`}>
            {fmtPct(v.rev1m)}
          </strong>
          <div className="meta-soft">상향−하향 조정 비율의 가중합</div>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">PER 5년 평균 대비</div>
          <strong className={`nxt-stat-val ${toneClass(v.perPremium)}`}>
            {fmtPct(v.perPremium)}
          </strong>
          <div className="meta-soft">현재 가중합 / 평균 가중합 − 1</div>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">편입종목</div>
          <strong className="nxt-stat-val">
            {selected.holdingsCount.toLocaleString()}
          </strong>
          <div className="meta-soft">
            원본 편입비 합계 {fmtNum(selected.weightSum)}%
          </div>
        </div>
      </div>

      {selected.warnings?.length ? (
        <div className="callout" style={{ marginBottom: 12 }}>
          <strong>데이터 점검</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {selected.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="nxt-chart-grid">
        <div>
          <div className="geo-featured" style={{ marginBottom: 12 }}>
            <div
              className="feature-head geo-head-row"
              style={{ marginBottom: 8 }}
            >
              <h3 className="geo-section-title" style={{ fontSize: 16 }}>
                {selected.name} · 펀더멘털 구간 비교
              </h3>
              <select
                className="sdb-select"
                value={lag}
                onChange={(e) =>
                  setLag(e.target.value as "roe" | "ev" | "pbr" | "psr")
                }
              >
                <option value="roe">ROE (%)</option>
                <option value="ev">EV/EBITDA (배)</option>
                <option value="pbr">PBR (배)</option>
                <option value="psr">PSR (배)</option>
              </select>
            </div>
            <p className="meta-soft" style={{ marginBottom: 8 }}>
              현재 구성종목과 편입비로 계산된 과거 상대 시점 값입니다. 과거 ETF
              포트폴리오의 실제 성과나 일별 시계열이 아닙니다.
            </p>
            <LagBarPanel
              series={[
                {
                  name: selected.id,
                  points: [...(selected.lags?.[lag] || [])].reverse(),
                },
                ...(compareRow
                  ? [
                      {
                        name: compareRow.id,
                        points: [
                          ...(compareRow.lags?.[lag] || []),
                        ].reverse(),
                      },
                    ]
                  : []),
              ]}
              unit={lag === "roe" ? "%" : "배"}
            />
            <p className="meta-soft">
              KBAM → {selected.ticker}!1행 · 1년 전 / 3개월 전 / 1개월 전 /
              2주 전 / 1주 전 / 현재. 실제 관측일은 원본에 미기재.
            </p>
          </div>

          <div className="geo-featured" style={{ marginBottom: 12 }}>
            <h3 className="geo-section-title" style={{ fontSize: 16 }}>
              애널리스트 조정심리
            </h3>
            <LagBarPanel
              series={[
                { name: selected.id, points: revPoints(selected) },
                ...(compareRow
                  ? [{ name: compareRow.id, points: revPoints(compareRow) }]
                  : []),
              ]}
              unit="%"
            />
            <p className="meta-soft" style={{ marginTop: 8 }}>
              종목별 (상향 조정 수 − 하향 조정 수) ÷ 전체 애널리스트 수를
              편입비로 가중했습니다. 각 기간의 조정 활동을 비교하는 지표이며
              EPS 금액 증감률이 아닙니다.
            </p>
          </div>

          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <div
              className="feature-head geo-head-row"
              style={{ marginBottom: 8 }}
            >
              <h3 className="geo-section-title" style={{ fontSize: 16 }}>
                테마 ETF 비교
              </h3>
              <button
                type="button"
                className="ghost-btn"
                onClick={downloadCsv}
              >
                전체 지표 CSV ↓
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ETF</th>
                  {(
                    [
                      ["rev1m", "조정심리 1M"],
                      ["per", "PER"],
                      ["perPremium", "평균 대비"],
                      ["roe", "ROE (%)"],
                      ["epsGrowth", "선행 EPS 성장"],
                      ["ev", "EV/EBITDA"],
                      ["pbr", "PBR"],
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
                    className={
                      r.id === selected.id ? "sdb-row-active" : undefined
                    }
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setId(r.id);
                      setHoldingId("");
                    }}
                  >
                    <td>
                      <strong>{r.ticker}</strong>{" "}
                      <span className="meta-soft">{r.name}</span>
                    </td>
                    <td className={toneClass(r.values.rev1m)}>
                      {fmtPct(r.values.rev1m)}
                    </td>
                    <td>{fmtNum(r.values.per)}</td>
                    <td className={toneClass(r.values.perPremium)}>
                      {fmtPct(r.values.perPremium)}
                    </td>
                    <td>{fmtNum(r.values.roe)}</td>
                    <td className={toneClass(r.values.epsGrowth)}>
                      {fmtPct(r.values.epsGrowth)}
                    </td>
                    <td>{fmtNum(r.values.ev)}</td>
                    <td>{fmtNum(r.values.pbr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="geo-featured">
            <div
              className="feature-head geo-head-row"
              style={{ marginBottom: 8 }}
            >
              <h3 className="geo-section-title" style={{ fontSize: 16 }}>
                구성종목 탐색
              </h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select
                  className="sdb-select"
                  value={holding?.id || ""}
                  onChange={(e) => setHoldingId(e.target.value)}
                  disabled={holdingsLoading || !holdings.length}
                >
                  {holdings.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.ticker} · {fmtNum(h.values.weight)}%
                    </option>
                  ))}
                </select>
                <select
                  className="sdb-select"
                  value={hmetric}
                  onChange={(e) =>
                    setHmetric(e.target.value as "per" | "eps" | "price")
                  }
                >
                  <option value="per">선행 PER (배)</option>
                  <option value="eps">선행 EPS (종목별 원통화)</option>
                  <option value="price">주가 (종목별 원통화)</option>
                </select>
              </div>
            </div>
            {holdingsLoading ? (
              <p className="empty">구성종목 불러오는 중…</p>
            ) : holding ? (
              <>
                <div className="nxt-stat-grid" style={{ marginBottom: 10 }}>
                  <div className="geo-featured">
                    <div className="meta-soft">원본 편입비</div>
                    <strong className="nxt-stat-val">
                      {fmtNum(holding.values.weight)}%
                    </strong>
                  </div>
                  <div className="geo-featured">
                    <div className="meta-soft">선행 PER</div>
                    <strong className="nxt-stat-val">
                      {fmtNum(holding.values.per)}배
                    </strong>
                  </div>
                  <div className="geo-featured">
                    <div className="meta-soft">ROE</div>
                    <strong className="nxt-stat-val">
                      {fmtNum(holding.values.roe)}%
                    </strong>
                  </div>
                  <div className="geo-featured">
                    <div className="meta-soft">1M 조정심리</div>
                    <strong
                      className={`nxt-stat-val ${toneClass(holding.values.rev1m)}`}
                    >
                      {fmtPct(holding.values.rev1m)}
                    </strong>
                  </div>
                </div>
                <LagBarPanel
                  series={[
                    {
                      name: holding.id,
                      points: [
                        ...(holding.annual?.[hmetric] || []),
                      ].reverse(),
                    },
                  ]}
                  unit={hmetric === "per" ? "배" : "원본 단위"}
                />
              </>
            ) : (
              <p className="empty">구성종목이 없습니다.</p>
            )}
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>구성종목</th>
                    <th>편입비</th>
                    <th>선행 PER</th>
                    <th>ROE</th>
                    <th>EPS 조정심리 1M</th>
                  </tr>
                </thead>
                <tbody>
                  {[...holdings]
                    .sort(
                      (a, b) =>
                        (num(b.values.weight) ?? 0) -
                        (num(a.values.weight) ?? 0),
                    )
                    .map((h) => (
                      <tr
                        key={h.id}
                        className={
                          h.id === holding?.id ? "sdb-row-active" : undefined
                        }
                        style={{ cursor: "pointer" }}
                        onClick={() => setHoldingId(h.id)}
                      >
                        <td>
                          <strong>{h.id}</strong>
                        </td>
                        <td>{fmtNum(h.values.weight)}%</td>
                        <td>{fmtNum(h.values.per)}</td>
                        <td>{fmtNum(h.values.roe)}%</td>
                        <td className={toneClass(h.values.rev1m)}>
                          {fmtPct(h.values.rev1m)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="meta-soft" style={{ marginTop: 8 }}>
              KBAM → {selected.id}!A:B 및 각 지표 열. 상대 연도는 현재 기준
              −1Y…−5Y. 결측은 보간하지 않습니다.
            </p>
          </div>
        </div>

        <div>
          <div className="geo-featured" style={{ marginBottom: 12 }}>
            <div className="meta-soft">{selected.id}</div>
            <h3 className="geo-section-title" style={{ marginTop: 4 }}>
              {selected.name}
            </h3>
            <p className="meta-soft">
              BM: {selected.benchmark || "미기재"}
            </p>
            <dl className="sdb-dl">
              <div>
                <dt>PER 5년 평균</dt>
                <dd>{fmtNum(v.perAvg)}배</dd>
              </div>
              <div>
                <dt>EV/EBITDA</dt>
                <dd>{fmtNum(v.ev)}배</dd>
              </div>
              <div>
                <dt>PBR</dt>
                <dd>{fmtNum(v.pbr)}배</dd>
              </div>
              <div>
                <dt>PSR</dt>
                <dd>{fmtNum(v.psr)}배</dd>
              </div>
              <div>
                <dt>PEG</dt>
                <dd>{fmtNum(v.peg)}배</dd>
              </div>
              <div>
                <dt>ROE</dt>
                <dd>{fmtNum(v.roe)}%</dd>
              </div>
              <div>
                <dt>ROE 평균 대비</dt>
                <dd>{fmtNum(v.roeGap)}%p</dd>
              </div>
              <div>
                <dt>매출 성장률</dt>
                <dd>{fmtNum(v.salesGrowth)}%</dd>
              </div>
              <div>
                <dt>매출 성장률 차이</dt>
                <dd>{fmtNum(v.salesGap)}%p</dd>
              </div>
            </dl>
            <div className="callout" style={{ marginTop: 10 }}>
              현재·평균 지표 모두 원본을 보존했습니다. 가중평균 PER와 펀드 공시
              PER는 계산 방식이 다를 수 있습니다. 선행 EPS 성장은 선행 EPS /
              후행 EPS − 1을 가중한 값입니다. PEG는 원본의 성장률 정의에
              따릅니다.
            </div>
            <p className="meta-soft" style={{ marginTop: 8 }}>
              fundamental!{selected.row}:{selected.row}
            </p>
          </div>

          <div className="geo-featured" style={{ marginBottom: 12 }}>
            <h3 className="geo-section-title" style={{ fontSize: 16 }}>
              편입 집중도
            </h3>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {[...holdings]
                .sort(
                  (a, b) =>
                    (num(b.values.weight) ?? 0) - (num(a.values.weight) ?? 0),
                )
                .slice(0, 10)
                .map((h) => {
                  const w = num(h.values.weight) ?? 0;
                  const pctBar =
                    maxWeight > 0
                      ? Math.max(0, Math.min(100, (w / maxWeight) * 100))
                      : 0;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className="ghost-btn"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "64px 1fr 52px",
                        alignItems: "center",
                        gap: 8,
                        textAlign: "left",
                        padding: "4px 0",
                      }}
                      onClick={() => setHoldingId(h.id)}
                    >
                      <span>{h.ticker}</span>
                      <span
                        style={{
                          height: 8,
                          background: "#1e293b",
                          borderRadius: 4,
                          overflow: "hidden",
                        }}
                      >
                        <i
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${pctBar}%`,
                            background: "#5eead4",
                          }}
                        />
                      </span>
                      <strong style={{ fontSize: 12 }}>
                        {fmtNum(w)}%
                      </strong>
                    </button>
                  );
                })}
            </div>
            <dl className="sdb-dl" style={{ marginTop: 10 }}>
              <div>
                <dt>상위 10개 편입비</dt>
                <dd>{fmtNum(selected.top10Weight)}%</dd>
              </div>
              <div>
                <dt>전체 편입비 합계</dt>
                <dd>{fmtNum(selected.weightSum)}%</dd>
              </div>
            </dl>
            <div style={{ marginTop: 10 }}>
              <div className="meta-soft">
                {coverageKey.toUpperCase()} 유효 커버리지
              </div>
              <strong style={{ fontSize: 20 }}>
                {fmtNum(coveragePct, 1)}%
              </strong>
              <div
                style={{
                  height: 8,
                  background: "#1e293b",
                  borderRadius: 4,
                  overflow: "hidden",
                  marginTop: 6,
                }}
              >
                <i
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${Math.min(100, coveragePct)}%`,
                    background: "#5b9fd4",
                  }}
                />
              </div>
              <p className="meta-soft" style={{ marginTop: 4 }}>
                유효 종목 편입비 {fmtNum(selected.coverage?.[coverageKey])}%p ÷
                전체 {fmtNum(selected.weightSum)}%p
              </p>
            </div>
          </div>

          <div className="geo-featured">
            <h3 className="geo-section-title" style={{ fontSize: 16 }}>
              출처 · 해석
            </h3>
            <p className="meta-soft" style={{ marginTop: 8 }}>
              편입비 합계가 100%와 다르더라도 임의로 재조정하지 않았습니다.
              누락 지표의 기여분이 빠지는 원본 가중합의 특성을 커버리지와 함께
              확인하세요.
            </p>
            <a
              className="ghost-btn"
              href={`${SAVVYDB_EXTERNAL.replace(/#.*$/, "")}/#fundamentals`}
              target="_blank"
              rel="noreferrer"
              style={{ marginTop: 10, display: "inline-block" }}
            >
              원본 열기 ↗
            </a>
          </div>
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
          group: r.group,
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
          <h3 className="geo-section-title">ETF를 비교하는 다른 기준</h3>
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
          <div className="meta-soft">{selected.ticker} · 1년 수익률</div>
          <strong className={`nxt-stat-val ${toneClass(v.ret)}`}>
            {fmtPct(v.ret)}
          </strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">연간 총보수</div>
          <strong className="nxt-stat-val">{fmtNum(v.fee)}%</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">1년 변동성</div>
          <strong className="nxt-stat-val">{fmtNum(v.vol)}%</strong>
        </div>
        <div className="geo-featured">
          <div className="meta-soft">샤프 비율</div>
          <strong className="nxt-stat-val">{fmtNum(v.sharpe, 3)}</strong>
        </div>
      </div>

      <div className="nxt-chart-grid">
        <div>
          <p className="meta-soft" style={{ marginBottom: 6 }}>
            위험과 수익률 (가로: 1Y 변동성 · 세로: 1Y 총수익률)
          </p>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
                <XAxis
                  type="number"
                  dataKey="vol"
                  name="변동성"
                  unit="%"
                  tick={{ fill: "#8b9bb4", fontSize: 10 }}
                />
                <YAxis
                  type="number"
                  dataKey="ret"
                  name="수익률"
                  unit="%"
                  width={44}
                  tick={{ fill: "#8b9bb4", fontSize: 10 }}
                />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  contentStyle={tip}
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(value: number | string, name: string) => [
                    typeof value === "number" ? `${value.toFixed(2)}%` : value,
                    name === "ret"
                      ? "1Y 수익률"
                      : name === "vol"
                        ? "변동성"
                        : name,
                  ]}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as
                      | { ticker?: string; group?: string }
                      | undefined;
                    return p
                      ? `${p.ticker || ""}${p.group ? ` · ${p.group}` : ""}`
                      : "";
                  }}
                />
                <Scatter
                  name="ETF"
                  data={scatter.filter((d) => !d.selected)}
                  fill="#5b9fd4"
                  fillOpacity={0.55}
                  onClick={(d) => {
                    const row = d as { id?: string };
                    if (row.id) setId(row.id);
                  }}
                />
                <Scatter
                  name="선택"
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
            출처: 업종·테마·스타일 → ETF매칭 / 기타 · 점을 클릭해 ETF 선택
          </p>

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
                    className={
                      r.id === selected.id ? "sdb-row-active" : undefined
                    }
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
      {view === "fundamentals" ? <FundamentalsView /> : null}
      {view === "stocks" ? <StocksView /> : null}
      {view === "countries" ? <CountriesView /> : null}
      {view === "longval" ? <LongValView /> : null}
      {view === "themes" ? <ThemesView /> : null}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  DEFAULT_SCENARIO,
  HORIZON_META,
  MARKET_SPECS,
  MIDTERM_ELECTIONS,
  SCENARIO_META,
  SECTOR_SPECS,
  emptyMidtermStudyPayload,
  eventHorizon,
  netDemSeats,
  pickHorizon,
  seatsLabel,
  signedSeats,
  type HorizonDay,
  type MidtermElection,
  type MidtermStudyPayload,
  type ScenarioId,
} from "@/lib/midtermStudy";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

const MARKET_COLOR: Record<string, string> = {
  spx: "#60a5fa",
  nasdaq: "#c084fc",
  dow: "#fbbf24",
};

function fmtRebased(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function partyClass(p: "D" | "R"): string {
  return p === "D" ? "d" : "r";
}

function controlBadge(house: "D" | "R", senate: "D" | "R"): string {
  return `하원 ${house === "D" ? "민주" : "공화"} · 상원 ${senate === "D" ? "민주" : "공화"}`;
}

export default function MidtermStudyTab() {
  const [data, setData] = useState<MidtermStudyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [scenario, setScenario] = useState<ScenarioId>(DEFAULT_SCENARIO);
  const [horizon, setHorizon] = useState<HorizonDay>(90);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/midterm-study", { cache: "no-store" });
      const json = (await res.json()) as MidtermStudyPayload;
      setData(json);
    } catch (exc) {
      setData(emptyMidtermStudyPayload(exc instanceof Error ? exc.message : "로드 실패"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sc = data?.scenarios[scenario];
  const scenarioMeta = SCENARIO_META.find((s) => s.id === scenario);

  const chartRows = useMemo(() => {
    if (!sc) return [];
    const byT = new Map<number, Record<string, number | string>>();
    for (const spec of MARKET_SPECS) {
      const asset = sc.assets.find((a) => a.id === spec.id);
      if (!asset || asset.n === 0) continue;
      for (const p of asset.path) {
        const row = byT.get(p.t) || { t: p.t };
        row[spec.id] = p.v;
        byT.set(p.t, row);
      }
    }
    return [...byT.values()].sort((a, b) => Number(a.t) - Number(b.t));
  }, [sc]);

  const marketAssets = useMemo(
    () => (sc?.assets || []).filter((a) => a.kind === "market"),
    [sc],
  );
  const sectorAssets = useMemo(
    () => (sc?.assets || []).filter((a) => a.kind === "sector"),
    [sc],
  );

  const sectorBars = useMemo(() => {
    return sectorAssets
      .map((a) => {
        const h = pickHorizon(a, horizon);
        return {
          id: a.id,
          name: a.label,
          ret: h?.return_pct ?? null,
          n: h?.n ?? 0,
        };
      })
      .filter((r) => r.ret != null)
      .sort((a, b) => (b.ret ?? 0) - (a.ret ?? 0));
  }, [sectorAssets, horizon]);

  const catalog = data?.elections?.length ? data.elections : MIDTERM_ELECTIONS;
  const inScenario = catalog.filter((e) => e.scenario === scenario);

  return (
    <div className="geo-tab macro-tab eventstudy-tab midterm-study-tab">
      <section className="panel">
        <div className="panel-head eventstudy-hero">
          <div>
            <h2 className="panel-title">중간선거 이벤트 스터디</h2>
            <p className="macro-subhead">
              1950년 트루먼 중간선거부터, 선거 당일 이후 첫 거래일을 100으로 두고 S&amp;P 500 ·
              나스닥 · 다우와 장기 업종 지수를 시나리오별로 평균합니다. 기본값은 하원 민주 · 상원
              공화(1982, 2018).
            </p>
          </div>
          <button type="button" className="eventstudy-example-btn" onClick={() => void load()}>
            다시 계산
          </button>
        </div>

        <div className="eventstudy-cat-row midterm-study-scenarios">
          {SCENARIO_META.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`eventstudy-cat ${scenario === s.id ? "active" : ""}`}
              onClick={() => setScenario(s.id)}
            >
              {s.label}
              <em>
                {s.sub}
                {data ? ` · n=${data.scenarios[s.id]?.n ?? 0}` : ""}
              </em>
            </button>
          ))}
        </div>
        {scenario === "d_r" ? (
          <p className="eventstudy-stale">
            이 분할 시나리오는 표본이 1982년(레이건)과 2018년(트럼프) 두 번뿐입니다. 평균을 패턴으로
            단정하지 마세요.
          </p>
        ) : null}
        {scenario === "r_d" ? (
          <p className="eventstudy-stale">
            하원 공화 · 상원 민주 표본은 2010년과 2022년 두 해입니다.
          </p>
        ) : null}
      </section>

      {loading && !data ? <p className="empty">과거 중간선거 경로를 맞추는 중…</p> : null}
      {data && !data.ok ? <p className="empty err">{data.error}</p> : null}

      {data?.ok && sc ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">지수 경로 (t=0 → 100)</h3>
                <p className="macro-subhead">
                  {scenarioMeta?.label} · {sc.n}개 중간선거 평균. 가로축은 거래일(선거 세션=0),
                  세로축은 리베이스 지수입니다.
                </p>
              </div>
            </div>
            {chartRows.length ? (
              <div className="eventstudy-chart eventstudy-chart-lg">
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="t"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      tickFormatter={(v: number) => (v === 0 ? "0" : String(v))}
                    />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      domain={["auto", "auto"]}
                      tickFormatter={(v: number) => v.toFixed(0)}
                    />
                    <ReferenceLine y={100} stroke="#64748b" strokeDasharray="4 4" />
                    <ReferenceLine x={0} stroke="#64748b" strokeDasharray="4 4" />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(label) => `거래일 ${label}`}
                      formatter={(value: number, name: string) => [
                        fmtRebased(value, 2),
                        MARKET_SPECS.find((m) => m.id === name)?.label || name,
                      ]}
                    />
                    <Legend
                      formatter={(value) => MARKET_SPECS.find((m) => m.id === value)?.label || value}
                    />
                    {MARKET_SPECS.map((spec) => {
                      const asset = sc.assets.find((a) => a.id === spec.id);
                      if (!asset || asset.n === 0) return null;
                      return (
                        <Line
                          key={spec.id}
                          type="monotone"
                          dataKey={spec.id}
                          name={spec.id}
                          stroke={MARKET_COLOR[spec.id]}
                          dot={false}
                          strokeWidth={2}
                          connectNulls
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="empty">이 시나리오에 그릴 지수 경로가 없습니다.</p>
            )}

            <div className="eventstudy-snap-grid">
              {HORIZON_META.map((h) => (
                <article key={h.id} className="macro-snap-card">
                  <span className="macro-snap-label">{h.label}</span>
                  {marketAssets.map((a) => {
                    const cell = pickHorizon(a, h.days);
                    return (
                      <div key={a.id} className="eventstudy-snap-line">
                        <em>
                          {a.label}
                          <small> n={cell?.n ?? 0}</small>
                        </em>
                        <strong className={retClass(cell?.return_pct)}>
                          {fmtPct(cell?.return_pct)}
                        </strong>
                      </div>
                    );
                  })}
                </article>
              ))}
            </div>

            <div className="eventstudy-table-wrap midterm-study-table-wrap">
              <table className="eventstudy-table eventstudy-heat">
                <thead>
                  <tr>
                    <th>지수</th>
                    <th>n</th>
                    {HORIZON_META.map((h) => (
                      <th key={h.id}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {marketAssets.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span className="eventstudy-asset-name">{a.label}</span>
                        {MARKET_SPECS.find((m) => m.id === a.id)?.note ? (
                          <span className="eventstudy-asset-note">
                            {MARKET_SPECS.find((m) => m.id === a.id)?.note}
                          </span>
                        ) : null}
                      </td>
                      <td>{a.n}</td>
                      {HORIZON_META.map((h) => {
                        const cell = pickHorizon(a, h.days);
                        return (
                          <td key={h.id} className={retClass(cell?.return_pct)}>
                            {fmtRebased(cell?.rebased)}
                            <span className="eventstudy-asset-note">{fmtPct(cell?.return_pct)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">업종 성과 (French 12산업)</h3>
                <p className="macro-subhead">
                  GICS 섹터 ETF는 1998년 전후라 1950년대까지 내려갈 수 없습니다. 아래는 Ken French
                  가치가중 산업 포트폴리오를 같은 방식으로 100에 맞춘 평균입니다.
                </p>
              </div>
            </div>
            <div className="eventstudy-cat-row">
              {HORIZON_META.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={`eventstudy-cat ${horizon === h.days ? "active" : ""}`}
                  onClick={() => setHorizon(h.days)}
                >
                  {h.label}
                </button>
              ))}
            </div>
            {sectorBars.length ? (
              <div className="eventstudy-chart eventstudy-chart-lg">
                <ResponsiveContainer width="100%" height={380}>
                  <BarChart
                    data={sectorBars}
                    layout="vertical"
                    margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      type="number"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={72}
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number) => [fmtPct(value), "평균 수익률"]}
                    />
                    <Bar dataKey="ret" radius={[0, 4, 4, 0]}>
                      {sectorBars.map((row) => (
                        <Cell
                          key={row.id}
                          fill={(row.ret ?? 0) >= 0 ? "#34d399" : "#f87171"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="empty">업종 대용 시계열을 불러오지 못했습니다.</p>
            )}

            <div className="eventstudy-table-wrap midterm-study-table-wrap" style={{ marginTop: "0.9rem" }}>
              <table className="eventstudy-table eventstudy-heat">
                <thead>
                  <tr>
                    <th>업종</th>
                    <th>n</th>
                    {HORIZON_META.map((h) => (
                      <th key={h.id}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sectorAssets.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span className="eventstudy-asset-name">{a.label}</span>
                        {SECTOR_SPECS.find((s) => s.id === a.id)?.note ? (
                          <span className="eventstudy-asset-note">
                            {SECTOR_SPECS.find((s) => s.id === a.id)?.note}
                          </span>
                        ) : null}
                      </td>
                      <td>{a.n}</td>
                      {HORIZON_META.map((h) => {
                        const cell = pickHorizon(a, h.days);
                        return (
                          <td key={h.id} className={retClass(cell?.return_pct)}>
                            {fmtPct(cell?.return_pct)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">이 시나리오에 들어간 선거</h3>
                <p className="macro-subhead">
                  각 해의 S&amp;P 500 / 나스닥을 같은 100 기준으로 풀어 놓은 값입니다.
                </p>
              </div>
            </div>
            <div className="eventstudy-table-wrap">
              <table className="eventstudy-table">
                <thead>
                  <tr>
                    <th>선거</th>
                    <th>대통령</th>
                    <th>S&amp;P +3m</th>
                    <th>S&amp;P +1y</th>
                    <th>나스닥 +3m</th>
                    <th>나스닥 +1y</th>
                  </tr>
                </thead>
                <tbody>
                  {(sc.elections || []).map((ev) => {
                    const meta = catalog.find((e) => e.date === ev.date);
                    const spx3 = eventHorizon(ev, "spx", 90);
                    const spx12 = eventHorizon(ev, "spx", 365);
                    const nq3 = eventHorizon(ev, "nasdaq", 90);
                    const nq12 = eventHorizon(ev, "nasdaq", 365);
                    return (
                      <tr key={ev.date}>
                        <td>
                          <span className="eventstudy-asset-name">{ev.date}</span>
                          {ev.t0_date && ev.t0_date !== ev.date ? (
                            <span className="eventstudy-asset-note">t0 {ev.t0_date}</span>
                          ) : null}
                        </td>
                        <td>
                          {meta ? `${meta.president_ko} (${meta.president_party})` : "—"}
                        </td>
                        <td className={retClass(spx3?.return_pct)}>{fmtPct(spx3?.return_pct)}</td>
                        <td className={retClass(spx12?.return_pct)}>{fmtPct(spx12?.return_pct)}</td>
                        <td className={retClass(nq3?.return_pct)}>{fmtPct(nq3?.return_pct)}</td>
                        <td className={retClass(nq12?.return_pct)}>{fmtPct(nq12?.return_pct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">1950년대부터 의회 구성</h3>
            <p className="macro-subhead">
              트루먼부터 바이든까지 중간선거 결과. 의석 수는 다음 의회(1월 개원) 기준이고, 무소속은
              기타로 묶었습니다. 지금 고른 시나리오 행이 강조됩니다.
            </p>
          </div>
        </div>
        <div className="eventstudy-table-wrap midterm-study-roster-wrap">
          <table className="eventstudy-table midterm-study-roster">
            <thead>
              <tr>
                <th>연도</th>
                <th>대통령</th>
                <th>의회</th>
                <th>하원 (전 → 후)</th>
                <th>상원 (전 → 후)</th>
                <th>결과</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((row) => (
                <RosterRow key={row.id} row={row} active={row.scenario === scenario} />
              ))}
            </tbody>
          </table>
        </div>
        {inScenario.length ? (
          <p className="meta-soft midterm-footnote">
            현재 시나리오 해당 연도: {inScenario.map((e) => e.id).join(", ")}
          </p>
        ) : null}
      </section>

      {data?.coverage?.length ? (
        <p className="eventstudy-foot">{data.coverage.join(" · ")}</p>
      ) : null}
      {data?.note ? <p className="eventstudy-foot">{data.note}</p> : null}
    </div>
  );
}

function RosterRow({ row, active }: { row: MidtermElection; active: boolean }) {
  const houseNet = netDemSeats(row.house_before, row.house_after);
  const senateNet = netDemSeats(row.senate_before, row.senate_after);
  return (
    <tr className={active ? "focus" : undefined}>
      <td>
        <span className="eventstudy-asset-name">{row.id}</span>
        <span className="eventstudy-asset-note">{row.date.slice(5)}</span>
      </td>
      <td>
        <span className="eventstudy-asset-name">
          {row.president_ko}{" "}
          <em className={`midterm-study-party ${partyClass(row.president_party)}`}>
            {row.president_party}
          </em>
        </span>
        <span className="eventstudy-asset-note">{row.president}</span>
      </td>
      <td>{row.congress}대</td>
      <td>
        {seatsLabel(row.house_before)}
        <span className="eventstudy-asset-note">
          → {seatsLabel(row.house_after)} (민주 {signedSeats(houseNet)})
        </span>
      </td>
      <td>
        {seatsLabel(row.senate_before)}
        <span className="eventstudy-asset-note">
          → {seatsLabel(row.senate_after)} (민주 {signedSeats(senateNet)})
        </span>
      </td>
      <td>
        <span className="eventstudy-asset-name">{controlBadge(row.house_control, row.senate_control)}</span>
        <span className="eventstudy-asset-note">{row.note}</span>
      </td>
    </tr>
  );
}

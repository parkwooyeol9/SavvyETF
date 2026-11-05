"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import KrxInvestorFlowSection from "@/components/KrxInvestorFlowSection";
import type { KrxOptionBoardPayload, OptExpiry } from "@/lib/krxOptionBoard";

const EXCEL_HREF = "/api/krx-option-board/excel";
const GRID = "#243049";
const TICK = { fill: "#94a3b8", fontSize: 11 };
const C_NAVY = "#8C9AC2";
const C_GOLD = "#CC9900";
const C_UP = "#34d399";
const C_DOWN = "#f87171";
const C_SPOT = "#38bdf8";

const ETF_GROUPS: Array<{ key: string; label: string; color: string }> = [
  { key: "코스피200_레버리지", label: "코스피200 레버리지", color: C_UP },
  { key: "코스피200_인버스", label: "코스피200 인버스", color: C_DOWN },
  { key: "코스닥150_레버리지", label: "코스닥150 레버리지", color: C_NAVY },
  { key: "코스닥150_인버스", label: "코스닥150 인버스", color: C_GOLD },
];

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function fmt(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtSigned(n?: number | null, digits = 2, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${fmt(n, digits)}${suffix}`;
}

function fmtInt(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("ko-KR");
}

function shortDate(d: string): string {
  return d.slice(5).replace("-", "/");
}

function SectionHead({ no, title, note }: { no: number; title: string; note?: string }) {
  return (
    <div className="etfflow-sec-head">
      <h3>
        {no}. {title}
      </h3>
      {note ? <span className="kr-note">{note}</span> : null}
    </div>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <article className="macro-snap-card">
      <span className="macro-snap-label">{label}</span>
      <strong className={`macro-snap-value ${cls || ""}`}>{value}</strong>
      {sub ? <em className="macro-snap-sub">{sub}</em> : null}
    </article>
  );
}

function vrpRead(vrp?: number | null): string {
  if (vrp == null) return "—";
  if (vrp >= 5) return "내재 > 실현 · 옵션 매도 우위";
  if (vrp <= -5) return "실현 > 내재 · 옵션 매수 우위";
  return "중립 구간";
}

function expiryLabel(e: OptExpiry): string {
  return `${e.product} ${e.expiry.slice(5).replace("-", "/")}`;
}

export default function KrxOptionBoardTab() {
  const [data, setData] = useState<KrxOptionBoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<60 | 130>(60);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/krx-option-board", { cache: "no-store" });
      setData((await res.json()) as KrxOptionBoardPayload);
    } catch (exc) {
      setData(null);
      console.error(exc);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const s = data?.summary;
  const front = data?.chain.front;
  const volSeries = useMemo(() => (data?.vol.series || []).slice(-range), [data, range]);
  const pcSeries = useMemo(() => (data?.pc || []).slice(-range), [data, range]);
  const futSeries = useMemo(() => (data?.futures || []).slice(-range), [data, range]);
  const etfSeries = useMemo(() => (data?.etf.series || []).slice(-range), [data, range]);
  const strikes = useMemo(() => front?.strikes || [], [front]);
  const spotStrike = useMemo(() => {
    if (!front || !strikes.length) return null;
    return strikes.reduce((a, b) => (Math.abs(b.strike - front.spot) < Math.abs(a.strike - front.spot) ? b : a))
      .strike;
  }, [front, strikes]);
  const termData = useMemo(
    () => (data?.chain.expiries || []).filter((e) => e.atm_iv != null).map((e) => ({ ...e, label: expiryLabel(e) })),
    [data],
  );

  return (
    <section className="panel etfflow-panel optboard-panel">
      <div className="panel-head">
        <div>
          <h2>옵션 모니터 · 코스피200</h2>
          <p className="kr-note">
            변동성 프리미엄 · 옵션 미결제약정 벽 · 풋/콜 · 선물 베이시스 · 레버리지/인버스 ETF · 주식옵션
            {data?.as_of ? ` · 기준일 ${data.as_of}` : ""}
            {data?.generated_at_display ? ` · 작성 ${data.generated_at_display}` : ""}
          </p>
        </div>
        <div className="btn-row">
          <div className="chip-row" role="group" aria-label="기간">
            {([60, 130] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={`chip ${range === n ? "active" : ""}`}
                onClick={() => setRange(n)}
              >
                {n === 60 ? "3개월" : "6개월"}
              </button>
            ))}
          </div>
          <a className="btn primary" href={EXCEL_HREF} download>
            엑셀 다운로드
          </a>
          <button type="button" className="chip" onClick={() => void load()} disabled={loading}>
            {loading ? "로딩…" : "새로고침"}
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">불러오는 중…</p> : null}
      {data && !data.ok ? <p className="empty">{data.error || "데이터가 없습니다"}</p> : null}

      {data?.ok && s ? (
        <>
          <SectionHead no={1} title="핵심 지표" note="전 영업일 종가 기준 · KRX Open API" />
          <div className="macro-snap-grid optboard-kpi-grid">
            <Kpi
              label="코스피 200"
              value={fmt(s.k200)}
              sub={fmtSigned(s.k200_chg, 2, "%")}
              cls={tone(s.k200_chg)}
            />
            <Kpi
              label="VKOSPI"
              value={fmt(s.vkospi)}
              sub={`전일 ${fmtSigned(s.vkospi_chg)} · 6개월 백분위 ${s.vkospi_pctile ?? "—"}%`}
            />
            <Kpi label="RV20 (실현)" value={`${fmt(s.rv20)}%`} sub="20일 실현변동성" />
            <Kpi label="VRP" value={`${fmtSigned(s.vrp)}%p`} sub={vrpRead(s.vrp)} cls={tone(s.vrp)} />
            <Kpi
              label="근월 ATM IV / 스큐"
              value={`${fmt(s.atm_iv, 1)}% / ${fmtSigned(s.skew, 1)}`}
              sub="스큐 = 5% OTM 풋 − 콜 IV"
            />
            <Kpi label="풋/콜 (OI · 거래량)" value={`${fmt(s.pc_oi)} · ${fmt(s.pc_vol)}`} sub="월물+위클리 정규장" />
            <Kpi
              label="선물 베이시스"
              value={`${fmtSigned(s.basis)}pt`}
              sub={`미결제 증감 ${fmtSigned(s.fut_oi_chg, 0)}계약`}
              cls={tone(s.basis)}
            />
            <Kpi
              label="풋 벽 / 콜 벽"
              value={`${fmt(s.put_wall, 1)} / ${fmt(s.call_wall, 1)}`}
              sub={`근월 Max Pain ${fmt(s.max_pain, 1)}`}
            />
            <Kpi
              label="GEX (45일 내)"
              value={`${fmtSigned(s.gex_eok, 0)}억`}
              sub={(s.gex_eok ?? 0) >= 0 ? "롱 감마 · 변동 완충 가정" : "숏 감마 · 변동 증폭 가정"}
              cls={tone(s.gex_eok)}
            />
          </div>

          {data.investor ? <KrxInvestorFlowSection inv={data.investor} no={2} range={range} /> : null}

          <SectionHead
            no={3}
            title="변동성 프리미엄 — VKOSPI vs 실현변동성"
            note={`VRP = VKOSPI − RV20 · 6개월 VKOSPI 범위 ${fmt(data.vol.vkospi_min)}~${fmt(data.vol.vkospi_max)}`}
          />
          <div className="optboard-grid">
            <div className="gamma-chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={volSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} minTickGap={24} />
                  <YAxis tick={TICK} width={40} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #243049" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey="vkospi" name="VKOSPI" stroke={C_GOLD} dot={false} strokeWidth={2} />
                  <Line dataKey="rv20" name="RV20" stroke={C_NAVY} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="gamma-chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={volSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} minTickGap={24} />
                  <YAxis tick={TICK} width={40} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #243049" }} />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Bar dataKey="vrp" name="VRP (%p)">
                    {volSeries.map((p) => (
                      <Cell key={p.date} fill={(p.vrp ?? 0) >= 0 ? C_UP : C_DOWN} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {front ? (
            <>
              <SectionHead
                no={4}
                title={`근월물 행사가별 미결제약정·GEX — ${front.code}`}
                note={`만기 ${front.expiry} (D-${front.dte}) · 기초 ${fmt(front.spot)} (패리티 역산) · 하늘색 = 현물 근처`}
              />
              <div className="optboard-grid">
                <div className="gamma-chart">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={strikes} barCategoryGap="10%">
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="strike" tick={TICK} minTickGap={16} />
                      <YAxis tick={TICK} width={52} tickFormatter={(v: number) => fmtInt(v)} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #243049" }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {spotStrike != null ? <ReferenceLine x={spotStrike} stroke={C_SPOT} strokeDasharray="3 3" /> : null}
                      <Bar dataKey="c_oi" name="콜 OI" fill={C_UP} />
                      <Bar dataKey="p_oi" name="풋 OI" fill={C_DOWN} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="gamma-chart">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={strikes} barCategoryGap="10%">
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="strike" tick={TICK} minTickGap={16} />
                      <YAxis tick={TICK} width={52} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #243049" }} />
                      <ReferenceLine y={0} stroke="#64748b" />
                      {spotStrike != null ? <ReferenceLine x={spotStrike} stroke={C_SPOT} strokeDasharray="3 3" /> : null}
                      <Bar dataKey="gex_eok" name="GEX (억원/1%)">
                        {strikes.map((r) => (
                          <Cell key={r.strike} fill={r.gex_eok >= 0 ? C_UP : C_DOWN} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : null}

          <SectionHead no={5} title="만기별 구조 (월물·위클리)" note="ATM IV 기간구조 · 콜/풋 벽 = 미결제약정 최대 행사가" />
          <div className="optboard-grid">
            <div className="table-wrap">
              <table className="kr-table etfflow-table">
                <thead>
                  <tr>
                    <th>상품</th>
                    <th>만기</th>
                    <th className="num">D-</th>
                    <th className="num">ATM IV</th>
                    <th className="num">스큐</th>
                    <th className="num">P/C OI</th>
                    <th className="num">풋 벽</th>
                    <th className="num">콜 벽</th>
                    <th className="num">Max Pain</th>
                    <th className="num">GEX(억)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.chain.expiries.map((e) => (
                    <tr key={`${e.product}-${e.code}`}>
                      <th className="etfflow-rowhead">{e.product}</th>
                      <td>{e.expiry}</td>
                      <td className="num">{e.dte}</td>
                      <td className="num">{fmt(e.atm_iv, 1)}</td>
                      <td className={`num ${tone(e.skew)}`}>{fmtSigned(e.skew, 1)}</td>
                      <td className="num">{fmt(e.pc_oi)}</td>
                      <td className="num">{fmt(e.put_wall, 1)}</td>
                      <td className="num">{fmt(e.call_wall, 1)}</td>
                      <td className="num">{fmt(e.max_pain, 1)}</td>
                      <td className={`num ${tone(e.gex_eok)}`}>{fmtSigned(e.gex_eok, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="gamma-chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={termData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} interval={0} angle={-25} textAnchor="end" height={56} />
                  <YAxis tick={TICK} width={40} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #243049" }} />
                  <Line dataKey="atm_iv" name="ATM IV" stroke={C_GOLD} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <SectionHead no={6} title="풋/콜 비율 · 선물 베이시스" note="코스피200 옵션 월물+위클리 정규장 · 선물 최근월 주간" />
          <div className="optboard-grid">
            <div className="gamma-chart">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={pcSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} minTickGap={24} />
                  <YAxis tick={TICK} width={40} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #243049" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={1} stroke="#64748b" strokeDasharray="3 3" />
                  <Line dataKey="pc_oi" name="P/C 미결제" stroke={C_GOLD} dot={false} strokeWidth={2} />
                  <Line dataKey="pc_vol" name="P/C 거래량" stroke={C_NAVY} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="gamma-chart">
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={futSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} minTickGap={24} />
                  <YAxis yAxisId="b" tick={TICK} width={40} />
                  <YAxis
                    yAxisId="oi"
                    orientation="right"
                    tick={TICK}
                    width={56}
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}K`}
                  />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #243049" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine yAxisId="b" y={0} stroke="#64748b" />
                  <Bar yAxisId="b" dataKey="basis" name="베이시스(pt)">
                    {futSeries.map((p) => (
                      <Cell key={p.date} fill={(p.basis ?? 0) >= 0 ? C_UP : C_DOWN} />
                    ))}
                  </Bar>
                  <Line yAxisId="oi" dataKey="oi_all" name="선물 미결제" stroke={C_GOLD} dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <SectionHead
            no={7}
            title="옵션 전략지수 성과"
            note="초과 = 전략 − 코스피 200 · 양매도 초과 +면 실현 변동성이 내재보다 낮았다는 뜻"
          />
          <div className="table-wrap">
            <table className="kr-table etfflow-table">
              <thead>
                <tr>
                  <th>지수</th>
                  <th className="num">종가</th>
                  <th className="num">1D</th>
                  <th className="num">1M</th>
                  <th className="num">3M</th>
                  <th className="num">1M 초과</th>
                  <th className="num">3M 초과</th>
                </tr>
              </thead>
              <tbody>
                {data.strategy.map((r) => (
                  <tr key={r.name}>
                    <th className="etfflow-rowhead">{r.name}</th>
                    <td className="num">{fmt(r.close)}</td>
                    <td className={`num ${tone(r.r1d)}`}>{fmtSigned(r.r1d, 2, "%")}</td>
                    <td className={`num ${tone(r.r1m)}`}>{fmtSigned(r.r1m, 2, "%")}</td>
                    <td className={`num ${tone(r.r3m)}`}>{fmtSigned(r.r3m, 2, "%")}</td>
                    <td className={`num ${tone(r.ex1m)}`}>{r.ex1m === undefined ? "" : fmtSigned(r.ex1m, 2, "%p")}</td>
                    <td className={`num ${tone(r.ex3m)}`}>{r.ex3m === undefined ? "" : fmtSigned(r.ex3m, 2, "%p")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionHead
            no={8}
            title="레버리지·인버스 ETF 설정·환매 추정"
            note="단위 억원 · Δ상장좌수 × NAV · 개인 방향성 베팅의 대리 지표"
          />
          <div className="optboard-grid">
            <div className="table-wrap">
              <table className="kr-table etfflow-table">
                <thead>
                  <tr>
                    <th>구분</th>
                    <th className="num">순자산</th>
                    <th className="num">5일</th>
                    <th className="num">20일</th>
                  </tr>
                </thead>
                <tbody>
                  {ETF_GROUPS.map((g) => {
                    const t = data.etf.totals[g.key];
                    return (
                      <tr key={g.key}>
                        <th className="etfflow-rowhead">{g.label}</th>
                        <td className="num">{fmtInt(t?.aum_eok)}</td>
                        <td className={`num ${tone(t?.flow_5d)}`}>{fmtSigned(t?.flow_5d, 0)}</td>
                        <td className={`num ${tone(t?.flow_20d)}`}>{fmtSigned(t?.flow_20d, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="gamma-chart">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={etfSeries} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="date" tickFormatter={(d: string) => shortDate(d)} tick={TICK} minTickGap={24} />
                  <YAxis tick={TICK} width={52} tickFormatter={(v: number) => fmtInt(v)} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #243049" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#64748b" />
                  {ETF_GROUPS.map((g) => (
                    <Bar key={g.key} dataKey={g.key} name={g.label} stackId="a" fill={g.color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="table-wrap">
            <table className="kr-table etfflow-table">
              <thead>
                <tr>
                  <th>ETF</th>
                  <th>기초</th>
                  <th>방향</th>
                  <th className="num">순자산(억)</th>
                  <th className="num">등락률</th>
                  <th className="num">1일</th>
                  <th className="num">5일</th>
                  <th className="num">20일</th>
                </tr>
              </thead>
              <tbody>
                {data.etf.table.slice(0, 15).map((r) => (
                  <tr key={r.code}>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>{r.base}</td>
                    <td className={r.dir === "인버스" ? "down" : "up"}>{r.dir}</td>
                    <td className="num">{fmtInt(r.aum_eok)}</td>
                    <td className={`num ${tone(r.chg)}`}>{fmtSigned(r.chg, 2, "%")}</td>
                    <td className={`num ${tone(r.flow_1d)}`}>{fmtSigned(r.flow_1d, 0)}</td>
                    <td className={`num ${tone(r.flow_5d)}`}>{fmtSigned(r.flow_5d, 0)}</td>
                    <td className={`num ${tone(r.flow_20d)}`}>{fmtSigned(r.flow_20d, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionHead
            no={9}
            title="주식옵션 거래대금 상위 기초자산"
            note="P/C = 풋/콜 · ATM IV·스큐(±10%)는 근월물 · 비중 = 주식옵션 전체 거래대금 대비"
          />
          <div className="table-wrap">
            <table className="kr-table etfflow-table">
              <thead>
                <tr>
                  <th>기초자산</th>
                  <th className="num">기초가격</th>
                  <th className="num">거래대금(억)</th>
                  <th className="num">비중</th>
                  <th className="num">P/C 대금</th>
                  <th className="num">P/C OI</th>
                  <th className="num">ATM IV</th>
                  <th className="num">스큐</th>
                </tr>
              </thead>
              <tbody>
                {data.stocks.map((r) => (
                  <tr key={r.name}>
                    <th className="etfflow-rowhead">{r.name}</th>
                    <td className="num">{fmtInt(r.spot)}</td>
                    <td className="num">{fmt(r.val_eok)}</td>
                    <td className="num">{fmt(r.share, 1)}%</td>
                    <td className="num">{fmt(r.pc_val)}</td>
                    <td className="num">{fmt(r.pc_oi)}</td>
                    <td className="num">{fmt(r.atm_iv, 1)}</td>
                    <td className={`num ${tone(r.skew)}`}>{fmtSigned(r.skew, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="kr-note etfflow-notes">
            {[...data.sources, ...data.method].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

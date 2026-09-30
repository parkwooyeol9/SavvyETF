"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
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

import { useAdminSession } from "@/components/AdminSession";
import { fmtNum, fmtPct, heat, Kpi, MetricsTable, tone, tooltipStyle } from "@/components/MpUi";
import { trackPeriodTable } from "@/lib/mpPeriods";
import type { MpTrackId, MpTrackRecord as Track } from "@/lib/mpTrackRecord";

type Range = "1m" | "3m" | "6m" | "ytd" | "1y" | "3y" | "all";

const RANGES: Array<{ key: Range; label: string }> = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "ytd", label: "YTD" },
  { key: "1y", label: "1Y" },
  { key: "3y", label: "3Y" },
  { key: "all", label: "전체" },
];

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

function rangeStart(last: string, r: Range): string {
  if (r === "all") return "0000-00-00";
  if (r === "ytd") return `${Number(last.slice(0, 4)) - 1}-12-31`;
  const days = { "1m": 30, "3m": 91, "6m": 182, "1y": 365, "3y": 1096 }[r];
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

type ExtPoint = { date: string; port: number; bm: number };

/**
 * Recorded track record. `ext` (live simulation levels) is chain-linked after the last
 * recorded date and drawn dashed as an estimate.
 */
export default function MpTrackRecord({ id, ext, extNote }: { id: MpTrackId; ext?: ExtPoint[]; extNote?: string }) {
  const [data, setData] = useState<Track | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("all");
  const { secret, unlocked, ready } = useAdminSession();
  const isAdmin = ready && unlocked && !!secret;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const req = isAdmin
      ? fetch(`/api/mp/track?series=${id}&full=1`, { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store" })
      : fetch(`/api/mp/track?series=${id}`);
    req
      .then(async (r) => {
        const j = (await r.json()) as Track;
        if (!alive) return;
        if (!j.ok) setErr(j.error || "기록 성과를 불러오지 못했습니다.");
        else setData(j);
      })
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id, ready, isAdmin, secret]);

  const extTail = useMemo(() => {
    if (!data || !ext?.length) return [];
    const last = data.series[data.series.length - 1]!;
    let base: ExtPoint | null = null;
    for (const p of ext) if (p.date <= last.date) base = p;
    if (!base || !(base.port > 0) || !(base.bm > 0)) return [];
    return ext
      .filter((p) => p.date > last.date && p.port > 0 && p.bm > 0)
      .map((p) => ({ date: p.date, port: (last.port * p.port) / base!.port, bm: (last.bm * p.bm) / base!.bm }));
  }, [data, ext]);

  const periods = useMemo(() => {
    if (!data) return [];
    if (!extTail.length) return data.periods;
    const rows = [...data.series, ...extTail];
    return trackPeriodTable(
      rows.map((r) => r.date),
      rows.map((r) => r.port),
      rows.map((r) => r.bm),
    );
  }, [data, extTail]);

  const chart = useMemo(() => {
    if (!data) return [];
    const last = data.series[data.series.length - 1]!;
    const from = rangeStart(extTail.at(-1)?.date || last.date, range);
    const rec = data.series.filter((p) => p.date >= from);
    const startRow = rec[0] || last;
    const p0 = startRow.port;
    const b0 = startRow.bm;
    let pk = -Infinity;
    let bk = -Infinity;
    const rows: Array<Record<string, number | string | null>> = rec.map((p) => {
      const mp = (p.port / p0) * 100;
      const bm = (p.bm / b0) * 100;
      pk = Math.max(pk, mp);
      bk = Math.max(bk, bm);
      return { t: p.date, MP: mp, BM: bm, 초과: (mp / bm - 1) * 100, MP_DD: (mp / pk - 1) * 100, BM_DD: (bm / bk - 1) * 100 };
    });
    if (extTail.length && rows.length) {
      const lastRow = rows[rows.length - 1]!;
      lastRow["MP 추정"] = lastRow.MP;
      lastRow["BM 추정"] = lastRow.BM;
      for (const p of extTail) {
        const mp = (p.port / p0) * 100;
        const bm = (p.bm / b0) * 100;
        rows.push({ t: p.date, MP: null, BM: null, "MP 추정": mp, "BM 추정": bm, 초과: (mp / bm - 1) * 100, MP_DD: null, BM_DD: null });
      }
    }
    return rows;
  }, [data, range, extTail]);

  const yearsGrid = useMemo(() => {
    if (!data) return [];
    const byYear = new Map<string, Map<string, { port: number; excess: number }>>();
    for (const m of data.monthly) {
      const y = m.month.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, new Map());
      byYear.get(y)!.set(m.month.slice(5, 7), { port: m.port_pct, excess: m.excess_pct });
    }
    return data.years
      .slice()
      .reverse()
      .map((y) => ({ ...y, months: byYear.get(y.year) || new Map() }));
  }, [data]);

  if (err) {
    return (
      <section className="geo-section geo-featured" style={{ marginTop: 12 }}>
        <h3 className="geo-section-title">기록 성과 ({id})</h3>
        <p className="empty">{err}</p>
      </section>
    );
  }
  if (!data || !data.metrics) {
    return (
      <section className="geo-section geo-featured" style={{ marginTop: 12 }}>
        <h3 className="geo-section-title">기록 성과 ({id})</h3>
        <p className="meta-soft">설정 이후 기록 성과 불러오는 중…</p>
      </section>
    );
  }

  const m = data.metrics;
  const per = (k: string) => periods.find((p) => p.key === k);
  const incAnn = per("all_ann");
  const asOf = extTail.at(-1)?.date || data.last_date;
  const ytick = (v: string) => (range === "all" || range === "3y" ? v.slice(2, 7) : v.slice(5));

  return (
    <section className="geo-section geo-featured" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <h3 className="geo-section-title">
          기록 성과 <span className="meta-soft">· {data.label} · 설정 {data.first_date} ~ {data.last_date}</span>
        </h3>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.key} type="button" className={range === r.key ? "active" : ""} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p className="meta-soft">
        실제 운용 기록 지수(원본: {data.source || "MP1·MP2 입력 데이터"}) · {data.bm_label} · 평가일 기준
      </p>
      <div className="us-pf-stats" style={{ marginTop: 10 }}>
        <Kpi label="설정 이후 MP" v={fmtPct(per("all")?.port_pct, 1)} cls={tone(per("all")?.port_pct)} />
        <Kpi label="설정 이후 BM" v={fmtPct(per("all")?.bm_pct, 1)} cls={tone(per("all")?.bm_pct)} />
        <Kpi label="연환산 MP / BM" v={`${fmtPct(incAnn?.port_pct, 1)} / ${fmtPct(incAnn?.bm_pct, 1)}`} cls={tone(incAnn?.excess_pct)} />
        <Kpi label="연환산 초과" v={fmtPct(incAnn?.excess_pct, 1)} cls={tone(incAnn?.excess_pct)} />
        <Kpi label="YTD MP / BM" v={`${fmtPct(per("ytd")?.port_pct, 1)} / ${fmtPct(per("ytd")?.bm_pct, 1)}`} cls={tone(per("ytd")?.excess_pct)} />
        <Kpi label="변동성(연)" v={fmtPct(m.port.vol_pct, 1, false)} />
        <Kpi label="Sharpe" v={fmtNum(m.port.sharpe)} />
        <Kpi label="MDD" v={fmtPct(m.port.mdd_pct, 1)} cls="down" />
        <Kpi label="TE / IR" v={`${fmtPct(m.rel.tracking_error_pct, 1, false)} / ${fmtNum(m.rel.information_ratio)}`} />
        <Kpi label="베타 / 알파(연)" v={`${fmtNum(m.rel.beta)} / ${fmtPct(m.rel.alpha_pct, 1)}`} cls={tone(m.rel.alpha_pct)} />
      </div>

      <div className="kr-chart" style={{ height: 320, marginTop: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={40} tickFormatter={ytick} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "#8fa3b8", fontSize: 10 }} width={48} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—")} />
            <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
            <ReferenceLine y={100} stroke="#475569" />
            <Line type="monotone" dataKey="MP" stroke="#60a5fa" strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey="BM" stroke="#e8c547" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
            {extTail.length ? (
              <Line type="monotone" dataKey="MP 추정" stroke="#60a5fa" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            ) : null}
            {extTail.length ? (
              <Line type="monotone" dataKey="BM 추정" stroke="#e8c547" strokeWidth={1.4} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {extTail.length ? (
        <p className="meta-soft">
          점선: 기록 마지막일({data.last_date}) 이후 {extTail.at(-1)!.date}까지는 {extNote || "현재 편입 구성 시뮬레이션 수익률"}을 이어 붙인 추정치입니다.
        </p>
      ) : null}

      <div className="us-pf-split" style={{ marginTop: 10 }}>
        <div className="kr-chart" style={{ height: 170 }}>
          <p className="meta-soft">누적 초과수익 (MP/BM − 1, %)</p>
          <ResponsiveContainer width="100%" height="88%">
            <AreaChart data={chart} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={40} tickFormatter={ytick} />
              <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={42} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(2)}%`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Area type="monotone" dataKey="초과" stroke="#34d399" fill="rgba(52,211,153,0.18)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="kr-chart" style={{ height: 170 }}>
          <p className="meta-soft">드로다운 (선택 기간 고점 대비, %)</p>
          <ResponsiveContainer width="100%" height="88%">
            <AreaChart data={chart} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={40} tickFormatter={ytick} />
              <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={42} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(2)}%`} />
              <Area type="monotone" dataKey="MP_DD" name="MP" stroke="#60a5fa" fill="rgba(96,165,250,0.2)" isAnimationActive={false} />
              <Area type="monotone" dataKey="BM_DD" name="BM" stroke="#e8c547" fill="rgba(232,197,71,0.08)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="us-pf-split" style={{ marginTop: 14 }}>
        <div>
          <h3 className="geo-section-title">
            기간 수익률 <span className="meta-soft">· {asOf} 기준</span>
          </h3>
          {extTail.length ? (
            <p className="meta-soft">
              기록 마지막일({data.last_date})까지는 실제 기록, 이후 {asOf}까지는 현재 편입 구성 수익률을 이어 붙여 계산했습니다.
            </p>
          ) : null}
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>기간</th>
                  <th className="num">MP</th>
                  <th className="num">BM</th>
                  <th className="num">초과</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td className={`num ${tone(p.port_pct)}`}>{fmtPct(p.port_pct)}</td>
                    <td className={`num ${tone(p.bm_pct)}`}>{fmtPct(p.bm_pct)}</td>
                    <td className={`num ${tone(p.excess_pct)}`}>{fmtPct(p.excess_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kr-chart" style={{ height: 180, marginTop: 12 }}>
            <p className="meta-soft">롤링 1년 수익률 (%)</p>
            <ResponsiveContainer width="100%" height="88%">
              <LineChart data={data.rolling.map((r) => ({ t: r.date, MP: r.port_pct, BM: r.bm_pct, 초과: r.excess_pct }))} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={40} tickFormatter={(v: string) => v.slice(2, 7)} />
                <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={42} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
                <ReferenceLine y={0} stroke="#475569" />
                <Line type="monotone" dataKey="MP" stroke="#60a5fa" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="BM" stroke="#e8c547" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="초과" stroke="#34d399" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h3 className="geo-section-title">펀드 성과 지표 (설정 이후)</h3>
          <p className="meta-soft">
            변동성·Sharpe·Sortino·TE·IR·베타·알파·캡처는 주간 수익률(연 52주), MDD·VaR·최고/최저일은 일간 기준 · 무위험수익률 = 미 13주 T-bill (기간 평균{" "}
            {fmtPct(data.rf_ann_pct, 2, false)})
          </p>
          <MetricsTable p={m.port} b={m.bm} longDates />
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data-table">
              <tbody>
                <tr>
                  <td>상관계수 / R²</td>
                  <td className="num">
                    {fmtNum(m.rel.correlation)} / {fmtNum(m.rel.r2)}
                  </td>
                </tr>
                <tr>
                  <td>상승 / 하락 캡처</td>
                  <td className="num">
                    {fmtPct(m.rel.up_capture_pct, 0, false)} / {fmtPct(m.rel.down_capture_pct, 0, false)}
                  </td>
                </tr>
                <tr>
                  <td>BM 대비 승률 (주)</td>
                  <td className="num">{fmtPct(m.rel.hit_ratio_pct, 1, false)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isAdmin && yearsGrid.length ? (
        <>
          <h3 className="geo-section-title" style={{ marginTop: 16 }}>
            연도·월별 수익률 <span className="meta-soft">· 칸 = MP 월수익률, 색 = BM 대비 초과 · 관리자 전용</span>
          </h3>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data-table mp-year-grid">
              <thead>
                <tr>
                  <th>연도</th>
                  {MONTHS.map((mm) => (
                    <th key={mm} className="num">
                      {Number(mm)}월
                    </th>
                  ))}
                  <th className="num">MP</th>
                  <th className="num">BM</th>
                  <th className="num">초과</th>
                </tr>
              </thead>
              <tbody>
                {yearsGrid.map((y) => (
                  <tr key={y.year}>
                    <td>
                      <strong>{y.year}</strong>
                      {y.partial ? <span className="meta-soft">*</span> : null}
                    </td>
                    {MONTHS.map((mm) => {
                      const c = y.months.get(mm);
                      return (
                        <td key={mm} className={`num ${c ? tone(c.port) : ""}`} style={c ? { background: heat(c.excess, 4) } : undefined}>
                          {c ? c.port.toFixed(1) : ""}
                        </td>
                      );
                    })}
                    <td className={`num ${tone(y.port_pct)}`}>
                      <strong>{fmtPct(y.port_pct, 1)}</strong>
                    </td>
                    <td className={`num ${tone(y.bm_pct)}`}>{fmtPct(y.bm_pct, 1)}</td>
                    <td className={`num ${tone(y.excess_pct)}`} style={{ background: heat(y.excess_pct, 10) }}>
                      {fmtPct(y.excess_pct, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta-soft" style={{ marginTop: 6 }}>* 부분 연도(설정 연도 또는 진행 중인 연도).</p>
        </>
      ) : null}
      <p className="meta-soft" style={{ marginTop: 6 }}>
        데이터:{" "}
        <a href={data.source_url} target="_blank" rel="noreferrer">
          Atlas portfolio-lab 공개 API ({id})
        </a>
        {data.from_snapshot ? " · 스냅샷" : ""}. BM 산식·통화는 원본에 미기재
        {id === "MP2"
          ? " — 일간 회귀 기준 2026년은 S&P500 70 / CSI300 30(현지통화)과 거의 일치(R² 0.998)하지만, 2020~22년은 주식 노출이 약 65%(S&P 0.55 · CSI 0.10)로 낮고 연 −2%p 안팎의 차감이 있어 기간별로 BM 구성이 달랐던 것으로 추정됩니다"
          : " — 일간 회귀 기준 MSCI ACWI 노출 약 0.8로, 현재 설정한 60/30/10 BM과는 다른 산식입니다"}
        .
      </p>
      {data.notes.length ? (
        <ul className="meta-soft" style={{ marginTop: 4 }}>
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { InvDetailRow, InvestorSection, InvWindowRow } from "@/lib/krxOptionBoard";

const GRID = "#243049";
const TICK = { fill: "#94a3b8", fontSize: 11 };
const TT = { background: "#0f172a", border: "1px solid #243049" };
const COLORS: Record<string, string> = {
  외국인: "#CC9900",
  개인: "#8C9AC2",
  기관: "#a78bfa",
  기타법인: "#64748b",
};
const WINDOWS = [
  { key: "d1", label: "1일" },
  { key: "d5", label: "5일" },
  { key: "d20", label: "20일" },
] as const;

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function signed(n?: number | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return n > 0 ? `+${s}` : s;
}

function corrText(n?: number | null): string {
  return n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}`;
}

function shortDate(d: string): string {
  return d.slice(5).replace("-", "/");
}

/** 0 을 가운데 둔 가로 막대 — ETF Flow 탭과 같은 클래스. */
function MiniBar({ value, max }: { value: number; max: number }) {
  if (!max) return null;
  const pct = Math.min(50, (Math.abs(value) / max) * 50);
  return (
    <span className="etfflow-bar">
      <span
        className={`etfflow-bar-fill ${value >= 0 ? "pos" : "neg"}`}
        style={value >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
      />
    </span>
  );
}

function maxAbs(vals: Array<number | undefined>): number {
  return Math.max(0, ...vals.map((v) => Math.abs(v ?? 0)));
}

/** 투자자 창 표 — 방향(현물·선물·비만기일 옵션)과 만기일 콜을 나눠 보여 준다. */
function FlowTable({ rows, hasCash }: { rows: Array<{ name: string } & InvWindowRow>; hasCash: boolean }) {
  const cashMax = maxAbs(rows.map((r) => r.cash_eok));
  const futMax = maxAbs(rows.map((r) => r.fut_qty));
  const dirMax = maxAbs(rows.map((r) => r.dir_eok));
  return (
    <table className="kr-table etfflow-table">
      <thead>
        <tr>
          <th>투자자</th>
          {hasCash ? <th className="num">현물(억)</th> : null}
          <th className="num">선물(계약)</th>
          <th className="num">선물(억)</th>
          <th className="num">콜(계약)</th>
          <th className="num">풋(계약)</th>
          <th className="num">비만기일 옵션 방향(억)</th>
          <th className="num">만기일 콜(억)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th className="etfflow-rowhead">{r.name}</th>
            {hasCash ? (
              <td className={`num ${tone(r.cash_eok)}`}>
                <strong>{signed(r.cash_eok)}</strong>
                <MiniBar value={r.cash_eok ?? 0} max={cashMax} />
              </td>
            ) : null}
            <td className={`num ${tone(r.fut_qty)}`}>
              {signed(r.fut_qty)}
              <MiniBar value={r.fut_qty} max={futMax} />
            </td>
            <td className={`num ${tone(r.fut_eok)}`}>{signed(r.fut_eok)}</td>
            <td className={`num ${tone(r.call_qty)}`}>{signed(r.call_qty)}</td>
            <td className={`num ${tone(r.put_qty)}`}>{signed(r.put_qty)}</td>
            <td className={`num ${tone(r.dir_eok)}`}>
              <strong>{signed(r.dir_eok, 1)}</strong>
              <MiniBar value={r.dir_eok} max={dirMax} />
            </td>
            <td className="num muted">{signed(r.roll_eok, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailTable({ rows }: { rows: InvDetailRow[] }) {
  const futMax = maxAbs(rows.map((r) => r.fut_qty));
  return (
    <table className="kr-table etfflow-table">
      <thead>
        <tr>
          <th>투자자</th>
          <th className="num">선물(계약)</th>
          <th className="num">콜(계약)</th>
          <th className="num">풋(계약)</th>
          <th className="num">콜(억)</th>
          <th className="num">풋(억)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th className="etfflow-rowhead">{r.name}</th>
            <td className={`num ${tone(r.fut_qty)}`}>
              {signed(r.fut_qty)}
              <MiniBar value={r.fut_qty} max={futMax} />
            </td>
            <td className={`num ${tone(r.call_qty)}`}>{signed(r.call_qty)}</td>
            <td className={`num ${tone(r.put_qty)}`}>{signed(r.put_qty)}</td>
            <td className={`num ${tone(r.call_eok)}`}>{signed(r.call_eok, 1)}</td>
            <td className={`num ${tone(r.put_eok)}`}>{signed(r.put_eok, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function KrxInvestorFlowSection({
  inv,
  no,
  range,
}: {
  inv: InvestorSection;
  no: number;
  range: number;
}) {
  const [win, setWin] = useState<"d1" | "d5" | "d20">("d5");
  const hasCash = Boolean(inv.has_cash);
  const expoKey = hasCash ? "expo" : "cum_fut";

  // 누적선은 화면 기간 시작일을 0 으로 다시 맞춘다 (3개월/6개월 칩과 함께 바뀜)
  const series = useMemo(() => {
    const rows = inv.series.slice(-range);
    if (!rows.length) return rows;
    const first = rows[0];
    const base: Record<string, number> = {};
    for (const n of inv.investors) {
      for (const k of [`${expoKey}_${n}`, `cum_dir_${n}`]) base[k] = Number(first[k] ?? 0);
    }
    return rows.map((r) => {
      const out: Record<string, number | string | boolean | null> = { ...r };
      for (const k of Object.keys(base)) out[k] = Math.round((Number(r[k] ?? 0) - base[k]) * 10) / 10;
      return out;
    });
  }, [inv, range, expoKey]);
  const rollSeries = useMemo(() => series.filter((r) => r.exp), [series]);

  const rows = inv.investors.map((name) => ({ name, ...inv.windows[win][name] }));
  const detail = inv.detail?.windows[win] ?? null;
  const expDays = inv.windows[win][inv.investors[0]]?.exp_days ?? 0;

  return (
    <>
      <div className="etfflow-sec-head">
        <h3>{no}. 투자자별 수급 — 코스피 현물·코스피200 선물·옵션</h3>
        <span className="kr-note">
          정규장 순매수 · 기준일 {inv.as_of} · 적재 {inv.first}~ ({inv.n_days}영업일, 만기일 {inv.n_exp ?? "—"}일)
          {hasCash ? "" : " · 현물 미적재"} · KRX 정보데이터시스템
        </span>
      </div>

      <ul className="optboard-reads">
        {inv.reads.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>

      <div className="chip-row" role="group" aria-label="집계 기간">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            className={`chip ${win === w.key ? "active" : ""}`}
            onClick={() => setWin(w.key)}
          >
            {w.label} 누적
          </button>
        ))}
        <span className="kr-note">이 기간 만기일 {expDays}일 — 만기일 콜은 방향에서 빼고 오른쪽 열에 따로</span>
      </div>
      <div className="table-wrap">
        <FlowTable rows={rows} hasCash={hasCash} />
      </div>

      <div className="optboard-grid">
        <div className="gamma-chart">
          <p className="meta-soft">
            {hasCash
              ? "현물+선물 누적 노출 (억원, 선물 = 계약 × 코스피 200 × 25만원) · 오른쪽 축 코스피 200"
              : "선물 누적 순매수 (계약) · 오른쪽 축 코스피 200"}
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} minTickGap={24} />
              <YAxis
                yAxisId="q"
                tick={TICK}
                width={60}
                tickFormatter={(v: number) => (hasCash ? Math.round(v).toLocaleString("ko-KR") : `${Math.round(v / 1000)}K`)}
              />
              <YAxis yAxisId="k" orientation="right" tick={TICK} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine yAxisId="q" y={0} stroke="#64748b" />
              {inv.investors.map((n) => (
                <Line
                  key={n}
                  yAxisId="q"
                  dataKey={`${expoKey}_${n}`}
                  name={n}
                  stroke={COLORS[n]}
                  dot={false}
                  strokeWidth={n === "외국인" ? 2.4 : 1.6}
                />
              ))}
              <Line yAxisId="k" dataKey="k200" name="코스피 200" stroke="#38bdf8" dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="gamma-chart">
          <p className="meta-soft">비만기일 옵션 방향 누적 (콜−풋 순매수대금, 억원) · +면 상방, −면 하방 대비</p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} minTickGap={24} />
              <YAxis yAxisId="q" tick={TICK} width={56} tickFormatter={(v: number) => Math.round(v).toLocaleString("ko-KR")} />
              <YAxis yAxisId="k" orientation="right" tick={TICK} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine yAxisId="q" y={0} stroke="#64748b" />
              {inv.investors.map((n) => (
                <Line
                  key={n}
                  yAxisId="q"
                  dataKey={`cum_dir_${n}`}
                  name={n}
                  stroke={COLORS[n]}
                  dot={false}
                  strokeWidth={n === "외국인" ? 2.4 : 1.6}
                />
              ))}
              <Line yAxisId="k" dataKey="k200" name="코스피 200" stroke="#38bdf8" dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="optboard-grid">
        <div className="gamma-chart">
          <p className="meta-soft">
            만기일 콜 순매수대금 (억원) — 기관(주로 투신 = 커버드콜 ETF 롤 매도) ↔ 외국인. 방향 베팅이 아닌 변동성 수급
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rollSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={TICK} minTickGap={16} />
              <YAxis tick={TICK} width={52} tickFormatter={(v: number) => Math.round(v).toLocaleString("ko-KR")} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#64748b" />
              <Bar dataKey="roll_외국인" name="외국인" fill={COLORS["외국인"]} />
              <Bar dataKey="roll_기관" name="기관" fill={COLORS["기관"]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="table-wrap">
          <p className="meta-soft">지수 동행성 — 일별 순매수와 코스피 200 등락률 상관 ({inv.n_days}영업일)</p>
          <table className="kr-table etfflow-table">
            <thead>
              <tr>
                <th>투자자</th>
                {hasCash ? <th className="num">현물·당일</th> : null}
                {hasCash ? <th className="num">현물·익일</th> : null}
                <th className="num">선물·당일</th>
                <th className="num">선물·익일</th>
                <th className="num">옵션방향·당일</th>
                <th className="num">옵션방향·익일</th>
              </tr>
            </thead>
            <tbody>
              {inv.corr.map((c) => (
                <tr key={c.name}>
                  <th className="etfflow-rowhead">{c.name}</th>
                  {hasCash ? <td className={`num ${tone(c.cash_same)}`}>{corrText(c.cash_same)}</td> : null}
                  {hasCash ? <td className={`num ${tone(c.cash_next)}`}>{corrText(c.cash_next)}</td> : null}
                  <td className={`num ${tone(c.fut_same)}`}>{corrText(c.fut_same)}</td>
                  <td className={`num ${tone(c.fut_next)}`}>{corrText(c.fut_next)}</td>
                  <td className={`num ${tone(c.dir_same)}`}>{corrText(c.dir_same)}</td>
                  <td className={`num ${tone(c.dir_next)}`}>{corrText(c.dir_next)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail ? (
        <div className="table-wrap">
          <p className="meta-soft">
            기관 세부 · {WINDOWS.find((w) => w.key === win)?.label} 누적 (기간합계, 만기일 포함, 기준일 {inv.detail?.as_of})
          </p>
          <DetailTable rows={detail.filter((r) => r.name !== "기관합계")} />
        </div>
      ) : null}
      <ul className="kr-note etfflow-notes">
        {inv.method.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { EtfFlowWeeklyPayload, FlowTopRow, KrInvestorRow } from "@/lib/etfFlowWeekly";

const EXCEL_HREF = "/api/etf-flow-weekly/excel";
const INVESTORS: Array<{ key: "indiv" | "inst" | "foreign"; label: string }> = [
  { key: "indiv", label: "개인" },
  { key: "inst", label: "기관" },
  { key: "foreign", label: "외국인" },
];

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function fmtB(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function fmtEok(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("ko-KR")}`;
}

function fmtPct(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** 0 을 가운데 둔 가로 막대 (양수 오른쪽, 음수 왼쪽). */
function Bar({ value, max }: { value: number; max: number }) {
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

function TopTable({ label, rows }: { label: string; rows: FlowTopRow[] }) {
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.flow_w)));
  return (
    <>
      {rows.map((r, i) => (
        <tr key={`${label}-${r.ticker}`}>
          {i === 0 ? (
            <th rowSpan={rows.length} className="etfflow-rowhead">
              {label}
            </th>
          ) : null}
          <td>
            <strong>{r.ticker}</strong>
          </td>
          <td className="etfflow-name">{r.name}</td>
          <td>{r.asset_class}</td>
          <td className={`num ${tone(r.flow_w)}`}>{fmtB(r.flow_w)}</td>
          <td className="etfflow-barcell">
            <Bar value={r.flow_w} max={max} />
          </td>
          <td className={`num ${tone(r.flow_aum_pct)}`}>{fmtPct(r.flow_aum_pct)}</td>
          <td className={`num ${tone(r.flow_4w)}`}>{fmtB(r.flow_4w)}</td>
          <td>{r.kr_similar || "—"}</td>
        </tr>
      ))}
    </>
  );
}

function IndivTable({ label, rows }: { label: string; rows: KrInvestorRow[] }) {
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.indiv)));
  return (
    <div className="table-wrap">
      <table className="kr-table etfflow-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>{label} ETF명</th>
            <th className="num">순매수매도(억원)</th>
            <th />
            <th>분류</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.code}>
              <td className="num">{i + 1}</td>
              <td className="etfflow-name">{r.name}</td>
              <td className={`num ${tone(r.indiv)}`}>{fmtEok(r.indiv)}</td>
              <td className="etfflow-barcell">
                <Bar value={r.indiv} max={max} />
              </td>
              <td className="muted">{r.group}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EtfFlowWeeklyTab() {
  const [data, setData] = useState<EtfFlowWeeklyPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/etf-flow-weekly", { cache: "no-store" });
      setData((await res.json()) as EtfFlowWeeklyPayload);
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

  const us = data?.us;
  const kr = data?.kr;
  const weeksOldNew = useMemo(() => (us?.weeks || []).map((w) => w.label).reverse(), [us]);
  const assetMax = Math.max(0, ...(us?.asset.this || []).map(Math.abs), ...(us?.asset.last || []).map(Math.abs));
  const themeMax = Math.max(0, ...(us?.themes || []).map((t) => Math.abs(t.total)));
  const krGroups = Object.keys(kr?.groups || {});

  return (
    <section className="panel etfflow-panel">
      <div className="panel-head">
        <div>
          <h2>ETF Flow 주간</h2>
          <p className="kr-note">
            미국 상장 ETF 자금흐름 · 국내 상장 해외 ETF 투자자별 수급 · 차주 이벤트
            {data?.generated_at_display ? ` · 작성 ${data.generated_at_display}` : ""}
          </p>
        </div>
        <div className="btn-row">
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

      {data?.ok && us && kr ? (
        <>
          <SectionHead
            no={1}
            title="자산군별 주간 순유입"
            note={`미국 상장 ETF · 단위 $B · 이번주 ${us.weeks[0]?.label} / 지난주 ${us.weeks[1]?.label}`}
          />
          <div className="table-wrap">
            <table className="kr-table etfflow-table">
              <thead>
                <tr>
                  <th />
                  {us.asset.labels.map((l) => (
                    <th key={l} className="num">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["이번주", us.asset.this],
                  ["지난주", us.asset.last],
                ].map(([label, vals]) => (
                  <tr key={label as string}>
                    <th className="etfflow-rowhead">{label as string}</th>
                    {(vals as number[]).map((v, i) => (
                      <td key={i} className={`num ${tone(v)}`}>
                        {fmtB(v)}
                        <Bar value={v} max={assetMax} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionHead no={2} title="테마별 주간 순유입 (4주)" note="미국 상장 ETF · 단위 $B · 레버리지·인버스 제외" />
          <div className="table-wrap">
            <table className="kr-table etfflow-table">
              <thead>
                <tr>
                  <th>테마</th>
                  {weeksOldNew.map((l) => (
                    <th key={l} className="num">
                      {l}
                    </th>
                  ))}
                  <th className="num">4주 합계</th>
                  <th />
                  <th>대표 ETF</th>
                </tr>
              </thead>
              <tbody>
                {us.themes.map((t) => (
                  <tr key={t.name}>
                    <th className="etfflow-rowhead">{t.name}</th>
                    {t.weekly.map((v, i) => (
                      <td key={i} className={`num ${tone(v)}`}>
                        {fmtB(v)}
                      </td>
                    ))}
                    <td className={`num ${tone(t.total)}`}>
                      <strong>{fmtB(t.total)}</strong>
                    </td>
                    <td className="etfflow-barcell">
                      <Bar value={t.total} max={themeMax} />
                    </td>
                    <td className="muted">{t.top.slice(0, 4).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionHead
            no={3}
            title="해외ETF 주간 유출입 Top 10 (미국 상장 ETF 기준)"
            note="단위 $B · AUM대비 = 주간순유입/AUM · 국내 유사 ETF는 TIGER 우선"
          />
          <div className="table-wrap">
            <table className="kr-table etfflow-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>티커</th>
                  <th>ETF</th>
                  <th>자산군</th>
                  <th className="num">주간순유입</th>
                  <th />
                  <th className="num">AUM대비</th>
                  <th className="num">4주 누적</th>
                  <th>국내 유사 ETF</th>
                </tr>
              </thead>
              <tbody>
                <TopTable label="유입" rows={us.top_in} />
                <TopTable label="유출" rows={us.top_out} />
              </tbody>
            </table>
          </div>

          <SectionHead
            no={4}
            title="국내 상장 해외 ETF 투자자별 수급"
            note={`단위 억원 · ${kr.week.label} · 순매수 수량×종가 추정`}
          />
          <div className="table-wrap">
            <table className="kr-table etfflow-table">
              <thead>
                <tr>
                  <th />
                  {krGroups.map((g) => (
                    <th key={g} className="num">
                      {g}
                    </th>
                  ))}
                  <th className="num">합계</th>
                </tr>
              </thead>
              <tbody>
                {INVESTORS.map(({ key, label }) => {
                  const vals = krGroups.map((g) => kr.groups[g]?.[key] ?? 0);
                  const sum = vals.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={key}>
                      <th className="etfflow-rowhead">{label}</th>
                      {vals.map((v, i) => (
                        <td key={i} className={`num ${tone(v)}`}>
                          {fmtEok(v)}
                        </td>
                      ))}
                      <td className={`num ${tone(sum)}`}>
                        <strong>{fmtEok(sum)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <SectionHead
            no={5}
            title="국내 상장 해외 ETF 개인 순매수 유출입 Top 20"
            note={`단위 억원 · ${kr.week.label}`}
          />
          <div className="etfflow-grid">
            <IndivTable label="개인순매수" rows={kr.indiv_buy} />
            <IndivTable label="개인순매도" rows={kr.indiv_sell} />
          </div>

          <SectionHead
            no={6}
            title="차주 주요 이벤트"
            note={`${data.events.start} ~ ${data.events.end}`}
          />
          <div className="table-wrap">
            <table className="kr-table etfflow-table">
              <thead>
                <tr>
                  <th>일자</th>
                  <th>구분</th>
                  <th>이벤트</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {data.events.picks.map((p, i) => (
                  <tr key={i}>
                    <td>{p.day}</td>
                    <td>{p.category}</td>
                    <td>
                      <strong>{p.event}</strong>
                    </td>
                    <td className="muted">{p.detail}</td>
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

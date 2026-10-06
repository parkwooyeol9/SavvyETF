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
  impactLevel,
  type EventStudy,
  type FlowStatus,
  type RebalanceFlow,
  type RebalancePayload,
  type RebalanceResponse,
} from "@/lib/rebalance";
import ExcelButton from "@/components/ExcelButton";
import { downloadRebalanceExcel } from "@/lib/rebalanceExcel";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function kstToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function dayLabel(iso: string): { md: string; w: string } {
  const d = new Date(`${iso}T00:00:00`);
  return { md: `${d.getMonth() + 1}/${d.getDate()}`, w: WEEKDAYS[d.getDay()] };
}

function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtEok(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.abs(v) >= 10_000 ? `${fmtNum(v / 10_000, 2)}조` : `${fmtNum(v)}억`;
}

function fmtSigned(v: number): string {
  const r = Math.round(v);
  return `${r > 0 ? "+" : ""}${fmtNum(r)}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function toneOf(v: number | null | undefined): string {
  return v == null ? "" : v > 0 ? "tone-up" : v < 0 ? "tone-down" : "";
}

function StatusChip({ status, kind }: { status: FlowStatus; kind: "etf" | "index" }) {
  if (kind === "index") return <span className="rb-chip off">지수</span>;
  if (status === "ok") return <span className="rb-chip ok">계산</span>;
  if (status === "no_holdings" || status === "no_aum") return <span className="rb-chip wait">비중 필요</span>;
  if (status === "rule_unknown") return <span className="rb-chip off">일정 미확인</span>;
  return <span className="rb-chip off">비중 규칙 없음</span>;
}

type ImpactRow = {
  code: string;
  name: string;
  net: number;
  adv: number | null;
  ratio: number | null;
  level: ReturnType<typeof impactLevel>;
  by: { etf: string; scenario: string; amount: number }[];
};

function impactRows(data: RebalancePayload, date: string, choice: Record<string, string>): ImpactRow[] {
  const adv = new Map<string, number>();
  for (const r of data.impact) if (r.adv_eok) adv.set(r.code, r.adv_eok);
  const map = new Map<string, Omit<ImpactRow, "adv" | "ratio" | "level">>();
  for (const f of data.flows) {
    if (f.trade_date !== date || choice[f.etf_code] !== f.scenario_id) continue;
    for (const t of f.trades) {
      const row = map.get(t.code) || { code: t.code, name: t.name, net: 0, by: [] };
      row.net += t.amount_eok;
      if (Math.abs(t.amount_eok) >= 0.05) {
        row.by.push({ etf: f.etf_name, scenario: f.scenario_label, amount: t.amount_eok });
      }
      map.set(t.code, row);
    }
  }
  return [...map.values()]
    .filter((r) => Math.abs(r.net) >= 0.5)
    .map((r) => {
      const a = adv.get(r.code) ?? null;
      const ratio = a ? Math.abs(r.net) / a : null;
      return { ...r, adv: a, ratio, level: impactLevel(ratio) };
    })
    .sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
}

function ImpactBars({ rows }: { rows: ImpactRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => Math.abs(r.net)));
  return (
    <div className="rb-bars">
      <div className="rb-bars-hd">종목</div>
      <div className="rb-bars-hd" style={{ textAlign: "right", paddingRight: 6 }}>
        매도
      </div>
      <div className="rb-bars-hd" style={{ paddingLeft: 6 }}>
        매수 (억원)
      </div>
      <div className="rb-bars-hd" style={{ textAlign: "right" }}>
        거래대금비
      </div>
      {rows.map((r) => {
        const width = `${((Math.abs(r.net) / max) * 80).toFixed(1)}%`;
        const value = <span className="rb-bar-v">{fmtSigned(r.net)}</span>;
        const bar = <span className="rb-bar" style={{ width }} />;
        return (
          <div key={r.code} className="rb-bars-row">
            <button
              type="button"
              className="rb-bar-name"
              title={r.code}
              onClick={() => setOpen(open === r.code ? null : r.code)}
            >
              {r.name}
            </button>
            <div className="rb-bar-neg">{r.net < 0 ? <>{value}{bar}</> : null}</div>
            <div className="rb-bar-pos">{r.net >= 0 ? <>{bar}{value}</> : null}</div>
            <div className={`rb-lvl rb-lvl-${r.level}`}>
              {r.ratio == null ? "—" : `${(r.ratio * 100).toFixed(1)}%`}
            </div>
            {open === r.code ? (
              <div className="rb-breakdown">
                {r.by.map((b) => `${b.etf} (${b.scenario}) ${fmtSigned(b.amount)}억`).join(" · ")}
                {r.adv ? ` · 20일 평균 거래대금 ${fmtNum(r.adv)}억` : ""}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FlowDetail({ flow }: { flow: RebalanceFlow }) {
  const capped = new Set(flow.capped_by_mcap || []);
  const cappedNames = flow.trades.filter((t) => capped.has(t.code)).map((t) => t.name);
  return (
    <div className="rb-flow">
      <h4>
        {flow.etf_name} <span className="meta-soft">{flow.scenario_label}</span>
      </h4>
      <p className="meta-soft rb-flow-meta">
        순자산 {fmtEok(flow.aum_eok)} · 비중 기준일 {flow.holdings_as_of || "—"} · 매수{" "}
        {fmtSigned(flow.buy_eok)}억 / 매도 {fmtSigned(flow.sell_eok)}억
        {flow.scenario_note ? ` · ${flow.scenario_note}` : ""}
        {flow.coverage_pct < 95 ? (
          <span className="rb-warn"> · 비중 합계 {flow.coverage_pct}% (상위 종목만 수집)</span>
        ) : null}
      </p>
      {cappedNames.length ? (
        <p className="meta-soft rb-flow-meta">
          상한 적용 · {cappedNames.join(", ")} (시가총액 비중이 종목당 상한을 넘어 상한으로 맞춤)
        </p>
      ) : null}
      <div className="table-wrap">
        <table className="data-table rb-num-table">
          <thead>
            <tr>
              <th>종목</th>
              <th>현재</th>
              <th>목표</th>
              <th>변화</th>
              <th>예상 매매(억원)</th>
            </tr>
          </thead>
          <tbody>
            {flow.trades.map((t) => (
              <tr key={t.code}>
                <td>
                  {t.name} <span className="meta-soft">{t.code}</span>
                  {capped.has(t.code) ? <span className="rb-tag dd rb-cap-tag">상한</span> : null}
                </td>
                <td>{t.current_pct.toFixed(2)}%</td>
                <td>{t.target_pct.toFixed(2)}%</td>
                <td>
                  {t.delta_pct > 0 ? "+" : ""}
                  {t.delta_pct.toFixed(2)}%p
                </td>
                <td className={t.amount_eok > 0 ? "tone-up" : t.amount_eok < 0 ? "tone-down" : ""}>
                  {fmtSigned(t.amount_eok)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {flow.holdings_source ? <p className="meta-soft">출처: {flow.holdings_source}</p> : null}
    </div>
  );
}

const SIDE_LABEL = { buy: "ETF 매수", sell: "ETF 매도" } as const;

function EventStudySection({ study, onExcel }: { study: EventStudy; onExcel: () => Promise<void> }) {
  const { summary, params } = study;
  const chart = study.paths.map((p) => ({
    t: p.t,
    buy: p.buy == null ? null : p.buy * 100,
    sell: p.sell == null ? null : p.sell * 100,
  }));
  const pre = `T${params.pre}~T-1`;
  const post = `T+1~T+${params.hold}`;
  return (
    <section className="geo-section geo-featured">
      <div className="ka-hero">
        <h3 className="geo-section-title">과거 정기변경 전후 주가</h3>
        <ExcelButton onClick={onExcel} />
      </div>
      <p className="geo-thesis">
        지난 정기변경에서 ETF가 사고판 종목의 시장(KOSPI·KOSDAQ) 대비 초과수익. T는 매매일 종가. 선은 T
        {params.path_from}부터 누적한 평균입니다.
      </p>
      <div className="rb-es-stats">
        {(["sell", "buy"] as const).map((side) => {
          const s = summary.by_side[side];
          return (
            <div key={side} className="rb-es-stat">
              <strong className={side === "sell" ? "tone-down" : "tone-up"}>
                {SIDE_LABEL[side]} {s.n}건
              </strong>
              <span>
                {pre} <b className={toneOf(s.car_pre)}>{fmtPct(s.car_pre)}</b>
              </span>
              <span>
                T일 <b className={toneOf(s.ar_0)}>{fmtPct(s.ar_0)}</b>
              </span>
              <span>
                {post} <b className={toneOf(s.car_post)}>{fmtPct(s.car_post)}</b>
              </span>
            </div>
          );
        })}
      </div>
      <div className="rb-es-chart">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#2b3648" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" tickFormatter={(t: number) => (t === 0 ? "T" : `T${t > 0 ? "+" : ""}${t}`)} />
            <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={48} />
            <ReferenceLine x={0} stroke="#8fa3b8" strokeDasharray="4 4" />
            <ReferenceLine y={0} stroke="#8fa3b8" />
            <Tooltip
              formatter={(v: number, key: string) => [`${v.toFixed(1)}%`, key === "sell" ? "ETF 매도 종목" : "ETF 매수 종목"]}
              labelFormatter={(t: number) => (t === 0 ? "T (매매일)" : `T${t > 0 ? "+" : ""}${t}`)}
              contentStyle={{ background: "#141c27", border: "1px solid #2b3648" }}
            />
            <Legend formatter={(key: string) => (key === "sell" ? "ETF 매도 종목" : "ETF 매수 종목")} />
            <Line type="monotone" dataKey="sell" stroke="#ff6b6b" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="buy" stroke="#3dd68c" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="table-wrap">
        <table className="data-table rb-num-table">
          <thead>
            <tr>
              <th>매매일 · 종목</th>
              <th>방향</th>
              <th>{pre}</th>
              <th>T일</th>
              <th>{post}</th>
              <th>평균 거래대금</th>
            </tr>
          </thead>
          <tbody>
            {study.rows.map((r) => (
              <tr key={`${r.event_id}-${r.code}`} title={r.label}>
                <td>
                  {r.trade_date.slice(5).replace("-", "/")} · {r.name}{" "}
                  <span className="meta-soft">{r.code}</span>
                </td>
                <td className={r.side === "sell" ? "tone-down" : "tone-up"}>{r.side === "sell" ? "매도" : "매수"}</td>
                <td className={toneOf(r.car_pre)}>{fmtPct(r.car_pre)}</td>
                <td className={toneOf(r.ar_0)}>{fmtPct(r.ar_0)}</td>
                <td className={toneOf(r.car_post)}>{fmtPct(r.car_post)}</td>
                <td>{r.adv_eok ? `${fmtNum(r.adv_eok)}억` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta-soft">
        정기변경 {summary.n_events}회 · 종목 {summary.n}건으로 표본이 작고, 같은 날 시장 급변이 섞여 있어
        일반화하기 어렵습니다. 매매일이 확실한 이벤트만 넣었고, 평균 거래대금은 매매일 직전 20거래일 기준. 가격은
        네이버 일봉 종가(수정주가 아님). 과거 결과이며 투자 권유가 아닙니다.
      </p>
    </section>
  );
}

export default function RebalanceTab() {
  const [data, setData] = useState<RebalancePayload | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const today = useMemo(() => kstToday(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rebalance");
      const json = (await res.json()) as RebalanceResponse;
      if (!json.ok) throw new Error(json.error);
      setData(json);
      setSource(json.source);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upcoming = useMemo(
    () => (data?.trade_days || []).filter((d) => d.trade_date >= today),
    [data, today],
  );

  useEffect(() => {
    if (!data) return;
    const primary: Record<string, string> = {};
    for (const f of data.flows) if (f.primary) primary[f.etf_code] = f.scenario_id;
    setChoice(primary);
    const biggest = [...upcoming].sort((a, b) => b.aum_eok - a.aum_eok)[0];
    setSelected(biggest?.trade_date || data.trade_days[data.trade_days.length - 1]?.trade_date || null);
  }, [data, upcoming]);

  const rows = useMemo(
    () => (data && selected ? impactRows(data, selected, choice) : []),
    [data, selected, choice],
  );

  if (!data) {
    return (
      <section className="geo-section geo-featured">
        <h2 className="geo-section-title">ETF 리밸런싱</h2>
        <p className="empty">{loading ? "리밸런싱 일정 불러오는 중…" : error || "데이터 없음"}</p>
      </section>
    );
  }

  const etfByCode = new Map(data.etfs.map((e) => [e.code, e]));
  const expirySet = new Set(data.expiries.map((e) => e.expiry));
  const next = upcoming[0];
  const biggest = [...upcoming].sort((a, b) => b.aum_eok - a.aum_eok)[0];
  const computed = new Set(data.flows.map((f) => f.etf_code)).size;
  const totalEtf = data.etfs.filter((e) => e.kind === "etf").length;
  const maxAum = Math.max(1, ...data.trade_days.map((d) => d.aum_eok));
  const sel = selected ? dayLabel(selected) : null;
  const dayEvents = data.events.filter((e) => e.trade_date === selected);
  const dayFlows = data.flows.filter((f) => f.trade_date === selected);
  const chosenFlows = dayFlows.filter((f) => choice[f.etf_code] === f.scenario_id);
  const scenarioGroups = new Map<string, RebalanceFlow[]>();
  for (const f of dayFlows) scenarioGroups.set(f.etf_code, [...(scenarioGroups.get(f.etf_code) || []), f]);
  const multiScenario = [...scenarioGroups.entries()].filter(([, fs]) => fs.length > 1);
  const top = rows[0];
  const excel = () => downloadRebalanceExcel(data, selected, rows);

  const kpis: [string, string, string][] = [
    [
      "다음 매매일",
      next ? `${dayLabel(next.trade_date).md} (${dayLabel(next.trade_date).w})` : "—",
      next ? `D-${daysUntil(next.trade_date, today)} · ETF ${next.etfs.length}개` : "",
    ],
    [
      "최대 매매일",
      biggest ? dayLabel(biggest.trade_date).md : "—",
      biggest ? `정기변경 ETF 순자산 ${fmtEok(biggest.aum_eok)}` : "",
    ],
    ["선택일 최대 순매매", top ? top.name : "—", top ? `${fmtSigned(top.net)}억원` : "계산된 ETF 없음"],
    ["계산 커버리지", `${computed} / ${totalEtf}`, "규칙·비중이 있는 ETF 수"],
  ];

  return (
    <div className="rb-root">
      <section className="geo-section geo-featured">
        <div className="ka-hero">
          <div>
            <h2 className="geo-section-title">ETF 리밸런싱</h2>
            <p className="geo-thesis">
              국내 주식형 ETF 정기변경 일정 · 예상 매매 규모 · 충격받는 종목. 매매일은 정기변경 효력일
              직전 영업일 종가로 봅니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <ExcelButton onClick={excel} />
            <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
              {loading ? "불러오는 중…" : "새로고침"}
            </button>
          </div>
        </div>
        <p className="meta-soft">
          기준일 {data.as_of} · 생성 {data.generated_at.replace("T", " ").slice(0, 16)} · 거래대금{" "}
          {data.adv_as_of || "미수집"}
          {source === "bundled" ? " · 번들 스냅샷" : ""}
        </p>
        {error ? <p className="rb-warn">{error}</p> : null}
      </section>

      <section className="rb-kpis">
        {kpis.map(([label, value, note]) => (
          <div key={label} className="geo-featured rb-kpi">
            <div className="rb-kpi-label">{label}</div>
            <div className="rb-kpi-value">{value}</div>
            <div className="rb-kpi-note">{note}</div>
          </div>
        ))}
      </section>

      <section className="geo-section geo-featured">
        <h3 className="geo-section-title">매매일 캘린더</h3>
        <p className="geo-thesis">
          막대는 그날 정기변경하는 ETF 순자산 합계. 날짜를 누르면 아래 표가 바뀝니다.
        </p>
        <div className="rb-timeline">
          {data.trade_days.map((d) => {
            const x = dayLabel(d.trade_date);
            const past = d.trade_date < today;
            return (
              <button
                key={d.trade_date}
                type="button"
                className={`rb-day${d.trade_date === selected ? " active" : ""}${past ? " past" : ""}`}
                onClick={() => setSelected(d.trade_date)}
              >
                <span className="rb-day-d">{x.md}</span>
                <span className="rb-day-w">{x.w}</span>
                <div className="rb-day-n">
                  ETF {d.etfs.length}개 ·{" "}
                  {d.aum_eok ? fmtEok(d.aum_eok) : d.has_index ? "지수 추종 전체" : "—"}
                </div>
                <div className="rb-day-bar">
                  <span style={{ width: `${((d.aum_eok / maxAum) * 100).toFixed(1)}%` }} />
                </div>
                <div className="rb-tags">
                  {expirySet.has(d.trade_date) ? <span className="rb-tag exp">옵션만기</span> : null}
                  {d.has_index ? <span className="rb-tag idx">지수 정기변경</span> : null}
                  {!past ? <span className="rb-tag dd">D-{daysUntil(d.trade_date, today)}</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="rb-two">
        <section className="geo-section geo-featured">
          <h3 className="geo-section-title">
            종목별 예상 순매매{sel ? ` · ${sel.md}(${sel.w})` : ""}
          </h3>
          <p className="geo-thesis">
            보유비중이 수집되고 규칙이 확인된 ETF만 합산. 종목명을 누르면 ETF별 내역. 오른쪽은 20일 평균
            거래대금 대비 비율(10%↑ 빨강, 3%↑ 노랑).
          </p>
          {multiScenario.length ? (
            <div className="rb-scen">
              {multiScenario.map(([code, fs]) => (
                <span key={code}>
                  <strong>{fs[0].etf_name}</strong>
                  {fs.map((f) => (
                    <label key={f.scenario_id}>
                      <input
                        type="radio"
                        name={`rb-sc-${code}`}
                        checked={choice[code] === f.scenario_id}
                        onChange={() => setChoice((c) => ({ ...c, [code]: f.scenario_id }))}
                      />{" "}
                      {f.scenario_label}
                    </label>
                  ))}
                </span>
              ))}
            </div>
          ) : null}
          {rows.length ? (
            <ImpactBars key={selected || ""} rows={rows} />
          ) : (
            <p className="empty">
              {chosenFlows.length
                ? "계산된 ETF의 비중이 이미 규칙 안에 있어 예상 매매가 없습니다."
                : "이 날 계산할 수 있는 ETF가 없습니다."}
            </p>
          )}
        </section>

        <section className="geo-section geo-featured">
          <h3 className="geo-section-title">
            정기변경 ETF{sel ? ` · ${sel.md}(${sel.w}) 매매` : ""}
          </h3>
          <p className="geo-thesis">
            <span className="rb-chip ok">계산</span> 비중·규칙 있음 · <span className="rb-chip wait">비중 필요</span>{" "}
            보유비중 수집 필요 · <span className="rb-chip off">비중 규칙 없음</span> 일정만 확인
          </p>
          {dayEvents.length ? (
            <div className="table-wrap">
              <table className="data-table rb-etf-table">
                <thead>
                  <tr>
                    <th>ETF</th>
                    <th>순자산</th>
                    <th>규칙 · 효력일</th>
                    <th>Cap</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {dayEvents.map((e) => {
                    const meta = etfByCode.get(e.etf_code);
                    const eff = dayLabel(e.effective);
                    return (
                      <tr key={e.etf_code}>
                        <td>
                          <strong>{e.etf_name}</strong>
                          <div className="meta-soft">
                            {e.etf_code}
                            {e.issuer ? ` · ${e.issuer}` : ""}
                            {meta?.theme ? ` · ${meta.theme}` : ""}
                          </div>
                          {(meta?.notes || []).map((n) => (
                            <div key={n} className="meta-soft rb-note">
                              · {n}
                            </div>
                          ))}
                        </td>
                        <td>{fmtEok(e.aum_eok)}</td>
                        <td>
                          {e.rule} <span className="meta-soft">{e.rule_label}</span>
                          <div className="meta-soft">
                            효력 {eff.md}({eff.w})
                          </div>
                        </td>
                        <td>{meta?.cap_pct ? `${meta.cap_pct}%` : "—"}</td>
                        <td>
                          <StatusChip status={meta?.flow_status || "no_rule"} kind={e.kind} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">이 날 정기변경하는 ETF가 없습니다.</p>
          )}
        </section>
      </div>

      <section className="geo-section geo-featured">
        <h3 className="geo-section-title">ETF별 목표비중과 예상 매매</h3>
        <p className="geo-thesis">현재 비중 → 정기변경 후 목표 비중. 금액 = 순자산 × 비중 변화.</p>
        {chosenFlows.length ? (
          chosenFlows.map((f) => <FlowDetail key={`${f.etf_code}-${f.scenario_id}`} flow={f} />)
        ) : (
          <p className="empty">선택한 날짜에 계산된 ETF가 없습니다.</p>
        )}
      </section>

      {data.event_study?.rows.length ? <EventStudySection study={data.event_study} onExcel={excel} /> : null}

      <section className="geo-section geo-featured">
        <details className="rb-details">
          <summary>가정·출처·규칙</summary>
          <ul className="rb-notes">
            {data.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
            {data.sources.map((s) => (
              <li key={s}>출처 · {s}</li>
            ))}
            <li>
              규칙 ·{" "}
              {Object.entries(data.rule_legend)
                .map(([k, v]) => `${k} ${v}`)
                .join(" / ")}
            </li>
            <li>옵션 만기일 · {data.expiries.map((e) => e.expiry).join(", ")}</li>
          </ul>
        </details>
        <p className="meta-soft">추정치이며 투자 권유가 아닙니다.</p>
      </section>
    </div>
  );
}

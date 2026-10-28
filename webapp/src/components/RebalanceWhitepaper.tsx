"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  WP_FX_DEFAULT,
  type AddendumEvent,
  type AddendumStockRow,
  type CombinedStockRow,
  type RebalanceWhitepaper,
  type WhitepaperEvent,
  type WhitepaperGroup,
} from "@/lib/rebalance";

/**
 * 리밸런싱 백서(research/rebalance_whitepaper) 결과를 탭에 붙이는 섹션.
 * 국내 = 지수 그룹(같은 기초지수 ETF 합산) 단위, 해외 = 국내 상장 해외형 ETF 그룹(백만달러 → 원화 환산).
 */

type Market = "KR" | "US";

/**
 * 백서 기준일(10/14·10/16) 이후 생겨 숫자에 반영되지 않은 사안 — 그룹 id 별 안내.
 * 백서 JSON 을 다시 내보내면(export_webapp.py) 반영 여부를 보고 지운다.
 */
const NOT_REFLECTED: Record<string, { tag: string; note: string }> = {
  NDX: {
    tag: "ANT 미반영",
    note:
      "Anthropic(ANT, 10/26 S-1 공개) 나스닥100 조기 편입은 반영되지 않았습니다. 11/16 첫 거래면 15번째 거래일인 12/7 종가에 " +
      "Fast Entry로 편입될 수 있고(기존 종목 제외 없이 101종목), 국내 나스닥100 ETF 매수는 약 2,900억~5,300억원으로 추정됩니다" +
      "(7/6 SpaceX 편입 때 국내 ETF 6종 실측 매수 약 3,720억원 기준, 유통 약 5% 가정). 상장일·공모 규모는 미확정 · 2026-10-27 추가 안내.",
  },
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtSigned(v: number): string {
  const r = Math.round(v);
  return `${r > 0 ? "+" : ""}${fmtNum(r)}`;
}

function md(iso: string): string {
  const [, m, d] = iso.split("-");
  return d ? `${Number(m)}/${Number(d)}` : iso;
}

/** 백서 충격 = |매매| ÷ ADV20 (%). 국내 30%↑, 해외 5%↑ 를 고충격으로 본다. */
function impClass(imp: number | null, market: Market): string {
  if (imp == null) return "rb-lvl-unknown";
  const hi = market === "KR" ? 30 : 5;
  if (imp >= hi) return "rb-lvl-high";
  if (imp >= hi / 3) return "rb-lvl-mid";
  return "rb-lvl-low";
}

function fmtImp(imp: number | null): string {
  if (imp == null) return "—";
  return imp >= 100 ? `${fmtNum(imp)}%` : `${imp.toFixed(1)}%`;
}

function confTone(text: string): string {
  if (text.startsWith("높음")) return "ok";
  if (text.startsWith("근사") || text.startsWith("보통") || text.startsWith("범위")) return "wait";
  return "off";
}

/** 국내 행: 백서 addendum(10/16 유동시총 기준). 해외 행: 그룹의 예상(fc) 이벤트. */
type ForecastRow = {
  key: string;
  market: Market;
  date: string;
  short: string;
  members: string[];
  aum_jo: number;
  turn: number;
  /** 억원 (해외는 원화 환산) */
  buy_eok: number;
  buy_range: [number, number] | null;
  usd_m: number | null;
  hist_turn: [number, number] | null;
  hist_last_buy: number | null;
  hist_last_date: string | null;
  old_buy: number | null;
  n_add: number;
  n_del: number;
  conf_w: string;
  conf_s: string;
  scheme: string;
  ad?: AddendumEvent;
  group?: WhitepaperGroup;
  fc?: WhitepaperEvent;
};

function histTurnRange(g: WhitepaperGroup | undefined): [number, number] | null {
  const t = (g?.events || []).filter((e) => !e.fc && !e.irr).map((e) => e.turn);
  return t.length ? [Math.min(...t), Math.max(...t)] : null;
}

function lastActual(g: WhitepaperGroup | undefined): WhitepaperEvent | null {
  const ev = (g?.events || []).filter((e) => !e.fc);
  return ev.length ? ev[ev.length - 1] : null;
}

function forecastRows(wp: RebalanceWhitepaper): ForecastRow[] {
  const groups = new Map(wp.groups.map((g) => [g.id, g]));
  const cmp = new Map(wp.appendix.compare.map((c) => [c.gid, c]));
  const out: ForecastRow[] = [];
  for (const a of wp.addendum.events) {
    const g = groups.get(a.gid);
    const c = cmp.get(a.gid);
    const last = lastActual(g);
    out.push({
      key: `KR-${a.gid}-${a.date}`,
      market: "KR",
      date: a.date,
      short: a.short,
      members: a.members,
      aum_jo: a.aum_jo,
      turn: a.turn,
      buy_eok: a.buy,
      buy_range: a.buy_range ?? null,
      usd_m: null,
      hist_turn: c?.hist_turn ?? histTurnRange(g),
      hist_last_buy: c?.hist_last_buy ?? last?.buy ?? null,
      hist_last_date: c?.hist_last_date
        ? `${c.hist_last_date.slice(0, 4)}-${c.hist_last_date.slice(4, 6)}-${c.hist_last_date.slice(6)}`
        : last?.date ?? null,
      old_buy: c?.old_buy ?? null,
      n_add: a.n_add,
      n_del: a.n_del,
      conf_w: a.conf_w,
      conf_s: a.conf_s,
      scheme: a.scheme,
      ad: a,
      group: g,
    });
  }
  for (const g of wp.groups) {
    if (g.market !== "US") continue;
    const fc = g.events.find((e) => e.fc);
    if (!fc) continue;
    const fx = fc.fx ?? WP_FX_DEFAULT;
    const last = lastActual(g);
    out.push({
      key: `US-${g.id}-${fc.date}`,
      market: "US",
      date: fc.date,
      short: g.short,
      members: g.members.map((m) => m[1]),
      aum_jo: fc.aum,
      turn: fc.turn,
      buy_eok: (fc.buy * fx) / 100,
      buy_range: fc.range ? [(fc.range[0] * fx) / 100, (fc.range[2] * fx) / 100] : null,
      usd_m: fc.buy,
      hist_turn: histTurnRange(g),
      hist_last_buy: last ? (last.buy * (last.fx ?? fx)) / 100 : null,
      hist_last_date: last?.date ?? null,
      old_buy: null,
      n_add: fc.nin ?? 0,
      n_del: fc.nout ?? 0,
      conf_w: fc.tier === "A" ? "규칙 계산(A)" : fc.tier === "B" ? "후보 시나리오(B)" : "범위(C)",
      conf_s: fc.tier === "C" ? "범위" : "근사",
      scheme: fc.scheme || g.method.weight,
      group: g,
      fc,
    });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || y.buy_eok - x.buy_eok);
}

function StockTable({ rows, market, unit }: { rows: AddendumStockRow[]; market: Market; unit: string }) {
  if (!rows.length) return <p className="empty">종목 단위 추정 없음</p>;
  return (
    <div className="table-wrap">
      <table className="data-table rb-num-table">
        <thead>
          <tr>
            <th>종목</th>
            <th>비중 전→후</th>
            <th>매매({unit})</th>
            <th>ADV20</th>
            <th>충격</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td>
                {r.name}{" "}
                {r.status !== "유지" ? (
                  <span className={`rb-tag ${r.status === "편입" ? "dd" : "exp"}`}>{r.status}</span>
                ) : null}
              </td>
              <td>
                {r.w0.toFixed(2)} → {r.w1.toFixed(2)}%
              </td>
              <td className={r.flow > 0 ? "tone-up" : "tone-down"}>{fmtSigned(r.flow)}</td>
              <td>{fmtNum(r.adv)}</td>
              <td className={impClass(r.imp, market)}>{fmtImp(r.imp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function tupleRows(e: WhitepaperEvent): AddendumStockRow[] {
  return e.rows.map((r) => ({
    name: r[0],
    code: r[1],
    w0: r[2],
    w1: r[3],
    dw: r[4],
    flow: r[5],
    adv: r[6],
    imp: r[7],
    status: r[9],
    float: r[10] ?? null,
    close: r[11] ?? null,
  }));
}

function splitSides(rows: AddendumStockRow[], n: number) {
  const buys = rows.filter((r) => r.flow > 0).sort((a, b) => b.flow - a.flow).slice(0, n);
  const sells = rows.filter((r) => r.flow < 0).sort((a, b) => a.flow - b.flow).slice(0, n);
  return { buys, sells };
}

function ForecastDetail({ row }: { row: ForecastRow }) {
  const unit = row.market === "US" ? "백만$" : "억원";
  const sides = row.ad
    ? splitSides([...row.ad.buys, ...row.ad.sells], 10)
    : row.fc
      ? splitSides(tupleRows(row.fc), 10)
      : { buys: [], sells: [] };
  const adds = row.ad?.adds ?? row.fc?.adds ?? [];
  const dels = row.ad?.dels ?? row.fc?.dels ?? [];
  const m = row.group?.method;
  return (
    <div className="rb-wp-detail">
      <p className="meta-soft rb-flow-meta">
        구성 ETF · {row.members.join(" · ")}
        {row.ad ? ` · 구성 기준 PDF ${row.ad.pdf_date} · 규칙 적합 ${row.ad.fit_date} (오차 ${row.ad.fit_dist}%)` : ""}
      </p>
      {m ? (
        <p className="meta-soft rb-flow-meta">
          {m.provider} · {m.freq} · {m.timing}
        </p>
      ) : null}
      <ul className="rb-notes">
        <li>가중 · {row.ad?.target_note || row.scheme}</li>
        {row.ad?.sel_note ? <li>교체 · {row.ad.sel_note}</li> : null}
        {row.fc?.assume ? <li>가정 · {row.fc.assume}</li> : null}
        {row.ad?.range ? <li>규칙 재현이 어려워 과거 회전율 범위로 규모만 제시 — 종목 단위 추정 없음</li> : null}
      </ul>
      {adds.length || dels.length ? (
        <div className="rb-wp-cands">
          {adds.length ? (
            <span>
              <b className="tone-up">편입 후보</b> {adds.join(", ")}
            </span>
          ) : null}
          {dels.length ? (
            <span>
              <b className="tone-down">편출 후보</b> {dels.join(", ")}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="rb-two rb-wp-sides">
        <div>
          <h4 className="tone-up">매수 상위</h4>
          <StockTable rows={sides.buys} market={row.market} unit={unit} />
        </div>
        <div>
          <h4 className="tone-down">매도 상위</h4>
          <StockTable rows={sides.sells} market={row.market} unit={unit} />
        </div>
      </div>
    </div>
  );
}

function ForecastSection({ wp, selected, today }: { wp: RebalanceWhitepaper; selected: string | null; today: string }) {
  const rows = useMemo(() => forecastRows(wp), [wp]);
  const [market, setMarket] = useState<Market | "ALL">("KR");
  const [open, setOpen] = useState<string | null>(null);
  const shown = rows.filter((r) => market === "ALL" || r.market === market);
  const krTotal = rows.filter((r) => r.market === "KR").reduce((s, r) => s + r.buy_eok, 0);
  const maxBuy = Math.max(1, ...shown.map((r) => r.buy_range?.[1] ?? r.buy_eok));
  return (
    <section className="geo-section geo-featured">
      <h3 className="geo-section-title">지수 그룹별 11·12월 정기변경 예상</h3>
      <p className="geo-thesis">
        같은 기초지수를 따르는 ETF를 합산한 그룹 단위 예상. 국내는 {wp.as_of} 종가·운용사 PDF와 유동비율로 편입·편출 후보까지
        반영(국내 합계 매수 약 {fmtNum(krTotal / 10_000, 2)}조원). 행을 누르면 종목별 매수·매도 상위를 봅니다. 위
        캘린더에서 고른 날짜의 행은 강조됩니다.
      </p>
      <div className="chip-row">
        {(
          [
            ["KR", "국내"],
            ["US", "해외(국내 상장)"],
            ["ALL", "전체"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`chip${market === k ? " active" : ""}`}
            onClick={() => setMarket(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table rb-num-table rb-wp-table">
          <thead>
            <tr>
              <th>매매일 · 지수 그룹</th>
              <th>그룹 AUM</th>
              <th title="단방향 회전율. 괄호 = 과거 정기변경 실측 범위">회전율 (과거)</th>
              <th>예상 매수(억원)</th>
              <th>직전 실측</th>
              <th>편입/편출</th>
              <th>신뢰도 가중·교체</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const hi = r.buy_range?.[1] ?? r.buy_eok;
              const isOpen = open === r.key;
              const passed = r.date < today;
              const later = r.group ? NOT_REFLECTED[r.group.id] : undefined;
              return (
                <Fragment key={r.key}>
                  <tr
                    className={`rb-wp-row${r.date === selected ? " sel" : ""}${isOpen ? " open" : ""}${passed ? " passed" : ""}`}
                    onClick={() => setOpen(isOpen ? null : r.key)}
                  >
                    <td>
                      <span className="rb-wp-caret">{isOpen ? "▾" : "▸"}</span>
                      <span className="meta-soft">{md(r.date)}</span> <strong>{r.short}</strong>
                      {r.market === "US" ? <span className="rb-tag idx">해외</span> : null}
                      {passed ? (
                        <span className="rb-tag" title="매매일이 지났지만 이 표는 기준일 예상치 그대로입니다">
                          지남 · 실측 대기
                        </span>
                      ) : null}
                      {r.ad?.stale ? (
                        <span className="rb-tag exp" title="오늘 계산에 실패해 직전 계산값을 보여줍니다">
                          직전 값
                        </span>
                      ) : null}
                      {later ? (
                        <span className="rb-tag exp" title={later.note}>
                          {later.tag}
                        </span>
                      ) : null}
                      <div className="meta-soft rb-note">{r.scheme}</div>
                    </td>
                    <td>{fmtNum(r.aum_jo, 1)}조</td>
                    <td>
                      {r.turn.toFixed(1)}%
                      {r.hist_turn ? (
                        <div className="meta-soft rb-note">
                          ({r.hist_turn[0].toFixed(1)}~{r.hist_turn[1].toFixed(1)})
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {r.buy_range ? `${fmtNum(r.buy_range[0])}~${fmtNum(r.buy_range[1])}` : fmtNum(r.buy_eok)}
                      {r.usd_m != null ? <div className="meta-soft rb-note">${fmtNum(r.usd_m)}M</div> : null}
                      <div className="rb-day-bar rb-wp-bar">
                        <span style={{ width: `${((hi / maxBuy) * 100).toFixed(1)}%` }} />
                      </div>
                    </td>
                    <td>
                      {fmtNum(r.hist_last_buy)}
                      {r.hist_last_date ? <div className="meta-soft rb-note">{r.hist_last_date.slice(2, 7)}</div> : null}
                    </td>
                    <td>
                      {r.n_add || r.n_del ? `${r.n_add}/${r.n_del}` : "—"}
                    </td>
                    <td>
                      <span className={`rb-chip ${confTone(r.conf_w)}`}>{r.conf_w.replace(/\(.*\)/, "")}</span>{" "}
                      <span className={`rb-chip ${confTone(r.conf_s)}`}>{r.conf_s.replace(/\(.*\)/, "")}</span>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="rb-wp-open">
                      <td colSpan={7}>
                        {later ? <p className="rb-warn rb-flow-meta">{later.note}</p> : null}
                        {passed ? (
                          <p className="rb-warn rb-flow-meta">
                            매매일({r.date})이 지났습니다. 아래는 매매일 전 마지막 예상
                            {r.ad?.pdf_date ? `(PDF ${r.ad.pdf_date})` : ""}이며 실제 결과는 운용사 PDF 실측 후 반영됩니다.
                          </p>
                        ) : null}
                        <ForecastDetail row={r} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="rb-notes">
        <li>{wp.addendum.tv_lead}</li>
        {wp.addendum.tv_bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
        <li>
          신뢰도 · 가중 ‘높음’ = 방법론 공개 규칙 재현, 교체 ‘근사’ = 시총·유동시총 순위로 후보를 추림(KRX 산업군·상장기간
          심사 미반영), ‘미반영’ = 종목 교체 없이 비중 조정만 계산 → 실제 매매는 이보다 클 수 있음.
        </li>
        {Object.values(NOT_REFLECTED).map((x) => (
          <li key={x.tag} className="rb-warn">
            {x.note}
          </li>
        ))}
        <li>해외 그룹은 백만달러 추정을 {WP_FX_DEFAULT.toLocaleString()}원/달러로 환산. 충격 기준 국내 ADV 30%↑, 해외 5%↑.</li>
      </ul>
    </section>
  );
}

function CombinedBars({ rows, side }: { rows: CombinedStockRow[]; side: "buy" | "sell" }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.flow)));
  return (
    <div className="rb-wp-comb">
      {rows.map((r) => (
        <div key={r.code} className="rb-wp-comb-row">
          <button type="button" className="rb-bar-name" title={r.code} onClick={() => setOpen(open === r.code ? null : r.code)}>
            {r.name}
            {r.groups.length > 1 ? <span className="rb-tag idx">{r.groups.length}개 그룹</span> : null}
          </button>
          <div className={side === "buy" ? "rb-bar-pos" : "rb-bar-pos rb-wp-neg"}>
            <span className="rb-bar" style={{ width: `${((Math.abs(r.flow) / max) * 75).toFixed(1)}%` }} />
            <span className="rb-bar-v">{fmtSigned(r.flow)}</span>
          </div>
          <div className={`rb-lvl ${impClass(r.imp, "KR")}`}>{fmtImp(r.imp)}</div>
          {open === r.code ? (
            <div className="rb-breakdown">
              {r.groups.join(" · ")}
              {r.adv ? ` · 20일 평균 거래대금 ${fmtNum(r.adv)}억` : ""}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CombinedSection({ wp, today }: { wp: RebalanceWhitepaper; today: string }) {
  const { buys, sells } = wp.addendum.combined;
  const n = 15;
  const lastDate = wp.addendum.events.reduce((m, e) => (e.date > m ? e.date : m), "");
  return (
    <section className="geo-section geo-featured">
      <h3 className="geo-section-title">12월 집중 주간(12/10~12/15) 종목별 합산 수요</h3>
      <p className="geo-thesis">
        KOSPI200·KOSDAQ150·고배당·반도체·2차전지 등 여러 그룹이 같은 주에 매매해 한 종목에 수요가 쌓입니다. 국내
        그룹의 종목 단위 추정만 합산(억원). 오른쪽은 20일 평균 거래대금 대비 — 30%↑ 빨강. 종목을 누르면 그룹별 내역.
      </p>
      {lastDate && lastDate < today ? (
        <p className="rb-warn">이 주간은 지났습니다. 아래는 매매일 전 마지막 예상치이며 실측으로 바뀌지 않았습니다.</p>
      ) : null}
      <div className="rb-two">
        <div>
          <h4 className="tone-up rb-wp-h4">매수 · 거래대금 대비 충격 상위</h4>
          <CombinedBars rows={buys.slice(0, n)} side="buy" />
        </div>
        <div>
          <h4 className="tone-down rb-wp-h4">매도 · 거래대금 대비 충격 상위</h4>
          <CombinedBars rows={sells.slice(0, n)} side="sell" />
        </div>
      </div>
    </section>
  );
}

const FAMILY_ORDER = ["시장대표", "반도체", "대형주·그룹", "테마", "배당·인컴", "미국 대표지수", "미국 섹터·테마", "미국 배당"];

function HistorySection({ wp, today }: { wp: RebalanceWhitepaper; today: string }) {
  const groups = useMemo(
    () =>
      [...wp.groups].sort(
        (a, b) =>
          (a.market === b.market ? 0 : a.market === "KR" ? -1 : 1) ||
          FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family),
      ),
    [wp],
  );
  const [gid, setGid] = useState(groups[0]?.id ?? "");
  const [openDate, setOpenDate] = useState<string | null>(null);
  const g = groups.find((x) => x.id === gid) ?? groups[0];
  if (!g) return null;
  const us = g.market === "US";
  const unit = us ? "백만$" : "억원";
  const chart = g.events.map((e) => ({
    date: e.date,
    label: `${e.date.slice(2, 7).replace("-", ".")}${e.fc ? "E" : ""}`,
    buy: e.buy,
    turn: e.turn,
    fc: !!e.fc,
    irr: e.irr,
  }));
  const m = g.method;
  return (
    <section className="geo-section geo-featured">
      <h3 className="geo-section-title">과거 정기변경 실측 이력</h3>
      <p className="geo-thesis">
        운용사 일자별 구성종목(PDF) {fmtNum(wp.appendix.counts.pdf_files)}개를 비교해 실제 변경일·회전율·매수 규모를
        찾았습니다. 막대 = 매수 규모, 선 = 단방향 회전율, 옅은 막대 = 다음
        예상(E). 이벤트를 누르면 종목별 매매 상위. 이 이력은 자동으로 추가되지 않습니다.
      </p>
      <div className="chip-row rb-wp-groups">
        {groups.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`chip${x.id === g.id ? " active" : ""}`}
            onClick={() => {
              setGid(x.id);
              setOpenDate(null);
            }}
            title={`${x.title} · ${x.family}`}
          >
            {x.market === "US" ? "US · " : ""}
            {x.short}
          </button>
        ))}
      </div>
      <div className="rb-wp-method">
        <div>
          <strong>{g.title}</strong>{" "}
          <span className={`rb-chip ${m.verified ? "ok" : "wait"}`}>{m.verified ? "방법론 원문 확인" : "PDF 실증"}</span>
          <div className="meta-soft rb-note">
            {m.provider} · {m.freq} · 다음 {g.next ?? "미정"}
          </div>
        </div>
        <ul className="rb-notes">
          <li>시점 · {m.timing}</li>
          <li>가중 · {m.weight}</li>
          {m.extra ? <li>기타 · {m.extra}</li> : null}
          <li>
            구성 ETF · {g.members.map((x) => `${x[1]} ${x[2]}조`).join(" · ")} · 출처 {m.source} · PDF {g.pdf}
          </li>
        </ul>
      </div>
      {NOT_REFLECTED[g.id] ? <p className="rb-warn rb-flow-meta">{NOT_REFLECTED[g.id].note}</p> : null}
      <div className="rb-es-chart">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
            <CartesianGrid stroke="#2b3648" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis yAxisId="buy" tickFormatter={(v: number) => fmtNum(v)} width={56} />
            <YAxis yAxisId="turn" orientation="right" tickFormatter={(v: number) => `${v}%`} width={42} />
            <Tooltip
              formatter={(v: number, key: string): [string, string] =>
                key === "turn" ? [`${v.toFixed(2)}%`, "회전율"] : [`${fmtNum(v)} ${unit}`, "매수 규모"]
              }
              labelFormatter={(l: string) => {
                const d = chart.find((x) => x.label === l);
                return d ? `${d.date}${d.fc ? " (예상)" : d.irr ? " (비정기)" : ""}` : l;
              }}
              contentStyle={{ background: "#141c27", border: "1px solid #2b3648" }}
            />
            <Legend formatter={(k: string) => (k === "turn" ? "회전율(%)" : `매수 규모(${unit})`)} />
            <Bar
              yAxisId="buy"
              dataKey="buy"
              radius={[3, 3, 0, 0]}
              onClick={(d: { date?: string }) => d.date && setOpenDate(d.date)}
              cursor="pointer"
            >
              {chart.map((d) => (
                <Cell key={d.date} fill={d.fc ? "rgba(77,163,255,0.35)" : d.irr ? "#fbbf24" : "#4da3ff"} />
              ))}
            </Bar>
            <Line yAxisId="turn" dataKey="turn" stroke="#3dd68c" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="table-wrap">
        <table className="data-table rb-num-table rb-wp-table">
          <thead>
            <tr>
              <th>매매일</th>
              <th>그룹 AUM</th>
              <th>회전율</th>
              <th>매수({unit})</th>
              <th>편입/편출</th>
              <th>고충격 종목</th>
              <th>최대 충격</th>
            </tr>
          </thead>
          <tbody>
            {[...g.events].reverse().map((e) => {
              const isOpen = openDate === e.date;
              const sides = isOpen ? splitSides(tupleRows(e), 8) : null;
              return (
                <Fragment key={e.date}>
                  <tr
                    className={`rb-wp-row${isOpen ? " open" : ""}`}
                    onClick={() => setOpenDate(isOpen ? null : e.date)}
                  >
                    <td>
                      <span className="rb-wp-caret">{isOpen ? "▾" : "▸"}</span>
                      {e.date}
                      {e.fc ? (
                        <span className="rb-tag idx">
                          예상 {e.tier}
                          {e.date < today ? " · 지남, 실측 대기" : ""}
                        </span>
                      ) : null}
                      {e.irr ? <span className="rb-tag exp">비정기</span> : null}
                    </td>
                    <td>{fmtNum(e.aum, 1)}조</td>
                    <td>{e.turn.toFixed(2)}%</td>
                    <td>{fmtNum(e.buy)}</td>
                    <td>{e.nin != null || e.nout != null ? `${e.nin ?? 0}/${e.nout ?? 0}` : "—"}</td>
                    <td>{e.hi ?? "—"}</td>
                    <td>{e.max ? `${e.max[0]} ${fmtImp(e.max[1])}` : "—"}</td>
                  </tr>
                  {sides ? (
                    <tr className="rb-wp-open">
                      <td colSpan={7}>
                        {e.assume ? <p className="meta-soft rb-flow-meta">가정 · {e.assume}</p> : null}
                        <div className="rb-two rb-wp-sides">
                          <div>
                            <h4 className="tone-up">매수 상위</h4>
                            <StockTable rows={sides.buys} market={g.market} unit={unit} />
                          </div>
                          <div>
                            <h4 className="tone-down">매도 상위</h4>
                            <StockTable rows={sides.sells} market={g.market} unit={unit} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="meta-soft">
        매수 규모 = 매매일 그룹 AUM × 비중 증가분 합(같은 가격으로 평가). AUM은 현재 좌수에서 이후 순설정 좌수를 빼고 NAV를
        곱해 역산. 분석 대상 ETF만 합산(다른 패시브 자금 미포함), 운용사 분할·사전 매매 미반영.
      </p>
    </section>
  );
}

/** part="forecast": 캘린더 바로 아래(11·12월 예상 + 12월 합산). part="history": 탭 아래쪽(실측 이력·검증). */
export default function RebalanceWhitepaperSections({
  wp,
  selected,
  part,
  today,
}: {
  wp: RebalanceWhitepaper;
  selected: string | null;
  part: "forecast" | "history";
  /** KST YYYY-MM-DD — 경과일·지난 예상 행 판단 */
  today: string;
}) {
  if (part === "forecast") {
    const age = daysBetween(wp.as_of, today);
    const live = wp.live?.source === "r2" ? wp.live : null;
    // 매일 갱신분: 주말·연휴를 감안해 4일 넘게 멈추면 경고. 번들 대체: 항상 고정 스냅샷 경고.
    const stalled = live ? age > 4 : true;
    return (
      <>
        <div className="rb-wp-divider">
          <span>
            리서치 백서 · 지수 그룹 단위{" "}
            {live ? (
              <span className={`rb-chip ${stalled ? "wait" : "ok"}`}>{stalled ? "갱신 지연" : "매일 갱신"}</span>
            ) : (
              <span className="rb-chip wait">고정 스냅샷</span>
            )}
          </span>
          <span className="meta-soft">
            국내 예상 {wp.as_of} · 국내 15 + 해외 6 그룹
          </span>
        </div>
        {live ? (
          <p className={stalled ? "rb-wp-stale old" : "meta-soft rb-wp-livenote"}>
            {stalled ? `국내 그룹 예상이 ${age}일째 갱신되지 않았습니다(마지막 ${live.as_of}). ` : ""}
            국내 그룹 예상은 거래일 18:10 이후 운용사 PDF·종가로 다시 계산합니다(마지막 계산{" "}
            {live.generated_at.replace("T", " ").slice(0, 16)}). 유동비율·과거 실측·해외 그룹 예상은 고정입니다.
            {live.errors.length ? ` 오늘 계산 실패 그룹은 직전 값: ${live.errors.map((e) => e.split(":")[0]).join(", ")}.` : ""}
          </p>
        ) : (
          <p className={`rb-wp-stale${age > 14 ? " old" : ""}`}>
            매일 갱신 데이터를 불러오지 못해 {wp.as_of} 기준 고정 결과를 보여줍니다({age > 0 ? `${age}일 경과` : "오늘 기준"}).
            기준일 이후의 지수 산출기관 발표(편출입 확정 등)·신규 상장·주가 변화는 반영돼 있지 않습니다.
          </p>
        )}
        <ForecastSection wp={wp} selected={selected} today={today} />
        <CombinedSection wp={wp} today={today} />
      </>
    );
  }
  return (
    <>
      <HistorySection wp={wp} today={today} />
      <section className="geo-section geo-featured">
        <details className="rb-details">
          <summary>백서 모델 검증·수정 내역</summary>
          <ul className="rb-notes">
            {wp.appendix.fixes.map(([what, problem, fix], i) => (
              <li key={i}>
                <b>{what}</b> · {problem} → {fix}
              </li>
            ))}
            <li>
              수집 · 운용사 PDF {fmtNum(wp.appendix.counts.pdf_files)}개 · 유동비율 {fmtNum(wp.appendix.counts.wise)}종목 ·
              일봉 {fmtNum(wp.appendix.counts.bars)}종목
            </li>
          </ul>
        </details>
      </section>
    </>
  );
}

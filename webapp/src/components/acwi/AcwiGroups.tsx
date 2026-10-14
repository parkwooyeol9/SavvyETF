"use client";

import { useMemo, useState, type ReactNode } from "react";

import {
  fmt,
  heatStyle,
  isNum,
  type AcwiGroup,
  type AcwiGroups as AcwiGroupsData,
  type AcwiStock,
  type GroupDim,
  type GroupMetricKey,
} from "@/lib/acwiAnalyzer";

import AcwiChart, { type ChartRef, type ChartSeries } from "./AcwiChart";
import AcwiTable, { type Col } from "./AcwiTable";
import { Card, Kpi, Legend, nameCol, Sg } from "./parts";

/**
 * 그룹별 10년 밸류에이션 보기. 두 곳에서 쓴다:
 *  - ACWI 분석기 › 국가·업종·테마 (Claude_DB/factor/groups.py, 관리자)
 *  - 포트폴리오 › 밸류에이션 (Claude_DB/factor/etf_valuation.py, dim "etf" 하나 + 비교선 "cmp")
 * 그룹 값은 유동시총 가중 합산(ΣW/ΣE) — 종목 PER 의 단순 평균·중앙값이 아니다.
 */

const ACWI_ID = "region:ACWI";
/** 서로 구분되는 8색 (다크·라이트 모두 중간 채도) */
const COLORS = ["#4c8dff", "#ff6b6b", "#4fc38a", "#b592e8", "#f2a93b", "#3cc4d4", "#e46fb4", "#9aa36b"];
const MAX_SEL = 8;
/** 현재 비중 대비 데이터 커버리지가 이보다 낮은 달은 비운다 (상장 전 종목이 많은 과거 구간). */
const MIN_COV = 60;
const PERIODS: [number, string][] = [
  [10, "10년"],
  [5, "5년"],
  [3, "3년"],
  [1, "1년"],
];
const DEC: Record<GroupMetricKey, number> = { pe: 1, pb: 2, ps: 2, dy: 2, roe: 1, eg: 1, sg: 1, er1: 1, er3: 1, tr: 0 };
const SIGNED = new Set<GroupMetricKey>(["eg", "sg", "er1", "er3"]);
/** ACWI 대비: 배수·수익률은 비율, 나머지(%)는 차이(%p) */
const RATIO = new Set<GroupMetricKey>(["pe", "pb", "ps", "tr"]);
const SUMMARY: GroupMetricKey[] = ["pe", "pb", "dy", "roe", "eg", "sg"];

type Ser = (number | null)[];
type St = { last: number | null; avg?: number; sd?: number; pct?: number; z?: number; y1?: number | null; y3?: number | null };
type Row = {
  id: string;
  g: AcwiGroup;
  st: Record<GroupMetricKey, St>;
  ret: { r1?: number; r3?: number; r5?: number; r10?: number };
  y: Ser;
};

const unitOf = (k: GroupMetricKey) => (k === "dy" || k === "roe" ? "%" : "");

function fv(k: GroupMetricKey, v: unknown): ReactNode {
  if (SIGNED.has(k)) return <Sg v={v} d={DEC[k]} />;
  return fmt(v, DEC[k], unitOf(k));
}

function cleaned(G: AcwiGroupsData, id: string, k: GroupMetricKey): Ser {
  const s = G.series[id];
  const y = s?.[k] ?? [];
  if (k === "tr") return y;
  const cov = s?.cov ?? [];
  return y.map((v, i) => (isNum(v) && isNum(cov[i]) && (cov[i] as number) >= MIN_COV ? v : null));
}

function stats(y: Ser): St {
  const last = y.length ? y[y.length - 1] : null;
  const v = y.filter(isNum);
  if (!isNum(last) || v.length < 24) return { last: isNum(last) ? last : null };
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / v.length);
  const at = (k: number) => (y.length > k ? y[y.length - 1 - k] : null);
  return {
    last,
    avg,
    sd,
    pct: ((v.filter((x) => x <= last).length - 1) / (v.length - 1)) * 100,
    z: sd > 0 ? (last - avg) / sd : undefined,
    y1: at(12),
    y3: at(36),
  };
}

function annual(y: Ser, years: number): number | undefined {
  const a = y[y.length - 1 - years * 12];
  const b = y[y.length - 1];
  if (!isNum(a) || !isNum(b) || a <= 0) return undefined;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}

/** 선택 기간으로 자르고, 상대 모드면 ACWI 로 나누거나 뺀다. tr 은 기간 시작 = 100 으로 다시 맞춘다. */
function view(y: Ser, k: GroupMetricKey, start: number, rel: boolean, base: Ser): Ser {
  let a = y.slice(start);
  let b = base.slice(start);
  if (k === "tr") {
    const rebase = (s: Ser) => {
      const f = s.find(isNum);
      return s.map((v) => (isNum(v) && isNum(f) ? (v / f) * 100 : null));
    };
    a = rebase(a);
    b = rebase(b);
  }
  if (!rel) return a;
  return a.map((v, i) => {
    const r = b[i];
    if (!isNum(v) || !isNum(r)) return null;
    return RATIO.has(k) ? (r !== 0 ? v / r : null) : v - r;
  });
}

function Spark({ y, color = "var(--accent)" }: { y: Ser; color?: string }) {
  const v = y.filter(isNum);
  if (v.length < 2) return <span className="meta-soft">–</span>;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const W = 84;
  const H = 22;
  let d = "";
  let pen = false;
  y.forEach((x, i) => {
    if (isNum(x)) {
      const px = (i / Math.max(1, y.length - 1)) * W;
      const py = H - 2 - ((x - lo) / (hi - lo || 1)) * (H - 4);
      d += `${pen ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
      pen = true;
    } else pen = false;
  });
  return (
    <svg className="aa-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.3} />
    </svg>
  );
}

function downloadCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (x: string | number | null | undefined) => {
    const s = x === null || x === undefined || (typeof x === "number" && !Number.isFinite(x)) ? "" : String(x);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

type Props = {
  G: AcwiGroupsData;
  /** 구성 종목 표에 쓸 종목 정보 (없으면 G.stocks 의 이름·국가만) */
  stocks?: Map<string, AcwiStock>;
  /** 구성 종목 행을 누르면 (없으면 클릭 안 됨) */
  onPick?: (code: string) => void;
  title?: string;
  intro?: string;
  /** '분류 기준 · 계산 방법' 카드 내용 (없으면 ACWI 그룹용 기본 설명) */
  notes?: ReactNode;
  csvPrefix?: string;
};

export default function AcwiGroups({ G, stocks, onPick, title, intro, notes, csvPrefix = "ACWI" }: Props) {
  const M = G.meta;
  const [dim, setDim] = useState<GroupDim>(M.dims.some((d) => d.key === "sector") ? "sector" : M.dims[0]?.key ?? "sector");
  const [scope, setScope] = useState("ACWI");
  const [metric, setMetric] = useState<GroupMetricKey>("pe");
  const [years, setYears] = useState(10);
  const [rel, setRel] = useState(false);
  const [tableMode, setTableMode] = useState<"hist" | "all">("hist");
  const [selMap, setSelMap] = useState<Record<string, string[]>>({});
  const [focusMap, setFocusMap] = useState<Record<string, string>>({});
  const scopes = dim === "sector" ? M.sector_scopes : dim === "etf" ? M.etf_scopes ?? [] : null;
  const sc = scopes ? (scopes.includes(scope) ? scope : scopes[0]) : null;
  const viewKey = `${dim}|${sc ?? ""}`;
  const isEtf = dim === "etf";
  const mdef = M.metrics.find((m) => m.key === metric) ?? M.metrics[0];
  const months = M.months;
  const start = Math.max(0, months.length - 1 - years * 12);

  const groups = useMemo(
    () => G.groups.filter((g) => g.dim === dim && (!sc || g.scope === sc)),
    [G.groups, dim, sc],
  );

  const rows: Row[] = useMemo(
    () =>
      groups.map((g) => {
        const st = Object.fromEntries(M.metrics.map((m) => [m.key, stats(cleaned(G, g.id, m.key))])) as Record<GroupMetricKey, St>;
        const tr = G.series[g.id]?.tr ?? [];
        return {
          id: g.id,
          g,
          st,
          ret: { r1: annual(tr, 1), r3: annual(tr, 3), r5: annual(tr, 5), r10: annual(tr, 10) },
          y: cleaned(G, g.id, metric).slice(start),
        };
      }),
    [G, groups, M.metrics, metric, start],
  );

  const byWeight = useMemo(() => [...groups].sort((a, b) => (b.w ?? 0) - (a.w ?? 0)), [groups]);
  const sel = (selMap[viewKey] ?? byWeight.slice(0, isEtf ? 4 : 5).map((g) => g.id)).filter((id) => groups.some((g) => g.id === id));
  const focusId = focusMap[viewKey] && groups.some((g) => g.id === focusMap[viewKey]) ? focusMap[viewKey] : sel[0] ?? byWeight[0]?.id;
  const focus = G.groups.find((g) => g.id === focusId);
  const colorOf = (id: string) => COLORS[Math.max(0, sel.indexOf(id)) % COLORS.length];

  const pickRow = (id: string) => {
    setFocusMap((m) => ({ ...m, [viewKey]: id }));
    if (!sel.includes(id)) setSelMap((m) => ({ ...m, [viewKey]: [...sel, id].slice(-MAX_SEL) }));
  };
  const drop = (id: string) => setSelMap((m) => ({ ...m, [viewKey]: sel.filter((x) => x !== id) }));

  const stockMap = useMemo(() => {
    if (stocks) return stocks;
    const m = new Map<string, AcwiStock>();
    for (const [c, s] of Object.entries(G.stocks)) m.set(c, { c, n: s.n, ct: s.ct });
    return m;
  }, [stocks, G.stocks]);
  const stockMetrics = useMemo(() => [...stockMap.values()].some((s) => isNum(s.pe) || isNum(s.pb)), [stockMap]);
  const hasPeg = groups.some((g) => isNum(g.cy.peg));
  const themeLabel = useMemo(() => new Map(M.themes.map((t) => [t.key, t.label])), [M.themes]);

  // ── 차트 ──
  const base = cleaned(G, ACWI_ID, metric);
  const x = months.slice(start);
  const chartSeries: ChartSeries[] = sel.map((id) => ({
    y: view(cleaned(G, id, metric), metric, start, rel, base),
    color: colorOf(id),
    name: G.groups.find((g) => g.id === id)?.label ?? id,
    w: id === focusId ? 2.2 : 1.5,
  }));
  if (!rel && !sel.includes(ACWI_ID)) {
    chartSeries.push({ y: view(base, metric, start, false, base), color: "var(--muted)", name: "ACWI", dash: "5 4", w: 1.2 });
  }
  const cmpId = focus?.etf?.compare && G.series[focus.etf.compare] ? focus.etf.compare : null;
  const cmpLabel = cmpId ? `비교: ${G.groups.find((g) => g.id === cmpId)?.label ?? cmpId}${G.groups.find((g) => g.id === cmpId)?.scope && G.groups.find((g) => g.id === cmpId)?.scope !== "ACWI" ? ` (${G.groups.find((g) => g.id === cmpId)?.scope})` : ""} · ACWI 집계` : "";
  if (isEtf && cmpId && focusId && sel.includes(focusId) && cmpId !== ACWI_ID) {
    chartSeries.push({ y: view(cleaned(G, cmpId, metric), metric, start, rel, base), color: colorOf(focusId), name: cmpLabel, dash: "2 3", w: 1.2 });
  }
  const refs: ChartRef[] = [];
  if (!rel && sel.length === 1 && metric !== "tr") {
    const s = stats(chartSeries[0].y);
    if (isNum(s.avg) && isNum(s.sd)) {
      refs.push({ y: s.avg, label: `평균 ${fmt(s.avg, DEC[metric])}`, color: colorOf(sel[0]) });
      refs.push({ y: s.avg + s.sd, label: "+1σ" }, { y: s.avg - s.sd, label: "−1σ" });
    }
  }
  if (rel && RATIO.has(metric)) refs.push({ y: 1, label: "ACWI = 1" });
  const yfmt = (v: number) => (rel && RATIO.has(metric) ? fmt(v, 2) : fmt(v, metric === "tr" ? 0 : DEC[metric]));

  // ── 표 ──
  const pctHeat = (k: GroupMetricKey) => (r: Row) => {
    const d = M.metrics.find((m) => m.key === k)?.dir ?? 0;
    return heatStyle(r.st[k].pct, 0, 100, d === 1);
  };
  const nameColG: Col<Row> = {
    k: "label",
    h: dim === "theme" ? "테마" : M.dims.find((d) => d.key === dim)?.label ?? "그룹",
    cls: "aa-name",
    v: (r) => r.g.label,
    f: (r) => (
      <span title={r.g.desc}>
        <i className="aa-dot" style={{ background: sel.includes(r.id) ? colorOf(r.id) : "transparent" }} />
        {r.g.label}
        {r.g.desc && (dim === "theme" || isEtf) ? <small>{r.g.desc}</small> : null}
      </span>
    ),
  };
  const common: Col<Row>[] = isEtf
    ? [
        nameColG,
        { k: "n", h: "종목", n: true, t: "ACWI 로 덮은 종목 / 전체 주식 보유종목", v: (r) => r.g.n, f: (r) => `${r.g.n}/${r.g.etf?.n_holdings ?? "–"}` },
        {
          k: "w",
          h: "커버리지",
          n: true,
          t: "ETF 주식 비중 중 ACWI 유니버스(시계열 있는 종목)로 덮은 비율. 낮으면 소형주 비중이 커서 결과가 대표성이 떨어집니다",
          v: (r) => r.g.etf?.coverage,
          f: (r) => (r.g.etf?.method === "ACWI 근사" ? <span className="aa-badge" title="보유종목 대신 같은 성격의 ACWI 종목 묶음">근사</span> : fmt(r.g.etf?.coverage, 0, "%")),
          heat: (r) => heatStyle(r.g.etf?.coverage, 40, 100),
        },
      ]
    : [
        nameColG,
        { k: "n", h: "종목", n: true, v: (r) => r.g.n, f: (r) => r.g.n },
        { k: "w", h: "ACWI 비중", n: true, v: (r) => r.g.w, f: (r) => fmt(r.g.w, r.g.w !== null && r.g.w < 1 ? 2 : 1, "%") },
      ];
  const histCols: Col<Row>[] =
    metric === "tr"
      ? [
          { k: "r1", h: "1년", n: true, v: (r) => r.ret.r1, f: (r) => <Sg v={r.ret.r1} />, heat: (r) => heatStyle(r.ret.r1, -30, 30) },
          { k: "r3", h: "3년 연율", n: true, v: (r) => r.ret.r3, f: (r) => <Sg v={r.ret.r3} />, heat: (r) => heatStyle(r.ret.r3, -15, 15) },
          { k: "r5", h: "5년 연율", n: true, v: (r) => r.ret.r5, f: (r) => <Sg v={r.ret.r5} />, heat: (r) => heatStyle(r.ret.r5, -15, 15) },
          { k: "r10", h: "10년 연율", n: true, v: (r) => r.ret.r10, f: (r) => <Sg v={r.ret.r10} />, heat: (r) => heatStyle(r.ret.r10, -15, 15) },
        ]
      : [
          { k: "cur", h: `현재 ${mdef.label}`, n: true, v: (r) => r.st[metric].last, f: (r) => <b>{fv(metric, r.st[metric].last)}</b> },
          { k: "avg", h: "10년 평균", n: true, v: (r) => r.st[metric].avg, f: (r) => fv(metric, r.st[metric].avg) },
          {
            k: "pct",
            h: "10년 위치",
            n: true,
            t: "10년 분포 안 현재 백분위 (0 = 최저, 100 = 최고)",
            v: (r) => r.st[metric].pct,
            f: (r) => fmt(r.st[metric].pct, 0),
            heat: pctHeat(metric),
          },
          { k: "z", h: "Z", n: true, t: "(현재 − 10년 평균) / 표준편차", v: (r) => r.st[metric].z, f: (r) => fmt(r.st[metric].z, 1) },
          { k: "y1", h: "1년 전", n: true, v: (r) => r.st[metric].y1, f: (r) => fv(metric, r.st[metric].y1) },
          { k: "y3", h: "3년 전", n: true, v: (r) => r.st[metric].y3, f: (r) => fv(metric, r.st[metric].y3) },
        ];
  const spark: Col<Row> = {
    k: "spark",
    h: `추이 (${PERIODS.find((p) => p[0] === years)?.[1]})`,
    v: (r) => r.st[metric].last,
    f: (r) => <Spark y={r.y} color={sel.includes(r.id) ? colorOf(r.id) : "var(--muted)"} />,
  };
  const allCols: Col<Row>[] = [
    { k: "pe", h: "PER", n: true, v: (r) => r.st.pe.last, f: (r) => fv("pe", r.st.pe.last) },
    { k: "pep", h: "PER 위치", n: true, t: "PER 10년 백분위", v: (r) => r.st.pe.pct, f: (r) => fmt(r.st.pe.pct, 0), heat: pctHeat("pe") },
    { k: "pb", h: "PBR", n: true, v: (r) => r.st.pb.last, f: (r) => fv("pb", r.st.pb.last) },
    { k: "ps", h: "PSR", n: true, v: (r) => r.st.ps.last, f: (r) => fv("ps", r.st.ps.last) },
    { k: "dy", h: "배당", n: true, v: (r) => r.st.dy.last, f: (r) => fv("dy", r.st.dy.last) },
    { k: "roe", h: "ROE", n: true, v: (r) => r.st.roe.last, f: (r) => fv("roe", r.st.roe.last) },
    {
      k: "eg",
      h: "EPS 성장",
      n: true,
      t: "12개월 선행 순이익 전년 대비",
      v: (r) => r.st.eg.last,
      f: (r) => fv("eg", r.st.eg.last),
      heat: (r) => heatStyle(r.st.eg.last, -30, 30),
    },
    {
      k: "sg",
      h: "매출 성장",
      n: true,
      t: "12개월 선행 매출 전년 대비",
      v: (r) => r.st.sg.last,
      f: (r) => fv("sg", r.st.sg.last),
      heat: (r) => heatStyle(r.st.sg.last, -15, 15),
    },
    { k: "eg27", h: "EPS CY27", n: true, t: "컨센서스 EPS 성장 CY27/CY26", v: (r) => r.g.cy.eg27, f: (r) => <Sg v={r.g.cy.eg27} /> },
    ...(hasPeg
      ? [{ k: "peg", h: "PEG", n: true, t: "Fwd PER ÷ EPS 성장률(CY27/CY26, %). 성장률이 0 이하면 없음", v: (r: Row) => r.g.cy.peg, f: (r: Row) => fmt(r.g.cy.peg, 2) } as Col<Row>]
      : []),
    { k: "sg27", h: "매출 CY27", n: true, t: "컨센서스 매출 성장 CY27/CY26", v: (r) => r.g.cy.sg27, f: (r) => <Sg v={r.g.cy.sg27} /> },
    { k: "er1", h: "리비전 1M", n: true, v: (r) => r.st.er1?.last, f: (r) => fv("er1", r.st.er1?.last), heat: (r) => heatStyle(r.st.er1?.last, -4, 4) },
    { k: "er3", h: "리비전 3M", n: true, v: (r) => r.st.er3.last, f: (r) => fv("er3", r.st.er3.last), heat: (r) => heatStyle(r.st.er3.last, -8, 8) },
    { k: "r1", h: "1년 수익률", n: true, v: (r) => r.ret.r1, f: (r) => <Sg v={r.ret.r1} /> },
  ];
  const cols = tableMode === "all" ? [...common, ...allCols] : [...common, ...histCols, spark];

  const saveCsv = () => {
    const head = ["그룹", "범위", "종목수", isEtf ? "커버리지%" : "ACWI비중%", ...M.metrics.flatMap((m) => (m.key === "tr" ? [] : [m.label, `${m.label} 10년평균`, `${m.label} 10년위치`])),
      "EPS성장 CY26", "EPS성장 CY27", "매출성장 CY26", "매출성장 CY27", "1년수익률", "3년연율", "5년연율", "10년연율"];
    const body = rows.map((r) => [
      r.g.label, r.g.scope ?? "", r.g.n, isEtf ? r.g.etf?.coverage : r.g.w,
      ...M.metrics.flatMap((m) => (m.key === "tr" ? [] : [r.st[m.key].last, r.st[m.key].avg, r.st[m.key].pct])),
      r.g.cy.eg26, r.g.cy.eg27, r.g.cy.sg26, r.g.cy.sg27, r.ret.r1, r.ret.r3, r.ret.r5, r.ret.r10,
    ].map((v) => (typeof v === "number" ? Number(v.toFixed(3)) : v)));
    downloadCsv(`${csvPrefix}_${dim}${sc ? `_${sc}` : ""}_${M.as_of}.csv`, head, body);
  };

  // ── 선택 그룹 상세 ──
  const fst = focus ? (Object.fromEntries(M.metrics.map((m) => [m.key, stats(cleaned(G, focus.id, m.key))])) as Record<GroupMetricKey, St>) : null;
  const members = useMemo(() => {
    const out: (AcwiStock & { ew?: number })[] = [];
    focus?.codes.forEach((c, i) => {
      const s = stockMap.get(c);
      if (s) out.push({ ...s, ew: focus.wts?.[i] ?? undefined });
    });
    return out;
  }, [focus, stockMap]);
  type Member = AcwiStock & { ew?: number };
  const metricCols: Col<Member>[] = [
    { k: "pe", h: "PER", n: true, f: (s) => fmt(s.pe, 1) },
    { k: "pb", h: "PBR", n: true, f: (s) => fmt(s.pb, 2) },
    { k: "dy", h: "배당", n: true, f: (s) => fmt(s.dy, 2, "%") },
    { k: "roe", h: "ROE", n: true, f: (s) => fmt(s.roe, 1, "%") },
    { k: "eg", h: "EPS CY27", n: true, t: "EPS 성장 CY27/CY26", f: (s) => <Sg v={s.eg} /> },
    { k: "sg", h: "매출 CY27", n: true, t: "매출 성장 CY27/CY26", f: (s) => <Sg v={s.sg} /> },
    { k: "er3", h: "리비전 3M", n: true, f: (s) => <Sg v={s.er3} /> },
    { k: "r12m", h: "12M", n: true, f: (s) => <Sg v={s.r12m} d={0} /> },
    {
      k: "pep10",
      h: "PER 10년 위치",
      n: true,
      t: "근사 PER 10년 분포 내 백분위 (낮을수록 역사적 저평가)",
      f: (s) => fmt(s.pep10, 0),
      heat: (s) => heatStyle(s.pep10, 0, 100, true),
    },
  ];
  const memberCols: Col<Member>[] = [
    nameCol<Member>(),
    focus?.wts
      ? {
          k: "w",
          h: focus.etf?.method === "ACWI 근사" ? "근사 비중" : "ETF 비중",
          t: focus.etf?.method === "ACWI 근사" ? "ACWI 유동시총 비중을 묶음 안에서 다시 나눈 값 (테마는 한 종목 상한)" : "운용사 공개 비중 (ACWI 에 없는 종목·현금 제외 전 기준)",
          n: true,
          v: (s) => s.ew,
          f: (s) => fmt(s.ew, 2, "%"),
        }
      : { k: "w", h: "ACWI 비중", n: true, v: (s) => s.w, f: (s) => fmt(isNum(s.w) ? s.w * 100 : null, 2, "%") },
    ...(stockMetrics ? metricCols : []),
    {
      k: "th",
      h: "테마",
      v: (s) => (G.stocks[s.c]?.th ?? []).length,
      f: (s) => (
        <span className="aa-themes">
          {(G.stocks[s.c]?.th ?? []).map((t) => (
            <span key={t} className="aa-badge">
              {themeLabel.get(t) ?? t}
            </span>
          ))}
        </span>
      ),
    },
  ];

  const q = M.quality as Record<string, number | Record<string, string[]>>;

  return (
    <div className="aa-view">
      <Card
        title={title ?? "국가 · 업종 · 테마 밸류에이션"}
        sub={
          intro ??
          `ACWI ${M.n_stocks.toLocaleString()}종목을 국가·지역·GICS 섹터/산업그룹/산업·투자 테마로 묶어 10년(${months[0]} ~ ${months[months.length - 1]}) 월간 PER·PBR·성장률을 유동시총 가중으로 합산했습니다. 표의 행을 누르면 차트에 추가되고 아래에 구성 종목이 나옵니다.`
        }
      >
        <div className="aa-gctl">
          {M.dims.length > 1 ? (
            <div className="aa-field">
              분류
              <div className="aa-seg" role="tablist" aria-label="분류">
                {M.dims.map((d) => (
                  <button key={d.key} type="button" role="tab" aria-selected={dim === d.key} className={`chip${dim === d.key ? " active" : ""}`} onClick={() => setDim(d.key)}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {scopes && isEtf ? (
            <div className="aa-field aa-gwide">
              ETF 분류
              <div className="aa-seg" role="tablist" aria-label="ETF 분류">
                {scopes.map((s) => (
                  <button key={s} type="button" role="tab" aria-selected={sc === s} className={`chip${sc === s ? " active" : ""}`} onClick={() => setScope(s)}>
                    {s} <small className="meta-soft">{G.groups.filter((g) => g.dim === "etf" && g.scope === s).length}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : scopes ? (
            <label className="aa-field">
              범위
              <select className="im-select" value={sc ?? ""} onChange={(e) => setScope(e.target.value)}>
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="aa-field aa-gwide">
            지표
            <div className="aa-seg" role="tablist" aria-label="지표">
              {M.metrics.map((m) => (
                <button key={m.key} type="button" role="tab" aria-selected={metric === m.key} title={m.desc} className={`chip${metric === m.key ? " active" : ""}`} onClick={() => setMetric(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="aa-field">
            기간
            <div className="aa-seg">
              {PERIODS.map(([y, l]) => (
                <button key={y} type="button" className={`chip${years === y ? " active" : ""}`} onClick={() => setYears(y)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="aa-field">
            표시
            <div className="aa-seg">
              <button type="button" className={`chip${!rel ? " active" : ""}`} onClick={() => setRel(false)}>
                수준
              </button>
              <button type="button" className={`chip${rel ? " active" : ""}`} onClick={() => setRel(true)} title={RATIO.has(metric) ? "ACWI 대비 배율" : "ACWI 대비 차이(%p)"}>
                ACWI 대비
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title={`${mdef.label}${rel ? (RATIO.has(metric) ? " · ACWI 대비 배율" : " · ACWI 대비 차이(%p)") : ""}`}
        sub={`${mdef.desc}. ${metric === "tr" ? "선택 기간 시작 = 100." : `현재 비중의 ${MIN_COV}% 미만만 데이터가 있는 달은 비웁니다.`}${!rel && sel.length === 1 && metric !== "tr" ? " 점선 = 기간 평균 ±1σ." : ""}`}
      >
        <div className="aa-selchips">
          {sel.map((id) => (
            <button key={id} type="button" className="chip" onClick={() => drop(id)} title="차트에서 빼기">
              <i className="aa-dot" style={{ background: colorOf(id) }} />
              {G.groups.find((g) => g.id === id)?.label ?? id} ✕
            </button>
          ))}
          {sel.length ? null : <span className="meta-soft">아래 표에서 그룹을 누르면 차트에 추가됩니다 (최대 {MAX_SEL}개).</span>}
        </div>
        <AcwiChart x={x} series={chartSeries} h={280} refs={refs} yfmt={yfmt} xfmt={(v) => String(v).slice(2)} zeroLine={SIGNED.has(metric) || (rel && !RATIO.has(metric))} />
        <Legend items={chartSeries.map((s) => [s.color, s.name ?? "", !!s.dash])} />
      </Card>

      <Card>
        <div className="aa-tablehead">
          <h3 className="aa-h">
            {M.dims.find((d) => d.key === dim)?.label}{isEtf ? "" : "별"} {tableMode === "all" ? "전체 지표" : mdef.label}
            {sc ? <span className="meta-soft"> · {sc}</span> : null}
          </h3>
          <div className="aa-seg">
            <button type="button" className={`chip${tableMode === "hist" ? " active" : ""}`} onClick={() => setTableMode("hist")}>
              선택 지표 10년 비교
            </button>
            <button type="button" className={`chip${tableMode === "all" ? " active" : ""}`} onClick={() => setTableMode("all")}>
              전체 지표 한눈에
            </button>
            <button type="button" className="chip" onClick={saveCsv}>
              CSV 저장
            </button>
          </div>
        </div>
        <div className="aa-scroll">
          <AcwiTable className="aa-tbl" cols={cols} rows={rows} sort={isEtf ? null : "w"} limit={120} rowKey={(r) => r.id} onRow={(r) => pickRow(r.id)} />
        </div>
        <p className="aa-sub aa-mt">
          10년 위치 색: 밸류에이션(PER·PBR·PSR)은 역사적으로 낮을수록, 배당수익률은 높을수록 빨강. 성장률·리비전은 높을수록 빨강.
        </p>
      </Card>

      {focus && fst ? (
        <Card
          title={
            <>
              {focus.label}
              {focus.scope && focus.scope !== "ACWI" ? <span className="meta-soft"> · {focus.scope}</span> : null}
            </>
          }
          sub={`${focus.desc ? `${focus.desc} · ` : ""}${focus.etf ? `ACWI 로 덮은 ${focus.n}종목` : `${focus.n}종목 · ACWI 비중 ${fmt(focus.w, 2, "%")}`}${cmpId ? ` · 점선 = ${cmpLabel}` : ""} · 표에서 다른 그룹을 누르면 바뀝니다`}
        >
          <div className="aa-kpis">
            {SUMMARY.map((k) => (
              <Kpi
                key={k}
                label={M.metrics.find((m) => m.key === k)?.label ?? k}
                value={fv(k, fst[k].last)}
                sub={isNum(fst[k].pct) ? `10년 평균 ${fmt(fst[k].avg, DEC[k], unitOf(k))} · 위치 ${fmt(fst[k].pct, 0)}` : undefined}
              />
            ))}
            <Kpi label="EPS 성장 CY26 / CY27" value={<><Sg v={focus.cy.eg26} /> / <Sg v={focus.cy.eg27} /></>} sub="컨센서스, 같은 종목 묶음" />
            <Kpi label="매출 성장 CY26 / CY27" value={<><Sg v={focus.cy.sg26} /> / <Sg v={focus.cy.sg27} /></>} />
          </div>
          <div className="aa-grid aa-g3 aa-mt">
            {SUMMARY.map((k) => {
              const y = cleaned(G, focus.id, k).slice(start);
              const b = cleaned(G, ACWI_ID, k).slice(start);
              return (
                <div key={k}>
                  <h4 className="aa-h4">{M.metrics.find((m) => m.key === k)?.label}</h4>
                  <AcwiChart
                    x={x}
                    h={150}
                    series={[
                      { y, color: "var(--accent)", name: focus.label, w: 1.8 },
                      ...(focus.id !== ACWI_ID ? [{ y: b, color: "var(--muted)", name: "ACWI", dash: "5 4", w: 1.1 }] : []),
                      ...(cmpId && cmpId !== ACWI_ID
                        ? [{ y: cleaned(G, cmpId, k).slice(start), color: "#ff6b6b", name: "비교", dash: "2 3", w: 1.1 }]
                        : []),
                    ]}
                    yfmt={(v) => fmt(v, DEC[k])}
                    xfmt={(v) => String(v).slice(2)}
                    zeroLine={SIGNED.has(k)}
                  />
                </div>
              );
            })}
          </div>
          <h4 className="aa-h4">
            {focus.etf?.method === "보유종목"
              ? `보유종목 중 ACWI 에 있는 종목 (${members.length}/${focus.etf.n_holdings})`
              : `구성 종목 (${members.length})`}{" "}
            — 비중 큰 순{onPick ? ", 누르면 종목 상세" : ""}
          </h4>
          <div className="aa-scroll aa-short">
            <AcwiTable className="aa-tbl" cols={memberCols} rows={members} sort="w" limit={40} rowKey={(s) => s.c} onRow={onPick ? (s) => onPick(s.c) : undefined} />
          </div>
        </Card>
      ) : null}

      <Card title="분류 기준 · 계산 방법">
        {notes ?? (
        <ul className="aa-note">
          <li>
            <b>국가·지역</b>: 상장 거래소 기준 MSCI 국가(미국 상장 해외기업 예외 반영). 유럽 선진 = 선진 유럽 16개국.
            <b> 섹터·산업그룹·산업</b>: GICS (원자료 TR.GICS). <b>테마</b>: 이름·사업을 보고 고른 다중 분류 ({M.themes.length}개, 한 종목이 여러 테마에 속할 수 있음).
          </li>
          <li>
            <b>합산 방식</b>: 그룹 PER = Σ유동시총 ÷ Σ선행 순이익 (MSCI 지수 방식, 적자 종목 포함). PBR 은 자본잠식 종목 제외. 과거 유동시총은 현재 ACWI 비중 × 가격 변화로 되돌렸습니다.
          </li>
          <li>
            <b>성장률(YoY)</b>: 같은 종목 묶음의 12개월 선행 순이익·매출 합이 1년 전보다 얼마나 늘었는지 — 편입·상장으로 인한 구성 변화는 빠집니다. 현지통화 기준이라 고인플레 국가는 높게 나옵니다.
          </li>
          <li>
            <b>한계</b>: 현재 구성종목 기준(과거 편출 종목 없음, 생존 편향). 과거 비중·이익의 통화 환산은 현재 환율 고정이라 여러 나라가 섞인 그룹의 과거 비중은 근사치입니다. 증자·감자로 주식 수가 크게 변한 종목({String(q.drift_capped_stocks ?? "–")}개)은 과거 비중 확대를 시장 대비 15배로 제한했고, 추정치 시계열이 한 달에 수 배 뛰는 단절(통화·단위 변경 의심, EPS {String(q.eps_breaks ?? "–")}·매출 {String(q.sal_breaks ?? "–")}종목)은 단절 이전을 버렸습니다.
          </li>
          <li>
            빌드 {M.built_at.replace("T", " ")} · 원자료 {M.source} · Datastream/I/B/E/S 기반 내부용
          </li>
        </ul>
        )}
      </Card>
    </div>
  );
}

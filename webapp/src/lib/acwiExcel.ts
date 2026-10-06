/**
 * ACWI 종목 분석기 엑셀 (관리자 전용). 이미 복호화돼 화면에 있는 데이터만 쓴다 — 서버를 거치지 않는다.
 */
import {
  ACWI_FACTORS,
  isNum,
  type AcwiBacktest,
  type AcwiBreadthRow,
  type AcwiNumKey,
  type AcwiSeries,
  type AcwiStock,
  type AcwiStrKey,
  type AcwiSummary,
  type BtMode,
} from "./acwiAnalyzer";
import { buildXlsxWithCharts, downloadXlsx, kstStamp, type Cell, type XlsxSheet } from "./xlsxCharts";

type Series = (number | null)[];
const CONFIDENTIAL = "관리자 전용 · Datastream/MSCI 원자료 기반 — 외부 반출·재배포 금지";
const P1 = "0.0";
const P2 = "0.00";

const STOCK_COLS: [AcwiNumKey | AcwiStrKey | "c", string, string?][] = [
  ["c", "코드"], ["n", "종목명"], ["ct", "국가"], ["rg", "지역"], ["s", "섹터"], ["ind", "산업"], ["isin", "ISIN"],
  ["ms", "MSCI 상태"], ["sr", "편입 리뷰"], ["w", "ACWI 비중(%)", "0.0000"], ["cap", "시총(백만$)", "#,##0"],
  ["rk", "팩터 순위", "0"], ["z", "종합 Z", P2],
  ...ACWI_FACTORS.map(([k, l]) => [k, `${l} Z`, P2] as [AcwiNumKey, string, string]),
  ["pe", "PER", P1], ["pb", "PBR", P2], ["dy", "배당(%)", P2], ["roe", "ROE(%)", P1],
  ["r1m", "1M(%)", P1], ["r3m", "3M(%)", P1], ["r6m", "6M(%)", P1], ["r12m", "12M(%)", P1], ["ytd", "YTD(%)", P1],
  ["ma50", "MA50 괴리(%)", P1], ["ma200", "MA200 괴리(%)", P1], ["rsi", "RSI14", "0"], ["dd52", "52주고점比(%)", P1],
  ["vol", "변동성1Y(%)", P1], ["beta", "베타", P2], ["mdd", "MDD1Y(%)", P1], ["ts", "추세점수(0~6)", "0"],
  ["liq", "거래대금20D(백만$)", "#,##0"], ["vr", "거래량비(20D/120D)", P2],
  ["er1", "EPS Δ1M(%)", P1], ["er3", "EPS Δ3M(%)", P1], ["er12", "EPS Δ12M(%)", P1], ["eg", "EPS g CY27(%)", P1],
  ["bg", "BPS Δ12M(%)", P1], ["dg12", "DPS Δ12M(%)", P1], ["cuts", "DPS삭감(36M)", "0"], ["sv3", "매출 Δ3M(%)", P1],
  ["pep", "PER 3Y위치", "0"], ["pep10", "PER 10Y위치", "0"], ["pbp", "PBR 3Y위치", "0"], ["dyp", "배당 3Y위치", "0"],
  ["tail", "국가 내 꼬리", P1], ["wr", "편출관찰 순위", "0"], ["hq", "모회사 본사국"], ["xr", "팩터 제외 사유"],
];

const BREADTH_COLS: [string, string][] = [
  ["n", "종목"], ["rev_breadth_3m", "리비전 브레드스 3M(%p)"], ["eps_rev_3m_med", "EPS Δ3M 중앙(%)"], ["above_ma200", "MA200 위(%)"],
  ["golden", "골든크로스(%)"], ["r_1m_med", "1M 중앙(%)"], ["r_3m_med", "3M 중앙(%)"], ["r_12m_med", "12M 중앙(%)"],
  ["rsi_med", "RSI 중앙"], ["pe_med", "PER 중앙"], ["pe_pct_3y_med", "PER 3Y위치 중앙"], ["dy_med", "배당 중앙(%)"],
];

const CAR = ["car_pre", "car_ann", "car_run", "car_close", "car_post"] as const;
const CAR_L = ["발표 전", "발표", "진행", "당일", "효력 후"];
const actionKo = (a: unknown) => (a === "ADD" ? "편입" : a === "DEL" ? "편출" : String(a ?? ""));
const num = (v: unknown): number | null => (isNum(v) ? v : null);
const cell = (v: unknown): Cell => (typeof v === "number" ? (Number.isFinite(v) ? v : null) : v == null ? null : String(v));

function breadthSheet(name: string, label: string, rows: AcwiBreadthRow[], chart: boolean): XlsxSheet {
  return {
    name,
    rows: [[label, ...BREADTH_COLS.map(([, h]) => h)], ...rows.map((r) => [String(r.g), ...BREADTH_COLS.map(([k]) => num(r[k]))])],
    widths: [18, ...BREADTH_COLS.map(() => 12)],
    formats: Object.fromEntries(BREADTH_COLS.map((_, i) => [i + 1, P1])),
    autofilter: true,
    charts: chart
      ? [{ type: "bar", title: `${label}별 리비전 브레드스 3M · MA200 위 비율`, cat: 0, series: [2, 4], at: { col: BREADTH_COLS.length + 2, row: 0 }, size: { cols: 10, rows: 20 } }]
      : undefined,
  };
}

function summarySheets(A: AcwiSummary): XlsxSheet[] {
  const M = A.meta;
  const S = A.series;
  const E = A.events;
  const path = (p: Record<string, Series | number>, k: string) => (Array.isArray(p[k]) ? (p[k] as Series) : []);
  const ts = Array.from({ length: E.pre + E.post + 1 }, (_, i) => i - E.pre);
  const out: XlsxSheet[] = [
    {
      name: "종목",
      rows: [STOCK_COLS.map(([, h]) => h), ...A.stocks.map((s) => STOCK_COLS.map(([k]) => (k === "w" ? (isNum(s.w) ? s.w * 100 : null) : cell((s as Record<string, unknown>)[k]))))],
      widths: STOCK_COLS.map(([k]) => (k === "n" ? 28 : k === "ind" || k === "xr" ? 22 : k === "s" || k === "ms" ? 16 : 10)),
      formats: Object.fromEntries(STOCK_COLS.flatMap(([, , f], i) => (f ? [[i, f]] : []))),
      autofilter: true,
    },
    {
      name: "벤치마크_주간",
      rows: [["주", "벤치마크(마지막=1,000)"], ...S.weeks.map((w, i) => [w, S.bench[i] ?? null])],
      widths: [11, 20],
      formats: { 1: "#,##0.0" },
      charts: [{ type: "line", title: "ACWI 벤치마크 (주간 3년)", cat: 0, series: [1], size: { cols: 12, rows: 20 } }],
    },
  ];
  if (S.bench_m?.length) {
    out.push({
      name: "벤치마크_월간",
      rows: [["월", "벤치마크(마지막=1,000)"], ...S.months.map((m, i) => [m, S.bench_m?.[i] ?? null])],
      widths: [9, 20],
      formats: { 1: "#,##0.0" },
      charts: [{ type: "line", title: "ACWI 벤치마크 (월간 10년)", cat: 0, series: [1], size: { cols: 12, rows: 20 } }],
    });
  }
  out.push(
    breadthSheet("브레드스_지역", "지역", A.breadth.region, true),
    breadthSheet("브레드스_섹터", "섹터", A.breadth.sector, true),
    breadthSheet("브레드스_국가", "국가", A.breadth.country, false),
    {
      name: "MSCI_이벤트경로",
      rows: [
        ["t", "발표 기준 편입", "발표 기준 편출", "효력 기준 편입", "효력 기준 편출"],
        ...ts.map((t, i) => [`t${t > 0 ? "+" : ""}${t}`, path(E.path_ann, "ADD")[i] ?? null, path(E.path_ann, "DEL")[i] ?? null, path(E.path_eff, "ADD")[i] ?? null, path(E.path_eff, "DEL")[i] ?? null]),
        [],
        [`발표 기준 편입 ${E.path_ann.n_ADD ?? 0}건 / 편출 ${E.path_ann.n_DEL ?? 0}건 · 효력 기준 편입 ${E.path_eff.n_ADD ?? 0}건 / 편출 ${E.path_eff.n_DEL ?? 0}건 · 시장조정 누적초과수익(%)`],
      ],
      widths: [6, 14, 14, 14, 14],
      formats: { 1: P2, 2: P2, 3: P2, 4: P2 },
      charts: [
        { type: "line", title: "MSCI 발표일 전후 누적 초과수익(%) · t=0 발표 다음 거래일", cat: 0, series: [1, 2], lastRow: ts.length, colors: ["2BA36B", "E5484D"] },
        { type: "line", title: "MSCI 효력일 전후 누적 초과수익(%)", cat: 0, series: [3, 4], lastRow: ts.length, colors: ["2BA36B", "E5484D"] },
      ],
    },
    {
      name: "MSCI_구간요약",
      rows: [
        ["구분", ...CAR_L.flatMap((l) => [`${l} 평균`, `${l} 중앙`])],
        ...(["ADD", "DEL"] as const).map((a) => [actionKo(a), ...CAR.flatMap((k) => [num(E.all[a]?.[`${k}_mean`]), num(E.all[a]?.[`${k}_median`])])]),
        [],
        ["리뷰", "구분", "건수", ...CAR_L.map((l) => `${l} 평균`)],
        ...E.by_review.map((r) => [r.review, actionKo(r.action), num(r.car_pre_count), ...CAR.map((k) => num(r[`${k}_mean`]))]),
      ],
      widths: [10, 8, 10, 10, 10, 10, 10, 10, 10, 10, 10],
      formats: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, P2])),
      charts: [{ type: "bar", title: "구간별 평균 누적 초과수익(%) · 편입 vs 편출", cat: 0, series: [1, 3, 5, 7, 9], lastRow: 2, at: { col: 12, row: 0 } }],
    },
    {
      name: "MSCI_지역별",
      rows: [["구분", "지역", ...CAR_L], ...E.by_region.map((r) => [actionKo(r.action), String(r.region), ...CAR.map((k) => num(r[k]))])],
      widths: [8, 16, 10, 10, 10, 10, 10],
      formats: { 2: P2, 3: P2, 4: P2, 5: P2, 6: P2 },
    },
    {
      name: "MSCI_종목별",
      rows: [
        ["리뷰", "구분", "코드", "종목명", "국가", "지역", "섹터", ...CAR_L],
        ...E.per.map((r) => [r.review, actionKo(r.action), r.code, r.name ?? "", r.country ?? "", r.region ?? "", r.sector_ko ?? "", ...CAR.map((k) => num(r[k]))]),
      ],
      widths: [8, 6, 12, 28, 14, 12, 14, 10, 10, 10, 10, 10],
      formats: { 7: P2, 8: P2, 9: P2, 10: P2, 11: P2 },
      autofilter: true,
    },
    {
      name: "MSCI_편출관찰",
      rows: [
        ["순위", "코드", "종목명", "국가", "국가 내 꼬리", "ACWI 비중(%)", "6M(%)", "시총(백만$)", "팩터 순위"],
        ...A.stocks
          .filter((s) => isNum(s.wr))
          .sort((a, b) => (a.wr as number) - (b.wr as number))
          .map((s) => [s.wr ?? null, s.c, s.n ?? "", s.ct ?? "", num(s.tail), isNum(s.w) ? s.w * 100 : null, num(s.r6m), num(s.cap), num(s.rk)]),
      ],
      widths: [6, 12, 28, 14, 12, 12, 8, 12, 9],
      formats: { 4: P2, 5: "0.0000", 6: P1, 7: "#,##0" },
      autofilter: true,
    },
    {
      name: "MSCI_미반영",
      rows: [
        ["리뷰", "구분", "코드", "종목명(MSCI 표기)", "국가", "효력일"],
        ...A.pending.map((p) => [p.review, p.action, cell(p.code), cell(p.name), cell(p.country), cell(p.effective)]),
      ],
      widths: [8, 18, 12, 28, 14, 11],
    },
    {
      name: "MSCI_리뷰이력",
      rows: [
        ["리뷰", "발표", "효력", "이전 구성", "이후 구성(상한)", "이후 확정", "편입", "편출"],
        ...A.reviews.map((r) => [r.review, cell(r.announce), cell(r.effective), num(r.members_before), num(r.members_after), num(r.confirmed_after), num(r.adds), num(r.dels)]),
      ],
      widths: [8, 11, 11, 10, 14, 10, 7, 7],
      charts: [{ type: "line", title: "ACWI 구성종목 수 (리뷰 후)", cat: 0, series: [4, 5], size: { cols: 12, rows: 20 } }],
    },
  );
  out.unshift({
    name: "안내",
    rows: [
      ["ACWI 종목 분석기 · SavvyETF"],
      [CONFIDENTIAL],
      [],
      ["기준일", M.ri_last],
      ["원자료", M.source],
      ["빌드", M.built_at.replace("T", " ")],
      ["종목 / 점수 산출", `${A.stocks.length} / ${A.quality.n_scored}`],
      [],
      ["단위", "수익률·괴리·리비전·초과수익은 % 값(5 = 5%), 팩터는 Z점수, 시총·거래대금은 백만 USD, 위치는 0~100 백분위(0=역사적 최저)."],
      ["차트", "각 시트의 셀 범위를 참조하는 Excel 차트입니다. 값이나 범위를 바꾸면 차트도 바뀝니다."],
      [],
      ["시트", "내용"],
      ...out.map((s) => [s.name, s.charts?.length ? `차트 ${s.charts.length}개` : ""]),
    ],
    widths: [18, 100],
  });
  return out;
}

const MODE_L: Record<BtMode, string> = { pit: "PIT", pit_large: "PIT 대형·중형", static: "현재 구성 고정" };

const cum = (r: Series): Series => {
  let lvl = 1;
  let started = false;
  return r.map((v) => {
    if (isNum(v)) {
      lvl *= 1 + v;
      started = true;
    }
    return started ? lvl : null;
  });
};
const netOf = (r: Series, to: Series, legs: number, bp: number): Series =>
  r.map((v, i) => (isNum(v) ? v - legs * (isNum(to[i]) ? (to[i] as number) : 0) * (bp / 1e4) : null));

function backtestSheets(B: AcwiBacktest): XlsxSheet[] {
  const label = (k: string) => B.signals.find((x) => x.key === k)?.label ?? k;
  const D = B.dates;
  const out: XlsxSheet[] = [];
  const COST = 20;

  for (const mode of ["pit", "pit_large", "static"] as BtMode[]) {
    const R = B.results[mode]?.["전체"];
    const S = R?.sig.composite;
    if (!R || !S) continue;
    const cq = S.q.map(cum);
    const cb = cum(R.bench_ew);
    const ccw = cum(R.bench_cw);
    const cls = cum(S.ls);
    const clsn = cum(netOf(S.ls, S.to, 4, COST));
    out.push({
      name: `BT_종합_${mode === "pit" ? "PIT" : mode === "pit_large" ? "PIT대형" : "고정"}`,
      rows: [
        ["월", "Q1(상위)", "Q2", "Q3", "Q4", "Q5(하위)", "유니버스 동일가중", "유니버스 시총가중", "롱숏 Q1−Q5", `롱숏 비용 ${COST}bp 차감`, "종목 수"],
        ...D.map((d, i) => [d.slice(0, 7), ...cq.map((c) => c[i]), cb[i], ccw[i], cls[i], clsn[i], R.n[i] ?? null]),
      ],
      widths: [9, 10, 10, 10, 10, 10, 16, 16, 12, 18, 8],
      formats: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => [c, "0.000"])),
      charts: [
        { type: "line", title: `${MODE_L[mode]} · 전체 · 종합 5분위 누적(시작=1)`, cat: 0, series: [1, 2, 3, 4, 5, 6], colors: ["2BA36B", "8BC5A6", "6B7785", "E89A9C", "E5484D", "2F7BEA"], size: { cols: 12, rows: 20 } },
        { type: "line", title: `${MODE_L[mode]} · 종합 롱숏 누적`, cat: 0, series: [8, 9], colors: ["8E5BD9", "E39B14"], size: { cols: 12, rows: 18 } },
      ],
    });
  }

  const pit = B.results.pit?.["전체"];
  if (pit) {
    const keys = B.signals.filter((x) => x.kind !== "descriptor" && pit.sig[x.key]).map((x) => x.key);
    const factorKeys = B.signals.filter((x) => x.kind === "factor" && pit.sig[x.key]).map((x) => x.key).concat(pit.sig.composite ? ["composite"] : []);
    const cl = factorKeys.map((k) => cum(pit.sig[k].ls));
    out.push({
      name: "BT_팩터롱숏_PIT",
      rows: [["월", ...factorKeys.map(label)], ...D.map((d, i) => [d.slice(0, 7), ...cl.map((c) => c[i])])],
      widths: [9, ...factorKeys.map(() => 12)],
      formats: Object.fromEntries(factorKeys.map((_, i) => [i + 1, "0.000"])),
      charts: [{ type: "line", title: "PIT · 전체 · 팩터별 롱숏(Q1−Q5) 누적(시작=1, 비용 전)", cat: 0, series: factorKeys.map((_, i) => i + 1), size: { cols: 12, rows: 22 } }],
    });
    const allKeys = B.signals.filter((x) => pit.sig[x.key]).map((x) => x.key);
    out.push({
      name: "BT_월수익률_PIT",
      rows: [
        ["월", "유니버스 동일가중", "유니버스 시총가중", ...allKeys.map((k) => `${label(k)} 롱숏`), ...keys.map((k) => `${label(k)} IC`)],
        ...D.map((d, i) => [d.slice(0, 7), pit.bench_ew[i] ?? null, pit.bench_cw[i] ?? null, ...allKeys.map((k) => pit.sig[k].ls[i] ?? null), ...keys.map((k) => pit.sig[k].ic[i] ?? null)]),
      ],
      widths: [9, ...Array(2 + allKeys.length + keys.length).fill(12)],
      formats: Object.fromEntries(Array.from({ length: 2 + allKeys.length + keys.length }, (_, i) => [i + 1, i < 2 + allKeys.length ? "0.00%" : "0.000"])),
      autofilter: true,
    });

    const yr = new Map<string, number[]>();
    D.forEach((d, i) => yr.set(d.slice(0, 4), [...(yr.get(d.slice(0, 4)) ?? []), i]));
    const comp = (a: Series, ix: number[]) => {
      const v = ix.map((i) => a[i]).filter(isNum) as number[];
      return v.length ? v.reduce((p, x) => p * (1 + x), 1) - 1 : null;
    };
    const S = pit.sig.composite;
    if (S) {
      out.push({
        name: "BT_연도별_PIT",
        rows: [
          ["연도", "개월", "Q1(상위)", "유니버스 동일가중", "Q1 초과", "롱숏 Q1−Q5", "Q5(하위)"],
          ...[...yr.entries()].map(([y, ix]) => {
            const q1 = comp(S.q[0], ix);
            const b = comp(pit.bench_ew, ix);
            return [y, ix.length, q1, b, q1 != null && b != null ? q1 - b : null, comp(S.ls, ix), comp(S.q[4], ix)];
          }),
        ],
        widths: [7, 6, 10, 16, 10, 12, 10],
        formats: { 2: "0.0%", 3: "0.0%", 4: "0.0%", 5: "0.0%", 6: "0.0%" },
        charts: [{ type: "bar", title: "PIT · 전체 · 종합 연도별 수익률(비용 전)", cat: 0, series: [2, 3, 5], colors: ["2BA36B", "6B7785", "8E5BD9"] }],
      });
    }
  }

  const cmp: Cell[][] = [];
  let pitBlock = 0;
  for (const mode of ["pit", "pit_large", "static"] as BtMode[]) {
    for (const region of B.meta.regions) {
      const R = B.results[mode]?.[region];
      if (!R) continue;
      for (const s of B.signals) {
        const r = R.sig[s.key];
        if (!r) continue;
        const q1 = r.stats_q[0] ?? {};
        cmp.push([
          MODE_L[mode], region, s.label, s.kind, num(q1.cagr), num(q1.excess), num(q1.ir), num(r.stats_ls.cagr), num(r.stats_ls.sharpe), num(r.stats_ls.mdd),
          num(r.ic_stats.ic_mean), num(r.ic_stats.ic_t), isNum(r.to_mean) ? r.to_mean * 100 : null, r.spread_mono * 100,
        ]);
        if (mode === "pit" && region === "전체" && s.kind !== "descriptor") pitBlock = cmp.length;
      }
    }
  }
  out.push({
    name: "BT_신호비교",
    rows: [["유니버스", "지역", "신호", "종류", "Q1 CAGR(%)", "Q1 초과(%)", "Q1 IR", "롱숏 CAGR(%)", "롱숏 샤프", "롱숏 MDD(%)", "IC 평균", "IC t", "Q1 회전율(%)", "단조성(%)"], ...cmp],
    widths: [14, 12, 18, 10, 10, 10, 8, 12, 10, 12, 8, 7, 12, 9],
    formats: { 4: P2, 5: P2, 6: P2, 7: P2, 8: P2, 9: P2, 10: "0.000", 11: P2, 12: P1, 13: "0" },
    autofilter: true,
    charts: pitBlock
      ? [{ type: "bar", title: "PIT · 전체 · 신호별 롱숏 CAGR(%) (비용 전)", cat: 2, series: [7], lastRow: pitBlock, at: { col: 15, row: 0 }, size: { cols: 11, rows: 20 } }]
      : undefined,
  });

  out.push({
    name: "BT_커버리지",
    rows: [
      ["월", "PIT 종목", "고정 종목", "PIT 대형·중형", "MSCI 구성(상한)", "MSCI 구성(확정)"],
      ...B.coverage.map((c) => [c.date.slice(0, 7), c.n_pit, c.n_static, c.n_pit_large, c.members_upper, c.members_confirmed]),
    ],
    widths: [9, 10, 10, 14, 15, 15],
    charts: [{ type: "line", title: "백테스트 유니버스 종목 수", cat: 0, series: [1, 2, 3, 4], size: { cols: 12, rows: 20 } }],
  });

  const FC = B.factor_corr;
  out.push({
    name: "BT_팩터상관",
    rows: [["", ...FC.labels], ...FC.labels.map((l, i) => [l, ...FC.m[i].map((v) => num(v))])],
    widths: [14, ...FC.labels.map(() => 10)],
    formats: Object.fromEntries(FC.labels.map((_, i) => [i + 1, P2])),
  });

  const m = B.meta;
  out.unshift({
    name: "BT_안내",
    rows: [
      ["ACWI 10년 팩터 백테스트 · SavvyETF"],
      [CONFIDENTIAL],
      [],
      ["기간", `${m.start} ~ ${m.end} (${m.n_months}개월)`],
      ["리밸런싱", `${m.rebalance} · ${m.nq}분위 동일가중 · ${m.currency} · 재무 ${m.lag_months}개월 시차`],
      ["빌드", `${m.built_at.replace("T", " ")} · ${m.source}`],
      ["유니버스", "PIT = 그 달 ACWI 구성종목만 / PIT 대형·중형 = PIT 중 지역별 시총 상위 50% / 현재 구성 고정 = 지금 종목을 과거에도 그대로(편입 look-ahead 포함, 비교용)"],
      ["비용", `누적 시트의 '비용 차감' 열은 롱숏 = 4 × Q1 회전율 × ${COST}bp 근사. 다른 시트의 성과 지표는 비용 전.`],
      ["단위", "누적 = 시작 1. 월수익률·연도별은 소수(0.05 = 5%). 신호비교의 CAGR·초과·MDD는 연환산 %."],
      [],
      ["신호", "종류", "구성"],
      ...B.signals.map((s) => [s.label, s.kind, s.weights ? Object.entries(s.weights).map(([k, w]) => `${label(k)} ${w}`).join(", ") : (s.desc ?? []).join(" · ")]),
    ],
    widths: [18, 12, 90],
  });
  return out;
}

export async function downloadAcwiExcel(A: AcwiSummary, B: AcwiBacktest | null) {
  const XLSX = await import("xlsx");
  const sheets = [...summarySheets(A), ...(B ? backtestSheets(B) : [])];
  downloadXlsx(buildXlsxWithCharts(XLSX, sheets), `SavvyETF_ACWI_${A.meta.ri_last}_${kstStamp()}.xlsx`);
}

/** 종목 상세 — 주간 총수익지수와 10년 월간 시계열. */
export async function downloadAcwiStockExcel(A: AcwiSummary, s: AcwiStock, x: AcwiSeries) {
  const S = A.series;
  const at = (a: Series | undefined, i: number) => (a && isNum(a[i]) ? a[i] : null);
  const sheets: XlsxSheet[] = [
    {
      name: "요약",
      rows: [
        [`${s.n ?? s.c} (${s.c})`],
        [CONFIDENTIAL],
        [],
        ...STOCK_COLS.map(([k, h]) => [h, k === "w" ? (isNum(s.w) ? s.w * 100 : null) : cell((s as Record<string, unknown>)[k])]),
      ],
      widths: [22, 30],
    },
    {
      name: "주간",
      rows: [["주", "총수익지수(마지막=1,000)", "ACWI 벤치마크"], ...S.weeks.map((w, i) => [w, at(x.ri, i), at(S.bench, i)])],
      widths: [11, 22, 14],
      formats: { 1: "#,##0.0", 2: "#,##0.0" },
      charts: [{ type: "line", title: `${s.n ?? s.c} vs ACWI (주간 3년, 마지막=1,000)`, cat: 0, series: [1, 2], size: { cols: 12, rows: 20 } }],
    },
    {
      name: "월간",
      rows: [
        ["월", "총수익지수(마지막=1,000)", "ACWI 벤치마크", "EPS NTM", "BPS", "DPS", "매출 NTM", "PER(근사)"],
        ...S.months.map((m, i) => [m, at(x.rim, i), at(S.bench_m, i), at(x.eps, i), at(x.bps, i), at(x.dps, i), at(x.sal, i), at(x.pe, i)]),
      ],
      widths: [9, 22, 14, 11, 11, 11, 13, 10],
      formats: { 1: "#,##0.0", 2: "#,##0.0", 3: P2, 4: P2, 5: P2, 6: "#,##0.0", 7: P1 },
      charts: [
        { type: "line", title: "총수익지수 vs ACWI (월간 10년)", cat: 0, series: [1, 2], size: { cols: 12, rows: 18 } },
        { type: "line", title: "EPS NTM", cat: 0, series: [3], size: { cols: 12, rows: 16 } },
        { type: "line", title: "PER(근사)", cat: 0, series: [7], size: { cols: 12, rows: 16 } },
      ],
    },
  ];
  const XLSX = await import("xlsx");
  downloadXlsx(buildXlsxWithCharts(XLSX, sheets), `SavvyETF_ACWI_${s.c}_${kstStamp()}.xlsx`);
}

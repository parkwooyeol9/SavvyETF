import type { RebalancePayload } from "./rebalance";
import { buildFlowMatrix, nextCycleRange } from "./rebalanceMatrix";
import { buildXlsxWithCharts, downloadXlsx, kstStamp, type Cell, type XlsxSheet } from "./xlsxCharts";

export type RebalanceExportRow = {
  code: string;
  name: string;
  net: number;
  adv: number | null;
  ratio: number | null;
  level: string;
  by: { etf: string; scenario: string; amount: number }[];
};

const EOK = "#,##0.0";
const PCT = "0.0%";
const tLabel = (t: number) => (t === 0 ? "T" : `T${t > 0 ? "+" : ""}${t}`);
const SIDE = { buy: "매수", sell: "매도" } as const;
const LEVEL: Record<string, string> = { high: "높음(10%↑)", mid: "중간(3%↑)", low: "낮음", unknown: "거래대금 없음" };

/** 일자 × ETF × 종목 수급 시트 (화면 RebalanceFlowMatrix 와 같은 계산). */
function matrixSheets(data: RebalancePayload, choice: Record<string, string>, today: string): XlsxSheet[] {
  const m = buildFlowMatrix(data, choice, { from: today });
  if (!m.dates.length) return [];
  // 증권사 비교는 이번 정기변경 범위만 (다음 회차 일정과 섞지 않음)
  const cyc = nextCycleRange(data, today);
  const mc = cyc ? buildFlowMatrix(data, choice, cyc) : m;
  const out: XlsxSheet[] = [];
  const broker = data.broker_estimates?.[0];
  const dcols = m.dates.length;

  const head = ["종목코드", "종목명", ...m.dates.map((d) => `${d} 매매(억원)`), "합계(억원)", "매수 합(억원)", "매도 합(억원)",
    "20일 평균 거래대금(억원)", "최대 충격(거래대금비)", broker ? `증권사 추정(억원, ${broker.date})` : "", "ETF별 내역"];
  const body = m.stocks.map((s) => [
    s.code, s.name, ...m.dates.map((d) => (s.byDate[d] ? Math.round(s.byDate[d] * 10) / 10 : null)),
    s.total, s.buy, s.sell, s.adv, s.maxRatio, broker ? s.broker : null,
    Object.entries(s.byEtf).map(([c, v]) => `${c} ${v.toFixed(1)}`).join(" · "),
  ]);
  const topN = Math.min(20, body.length);
  const fmts: Record<number, string> = {};
  for (let i = 0; i < dcols + 3; i++) fmts[2 + i] = EOK;
  fmts[2 + dcols + 3] = EOK;
  fmts[2 + dcols + 4] = PCT;
  fmts[2 + dcols + 5] = EOK;
  out.push({
    name: "수급_종목x일자",
    rows: [head, ...body],
    widths: [9, 16, ...m.dates.map(() => 16), 12, 12, 12, 18, 16, 18, 60],
    formats: fmts,
    charts: [{
      type: "bar", title: `종목별 예상 순매매 — 매매일별 (억원, 상위 ${topN})`, cat: 1,
      series: m.dates.map((_, i) => 2 + i), lastRow: topN, yFormat: "#,##0",
      at: { col: head.length + 1, row: 0 }, size: { cols: 12, rows: 24 },
    }],
  });

  out.push({
    name: "수급_ETFx일자",
    rows: [
      ["매매일", "효력일", "ETF코드", "ETF명", "시나리오", "분할", "순자산(억원)", "보유비중 기준일", "매수(억원)", "매도(억원)", "1%p 민감도(억원)"],
      ...m.etfs.map((e) => [e.date, e.effective, e.code, e.name, e.scenario, e.split ?? "", e.aum, e.holdingsAsOf ?? "",
        Math.round(e.buy * 10) / 10, Math.round(e.sell * 10) / 10, e.aum / 100]),
      [],
      ["매매일", "계산 ETF 수", "매수 합(억원)", "매도 합(억원)"],
      ...m.dates.map((d) => [d, m.totalsByDate[d].etfs, m.totalsByDate[d].buy, m.totalsByDate[d].sell]),
    ],
    widths: [11, 11, 9, 28, 22, 6, 12, 13, 12, 12, 14],
    formats: { 6: "#,##0", 8: EOK, 9: EOK, 10: EOK },
    charts: [{ type: "bar", title: "ETF별 예상 매수·매도(억원)", cat: 3, series: [8, 9], lastRow: m.etfs.length, yFormat: "#,##0",
      at: { col: 12, row: 0 }, size: { cols: 10, rows: 18 } }],
  });

  out.push({
    name: "수급_원자료",
    rows: [
      ["매매일", "효력일", "ETF코드", "ETF명", "시나리오", "분할", "종목코드", "종목명", "현재(%)", "목표(%)", "변화(%p)", "예상 매매(억원)"],
      ...m.long.map((r) => [r.date, r.effective, r.etfCode, r.etfName, r.scenario, r.split ?? "", r.code, r.name, r.current, r.target, r.delta, r.amount]),
    ],
    widths: [11, 11, 9, 28, 22, 6, 9, 16, 9, 9, 9, 13],
    formats: { 8: "0.00", 9: "0.00", 10: "0.00", 11: EOK },
  });

  out.push({
    name: "일정단계_근거",
    rows: [
      ["ETF코드", "ETF명", "순자산(억원)", "종목 선정일", "비중 확정일", "매매일(종가)", "개편(효력)일", "대안 매매일", "규칙", "확인 필요", "방법론 근거", "URL", "메모"],
      ...data.etfs.filter((e) => e.kind === "etf" && e.next_trade_date && e.next_trade_date >= today).map((e) => [
        e.code, e.name, e.aum_eok, e.selection_date ?? "", e.weight_fix_date ?? "", e.next_trade_date, e.next_effective ?? "",
        e.next_trade_date_alt ?? "", `${e.rule ?? ""} ${e.rule_label}`, (e.unverified || []).join(", "),
        e.method_source?.label ?? "", e.method_source?.url ?? "", (e.notes || []).join(" / "),
      ]),
    ],
    widths: [9, 28, 12, 11, 11, 11, 11, 11, 22, 18, 30, 40, 100],
    formats: { 2: "#,##0" },
  });

  if (broker) {
    out.push({
      name: "증권사비교",
      rows: [
        ["출처", `${broker.source} (${broker.date})`],
        ["기준", broker.basis ?? ""],
        [],
        ["종목코드", "종목명", "증권사 추정(억원)", "우리 추정 합계(억원)", "차이(억원)", "증권사 메모"],
        ...broker.items.map((b) => {
          const ours = mc.stocks.find((s) => s.code === b.code)?.total ?? null;
          return [b.code, b.name, b.amount_eok, ours, ours == null ? null : ours - b.amount_eok, b.note ?? ""];
        }),
        [],
        [`우리 추정 = 이번 정기변경(${mc.dates.join(", ")}) 합계, 선택 시나리오. 증권사 자료는 재배포 금지 — 수치만 인용.`],
      ],
      widths: [9, 16, 16, 18, 12, 40],
      formats: { 2: EOK, 3: EOK, 4: EOK },
      headerRow: 3,
      charts: [{ type: "bar", title: "증권사 추정 vs 우리 추정(억원)", cat: 1, series: [2, 3], headerRow: 3, lastRow: 3 + broker.items.length,
        yFormat: "#,##0", at: { col: 7, row: 0 }, size: { cols: 10, rows: 20 } }],
    });
  }
  return out;
}

function rebalanceSheets(
  data: RebalancePayload,
  selected: string | null,
  rows: RebalanceExportRow[],
  choice: Record<string, string> = {},
  today = "",
): XlsxSheet[] {
  const sheets: XlsxSheet[] = [];
  const matrix = matrixSheets(data, choice, today);
  const es = data.event_study;
  const guide: Cell[][] = [
    ["ETF 리밸런싱 · SavvyETF"],
    [],
    ["기준일", data.as_of],
    ["생성", data.generated_at.replace("T", " ").slice(0, 16)],
    ["거래대금 기준", data.adv_as_of || "미수집"],
    ["선택 매매일", selected || "—"],
    [],
    ["시트", "내용"],
  ];
  const list: [string, string][] = [];
  if (es?.rows.length) {
    list.push(
      ["전후주가_평균", "과거 정기변경 매매일(T) 전후 시장 대비 평균 누적 초과수익 · 선 차트"],
      ["전후주가_종목별", "종목별 누적 초과수익 경로 · 선 차트"],
      ["이벤트요약", "방향별 구간 평균 초과수익 · 막대 차트"],
      ["이벤트_종목별", "이벤트 종목별 초과수익·거래대금"],
    );
  }
  if (matrix.length) {
    list.push(
      ["수급_종목x일자", "종목 × 매매일 예상 순매매 · 합계 · 거래대금 대비 · 증권사 추정 · 막대 차트"],
      ["수급_ETFx일자", "ETF·매매일별 예상 매수/매도 · 1%p 민감도 · 매매일 합계 · 막대 차트"],
      ["수급_원자료", "매매일·ETF·종목 단위 현재/목표 비중과 예상 매매 (피벗용)"],
      ["일정단계_근거", "ETF별 종목 선정일·비중 확정일·매매일·개편일·방법론 원문 링크"],
    );
    if (data.broker_estimates?.length) list.push(["증권사비교", "증권사 공개 추정치와 우리 추정 비교 · 막대 차트"]);
  }
  list.push(
    ["매매일정", "매매일별 정기변경 ETF 순자산 · 막대 차트"],
    ["정기변경ETF", "ETF별 규칙·효력일·상태"],
    ["순매매_선택일", "선택 매매일 종목별 예상 순매매(선택한 시나리오) · 막대 차트"],
    ["충격종목_전체", "매매일별 종목 순매매와 20일 거래대금 대비 비율"],
    ["ETF별_예상매매", "ETF·시나리오별 현재/목표 비중과 예상 매매"],
  );
  guide.push(...list, [], ["차트는 각 시트의 셀 범위를 참조하는 Excel 차트입니다. 값을 바꾸거나 범위를 수정하면 차트도 바뀝니다."]);
  guide.push(["초과수익은 소수(0.05 = 5%)로 저장돼 있고, 금액 단위는 억원입니다."], []);
  for (const a of data.assumptions) guide.push(["가정", a]);
  for (const s of data.sources) guide.push(["출처", s]);
  guide.push([], ["추정치·과거 결과이며 투자 권유가 아닙니다."]);
  sheets.push({ name: "안내", rows: guide, widths: [16, 90] });
  sheets.push(...matrix);

  if (es?.rows.length) {
    const { params, summary } = es;
    const pre = `T${params.pre}~T-1`;
    const post = `T+1~T+${params.hold}`;
    sheets.push({
      name: "전후주가_평균",
      rows: [["구간", "t", "ETF 매수 종목", "ETF 매도 종목"], ...es.paths.map((p) => [tLabel(p.t), p.t, p.buy, p.sell])],
      widths: [8, 6, 14, 14],
      formats: { 2: PCT, 3: PCT },
      charts: [{ type: "line", title: `정기변경 전후 평균 누적 초과수익 (T${params.path_from} 기준)`, cat: 0, series: [2, 3], yFormat: "0%", colors: ["2BA36B", "E5484D"] }],
    });

    const ts = Array.from({ length: params.path_to - params.path_from + 1 }, (_, i) => params.path_from + i);
    const heads = es.rows.map((r) => `${r.trade_date.slice(2).replace(/-/g, "/")} ${r.name}(${SIDE[r.side]})`);
    sheets.push({
      name: "전후주가_종목별",
      rows: [["구간", ...heads], ...ts.map((t, i) => [tLabel(t), ...es.rows.map((r) => r.car_path[i] ?? null)])],
      widths: [8, ...heads.map(() => 16)],
      formats: Object.fromEntries(heads.map((_, i) => [i + 1, PCT])),
      charts: [{ type: "line", title: "종목별 누적 초과수익", cat: 0, series: heads.map((_, i) => i + 1), yFormat: "0%", at: { col: 1, row: ts.length + 2 }, size: { cols: 12, rows: 22 } }],
    });

    sheets.push({
      name: "이벤트요약",
      rows: [
        ["방향", "건수", `발표 전 ${pre}`, "T일", `효력 후 ${post}`],
        ...(["buy", "sell"] as const).map((side) => {
          const s = summary.by_side[side];
          return [`ETF ${SIDE[side]}`, s.n, s.car_pre, s.ar_0, s.car_post];
        }),
        [],
        [`정기변경 ${summary.n_events}회 · 종목 ${summary.n}건 · 모형 ${params.model} · 가격 ${params.price_source}`],
      ],
      widths: [12, 8, 18, 10, 18],
      formats: { 2: PCT, 3: PCT, 4: PCT },
      charts: [{ type: "bar", title: "구간별 평균 초과수익", cat: 0, series: [2, 3, 4], lastRow: 2, yFormat: "0%" }],
    });

    sheets.push({
      name: "이벤트_종목별",
      rows: [
        ["이벤트", "매매일", "신뢰도", "종목코드", "종목명", "시장", "방향", "ETF 매매(억원)", "평균 거래대금(억원)", "거래대금비", pre, "T일", post],
        ...es.rows.map((r) => [
          r.label, r.trade_date, r.confidence, r.code, r.name, r.market, SIDE[r.side],
          r.flow_eok, r.adv_eok, r.impact_ratio ?? (r.flow_eok != null && r.adv_eok ? Math.abs(r.flow_eok) / r.adv_eok : null),
          r.car_pre, r.ar_0, r.car_post,
        ]),
      ],
      widths: [28, 11, 8, 9, 16, 8, 6, 12, 14, 10, 12, 10, 12],
      formats: { 7: EOK, 8: EOK, 9: PCT, 10: PCT, 11: PCT, 12: PCT },
    });
  }

  const expiries = new Set(data.expiries.map((e) => e.expiry));
  sheets.push({
    name: "매매일정",
    rows: [
      ["매매일", "상태", "ETF 수", "정기변경 ETF 순자산(억원)", "지수 정기변경", "옵션만기", "ETF"],
      ...data.trade_days.map((d) => [
        d.trade_date, d.status === "past" ? "지남" : "예정", d.etfs.length, d.aum_eok,
        d.has_index ? "Y" : "", expiries.has(d.trade_date) ? "Y" : "", d.etfs.join(", "),
      ]),
    ],
    widths: [11, 6, 7, 22, 12, 9, 60],
    formats: { 3: "#,##0" },
    charts: [{ type: "bar", title: "매매일별 정기변경 ETF 순자산(억원)", cat: 0, series: [3], yFormat: "#,##0", at: { col: 1, row: data.trade_days.length + 2 } }],
  });

  const etfBy = new Map(data.etfs.map((e) => [e.code, e]));
  sheets.push({
    name: "정기변경ETF",
    rows: [
      ["매매일", "효력일", "ETF코드", "ETF명", "운용사", "구분", "테마", "순자산(억원)", "규칙", "규칙 설명", "Cap(%)", "상태"],
      ...data.events.map((e) => {
        const m = etfBy.get(e.etf_code);
        return [
          e.trade_date, e.effective, e.etf_code, e.etf_name, e.issuer ?? "", e.kind === "index" ? "지수" : "ETF", e.theme ?? m?.theme ?? "",
          e.aum_eok, e.rule, e.rule_label, m?.cap_pct ?? null, m?.flow_status ?? "",
        ];
      }),
    ],
    widths: [11, 11, 9, 30, 12, 6, 14, 12, 8, 30, 8, 12],
    formats: { 7: "#,##0" },
  });

  const top = rows.slice(0, 30);
  sheets.push({
    name: "순매매_선택일",
    rows: [
      ["종목코드", "종목명", "예상 순매매(억원)", "20일 평균 거래대금(억원)", "거래대금비", "충격", "ETF별 내역"],
      ...rows.map((r) => [
        r.code, r.name, r.net, r.adv, r.ratio, LEVEL[r.level] ?? r.level,
        r.by.map((b) => `${b.etf} (${b.scenario}) ${b.amount.toFixed(1)}`).join(" · "),
      ]),
    ],
    widths: [9, 16, 16, 20, 10, 12, 70],
    formats: { 2: EOK, 3: EOK, 4: PCT },
    charts: top.length
      ? [{ type: "bar", title: `${selected ?? ""} 종목별 예상 순매매(억원, 상위 ${top.length})`, cat: 1, series: [2], lastRow: top.length, yFormat: "#,##0", at: { col: 8, row: 0 }, size: { cols: 10, rows: 20 } }]
      : undefined,
  });

  sheets.push({
    name: "충격종목_전체",
    rows: [
      ["매매일", "종목코드", "종목명", "매수(억원)", "매도(억원)", "순매매(억원)", "20일 평균 거래대금(억원)", "거래대금비", "충격", "ETF별 내역"],
      ...data.impact.map((r) => [
        r.trade_date, r.code, r.name, r.buy_eok, r.sell_eok, r.net_eok, r.adv_eok, r.impact_ratio, LEVEL[r.impact_level] ?? r.impact_level,
        r.by_etf.map((b) => `${b.etf_name} ${b.amount_eok.toFixed(1)}`).join(" · "),
      ]),
    ],
    widths: [11, 9, 16, 11, 11, 12, 20, 10, 12, 70],
    formats: { 3: EOK, 4: EOK, 5: EOK, 6: EOK, 7: PCT },
  });

  sheets.push({
    name: "ETF별_예상매매",
    rows: [
      ["매매일", "효력일", "ETF코드", "ETF명", "시나리오", "기본 시나리오", "순자산(억원)", "비중 기준일", "종목코드", "종목명", "현재(%)", "목표(%)", "변화(%p)", "예상 매매(억원)"],
      ...data.flows.flatMap((f) =>
        f.trades.map((t) => [
          f.trade_date, f.effective, f.etf_code, f.etf_name, f.scenario_label, f.primary ? "Y" : "", f.aum_eok, f.holdings_as_of ?? "",
          t.code, t.name, t.current_pct, t.target_pct, t.delta_pct, t.amount_eok,
        ]),
      ),
    ],
    widths: [11, 11, 9, 28, 18, 10, 12, 11, 9, 16, 9, 9, 9, 13],
    formats: { 6: "#,##0", 10: "0.00", 11: "0.00", 12: "0.00", 13: EOK },
  });
  return sheets;
}

export async function downloadRebalanceExcel(
  data: RebalancePayload,
  selected: string | null,
  rows: RebalanceExportRow[],
  choice: Record<string, string> = {},
  today = "",
) {
  const XLSX = await import("xlsx");
  downloadXlsx(
    buildXlsxWithCharts(XLSX, rebalanceSheets(data, selected, rows, choice, today)),
    `SavvyETF_리밸런싱_${kstStamp()}.xlsx`,
  );
}

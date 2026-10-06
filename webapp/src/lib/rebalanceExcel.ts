import type { RebalancePayload } from "./rebalance";
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

function rebalanceSheets(data: RebalancePayload, selected: string | null, rows: RebalanceExportRow[]): XlsxSheet[] {
  const sheets: XlsxSheet[] = [];
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

export async function downloadRebalanceExcel(data: RebalancePayload, selected: string | null, rows: RebalanceExportRow[]) {
  const XLSX = await import("xlsx");
  downloadXlsx(buildXlsxWithCharts(XLSX, rebalanceSheets(data, selected, rows)), `SavvyETF_리밸런싱_${kstStamp()}.xlsx`);
}

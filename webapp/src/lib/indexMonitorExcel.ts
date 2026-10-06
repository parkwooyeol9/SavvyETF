import {
  INDEX_GROUPS,
  INDEX_ORDER,
  SOURCE_TIER_LABEL,
  indexGroup,
  indexName,
  type IndexChangeRow,
  type RebalanceCalendarItem,
} from "./indexMonitor";
import { buildXlsxWithCharts, downloadXlsx, kstStamp, type Cell } from "./xlsxCharts";

const ACTION = { ADD: "편입", DEL: "편출", WEIGHT: "비중변경" } as const;

export async function downloadIndexMonitorExcel(asOf: string, rows: IndexChangeRow[], upcoming: RebalanceCalendarItem[]) {
  const regionLabel = (id: string) => INDEX_GROUPS.find((g) => g.id === indexGroup(id))?.label ?? "";
  const order = INDEX_ORDER.flatMap((o) => o.ids);
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);

  const byIndex = new Map<string, { ADD: number; DEL: number; WEIGHT: number }>();
  const byMonth = new Map<string, { ADD: number; DEL: number; WEIGHT: number }>();
  for (const r of rows) {
    const a = byIndex.get(r.index_id) ?? { ADD: 0, DEL: 0, WEIGHT: 0 };
    a[r.action] += 1;
    byIndex.set(r.index_id, a);
    const m = r.announce_date.slice(0, 7);
    if (!m) continue;
    const b = byMonth.get(m) ?? { ADD: 0, DEL: 0, WEIGHT: 0 };
    b[r.action] += 1;
    byMonth.set(m, b);
  }
  const indexRows: Cell[][] = [...byIndex.entries()]
    .sort(([x], [y]) => rank(x) - rank(y) || x.localeCompare(y))
    .map(([id, v]) => [indexName(id), id, regionLabel(id), v.ADD, v.DEL, v.WEIGHT, v.ADD + v.DEL + v.WEIGHT]);
  const monthRows: Cell[][] = [...byMonth.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([m, v]) => [m, v.ADD, v.DEL, v.WEIGHT, v.ADD + v.DEL + v.WEIGHT]);
  const XLSX = await import("xlsx");
  const bytes = buildXlsxWithCharts(XLSX, [
    {
      name: "안내",
      rows: [
        ["Index Monitor · SavvyETF"],
        [],
        ["기준일", asOf],
        ["변경 행", rows.length],
        [],
        ["시트", "내용"],
        ["지수별_건수", "지수별 편입·편출·비중변경 건수 · 막대 차트"],
        ["월별_건수", "공지 월별 변경 건수 · 막대 차트"],
        ["변경내역", "수집한 편출입 전체"],
        ["다가오는일정", "확정·예상 리밸런싱 일정"],
        [],
        ["차트는 각 시트의 셀 범위를 참조하는 Excel 차트입니다."],
      ],
      widths: [14, 60],
    },
    {
      name: "지수별_건수",
      rows: [["지수", "ID", "지역", "편입", "편출", "비중변경", "합계"], ...indexRows],
      widths: [26, 16, 8, 7, 7, 9, 7],
      charts: [{ type: "bar", title: "지수별 변경 건수", cat: 0, series: [3, 4, 5], colors: ["2BA36B", "E5484D", "E39B14"], size: { cols: 12, rows: 22 } }],
    },
    {
      name: "월별_건수",
      rows: [["공지 월", "편입", "편출", "비중변경", "합계"], ...monthRows],
      widths: [10, 7, 7, 9, 7],
      charts: [{ type: "bar", title: "공지 월별 변경 건수", cat: 0, series: [1, 2, 3], colors: ["2BA36B", "E5484D", "E39B14"] }],
    },
    {
      name: "변경내역",
      rows: [
        ["지수", "ID", "지역", "정기변경", "공지일", "효력일", "구분", "변경", "종목명", "코드", "메모", "출처 등급", "출처"],
        ...rows.map((r) => [
          indexName(r.index_id), r.index_id, regionLabel(r.index_id), r.review, r.announce_date, r.effective_date, r.event_type,
          ACTION[r.action] ?? r.action, r.security_name, r.code, r.note, SOURCE_TIER_LABEL[r.source_tier] ?? r.source_tier, r.source_url,
        ]),
      ],
      widths: [22, 14, 8, 12, 11, 11, 10, 8, 28, 12, 30, 12, 50],
    },
    {
      name: "다가오는일정",
      rows: [["날짜", "일정", "내용", "구분", "근거"], ...upcoming.map((c) => [c.date, c.title, c.sub, c.confirmed ? "확정" : "예상", c.url ?? ""])],
      widths: [12, 30, 60, 6, 50],
    },
  ]);
  downloadXlsx(bytes, `SavvyETF_IndexMonitor_${kstStamp()}.xlsx`);
}

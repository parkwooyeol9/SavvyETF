/**
 * ETF 편입비 모니터 → 엑셀 (.xlsx, 네이티브 차트 포함).
 *
 * 화면에서 고른 ETF·기준일 그대로 내보낸다:
 *   요약 · 보유종목(전체, 비교일 대비) · 변동(신규·편출·증감 상위) · 비중시계열 · 경제노출(DRAM 등)
 * 웹 표는 상위 50종만 보이지만 엑셀은 해당 일자 스냅샷의 전체 보유 목록을 담는다.
 */
import { buildXlsxWithCharts, downloadXlsx, kstStamp, type Cell, type XlsxSheet } from "./xlsxCharts";

export type WeightHolding = {
  ticker?: string;
  name?: string;
  cusip?: string;
  sector?: string;
  asset_class?: string;
  weight_pct?: number | null;
  shares?: number | null;
  price?: number | null;
  market_value?: number | null;
};

export type WeightEconomic = {
  id: string;
  label: string;
  weight_pct: number;
  legs?: WeightHolding[];
};

export type WeightSnapshot = {
  ticker?: string;
  name?: string;
  issuer?: string;
  as_of?: string | null;
  as_of_basis?: string | null;
  disclosure?: string | null;
  coverage?: string | null;
  aum_usd?: number | null;
  source?: string;
  source_url?: string;
  source_note?: string;
  generated_at_display?: string;
  holdings?: WeightHolding[];
  economic?: WeightEconomic[];
  history?: {
    dates: string[];
    labels: Record<string, string>;
    series: Record<string, Array<number | null>>;
    snapshot_count?: number;
  };
  notes?: string[];
};

export type EtfWeightsExcelInput = {
  /** Latest payload (meta + history). */
  latest: WeightSnapshot;
  /** Snapshot for the date shown on screen (falls back to latest). */
  view?: WeightSnapshot | null;
  /** Previous snapshot used for 전일 대비 on screen. */
  prev?: WeightSnapshot | null;
  /** Date selected on screen. */
  activeDate?: string | null;
};

const BASIS_LABEL: Record<string, string> = {
  issuer_file: "운용사 공식 파일의 보유 기준일",
  etfcheck_price_date: "etfcheck 가격일 (실제 보유 기준일 아님 — 참고용)",
};
const DISCLOSURE_LABEL: Record<string, string> = { daily: "일간", monthly: "월말 (약 1개월 지연 공시)" };
const COVERAGE_LABEL: Record<string, string> = { full: "전체 보유 목록", top10: "Top 10만 (전체 목록 아님)" };

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const fin = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) ? n : null);

/** Same key the web table uses to match a holding across dates. */
export function holdingKey(h: WeightHolding): string {
  return (h.ticker || h.cusip || h.name || "").trim().toUpperCase();
}

function sortByWeight(list: WeightHolding[] = []): WeightHolding[] {
  return [...list].sort((a, b) => (b.weight_pct ?? -Infinity) - (a.weight_pct ?? -Infinity));
}

function fmtAum(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function buildEtfWeightsSheets(input: EtfWeightsExcelInput): XlsxSheet[] {
  const { latest } = input;
  const view = input.view?.holdings?.length ? input.view : latest;
  const prev = input.prev?.holdings?.length ? input.prev : null;
  const day = input.activeDate || view.as_of || latest.as_of || "";
  const prevDay = prev?.as_of || "";
  const ticker = (latest.ticker || view.ticker || "").toUpperCase();

  const cur = sortByWeight(view.holdings);
  const prevMap = new Map<string, WeightHolding>();
  for (const h of prev?.holdings || []) {
    const k = holdingKey(h);
    if (k && !prevMap.has(k)) prevMap.set(k, h);
  }
  const curKeys = new Set(cur.map(holdingKey).filter(Boolean));

  // --- 보유종목 -------------------------------------------------------------
  const holdHeader: Cell[] = [
    "순위", "티커", "종목명", "섹터", "자산구분", "비중(%)",
    prev ? `비교일 비중(%) ${prevDay}` : "비교일 비중(%)", "변화(%p)",
    "보유주식수", "비교일 주식수", "주식수 변화", "평가액(USD)", "CUSIP/ISIN",
  ];
  const holdRows: Cell[][] = cur.map((h, i) => {
    const p = prev ? prevMap.get(holdingKey(h)) : undefined;
    const w = fin(h.weight_pct);
    const pw = fin(p?.weight_pct);
    const sh = fin(h.shares);
    const psh = fin(p?.shares);
    return [
      i + 1,
      h.ticker || "",
      h.name || "",
      h.sector || "",
      h.asset_class || "",
      w,
      prev ? (pw ?? (p ? null : 0)) : null,
      prev && w != null ? r4(w - (pw ?? 0)) : null,
      sh,
      prev ? psh : null,
      prev && sh != null && psh != null ? sh - psh : null,
      fin(h.market_value),
      h.cusip || "",
    ];
  });
  const topN = Math.min(15, holdRows.length);

  // --- 변동 ------------------------------------------------------------------
  const moveRows: Cell[][] = [];
  if (prev) {
    const added = cur.filter((h) => !prevMap.has(holdingKey(h)));
    const removed = sortByWeight(prev.holdings).filter((h) => !curKeys.has(holdingKey(h)));
    const deltas = cur
      .map((h) => {
        const p = prevMap.get(holdingKey(h));
        return p && h.weight_pct != null && p.weight_pct != null
          ? { h, p, d: h.weight_pct - p.weight_pct }
          : null;
      })
      .filter((x): x is { h: WeightHolding; p: WeightHolding; d: number } => x != null);
    const up = [...deltas].sort((a, b) => b.d - a.d).filter((x) => x.d > 0).slice(0, 10);
    const down = [...deltas].sort((a, b) => a.d - b.d).filter((x) => x.d < 0).slice(0, 10);
    for (const h of added) moveRows.push(["신규 편입", h.ticker || "", h.name || "", null, fin(h.weight_pct), fin(h.weight_pct), fin(h.shares)]);
    for (const h of removed) moveRows.push(["편출", h.ticker || "", h.name || "", fin(h.weight_pct), null, fin(h.weight_pct) != null ? -fin(h.weight_pct)! : null, null]);
    for (const x of up) moveRows.push(["비중 증가", x.h.ticker || "", x.h.name || "", fin(x.p.weight_pct), fin(x.h.weight_pct), r4(x.d), fin(x.h.shares) != null && fin(x.p.shares) != null ? x.h.shares! - x.p.shares! : null]);
    for (const x of down) moveRows.push(["비중 감소", x.h.ticker || "", x.h.name || "", fin(x.p.weight_pct), fin(x.h.weight_pct), r4(x.d), fin(x.h.shares) != null && fin(x.p.shares) != null ? x.h.shares! - x.p.shares! : null]);
  }

  // --- 비중시계열 ------------------------------------------------------------
  const hist = latest.history;
  const seriesIds = hist ? Object.keys(hist.series || {}) : [];
  const histRows: Cell[][] = hist
    ? hist.dates.map((d, i) => [d, ...seriesIds.map((id) => fin(hist.series[id]?.[i]))])
    : [];

  // --- 요약 ------------------------------------------------------------------
  const top10Sum = cur.slice(0, 10).reduce((s, h) => s + (h.weight_pct ?? 0), 0);
  const totalW = cur.reduce((s, h) => s + (h.weight_pct ?? 0), 0);
  const basis = latest.as_of_basis || view.as_of_basis || "";
  const disclosure = latest.disclosure || view.disclosure || "";
  const coverage = view.coverage || latest.coverage || "";
  // Ordinary funds carry single-leg "economic" rows that duplicate 보유종목;
  // only multi-leg exposure (DRAM: 현물 + TRS) gets its own sheet.
  const hasEconomic = (view.economic || []).some((e) => (e.legs || []).length > 1);

  const sheetGuide: Cell[][] = [
    ["보유종목", `${day} 기준 전체 ${cur.length}종${prev ? ` · ${prevDay} 대비 비중·주식수 변화` : ""} · 상위 ${topN} 막대 차트`],
  ];
  if (prev) sheetGuide.push(["변동", "신규 편입 · 편출 · 비중 증가/감소 상위 10"]);
  if (histRows.length) sheetGuide.push(["비중시계열", `주요 종목 비중 ${histRows.length}일 · 선 차트`]);
  if (hasEconomic) sheetGuide.push(["경제노출", "현물 + TRS 합산 노출과 구성 레그"]);

  const summary: Cell[][] = [
    [`ETF 편입비 모니터 · ${ticker} · SavvyETF`],
    [],
    ["ETF", latest.name || view.name || ticker],
    ["티커", ticker],
    ["운용사", latest.issuer || view.issuer || ""],
    ["보유 기준일", day],
    ["기준일 의미", BASIS_LABEL[basis] || basis || "—"],
    ["공시 주기", DISCLOSURE_LABEL[disclosure] || disclosure || "—"],
    ["커버리지", COVERAGE_LABEL[coverage] || (coverage || "전체 보유 목록")],
    ["비교 기준일", prevDay || "없음 (이전 스냅샷 없음)"],
    ["AUM", fmtAum(latest.aum_usd)],
    ["보유 종목 수", cur.length],
    ["비중 합계(%)", r4(totalW)],
    ["상위 10 비중 합계(%)", r4(top10Sum)],
    ["누적 스냅샷", `${hist?.dates.length ?? 0}일${hist?.dates.length ? ` (${hist.dates[0]} ~ ${hist.dates[hist.dates.length - 1]})` : ""}`],
    ["원천", latest.source || view.source || ""],
    ["원천 URL", latest.source_url || view.source_url || ""],
    ["원천 메모", view.source_note || latest.source_note || ""],
    ["수집 시각", latest.generated_at_display || ""],
    ["다운로드", `${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)} KST`],
    [],
    ["시트", "내용"],
    ...sheetGuide,
  ];
  if (latest.notes?.length) {
    summary.push([], ["참고"]);
    for (const n of latest.notes) summary.push(["", n]);
  }
  summary.push([], ["차트는 각 시트의 셀 범위를 참조하는 Excel 차트입니다. 비중 단위는 % (5.02 = 5.02%)."]);

  const sheets: XlsxSheet[] = [
    { name: "요약", rows: summary, widths: [20, 90] },
    {
      name: "보유종목",
      rows: [holdHeader, ...holdRows],
      widths: [6, 10, 34, 22, 14, 9, 14, 9, 14, 14, 12, 16, 16],
      formats: { 5: "0.00", 6: "0.00", 7: "+0.00;-0.00;0.00", 8: "#,##0", 9: "#,##0", 10: "+#,##0;-#,##0;0", 11: "#,##0" },
      autofilter: true,
      charts: topN
        ? [{ type: "bar", title: `${ticker} 상위 ${topN} 비중(%) · ${day}`, cat: 1, series: [5], lastRow: topN, at: { col: 14, row: 0 }, size: { cols: 9, rows: 22 }, yFormat: "0.0", colors: ["0F766E"] }]
        : undefined,
    },
  ];
  if (prev) {
    sheets.push({
      name: "변동",
      rows: [
        ["구분", "티커", "종목명", `비중(%) ${prevDay}`, `비중(%) ${day}`, "변화(%p)", "주식수 변화"],
        ...(moveRows.length ? moveRows : [["변동 없음"]]),
      ],
      widths: [11, 10, 34, 16, 16, 10, 14],
      formats: { 3: "0.00", 4: "0.00", 5: "+0.00;-0.00;0.00", 6: "+#,##0;-#,##0;0" },
      autofilter: moveRows.length > 0,
    });
  }
  if (histRows.length) {
    sheets.push({
      name: "비중시계열",
      rows: [["날짜", ...seriesIds.map((id) => hist!.labels[id] || id)], ...histRows],
      widths: [12, ...seriesIds.map(() => 14)],
      formats: Object.fromEntries(seriesIds.map((_, i) => [i + 1, "0.00"])),
      charts:
        histRows.length >= 2
          ? [{ type: "line", title: `${ticker} 주요 종목 비중(%) 추이`, cat: 0, series: seriesIds.map((_, i) => i + 1), size: { cols: 12, rows: 22 }, yFormat: "0.0" }]
          : undefined,
    });
  }
  if (hasEconomic) {
    const prevEco = new Map((prev?.economic || []).map((e) => [e.id, e.weight_pct] as const));
    sheets.push({
      name: "경제노출",
      rows: [
        ["그룹", "비중(%)", "비교일 비중(%)", "변화(%p)", "구성 레그"],
        ...(view.economic || []).map((e) => {
          const p = fin(prevEco.get(e.id));
          return [
            e.label,
            fin(e.weight_pct),
            p,
            p != null ? r4(e.weight_pct - p) : null,
            (e.legs || []).map((l) => `${l.ticker || l.name || "?"} ${(l.weight_pct ?? 0).toFixed(2)}%`).join(" · "),
          ];
        }),
      ],
      widths: [24, 10, 14, 10, 70],
      formats: { 1: "0.00", 2: "0.00", 3: "+0.00;-0.00;0.00" },
    });
  }
  return sheets;
}

export function etfWeightsFilename(ticker: string, day: string | null | undefined): string {
  const safe = (ticker || "ETF").replace(/[^A-Za-z0-9_-]/g, "");
  return `SavvyETF_편입비_${safe}_${(day || "").replace(/-/g, "") || kstStamp()}.xlsx`;
}

export async function downloadEtfWeightsExcel(input: EtfWeightsExcelInput): Promise<void> {
  if (!input.latest?.holdings?.length && !input.view?.holdings?.length) {
    throw new Error("보유 목록이 없어 엑셀을 만들 수 없습니다");
  }
  const XLSX = await import("xlsx");
  const bytes = buildXlsxWithCharts(XLSX, buildEtfWeightsSheets(input));
  downloadXlsx(bytes, etfWeightsFilename(input.latest.ticker || "", input.activeDate || input.view?.as_of || input.latest.as_of));
}

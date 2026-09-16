import {
  ALL_SCENARIO,
  GROUPING_META,
  HORIZON_META,
  MARKET_SPECS,
  SCENARIO_META,
  SECTOR_SPECS,
  electionMatches,
  incumbentLabel,
  netDemSeats,
  pickHorizon,
  scenarioMeta,
  scenariosForGrouping,
  type GroupingId,
  type MidtermStudyPayload,
  type PathPoint,
  type ScenarioId,
} from "@/lib/midtermStudy";
import {
  a1,
  a1Range,
  buildXlsx,
  headerRow,
  intval,
  num,
  sheetFormula,
  type CellInput,
  type ChartSeries,
  type ChartSpec,
  type SheetSpec,
} from "@/lib/xlsxWorkbook";

const CHART_SHEET = "ChartData";
const OVERLAY_N_MAX = 6;
const MARKET_COLOR: Record<string, string> = {
  spx: "60A5FA",
  nasdaq: "C084FC",
  dow: "FBBF24",
};
const HORIZON_COLOR = ["60A5FA", "34D399", "FBBF24", "C084FC"];
const COMPARE_COLOR = ["64748B", "60A5FA", "34D399", "FBBF24", "F87171", "C084FC"];
const POS_COLOR = "34D399";
const NEG_COLOR = "F87171";

export type MidtermExcelOpts = {
  scenario: ScenarioId;
  grouping: GroupingId;
};

function pathMap(path: PathPoint[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of path) m.set(p.t, p.v);
  return m;
}

function unionT(paths: PathPoint[][]): number[] {
  const set = new Set<number>();
  for (const path of paths) {
    for (const p of path) set.add(p.t);
  }
  return [...set].sort((a, b) => a - b);
}

function partyKo(p: "D" | "R"): string {
  return p === "D" ? "민주" : "공화";
}

function controlLabel(house: "D" | "R", senate: "D" | "R"): string {
  return `하원 ${partyKo(house)} · 상원 ${partyKo(senate)}`;
}

function seriesFromCol(input: {
  name: string;
  headerRow: number;
  col: number;
  first: number;
  last: number;
  values: Array<number | null>;
  color: string;
  alpha?: number;
  width?: number;
}): ChartSeries {
  return {
    name: input.name,
    nameRef: sheetFormula(CHART_SHEET, a1(input.col, input.headerRow)),
    valRef: sheetFormula(CHART_SHEET, a1Range(input.col, input.first, input.col, input.last)),
    values: input.values,
    color: input.color,
    alpha: input.alpha,
    width: input.width,
  };
}

function chartSlots(n: number): Array<{ from: { col: number; row: number }; to: { col: number; row: number } }> {
  const slots = [
    { from: { col: 0, row: 4 }, to: { col: 11, row: 21 } },
    { from: { col: 12, row: 4 }, to: { col: 23, row: 21 } },
    { from: { col: 0, row: 22 }, to: { col: 11, row: 39 } },
    { from: { col: 12, row: 22 }, to: { col: 23, row: 39 } },
    { from: { col: 0, row: 40 }, to: { col: 23, row: 57 } },
  ];
  return slots.slice(0, n);
}

function readmeSheet(payload: MidtermStudyPayload, opts: MidtermExcelOpts): SheetSpec {
  const meta = scenarioMeta(opts.scenario) ?? ALL_SCENARIO;
  const grouping = GROUPING_META.find((g) => g.id === opts.grouping);
  const sc = payload.scenarios[opts.scenario];
  const years = (sc?.elections || []).map((e) => e.id).join(", ") || "—";
  const rows: CellInput[][] = [
    headerRow(["항목", "내용"]),
    ["제목", "미국 중간선거 이벤트 스터디"],
    ["생성시각", payload.generated_at || ""],
    ["선택 분류", `${grouping?.label || opts.grouping} (${grouping?.sub || ""})`],
    ["선택 시나리오", `${meta.label} (${opts.scenario})`],
    ["시나리오 설명", meta.sub],
    ["표본 수", sc?.n ?? 0],
    ["해당 연도", years],
    [],
    ["방법", payload.note],
    [],
    ["데이터 범위", (payload.coverage || []).join(" · ")],
    [],
    ["시장 지수 출처", "Yahoo Finance Chart API (^GSPC, ^IXIC, ^DJI)"],
    [
      "업종 출처",
      "Ken French 12 Industry Portfolios (value-weighted daily). GICS/섹터 ETF가 아님. https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html",
    ],
    ["의석 출처", "Clerk of the House / Senate Historical Office (코드에 수록)"],
    [],
    ["차트", "Charts 시트의 그림은 엑셀 기본 차트입니다. ChartData 시트 값을 참조하므로 해당 시트를 지우면 차트가 깨집니다."],
    [],
    headerRow(["시트", "내용"]),
    ["README", "출처 · 방법 · 현재 선택 시나리오"],
    ["Charts", "엑셀 네이티브 차트 (ChartData 참조)"],
    ["ChartData", "차트용 와이드 테이블 (선택 시나리오)"],
    ["Elections", "1950–2022 중간선거 의석·지배"],
    ["Scenarios", "시나리오 목록과 표본 연도"],
    ["Market_Horizons", "전 시나리오 지수 평균 수익률"],
    ["Sector_Horizons", "전 시나리오 French 12산업 평균 수익률"],
    ["Event_Horizons", "선거×자산×기간 개별 값"],
    ["Market_Paths", "전 시나리오 지수 평균 경로 (t, 리베이스)"],
    ["Sector_Paths", "전 시나리오 업종 평균 경로"],
    ["SPX_Overlays", "시나리오별 연도 S&P 500 경로"],
  ];
  return { name: "README", rows, widths: [22, 92], freezeRows: 1 };
}

function electionsSheet(payload: MidtermStudyPayload, opts: MidtermExcelOpts): SheetSpec {
  const rows: CellInput[][] = [
    headerRow([
      "연도",
      "선거일",
      "대통령",
      "대통령(영)",
      "대통령정당",
      "의회",
      "하원D전",
      "하원R전",
      "하원기타전",
      "하원D후",
      "하원R후",
      "하원기타후",
      "하원민주순증",
      "하원지배",
      "상원D전",
      "상원R전",
      "상원기타전",
      "상원D후",
      "상원R후",
      "상원기타후",
      "상원민주순증",
      "상원지배",
      "여당결과",
      "당명시나리오",
      "현재시나리오",
      "비고",
    ]),
  ];
  for (const e of payload.elections) {
    rows.push([
      e.id,
      e.date,
      e.president_ko,
      e.president,
      e.president_party,
      intval(e.congress),
      intval(e.house_before.d),
      intval(e.house_before.r),
      intval(e.house_before.other ?? 0),
      intval(e.house_after.d),
      intval(e.house_after.r),
      intval(e.house_after.other ?? 0),
      intval(netDemSeats(e.house_before, e.house_after)),
      partyKo(e.house_control),
      intval(e.senate_before.d),
      intval(e.senate_before.r),
      intval(e.senate_before.other ?? 0),
      intval(e.senate_after.d),
      intval(e.senate_after.r),
      intval(e.senate_after.other ?? 0),
      intval(netDemSeats(e.senate_before, e.senate_after)),
      partyKo(e.senate_control),
      incumbentLabel(e),
      controlLabel(e.house_control, e.senate_control),
      electionMatches(e, opts.scenario) ? "Y" : "N",
      e.note,
    ]);
  }
  return {
    name: "Elections",
    rows,
    widths: [8, 12, 12, 22, 10, 8, 10, 10, 10, 10, 10, 10, 12, 10, 10, 10, 10, 10, 10, 10, 12, 10, 22, 22, 12, 48],
    freezeRows: 1,
    autoFilter: true,
  };
}

function scenariosSheet(payload: MidtermStudyPayload, grouping: GroupingId): SheetSpec {
  const rows: CellInput[][] = [
    headerRow(["시나리오ID", "분류", "라벨", "설명", "n", "해당연도"]),
  ];
  for (const meta of SCENARIO_META) {
    const sc = payload.scenarios[meta.id];
    const kind =
      meta.id === "all" ? "공통" : meta.id.startsWith("inc_") ? "여당·야당" : "민주·공화";
    const highlight = scenariosForGrouping(grouping).some((s) => s.id === meta.id) ? kind : `${kind} (다른 분류)`;
    rows.push([
      meta.id,
      highlight,
      meta.label,
      meta.sub,
      intval(sc?.n ?? 0),
      (sc?.elections || []).map((e) => e.id).join(", "),
    ]);
  }
  return { name: "Scenarios", rows, widths: [16, 18, 26, 28, 8, 48], freezeRows: 1, autoFilter: true };
}

function horizonSheets(payload: MidtermStudyPayload): { market: SheetSpec; sector: SheetSpec } {
  const hLabels = HORIZON_META.flatMap((h) => [`${h.label} 리베이스`, `${h.label} 수익률(%)`]);
  const marketRows: CellInput[][] = [
    headerRow(["시나리오ID", "시나리오", "자산ID", "지수", "n", ...hLabels]),
  ];
  const sectorRows: CellInput[][] = [
    headerRow(["시나리오ID", "시나리오", "자산ID", "업종", "French", "n", ...hLabels]),
  ];
  for (const meta of SCENARIO_META) {
    const sc = payload.scenarios[meta.id];
    if (!sc) continue;
    for (const asset of sc.assets) {
      const cells: CellInput[] = [meta.id, meta.label, asset.id, asset.label];
      if (asset.kind === "sector") {
        cells.push(SECTOR_SPECS.find((s) => s.id === asset.id)?.french || "");
      }
      cells.push(intval(asset.n));
      for (const h of HORIZON_META) {
        const cell = pickHorizon(asset, h.days);
        cells.push(num(cell?.rebased ?? null), num(cell?.return_pct ?? null));
      }
      if (asset.kind === "market") marketRows.push(cells);
      else sectorRows.push(cells);
    }
  }
  return {
    market: {
      name: "Market_Horizons",
      rows: marketRows,
      widths: [16, 26, 12, 14, 8, 14, 14, 14, 14, 14, 14, 14, 14],
      freezeRows: 1,
      autoFilter: true,
    },
    sector: {
      name: "Sector_Horizons",
      rows: sectorRows,
      widths: [16, 26, 12, 14, 12, 8, 14, 14, 14, 14, 14, 14, 14, 14],
      freezeRows: 1,
      autoFilter: true,
    },
  };
}

function eventHorizonsSheet(payload: MidtermStudyPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow([
      "연도",
      "선거일",
      "t0",
      "대통령",
      "여당결과",
      "당명시나리오",
      "자산ID",
      "자산",
      "종류",
      "기간(일)",
      "기간",
      "리베이스",
      "수익률(%)",
    ]),
  ];
  const catalog = payload.elections;
  const all = payload.scenarios.all;
  for (const ev of all?.elections || []) {
    const row = catalog.find((e) => e.date === ev.date);
    for (const asset of ev.assets) {
      const spec =
        MARKET_SPECS.find((s) => s.id === asset.asset_id) ||
        SECTOR_SPECS.find((s) => s.id === asset.asset_id);
      for (const h of asset.horizons) {
        const label = HORIZON_META.find((m) => m.days === h.days)?.label || `+${h.days}d`;
        rows.push([
          ev.id,
          ev.date,
          ev.t0_date || asset.t0_date || "",
          row ? `${row.president_ko} (${row.president_party})` : "",
          row ? incumbentLabel(row) : "",
          row ? controlLabel(row.house_control, row.senate_control) : "",
          asset.asset_id,
          spec?.label || asset.asset_id,
          spec?.kind || "",
          intval(h.days),
          label,
          num(h.rebased),
          num(h.return_pct),
        ]);
      }
    }
  }
  return {
    name: "Event_Horizons",
    rows,
    widths: [8, 12, 12, 18, 24, 22, 12, 14, 10, 10, 10, 12, 12],
    freezeRows: 1,
    autoFilter: true,
  };
}

function pathSheet(
  payload: MidtermStudyPayload,
  kind: "market" | "sector",
  name: string,
): SheetSpec {
  const rows: CellInput[][] = [
    headerRow(["시나리오ID", "시나리오", "자산ID", "자산", "n", "t", "리베이스"]),
  ];
  for (const meta of SCENARIO_META) {
    const sc = payload.scenarios[meta.id];
    if (!sc) continue;
    for (const asset of sc.assets) {
      if (asset.kind !== kind) continue;
      for (const p of asset.path) {
        rows.push([meta.id, meta.label, asset.id, asset.label, intval(asset.n), intval(p.t), num(p.v)]);
      }
    }
  }
  return {
    name,
    rows,
    widths: [16, 26, 12, 14, 8, 8, 12],
    freezeRows: 1,
    autoFilter: true,
  };
}

function overlaySheet(payload: MidtermStudyPayload): SheetSpec {
  const rows: CellInput[][] = [headerRow(["시나리오ID", "시나리오", "연도", "t", "리베이스"])];
  for (const meta of SCENARIO_META) {
    const sc = payload.scenarios[meta.id];
    if (!sc) continue;
    for (const ov of sc.spx_overlay || []) {
      for (const p of ov.path) {
        rows.push([meta.id, meta.label, ov.year, intval(p.t), num(p.v)]);
      }
    }
  }
  return {
    name: "SPX_Overlays",
    rows,
    widths: [16, 26, 10, 8, 12],
    freezeRows: 1,
    autoFilter: true,
  };
}

function buildChartData(payload: MidtermStudyPayload, opts: MidtermExcelOpts): {
  sheet: SheetSpec;
  charts: ChartSpec[];
} {
  const sc = payload.scenarios[opts.scenario];
  const meta = scenarioMeta(opts.scenario) ?? ALL_SCENARIO;
  const rows: CellInput[][] = [];
  const charts: ChartSpec[] = [];

  const marketAssets = MARKET_SPECS.map((spec) => sc?.assets.find((a) => a.id === spec.id)).filter(
    (a): a is NonNullable<typeof a> => Boolean(a && a.path.length),
  );
  const overlays =
    sc && sc.n > 0 && sc.n <= OVERLAY_N_MAX && opts.scenario !== "all" ? sc.spx_overlay || [] : [];

  const tVals = unionT([
    ...marketAssets.map((a) => a.path),
    ...overlays.map((o) => o.path),
  ]);

  const pathHeaderRow = rows.length + 1;
  const pathHeaders: CellInput[] = [
    { v: "t", t: "header" },
    ...marketAssets.map((a) => ({ v: a.label, t: "header" as const })),
    ...overlays.map((o) => ({ v: `S&P ${o.year}`, t: "header" as const })),
  ];
  rows.push(pathHeaders);
  const marketMaps = marketAssets.map((a) => pathMap(a.path));
  const overlayMaps = overlays.map((o) => pathMap(o.path));
  const pathValueCols: Array<Array<number | null>> = [
    ...marketAssets.map(() => [] as Array<number | null>),
    ...overlays.map(() => [] as Array<number | null>),
  ];
  for (const t of tVals) {
    const row: CellInput[] = [intval(t)];
    marketMaps.forEach((m, i) => {
      const v = m.get(t);
      row.push(num(v ?? null));
      pathValueCols[i]!.push(v ?? null);
    });
    overlayMaps.forEach((m, i) => {
      const v = m.get(t);
      row.push(num(v ?? null));
      pathValueCols[marketAssets.length + i]!.push(v ?? null);
    });
    rows.push(row);
  }
  const pathFirst = pathHeaderRow + 1;
  const pathLast = pathHeaderRow + tVals.length;

  if (tVals.length && marketAssets.length) {
    charts.push({
      type: "line",
      title: `지수 경로 · ${meta.label} (t=0 → 100)`,
      yTitle: "리베이스",
      catRef: sheetFormula(CHART_SHEET, a1Range(0, pathFirst, 0, pathLast)),
      cats: { kind: "num", values: tVals },
      series: marketAssets.map((a, i) =>
        seriesFromCol({
          name: a.label,
          headerRow: pathHeaderRow,
          col: i + 1,
          first: pathFirst,
          last: pathLast,
          values: pathValueCols[i] || [],
          color: MARKET_COLOR[a.id] || "64748B",
        }),
      ),
      from: { col: 0, row: 0 },
      to: { col: 0, row: 0 },
    });
  }
  if (tVals.length && overlays.length) {
    const overlaySeries: ChartSeries[] = [
      ...(marketAssets[0]
        ? [
            seriesFromCol({
              name: marketAssets[0].label,
              headerRow: pathHeaderRow,
              col: 1,
              first: pathFirst,
              last: pathLast,
              values: pathValueCols[0] || [],
              color: MARKET_COLOR.spx,
            }),
          ]
        : []),
      ...overlays.map((o, i) =>
        seriesFromCol({
          name: `S&P ${o.year}`,
          headerRow: pathHeaderRow,
          col: marketAssets.length + 1 + i,
          first: pathFirst,
          last: pathLast,
          values: pathValueCols[marketAssets.length + i] || [],
          color: MARKET_COLOR.spx,
          alpha: 0.32,
          width: 12000,
        }),
      ),
    ];
    charts.push({
      type: "line",
      title: `S&P 500 연도별 · ${meta.label}`,
      yTitle: "리베이스",
      catRef: sheetFormula(CHART_SHEET, a1Range(0, pathFirst, 0, pathLast)),
      cats: { kind: "num", values: tVals },
      series: overlaySeries,
      from: { col: 0, row: 0 },
      to: { col: 0, row: 0 },
    });
  }

  rows.push([]);
  rows.push([]);

  const sectorAssets = (sc?.assets || []).filter((a) => a.kind === "sector");
  const sectorRows = sectorAssets
    .map((a) => {
      const h3 = pickHorizon(a, 90);
      return {
        asset: a,
        french: SECTOR_SPECS.find((s) => s.id === a.id)?.french || "",
        rets: HORIZON_META.map((h) => pickHorizon(a, h.days)?.return_pct ?? null),
        n: a.n,
        ret3: h3?.return_pct ?? null,
      };
    })
    .filter((r) => r.rets.some((v) => v != null))
    .sort((a, b) => (b.ret3 ?? -Infinity) - (a.ret3 ?? -Infinity));

  const sectorHeaderRow = rows.length + 1;
  rows.push(
    headerRow([
      "업종",
      "French",
      "n",
      ...HORIZON_META.map((h) => `${h.label} 수익률(%)`),
      "+3개월 양",
      "+3개월 음",
    ]),
  );
  const sectorNames: string[] = [];
  const horizonVals: Array<Array<number | null>> = HORIZON_META.map(() => []);
  const pos3: Array<number | null> = [];
  const neg3: Array<number | null> = [];
  for (const row of sectorRows) {
    sectorNames.push(row.asset.label);
    const pos = row.ret3 != null && row.ret3 >= 0 ? row.ret3 : null;
    const neg = row.ret3 != null && row.ret3 < 0 ? row.ret3 : null;
    pos3.push(pos);
    neg3.push(neg);
    row.rets.forEach((v, i) => horizonVals[i]!.push(v));
    rows.push([
      row.asset.label,
      row.french,
      intval(row.n),
      ...row.rets.map((v) => num(v)),
      num(pos),
      num(neg),
    ]);
  }
  const sectorFirst = sectorHeaderRow + 1;
  const sectorLast = sectorHeaderRow + sectorRows.length;
  const posCol = 3 + HORIZON_META.length;
  const negCol = posCol + 1;

  if (sectorRows.length) {
    const barSeries: ChartSeries[] = [];
    if (pos3.some((v) => v != null)) {
      barSeries.push(
        seriesFromCol({
          name: "+3개월 양",
          headerRow: sectorHeaderRow,
          col: posCol,
          first: sectorFirst,
          last: sectorLast,
          values: pos3,
          color: POS_COLOR,
        }),
      );
    }
    if (neg3.some((v) => v != null)) {
      barSeries.push(
        seriesFromCol({
          name: "+3개월 음",
          headerRow: sectorHeaderRow,
          col: negCol,
          first: sectorFirst,
          last: sectorLast,
          values: neg3,
          color: NEG_COLOR,
        }),
      );
    }
    if (barSeries.length) {
      charts.push({
        type: "bar",
        title: `업종 +3개월 · ${meta.label} (French 12산업)`,
        yTitle: "수익률(%)",
        catRef: sheetFormula(CHART_SHEET, a1Range(0, sectorFirst, 0, sectorLast)),
        cats: { kind: "str", values: sectorNames },
        series: barSeries,
        from: { col: 0, row: 0 },
        to: { col: 0, row: 0 },
      });
    }
    charts.push({
      type: "col",
      title: `업종 기간별 · ${meta.label}`,
      yTitle: "수익률(%)",
      catRef: sheetFormula(CHART_SHEET, a1Range(0, sectorFirst, 0, sectorLast)),
      cats: { kind: "str", values: sectorNames },
      series: HORIZON_META.map((h, i) =>
        seriesFromCol({
          name: h.label,
          headerRow: sectorHeaderRow,
          col: 3 + i,
          first: sectorFirst,
          last: sectorLast,
          values: horizonVals[i] || [],
          color: HORIZON_COLOR[i] || "64748B",
        }),
      ),
      from: { col: 0, row: 0 },
      to: { col: 0, row: 0 },
    });
  }

  rows.push([]);
  rows.push([]);

  const compareMetas = scenariosForGrouping(opts.grouping).filter((m) => {
    const asset = payload.scenarios[m.id]?.assets.find((a) => a.id === "spx");
    return Boolean(asset && asset.path.length);
  });
  const comparePaths = compareMetas.map(
    (m) => payload.scenarios[m.id]?.assets.find((a) => a.id === "spx")?.path || [],
  );
  const compareT = unionT(comparePaths);
  const compareHeaderRow = rows.length + 1;
  rows.push(headerRow(["t", ...compareMetas.map((m) => m.label)]));
  const compareCols: Array<Array<number | null>> = compareMetas.map(() => []);
  const compareMaps = comparePaths.map((p) => pathMap(p));
  for (const t of compareT) {
    const row: CellInput[] = [intval(t)];
    compareMaps.forEach((m, i) => {
      const v = m.get(t);
      row.push(num(v ?? null));
      compareCols[i]!.push(v ?? null);
    });
    rows.push(row);
  }
  const compareFirst = compareHeaderRow + 1;
  const compareLast = compareHeaderRow + compareT.length;
  if (compareT.length && compareMetas.length) {
    charts.push({
      type: "line",
      title: `S&P 500 시나리오 비교 · ${GROUPING_META.find((g) => g.id === opts.grouping)?.label || ""}`,
      yTitle: "리베이스",
      catRef: sheetFormula(CHART_SHEET, a1Range(0, compareFirst, 0, compareLast)),
      cats: { kind: "num", values: compareT },
      series: compareMetas.map((m, i) =>
        seriesFromCol({
          name: m.label,
          headerRow: compareHeaderRow,
          col: i + 1,
          first: compareFirst,
          last: compareLast,
          values: compareCols[i] || [],
          color: COMPARE_COLOR[i] || "64748B",
        }),
      ),
      from: { col: 0, row: 0 },
      to: { col: 0, row: 0 },
    });
  }

  const slots = chartSlots(charts.length);
  charts.forEach((c, i) => {
    const slot = slots[i];
    if (slot) {
      c.from = slot.from;
      c.to = slot.to;
    }
  });

  return {
    sheet: {
      name: CHART_SHEET,
      rows,
      widths: Array.from({ length: 16 }, (_, i) => (i === 0 ? 14 : 16)),
      freezeRows: 1,
    },
    charts,
  };
}

export function midtermStudyExcelFilename(scenario: ScenarioId): string {
  return `savvyetf-midterm-study-${scenario}.xlsx`;
}

export function buildMidtermStudyExcel(
  payload: MidtermStudyPayload,
  opts: MidtermExcelOpts,
): Buffer {
  const horizons = horizonSheets(payload);
  const chart = buildChartData(payload, opts);
  const meta = scenarioMeta(opts.scenario) ?? ALL_SCENARIO;
  const sc = payload.scenarios[opts.scenario];
  const sheets: SheetSpec[] = [
    readmeSheet(payload, opts),
    {
      name: "Charts",
      rows: [
        ["SavvyETF 중간선거 이벤트 스터디"],
        [
          `${meta.label} · 표본 ${sc?.n ?? 0}회 · 생성 ${payload.generated_at || ""}`,
        ],
        ["차트는 엑셀 기본 차트이며 ChartData 시트 값을 참조합니다. 데이터 시트를 수정하면 차트가 따라갑니다."],
      ],
      widths: [28, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22],
      charts: chart.charts,
    },
    chart.sheet,
    electionsSheet(payload, opts),
    scenariosSheet(payload, opts.grouping),
    horizons.market,
    horizons.sector,
    eventHorizonsSheet(payload),
    pathSheet(payload, "market", "Market_Paths"),
    pathSheet(payload, "sector", "Sector_Paths"),
    overlaySheet(payload),
  ];
  return buildXlsx(sheets, {
    title: `US Midterm Event Study — ${meta.label}`,
    creator: "SavvyETF",
  });
}

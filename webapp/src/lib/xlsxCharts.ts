/**
 * Workbook writer with native Excel charts.
 *
 * SheetJS community edition writes cells but not charts, so the sheets are written
 * with SheetJS and DrawingML chart parts are injected into the zip afterwards.
 * Charts reference sheet ranges (no cached values), so Excel redraws them from the
 * cells and the user can restyle or re-range them like any hand-made chart.
 */
import type * as XLSXNS from "xlsx";

type XLSXModule = typeof XLSXNS;

export type Cell = string | number | null | undefined;

export type XlsxChart = {
  type: "line" | "bar";
  title: string;
  /** 0-based column holding category labels (x axis). */
  cat: number;
  /** 0-based value columns; the series name comes from the header row. */
  series: number[];
  /** 0-based header row; data runs from headerRow+1 to lastRow (inclusive, 0-based). */
  headerRow?: number;
  lastRow?: number;
  /** Top-left anchor (0-based col/row) and size in cells. Defaults: right of the table. */
  at?: { col: number; row: number };
  size?: { cols: number; rows: number };
  yFormat?: string;
  colors?: string[];
};

export type XlsxSheet = {
  name: string;
  rows: Cell[][];
  /** Column widths in characters. */
  widths?: number[];
  /** Number formats by 0-based column, applied to numeric cells below the header. */
  formats?: Record<number, string>;
  headerRow?: number;
  autofilter?: boolean;
  charts?: XlsxChart[];
};

const PALETTE = ["E5484D", "2F7BEA", "2BA36B", "E39B14", "8E5BD9", "6B7785", "D9478F", "1C9FB0"];
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const REL_CHART = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";
const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);

/** Excel sheet names: ≤31 chars, no []:*?/\ and unique within the workbook. */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 31 - String(i).length - 1)}_${i}`;
  used.add(out.toLowerCase());
  return out;
}

function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const ref = (sheet: string, c: number, r0: number, r1?: number) => {
  const q = `'${sheet.replace(/'/g, "''")}'`;
  return r1 === undefined ? `${q}!$${colName(c)}$${r0 + 1}` : `${q}!$${colName(c)}$${r0 + 1}:$${colName(c)}$${r1 + 1}`;
};

function chartXml(sheet: string, ch: XlsxChart, headerRow: number, lastRow: number): string {
  const first = headerRow + 1;
  const sers = ch.series
    .map((col, i) => {
      const color = (ch.colors?.[i] ?? PALETTE[i % PALETTE.length]).replace("#", "");
      const sp =
        ch.type === "line"
          ? `<c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
          : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`;
      return (
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
        `<c:tx><c:strRef><c:f>${esc(ref(sheet, col, headerRow))}</c:f></c:strRef></c:tx>${sp}` +
        `<c:cat><c:strRef><c:f>${esc(ref(sheet, ch.cat, first, lastRow))}</c:f></c:strRef></c:cat>` +
        `<c:val><c:numRef><c:f>${esc(ref(sheet, col, first, lastRow))}</c:f></c:numRef></c:val>` +
        (ch.type === "line" ? `<c:smooth val="0"/>` : "") +
        `</c:ser>`
      );
    })
    .join("");
  const plot =
    ch.type === "line"
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>`
      : `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers}<c:gapWidth val="80"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>`;
  const txt = (sz: number, b = false) =>
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"${b ? ' b="1"' : ""}/></a:pPr><a:endParaRPr lang="ko-KR"/></a:p></c:txPr>`;
  const yFmt = ch.yFormat ? `<c:numFmt formatCode="${esc(ch.yFormat)}" sourceLinked="0"/>` : `<c:numFmt formatCode="General" sourceLinked="1"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="ko-KR" sz="1200" b="1"/><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}` +
    `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>` +
    `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>${txt(900)}` +
    `<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>` +
    `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>${yFmt}` +
    `<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${txt(900)}<c:crossAx val="5001"/><c:crosses val="autoZero"/>` +
    `<c:crossBetween val="${ch.type === "bar" ? "between" : "midCat"}"/></c:valAx>` +
    `</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txt(900)}</c:legend>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
  );
}

function drawingXml(anchors: { from: [number, number]; to: [number, number]; rid: string; id: number; name: string }[]): string {
  const body = anchors
    .map(
      (a) =>
        `<xdr:twoCellAnchor editAs="oneCell">` +
        `<xdr:from><xdr:col>${a.from[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.from[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${a.to[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.to[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${a.id}" name="${esc(a.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${a.rid}"/></a:graphicData></a:graphic>` +
        `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${body}</xdr:wsDr>`;
}

const rels = (items: { id: string; type: string; target: string }[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  items.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join("") +
  `</Relationships>`;

/* eslint-disable @typescript-eslint/no-explicit-any -- SheetJS ships CFB untyped */
// CFB.find only resolves nested zip paths with a leading slash.
function readEntry(CFB: any, zip: any, path: string): string | null {
  const e = CFB.find(zip, `/${path}`);
  return e?.content ? new TextDecoder().decode(e.content as Uint8Array) : null;
}

function writeEntry(CFB: any, zip: any, path: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  const e = CFB.find(zip, `/${path}`);
  if (e) {
    e.content = bytes;
    e.size = bytes.length;
  } else CFB.utils.cfb_add(zip, `/${path}`, bytes);
}

/** Builds the .xlsx bytes. `XLSX` is passed in so callers can lazy-load SheetJS. */
export function buildXlsxWithCharts(XLSX: XLSXModule, sheets: XlsxSheet[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  sheets.forEach((s, i) => {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map((v) => (v === undefined ? null : v))));
    if (s.widths) ws["!cols"] = s.widths.map((wch) => ({ wch }));
    if (s.formats) {
      const hr = s.headerRow ?? 0;
      for (const [c, z] of Object.entries(s.formats)) {
        for (let r = hr + 1; r < s.rows.length; r++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c: Number(c) })];
          if (cell && cell.t === "n") cell.z = z;
        }
      }
    }
    if (s.autofilter && s.rows.length > 1) {
      const lastCol = Math.max(...s.rows.map((r) => r.length)) - 1;
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: s.headerRow ?? 0, c: 0 }, e: { r: s.rows.length - 1, c: lastCol } }) };
    }
    XLSX.utils.book_append_sheet(wb, ws, names[i]);
  });
  const base = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
  if (!sheets.some((s) => s.charts?.length)) return new Uint8Array(base);

  const CFB = (XLSX as any).CFB;
  const zip = CFB.read(new Uint8Array(base), { type: "array" });
  let ct: string = readEntry(CFB, zip, "[Content_Types].xml") ?? "";
  if (!ct) throw new Error("xlsx: [Content_Types].xml not found");
  let chartNo = 0;
  let drawingNo = 0;
  sheets.forEach((s, i) => {
    if (!s.charts?.length) return;
    drawingNo += 1;
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`;
    const hr = s.headerRow ?? 0;
    const tableCols = Math.max(1, ...s.rows.map((r) => r.length));
    const anchors: Parameters<typeof drawingXml>[0] = [];
    const drawRels: { id: string; type: string; target: string }[] = [];
    let nextRow = hr;
    s.charts.forEach((ch, k) => {
      chartNo += 1;
      const headerRow = ch.headerRow ?? hr;
      const lastRow = ch.lastRow ?? s.rows.length - 1;
      const size = ch.size ?? { cols: 9, rows: 18 };
      const at = ch.at ?? { col: tableCols + 1, row: nextRow };
      nextRow = at.row + size.rows + 1;
      writeEntry(CFB, zip, `xl/charts/chart${chartNo}.xml`, chartXml(names[i], ch, headerRow, lastRow));
      ct = ct.replace("</Types>", `<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="${CT_CHART}"/></Types>`);
      const rid = `rId${k + 1}`;
      drawRels.push({ id: rid, type: REL_CHART, target: `../charts/chart${chartNo}.xml` });
      anchors.push({ from: [at.col, at.row], to: [at.col + size.cols, at.row + size.rows], rid, id: k + 2, name: `Chart ${k + 1}` });
    });
    writeEntry(CFB, zip, `xl/drawings/drawing${drawingNo}.xml`, drawingXml(anchors));
    writeEntry(CFB, zip, `xl/drawings/_rels/drawing${drawingNo}.xml.rels`, rels(drawRels));
    ct = ct.replace("</Types>", `<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="${CT_DRAWING}"/></Types>`);

    const relPath = `xl/worksheets/_rels/sheet${i + 1}.xml.rels`;
    const existing = readEntry(CFB, zip, relPath);
    const relId = "rIdDrawing1";
    const relXml = `<Relationship Id="${relId}" Type="${REL_DRAWING}" Target="../drawings/drawing${drawingNo}.xml"/>`;
    writeEntry(CFB, zip, relPath, existing ? existing.replace("</Relationships>", `${relXml}</Relationships>`) : rels([{ id: relId, type: REL_DRAWING, target: `../drawings/drawing${drawingNo}.xml` }]));

    let xml: string = readEntry(CFB, zip, sheetPath) ?? "";
    if (!xml) throw new Error(`xlsx: ${sheetPath} not found`);
    if (!/xmlns:r=/.test(xml.slice(0, 600))) xml = xml.replace("<worksheet ", `<worksheet xmlns:r="${NS_R}" `);
    const tag = `<drawing r:id="${relId}"/>`;
    const before = xml.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>/]/);
    xml = before >= 0 ? `${xml.slice(0, before)}${tag}${xml.slice(before)}` : xml.replace("</worksheet>", `${tag}</worksheet>`);
    writeEntry(CFB, zip, sheetPath, xml);
  });
  writeEntry(CFB, zip, "[Content_Types].xml", ct);
  const out = CFB.write(zip, { fileType: "zip", type: "array", compression: true });
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Browser download of a built workbook. */
export function downloadXlsx(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function kstStamp(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16).replace(/[-: ]/g, "").replace(/^(\d{8})(\d{4})$/, "$1_$2");
}

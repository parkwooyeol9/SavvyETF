import { colLetter, packZip, xmlEscape, type ZipFile } from "@/lib/xlsxPack";
export { a1, a1Range, colLetter, sheetFormula } from "@/lib/xlsxPack";

export type Scalar = string | number | boolean | null | undefined;
export type CellStyle = "header" | "num" | "int" | "text";
export type CellObject = { v: Scalar; t?: CellStyle };
export type CellInput = Scalar | CellObject;

export type ChartSeries = {
  name: string;
  nameRef: string;
  valRef: string;
  values: Array<number | null>;
  color: string;
  alpha?: number;
  width?: number;
};

export type ChartSpec = {
  type: "line" | "bar" | "col";
  title: string;
  yTitle?: string;
  catRef: string;
  cats: { kind: "num"; values: number[] } | { kind: "str"; values: string[] };
  series: ChartSeries[];
  from: { col: number; row: number };
  to: { col: number; row: number };
};

export type SheetSpec = {
  name: string;
  rows: CellInput[][];
  widths?: number[];
  freezeRows?: number;
  autoFilter?: boolean;
  charts?: ChartSpec[];
};

export type WorkbookMeta = {
  title: string;
  creator?: string;
  created?: Date;
};

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_CHART = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

function asCell(input: CellInput): CellObject {
  if (input != null && typeof input === "object" && "v" in input) return input;
  return { v: input };
}

function styleIndex(t?: CellStyle): number | null {
  if (t === "header") return 1;
  if (t === "num") return 2;
  if (t === "int") return 3;
  return null;
}

function xmlHeader(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

function relsXml(
  rels: Array<{ id: string; type: string; target: string; targetMode?: string }>,
): string {
  const body = rels
    .map((r) => {
      const mode = r.targetMode ? ` TargetMode="${r.targetMode}"` : "";
      return `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEscape(r.target)}"${mode}/>`;
    })
    .join("");
  return `${xmlHeader()}<Relationships xmlns="${NS_PKG_REL}">${body}</Relationships>`;
}

function isoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function stylesXml(): string {
  return `${xmlHeader()}<styleSheet xmlns="${NS_MAIN}">
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function cellXml(col0: number, row1: number, input: CellInput): string {
  const cell = asCell(input);
  if (cell.v == null || cell.v === "") return "";
  const ref = `${colLetter(col0)}${row1}`;
  const s = styleIndex(cell.t);
  const sAttr = s != null ? ` s="${s}"` : "";
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
    return `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`;
  }
  if (typeof cell.v === "boolean") {
    return `<c r="${ref}"${sAttr} t="b"><v>${cell.v ? 1 : 0}</v></c>`;
  }
  const text = xmlEscape(String(cell.v));
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function worksheetXml(sheet: SheetSpec, hasDrawing: boolean): string {
  const rows = sheet.rows;
  let maxCol = 0;
  const rowXml = rows.map((row, i) => {
    maxCol = Math.max(maxCol, row.length);
    const r = i + 1;
    const cells = row.map((c, j) => cellXml(j, r, c)).join("");
    return `<row r="${r}" spans="1:${Math.max(row.length, 1)}">${cells}</row>`;
  });
  const lastRow = Math.max(rows.length, 1);
  const lastCol = Math.max(maxCol, 1);
  const dim = `A1:${colLetter(lastCol - 1)}${lastRow}`;
  const widths =
    sheet.widths && sheet.widths.length
      ? sheet.widths
      : Array.from({ length: lastCol }, () => 16);
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const freeze = sheet.freezeRows
    ? `<sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`
    : `<sheetView workbookViewId="0"/>`;
  const filter =
    sheet.autoFilter && lastRow >= 1
      ? `<autoFilter ref="A1:${colLetter(lastCol - 1)}${lastRow}"/>`
      : "";
  const drawing = hasDrawing ? `<drawing r:id="rId1"/>` : "";
  return `${xmlHeader()}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
  <dimension ref="${dim}"/>
  <sheetViews>${freeze}</sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${cols}</cols>
  <sheetData>${rowXml.join("")}</sheetData>
  ${filter}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
  ${drawing}
</worksheet>`;
}

function cachePts(values: Array<string | number | null>): { count: number; xml: string } {
  const pts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || v === "") continue;
    pts.push(`<c:pt idx="${i}"><c:v>${xmlEscape(String(v))}</c:v></c:pt>`);
  }
  return { count: values.length, xml: pts.join("") };
}

function catXml(chart: ChartSpec): string {
  const cache = cachePts(chart.cats.values);
  if (chart.cats.kind === "num") {
    return `<c:numRef><c:f>${xmlEscape(chart.catRef)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${cache.count}"/>${cache.xml}</c:numCache></c:numRef>`;
  }
  return `<c:strRef><c:f>${xmlEscape(chart.catRef)}</c:f><c:strCache><c:ptCount val="${cache.count}"/>${cache.xml}</c:strCache></c:strRef>`;
}

function seriesXml(chart: ChartSpec, ser: ChartSeries, idx: number): string {
  const nameCache = `<c:strRef><c:f>${xmlEscape(ser.nameRef)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(ser.name)}</c:v></c:pt></c:strCache></c:strRef>`;
  const valCache = cachePts(ser.values);
  const alpha =
    ser.alpha != null
      ? `<a:alpha val="${Math.round(Math.min(1, Math.max(0, ser.alpha)) * 100000)}"/>`
      : "";
  const lnW = ser.width ?? (chart.type === "line" ? 25000 : 19050);
  const fill = `<a:solidFill><a:srgbClr val="${ser.color}">${alpha}</a:srgbClr></a:solidFill>`;
  const spPr =
    chart.type === "line"
      ? `<c:spPr><a:ln w="${lnW}">${fill}</a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
      : `<c:spPr>${fill}<a:ln><a:noFill/></a:ln></c:spPr>`;
  return `<c:ser>
    <c:idx val="${idx}"/>
    <c:order val="${idx}"/>
    <c:tx>${nameCache}</c:tx>
    ${spPr}
    <c:cat>${catXml(chart)}</c:cat>
    <c:val><c:numRef><c:f>${xmlEscape(ser.valRef)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${valCache.count}"/>${valCache.xml}</c:numCache></c:numRef></c:val>
    ${chart.type === "line" ? '<c:smooth val="0"/>' : ""}
  </c:ser>`;
}

function plotXml(chart: ChartSpec): string {
  const series = chart.series.map((s, i) => seriesXml(chart, s, i)).join("");
  const ax = `<c:axId val="1"/><c:axId val="2"/>`;
  if (chart.type === "line") {
    return `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:smooth val="0"/>${ax}</c:lineChart>`;
  }
  const dir = chart.type === "bar" ? "bar" : "col";
  return `<c:barChart><c:barDir val="${dir}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="80"/>${ax}</c:barChart>`;
}

function axisXml(chart: ChartSpec): string {
  const catPos = chart.type === "bar" ? "l" : "b";
  const valPos = chart.type === "bar" ? "b" : "l";
  const yTitle = chart.yTitle
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:r><a:rPr lang="ko-KR" sz="900"/><a:t>${xmlEscape(chart.yTitle)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
    : "";
  const crossBetween = chart.type === "line" ? "midCat" : "between";
  return `<c:catAx>
    <c:axId val="1"/>
    <c:scaling><c:orientation val="minMax"/></c:scaling>
    <c:delete val="0"/>
    <c:axPos val="${catPos}"/>
    <c:numFmt formatCode="General" sourceLinked="1"/>
    <c:majorTickMark val="out"/>
    <c:minorTickMark val="none"/>
    <c:tickLblPos val="nextTo"/>
    <c:crossAx val="2"/>
    <c:crosses val="autoZero"/>
    <c:auto val="1"/>
    <c:lblAlgn val="ctr"/>
    <c:lblOffset val="100"/>
  </c:catAx>
  <c:valAx>
    <c:axId val="2"/>
    <c:scaling><c:orientation val="minMax"/></c:scaling>
    <c:delete val="0"/>
    <c:axPos val="${valPos}"/>
    <c:majorGridlines/>
    ${yTitle}
    <c:numFmt formatCode="0.0" sourceLinked="0"/>
    <c:majorTickMark val="out"/>
    <c:minorTickMark val="none"/>
    <c:tickLblPos val="nextTo"/>
    <c:crossAx val="1"/>
    <c:crosses val="autoZero"/>
    <c:crossBetween val="${crossBetween}"/>
  </c:valAx>`;
}

function chartXml(chart: ChartSpec): string {
  return `${xmlHeader()}<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_A}" xmlns:r="${NS_REL}">
  <c:date1904 val="0"/>
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>
            <a:r><a:rPr lang="ko-KR" sz="1200" b="1"/><a:t>${xmlEscape(chart.title)}</a:t></a:r>
          </a:p>
        </c:rich>
      </c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      ${plotXml(chart)}
      ${axisXml(chart)}
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
    <c:showDLblsOverMax val="0"/>
  </c:chart>
</c:chartSpace>`;
}

function drawingXml(charts: ChartSpec[]): string {
  const anchors = charts
    .map((chart, i) => {
      const rid = `rId${i + 1}`;
      const id = i + 2;
      return `<xdr:twoCellAnchor editAs="oneCell">
        <xdr:from>
          <xdr:col>${chart.from.col}</xdr:col><xdr:colOff>0</xdr:colOff>
          <xdr:row>${chart.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff>
        </xdr:from>
        <xdr:to>
          <xdr:col>${chart.to.col}</xdr:col><xdr:colOff>0</xdr:colOff>
          <xdr:row>${chart.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff>
        </xdr:to>
        <xdr:graphicFrame macro="">
          <xdr:nvGraphicFramePr>
            <xdr:cNvPr id="${id}" name="Chart ${i + 1}"/>
            <xdr:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></xdr:cNvGraphicFramePr>
          </xdr:nvGraphicFramePr>
          <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
          <a:graphic>
            <a:graphicData uri="${NS_CHART}">
              <c:chart xmlns:c="${NS_CHART}" xmlns:r="${NS_REL}" r:id="${rid}"/>
            </a:graphicData>
          </a:graphic>
        </xdr:graphicFrame>
        <xdr:clientData/>
      </xdr:twoCellAnchor>`;
    })
    .join("");
  return `${xmlHeader()}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`;
}

function coreXml(meta: WorkbookMeta): string {
  const now = isoZ(meta.created || new Date());
  return `${xmlHeader()}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(meta.title)}</dc:title>
  <dc:creator>${xmlEscape(meta.creator || "SavvyETF")}</dc:creator>
  <cp:lastModifiedBy>${xmlEscape(meta.creator || "SavvyETF")}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml(sheetNames: string[]): string {
  const titles = sheetNames.map((n) => `<vt:lpstr>${xmlEscape(n)}</vt:lpstr>`).join("");
  return `${xmlHeader()}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>SavvyETF</Application>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector>
  </TitlesOfParts>
  <Company>SavvyETF</Company>
</Properties>`;
}

export function headerRow(labels: string[]): CellObject[] {
  return labels.map((v) => ({ v, t: "header" as const }));
}

export function num(v: number | null | undefined): CellObject {
  return { v: v == null || !Number.isFinite(v) ? null : v, t: "num" };
}

export function intval(v: number | null | undefined): CellObject {
  return { v: v == null || !Number.isFinite(v) ? null : v, t: "int" };
}

export function buildXlsx(sheets: SheetSpec[], meta: WorkbookMeta): Buffer {
  if (!sheets.length) throw new Error("workbook needs at least one sheet");
  const files: ZipFile[] = [];
  const overrides: string[] = [
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
  ];

  let drawingSeq = 0;
  let chartSeq = 0;
  const wbRels: Array<{ id: string; type: string; target: string }> = [];
  const sheetEntries = sheets.map((sheet, i) => {
    const sheetId = i + 1;
    const rId = `rId${sheetId}`;
    wbRels.push({
      id: rId,
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
      target: `worksheets/sheet${sheetId}.xml`,
    });
    const charts = (sheet.charts || []).filter((c) => c.series.length && c.cats.values.length);
    let drawingPath: string | null = null;
    if (charts.length) {
      drawingSeq += 1;
      drawingPath = `xl/drawings/drawing${drawingSeq}.xml`;
      const drawingRels = charts.map((chart, ci) => {
        chartSeq += 1;
        const chartPath = `xl/charts/chart${chartSeq}.xml`;
        files.push({ name: chartPath, data: chartXml(chart) });
        overrides.push(
          `<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
        );
        return {
          id: `rId${ci + 1}`,
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
          target: `../charts/chart${chartSeq}.xml`,
        };
      });
      files.push({ name: drawingPath, data: drawingXml(charts) });
      files.push({
        name: `xl/drawings/_rels/drawing${drawingSeq}.xml.rels`,
        data: relsXml(drawingRels),
      });
      overrides.push(
        `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      );
      files.push({
        name: `xl/worksheets/_rels/sheet${sheetId}.xml.rels`,
        data: relsXml([
          {
            id: "rId1",
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
            target: `../drawings/drawing${drawingSeq}.xml`,
          },
        ]),
      });
    }
    files.push({
      name: `xl/worksheets/sheet${sheetId}.xml`,
      data: worksheetXml(sheet, Boolean(drawingPath)),
    });
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${sheetId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
    return { name: sheet.name.slice(0, 31), rId, sheetId };
  });

  const stylesRid = `rId${sheets.length + 1}`;
  wbRels.push({
    id: stylesRid,
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
    target: "styles.xml",
  });

  const chartsSheetIdx = sheets.findIndex((s) => (s.charts || []).length);
  const activeTab = chartsSheetIdx >= 0 ? chartsSheetIdx : 0;
  const wb = `${xmlHeader()}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
  <fileVersion appName="xl"/>
  <workbookPr/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="16000" activeTab="${activeTab}"/></bookViews>
  <sheets>
    ${sheetEntries
      .map((s) => `<sheet name="${xmlEscape(s.name)}" sheetId="${s.sheetId}" r:id="${s.rId}"/>`)
      .join("")}
  </sheets>
  <calcPr calcId="0"/>
</workbook>`;

  files.push({ name: "xl/workbook.xml", data: wb });
  files.push({ name: "xl/_rels/workbook.xml.rels", data: relsXml(wbRels) });
  files.push({ name: "xl/styles.xml", data: stylesXml() });
  files.push({ name: "docProps/core.xml", data: coreXml(meta) });
  files.push({ name: "docProps/app.xml", data: appXml(sheetEntries.map((s) => s.name)) });
  files.push({
    name: "_rels/.rels",
    data: relsXml([
      {
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        target: "xl/workbook.xml",
      },
      {
        id: "rId2",
        type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        target: "docProps/core.xml",
      },
      {
        id: "rId3",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
        target: "docProps/app.xml",
      },
    ]),
  });
  files.push({
    name: "[Content_Types].xml",
    data: `${xmlHeader()}<Types xmlns="${NS_CT}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${overrides.join("")}
</Types>`,
  });

  return packZip(files);
}

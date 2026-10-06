"""openpyxl 로 만든 시트를 '원본 xlsx 패키지'에 그대로 끼워 넣는다.

openpyxl 로 원본을 열었다 저장하면 Datastream DSGRID 메타데이터(customProperty1.bin)와
조건부서식 확장(extLst)이 사라진다. 그래서 원본 파일은 바이트 그대로 두고,
새 시트 XML · 관계 · 콘텐츠타입 · 스타일 몇 개만 추가한다.
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.formula import ArrayFormula

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WS_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
WS_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"


def _append(xml: str, tag: str, items: list[str]) -> tuple[str, int]:
    """<tag count="n"> ... </tag> 끝에 items 추가. 첫 추가 항목의 인덱스 반환."""
    m = re.search(rf"<{tag} count=\"(\d+)\"([^>]*)>", xml)
    n = int(m.group(1))
    xml = xml[:m.start()] + f'<{tag} count="{n + len(items)}"{m.group(2)}>' + xml[m.end():]
    end = xml.index(f"</{tag}>", m.start())
    xml = xml[:end] + "".join(items) + xml[end:]
    return xml, n


def _styles(xml: str) -> tuple[str, dict]:
    xml, f0 = _append(xml, "fonts", [
        '<font><b/><sz val="11"/><color theme="1"/><name val="맑은 고딕"/><family val="2"/><scheme val="minor"/></font>',
        '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/><family val="2"/><scheme val="minor"/></font>',
        '<font><b/><sz val="14"/><color theme="1"/><name val="맑은 고딕"/><family val="2"/><scheme val="minor"/></font>',
    ])
    xml, fl0 = _append(xml, "fills", [
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill>',
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>',
    ])
    xml, x0 = _append(xml, "cellXfs", [
        f'<xf numFmtId="0" fontId="{f0}" fillId="0" borderId="0" xfId="0" applyFont="1"/>',                       # bold
        f'<xf numFmtId="0" fontId="{f0 + 1}" fillId="{fl0}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',  # header
        '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',                   # 0.00
        f'<xf numFmtId="0" fontId="0" fillId="{fl0 + 1}" borderId="0" xfId="0" applyFill="1"/>',                 # input
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>',  # wrap
        f'<xf numFmtId="0" fontId="{f0 + 2}" fillId="0" borderId="0" xfId="0" applyFont="1"/>',                  # title
    ])
    return xml, {"bold": x0, "hdr": x0 + 1, "num": x0 + 2, "inp": x0 + 3, "wrap": x0 + 4, "title": x0 + 5}


def _style_of(cell, S) -> int | None:
    fill = cell.fill.fgColor.rgb if cell.fill and cell.fill.fill_type == "solid" else None
    if fill and str(fill).endswith("1F2937"):
        return S["hdr"]
    if fill and str(fill).endswith("FEF3C7"):
        return S["inp"]
    if cell.font is not None and cell.font.b and (cell.font.sz or 11) >= 14:
        return S["title"]
    if cell.font is not None and cell.font.b:
        return S["bold"]
    if cell.alignment is not None and cell.alignment.wrap_text:
        return S["wrap"]
    if cell.number_format == "0.00":
        return S["num"]
    return None


def _sheet_xml(ws, S) -> str:
    out = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="{NS_MAIN}" xmlns:r="{NS_R}">']
    pane = ""
    if ws.freeze_panes:
        from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
        col, row = coordinate_from_string(ws.freeze_panes)
        xs, ys = column_index_from_string(col) - 1, row - 1
        pane = (f'<pane xSplit="{xs}" ySplit="{ys}" topLeftCell="{ws.freeze_panes}" activePane="bottomRight" state="frozen"/>'
                f'<selection pane="bottomRight"/>')
    out.append(f'<sheetViews><sheetView workbookViewId="0">{pane}</sheetView></sheetViews>')
    out.append('<sheetFormatPr defaultRowHeight="16.5"/>')
    widths = {k: v.width for k, v in ws.column_dimensions.items() if v.width}
    if widths:
        from openpyxl.utils.cell import column_index_from_string
        cols = sorted((column_index_from_string(k), w) for k, w in widths.items())
        out.append("<cols>" + "".join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i, w in cols) + "</cols>")
    out.append("<sheetData>")
    for row in ws.iter_rows():
        cells = []
        for c in row:
            v = c.value
            st = _style_of(c, S)
            s_attr = f' s="{st}"' if st is not None else ""
            if v is None:
                if st is not None:
                    cells.append(f'<c r="{c.coordinate}"{s_attr}/>')
                continue
            if isinstance(v, ArrayFormula):
                cells.append(f'<c r="{c.coordinate}"{s_attr}><f t="array" ref="{v.ref}">{escape(v.text.lstrip("="))}</f></c>')
            elif isinstance(v, str) and v.startswith("="):
                cells.append(f'<c r="{c.coordinate}"{s_attr}><f>{escape(v[1:])}</f></c>')
            elif isinstance(v, bool):
                cells.append(f'<c r="{c.coordinate}" t="b"{s_attr}><v>{int(v)}</v></c>')
            elif isinstance(v, (int, float)):
                cells.append(f'<c r="{c.coordinate}"{s_attr}><v>{repr(float(v)) if isinstance(v, float) else v}</v></c>')
            else:
                cells.append(f'<c r="{c.coordinate}" t="inlineStr"{s_attr}><is><t xml:space="preserve">{escape(str(v))}</t></is></c>')
        if cells:
            out.append(f'<row r="{row[0].row}">' + "".join(cells) + "</row>")
    out.append("</sheetData></worksheet>")
    return "".join(out)


def inject(src: Path, new_wb, dst: Path, sheet_order: list[str]):
    zin = zipfile.ZipFile(src)
    files = {n: zin.read(n) for n in zin.namelist()}
    zin.close()

    styles, S = _styles(files["xl/styles.xml"].decode("utf-8"))
    files["xl/styles.xml"] = styles.encode("utf-8")

    wbx = files["xl/workbook.xml"].decode("utf-8")
    rels = files["xl/_rels/workbook.xml.rels"].decode("utf-8")
    ct = files["[Content_Types].xml"].decode("utf-8")
    # 이미 v2 시트가 있으면 이름 충돌 → 원본에서 다시 실행하도록 안내
    for name in sheet_order:
        if f'name="{escape(name)}"' in wbx:
            raise SystemExit(f"'{name}' 시트가 이미 있습니다. v2 시트가 없는 원본 파일로 실행하세요.")
    sheet_ids = [int(x) for x in re.findall(r'sheetId="(\d+)"', wbx)]
    next_id = max(sheet_ids) + 1
    existing = {int(x) for x in re.findall(r'xl/worksheets/sheet(\d+)\.xml', " ".join(files))}
    next_file = max(existing) + 1
    new_sheet_tags, new_rels, new_ct = [], [], []
    for i, name in enumerate(sheet_order):
        fn = f"xl/worksheets/sheet{next_file + i}.xml"
        files[fn] = _sheet_xml(new_wb[name], S).encode("utf-8")
        rid = f"rIdV2{i + 1}"
        new_sheet_tags.append(f'<sheet name="{escape(name)}" sheetId="{next_id + i}" r:id="{rid}"/>')
        new_rels.append(f'<Relationship Id="{rid}" Type="{WS_TYPE}" Target="worksheets/sheet{next_file + i}.xml"/>')
        new_ct.append(f'<Override PartName="/{fn}" ContentType="{WS_CT}"/>')
    wbx = wbx.replace("</sheets>", "".join(new_sheet_tags) + "</sheets>")
    # 열 때 전체 재계산 (새 시트는 캐시값이 없음)
    if "fullCalcOnLoad" not in wbx:
        wbx = re.sub(r"<calcPr([^>]*)/>", r'<calcPr\1 fullCalcOnLoad="1"/>', wbx)
    rels = rels.replace("</Relationships>", "".join(new_rels) + "</Relationships>")
    ct = ct.replace("</Types>", "".join(new_ct) + "</Types>")
    files["xl/workbook.xml"] = wbx.encode("utf-8")
    files["xl/_rels/workbook.xml.rels"] = rels.encode("utf-8")
    files["[Content_Types].xml"] = ct.encode("utf-8")

    dst.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in files.items():
            z.writestr(n, b)

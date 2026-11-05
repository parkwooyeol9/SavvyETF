"""KRX 옵션 보드 — 엑셀(정리 + 시계열 시트) 작성.

ETF Flow 주간 엑셀과 같은 ChartFormat 양식(맑은 고딕, 425288·B2B2B2·CC9900, 남색 머리행)을 쓴다.
셀 서식·막대 차트 헬퍼는 `03_ETF/etf_flow_weekly_excel.py` 의 것을 그대로 가져온다.
차트는 셀 범위를 참조하는 엑셀 네이티브 차트.
"""

from __future__ import annotations

import path_setup  # noqa: F401  # numbered folders on sys.path

from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.chart import LineChart, Reference
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.drawing.line import LineProperties
from openpyxl.utils import get_column_letter

from etf_flow_weekly_excel import (
    B_ALL,
    CENTER,
    F_BOLD,
    F_NOTE,
    FILL_SUB,
    GOLD,
    GRAY,
    LEFT,
    NAVY,
    RIGHT,
    _bar,
    _cell,
    _finish,
    _header,
    _title,
)

FMT_2 = '#,##0.00;[Blue]-#,##0.00;0.00'
FMT_1 = '#,##0.0;[Blue]-#,##0.0;0.0'
FMT_0 = '#,##0;[Blue]-#,##0;0'
FMT_PCT = '0.00"%";[Blue]-0.00"%"'
FMT_RATIO = '0.000'


def _line(title: str, *, y_fmt: str = "#,##0.0", colors: list[str] | None = None,
          width: float = 22.0, height: float = 8.0) -> LineChart:
    ch = LineChart()
    ch.title = title
    ch.style = 2
    ch.width, ch.height = width, height
    ch.y_axis.numFmt = y_fmt
    ch.y_axis.majorGridlines.spPr = GraphicalProperties(ln=LineProperties(solidFill="E7E6E6"))
    ch.y_axis.delete = False
    ch.x_axis.delete = False
    ch.x_axis.number_format = "mm-dd"
    ch.x_axis.tickLblPos = "low"
    ch.legend.position = "b"
    ch._colors = colors or [NAVY, GOLD, GRAY]
    return ch


def _finish_line(ch: LineChart) -> LineChart:
    for i, s in enumerate(ch.series):
        color = ch._colors[i % len(ch._colors)]
        s.graphicalProperties.line.solidFill = color
        s.graphicalProperties.line.width = 19050
        s.smooth = False
        s.marker.symbol = "none"
    return ch


def _table(ws, r0: int, c0: int, headers: list[str], rows: list[list[Any]], fmts: list[str | None],
           *, first_bold: bool = True) -> int:
    _header(ws, r0, c0, headers)
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            if j == 0 and first_bold:
                _cell(ws, r0 + 1 + i, c0, v, font=F_BOLD, fill=FILL_SUB, align=CENTER)
            else:
                _cell(ws, r0 + 1 + i, c0 + j, v, fmt=fmts[j], align=RIGHT if fmts[j] else LEFT)
    return r0 + 1 + len(rows)


def _widths(ws, widths: list[float]) -> None:
    for i, w in enumerate(widths):
        ws.column_dimensions[get_column_letter(i + 1)].width = w


def _summary_sheet(wb: Workbook, p: dict[str, Any]) -> None:
    ws = wb.active
    ws.title = "정리"
    ws.sheet_view.showGridLines = False
    _widths(ws, [24, 14, 14, 14, 14, 14, 14, 14, 14, 14, 40])
    s = p["summary"]
    ws["A2"] = f"KRX 옵션 보드 · 기준일 {p['as_of']} · 작성 {p['generated_at_display']}"
    ws["A2"].font = F_NOTE

    # 1. 핵심 지표
    r = 4
    _title(ws, r, "1. 핵심 지표", ["VRP = VKOSPI − RV20 (+면 옵션 매도 우위 국면)",
                               "스큐 = 5% OTM 풋 IV − 5% OTM 콜 IV (근월물)",
                               "GEX = 딜러 콜 롱·풋 숏 관례 가정, 억원/1%"])
    items = [
        ("코스피 200", s["k200"], FMT_2), ("등락률(%)", s["k200_chg"], FMT_PCT),
        ("VKOSPI", s["vkospi"], FMT_2), ("VKOSPI 6개월 백분위(%)", s["vkospi_pctile"], FMT_0),
        ("RV20(%)", s["rv20"], FMT_2), ("VRP(%p)", s["vrp"], FMT_2),
        ("근월 ATM IV(%)", s["atm_iv"], FMT_2), ("근월 스큐(%p)", s["skew"], FMT_2),
        ("P/C 미결제약정", s["pc_oi"], FMT_RATIO), ("P/C 거래량", s["pc_vol"], FMT_RATIO),
        ("선물 베이시스(pt)", s["basis"], FMT_2), ("선물 미결제 증감(계약)", s["fut_oi_chg"], FMT_0),
        ("콜 OI 벽", s["call_wall"], FMT_1), ("풋 OI 벽", s["put_wall"], FMT_1),
        ("Max Pain", s["max_pain"], FMT_1), ("GEX(억원/1%, 45일 내)", s["gex_eok"], FMT_1),
    ]
    _header(ws, r + 2, 1, ["지표", "값"])
    for i, (lab, v, fmt) in enumerate(items):
        _cell(ws, r + 3 + i, 1, lab, font=F_BOLD, fill=FILL_SUB, align=LEFT)
        _cell(ws, r + 3 + i, 2, v, fmt=fmt, align=RIGHT)

    # 2. 만기별 구조
    r = r + 4 + len(items)
    _title(ws, r, "2. 코스피200 옵션 만기별 구조", ["정규장 · 기초가격 = 풋콜 패리티 역산",
                                             "콜/풋 벽 = 미결제약정 최대 행사가"])
    rows = [[e["product"], e["expiry"], e["dte"], e["spot"], e["atm_iv"], e["skew"], e["pc_oi"],
             e["call_wall"], e["put_wall"], e["max_pain"], e["gex_eok"]] for e in p["chain"]["expiries"]]
    _table(ws, r + 2, 1, ["상품", "만기", "잔존일", "기초", "ATM IV", "스큐", "P/C OI", "콜 벽", "풋 벽",
                          "Max Pain", "GEX(억)"],
           rows, [None, None, FMT_0, FMT_2, FMT_2, FMT_2, FMT_RATIO, FMT_1, FMT_1, FMT_1, FMT_1])
    exp_end = r + 2 + len(rows)
    if rows:
        ch = _line("만기별 ATM IV (기간구조)", y_fmt="0.0", width=17, height=7.5)
        ch.add_data(Reference(ws, min_col=5, min_row=r + 2, max_row=exp_end), titles_from_data=True)
        ch.set_categories(Reference(ws, min_col=2, min_row=r + 3, max_row=exp_end))
        ch.x_axis.number_format = "General"
        ws.add_chart(_finish_line(ch), f"M{r}")

    # 3. 전략지수
    r = exp_end + 3
    _title(ws, r, "3. 옵션 전략지수 성과", ["초과 = 전략지수 수익률 − 코스피 200 수익률",
                                      "양매도 초과가 +면 실현 변동성 < 내재 변동성"])
    rows = [[x["name"], x["close"], x["r1d"], x["r1m"], x["r3m"], x.get("ex1m"), x.get("ex3m")] for x in p["strategy"]]
    end = _table(ws, r + 2, 1, ["지수", "종가", "1D", "1M", "3M", "1M 초과", "3M 초과"], rows,
                 [None, FMT_2, FMT_PCT, FMT_PCT, FMT_PCT, FMT_PCT, FMT_PCT])
    ch = _bar("1M 성과 (%)", horizontal=True, y_fmt="0.0", width=17, height=8)
    ch.add_data(Reference(ws, min_col=4, min_row=r + 2, max_row=end - 1), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=r + 3, max_row=end - 1))
    ws.add_chart(_finish(ch), f"M{r}")

    # 4. 레버리지/인버스 ETF
    r = end + 3
    _title(ws, r, "4. 레버리지·인버스 ETF 설정·환매 추정", ["단위 억원 · Δ상장좌수 × NAV",
                                                   "코스피200·코스닥150 기초만(섹터형 제외)"])
    tot = p["etf"]["totals"]
    rows = [[k.replace("_", " "), v["aum_eok"], v["flow_5d"], v["flow_20d"]] for k, v in tot.items()]
    end = _table(ws, r + 2, 1, ["구분", "순자산", "5일 순설정", "20일 순설정"], rows, [None, FMT_0, FMT_1, FMT_1])
    ch = _bar("20일 순설정 (억원)", y_fmt="#,##0", width=17, height=7.5)
    ch.add_data(Reference(ws, min_col=4, min_row=r + 2, max_row=end - 1), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=r + 3, max_row=end - 1))
    ws.add_chart(_finish(ch), f"M{r}")

    # 5. 주식옵션
    r = end + 3
    _title(ws, r, "5. 주식옵션 거래대금 상위 기초자산", ["P/C = 풋/콜 (거래대금·미결제약정)",
                                               "ATM IV·스큐는 근월물, 스큐는 ±10%"])
    rows = [[x["name"], x["spot"], x["val_eok"], x["share"], x["pc_val"], x["pc_oi"], x["atm_iv"], x["skew"]]
            for x in p["stocks"]]
    _table(ws, r + 2, 1, ["기초자산", "기초가격", "거래대금(억)", "비중(%)", "P/C 대금", "P/C OI", "ATM IV", "스큐"],
           rows, [None, FMT_0, FMT_2, FMT_1, FMT_2, FMT_2, FMT_2, FMT_2])

    # 출처·방법
    r = r + 4 + len(rows)
    ws.cell(row=r, column=1, value="출처·방법").font = F_BOLD
    for i, t in enumerate([*p["sources"], *p["method"]]):
        ws.cell(row=r + 1 + i, column=1, value=f"· {t}").font = F_NOTE


def _series_sheet(wb: Workbook, name: str, title: str, headers: list[str], keys: list[str],
                  fmts: list[str | None], rows: list[dict[str, Any]], charts: list[tuple[str, list[int], str]]) -> None:
    ws = wb.create_sheet(name)
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "B4"
    ws["A1"] = title
    ws["A1"].font = F_BOLD
    _header(ws, 3, 1, headers)
    for i, row in enumerate(rows):
        for j, k in enumerate(keys):
            c = _cell(ws, 4 + i, 1 + j, row.get(k), fmt=fmts[j], align=RIGHT if j else CENTER)
            c.border = B_ALL
    _widths(ws, [12] + [13] * (len(keys) - 1))
    last = 3 + len(rows)
    col_anchor = get_column_letter(len(keys) + 2)
    for n, (ct, cols, fmt) in enumerate(charts):
        ch = _line(ct, y_fmt=fmt)
        for c in cols:
            ch.add_data(Reference(ws, min_col=c, min_row=3, max_row=last), titles_from_data=True)
        ch.set_categories(Reference(ws, min_col=1, min_row=4, max_row=last))
        ch.x_axis.number_format = "General"
        ws.add_chart(_finish_line(ch), f"{col_anchor}{3 + n * 18}")


def _chain_sheet(wb: Workbook, p: dict[str, Any]) -> None:
    front = p["chain"].get("front")
    ws = wb.create_sheet("근월물 체인")
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "B4"
    if not front:
        ws["A1"] = "근월물 체인 없음"
        return
    ws["A1"] = (f"코스피200 옵션 {front['code']} (만기 {front['expiry']}, 잔존 {front['dte']}일) · "
                f"기초 {front['spot']} · 기초 ±12% 행사가")
    ws["A1"].font = F_BOLD
    headers = ["행사가", "콜 OI", "풋 OI", "콜 거래량", "풋 거래량", "콜 IV", "풋 IV", "콜 정산가", "풋 정산가", "GEX(억/1%)"]
    keys = ["strike", "c_oi", "p_oi", "c_vol", "p_vol", "c_iv", "p_iv", "c_px", "p_px", "gex_eok"]
    fmts = [FMT_1, FMT_0, FMT_0, FMT_0, FMT_0, FMT_2, FMT_2, FMT_2, FMT_2, FMT_2]
    _header(ws, 3, 1, headers)
    for i, row in enumerate(front["strikes"]):
        for j, k in enumerate(keys):
            _cell(ws, 4 + i, 1 + j, row.get(k), fmt=fmts[j], align=RIGHT)
    _widths(ws, [10] + [11] * 9)
    last = 3 + len(front["strikes"])
    ch = _bar("행사가별 미결제약정", y_fmt="#,##0", colors=[NAVY, GOLD], width=24, height=9)
    ch.add_data(Reference(ws, min_col=2, max_col=3, min_row=3, max_row=last), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=4, max_row=last))
    ws.add_chart(_finish(ch), "L3")
    ch = _bar("행사가별 GEX (억원/1%)", y_fmt="#,##0", width=24, height=8)
    ch.add_data(Reference(ws, min_col=10, min_row=3, max_row=last), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=4, max_row=last))
    ws.add_chart(_finish(ch), "L22")


def _etf_sheet(wb: Workbook, p: dict[str, Any]) -> None:
    ws = wb.create_sheet("레버리지·인버스 ETF")
    ws.sheet_view.showGridLines = False
    ws["A1"] = "순자산 300억원 이상 · 설정·환매 추정 = Δ상장좌수 × NAV (억원)"
    ws["A1"].font = F_BOLD
    rows = [[x["name"], x["code"], x["base"], x["dir"], x["aum_eok"], x["chg"], x["val_eok"],
             x["flow_1d"], x["flow_5d"], x["flow_20d"]] for x in p["etf"]["table"]]
    _table(ws, 3, 1, ["ETF", "코드", "기초", "방향", "순자산", "등락률", "거래대금", "1일", "5일", "20일"], rows,
           [None, None, None, None, FMT_0, FMT_PCT, FMT_1, FMT_1, FMT_1, FMT_1])
    _widths(ws, [30, 9, 11, 9, 12, 10, 11, 10, 10, 10])


def _investor_sheets(wb: Workbook, p: dict[str, Any]) -> None:
    inv = p.get("investor")
    if not inv:
        return
    names = inv["investors"]
    has_cash = bool(inv.get("has_cash"))
    ws = wb.create_sheet("투자자별 수급")
    ws.sheet_view.showGridLines = False
    _widths(ws, [14, 13, 13, 13, 13, 13, 15, 13, 4, 40])
    ws["A1"] = (f"코스피 현물·코스피200 선물·옵션 투자자별 순매수 · 기준일 {inv['as_of']} · "
                f"만기일(월·목) 콜은 방향에서 빼고 따로 집계 · {inv['source']}")
    ws["A1"].font = F_BOLD
    r = 3
    head = (["투자자"] + (["현물(억)"] if has_cash else [])
            + ["선물(계약)", "선물(억)", "콜(계약)", "풋(계약)", "비만기일 옵션 방향(억)", "만기일 콜(억)"])
    fm = [None] + ([FMT_0] if has_cash else []) + [FMT_0, FMT_1, FMT_0, FMT_0, FMT_1, FMT_1]
    for w, label in (("d1", "1일"), ("d5", "5일"), ("d20", "20일")):
        _title(ws, r, f"{label} 누적", [])
        rows = []
        for n in names:
            x = inv["windows"][w][n]
            rows.append([n] + ([x.get("cash_eok")] if has_cash else [])
                        + [x["fut_qty"], x["fut_eok"], x["call_qty"], x["put_qty"], x["dir_eok"], x.get("roll_eok")])
        r = _table(ws, r + 1, 1, head, rows, fm) + 2
    _title(ws, r, "지수 동행성 (일별 순매수 vs 코스피 200 등락률 상관)", [])
    ch = (["현물·당일", "현물·익일"] if has_cash else []) + ["선물·당일", "선물·익일", "옵션방향·당일", "옵션방향·익일"]
    rows = [[c["name"]] + ([c.get("cash_same"), c.get("cash_next")] if has_cash else [])
            + [c["fut_same"], c["fut_next"], c["dir_same"], c["dir_next"]] for c in inv["corr"]]
    r = _table(ws, r + 1, 1, ["투자자", *ch], rows, [None] + [FMT_2] * len(ch)) + 2
    det = inv.get("detail")
    if det:
        for w, label in (("d5", "5일"), ("d20", "20일")):
            _title(ws, r, f"기관 세부 · {label} (기간합계, 만기일 포함, 기준일 {det['as_of']})", [])
            rows = [[x["name"], x["fut_qty"], x["fut_eok"], x["call_qty"], x["put_qty"], x["call_eok"], x["put_eok"]]
                    for x in det["windows"][w]]
            r = _table(ws, r + 1, 1, ["투자자", "선물(계약)", "선물(억)", "콜(계약)", "풋(계약)", "콜(억)", "풋(억)"],
                       rows, [None, FMT_0, FMT_1, FMT_0, FMT_0, FMT_1, FMT_1]) + 2
    ws.cell(row=r, column=1, value="해석").font = F_BOLD
    for i, t in enumerate([*inv["reads"], *inv["method"]]):
        ws.cell(row=r + 1 + i, column=1, value=f"· {t}").font = F_NOTE

    keys = ["date", "k200", "ret", "exp"]
    headers = ["일자", "코스피 200", "등락률", "만기일"]
    fmts: list[str | None] = [None, FMT_2, FMT_PCT, None]
    per = ([("cash", "현물(억)", FMT_1)] if has_cash else []) + [
        ("fut", "선물", FMT_0), ("call", "콜", FMT_0), ("put", "풋", FMT_0),
        ("dir", "옵션방향(억)", FMT_1), ("roll", "만기일콜(억)", FMT_1),
        ("expo" if has_cash else "cum_fut", "현물+선물 노출(억)" if has_cash else "선물누적", FMT_0),
        ("cum_dir", "방향누적(억)", FMT_1)]
    for n in names:
        for k, lab, f in per:
            keys.append(f"{k}_{n}")
            headers.append(f"{n} {lab}")
            fmts.append(f)
    width = len(per)
    expo_cols = [5 + width * i + (width - 2) for i in range(len(names))]
    dir_cols = [5 + width * i + (width - 1) for i in range(len(names))]
    rows = [{**x, "exp": "만기" if x.get("exp") else ""} for x in inv["series"]]
    _series_sheet(
        wb, "투자자별 일별", "투자자별 일별 순매수 · 누적은 첫 적재일부터 · 옵션방향은 만기일 제외",
        headers, keys, fmts, rows,
        [("현물+선물 누적 노출 (억원)" if has_cash else "선물 누적 순매수 (계약)", expo_cols, "#,##0"),
         ("비만기일 옵션 방향 누적 (억원)", dir_cols, "#,##0")],
    )


def write_workbook(payload: dict[str, Any], path: Path) -> Path:
    wb = Workbook()
    _summary_sheet(wb, payload)
    _investor_sheets(wb, payload)
    _chain_sheet(wb, payload)
    _series_sheet(
        wb, "변동성", "코스피 200 · VKOSPI · 실현변동성(RV20) · VRP",
        ["일자", "코스피 200", "VKOSPI", "RV20", "VRP"], ["date", "k200", "vkospi", "rv20", "vrp"],
        [None, FMT_2, FMT_2, FMT_2, FMT_2], payload["vol"]["series"],
        [("VKOSPI vs RV20 (%)", [3, 4], "0"), ("VRP = VKOSPI − RV20 (%p)", [5], "0")],
    )
    _series_sheet(
        wb, "PC 비율", "코스피200 옵션(월물+위클리) 풋/콜 비율 · 정규장",
        ["일자", "P/C 거래량", "P/C 미결제", "P/C 대금", "콜 거래량", "풋 거래량", "콜 미결제", "풋 미결제", "프리미엄(억)"],
        ["date", "pc_vol", "pc_oi", "pc_val", "c_vol", "p_vol", "c_oi", "p_oi", "prem_eok"],
        [None, FMT_RATIO, FMT_RATIO, FMT_RATIO, FMT_0, FMT_0, FMT_0, FMT_0, FMT_1], payload["pc"],
        [("풋/콜 비율", [2, 3], "0.00")],
    )
    _series_sheet(
        wb, "선물", "코스피200 선물 최근월(주간) · 베이시스 = 선물 − 현물",
        ["일자", "종목", "선물", "현물", "베이시스", "근월 OI", "전체 OI", "OI 증감", "거래량"],
        ["date", "name", "close", "spot", "basis", "oi", "oi_all", "oi_chg", "vol"],
        [None, None, FMT_2, FMT_2, FMT_2, FMT_0, FMT_0, FMT_0, FMT_0], payload["futures"],
        [("베이시스 (pt)", [5], "0.0"), ("선물 전체 미결제약정", [7], "#,##0")],
    )
    _etf_sheet(wb, payload)
    _series_sheet(
        wb, "ETF 일별 설정", "레버리지·인버스 ETF 일별 순설정 추정 (억원)",
        ["일자", "코스피200 레버리지", "코스피200 인버스", "코스닥150 레버리지", "코스닥150 인버스"],
        ["date", "코스피200_레버리지", "코스피200_인버스", "코스닥150_레버리지", "코스닥150_인버스"],
        [None, FMT_1, FMT_1, FMT_1, FMT_1], payload["etf"]["series"], [],
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path
